import { DEFAULT_CAR_COLOR } from '../config';
import type { PlayerSettings, TrackMode } from '../types';
import { PRESET_TRACKS } from '../track/presets';
import { randomPlayerName } from '../utils/random';

const KEY_NAME = 'racing.playerName';
const KEY_COLOR = 'racing.carColor';
const KEY_MODE = 'racing.trackMode';
const KEY_PRESET = 'racing.trackPreset';

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
  const storedMode = read(KEY_MODE);
  const trackMode: TrackMode =
    storedMode === 'complex' ? 'complex' : storedMode === 'simple' ? 'simple' : 'preset';
  const storedPreset = read(KEY_PRESET);
  return {
    playerName: read(KEY_NAME)?.trim() || randomPlayerName(),
    carColor: read(KEY_COLOR) || DEFAULT_CAR_COLOR,
    trackMode,
    trackPresetId:
      trackMode === 'preset' && storedPreset && PRESET_TRACKS.some((p) => p.id === storedPreset)
        ? storedPreset
        : PRESET_TRACKS[0].id,
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

export function saveTrackPreset(presetId: string): void {
  write(KEY_PRESET, presetId);
}
