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

// 转向为速度敏感曲线：低速灵活（37°），高速平滑衰减到 7°（STEER_FALLOFF_SPEED 处到底）
const MAX_STEER_SLOW = 0.65;
const MAX_STEER_FAST = 0.12;
/** 转向角衰减到最小的速度（m/s，≈162km/h；极速 200km/h 前已到底） */
const STEER_FALLOFF_SPEED = 45;
// 质量加重（抗飞起）；发动机力同步提高保持 0-100 约 1.5s（7500×2/750≈20 m/s²）；
// 倒车约等于旧正向加速：7500 × 0.65 ≈ 4875N/轮
const ENGINE_FORCE = 7500;
const REVERSE_FORCE_RATIO = 0.65;
const REVERSE_MAX_SPEED = 8; // m/s ≈ 29 km/h
/** 倒车+转向时最高倒车速度：10 m/s ≈ 36 km/h */
const REVERSE_TURN_MAX_SPEED = 10;
const FORWARD_MAX_SPEED = 200 / 3.6; // 200 km/h
const BRAKE_FORCE = 55;
const ENGINE_BRAKE = 50;
/** 单纯松油门（无转向）的滑行制动，缓慢减速；带转向时用 ENGINE_BRAKE 快速降速 */
const COAST_BRAKE = 4;
/** 四轮全离地时的上升速度上限（m/s）：只防止极端弹射，下落完全交给重力 */
const MAX_AIR_UPWARD_SPEED = 2.0;
/** 松左右键后轮子回中速度（慢）；按住转向时响应速度（快） */
const STEER_RETURN_RATE = 5.5;
const STEER_APPLY_RATE = 7;
/** 底盘原点在静止时的离地高度（|连接点y| 0.24 + 悬架静止长 0.38 + 轮半径 0.4 = 1.02，+0.03 落差），重生/出生用 */
export const CHASSIS_SPAWN_HEIGHT = 1.05;
/** 碰撞回弹：撞护栏后沿接触法线立即反弹的比例（restitution） */
const COLLISION_BOUNCE = 0.35;
/** 碰撞减速：碰撞后整体速度保留比例（固定减速 20%） */
const COLLISION_SPEED_RETAIN = 0.8;
/** 低于该法向冲击速度（m/s）不主动回弹（贴墙低速接触不抖动） */
const COLLISION_MIN_IMPACT = 1.2;
/** 漂移状态（HUD 用）：进入/退出侧偏角阈值（rad）与最低进入速度（m/s） */
const DRIFT_SLIP_ENTER = 0.35;
const DRIFT_SLIP_EXIT = 0.15;
const DRIFT_MIN_SPEED = 8;
/** 抓地：前轴（转向轮）10——转向响应充足；后轴（驱动轮）3.2——油门占摩擦椭圆后侧向余量小，
 *  重刹/大转角瞬态时后轮先滑动 → 动力甩尾倾向；漂移检测用侧偏角瞬态即可命中 */
const GRIP_FRONT = 10;
const GRIP_REAR = 3.2;
/** 前轴滑移时抓地滚动衰减（0.2→0.5 rad 间从 10 降到 5.5），甩尾后不至于彻底失控 */
const GRIP_FRONT_SLIDING = 5.5;
const GRIP_ROLL_START = 0.2;
const GRIP_ROLL_END = 0.5;
/** 侧偏角小于该值（rad）时才施加“松键回正”侧滑抑制，避免打断真实漂移 */
const CENTERING_SLIP_LIMIT = 0.25;

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
  /** 本步内最强的一次护栏接触（在 step 后统一施加回弹） */
  private barrierHit: { body: CANNON.Body; normal: CANNON.Vec3; impact: number } | null = null;
  private steerCurrent = 0;
  private drift = false;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    // 整车单一碰撞盒（2026-10-20 用户要求：以小车为一个完整模型判断碰撞，不再有轮位附加碰撞盒）
    // 底盘与车身同宽、覆盖全车；重心低、离地高
    const chassisShape = new CANNON.Box(
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
        // 记录最强冲击，step 后统一施加“立即回弹 + 适当减速”（见 update 尾部）
        if (!this.barrierHit || impact > this.barrierHit.impact) {
          // 接触法线 ni 统一取“从障碍指向车身”的方向：若反向则翻转
          const n = event.contact.ni.clone();
          const away = this.chassis.position.vsub(event.body.position);
          if (away.length() > 0 && n.dot(away) < 0) n.negate(n);
          this.barrierHit = { body: event.body, normal: n, impact };
        }
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

  /** 速度敏感最大转向角：低速 MAX_STEER_SLOW，高速平滑衰减到 MAX_STEER_FAST */
  maxSteerAt(speed: number): number {
    const t = Math.min(1, Math.max(0, speed) / STEER_FALLOFF_SPEED);
    // 二次 ease-out：速度前段衰减更快（低速保留灵活性），高速更收敛
    const eased = 1 - (1 - t) * (1 - t);
    return MAX_STEER_SLOW + (MAX_STEER_FAST - MAX_STEER_SLOW) * eased;
  }

  /** 车身侧偏角（rad）：横向速度相对前进速度的 atan2（取绝对值） */
  private computeSlipAngle(): number {
    const fwd = new CANNON.Vec3(0, 0, 1);
    this.chassis.quaternion.vmult(fwd, fwd);
    const right = new CANNON.Vec3(1, 0, 0);
    this.chassis.quaternion.vmult(right, right);
    const v = this.chassis.velocity;
    const fwdComp = Math.max(Math.abs(v.dot(fwd)), 0.5);
    return Math.atan2(Math.abs(v.dot(right)), fwdComp);
  }

  update(input: VehicleInput, dt: number): void {
    // 转向角随速度衰减（速度敏感转向）：低速灵活，高速收敛
    const targetSteer = input.steering * this.maxSteerAt(Math.max(0, this.forwardSpeed()));
    // 按住转向时快速打到目标角；松键后较快回中
    const steerRate = targetSteer !== 0 ? STEER_APPLY_RATE : STEER_RETURN_RATE;
    this.steerCurrent += (targetSteer - this.steerCurrent) * Math.min(1, steerRate * dt);

    const slipAngle = this.computeSlipAngle();
    const absSpeed = this.chassis.velocity.length();

    // 漂移状态机（侧偏角驱动，带迟滞）：高速 + 大侧偏进入，侧偏回落或车辆降速退出。
    if (!this.drift) {
      if (absSpeed > DRIFT_MIN_SPEED && slipAngle > DRIFT_SLIP_ENTER) this.drift = true;
    } else if (slipAngle < DRIFT_SLIP_EXIT || absSpeed < 4) {
      this.drift = false;
    }

    // 侧滑抑制：仅在无转向输入且车身接近直线（小侧偏角）时，衰减横向速度分量。
    // 大侧偏（漂移中）不抑制——让动力滑移自然延续，松键也不立即“吸附”回直。
    if (Math.abs(input.steering) < 0.05 && slipAngle < CENTERING_SLIP_LIMIT) {
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

    // 前轴抓地随侧偏角滚动衰减；后轴保持低抓地（动力甩尾倾向）
    const gripT = Math.min(1, Math.max(0, (slipAngle - GRIP_ROLL_START) / (GRIP_ROLL_END - GRIP_ROLL_START)));
    for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
      const w = this.vehicle.wheelInfos[i];
      w.frictionSlip = i < 2
        ? GRIP_FRONT + (GRIP_FRONT_SLIDING - GRIP_FRONT) * gripT
        : GRIP_REAR;
    }

    this.vehicle.setSteeringValue(this.steerCurrent, 0);
    this.vehicle.setSteeringValue(this.steerCurrent, 1);

    // RaycastVehicle 在 right=X(0)/forward=Z(2)/up=Y(1) 配置下，
    // 正发动机力会沿 -Z 推（实测倒车），因此取反：正油门 = 向前(+Z)。
    let force = -input.throttle * ENGINE_FORCE;
    // 转向时不允许无限加速：转向越深动力越低（满舵约 55% 动力；出弯线性恢复）
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
      // 过弯限速“50km/h 硬截断 + ramp 刹车”已移除：转向能力改为随速度衰减（maxSteerAt），
      // 高速过弯靠动力削减与抓地下降自然受限，不再有“撞限速墙”感。
      // 防抬头后翻：PD 反扭矩（等效“防抬头杠”），把车头压回，不损失动力。
      // 阈值必须低于“前轮悬垂落空”的俯仰角（轮距·半轴距 ≈ 0.023 rad）：
      // 否则满油门时前轮离地、高速转向完全失效（2026-10-23 实测根因）。
      const groundNormal = new CANNON.Vec3(0, 1, 0);
      let groundCount = 0;
      for (const w of this.vehicle.wheelInfos) {
        if (w.isInContact && w.raycastResult.hitNormalWorld) {
          groundNormal.vadd(w.raycastResult.hitNormalWorld, groundNormal);
          groundCount++;
        }
      }
      if (groundCount > 0) groundNormal.normalize();
      const up = new CANNON.Vec3(0, 1, 0);
      this.chassis.quaternion.vmult(up, up);
      const pitch = Math.acos(Math.max(-1, Math.min(1, up.dot(groundNormal))));
      // 阈值 0.03：低于“前轮悬垂落空”的俯仰角（≈0.023 rad 的两倍量级，兼顾斜坡不误伤），
      // 力度介于原版（90000/4000/15000）与“防前轮离地”更强版本（260000/8000/24000）之间
      if (pitch > 0.03) {
        const right = new CANNON.Vec3(1, 0, 0);
        this.chassis.quaternion.vmult(right, right);
        const pitchRate = -this.chassis.angularVelocity.dot(right); // 正=抬头速率
        const counter = Math.min(20000, 160000 * pitch + 8000 * Math.max(0, pitchRate));
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

    // 松油门且不踩刹车时施加制动：无转向只缓慢滑行；按住左右键或正在倒车则快速降速
    const reversing = this.forwardSpeed() < -0.5;
    const engineBrake = input.throttle === 0 && input.brake === 0
      ? (Math.abs(input.steering) > 0.05 || reversing ? ENGINE_BRAKE : COAST_BRAKE)
      : 0;
    const brake = Math.max(input.brake * BRAKE_FORCE, engineBrake);
    for (let i = 0; i < 4; i++) this.vehicle.setBrake(brake, i);

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
    if (wheelsOnGround === 0 && this.chassis.velocity.y > MAX_AIR_UPWARD_SPEED) {
      this.chassis.velocity.y = MAX_AIR_UPWARD_SPEED;
    }

    // 碰撞响应：撞护栏后沿接触法线立即回弹，并整体适当减速（避免反弹后仍高速贴墙蹭行）。
    if (this.barrierHit) {
      const { normal, impact } = this.barrierHit;
      this.barrierHit = null;
      const v = this.chassis.velocity;
      const vn = v.dot(normal); // < 0 = 速度分量仍朝向护栏
      if (impact > COLLISION_MIN_IMPACT && vn < 0.5) {
        // 法向分量重置为向外反弹速度（0.35 × 冲击，最低 0.8m/s），切向保留
        const rebound = Math.max(COLLISION_BOUNCE * impact, 0.8);
        v.vsub(normal.clone().scale(vn + rebound), v);
        // 整体减速：保留原速度的 80%
        v.scale(COLLISION_SPEED_RETAIN, v);
      }
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
    this.barrierHit = null;
    for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
      this.vehicle.updateWheelTransform(i);
    }
  }

  getWheelTransform(index: number): CANNON.Transform {
    this.vehicle.updateWheelTransform(index);
    return this.vehicle.wheelInfos[index].worldTransform;
  }

  /** 调试用：当前各轮关键状态（接触/悬架力/侧向冲量/滑移标记） */
  debugWheelStates(): Array<{ isInContact: boolean; suspensionForce: number; sideImpulse: number; skidInfo: number; sliding: boolean; slipAngle: number }> {
    return this.vehicle.wheelInfos.map((w, i) => ({
      isInContact: w.isInContact,
      suspensionForce: w.suspensionForce,
      sideImpulse: w.sideImpulse,
      skidInfo: w.skidInfo,
      sliding: w.sliding,
      slipAngle: this.vehicle.wheelInfos[i].steering,
    }));
  }

  getSteering(): number {
    return this.steerCurrent;
  }

  getDrifting(): boolean {
    return this.drift;
  }

  /** 当前车身侧偏角（rad），供 HUD 与调试 */
  getSlipAngle(): number {
    return this.computeSlipAngle();
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
