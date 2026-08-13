import * as THREE from 'three';
import { TRACK_VERSION } from '../config';
import { loadActiveTrack, saveActiveTrack } from '../storage/db';
import { loadSettings } from '../storage/settings';
import { buildTrack, generateCenterlinePoints } from '../track/generator';
import { TrackPreview } from '../ui/TrackPreview';
import type { TrackMeta } from '../types';
import { randomSeed } from '../utils/random';

/** 赛道/赛车预览页：自由镜头（旋转/平移/缩放）查看当前赛道与汽车 */
export function mountPreviewPage(root: HTMLElement): () => void {
  const container = document.createElement('div');
  container.className = 'preview-page';
  container.innerHTML = `
    <div class="preview-toolbar">
      <button id="preview-back" class="btn">返回首页</button>
      <button id="preview-view-car" class="btn">赛车</button>
      <button id="preview-view-scene" class="btn">整个场景</button>
      <span class="preview-title">赛道 / 赛车预览</span>
    </div>
    <div class="preview-hint">左键拖动：旋转 ｜ 右键拖动：平移 ｜ 滚轮：缩放</div>
  `;
  root.appendChild(container);

  let preview: TrackPreview | null = null;
  let disposed = false;

  container.querySelector('#preview-back')!.addEventListener('click', () => {
    window.location.hash = '#/start';
  });
  container.querySelector('#preview-view-car')!.addEventListener('click', () => preview?.setView('car'));
  container.querySelector('#preview-view-scene')!.addEventListener('click', () => preview?.setView('scene'));

  void (async () => {
    const settings = loadSettings();
    let pkg = await loadActiveTrack();
    if (disposed) return;
    if (!pkg) {
      const meta: TrackMeta = {
        id: crypto.randomUUID(),
        mode: settings.trackMode,
        seed: randomSeed(),
        createdAt: Date.now(),
        version: TRACK_VERSION,
      };
      const points = generateCenterlinePoints(meta);
      pkg = { meta, centerline: points.map((p) => ({ x: p.x, y: p.y, z: p.z })), glb: null };
      await saveActiveTrack(pkg);
    }
    if (disposed) return;
    const track = buildTrack(
      pkg.meta,
      pkg.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
    preview = new TrackPreview(container, track, settings.carColor, { freeCamera: true });
  })();

  return () => {
    disposed = true;
    preview?.dispose();
    root.removeChild(container);
  };
}
