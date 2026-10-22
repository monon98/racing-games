/** 赛道来源：preset = 官方预设（固定布局）；simple/complex = 自定义随机生成 */
export type TrackMode = 'preset' | 'simple' | 'complex';

export interface TrackMeta {
  id: string;
  mode: TrackMode;
  seed: number;
  /** preset 模式下的预设 ID（自定义生成时为 null） */
  presetId: string | null;
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
  /** 预设模式下选中的预设赛道 ID（内置或本地 `local-*`） */
  trackPresetId: string;
}

/** 本地文件预设：用户导入的赛道文件注册为可选预设（随时可不存在，删除即恢复纯内置列表） */
export interface LocalPresetEntry {
  /** `local-` 前缀 + UUID，稳定标识（下拉/GLB 引用） */
  id: string;
  fileName: string;
  createdAt: number;
  pkg: TrackPackage;
}
