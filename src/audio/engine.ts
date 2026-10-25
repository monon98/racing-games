/**
 * WebAudio 合成音效（零依赖）：引擎声（双锯齿轻微失谐 + 三角次低音，音高随速度）、
 * 碰撞闷响（噪声爆点）、漂移啸叫（带通噪声）。静音设置走 localStorage。
 * 必须在用户手势内 init()（浏览器 autoplay 策略）。
 * Node / 无 AudioContext 环境（vitest）下所有方法安全 no-op。
 */

const STORAGE_KEY = 'racing-audio-muted';

/** 引擎振荡器的（频率倍率, 波形, 基础音量）组合 */
const ENGINE_LAYERS: ReadonlyArray<readonly [number, OscillatorType, number]> = [
  [1, 'sawtooth', 0.5],
  [1.995, 'sawtooth', 0.32],
  [0.5, 'triangle', 0.6],
];

export function readMutedPref(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMutedPref(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* 存储不可用时静音仅本次会话生效 */
  }
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private oscs: Array<{ osc: OscillatorNode; rate: number }> = [];
  private noiseBuffer: AudioBuffer | null = null;
  private driftGain: GainNode | null = null;
  private paused = false;
  private muted = readMutedPref();

  init(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(ctx.destination);

    // 引擎：多层振荡 → 低通 → 引擎增益
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 950;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    for (const [rate, type, base] of ENGINE_LAYERS) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60 * rate;
      const oscGain = ctx.createGain();
      oscGain.gain.value = base;
      osc.connect(oscGain);
      oscGain.connect(this.engineFilter);
      osc.start();
      this.oscs.push({ osc, rate });
    }

    // 白噪声缓存：漂移啸叫（循环带通）与碰撞爆点共用
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2100;
    band.Q.value = 1.4;
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0;
    band.connect(this.driftGain);
    this.driftGain.connect(this.master);
    const driftSource = ctx.createBufferSource();
    driftSource.buffer = this.noiseBuffer;
    driftSource.loop = true;
    driftSource.connect(band);
    driftSource.start();
  }

  /** 每帧更新：speed (m/s)、throttle (-1..1)、drifting 漂移状态 */
  update(speed: number, throttle: number, drifting: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineGain || !this.engineFilter || !this.driftGain) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const speedNorm = Math.min(1, Math.max(0, speed / 55.6));
    // 音高：怠速 60Hz → 极速 ≈225Hz，油门再抬 20%
    const base = 60 * (1 + speedNorm * 2.25) * (1 + Math.max(0, throttle) * 0.2);
    const t = ctx.currentTime;
    for (const { osc, rate } of this.oscs) {
      osc.frequency.setTargetAtTime(base * rate, t, 0.08);
    }
    const silent = this.paused || this.muted;
    const load = 0.05 + 0.05 * speedNorm + 0.06 * Math.max(0, throttle) + (drifting ? 0.02 : 0);
    this.engineGain.gain.setTargetAtTime(silent ? 0 : Math.min(0.17, load), t, 0.09);
    this.engineFilter.frequency.setTargetAtTime(750 + speedNorm * 1900 + Math.max(0, throttle) * 500, t, 0.12);
    this.driftGain.gain.setTargetAtTime(!silent && drifting ? 0.085 : 0, t, 0.12);
  }

  /** 碰撞闷响：impact = 接触法向冲击速度（m/s） */
  impact(impact: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || !this.master || this.muted || this.paused) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 140 + Math.min(220, impact * 2.4);
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    const peak = Math.min(0.5, 0.08 + impact * 0.012);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    src.start(t, 0, 0.25);
    src.stop(t + 0.26);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    writeMutedPref(muted);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    if (!this.ctx) return;
    void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.oscs = [];
    this.driftGain = null;
    this.noiseBuffer = null;
  }
}
