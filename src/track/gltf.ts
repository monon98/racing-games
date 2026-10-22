import type { Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TRACK_VERSION } from '../config';
import type { Point3, TrackMeta, TrackMode, TrackPackage } from '../types';
import { randomSeed } from '../utils/random';
import type { BuiltTrack } from './generator';

export const TRACK_ASSET_TYPE = 'racing-game-track';

interface TrackUserData {
  type?: string;
  version?: number;
  meta?: { mode?: TrackMode; seed?: number; presetId?: string | null };
  roadWidth?: number;
  barrierHeight?: number;
  centerline?: Point3[];
}

/** 递归查找导出的赛道数据（GLTF 根对象会成为一个 node，extras 落在节点上） */
export function extractTrackUserData(root: Object3D): TrackUserData {
  const ud = (root.userData ?? {}) as TrackUserData;
  if (ud.type === TRACK_ASSET_TYPE && Array.isArray(ud.centerline)) {
    return ud;
  }
  for (const child of root.children) {
    const found = extractTrackUserData(child);
    if (found.type === TRACK_ASSET_TYPE) return found;
  }
  return {};
}

/** 把赛道导出为 GLB（GLTF 2.0 二进制），赛道中心线等数据写入 extras */
export async function exportTrackToBlob(track: BuiltTrack): Promise<Blob> {
  track.group.userData = {
    type: TRACK_ASSET_TYPE,
    version: track.meta.version,
    meta: { mode: track.meta.mode, seed: track.meta.seed, presetId: track.meta.presetId },
    roadWidth: track.roadWidth,
    barrierHeight: track.barrierHeight,
    centerline: track.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  } satisfies TrackUserData;

  const exporter = new GLTFExporter();
  const result = (await exporter.parseAsync(track.group, {
    binary: true,
    onlyVisible: true,
  })) as ArrayBuffer;
  return new Blob([result], { type: 'model/gltf-binary' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 导入 .glb / 单文件内嵌 .gltf 赛道 */
export async function importTrackFromFile(file: File): Promise<TrackPackage> {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.glb') && !name.endsWith('.gltf')) {
    throw new Error('请选择 .glb 或 .gltf 格式的赛道文件');
  }
  const url = URL.createObjectURL(file);
  try {
    const pkg = await importTrackFromUrl(url);
    // 文件导入保留原 GLB（用于再次导出）
    pkg.glb = file;
    return pkg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 校验并从已加载的场景构建赛道包（预设信息可被覆盖，例如本地预设） */
export function trackPackageFromGltf(
  gltf: { scene: { userData: unknown } },
  metaOverride?: Partial<TrackMeta>,
): TrackPackage {
  const ud = extractTrackUserData(gltf.scene as never);
  if (ud.type !== TRACK_ASSET_TYPE || !Array.isArray(ud.centerline) || ud.centerline.length < 20) {
    throw new Error('该文件不是本游戏导出的赛道文件（缺少赛道数据）');
  }
  const mode: TrackMode =
    ud.meta?.mode === 'complex' ? 'complex' : ud.meta?.mode === 'preset' ? 'preset' : 'simple';
  const meta: TrackMeta = {
    id: crypto.randomUUID(),
    mode,
    presetId: typeof ud.meta?.presetId === 'string' ? ud.meta.presetId : null,
    seed: typeof ud.meta?.seed === 'number' ? ud.meta.seed : randomSeed(),
    createdAt: Date.now(),
    version: TRACK_VERSION,
    ...metaOverride,
  };
  return {
    meta,
    centerline: ud.centerline.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    glb: null,
  };
}

/** 从 URL 加载并校验赛道（公网/相对路径 GLB） */
export async function importTrackFromUrl(url: string): Promise<TrackPackage> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return trackPackageFromGltf(gltf);
}
