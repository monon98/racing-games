import { it } from 'vitest';
import { buildTrackForMode, check, createCarRig } from './helpers';

const DT = 1 / 60;
/** 静止满锁角（MAX_STEER_SLOW）与基准 vmax（STEER_SLEW_VMAX） */
const FULL = 0.65;
const VMAX_STILL = 4.2;

function settle(rig: ReturnType<typeof createCarRig>): void {
  for (let i = 0; i < 30; i++) {
    rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, DT);
  }
}

it('steer trapezoid: soft entry, bounded step, prompt full lock without overshoot', () => {
  const rig = createCarRig(buildTrackForMode('simple'));
  settle(rig);

  const deltas: number[] = [];
  let reachedFullAt = -1;
  let maxStep = 0;
  let overshoot = false;
  let prev = rig.physics.getSteering();
  for (let i = 0; i < 30; i++) {
    rig.physics.update({ throttle: 0, brake: 0, steering: 1 }, DT);
    const s = rig.physics.getSteering();
    const step = Math.abs(s - prev);
    deltas.push(step);
    maxStep = Math.max(maxStep, step);
    prev = s;
    if (s > FULL + 1e-4) overshoot = true;
    if (reachedFullAt < 0 && s >= FULL - 0.001) reachedFullAt = i + 1;
  }
  // 软启动：首帧位移应远小于旧指数式的 7/s×dt×0.65 ≈ 0.076 rad（一帧猛跳）
  check('soft entry: first-frame delta < 0.012 rad (old exp ~0.076)', deltas[0]! < 0.012, `first=${deltas[0]!.toFixed(5)}rad`);
  // 步长上界：静止 vmax 未加成，任何一帧不得超过 vmax*dt（匀速中段正好打满）
  check('bounded step: <= vmax*dt', maxStep <= VMAX_STILL * DT + 1e-9, `maxStep=${maxStep.toFixed(5)} vdt=${(VMAX_STILL * DT).toFixed(5)}`);
  // 到达全锁：约 0.26s（梯形理论值 ~16 帧），既非瞬上也无旧指数长尾（旧 95% 需 ~26 帧）
  check('full lock promptly, not instantly', reachedFullAt >= 9 && reachedFullAt <= 20, `frames=${reachedFullAt}`);
  check('no overshoot beyond full lock', !overshoot);
  rig.physics.dispose();
});

it('steer trapezoid: flip monotonic through zero; recenter fast and tame', () => {
  const rig = createCarRig(buildTrackForMode('simple'));
  settle(rig);
  for (let i = 0; i < 30; i++) {
    rig.physics.update({ throttle: 0, brake: 0, steering: 1 }, DT);
  }

  // 换向：+满锁 → −满锁。过零应恒速单调（不再发黏），且不过冲越过 −目标
  let crossedAt = -1;
  let postCrossMax = 0;
  let monotonic = true;
  let prev = rig.physics.getSteering();
  for (let i = 0; i < 30; i++) {
    rig.physics.update({ throttle: 0, brake: 0, steering: -1 }, DT);
    const s = rig.physics.getSteering();
    if (s > prev + 1e-4) monotonic = false;
    if (crossedAt < 0 && s <= 0) {
      crossedAt = i + 1;
      postCrossMax = Math.abs(s);
    }
    prev = s;
  }
  // 容差 1e-4：静止残留速度让 maxSteerAt 目标微移（±1e-6 级抖），跟踪器如实追贴——
  // 当真"卡顿回跳"会是 ≥1e-3 级，1e-4 足以区分
  check('flip: crosses zero monotonic, no stutter', monotonic, `prevJump? (${monotonic})`);
  check('flip: zero crossing fast (turn-around not sticky)', crossedAt >= 1 && crossedAt <= 14, `crossedAfter=${crossedAt} frames`);
  check('flip: no overshoot past −full', prev < FULL + 1e-4 && Math.abs(prev + FULL) < 0.02, `end=${prev.toFixed(4)}`);
  check('flip: crossing step tame (no jump-through-zero)', postCrossMax <= VMAX_STILL * DT + 1e-9, `postCross=${postCrossMax.toFixed(5)}`);

  // 回正：松手 → 0。同样梯形：无旧"匀速冲到 0 再突停"，末帧步长任意帧内有界、单调收敛
  settleIntoFullThenRelease(rig);
  rig.physics.dispose();
});

function settleIntoFullThenRelease(rig: ReturnType<typeof createCarRig>): void {
  for (let i = 0; i < 30; i++) {
    rig.physics.update({ throttle: 0, brake: 0, steering: 1 }, DT);
  }
  check('recenter setup at full lock', Math.abs(rig.physics.getSteering() - FULL) < 0.02, `s=${rig.physics.getSteering().toFixed(4)}`);
  let monotonic = true;
  let lastStep = 0;
  let prev = rig.physics.getSteering();
  let settledAt = -1;
  for (let i = 0; i < 30; i++) {
    rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, DT);
    const s = rig.physics.getSteering();
    if (s > prev + 1e-4) monotonic = false;
    lastStep = Math.abs(s - prev);
    prev = s;
    if (settledAt < 0 && Math.abs(s) < 0.005) settledAt = i + 1;
  }
  check('recenter monotonic toward 0 (1e-4 tol, see flip note)', monotonic);
  check('recenter step stays bounded every frame', lastStep <= VMAX_STILL * DT + 1e-9, `last=${lastStep.toFixed(5)}`);
  check('recenter settles < 0.005 rad in ~0.3s (no sticky tail)', settledAt >= 1 && settledAt <= 20, `settledAfter=${settledAt} frames`);
}
