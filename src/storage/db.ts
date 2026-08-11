import { openDB, type IDBPDatabase } from 'idb';
import { LEADERBOARD_SIZE } from '../config';
import type { LeaderboardEntry, TrackPackage } from '../types';

const DB_NAME = 'racing-game';
const DB_VERSION = 1;
const TRACKS = 'tracks';
const LEADERBOARD = 'leaderboard';
const ACTIVE_KEY = 'active';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TRACKS)) {
          db.createObjectStore(TRACKS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(LEADERBOARD)) {
          db.createObjectStore(LEADERBOARD, { keyPath: 'trackId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadActiveTrack(): Promise<TrackPackage | undefined> {
  const db = await getDb();
  const row = await db.get(TRACKS, ACTIVE_KEY);
  return row ? (row as TrackPackage) : undefined;
}

export async function saveActiveTrack(track: TrackPackage): Promise<void> {
  const db = await getDb();
  await db.put(TRACKS, { key: ACTIVE_KEY, ...track });
}

/** 替换活动赛道：同时清除旧赛道对应的排行榜 */
export async function replaceActiveTrack(track: TrackPackage): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([TRACKS, LEADERBOARD], 'readwrite');
  const old = (await tx.objectStore(TRACKS).get(ACTIVE_KEY)) as
    | (TrackPackage & { key: string })
    | undefined;
  await tx.objectStore(TRACKS).put({ key: ACTIVE_KEY, ...track });
  if (old && old.meta.id !== track.meta.id) {
    await tx.objectStore(LEADERBOARD).delete(old.meta.id);
  }
  await tx.done;
}

export async function getLeaderboard(trackId: string): Promise<LeaderboardEntry[]> {
  const db = await getDb();
  const row = await db.get(LEADERBOARD, trackId);
  return row ? row.entries : [];
}

export async function addLeaderboardEntry(entry: LeaderboardEntry): Promise<LeaderboardEntry[]> {
  const db = await getDb();
  const tx = db.transaction(LEADERBOARD, 'readwrite');
  const store = tx.objectStore(LEADERBOARD);
  const row = await store.get(entry.trackId);
  const entries: LeaderboardEntry[] = row ? row.entries : [];
  entries.push(entry);
  entries.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const trimmed = entries.slice(0, LEADERBOARD_SIZE);
  await store.put({ trackId: entry.trackId, entries: trimmed });
  await tx.done;
  return trimmed;
}
