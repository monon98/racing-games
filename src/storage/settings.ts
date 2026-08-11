import { DEFAULT_CAR_COLOR, DEFAULT_PLAYER_NAME } from '../config';
import type { PlayerSettings, TrackMode } from '../types';

const KEY_NAME = 'racing.playerName';
const KEY_COLOR = 'racing.carColor';
const KEY_MODE = 'racing.trackMode';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景下忽略
  }
}

export function loadSettings(): PlayerSettings {
  return {
    playerName: read(KEY_NAME)?.trim() || DEFAULT_PLAYER_NAME,
    carColor: read(KEY_COLOR) || DEFAULT_CAR_COLOR,
    trackMode: read(KEY_MODE) === 'complex' ? 'complex' : 'simple',
  };
}

export function savePlayerName(name: string): void {
  write(KEY_NAME, name);
}

export function saveCarColor(color: string): void {
  write(KEY_COLOR, color);
}

export function saveTrackMode(mode: TrackMode): void {
  write(KEY_MODE, mode);
}
