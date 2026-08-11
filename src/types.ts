export type TrackMode = 'simple' | 'complex';

export interface TrackMeta {
  id: string;
  mode: TrackMode;
  seed: number;
  createdAt: number;
  version: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** IndexedDB 中存储的赛道包：元数据 + 中心线（功能数据）+ GLB（可再导出） */
export interface TrackPackage {
  meta: TrackMeta;
  centerline: Point3[];
  glb: Blob | null;
}

export interface LeaderboardEntry {
  trackId: string;
  playerName: string;
  lapTimeMs: number;
  timePenaltyMs: number;
  distancePenaltyM: number;
  flips: number;
  date: number;
}

export interface PlayerSettings {
  playerName: string;
  carColor: string;
  trackMode: TrackMode;
}
