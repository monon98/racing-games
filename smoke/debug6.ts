import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { TRACK_VERSION } from '../src/config';
import { CarPhysics } from '../src/physics/vehicle';
import { buildTrack, generateCenterlinePoints } from '../src/track/generator';

async function main(): Promise<void> {
  const meta = { id: 'dbg6', mode: 'simple' as const, seed: 42, createdAt: Date.now(), version: TRACK_VERSION };
  const built = buildTrack(meta, generateCenterlinePoints(meta));
  const physics = new CarPhysics();
  physics.addGround(built.physics.ground);
  for (const b of built.physics.barriers) physics.addGround(b);
  const start = built.points[0];
  const tangent = built.tangents[0].clone();
  tangent.y = 0;
  tangent.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  physics.reset(new CANNON.Vec3(start.x, start.y + 0.5, start.z), new CANNON.Quaternion(q.x, q.y, q.z, q.w));
  for (let i = 0; i < 30; i++) physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);

  // 加速 4s 到 ~110km/h
  for (let i = 0; i < 240; i++) physics.update({ throttle: 1, brake: 0, steering: 0 }, 1 / 60);
  console.log(`speed before switching=${(physics.getState().absoluteSpeed * 3.6).toFixed(0)}km/h`);

  // 快速左右切换 3s（每 0.2s 换向），观察是否侧翻
  let minUp = 1;
  for (let i = 0; i < 180; i++) {
    const steering = Math.floor(i / 8) % 2 === 0 ? 1 : -1; // 每 0.13s 换向（更激进）
    physics.update({ throttle: 0.7, brake: 0, steering }, 1 / 60);
    minUp = Math.min(minUp, physics.getState().up.y);
    if (minUp < -0.3) break;
  }
  const s = physics.getState();
  console.log(`min up.y=${minUp.toFixed(3)} speed=${(s.absoluteSpeed * 3.6).toFixed(0)}km/h`);
}

void main();
