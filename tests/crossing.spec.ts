import CANNON from 'cannon-es';
import { it } from 'vitest';
import { CHASSIS_SPAWN_HEIGHT, CarPhysics } from '../src/physics/vehicle';
import { check } from './helpers';

/**
 * 满舵十字路口可达性（2026-10-26 用户反馈"最大转角需要能正常过十字路口"的永久验收）。
 * 独立最小场景（水平地面、无护栏/轨道），思路同 barrier-collision.spec：
 * 1) 40km/h 级（11m/s）满舵：半径 ≤8m、自转率 ≤2.0、不打翻——12m 路面 90° 直角弯可达；
 * 2) 60km/h 级（17m/s）满舵：车速保持 ≥15.5m/s（不塌成低速陀螺）、半径 ≤9m、自转率 ≤2.2。
 * 基线实测（2026-10-26 调参后）：11→6.5m/1.71、14.6→7.5m/1.95、16.6→8.2m/2.03；调参前 15m/s+ 即自转。
 */

const DT = 1 / 60;

function makeGround(): CANNON.Body {
  const q = new CANNON.Quaternion();
  q.setFromEuler(-Math.PI / 2, 0, 0);
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), quaternion: q });
  ground.updateAABB();
  return ground;
}

interface TurningMetrics {
  steadyV: number;
  yawRate: number;
  radius: number;
  upMin: number;
}

/** 速度保持器（油门/刹车钉住目标车速）→ 满舵转圈 → 末 2 秒稳态均值 */
function fullLockTurn(target: number): TurningMetrics {
  const physics = new CarPhysics();
  physics.addGround(makeGround());
  physics.reset(new CANNON.Vec3(0, CHASSIS_SPAWN_HEIGHT, 0), new CANNON.Quaternion());
  const governor = (): { throttle: number; brake: number } => {
    const err = target - physics.getState().absoluteSpeed;
    if (err > 0.4) return { throttle: 1, brake: 0 };
    if (err < -0.4) return { throttle: 0, brake: 0.5 };
    return { throttle: 0.35, brake: 0 };
  };
  let frames = 0;
  while (physics.getState().absoluteSpeed < target && frames < 600) {
    physics.update({ ...governor(), steering: 0 }, DT);
    frames++;
  }
  let upMin = 1;
  for (let i = 0; i < 480; i++) {
    physics.update({ ...governor(), steering: 1 }, DT);
    upMin = Math.min(upMin, physics.getState().up.y);
  }
  let sumW = 0;
  let sumV = 0;
  for (let i = 0; i < 120; i++) {
    physics.update({ ...governor(), steering: 1 }, DT);
    const st = physics.getState();
    sumW += Math.abs(st.angularVelocity.y);
    sumV += st.absoluteSpeed;
    upMin = Math.min(upMin, st.up.y);
  }
  physics.dispose();
  const steadyV = sumV / 120;
  const yawRate = sumW / 120;
  return { steadyV, yawRate, radius: steadyV / yawRate, upMin };
}

it('crossing: full lock at 40km/h-class holds a <=8m arc without spinning out', () => {
  const m = fullLockTurn(11);
  check('40km/h-class: steady speed kept', m.steadyV >= 10.2, `v=${m.steadyV.toFixed(2)}`);
  check('40km/h-class: turn radius <=8m (12m road 90deg)', m.radius <= 8 && m.radius >= 4, `R=${m.radius.toFixed(1)}m`);
  check('40km/h-class: no donut spin', m.yawRate <= 2.0, `yaw=${m.yawRate.toFixed(2)}`);
  check('40km/h-class: no rollover', m.upMin > 0.85, `upMin=${m.upMin.toFixed(3)}`);
});

it('crossing: full lock at 60km/h-class keeps arc >15.5m/s and does not collapse into a donut', () => {
  const m = fullLockTurn(17);
  check('60km/h-class: speed not collapsing', m.steadyV >= 15.5, `v=${m.steadyV.toFixed(2)}`);
  check('60km/h-class: turn radius <=9m', m.radius <= 9, `R=${m.radius.toFixed(1)}m`);
  check('60km/h-class: no donut spin', m.yawRate <= 2.2, `yaw=${m.yawRate.toFixed(2)}`);
  check('60km/h-class: no rollover', m.upMin > 0.85, `upMin=${m.upMin.toFixed(3)}`);
});
