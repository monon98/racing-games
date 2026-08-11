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
  meta?: { mode?: TrackMode; seed?: number };
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
    meta: { mode: track.meta.mode, seed: track.meta.seed },
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
    const gltf = await new GLTFLoader().loadAsync(url);
    const ud = extractTrackUserData(gltf.scene);
    if (ud.type !== TRACK_ASSET_TYPE || !Array.isArray(ud.centerline) || ud.centerline.length < 20) {
      throw new Error('该文件不是本游戏导出的赛道文件（缺少赛道数据）');
    }
    const meta: TrackMeta = {
      id: crypto.randomUUID(),
      mode: ud.meta?.mode === 'complex' ? 'complex' : 'simple',
      seed: typeof ud.meta?.seed === 'number' ? ud.meta.seed : randomSeed(),
      createdAt: Date.now(),
      version: TRACK_VERSION,
    };
    return {
      meta,
      centerline: ud.centerline.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      glb: file,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
