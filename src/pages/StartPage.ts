import * as THREE from 'three';
import { TRACK_VERSION } from '../config';
import { getLeaderboard, loadActiveTrack, loadLocalPreset, replaceActiveTrack, saveLocalPreset } from '../storage/db';
import { loadSettings, saveCarColor, savePlayerName, saveTrackMode, saveTrackPreset } from '../storage/settings';
import { buildTrack, generateCenterlinePoints } from '../track/generator';
import { PRESET_TRACKS, getPresetTrack } from '../track/presets';
import { downloadBlob, exportTrackToBlob, importTrackFromFile } from '../track/gltf';
import type { BuiltTrack } from '../track/generator';
import { TrackPreview } from '../ui/TrackPreview';
import { showConfirmDialog } from '../ui/confirmDialog';
import type { LocalPresetEntry, TrackMode, TrackPackage } from '../types';
import { fmtTime } from '../utils/format';
import { randomPlayerName, randomSeed } from '../utils/random';

const MODE_LABEL: Record<TrackMode, string> = {
  preset: '预设',
  simple: '简单',
  complex: '复杂',
};

export function mountStartPage(root: HTMLElement): () => void {
  root.innerHTML = `
    <div id="preview-background" class="preview-background"></div>
    <div class="page-overlay"></div>
    <div class="page start-page">
      <header class="start-header">
        <h1>极速赛道 Racing</h1>
        <p>three.js 代码生成 · 单圈计时赛</p>
      </header>
      <div class="start-grid">
        <section class="panel">
          <h2>开始游戏</h2>
          <label class="field">
            <span>玩家名称</span>
            <input id="player-name" type="text" maxlength="12" placeholder="请输入名称" />
          </label>
          <label class="field">
            <span>汽车颜色</span>
            <input id="car-color" type="color" />
          </label>
          <button id="btn-start" class="btn btn-primary">开始游戏</button>
        </section>

        <section class="panel">
          <h2>当前赛道</h2>
          <div id="track-info" class="track-info">加载中…</div>
          <label class="field">
            <span>赛道模式（点击重新生成时生效）</span>
            <select id="track-mode">
              <option value="preset">预设赛道（固定布局）</option>
              <option value="simple">自定义 · 简单</option>
              <option value="complex">自定义 · 复杂</option>
            </select>
          </label>
          <label class="field" id="preset-field">
            <span>预设赛道（点击重新生成时生效）</span>
            <select id="track-preset"></select>
          </label>
          <div class="track-actions">
            <button id="btn-regenerate" class="btn">重新生成赛道</button>
            <button id="btn-preview" class="btn">赛道 / 赛车预览</button>
            <button id="btn-export" class="btn">导出赛道</button>
            <button id="btn-import" class="btn">导入赛道</button>
            <button id="btn-import-preset" class="btn">本地文件预设</button>
            <input id="file-import" type="file" accept=".glb,.gltf" hidden />
            <input id="file-import-preset" type="file" accept=".glb,.gltf" hidden />
          </div>
          <p class="hint">重新生成/切换预设会清除当前赛道的排行榜；「本地文件预设」把导入的赛道注册为可复选预设（可没有）</p>
        </section>

        <section class="panel">
          <h2>排行榜（当前赛道）</h2>
          <div id="leaderboard" class="leaderboard">加载中…</div>
        </section>
      </div>
      <footer class="start-footer">
        来源：<a href="https://github.com/monon98/racing-games" target="_blank" rel="noreferrer">github.com/monon98/racing-games</a>
      </footer>
      <div id="toast" class="toast hidden"></div>
    </div>
  `;

  const nameInput = root.querySelector<HTMLInputElement>('#player-name')!;
  const colorInput = root.querySelector<HTMLInputElement>('#car-color')!;
  const modeSelect = root.querySelector<HTMLSelectElement>('#track-mode')!;
  const presetSelect = root.querySelector<HTMLSelectElement>('#track-preset')!;
  const presetField = root.querySelector<HTMLLabelElement>('#preset-field')!;
  const trackInfo = root.querySelector<HTMLElement>('#track-info')!;
  const leaderboardEl = root.querySelector<HTMLElement>('#leaderboard')!;
  const toastEl = root.querySelector<HTMLElement>('#toast')!;
  const fileInput = root.querySelector<HTMLInputElement>('#file-import')!;
  const previewContainer = root.querySelector<HTMLElement>('#preview-background')!;

  let current: TrackPackage | null = null;
  let currentBuilt: BuiltTrack | null = null;
  let preview: TrackPreview | null = null;
  let toastTimer = 0;

  function toast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  /** 根据设置当前选择的模式/预设生成新赛道包；preset 用固定 seed 使环境稳定 */
  async function createNewTrack(mode: TrackMode, presetId?: string): Promise<TrackPackage> {
    const preset = mode === 'preset' ? getPresetTrack(presetId) : null;
    const meta = {
      id: crypto.randomUUID(),
      mode,
      presetId: preset ? preset.id : null,
      seed: preset ? preset.seed : randomSeed(),
      createdAt: Date.now(),
      version: TRACK_VERSION,
    };
    const points = generateCenterlinePoints(meta);
    const built = buildTrack(meta, points);
    const glb = await exportTrackToBlob(built);
    return {
      meta,
      centerline: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      glb,
    };
  }

  /** 预设下拉补上（或移除）“本地文件预设”选项；本地预设可能不存在 */
  async function syncLocalPresetOption(): Promise<void> {
    const local = await loadLocalPreset();
    presetSelect.querySelectorAll('option[data-local]').forEach((o) => o.remove());
    if (local) {
      const opt = document.createElement('option');
      opt.value = local.id;
      opt.dataset.local = '1';
      opt.textContent = `本地预设 · ${local.fileName}`;
      presetSelect.appendChild(opt);
    }
    // 校正下拉值与存档：存的本地预设被删除时回落到第一个内置预设
    if (presetSelect.value || loadSettings().trackPresetId.startsWith('local-')) {
      if (!local || loadSettings().trackPresetId !== presetSelect.value) {
        const settings = loadSettings();
        const wanted = !local && settings.trackPresetId.startsWith('local-') ? PRESET_TRACKS[0].id : settings.trackPresetId;
        presetSelect.value = wanted;
        if (modeSelect.value === 'preset') saveTrackPreset(presetSelect.value);
      }
    }
  }

  /** 把本地预设包激活为当前赛道：复制为新 id（与“重新生成一致”，清榜） */
  async function activateLocalPreset(entry: LocalPresetEntry): Promise<TrackPackage> {
    const pkg: TrackPackage = {
      meta: { ...entry.pkg.meta, id: crypto.randomUUID(), createdAt: Date.now() },
      centerline: entry.pkg.centerline,
      glb: entry.pkg.glb,
    };
    await replaceActiveTrack(pkg);
    return pkg;
  }

  /** 导入本地文件并注册为预设（存储在 IndexedDB presets store，随时可无本地文件） */
  async function registerLocalPreset(file: File): Promise<void> {
    try {
      const filePkg = await importTrackFromFile(file);
      const entry: LocalPresetEntry = {
        id: `local-${crypto.randomUUID()}`,
        fileName: file.name,
        createdAt: Date.now(),
        pkg: filePkg,
      };
      await saveLocalPreset(entry);
      await syncLocalPresetOption();
      presetSelect.value = entry.id;
      saveTrackPreset(entry.id);
      toast(`已注册本地预设「${file.name}」，点击重新生成即可使用`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败');
    }
  }

  async function refreshTrack(): Promise<void> {
    current = (await loadActiveTrack()) ?? null;
    if (!current) {
      const settings = loadSettings();
      current = await createNewTrack(settings.trackMode, settings.trackPresetId);
      await replaceActiveTrack(current);
    }
    await syncLocalPresetOption();
    currentBuilt = buildTrack(current.meta, current.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    ensurePreview();
    renderTrackInfo();
    await renderLeaderboard();
  }

  function ensurePreview(): void {
    if (!currentBuilt) return;
    if (preview) {
      preview.setTrack(currentBuilt);
    } else {
      try {
        preview = new TrackPreview(previewContainer, currentBuilt, loadSettings().carColor);
      } catch {
        previewContainer.innerHTML = '<p class="empty">当前环境不支持 WebGL 预览</p>';
      }
    }
  }

  function renderTrackInfo(): void {
    if (!current) return;
    const m = current.meta;
    const date = new Date(m.createdAt).toLocaleString();
    const modeValue =
      m.mode === 'preset'
        ? m.presetId?.startsWith('local-')
          ? '预设 · 本地文件'
          : `预设 · ${getPresetTrack(m.presetId).name}`
        : MODE_LABEL[m.mode];
    trackInfo.innerHTML = `
      <div class="info-line"><span>模式</span><b>${modeValue}</b></div>
      <div class="info-line"><span>种子</span><b>${m.seed}</b></div>
      <div class="info-line"><span>创建时间</span><b>${date}</b></div>
      <div class="info-line"><span>数据版本</span><b>v${m.version}</b></div>
    `;
  }

  async function renderLeaderboard(): Promise<void> {
    if (!current) {
      leaderboardEl.textContent = '暂无赛道';
      return;
    }
    const entries = await getLeaderboard(current.meta.id);
    if (entries.length === 0) {
      leaderboardEl.innerHTML = '<p class="empty">暂无记录，快去跑一圈吧</p>';
      return;
    }
    const rows = entries
      .map(
        (e, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(e.playerName)}</td>
          <td>${fmtTime(e.lapTimeMs)}</td>
          <td>${new Date(e.date).toLocaleDateString()}</td>
        </tr>`,
      )
      .join('');
    leaderboardEl.innerHTML = `
      <table class="leaderboard-table">
        <thead><tr><th>#</th><th>玩家</th><th>用时</th><th>日期</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  }

  async function regenerate(mode: TrackMode, presetId?: string): Promise<void> {
    const local = mode === 'preset' && presetId?.startsWith('local-') ? await loadLocalPreset() : null;
    const preset = mode === 'preset' ? getPresetTrack(presetId) : null;
    const trackDesc = local
      ? `本地预设「${local.fileName}」`
      : preset
        ? `预设赛道「${preset.name}」`
        : `“${MODE_LABEL[mode]}”模式的自定义赛道`;
    const ok = await showConfirmDialog({
      title: '重新生成赛道',
      message: `将生成${trackDesc}，并清除当前赛道的排行榜。是否继续？`,
      confirmText: '重新生成',
      danger: true,
    });
    if (!ok) return;
    // 本地文件预设：从 IndexedDB 取存档包激活（新 id 与重新生成一致，均清榜）
    const pkg = local
      ? await activateLocalPreset(local)
      : await createNewTrack(mode, presetId);
    await replaceActiveTrack(pkg);
    current = pkg;
    currentBuilt = buildTrack(pkg.meta, pkg.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    ensurePreview();
    renderTrackInfo();
    await renderLeaderboard();
    toast('已重新生成赛道，排行榜已清除');
  }

  function init(): void {
    const settings = loadSettings();
    nameInput.value = settings.playerName;
    colorInput.value = settings.carColor;
    // 预设下拉由数据驱动生成（后续新增预设自动出现）
    for (const p of PRESET_TRACKS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}（${p.description}）`;
      presetSelect.appendChild(opt);
    }
    modeSelect.value = settings.trackMode;
    presetSelect.value = settings.trackPresetId;
    presetField.hidden = modeSelect.value !== 'preset';

    nameInput.addEventListener('change', () => savePlayerName(nameInput.value.trim()));
    colorInput.addEventListener('input', () => {
      saveCarColor(colorInput.value);
      preview?.setColor(colorInput.value);
    });
    modeSelect.addEventListener('change', () => {
      saveTrackMode(modeSelect.value as TrackMode);
      presetField.hidden = modeSelect.value !== 'preset';
    });
    presetSelect.addEventListener('change', () => saveTrackPreset(presetSelect.value));

    // 本地文件预设：注册后出现在预设下拉；本地无文件也能正常使用内置预设
    const filePresetInput = root.querySelector<HTMLInputElement>('#file-import-preset')!;
    document.querySelector('#btn-import-preset')!.addEventListener('click', () => filePresetInput.click());
    filePresetInput.addEventListener('change', () => {
      const file = filePresetInput.files?.[0];
      filePresetInput.value = '';
      if (!file) return;
      void registerLocalPreset(file);
    });

    document.querySelector('#btn-start')!.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        const defaultName = randomPlayerName();
        nameInput.value = defaultName;
        savePlayerName(defaultName);
        toast(`玩家名称为空，已使用默认名称「${defaultName}」`);
      }
      window.location.hash = '#/game';
    });

    document.querySelector('#btn-preview')!.addEventListener('click', () => {
      window.location.hash = '#/preview';
    });

    document.querySelector('#btn-regenerate')!.addEventListener('click', () => {
      const mode = modeSelect.value as TrackMode;
      void regenerate(mode, mode === 'preset' ? presetSelect.value : undefined);
    });

    document.querySelector('#btn-export')!.addEventListener('click', () => {
      void (async () => {
        if (!current) {
          toast('暂无赛道可导出');
          return;
        }
        const points = current.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        const built = buildTrack(current.meta, points);
        const blob = await exportTrackToBlob(built);
        downloadBlob(blob, `racing-track-${current.meta.seed}.glb`);
        toast('赛道已导出');
      })();
    });

    document.querySelector('#btn-import')!.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      void (async () => {
        try {
          const pkg = await importTrackFromFile(file);
          await replaceActiveTrack(pkg);
          current = pkg;
          currentBuilt = buildTrack(pkg.meta, pkg.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
          ensurePreview();
          renderTrackInfo();
          await renderLeaderboard();
          toast('赛道导入成功，排行榜已清除');
        } catch (err) {
          toast(err instanceof Error ? err.message : '导入失败');
        }
      })();
    });
  }

  void refreshTrack();
  init();

  return () => {
    preview?.dispose();
    preview = null;
    root.innerHTML = '';
  };
}
