import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { it } from 'vitest';
import { OFFTRACK_HOLD_MS, OFFTRACK_MARGIN } from '../src/config';
import { CHASSIS_SPAWN_HEIGHT, CarPhysics } from '../src/physics/vehicle';
import { findSafeSpawnIndex, type BuiltTrack } from '../src/track/generator';
import { buildTrackForMode, check } from './helpers';

/**
 * 用户反馈「车出轨一次后，车和轨道的碰撞判断失效，反复出轨」的永久回归。
 * 根因：静态护栏 Body 的 AABB 在原点构造后从未刷新，SAPBroadphase 排序错位并跳过碰撞对。
 * 场景：回旋花廊发卡弯（idx 720）先冲出路外一次 → 重生到安全点后继续满舵全油门，
 * 要求护栏正常接住、不再触发脱轨重生。
 */

const DT = 1 / 60;

function nearestIndex(points: THREE.Vector3[], pos: { x: number; y: number; z: number }): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dx = pos.x - p.x;
    const dy = pos.y - p.y;
    const dz = pos.z - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function quatAlong(track: BuiltTrack, idx: number): CANNON.Quaternion {
  const t = track.tangents[idx].clone();
  t.y = 0;
  t.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
  return new CANNON.Quaternion(q.x, q.y, q.z, q.w);
}

it('respawn after an off-track excursion still collides with barriers', () => {
  const built = buildTrackForMode('preset', 42, 'windmill-corridor');
  const physics = new CarPhysics();
  physics.addGround(built.physics.ground);
  let hits = 0;
  for (const b of built.physics.barriers) {
    physics.addGround(b);
    physics.markBarrier(b);
  }
  physics.onBarrierCollide = () => {
    hits += 1;
  };

  const place = (idx: number): void => {
    const p = built.points[idx];
    physics.reset(new CANNON.Vec3(p.x, p.y + CHASSIS_SPAWN_HEIGHT, p.z), quatAlong(built, idx));
  };

  // 1) 模拟第一次出轨：在发卡弯把车瞬移到路外 20m，满舵全油门 23 帧
  place(720);
  const p0 = built.points[720];
  const right = new THREE.Vector3(built.tangents[720].z, 0, -built.tangents[720].x).normalize();
  physics.chassis.position.set(p0.x + right.x * 20, p0.y + CHASSIS_SPAWN_HEIGHT, p0.z + right.z * 20);
  physics.chassis.aabbNeedsUpdate = true;
  physics.chassis.updateAABB();
  for (let f = 0; f < 23; f++) {
    physics.update({ throttle: 1, brake: 0, steering: 1 }, DT);
  }

  // 2) 与 Game.respawn 一致：找安全点重生
  const fromIdx = nearestIndex(built.points, physics.getState().position);
  const safe = findSafeSpawnIndex(built, fromIdx);
  place(safe);
  check('steering cleared on respawn', physics.getSteering() === 0, `steer=${physics.getSteering()}`);

  // 3) 重生后继续满舵全油门 3 秒：必须被护栏接住，不得再次触发脱轨
  let offTimer = 0;
  let respawns = 0;
  let maxOver = -Infinity;
  for (let f = 0; f < 180; f++) {
    physics.update({ throttle: 1, brake: 0, steering: 1 }, DT);
    const st = physics.getState();
    const idx = nearestIndex(built.points, st.position);
    const c = built.points[idx];
    const d = Math.hypot(st.position.x - c.x, st.position.z - c.z);
    maxOver = Math.max(maxOver, d - built.halfWidths[idx]);
    if (d > built.halfWidths[idx] + OFFTRACK_MARGIN) offTimer += DT * 1000;
    else offTimer = 0;
    if (offTimer > OFFTRACK_HOLD_MS) {
      respawns += 1;
      place(findSafeSpawnIndex(built, idx));
      offTimer = 0;
    }
  }

  check('barrier collisions happen after respawn', hits > 0, `hits=${hits}`);
  check('no repeated off-track respawns', respawns === 0, `respawns=${respawns} maxOver=${maxOver.toFixed(2)}`);
  check(
    'car stays inside widened track judgment',
    maxOver < OFFTRACK_MARGIN,
    `maxOver=${maxOver.toFixed(2)} margin=${OFFTRACK_MARGIN}`,
  );

  physics.dispose();
});
