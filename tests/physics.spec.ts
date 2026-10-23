import { describe, it } from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { CarPhysics, CHASSIS_SPAWN_HEIGHT } from '../src/physics/vehicle';
import { buildTrackForMode, check, createCarRig, resetRig } from './helpers';

const MODES = ['simple', 'complex'] as const;

describe('vehicle physics', () => {
  it.each(MODES)('%s: car settles on ground with all wheels in contact', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 120; i++) {
      rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    const settled = rig.physics.getState().position.y;
    check('car does not fall through ground', settled > rig.start.y - 1, `settled y=${settled.toFixed(2)}, ground y=${rig.start.y.toFixed(2)}`);
    const vehicle = (rig.physics as unknown as { vehicle: CANNON.RaycastVehicle }).vehicle;
    check('all four wheels contact ground', vehicle.numWheelsOnGround === 4, `wheels=${vehicle.numWheelsOnGround}`);
    rig.physics.dispose();
  });

  it.each(MODES)('%s: throttle + full steering does not roll over (user flip regression)', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    // 场景：从静止全油门 + 满舵持续转圈 4s——2026-10-23 前轴抓地 10（≈2.8g，超倾翻阈 1.8g）时必翻
    let minUp = 1;
    for (let i = 0; i < 240; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: 1 }, 1 / 60);
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    check('no rollover: throttle + full steering from standstill', minUp > 0.85, `min up.y=${minUp.toFixed(3)}`);
    rig.physics.dispose();
  });

  it.each(MODES)('%s: S-switch while driving responds and does not roll over', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    // 先直线加速到中高速（~28m/s），再做 S 变向（左 1.5s → 右 1.5s）：贴近玩家真实节奏；
    // 满舵 S 在 40m/s+ 时任何车都会横向滑出路面（撞护栏贴墙属正常物理，不能作为“S 不响应”判据），故限速进入
    for (let i = 0; i < 80; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    const entrySpeed = rig.physics.getState().absoluteSpeed;
    let minUp = 1;
    let sawLeftYaw = false;
    let sawRightYaw = false;
    for (let i = 0; i < 90; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: 1 }, 1 / 60);
      const yaw = rig.physics.getState().angularVelocity.y;
      if (yaw > 0.3) sawLeftYaw = true;
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    let switchResponded = false;
    for (let i = 0; i < 90; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: -1 }, 1 / 60);
      const yaw = rig.physics.getState().angularVelocity.y;
      if (yaw < -0.1) sawRightYaw = true;
      if (yaw < -0.4) switchResponded = true;
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    check(
      'S-switch: yaw reverses sign and no rollover',
      entrySpeed > 20 && sawLeftYaw && sawRightYaw && switchResponded && minUp > 0.85,
      `entry=${entrySpeed.toFixed(1)} leftYaw=${sawLeftYaw} rightYaw=${sawRightYaw} responded=${switchResponded} minUp=${minUp.toFixed(3)}`,
    );
    rig.physics.dispose();
  });

  it.each(MODES)('%s: respawn with throttle does not bounce or flip', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built);
    let minUp = 1;
    let maxHeight = 0;
    for (let i = 0; i < 180; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      const st = rig.physics.getState();
      minUp = Math.min(minUp, st.up.y);
      maxHeight = Math.max(maxHeight, st.position.y - rig.start.y);
    }
    // 复杂赛道有真实山丘，3s 内正常爬坡高度可达数米；只断言不翻车且高度不失控
    const heightLimit = mode === 'complex' ? 16 : 2.0;
    check('respawn no bounce/flip with throttle', minUp > 0.6 && maxHeight < heightLimit, `min up.y=${minUp.toFixed(3)} maxHeight=${maxHeight.toFixed(2)}m`);
    rig.physics.dispose();
  });

  it.each(MODES)('%s: drives forward on throttle', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const driveStart = rig.physics.getState().position.clone();
    for (let i = 0; i < 120; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    const driveEnd = rig.physics.getState().position.clone();
    const forward = new CANNON.Vec3(rig.tangent.x, 0, rig.tangent.z);
    const delta = new CANNON.Vec3(driveEnd.x - driveStart.x, 0, driveEnd.z - driveStart.z);
    const forwardProgress = delta.dot(forward);
    check('car drives forward on throttle', forwardProgress > 3, `forward progress=${forwardProgress.toFixed(2)}m`);
    rig.physics.dispose();
  });

  it.each(MODES)('%s: steering turns the car', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const h0 = Math.atan2(rig.physics.getState().forward.x, rig.physics.getState().forward.z);
    for (let i = 0; i < 90; i++) rig.physics.update({ throttle: 0.8, brake: 0, steering: 1 }, 1 / 60);
    const h1 = Math.atan2(rig.physics.getState().forward.x, rig.physics.getState().forward.z);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    check('steering turns the car', dh > 0.02, `heading change=${dh.toFixed(3)}rad (steering=1 = left)`);
    rig.physics.dispose();
  });

  it.each(MODES)('%s: stable at full lock', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 90; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    let minUp = 1;
    for (let i = 0; i < 90; i++) {
      rig.physics.update({ throttle: 0.7, brake: 0, steering: 1 }, 1 / 60);
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    check('stable at full lock', minUp > 0.8, `min up.y=${minUp.toFixed(3)}`);
    rig.physics.dispose();
  });

  it.each(MODES)('%s: no forward flip when braking at speed', (mode) => {
    const built = buildTrackForMode(mode);
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 108; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    let minUp = 1;
    for (let i = 0; i < 180; i++) {
      rig.physics.update({ throttle: 0, brake: 1, steering: 0 }, 1 / 60);
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    check('no forward flip when braking at speed', minUp > 0.6, `min up.y=${minUp.toFixed(3)}`);
    rig.physics.dispose();
  });

  it('simple: steering authority falls with speed (no corner speed wall)', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 120; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    // 速度敏感转向曲线：低速角大（0.65 rad），高速角小（0.12 rad），中间单调衰减
    check('steer curve falls with speed', rig.physics.maxSteerAt(0) === 0.65
      && rig.physics.maxSteerAt(5) > rig.physics.maxSteerAt(25)
      && rig.physics.maxSteerAt(25) > rig.physics.maxSteerAt(45)
      && rig.physics.maxSteerAt(45) === 0.12, `low=${rig.physics.maxSteerAt(0)} mid=${rig.physics.maxSteerAt(25)} high=${rig.physics.maxSteerAt(45)}`);
    // 满舵入弯瞬间不再触发“50km/h 限速墙”（旧逻辑会在 0.2s 内把速度压到 50 以下）
    for (let i = 0; i < 12; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 1 }, 1 / 60);
    const entrySpeed = rig.physics.getState().absoluteSpeed;
    check('no instant corner wall at full lock', entrySpeed > 25, `speed=${(entrySpeed * 3.6).toFixed(0)}km/h`);
    rig.physics.dispose();
  });

  it('simple: 0-100km/h in ~1.5s', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    let accelSteps = 0;
    for (let i = 0; i < 600; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      if (rig.physics.getState().absoluteSpeed >= 27.78) {
        accelSteps = i + 1;
        break;
      }
    }
    check('0-100km/h in ~1.5s', accelSteps > 55 && accelSteps < 120, `time=${(accelSteps / 60).toFixed(1)}s`);
    rig.physics.dispose();
  });

  it('simple: steady full-lock cornering at speed stays stable and recovers', () => {
    const built = buildTrackForMode('simple');
    // 无护栏：避开弯道护栏干扰
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    // 拉到高速（120 帧 ≈ 2s），再满舵稳态过弯
    for (let i = 0; i < 120; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 90; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 1 }, 1 / 60);
    const st = rig.physics.getState();
    check('no rollover in steady full-lock corner', st.up.y > 0.6, `up=${st.up.y.toFixed(3)}`);
    // 稳态推头（understeer）：车身贴轨迹，不会自旋甩飞
    const slip = rig.physics.getSlipAngle();
    check('no spin-out in steady full-lock corner', slip < 0.3, `slip=${slip.toFixed(3)}rad`);
    // 松开转向与油门：侧滑抑制接管，车身回正
    for (let i = 0; i < 60; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const afterRelease = rig.physics.getSlipAngle();
    check('car recovers after releasing steering', afterRelease < 0.1, `slip=${afterRelease.toFixed(3)}rad`);
    rig.physics.dispose();
  });

  it('simple: coasting is slow, coasting with steering decelerates fast', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    const coastReset = (): void => {
      resetRig(rig);
      for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      for (let i = 0; i < 120; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    };
    coastReset();
    for (let i = 0; i < 240; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const plainCoast = rig.physics.getState().absoluteSpeed;
    check('plain coast is slow', plainCoast > 20, `after 4s=${(plainCoast * 3.6).toFixed(0)}km/h`);
    coastReset();
    for (let i = 0; i < 240; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 1 }, 1 / 60);
    const steerCoast = rig.physics.getState().absoluteSpeed;
    check('coast with steering decelerates fast', steerCoast < 5, `after 4s=${(steerCoast * 3.6).toFixed(0)}km/h`);
    rig.physics.dispose();
  });

  it('simple: no forward flip at speed', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    let minUp = 1;
    for (let i = 0; i < 120; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    for (let i = 0; i < 240; i++) {
      rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    check('no forward flip at speed', minUp > 0.5, `min up.y=${minUp.toFixed(3)}`);
    rig.physics.dispose();
  });

  it('simple: reverse acceleration boosted and top speed limited', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 60; i++) rig.physics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
    const reverse1s = -rig.physics.getState().forwardSpeed;
    check('reverse acceleration boosted', reverse1s > 4 && reverse1s < 8.8, `reverse speed after 1s=${reverse1s.toFixed(2)} m/s`);
    for (let i = 0; i < 120; i++) rig.physics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
    const reverseTop = -rig.physics.getState().forwardSpeed;
    check('reverse top speed limited', reverseTop < 8.8, `reverse top speed=${reverseTop.toFixed(2)} m/s`);
    rig.physics.dispose();
  });

  it('simple: reverse with steering caps at 10m/s', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 180; i++) rig.physics.update({ throttle: -1, brake: 0, steering: 1 }, 1 / 60);
    const abs = rig.physics.getState().absoluteSpeed;
    const fwd = -rig.physics.getState().forwardSpeed;
    check(
      'reverse with steering caps at 10m/s',
      abs > 9 && abs < 10.8 && fwd < 10.8,
      `reverse+turn abs=${abs.toFixed(2)}m/s fwd=${fwd.toFixed(2)}m/s`,
    );
    rig.physics.dispose();
  });

  it('simple: releasing reverse stops quickly (unlike forward coasting)', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 90; i++) rig.physics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
    const reverseBefore = -rig.physics.getState().forwardSpeed;
    check('reverse reached speed before release', reverseBefore > 2, `reverse=${reverseBefore.toFixed(2)} m/s`);
    for (let i = 0; i < 90; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const afterRelease = rig.physics.getState().forwardSpeed;
    check('reverse release stops quickly', afterRelease > -1.0, `after release=${afterRelease.toFixed(2)} m/s`);
    rig.physics.dispose();
  });

  it('simple: AWD drives all four wheels (front = half share, additive); reverse+turn boosts to full', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    const vehicle = (rig.physics as unknown as { vehicle: CANNON.RaycastVehicle }).vehicle;
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    const share = vehicle.wheelInfos.map((w) => Math.abs(w.engineForce));
    check(
      'awd: all four wheels driven, front per-wheel = 0.5 × rear',
      share.every((s) => s > 1000) && share[0] === share[1] && share[2] === share[3]
        && Math.abs(share[0] - 0.5 * share[2]) < 1,
      `wheel forces=[${share.map((s) => s.toFixed(0)).join(' / ')}]`,
    );
    rig.physics.update({ throttle: -1, brake: 0, steering: 1 }, 1 / 60);
    const boost = vehicle.wheelInfos.map((w) => Math.abs(w.engineForce));
    check(
      'awd: reverse+turn boosts front axle to full force',
      Math.min(...boost) > share[0] * 1.9 && Math.abs(boost[3] - share[2]) < 1,
      `boost=[${boost.map((s) => s.toFixed(0)).join(' / ')}] share=[${share[0].toFixed(0)}/${share[2].toFixed(0)}]`,
    );
    rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    const afterBoost = vehicle.wheelInfos.map((w) => Math.abs(w.engineForce));
    check(
      'awd: no stale reverse-turn force leaks into next forward frame',
      afterBoost.every((s, i) => Math.abs(s - share[i]) < 1),
      `afterBoost=[${afterBoost.map((s) => s.toFixed(0)).join(' / ')}]`,
    );
    rig.physics.dispose();
  });

  it('simple: flat-road top speed 144~202km/h', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 720; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    const topSpeed = rig.physics.getState().absoluteSpeed;
    check('flat-road top speed 144~202km/h', topSpeed > 40 && topSpeed < 56.2, `top=${(topSpeed * 3.6).toFixed(0)}km/h`);
    rig.physics.dispose();
  });

  it('simple: barrier contains car in high-speed turn', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    let maxLateral = 0;
    for (let i = 0; i < 120; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: -1 }, 1 / 60);
      if (i % 6 === 0) {
        const p = rig.physics.getState().position;
        let best = Infinity;
        for (const pt of built.points) {
          const d = (p.x - pt.x) * (p.x - pt.x) + (p.z - pt.z) * (p.z - pt.z);
          if (d < best) best = d;
        }
        maxLateral = Math.max(maxLateral, Math.sqrt(best));
      }
    }
    const barrierLine = Math.max(...built.halfWidths) + 0.6;
    check('barrier contains car in high-speed turn', maxLateral < barrierLine + 1.6, `max lateral=${maxLateral.toFixed(2)}m`);
    rig.physics.dispose();
  });

  it('complex: no upward launch on hills', () => {
    const built = buildTrackForMode('complex');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    let maxAir = 0;
    let maxFall = 0;
    for (let i = 0; i < 360; i++) {
      rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      const st = rig.physics.getState();
      const groundY = built.terrain!.sample(st.position.x, st.position.z);
      maxAir = Math.max(maxAir, st.position.y - groundY);
      maxFall = Math.min(maxFall, st.velocity.y);
    }
    // 该用例无护栏、直行全油门：约 4.5s 后已脱离赛道在野地高速行驶；
    // 飞起后必须受重力下落（出现明显的向下速度），幅度有界防止失控
    check('airborne car falls under gravity', maxFall < -2, `max fall speed=${maxFall.toFixed(2)}m/s`);
    check('no unbounded flying', maxAir < 4.5, `max air height=${maxAir.toFixed(2)}m`);
    rig.physics.dispose();
  });

  it('complex: climbs steep slopes with throttle (no rollback, no rear lift)', () => {
    const built = buildTrackForMode('complex');
    // 找坡度最大的上坡段
    let bestIdx = 0;
    let bestSlope = 0;
    for (let i = 0; i < built.points.length; i++) {
      const j = (i + 1) % built.points.length;
      const dy = built.points[j].y - built.points[i].y;
      const ds = built.points[i].distanceTo(built.points[j]);
      const slope = dy / Math.max(0.01, ds);
      if (slope > bestSlope) {
        bestSlope = slope;
        bestIdx = i;
      }
    }
    check('found uphill section', bestSlope > 0.06, `max slope=${(bestSlope * 100).toFixed(1)}%`);

    const physics = new CarPhysics();
    physics.addGround(built.physics.ground);
    const p = built.points[bestIdx];
    const tangent = built.tangents[bestIdx].clone();
    tangent.y = 0;
    tangent.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    physics.reset(
      new CANNON.Vec3(p.x, p.y + CHASSIS_SPAWN_HEIGHT, p.z),
      new CANNON.Quaternion(q.x, q.y, q.z, q.w),
    );
    for (let i = 0; i < 30; i++) physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    let minUp = 1;
    let maxBack = 0;
    const vehicle = (physics as unknown as { vehicle: CANNON.RaycastVehicle }).vehicle;
    let climbingFramesAir = 0;
    const climbWindow = 50;
    for (let i = 0; i < 180; i++) {
      physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      if (i < climbWindow && vehicle.numWheelsOnGround < 3) climbingFramesAir++;
      const st = physics.getState();
      minUp = Math.min(minUp, st.up.y);
      maxBack = Math.max(maxBack, -st.forwardSpeed);
    }
    const finalSpeed = physics.getState().forwardSpeed;
    check('accelerates uphill (no rollback)', finalSpeed > 3, `speed=${finalSpeed.toFixed(2)} m/s, maxBack=${maxBack.toFixed(2)}`);
    check('no backward roll on uphill', maxBack < 1.0, `maxBack=${maxBack.toFixed(2)} m/s`);
    check('no flip on uphill', minUp > 0.7, `min up.y=${minUp.toFixed(3)}`);
    // 冲过坡顶后自然飞起不算问题（小车更早冲出最陡段进入弹跳）；
    // 爬坡启动段（前 50 帧 ≈ 0~12m/s）≥3 轮着地的帧占比 ≥70%（偶发过脊弹跳不算爬坡失败）
    const climbingRatio = 1 - climbingFramesAir / climbWindow;
    check('wheels stay on ground while climbing', climbingRatio >= 0.7, `groundRatio=${(climbingRatio * 100).toFixed(0)}%`);
    physics.dispose();
  });

  it('simple: rapid steering switch does not roll over and returns slowly', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 240; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    let minUp = 1;
    for (let i = 0; i < 180; i++) {
      const steering = Math.floor(i / 8) % 2 === 0 ? 1 : -1;
      rig.physics.update({ throttle: 0.7, brake: 0, steering }, 1 / 60);
      minUp = Math.min(minUp, rig.physics.getState().up.y);
    }
    check('no rollover on rapid steering switch', minUp > 0.5, `min up.y=${minUp.toFixed(3)}`);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 1 }, 1 / 60);
    const steerAtRelease = Math.abs(rig.physics.getSteering());
    rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 8; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const steerAt015s = Math.abs(rig.physics.getSteering());
    for (let i = 0; i < 64; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const steerAt12s = Math.abs(rig.physics.getSteering());
    check(
      'steering returns to center in flight (0.15s) and settles by 1.2s',
      steerAt015s < steerAtRelease && steerAt015s > 0.02 && steerAt12s < 0.05,
      `release=${steerAtRelease.toFixed(2)} at0.15s=${steerAt015s.toFixed(2)} at1.2s=${steerAt12s.toFixed(2)}`,
    );
    rig.physics.dispose();
  });
});
