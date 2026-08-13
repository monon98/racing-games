import { describe, it } from 'vitest';
import * as CANNON from 'cannon-es';
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

  it('simple: turning caps speed ~50km/h', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 120; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 120; i++) rig.physics.update({ throttle: 0.8, brake: 0, steering: 1 }, 1 / 60);
    const turnSpeed = rig.physics.getState().absoluteSpeed;
    check('turning caps speed ~50km/h', turnSpeed < 17, `speed=${(turnSpeed * 3.6).toFixed(0)}km/h`);
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

  it('simple: full-lock jitter enters drift and recovers after release', () => {
    const built = buildTrackForMode('simple');
    const rig = createCarRig(built, true);
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 180; i++) rig.physics.update({ throttle: 1, brake: 0, steering: 1 }, 1 / 60);
    check('sustained full-lock with throttle enters drift', rig.physics.getDrifting());
    for (let i = 0; i < 30; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    check('drift clears after releasing steering', !rig.physics.getDrifting());
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
    rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 8; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const steerAt015s = Math.abs(rig.physics.getSteering());
    for (let i = 0; i < 64; i++) rig.physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    const steerAt12s = Math.abs(rig.physics.getSteering());
    check(
      'steering returns slowly to center',
      steerAt015s > 0.2 && steerAt12s < 0.05,
      `at0.15s=${steerAt015s.toFixed(2)} at1.2s=${steerAt12s.toFixed(2)}`,
    );
    rig.physics.dispose();
  });
});
