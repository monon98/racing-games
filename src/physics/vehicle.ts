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

const MAX_STEER = 0.8;
// 质量加重（抗飞起）；发动机力同步提高保持 0-100 约 1.5s（7500×2/750≈20 m/s²）；
// 倒车约等于旧正向加速：7500 × 0.65 ≈ 4875N/轮
const ENGINE_FORCE = 7500;
const REVERSE_FORCE_RATIO = 0.65;
const REVERSE_MAX_SPEED = 8; // m/s ≈ 29 km/h
/** 倒车+转向时最高倒车速度：10 m/s ≈ 36 km/h */
const REVERSE_TURN_MAX_SPEED = 10;
const FORWARD_MAX_SPEED = 200 / 3.6; // 200 km/h
const TURN_MAX_SPEED = 50 / 3.6; // 转向时最高时速 50 km/h
const BRAKE_FORCE = 55;
const ENGINE_BRAKE = 50;
/** 单纯松油门（无转向）的滑行制动，缓慢减速；带转向时用 ENGINE_BRAKE 快速降速 */
const COAST_BRAKE = 4;
/** 空中上升速度上限（m/s），限制上坡/过顶时的飞起幅度（约 0.1m 高） */
const MAX_AIR_UPWARD_SPEED = 1.5;
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
  private drift = false;
  private yawSign = 0;
  private yawFlips = 0;
  private yawWindow = 0;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    const chassisShape = new CANNON.Box(
      // 底盘与车身同宽（护栏判定覆盖整个车身）、重心低、离地高
      new CANNON.Vec3(CAR.width / 2, CAR.height * 0.26, CAR.length / 2 - 0.05),
    );
    this.chassis = new CANNON.Body({
      mass: 750,
      // 线性阻尼模拟空气阻力/滚动阻力，避免松油门后滑行过长
      // 线性阻尼 0.12：极速可达 200+km/h，松油仍能缓慢减速
      linearDamping: 0.05,
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
      dampingRelaxation: 6.0,
      dampingCompression: 14,
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
    // 轮位碰撞盒：把外露轮子纳入护栏碰撞判定（视觉轮子本身无 cannon 碰撞体）
    const wheelCollider = new CANNON.Box(new CANNON.Vec3(0.22, 0.42, 0.22));
    for (const [x, z] of [
      [-xOffset, zFront],
      [xOffset, zFront],
      [-xOffset, zRear],
      [xOffset, zRear],
    ]) {
      this.chassis.addShape(wheelCollider, new CANNON.Vec3(x, yOffset, z));
    }
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

    // 抖动 → 漂移：满舵 + 油门时横摆率在 0.6s 内翻转 ≥2 次（第二次抖动），进入可控侧滑/失控，
    // 降低抓地力避免持续抖动；松开转向后立即恢复。
    if (Math.abs(input.steering) > 0.5 && input.throttle > 0) {
      const yawRate = this.chassis.angularVelocity.y;
      const sig = Math.sign(yawRate);
      if (sig !== 0 && sig !== this.yawSign) {
        if (this.yawSign !== 0) {
          this.yawFlips++;
          if (this.yawFlips >= 2) this.drift = true;
        }
        this.yawSign = sig;
      }
      this.yawWindow += dt;
      if (this.yawWindow > 0.6) {
        this.yawFlips = 0;
        this.yawWindow = 0;
      }
    } else {
      this.yawSign = 0;
      this.yawFlips = 0;
      this.yawWindow = 0;
      this.drift = false;
    }
    const slip = this.drift ? 2.4 : 3.2;
    for (const w of this.vehicle.wheelInfos) {
      w.frictionSlip = slip;
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
      // 倒车+转向时给满反向动力，让倒车转弯能实际达到 10 m/s 上限
      const reverseRatio = Math.abs(input.steering) > 0.05 ? 1.0 : REVERSE_FORCE_RATIO;
      force = -input.throttle * ENGINE_FORCE * reverseRatio;
      const reverseMax = Math.abs(input.steering) > 0.05 ? REVERSE_TURN_MAX_SPEED : REVERSE_MAX_SPEED;
      if (this.forwardSpeed() < -reverseMax || this.chassis.velocity.length() > reverseMax) {
        force = 0;
      }
    }
    // 后驱：动力给后轮；倒车+转向时也把动力给前轮，避免原地打转，让倒车转弯能加速到上限
    if (input.throttle < 0 && Math.abs(input.steering) > 0.05) {
      this.vehicle.applyEngineForce(force, 0);
      this.vehicle.applyEngineForce(force, 1);
    }
    this.vehicle.applyEngineForce(force, 2);
    this.vehicle.applyEngineForce(force, 3);

    // 松油门且不踩刹车时施加制动：无转向只缓慢滑行；按住左右键则快速降速
    const engineBrake = input.throttle === 0 && input.brake === 0
      ? (Math.abs(input.steering) > 0.05 ? ENGINE_BRAKE : COAST_BRAKE)
      : 0;
    // 转向限速（50km/h）：除削减动力外，超速时对四轮施加制动，避免低阻尼下无法降速
    let brake = Math.max(input.brake * BRAKE_FORCE, engineBrake);
    if (input.throttle > 0 && Math.abs(input.steering) > 0.05) {
      const fwdSpeed = this.forwardSpeed();
      if (fwdSpeed > TURN_MAX_SPEED * 0.9) {
        const over = Math.min(1, (fwdSpeed - TURN_MAX_SPEED * 0.9) / (TURN_MAX_SPEED * 0.1));
        brake = Math.max(brake, BRAKE_FORCE * over);
      }
    }
    this.vehicle.setBrake(brake, 0);
    this.vehicle.setBrake(brake, 1);
    this.vehicle.setBrake(brake, 2);
    this.vehicle.setBrake(brake, 3);

    this.world.step(this.fixedTimeStep, dt, this.maxSubSteps);

    // 空中垂直速度钳制：四轮离地时限制上升速度，避免高速上坡/过顶时飞太高
    let wheelsOnGround = 0;
    for (const w of this.vehicle.wheelInfos) {
      if (w.isInContact) wheelsOnGround++;
    }
    // 倒车+转向的绝对速度钳制（HUD 上限 10 m/s ≈ 36 km/h）
    if (input.throttle < 0 && Math.abs(input.steering) > 0.05) {
      const v = this.chassis.velocity;
      const len = v.length();
      if (len > REVERSE_TURN_MAX_SPEED) {
        v.scale(REVERSE_TURN_MAX_SPEED / len, v);
      }
    }
    if (wheelsOnGround < 4 && this.chassis.velocity.y > MAX_AIR_UPWARD_SPEED) {
      this.chassis.velocity.y = MAX_AIR_UPWARD_SPEED;
    }
    // 四轮全离地（真正飞起）时额外下压力 + 更低上升速度上限，压缩山脊/过顶的滞空时间
    if (wheelsOnGround === 0) {
      if (this.chassis.velocity.y > 0.6) {
        this.chassis.velocity.y = 0.6;
      }
      this.chassis.force.y -= 24000; // ≈3.2g 下压力，下个物理步生效
    }
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

  getDrifting(): boolean {
    return this.drift;
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
