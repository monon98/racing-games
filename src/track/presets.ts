import * as THREE from 'three';

/**
 * 官方预设赛道：布局为固定的控制点数据（Catmull-Rom 闭环平滑）。
 * 预设轨道的目标是“布局永远不随生成器版本变化”——升级只重采样/缩放，不改变形状。
 * 新增预设：在 PRESET_TRACKS 数组追加条目即可（首页下拉自动出现）。
 */
export interface PresetTrack {
  /** 稳定 ID：写入 TrackMeta.presetId 并随 GLB 往返，发布后不得更改 */
  id: string;
  name: string;
  description: string;
  /** 目标单圈长度（m），生成器会把平滑闭环缩放到该长度 */
  length: number;
  /** 环境（树/石头）布点随机种子，保证预设外观稳定 */
  seed: number;
  /** 闭环控制点 [x, z]（顺时针或逆时针均可，不得自交） */
  controls: Array<[number, number]>;
}

export const PRESET_TRACKS: PresetTrack[] = [
  {
    id: 'aurora-ring',
    name: '极光环道',
    description: '官方首发预设：长主直道 + 高速 S 弯 + 底部发卡，约 1.8km 平地环道',
    length: 1800,
    seed: 20260,
    controls: [
      [0, 150],
      [150, 150],
      [230, 120],
      [250, 40],
      [200, -20],
      [240, -90],
      [190, -160],
      [110, -170],
      [80, -120],
      [0, -140],
      [-80, -170],
      [-160, -130],
      [-200, -40],
      [-170, 30],
      [-220, 100],
      [-160, 150],
    ],
  },
  {
    id: 'sunfall-sweep',
    name: '落日余晖',
    description: '官方进阶预设：大半径高速环道 + 左侧回旋弯，约 1.8km 顺滑流线',
    length: 1800,
    seed: 31415,
    controls: [
      [0, 200],
      [160, 190],
      [280, 130],
      [320, 10],
      [300, -120],
      [190, -200],
      [40, -210],
      [-100, -190],
      [-210, -110],
      [-250, 10],
      [-180, 60],
      [-230, 130],
      [-130, 190],
    ],
  },
  {
    id: 'windmill-corridor',
    name: '回旋花廊',
    description: '官方技术预设：双发卡回旋 + 底部直道，约 1.4km 紧凑低速技术环',
    length: 1400,
    seed: 27182,
    controls: [
      [0, 170],
      [130, 160],
      [200, 90],
      [170, 10],
      [90, -10],
      [150, -90],
      [60, -150],
      [-60, -150],
      [-150, -90],
      [-90, -10],
      [-170, 10],
      [-200, 90],
      [-130, 160],
    ],
  },
];

export function getPresetTrack(id: string | null | undefined): PresetTrack {
  return PRESET_TRACKS.find((p) => p.id === id) ?? PRESET_TRACKS[0];
}

/** 与生成器自定义赛道一致的采样间距（m） */
const SAMPLE_SPACING = 1.2;

/** 从控制点采样平滑闭环（与自定义赛道同一 Catmull-Rom 参数） */
export function samplePresetCenterline(preset: PresetTrack): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(
    preset.controls.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'catmullrom',
    0.6,
  );
  const steps = Math.max(300, Math.round(preset.length / SAMPLE_SPACING));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < steps; i++) pts.push(curve.getPoint(i / steps));
  return pts;
}
