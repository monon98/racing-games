import * as CANNON from 'cannon-es';
import { CAR } from '../config';

export interface VehicleInput {
  throttle: number;
  brake: number;
  steering: number;
}

export interface VehicleState {
  position: CANNON.Vec3;
  quaternion: CANNON.Quaternion;
  forward: CANNON.Vec3;
  up: CANNON.Vec3;
  velocity: CANNON.Vec3;
  angularVelocity: CANNON.Vec3;
  forwardSpeed: number;
  absoluteSpeed: number;
}

const MAX_STEER = 0.65;
// 目标：正向 0→100km/h 约 1.5s（初始加速度约 20 m/s²，极速 200km/h 限速不变）；
// 倒车拿到“旧正向”档位：5500 × 0.64 ≈ 3500N/轮（约 12.9 m/s²）
const ENGINE_FORCE = 5500;
const REVERSE_FORCE_RATIO = 0.64;
const REVERSE_MAX_SPEED = 8; // m/s ≈ 29 km/h
const FORWARD_MAX_SPEED = 200 / 3.6; // 200 km/h
const TURN_MAX_SPEED = 50 / 3.6; // 转向时最高时速 50 km/h
const BRAKE_FORCE = 55;
const ENGINE_BRAKE = 35;
/** 松左右键后轮子回中速度（慢）；按住转向时响应速度（快） */
const STEER_RETURN_RATE = 3;
const STEER_APPLY_RATE = 7;
/** 底盘原点在静止时的离地高度（|连接点y| + 悬架静止长 + 轮半径），重生/出生用 */
export const CHASSIS_SPAWN_HEIGHT = 1.1;

/** cannon-es 四轮车辆（RaycastVehicle 悬架） */
export class CarPhysics {
  readonly world: CANNON.World;
  readonly chassis: CANNON.Body;
  /** 物理固定子步（1/60 经实测最稳定；120Hz 会导致松油俯仰失稳翻车） */
  fixedTimeStep = 1 / 60;
  maxSubSteps = 3;
  /** 碰撞到护栏时的回调（参数为法向冲击速度 m/s） */
  onBarrierCollide: ((impactSpeed: number) => void) | null = null;
  private readonly vehicle: CANNON.RaycastVehicle;
  private readonly barrierIds = new Set<number>();
  private readonly onCollide: (event: { body: CANNON.Body; contact: CANNON.ContactEquation }) => void;
  private steerCurrent = 0;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    const chassisShape = new CANNON.Box(
      // 底盘收窄（防弯角刮地诱发侧翻）、重心低、离地高
      new CANNON.Vec3(CAR.width / 2 - 0.05, CAR.height * 0.26, CAR.length / 2 - 0.05),
    );
    this.chassis = new CANNON.Body({
      mass: 550,
      // 线性阻尼模拟空气阻力/滚动阻力，避免松油门后滑行过长
      // 线性阻尼 0.12：极速可达 200+km/h，松油仍能缓慢减速
      linearDamping: 0.12,
      angularDamping: 1.0,
    });
    // 重心下移 0.10m（碰撞盒下偏），车身也更贴近路面，降低抬头力矩
    this.chassis.addShape(chassisShape, new CANNON.Vec3(0, -0.1, 0));

    // y-up 坐标系：right=X(0)、forward=Z(2)、up=Y(1)。
    // 默认值 (right=Z, forward=X, up=Y) 会让油门/转向偏 90°，车辆无法正常驾驶。
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassis,
      indexRightAxis: 0,
      indexForwardAxis: 2,
      indexUpAxis: 1,
    });

    const wheelOptionsBase = {
      radius: CAR.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      // 悬架加硬、行程缩短，抑制刹车/加速时的俯仰振荡（防止高速前翻）
      suspensionStiffness: 45,
      suspensionRestLength: 0.38,
      maxSuspensionTravel: 0.25,
      frictionSlip: 3.2,
      dampingRelaxation: 4.0,
      dampingCompression: 11,
      maxSuspensionForce: 200000,
      rollInfluence: 0.08,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      useCustomSlidingRotationalSpeed: true,
      customSlidingRotationalSpeed: 30,
    };

    const zFront = CAR.length * 0.37;
    const zRear = -CAR.length * 0.37;
    // 轮距略宽于车身，前轮在追尾视角下可见
    const xOffset = CAR.width / 2 + 0.15;
    const yOffset = -0.24;
    for (const [x, z] of [
      [-xOffset, zFront],
      [xOffset, zFront],
      [-xOffset, zRear],
      [xOffset, zRear],
    ]) {
      this.vehicle.addWheel({
        ...wheelOptionsBase,
        chassisConnectionPointLocal: new CANNON.Vec3(x, yOffset, z),
      });
    }
    this.vehicle.addToWorld(this.world);
    this.world.addBody(this.chassis);

    this.onCollide = (event) => {
      if (!this.barrierIds.has(event.body.id)) return;
      const impact = Math.abs(event.contact?.getImpactVelocityAlongNormal?.() ?? 0);
      if (impact > 0) {
        this.onBarrierCollide?.(impact);
      }
    };
    this.chassis.addEventListener('collide', this.onCollide);
  }

  addGround(body: CANNON.Body): void {
    this.world.addBody(body);
  }

  markBarrier(body: CANNON.Body): void {
    this.barrierIds.add(body.id);
  }

  update(input: VehicleInput, dt: number): void {
    const targetSteer = input.steering * MAX_STEER;
    // 按住转向时快速打到目标角；松键后缓慢回中
    const steerRate = targetSteer !== 0 ? STEER_APPLY_RATE : STEER_RETURN_RATE;
    this.steerCurrent += (targetSteer - this.steerCurrent) * Math.min(1, steerRate * dt);

    // 侧滑抑制：无转向输入时，衰减垂直于车头的速度分量（松开左右键后迅速回正行驶方向）
    if (Math.abs(input.steering) < 0.05) {
      const speed = this.chassis.velocity.length();
      if (speed > 2) {
        const fwd = new CANNON.Vec3(0, 0, 1);
        this.chassis.quaternion.vmult(fwd, fwd);
        const fwdComp = this.chassis.velocity.dot(fwd);
        const lateral = this.chassis.velocity.clone().vsub(fwd.clone().scale(fwdComp));
        lateral.y = 0; // 只抑制水平侧滑，不动垂直速度（避免干扰悬架）
        if (lateral.length() > 0.05) {
          this.chassis.velocity.vsub(lateral.scale(Math.min(1, 4 * dt)), this.chassis.velocity);
        }
      }
    }

    this.vehicle.setSteeringValue(this.steerCurrent, 0);
    this.vehicle.setSteeringValue(this.steerCurrent, 1);

    // RaycastVehicle 在 right=X(0)/forward=Z(2)/up=Y(1) 配置下，
    // 正发动机力会沿 -Z 推（实测倒车），因此取反：正油门 = 向前(+Z)。
    let force = -input.throttle * ENGINE_FORCE;
    // 转向时不允许无限加速：转向越深动力越低（满舵约 55% 动力）
    if (Math.abs(input.steering) > 0.05) {
      force *= 1 - 0.45 * Math.min(1, Math.abs(input.steering));
    }
    if (input.throttle > 0) {
      const fwdSpeed = this.forwardSpeed();
      // 前进限速 200km/h：接近上限时渐入削减动力，避免惯性超调（在 0.98×上限处完全切断）
      if (fwdSpeed >= FORWARD_MAX_SPEED * 0.85) {
        const taper = Math.max(0, 1 - (fwdSpeed - FORWARD_MAX_SPEED * 0.85) / (FORWARD_MAX_SPEED * 0.13));
        force *= taper;
      }
      // 转向时最高时速衰减到 50km/h
      if (Math.abs(input.steering) > 0.05 && fwdSpeed > TURN_MAX_SPEED * 0.9) {
        const taper = Math.max(0, 1 - (fwdSpeed - TURN_MAX_SPEED * 0.9) / (TURN_MAX_SPEED * 0.1));
        force *= taper;
      }
      // 防抬头后翻：PD 反扭矩（等效“防抬头杠”），把车头压回，不损失动力
      const up = new CANNON.Vec3(0, 1, 0);
      this.chassis.quaternion.vmult(up, up);
      const pitch = Math.acos(Math.max(-1, Math.min(1, up.y)));
      if (pitch > 0.04) {
        const right = new CANNON.Vec3(1, 0, 0);
        this.chassis.quaternion.vmult(right, right);
        const pitchRate = -this.chassis.angularVelocity.dot(right); // 正=抬头速率
        const counter = Math.min(15000, 90000 * pitch + 4000 * Math.max(0, pitchRate));
        this.chassis.torque.x += right.x * counter;
        this.chassis.torque.y += right.y * counter;
        this.chassis.torque.z += right.z * counter;
      }
    } else if (input.throttle < 0) {
      // 倒车限制：更小的加速力 + 最高倒车速度
      force = -input.throttle * ENGINE_FORCE * REVERSE_FORCE_RATIO;
      if (this.forwardSpeed() < -REVERSE_MAX_SPEED) {
        force = 0;
      }
    }
    // 后驱：动力给后轮（前轮起步抓地不足会浪费动力）
    this.vehicle.applyEngineForce(force, 2);
    this.vehicle.applyEngineForce(force, 3);

    // 松油门且不踩刹车时施加“发动机制动”，避免无阻力滑行
    const engineBrake = input.throttle === 0 && input.brake === 0 ? ENGINE_BRAKE : 0;
    const brake = Math.max(input.brake * BRAKE_FORCE, engineBrake);
    this.vehicle.setBrake(brake, 0);
    this.vehicle.setBrake(brake, 1);
    this.vehicle.setBrake(brake, 2);
    this.vehicle.setBrake(brake, 3);

    this.world.step(this.fixedTimeStep, dt, this.maxSubSteps);
  }

  getState(): VehicleState {
    const forward = new CANNON.Vec3(0, 0, 1);
    this.chassis.quaternion.vmult(forward, forward);
    const up = new CANNON.Vec3(0, 1, 0);
    this.chassis.quaternion.vmult(up, up);
    const forwardSpeed = this.chassis.velocity.dot(forward);
    return {
      position: this.chassis.position,
      quaternion: this.chassis.quaternion,
      forward,
      up,
      velocity: this.chassis.velocity,
      angularVelocity: this.chassis.angularVelocity,
      forwardSpeed,
      absoluteSpeed: this.chassis.velocity.length(),
    };
  }

  reset(position: CANNON.Vec3, quaternion: CANNON.Quaternion): void {
    this.chassis.position.copy(position);
    this.chassis.quaternion.copy(quaternion);
    this.chassis.velocity.setZero();
    this.chassis.angularVelocity.setZero();
    for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
      this.vehicle.updateWheelTransform(i);
    }
  }

  getWheelTransform(index: number): CANNON.Transform {
    this.vehicle.updateWheelTransform(index);
    return this.vehicle.wheelInfos[index].worldTransform;
  }

  getSteering(): number {
    return this.steerCurrent;
  }

  private forwardSpeed(): number {
    const fwd = new CANNON.Vec3(0, 0, 1);
    this.chassis.quaternion.vmult(fwd, fwd);
    return this.chassis.velocity.dot(fwd);
  }

  dispose(): void {
    this.chassis.removeEventListener('collide', this.onCollide);
    this.vehicle.removeFromWorld(this.world);
    this.world.removeBody(this.chassis);
  }
}
