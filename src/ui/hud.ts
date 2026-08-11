import { fmtTime } from '../utils/format';

export interface HudData {
  speedKmh: number;
  elapsedMs: number;
  timePenaltyMs: number;
  distancePenaltyM: number;
}

export interface HudResult {
  lapTimeMs: number;
  timePenaltyMs: number;
  distancePenaltyM: number;
}

export interface HudRefs {
  minimap: HTMLCanvasElement;
  update(data: HudData): void;
  showPause(paused: boolean): void;
  showResult(result: HudResult): void;
  onBack(cb: () => void): void;
  onRestart(cb: () => void): void;
}

export function createHUD(container: HTMLElement): HudRefs {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="hud">
      <div class="hud-panel hud-top-left">
        <div class="hud-row"><span class="hud-label">速度</span><span id="hud-speed">0 km/h</span></div>
        <div class="hud-row"><span class="hud-label">用时</span><span id="hud-time">00:00.00</span></div>
        <div class="hud-row hud-penalty"><span class="hud-label">惩罚</span><span id="hud-penalty">+0s</span></div>
      </div>
      <button id="hud-back" class="btn hud-back">返回首页</button>
      <canvas id="hud-minimap" class="hud-minimap" width="230" height="230"></canvas>
      <div class="hud-hint">WASD / 方向键 驾驶　·　空格 暂停</div>
      <div id="pause-overlay" class="hud-overlay hidden">
        <div class="overlay-box"><h2>已暂停</h2><p>按 空格 继续</p></div>
      </div>
      <div id="result-overlay" class="hud-overlay hidden">
        <div class="overlay-box">
          <h2>单圈完成</h2>
          <p class="result-time" id="result-time">00:00.00</p>
          <p id="result-penalty" class="result-penalty"></p>
          <div class="overlay-actions">
            <button id="result-restart" class="btn">再来一局</button>
            <button id="result-back" class="btn">返回首页</button>
          </div>
        </div>
      </div>
    </div>
    `,
  );

  const speedEl = container.querySelector<HTMLElement>('#hud-speed')!;
  const timeEl = container.querySelector<HTMLElement>('#hud-time')!;
  const penaltyEl = container.querySelector<HTMLElement>('#hud-penalty')!;
  const pauseEl = container.querySelector<HTMLElement>('#pause-overlay')!;
  const resultEl = container.querySelector<HTMLElement>('#result-overlay')!;
  const minimap = container.querySelector<HTMLCanvasElement>('#hud-minimap')!;
  const backBtn = container.querySelector<HTMLButtonElement>('#hud-back')!;
  const resultTimeEl = container.querySelector<HTMLElement>('#result-time')!;
  const resultPenaltyEl = container.querySelector<HTMLElement>('#result-penalty')!;

  let backCb: (() => void) | null = null;
  let restartCb: (() => void) | null = null;

  backBtn.addEventListener('click', () => backCb?.());
  container.querySelector('#result-back')!.addEventListener('click', () => backCb?.());
  container.querySelector('#result-restart')!.addEventListener('click', () => restartCb?.());

  return {
    minimap,
    update({ speedKmh, elapsedMs, timePenaltyMs, distancePenaltyM }) {
      speedEl.textContent = `${Math.round(speedKmh)} km/h`;
      timeEl.textContent = fmtTime(elapsedMs);
      const parts: string[] = [];
      if (timePenaltyMs > 0) parts.push(`+${(timePenaltyMs / 1000).toFixed(1)}s`);
      if (distancePenaltyM > 0.5) parts.push(`距离 -${distancePenaltyM.toFixed(1)}m`);
      penaltyEl.textContent = parts.length ? parts.join('  ') : '+0s';
    },
    showPause(paused) {
      pauseEl.classList.toggle('hidden', !paused);
    },
    showResult(result) {
      resultTimeEl.textContent = fmtTime(result.lapTimeMs);
      const parts: string[] = [];
      if (result.timePenaltyMs > 0) parts.push(`时间惩罚 +${(result.timePenaltyMs / 1000).toFixed(1)}s`);
      if (result.distancePenaltyM > 0.5) parts.push(`距离惩罚 -${result.distancePenaltyM.toFixed(1)}m`);
      resultPenaltyEl.textContent = parts.length ? parts.join('　·　') : '无惩罚';
      resultEl.classList.remove('hidden');
    },
    onBack(cb) {
      backCb = cb;
    },
    onRestart(cb) {
      restartCb = cb;
    },
  };
}
