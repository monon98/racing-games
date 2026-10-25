import CANNON from 'cannon-es';
import { it } from 'vitest';
import { CHASSIS_SPAWN_HEIGHT, CarPhysics } from '../src/physics/vehicle';
import { check } from './helpers';

/**
 * 高速碰撞回归（known-issues #1「高速穿墙/异常弹跳」的验收基线）。
 * 全部场景使用独立最小世界（水平地面 + 直墙），不复刻真实轨道几何；
 * 结论基线：55m/s（≈200km/h 极速）正撞/浅擦/接缝/边缘全被接住（穿透 0、弹跳温和）。
 */

/** cannon Plane 默认法线是 (0,0,1)，必须转 -90° 且把四元数放进构造参数 + updateAABB */
function makeGround(): CANNON.Body {
  const q = new CANNON.Quaternion();
  q.setFromEuler(-Math.PI / 2, 0, 0);
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), quaternion: q });
  ground.updateAABB();
  return ground;
}

function makeWall(z: number, halfLenX: number): CANNON.Body {
  const wall = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(halfLenX, 1.4, 0.3)),
    position: new CANNON.Vec3(0, 1.4, z),
  });
  wall.updateAABB();
  return wall;
}

interface Metrics {
  maxOverrun: number;
  maxVy: number;
  maxY: number;
  upMin: number;
}

function runScenario(
  walls: CANNON.Body[],
  start: CANNON.Vec3,
  velocity: CANNON.Vec3,
  throttle: number,
  frames: number,
): Metrics {
  const physics = new CarPhysics();
  physics.addGround(makeGround());
  for (const w of walls) {
    physics.addGround(w);
    physics.markBarrier(w);
  }
  physics.reset(start, new CANNON.Quaternion());
  physics.chassis.velocity.copy(velocity);

  let maxOverrun = -Infinity;
  let maxVy = 0;
  let maxY = 0;
  let upMin = 1;
  for (let i = 0; i < frames; i++) {
    physics.update({ throttle, brake: 0, steering: 0 }, 1 / 60);
    const st = physics.getState();
    maxVy = Math.max(maxVy, Math.abs(st.velocity.y));
    maxY = Math.max(maxY, st.position.y);
    upMin = Math.min(upMin, st.up.y);
    // 每个 wall 的越界量（车中心越过“护栏面 + 车半长”的深度取最大）
    let overrunThisFrame = -Infinity;
    for (const w of walls) {
      const halfDepth = (w.shapes[0] as CANNON.Box).halfExtents.z;
      const faceZ = w.position.z - halfDepth;
      overrunThisFrame = Math.max(overrunThisFrame, st.position.z - (faceZ + 1.8));
    }
    maxOverrun = Math.max(maxOverrun, overrunThisFrame);
  }
  physics.dispose();
  return { maxOverrun, maxVy, maxY, upMin };
}

it('barrier: head-on at top speed with full throttle stays contained and calm', () => {
  // 55 m/s ≈ 198km/h（极速）全油门正撞 z=200 处护栏，撞后油门继续（真实工况：撞后还踩着油门）
  const m = runScenario(
    [makeWall(200, 20)],
    new CANNON.Vec3(0, CHASSIS_SPAWN_HEIGHT, 0),
    new CANNON.Vec3(0, 0, 55),
    1,
    420,
  );
  check('head-on: no wall pass-through', m.maxOverrun < 1.0, `maxOverrun=${m.maxOverrun.toFixed(2)}m`);
  check('head-on: no violent pop', m.maxVy < 6, `maxVy=${m.maxVy.toFixed(2)}m/s maxY=${m.maxY.toFixed(2)}m`);
  check('head-on: upright', m.upMin > 0.6, `upMin=${m.upMin.toFixed(3)}`);
});

it('barrier: shallow-angle grind at 45 m/s stays contained and calm', () => {
  // 15° 浅角 45 m/s 顶护栏：贴墙蹭行（立即回弹 + 减速）不得穿透或垂直弹跳
  const a = (15 * Math.PI) / 180;
  const m = runScenario(
    [makeWall(120, 40)],
    new CANNON.Vec3(0, CHASSIS_SPAWN_HEIGHT, 0),
    new CANNON.Vec3(Math.sin(a) * 45, 0, Math.cos(a) * 45),
    0,
    240,
  );
  check('shallow: no wall pass-through', m.maxOverrun < 1.0, `maxOverrun=${m.maxOverrun.toFixed(2)}m`);
  check('shallow: no violent pop', m.maxVy < 4, `maxVy=${m.maxVy.toFixed(2)}m/s`);
  check('shallow: upright', m.upMin > 0.6, `upMin=${m.upMin.toFixed(3)}`);
});

it('barrier: 55 m/s seam pass-through attempt is caught', () => {
  // 两段护栏沿 X 拼接（0.01m 接缝）：以 55 m/s 正冲接缝不得从缝里穿过
  const gap = 0.01;
  const mk = (cx: number) => {
    const wall = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(20 - gap / 2, 1.4, 0.3)),
      position: new CANNON.Vec3(cx, 1.4, 120),
    });
    wall.updateAABB();
    return wall;
  };
  const m = runScenario(
    [mk(-20 - gap / 4), mk(20 + gap / 4)],
    new CANNON.Vec3(0, CHASSIS_SPAWN_HEIGHT, 0),
    new CANNON.Vec3(0, 0, 55),
    0,
    260,
  );
  check('seam: no pass-through at top speed', m.maxOverrun < 1.0, `maxOverrun=${m.maxOverrun.toFixed(2)}m`);
  check('seam: no violent pop', m.maxVy < 6, `maxVy=${m.maxVy.toFixed(2)}m/s`);
});

it('barrier: 55 m/s 45-degree edge clipping at wall end is caught', () => {
  // 车斜冲护栏箱体边缘角（经典穿墙/弹跳工况）
  const m = runScenario(
    [makeWall(120, 40)],
    new CANNON.Vec3(10, CHASSIS_SPAWN_HEIGHT, 0),
    new CANNON.Vec3(38.9, 0, 38.9),
    0,
    260,
  );
  check('edge: no pass-through at top speed', m.maxOverrun < 1.0, `maxOverrun=${m.maxOverrun.toFixed(2)}m`);
  check('edge: no violent pop', m.maxVy < 4, `maxVy=${m.maxVy.toFixed(2)}m/s`);
  check('edge: upright', m.upMin > 0.6, `upMin=${m.upMin.toFixed(3)}`);
});
