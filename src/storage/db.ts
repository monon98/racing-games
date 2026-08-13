import { LEADERBOARD_SIZE } from '../config';
import type { LeaderboardEntry, TrackPackage } from '../types';

const DB_NAME = 'racing-game';
const DB_VERSION = 1;
const TRACKS = 'tracks';
const LEADERBOARD = 'leaderboard';
const ACTIVE_KEY = 'active';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TRACKS)) {
          db.createObjectStore(TRACKS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(LEADERBOARD)) {
          db.createObjectStore(LEADERBOARD, { keyPath: 'trackId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadActiveTrack(): Promise<TrackPackage | undefined> {
  const db = await getDb();
  const row = await request(db.transaction(TRACKS).objectStore(TRACKS).get(ACTIVE_KEY));
  return row ? (row as TrackPackage) : undefined;
}

export async function saveActiveTrack(track: TrackPackage): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(TRACKS, 'readwrite');
  tx.objectStore(TRACKS).put({ key: ACTIVE_KEY, ...track });
  await transactionDone(tx);
}

/** 替换活动赛道：同时清除旧赛道对应的排行榜 */
export async function replaceActiveTrack(track: TrackPackage): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([TRACKS, LEADERBOARD], 'readwrite');
  const old = (await request(tx.objectStore(TRACKS).get(ACTIVE_KEY))) as
    | (TrackPackage & { key: string })
    | undefined;
  tx.objectStore(TRACKS).put({ key: ACTIVE_KEY, ...track });
  if (old && old.meta.id !== track.meta.id) {
    tx.objectStore(LEADERBOARD).delete(old.meta.id);
  }
  await transactionDone(tx);
}

export async function getLeaderboard(trackId: string): Promise<LeaderboardEntry[]> {
  const db = await getDb();
  const row = await request(db.transaction(LEADERBOARD).objectStore(LEADERBOARD).get(trackId));
  return row ? row.entries : [];
}

export async function addLeaderboardEntry(entry: LeaderboardEntry): Promise<LeaderboardEntry[]> {
  const db = await getDb();
  const tx = db.transaction(LEADERBOARD, 'readwrite');
  const store = tx.objectStore(LEADERBOARD);
  const row = await request(store.get(entry.trackId));
  const entries: LeaderboardEntry[] = row ? row.entries : [];
  entries.push(entry);
  entries.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const trimmed = entries.slice(0, LEADERBOARD_SIZE);
  store.put({ trackId: entry.trackId, entries: trimmed });
  await transactionDone(tx);
  return trimmed;
}
