import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { TRACK_VERSION } from '../src/config';
import { CarPhysics, CHASSIS_SPAWN_HEIGHT } from '../src/physics/vehicle';
import { buildTrack, generateCenterlinePoints } from '../src/track/generator';

async function main(): Promise<void> {
  const meta = { id: 'dbg9', mode: 'simple' as const, seed: 42, createdAt: Date.now(), version: TRACK_VERSION };
  const built = buildTrack(meta, generateCenterlinePoints(meta));
  const physics = new CarPhysics();
  physics.addGround(built.physics.ground);
  for (const b of built.physics.barriers) physics.addGround(b);

  const barrierLine = Math.max(...built.halfWidths) + 0.6;
  console.log(`barrierLine=${barrierLine.toFixed(1)}m`);
  let throughCount = 0;
  for (let idx = 0; idx < built.points.length; idx += 40) {
    const p = built.points[idx];
    const t = built.tangents[idx].clone();
    t.y = 0;
    t.normalize();
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    const start = new THREE.Vector3(p.x + right.x * (built.halfWidths[idx] - 6), p.y, p.z + right.z * (built.halfWidths[idx] - 6));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), right);
    physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(q.x, q.y, q.z, q.w),
    );
    physics.chassis.velocity.set(right.x * 16, 0, right.z * 16);
    if (idx === 240) {
      // 诊断：从出生点沿 right 方向射一条 12m 射线，看能命中哪些物理体
      const rayFrom = new CANNON.Vec3(start.x, start.y + 1, start.z);
      const rayTo = new CANNON.Vec3(start.x + right.x * 12, start.y + 1, start.z + right.z * 12);
      const ray = new CANNON.Ray(rayFrom, rayTo);
      const res = new CANNON.RaycastResult();
      ray.intersectWorld(physics.world, { mode: CANNON.Ray.CLOSEST, result: res });
      console.log(`  [diag] ray hit=${!!res.body} bodyId=${res.body?.id} dist=${res.distance.toFixed(2)}m`);
      const startX = start.x;
      const startZ = start.z;
      let nearest = Infinity;
      for (const b of built.physics.barriers) {
        const dx = b.position.x - startX;
        const dz = b.position.z - startZ;
        const d = Math.hypot(dx, dz);
        if (d < nearest) nearest = d;
      }
      console.log(`  [diag] nearest barrier dist=${nearest.toFixed(2)}m count=${built.physics.barriers.length}`);
    }
    let maxLateral = 0;
    let maxY = 0;
    for (let i = 1; i <= 90; i++) {
      physics.update({ throttle: 0, brake: 0, steering: 0 }, 1 / 60);
      const pos = physics.getState().position;
      maxY = Math.max(maxY, pos.y - p.y);
      let best = Infinity;
      for (const pt of built.points) {
        const d = (pos.x - pt.x) ** 2 + (pos.z - pt.z) ** 2;
        if (d < best) best = d;
      }
      maxLateral = Math.max(maxLateral, Math.sqrt(best));
    }
    const through = maxLateral > barrierLine + 3;
    if (through) throughCount++;
    console.log(`idx=${idx} maxLateral=${maxLateral.toFixed(2)}m maxHeight=${maxY.toFixed(2)}m ${through ? '<<< THROUGH' : 'blocked'}`);
  }
  console.log(`THROUGH count=${throughCount}/${built.points.length / 40}`);
}

void main();
