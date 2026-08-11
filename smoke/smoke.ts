/* 一次性 Node 冒烟测试：验证赛道生成、物理构建、GLB 往返（不依赖浏览器） */
import * as fs from 'node:fs';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TRACK_VERSION } from '../src/config';
import { updateLapProgress } from '../src/game/lapProgress';
import { CarPhysics } from '../src/physics/vehicle';
import { buildTrack, generateCenterlinePoints } from '../src/track/generator';
import { exportTrackToBlob, extractTrackUserData, TRACK_ASSET_TYPE } from '../src/track/gltf';
import type { TrackMeta } from '../src/types';

let failures = 0;

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
  if (cond) {
    console.log(`  [ok] ${name}`);
  } else {
    failures += 1;
    console.error(`  [FAIL] ${name} ${detail}`);
  }
}

function makeMeta(mode: 'simple' | 'complex', seed: number): TrackMeta {
  return { id: `smoke-${mode}-${seed}`, mode, seed, createdAt: Date.now(), version: TRACK_VERSION };
}

async function main(): Promise<void> {
  for (const mode of ['simple', 'complex'] as const) {
    console.log(`--- ${mode} track ---`);
    const meta = makeMeta(mode, 42);
    const points = generateCenterlinePoints(meta);
    check('centerline 700 points', points.length === 700);
    const built = buildTrack(meta, points);
    check('roadWidth = 12.0', Math.abs(built.roadWidth - 12.0) < 1e-6, String(built.roadWidth));
    check(
      'curves wider than base',
      Math.max(...built.halfWidths) > built.roadWidth / 2 + 0.5,
      `max halfWidth=${Math.max(...built.halfWidths).toFixed(2)}m base=${(built.roadWidth / 2).toFixed(2)}m`,
    );
    check('barrierHeight = 0.7', Math.abs(built.barrierHeight - 0.7) < 1e-6, String(built.barrierHeight));
    check('totalLength in [250, 1200]', built.totalLength > 250 && built.totalLength < 1200, String(built.totalLength));
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
      new CANNON.Vec3(start.x, start.y + 0.5, start.z),
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
    // 驾驶回归：踩油门 2 秒应沿切线前进（曾因 RaycastVehicle 坐标轴默认值错误而横向漂移/不动）
    physics.reset(
      new CANNON.Vec3(start.x, start.y + 0.5, start.z),
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
    // 转向回归：油门 + steering=1（左转键）1.5s，航向角应有明显变化（前轮不触地时转向无效）
    const h0 = Math.atan2(physics.getState().forward.x, physics.getState().forward.z);
    for (let i = 0; i < 90; i++) {
      physics.update({ throttle: 0.8, brake: 0, steering: 1 }, 1 / 60);
    }
    const h1 = Math.atan2(physics.getState().forward.x, physics.getState().forward.z);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    check('steering turns the car', dh > 0.02, `heading change=${dh.toFixed(3)}rad (steering=1 = left)`);
    // 滑行回归：松油门 4s 后速度应明显下降（阻尼 + 发动机制动）
    for (let i = 0; i < 240; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    const coast = physics.getState().absoluteSpeed;
    check('car decelerates when coasting', coast < 2.5, `coast speed=${coast.toFixed(2)} m/s`);
    // 高速防前翻回归：全油门 2s 再松油 4s，车身俯仰不得失控（曾因发动机制动点头触发前翻）。
    // 用无护栏世界，避免直行测试撞上护栏造成“碰撞翻车”干扰本项断言。
    const flipPhysics = new CarPhysics();
    flipPhysics.addGround(built.physics.ground);
    flipPhysics.reset(
      new CANNON.Vec3(start.x, start.y + 0.5, start.z),
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
    // 倒车回归：限制加速力与最高倒车速度
    physics.reset(
      new CANNON.Vec3(start.x, start.y + 0.5, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    for (let i = 0; i < 30; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
    }
    for (let i = 0; i < 60; i++) {
      physics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
    }
    const reverse1s = -physics.getState().forwardSpeed;
    check('reverse acceleration limited', reverse1s < 7, `reverse speed after 1s=${reverse1s.toFixed(2)} m/s`);
    for (let i = 0; i < 120; i++) {
      physics.update({ throttle: -1, brake: 0, steering: 0 }, 1 / 60);
    }
    const reverseTop = -physics.getState().forwardSpeed;
    check('reverse top speed limited', reverseTop < 8.5, `reverse top speed=${reverseTop.toFixed(2)} m/s`);
    // 护栏防穿透回归：高速右转 2s，车不能穿出护栏外（曾因薄护栏+穿透导致弯道脱轨无碰撞）
    physics.reset(
      new CANNON.Vec3(start.x, start.y + 0.5, start.z),
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
    check('barrier contains car in high-speed turn', maxLateral < barrierLine + 1.2, `max lateral=${maxLateral.toFixed(2)}m`);
    // 急刹防前翻回归：加速到 ~58km/h 后按刹车键 3s，俯仰不得失控（曾因刹车点头前翻）
    physics.reset(
      new CANNON.Vec3(start.x, start.y + 0.5, start.z),
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
    physics.dispose();
    const roadAttr = (built.group.getObjectByName('road') as import('three').Mesh)?.geometry.getAttribute('position');
    check('road mesh has positions', !!roadAttr && roadAttr.count === 1400);
    if (mode === 'complex') {
      const ys = built.points.map((p) => p.y);
      check('complex has elevation', Math.max(...ys) - Math.min(...ys) > 1, `range=${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`);
    }
  }

  console.log('--- GLB roundtrip ---');
  const meta = makeMeta('simple', 7);
  const built = buildTrack(meta, generateCenterlinePoints(meta));
  const blob = await exportTrackToBlob(built);
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(new URL('./out-smoke.glb', import.meta.url), buf);
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
  check('centerline preserved (700)', Array.isArray(ud.centerline) && ud.centerline.length === 700, String(ud.centerline?.length));
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

  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
