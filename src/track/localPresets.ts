import { importTrackFromUrl } from './gltf';
import type { TrackPackage } from '../types';

/**
 * 本地 GLB 预设：把本游戏导出的 .glb 放进 `public/presets/`，并在同目录
 * `index.json` 里登记文件名（HTTP 无法列目录）。可以一个都不放——清单缺失
 * 或为空时本地预设列表就是空的，内置预设照常工作。
 */
const LOCAL_PRESETS_DIR = 'presets';

export interface LocalPresetInfo {
  /** 稳定 ID（由文件名派生）：`local-<去扩展名安全化文件名>` */
  id: string;
  fileName: string;
  url: string;
}

function base(): string {
  // vite BASE_URL：本地 './'，GitHub Pages '/racing-games/'
  const b = import.meta.env.BASE_URL;
  return b.endsWith('/') ? b : `${b}/`;
}

/** 文件名 → 稳定预设 ID（同名文件在多次部署间保持同一 ID） */
export function localPresetIdFor(fileName: string): string {
  const baseName = fileName
    .replace(/\.(glb|gltf)$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `local-${baseName}`;
}

/** 读取本地预设清单（缺失/读取失败/非法格式都视为空列表） */
export async function listLocalPresets(): Promise<LocalPresetInfo[]> {
  try {
    const res = await fetch(`${base()}${LOCAL_PRESETS_DIR}/index.json`);
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: unknown };
    if (!Array.isArray(data.files)) return [];
    return data.files
      .filter((f): f is string => typeof f === 'string' && /\.(glb|gltf)$/i.test(f))
      .map((fileName) => ({
        id: localPresetIdFor(fileName),
        fileName,
        url: `${base()}${LOCAL_PRESETS_DIR}/${encodeURIComponent(fileName)}`,
      }));
  } catch {
    return [];
  }
}

/** 加载本地预设赛道：meta 覆盖为 preset 模式 + 稳定 presetId/seed（环境布局稳定） */
export async function loadLocalPresetTrack(info: LocalPresetInfo): Promise<TrackPackage> {
  const pkg = await importTrackFromUrl(info.url);
  return {
    ...pkg,
    // 激活时再分配新 id（StartPage 负责）；seed 固定 0 保证本地预设环境确定性
    meta: { ...pkg.meta, mode: 'preset', presetId: info.id, seed: 0 },
  };
}
