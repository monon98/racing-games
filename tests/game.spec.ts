import { expect, it } from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR, TRACK_VERSION } from '../src/config';
import { updateLapProgress } from '../src/game/lapProgress';
import { CarPhysics, CHASSIS_SPAWN_HEIGHT } from '../src/physics/vehicle';
import { buildTrack, findSafeSpawnIndex, generateCenterlinePoints, loopSelfIntersects } from '../src/track/generator';
import { exportTrackToBlob, extractTrackUserData, TRACK_ASSET_TYPE } from '../src/track/gltf';
import type { TrackMeta } from '../src/types';


if (typeof (globalThis as { FileReader?: unknown }).FileReader === 'undefined') {
  // GLTFExporter 二进制导出依赖 FileReader；Node 24 无全局实现，提供最小 polyfill
  class SimpleFileReader {
    result: ArrayBuffer | null = null;
    onload: ((ev: { target: SimpleFileReader }) => void) | null = null;
    onloadend: ((ev: { target: SimpleFileReader }) => void) | null = null;
    onerror: ((ev: { target: SimpleFileReader; error: unknown }) => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        })
        .catch((error: unknown) => {
          this.onerror?.({ target: this, error });
        });
    }
  }
  (globalThis as { FileReader?: unknown }).FileReader = SimpleFileReader;
}

function check(name: string, cond: boolean, detail = ''): void {
  expect(cond, `${name} ${detail}`).toBe(true);
}

function makeMeta(mode: 'simple' | 'complex', seed: number): TrackMeta {
  return { id: `smoke-${mode}-${seed}`, mode, seed, createdAt: Date.now(), version: TRACK_VERSION };
}

it('game smoke suite', async () => {
  for (const mode of ['simple', 'complex'] as const) {
    console.log(`--- ${mode} track ---`);
    const meta = makeMeta(mode, 42);
    const points = generateCenterlinePoints(meta);
    check('centerline length 1200~2400', points.length > 1200 && points.length < 2400, String(points.length));
    check('wheelRadius = 0.45', CAR.wheelRadius === 0.45, String(CAR.wheelRadius));
    const built = buildTrack(meta, points);
    check('roadWidth = 12.0', Math.abs(built.roadWidth - 12.0) < 1e-6, String(built.roadWidth));
    check(
      'curves wider than base',
      Math.max(...built.halfWidths) > built.roadWidth / 2 + 0.5,
      `max halfWidth=${Math.max(...built.halfWidths).toFixed(2)}m base=${(built.roadWidth / 2).toFixed(2)}m`,
    );
    check('barrierHeight = 1.05', Math.abs(built.barrierHeight - 1.05) < 1e-6, String(built.barrierHeight));
    check('totalLength in [1500, 2700]', built.totalLength > 1500 && built.totalLength < 2700, String(built.totalLength.toFixed(0)));
    if (mode === 'simple') {
      // 新规则：不要求直线，但不能突左突右（相邻采样方向变化小）、不自交
      let maxTurn = 0;
      for (let i = 0; i < built.points.length; i++) {
        const j = (i + 1) % built.points.length;
        const h0 = Math.atan2(built.tangents[i].x, built.tangents[i].z);
        const h1 = Math.atan2(built.tangents[j].x, built.tangents[j].z);
        let dh = h1 - h0;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        maxTurn = Math.max(maxTurn, Math.abs(dh));
      }
    check('simple no zigzag', maxTurn < 0.3, `max turn=${maxTurn.toFixed(3)}rad`);
    check('simple no self-intersection', !loopSelfIntersects(built.points));
    }
    // 重生安全：任取采样点，安全落点不得与护栏体重叠
    let spawnSafe = true;
    for (let i = 0; i < built.points.length; i += 150) {
      const safe = findSafeSpawnIndex(built, i);
      const p = built.points[safe];
      for (const b of built.physics.barriers) {
        if (b.shapes[0] instanceof CANNON.Plane) continue;
        const bb = b.aabb;
        if (p.x > bb.lowerBound.x - 2.4 && p.x < bb.upperBound.x + 2.4 && p.z > bb.lowerBound.z - 1.4 && p.z < bb.upperBound.z + 1.4) {
          spawnSafe = false;
        }
      }
    }
    check('respawn points clear of barriers', spawnSafe);
    if (mode === 'complex') {
      const ys = built.points.map((p) => p.y);
      check('complex elevation range', Math.max(...ys) - Math.min(...ys) > 2, `range=${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}m`);
      // 坡度可行驶：相邻采样点最大坡度 ≤ 13%，且无断崖（|Δh| ≤ 0.5m）
      let maxSlope = 0;
      let noCliff = true;
      for (let i = 0; i < built.points.length; i++) {
        const j = (i + 1) % built.points.length;
        const dh = Math.abs(built.points[i].y - built.points[j].y);
        if (dh > 0.5) noCliff = false;
        const ds = built.points[i].distanceTo(built.points[j]);
        maxSlope = Math.max(maxSlope, dh / Math.max(0.01, ds));
      }
      check('complex drivable slopes', maxSlope < 0.13, `max slope=${(maxSlope * 100).toFixed(1)}%`);
      check('complex no cliffs', noCliff);
    }
    check('has barriers', built.physics.barriers.length > 20, String(built.physics.barriers.length));
    // 物理坠落回归：车应在 2 秒内停在路面上而不是掉下去
    const physics = new CarPhysics();
    physics.addGround(built.physics.ground);
    for (const b of built.physics.barriers) physics.addGround(b);
    const start = built.points[0];
    const tangent = built.tangents[0].clone();
    tangent.y = 0;
    tangent.normalize();
    const startQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      tangent,
    );
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    const steps = 120;
    for (let i = 0; i < steps; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    const settled = physics.getState().position.y;
    check('car does not fall through ground', settled > start.y - 1, `settled y=${settled.toFixed(2)}, ground y=${start.y.toFixed(2)}`);
    const vehicle = (physics as unknown as { vehicle: CANNON.RaycastVehicle }).vehicle;
    check('all four wheels contact ground', vehicle.numWheelsOnGround === 4, `wheels=${vehicle.numWheelsOnGround}`);
    // 复活稳定性回归：以正确离地高度重生并按住前进 3s，不应弹跳或翻车
    const respawnPhysics = new CarPhysics();
    respawnPhysics.addGround(built.physics.ground);
    respawnPhysics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    let minUpRespawn = 1;
    let maxHeight = 0;
    for (let i = 0; i < 180; i++) {
      respawnPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      const st = respawnPhysics.getState();
      minUpRespawn = Math.min(minUpRespawn, st.up.y);
      maxHeight = Math.max(maxHeight, st.position.y - start.y);
    }
    check('respawn no bounce/flip with throttle', minUpRespawn > 0.6 && maxHeight < 2.0, `min up.y=${minUpRespawn.toFixed(3)} maxHeight=${maxHeight.toFixed(2)}m`);
    respawnPhysics.dispose();
    // 驾驶回归：踩油门 2 秒应沿切线前进（曾因 RaycastVehicle 坐标轴默认值错误而横向漂移/不动）
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    const driveStart = physics.getState().position.clone();
    for (let i = 0; i < 120; i++) {
      physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    }
    const driveEnd = physics.getState().position.clone();
    const forward = new CANNON.Vec3(tangent.x, 0, tangent.z);
    const delta = new CANNON.Vec3(driveEnd.x - driveStart.x, 0, driveEnd.z - driveStart.z);
    const forwardProgress = delta.dot(forward);
    check('car drives forward on throttle', forwardProgress > 3, `forward progress=${forwardProgress.toFixed(2)}m`);
    // 0-100km/h 加速回归（仅平路赛道，复杂赛道有坡度不属于调校目标）
    if (mode === 'simple') {
      // 转向限速：高速时转向，速度应被压到 ~50km/h
      const turnPhysics = new CarPhysics();
      turnPhysics.addGround(built.physics.ground);
      turnPhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) turnPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      for (let i = 0; i < 120; i++) turnPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      for (let i = 0; i < 120; i++) turnPhysics.update({ throttle: 0.8, brake: 0, steering: 1 }, 1 / 60);
      const turnSpeed = turnPhysics.getState().absoluteSpeed;
      check('turning caps speed ~50km/h', turnSpeed < 17, `speed=${(turnSpeed * 3.6).toFixed(0)}km/h`);
      turnPhysics.dispose();
    }
    if (mode === 'simple') {
      const accelPhysics = new CarPhysics();
      accelPhysics.addGround(built.physics.ground);
      accelPhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) accelPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      let accelSteps = 0;
      for (let i = 0; i < 600; i++) {
        accelPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
        if (accelPhysics.getState().absoluteSpeed >= 27.78) {
          accelSteps = i + 1;
          break;
        }
      }
      check('0-100km/h in ~1.5s', accelSteps > 55 && accelSteps < 120, `time=${(accelSteps / 60).toFixed(1)}s`);
      accelPhysics.dispose();
    }
    // 转向回归：从出生点干净起步，油门建立速度后 steering=1（左转键）1.5s，航向角应有明显变化
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    const h0 = Math.atan2(physics.getState().forward.x, physics.getState().forward.z);
    for (let i = 0; i < 90; i++) {
      physics.update({ throttle: 0.8, brake: 0, steering: 1 }, 1 / 60);
    }
    const h1 = Math.atan2(physics.getState().forward.x, physics.getState().forward.z);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    check('steering turns the car', dh > 0.02, `heading change=${dh.toFixed(3)}rad (steering=1 = left)`);
    // 满舵稳定性回归：高速满舵 1.5s，车身不得震动/侧翻
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    for (let i = 0; i < 90; i++) {
      physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    }
    let minUpFullLock = 1;
    for (let i = 0; i < 90; i++) {
      physics.update({ throttle: 0.7, brake: 0, steering: 1 }, 1 / 60);
      minUpFullLock = Math.min(minUpFullLock, physics.getState().up.y);
    }
    check('stable at full lock', minUpFullLock > 0.8, `min up.y=${minUpFullLock.toFixed(3)}`);
    // drift regression: full-lock + throttle -> controlled slide, release steering -> grip restored
    const driftPhysics = new CarPhysics();
    driftPhysics.addGround(built.physics.ground);
    for (const b of built.physics.barriers) driftPhysics.addGround(b);
    driftPhysics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) driftPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    for (let i = 0; i < 180; i++) driftPhysics.update({ throttle: 1, brake: 0, steering: 1 }, 1 / 60);
    check('sustained full-lock with throttle enters drift', driftPhysics.getDrifting());
    for (let i = 0; i < 30; i++) driftPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    check('drift clears after releasing steering', !driftPhysics.getDrifting());
    driftPhysics.dispose();
    // 滑行回归：松油门 4s 后速度应明显下降（阻尼 + 发动机制动）
    for (let i = 0; i < 240; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    const coast = physics.getState().absoluteSpeed;
    check('car decelerates when coasting', coast < 10, `coast speed=${coast.toFixed(2)} m/s`);
    // 高速防前翻回归（仅平路）：全油门 2s 再松油 4s，车身俯仰不得失控。
    // 复杂赛道的高架短坡在高速下会弹飞车辆，属真实物理，不在此断言范围。
    if (mode === 'simple') {
      const flipPhysics = new CarPhysics();
      flipPhysics.addGround(built.physics.ground);
      flipPhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) {
        flipPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      }
      let minUp = 1;
      for (let i = 0; i < 120; i++) {
        flipPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
        minUp = Math.min(minUp, flipPhysics.getState().up.y);
      }
      for (let i = 0; i < 240; i++) {
        flipPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
        minUp = Math.min(minUp, flipPhysics.getState().up.y);
      }
      check('no forward flip at speed', minUp > 0.5, `min up.y=${minUp.toFixed(3)}`);
      flipPhysics.dispose();
    }
    // 倒车回归：限制加速力与最高倒车速度（无护栏平面，避免出生点后方护栏干扰）
    if (mode === 'simple') {
      const reversePhysics = new CarPhysics();
      reversePhysics.addGround(built.physics.ground);
      reversePhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) {
        reversePhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      }
      for (let i = 0; i < 60; i++) {
        reversePhysics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
      }
      const reverse1s = -reversePhysics.getState().forwardSpeed;
      check('reverse acceleration boosted', reverse1s > 4 && reverse1s < 8.8, `reverse speed after 1s=${reverse1s.toFixed(2)} m/s`);
      for (let i = 0; i < 120; i++) {
        reversePhysics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
      }
      const reverseTop = -reversePhysics.getState().forwardSpeed;
      check('reverse top speed limited', reverseTop < 8.8, `reverse top speed=${reverseTop.toFixed(2)} m/s`);
      reversePhysics.dispose();
    }
    // 平路 12s 全油门后应在 144~202km/h（发动机限速 200；下坡可超速，故只在平路断言）
    if (mode === 'simple') {
      const speedPhysics = new CarPhysics();
      speedPhysics.addGround(built.physics.ground);
      speedPhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) {
        speedPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      }
      for (let i = 0; i < 720; i++) {
        speedPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      }
      const topSpeed = speedPhysics.getState().absoluteSpeed;
      check('flat-road top speed 144~202km/h', topSpeed > 40 && topSpeed < 56.2, `top=${(topSpeed * 3.6).toFixed(0)}km/h`);
      speedPhysics.dispose();
    }
    // 护栏防穿透回归：高速右转 2s，车不能穿出护栏外（曾因薄护栏+穿透导致弯道脱轨无碰撞）
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    let maxLateral = 0;
    for (let i = 0; i < 120; i++) {
      physics.update({ throttle: 1, brake: 0, steering: -1 }, 1 / 60);
      if (i % 6 === 0) {
        const p = physics.getState().position;
        let best = Infinity;
        for (const pt of built.points) {
          const d = (p.x - pt.x) * (p.x - pt.x) + (p.z - pt.z) * (p.z - pt.z);
          if (d < best) best = d;
        }
        maxLateral = Math.max(maxLateral, Math.sqrt(best));
      }
    }
    const barrierLine = Math.max(...built.halfWidths) + 0.6;
    if (mode === 'simple') {
      check('barrier contains car in high-speed turn', maxLateral < barrierLine + 1.6, `max lateral=${maxLateral.toFixed(2)}m`);
    }
    // 高速过丘陵不飞射：复杂赛道（高架起伏）全油门 6s，最大上升速度应被钳制在 ~1m/s 内
    if (mode === 'complex') {
      const airPhysics = new CarPhysics();
      airPhysics.addGround(built.physics.ground);
      airPhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) airPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      let maxVy = 0;
      for (let i = 0; i < 360; i++) {
        airPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
        maxVy = Math.max(maxVy, airPhysics.getState().velocity.y);
      }
      check('no upward launch on hills', maxVy < 1.0, `max upward speed=${maxVy.toFixed(2)} m/s`);
      airPhysics.dispose();
    }
    // 急刹防前翻回归：加速到 ~58km/h 后按刹车键 3s，俯仰不得失控（曾因刹车点头前翻）
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    let minUpBrake = 1;
    for (let i = 0; i < 108; i++) {
      physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
    }
    for (let i = 0; i < 180; i++) {
      physics.update({ throttle: 0, brake: 1, steering: 0 }, 1 / 60);
      minUpBrake = Math.min(minUpBrake, physics.getState().up.y);
    }
    check('no forward flip when braking at speed', minUpBrake > 0.6, `min up.y=${minUpBrake.toFixed(3)}`);
    // 快速左右切换不侧翻 / 缓慢回中（平路调校项）
    if (mode === 'simple') {
      const switchPhysics = new CarPhysics();
      switchPhysics.addGround(built.physics.ground);
      switchPhysics.reset(
        new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
        new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
      );
      for (let i = 0; i < 30; i++) switchPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      for (let i = 0; i < 240; i++) switchPhysics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
      let minUpSwitch = 1;
      for (let i = 0; i < 180; i++) {
        const steering = Math.floor(i / 8) % 2 === 0 ? 1 : -1;
        switchPhysics.update({ throttle: 0.7, brake: 0, steering }, 1 / 60);
        minUpSwitch = Math.min(minUpSwitch, switchPhysics.getState().up.y);
      }
      check('no rollover on rapid steering switch', minUpSwitch > 0.5, `min up.y=${minUpSwitch.toFixed(3)}`);
      for (let i = 0; i < 30; i++) switchPhysics.update({ throttle: 0, brake: 0, steering: 1 }, 1 / 60);
      switchPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      const steerAfterRelease = Math.abs(switchPhysics.getSteering());
      for (let i = 0; i < 8; i++) switchPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      const steerAt015s = Math.abs(switchPhysics.getSteering());
      for (let i = 0; i < 64; i++) switchPhysics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      const steerAt12s = Math.abs(switchPhysics.getSteering());
      check(
        'steering returns slowly to center',
        steerAt015s > 0.2 && steerAt12s < 0.05,
        `at0.15s=${steerAt015s.toFixed(2)} at1.2s=${steerAt12s.toFixed(2)} (release=${steerAfterRelease.toFixed(2)})`,
      );
      switchPhysics.dispose();
    }
    physics.dispose();
    const roadAttr = (built.group.getObjectByName('road') as import('three').Mesh)?.geometry.getAttribute('position');
    check('road mesh has positions', !!roadAttr && roadAttr.count === built.points.length * 2, `count=${roadAttr?.count}`);
    if (mode === 'complex') {
      const ys = built.points.map((p) => p.y);
      check('complex has elevation', Math.max(...ys) - Math.min(...ys) > 1, `range=${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`);
    }
  }

  console.log('--- complex multi-seed validity ---');
  let validSeeds = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const meta = makeMeta('complex', seed);
    const pts = generateCenterlinePoints(meta);
    const built2 = buildTrack(meta, pts);
    let ok = built2.totalLength > 1500 && built2.totalLength < 2700;
    let maxSlope = 0;
    for (let i = 0; i < built2.points.length; i++) {
      const j = (i + 1) % built2.points.length;
      const dh = Math.abs(built2.points[i].y - built2.points[j].y);
      const ds = built2.points[i].distanceTo(built2.points[j]);
      maxSlope = Math.max(maxSlope, dh / Math.max(0.01, ds));
      if (dh > 0.5) ok = false;
    }
    if (maxSlope >= 0.13) ok = false;
    if (ok) {
      validSeeds++;
    } else {
      console.log(`  seed ${seed} invalid: len=${built2.totalLength.toFixed(0)} maxSlope=${(maxSlope * 100).toFixed(1)}%`);
    }
  }
  check('complex multi-seed validity', validSeeds === 6, `valid=${validSeeds}/6`);

  console.log('--- GLB roundtrip ---');
  const meta = makeMeta('simple', 7);
  const built = buildTrack(meta, generateCenterlinePoints(meta));
  const blob = await exportTrackToBlob(built);
  const buf = Buffer.from(await blob.arrayBuffer());
  check('GLB size > 100KB', buf.length > 100_000, `${buf.length} bytes`);

  const loader = new GLTFLoader();
  const gltf = await new Promise<Awaited<ReturnType<typeof loader.parseAsync>>>((resolve, reject) => {
    loader.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      '',
      (g) => resolve(g),
      (e) => reject(e),
    );
  });
  const ud = extractTrackUserData(gltf.scene);
  check('userData.type preserved', ud.type === TRACK_ASSET_TYPE, String(ud.type));
  check('centerline preserved', Array.isArray(ud.centerline) && ud.centerline.length === built.points.length, `${ud.centerline?.length} vs ${built.points.length}`);
  check(
    'first point matches',
    !!ud.centerline &&
      Math.abs(ud.centerline[0].x - built.points[0].x) < 1e-4 &&
      Math.abs(ud.centerline[0].z - built.points[0].z) < 1e-4,
    JSON.stringify(ud.centerline?.[0]),
  );

  console.log('--- lap progress ---');
  const L = 1000;
  const cross = updateLapProgress(10, 990, L, 800);
  check('crossed line detected', cross.crossedLine && Math.abs(cross.completedDistance - 820) < 1e-6, JSON.stringify(cross));
  const mid = updateLapProgress(400, 300, L, 500);
  check('mid-lap no crossing', !mid.crossedLine && Math.abs(mid.completedDistance - 600) < 1e-6, JSON.stringify(mid));
  const back = updateLapProgress(300, 400, L, 600);
  check('backward no progress', !back.crossedLine && back.dS < 0 && Math.abs(back.completedDistance - 600) < 1e-6, JSON.stringify(back));

});
