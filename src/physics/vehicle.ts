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
/** 四驱（2026-10-23 用户要求）：前轴每轮在原后驱力基础上**叠加** force × FRONT_DRIVE_RATIO，
 *  前轴总驱动力 ≈ 后轴的一半（0.5）。前轮接地时生效（起步/出弯/爬坡明显更有力）；
 *  前轮悬空时自然回退为纯后驱——cannon-es 急加速重心后移本来就压空前轮（逐帧对照实验证明
 *  直线全油门时前悬架全程伸长极限），因此直线 0-100 与极速几乎不变。
 *  倒车+转向例外：四轮全给满力（保持 10 m/s 倒车转向上限行为）。
 *  所有四轮必须每帧都设置：cannon 的 wheel.engineForce 跨帧残留，漏设会让倒车转向后的动力
 *  残留到下一帧前进状态（顺带修掉此潜在 bug）。调 0.35 更后偏、0.6 更前偏。 */
const FRONT_DRIVE_RATIO = 0.5;
/** 油门缓入：踏板指令指数平滑速率（/s），约 0.15-0.2s 到 95%——起步不窜、四驱前轴咬合更稳；松开回零更快（×2.5） */
const THROTTLE_RAMP_RATE = 14;
/** 刹车偏置：前轮制动系数 0.6、后轮 (2−0.6)=1.4（总容量守恒 4×brake）——后偏压制急刹点头 */
const BRAKE_BIAS_FRONT = 0.6;
/** 前/后悬架压缩阻尼：对静态 squat 无效（只抗瞬态，实测差分加强反而伤复杂地形冲击缓冲，已撤销） */
const FRONT_DAMPING_COMPRESSION = 14;
/** 抗 squat 前馈：低头反扭矩 = FACTOR × 总驱动力（N·m/N）——推进力作用在接地点（重心下方），
 *  惯性反作用抬起车头是静态平衡，只能靠主动力矩抵消；接地+前进时施加。0.55=完全抵消（惯性力臂），
 *  实测：0.45 → 前 90 帧接地率 58%；0.55 会把后轮轴向压到**完全离地**（后驱失效，爬坡倒滑 −9m/s，已弃）。
 *  结构上限 12000：ΔF = counter/轴距 ≤ 4510N，任何工况下不卸空后轴。 */
const ATI_SQUAT_FACTOR = 0.45;
const ATI_SQUAT_MAX = 12000;
/** 空中角速度阻尼（/s）：四轮全离地时温和衰减角速度——防抬头 PD 空中 bang-bang 振荡，落地更顺 */
const AIR_ANGULAR_DAMPING = 1.2;
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
/** 转向梯形速度曲线（2026-10-25 用户反馈“左右向控制不够顺滑”，替换指数平滑）：
 *  指数式起步一帧吃 11.7% 满锁（键盘点按“猛一拽”）、收敛带长尾（松手黏、换向过零段最慢）。
 *  跟踪器三约束：v ≤ VMAX（匀速中段）、|dv| ≤ ACCEL·dt（软启动，首帧位移 ≈ a·dt²/2 ≈0.005rad）、
 *  v ≤ √(2·ACCEL·剩余角)（二次制动，零过冲贴齐）。全锁 0.65rad ≈0.26s 到位。 */
const STEER_SLEW_VMAX = 4.2; // rad/s 基准（满锁 0.65rad 需 ~0.15s 匀速），随速度再加成
const STEER_SLEW_ACCEL = 38; // rad/s² 起/减速共同限——“顺滑度”的主旋钮
/** 高速 vmax 加成：45m/s 时 vmax×2.3 ≈9.7 → 高速目标角小（0.12rad）近乎即时到位，
 *  沿用旧设计动机：松键后转向角不在前轮冲量上多停留，利用 yaw 惯量甩尾（2026-10-23 教训） */
const STEER_SLEW_SPEED_POWER = 1.3;
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
/** 抓地：前轴（转向轮）5——横向加速度 ≈1.4g，低于整车倾翻阈值（≈1.8g），同时保证 S 变向响应；
 *  2026-10-23 两端实测：前轴 10（≈2.8g）满舵兜圈+S 变向直接侧翻；角阻尼 1.0（每步清零角速度，
 *  旋转动力学失真）会掩盖滚转问题、表现得“永不翻车”但转向响应迟钝 */
const GRIP_FRONT = 5;
const GRIP_REAR = 3.2;
/** 前轴滑移时抓地滚动衰减（0.2→0.5 rad 间从 5 降到 3.3），甩尾后不至于彻底失控 */
const GRIP_FRONT_SLIDING = 3.3;
const GRIP_ROLL_START = 0.2;
const GRIP_ROLL_END = 0.5;
/** 侧滑抑制：侧偏角超过该值（rad）后抑制强度线性衰减到 0（ LooseKey 回正仍有效但不瞬间吸附漂移尾巴） */
const CENTERING_SLIP_FADE = 0.9;
/** 侧滑抑制强度保底（比例）：深侧滑也不至于完全不抑制，松手后 1s 内能收回来 */
const CENTERING_SLIP_FLOOR = 0.3;
/** 滚转稳定（街机防翻辅助）：接地时 up.y 低于该阈值才施加反侧倾力矩；与 P/D 增益按 2026-10-23 实测调参
 *（旧值角阻尼 1.0 等于每步清零角速度，旋转动力学失真掩盖了翻车问题） */
const ROLL_STAB_UP_LIMIT = 0.97;
const ROLL_STAB_TORQUE_MAX = 30000;
const ROLL_STAB_P = 160000;
const ROLL_STAB_D = 12000;
/** 防抬头 PD 反扭矩上限：≥2 轮接地时 20000；空中/坡顶冲出（<2 轮接触）时允许更大力矩——
 *  2026-10-23 复杂赛道实测：坡顶瞬间仅 1 轮接触 + 悬架弹射力矩（≈3 万 N·m）会把车打成后空翻，
 *  地面版上限压不住，需要空中加强版在 0.3s 内刹住俯仰旋转 */
const PITCH_COUNTER_MAX = 20000;
const PITCH_COUNTER_AIR_MAX = 48000;

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
  /** 转向轮角速度（梯形跟踪器状态，reset 清零） */
  private steerVel = 0;
  /** 油门缓入状态：平滑后的踏板量（0-1，reset 归零） */
  private throttleActual = 0;
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
      linearDamping: 0.05,
      // 角阻尼：1.0 会让 cannon 按 pow(1-1,dt)=0 每步直接清零角速度，旋转动力学完全失真
      // （2026-10-23 实测导致 S 变向迟钝、翻车被掩盖）；0.75 保留真实感又压制复杂地形瞬态
      angularDamping: 0.75,
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
      dampingCompression: FRONT_DAMPING_COMPRESSION,
      maxSuspensionForce: 200000,
      rollInfluence: 0.05,
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

  /**
   * 转向梯形速度曲线跟踪器（rad、rad/s 态机）：
   * 目标角速度受三约束：|v| ≤ vmax（速度门随速加成）、v 不超过 √(2·a·剩余角)
   * （恰好停在目标 → 无过冲）、|Δv| ≤ a·dt（限加速度 → 软启动/软停止）。
   * 打角与回正共用同一跟踪器（松手回正同样受制动约束，不再"匀速冲到 0 再突停"）。
   */
  private trackSteer(target: number, dt: number): void {
    const diff = target - this.steerCurrent;
    if (Math.abs(diff) < 1e-5) {
      this.steerCurrent = target;
      this.steerVel = 0; // 贴齐即清残留速度，避免下一步轻推轮角
      return;
    }
    const speedT = Math.min(1, Math.max(0, this.forwardSpeed()) / STEER_FALLOFF_SPEED);
    const vmax = STEER_SLEW_VMAX * (1 + STEER_SLEW_SPEED_POWER * speedT);
    const goalVel = Math.sign(diff) * Math.min(vmax, Math.sqrt(2 * STEER_SLEW_ACCEL * Math.abs(diff)));
    const dvMax = STEER_SLEW_ACCEL * dt;
    this.steerVel += Math.max(-dvMax, Math.min(dvMax, goalVel - this.steerVel));
    const next = this.steerCurrent + this.steerVel * dt;
    // 数值兜底：越目标即贴齐并把速度清零（正常被制动约束自然拦下，罕见于积分量化边界）
    if ((next - target) * diff >= 0 || Math.abs(next - target) < 1e-5) {
      this.steerCurrent = target;
      this.steerVel = 0;
      return;
    }
    this.steerCurrent = next;
  }

  update(input: VehicleInput, dt: number): void {
    // 转向角随速度衰减（速度敏感转向）：低速灵活，高速收敛
    const targetSteer = input.steering * this.maxSteerAt(Math.max(0, this.forwardSpeed()));
    // 梯形跟踪：打角/回正统一走"角加速度受限 + vmax + 二次制动"速度曲线（常量区注释）；
    // 高速 vmax 加成沿用旧设计动机——松键后转向角不在前轮冲量上多停留（yaw 惯量甩尾根源）
    this.trackSteer(targetSteer, dt);

    // 油门缓入：踏板指令指数平滑后再进入动力计算（起步不窜、四驱前轴咬合更稳）；松油门回零更快
    const throttleRate = input.throttle !== 0 ? THROTTLE_RAMP_RATE : THROTTLE_RAMP_RATE * 2.5;
    this.throttleActual += (input.throttle - this.throttleActual) * Math.min(1, throttleRate * dt);

    const slipAngle = this.computeSlipAngle();
    const absSpeed = this.chassis.velocity.length();

    // 漂移状态机（侧偏角驱动，带迟滞）：高速 + 大侧偏进入，侧偏回落或车辆降速退出。
    if (!this.drift) {
      if (absSpeed > DRIFT_MIN_SPEED && slipAngle > DRIFT_SLIP_ENTER) this.drift = true;
    } else if (slipAngle < DRIFT_SLIP_EXIT || absSpeed < 4) {
      this.drift = false;
    }

    // 侧滑抑制：无转向输入时衰减横向速度分量（松键回正）。
    // 强度随侧偏角渐变：小侧偏全量（快速回直），大侧偏时减弱 → 松手也能收回来但漂移/甩尾尾巴不会被瞬间“吸附”。
    if (Math.abs(input.steering) < 0.05) {
      const speed = this.chassis.velocity.length();
      if (speed > 2) {
        const strength = 4 * Math.max(CENTERING_SLIP_FLOOR, 1 - slipAngle / CENTERING_SLIP_FADE);
        const fwd = new CANNON.Vec3(0, 0, 1);
        this.chassis.quaternion.vmult(fwd, fwd);
        const fwdComp = this.chassis.velocity.dot(fwd);
        const lateral = this.chassis.velocity.clone().vsub(fwd.clone().scale(fwdComp));
        lateral.y = 0; // 只抑制水平侧滑，不动垂直速度（避免干扰悬架）
        if (lateral.length() > 0.05) {
          this.chassis.velocity.vsub(lateral.scale(Math.min(1, strength * dt)), this.chassis.velocity);
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
    let force = -this.throttleActual * ENGINE_FORCE;
    // 转向时不允许无限加速：转向越深动力越低（满舵约 55% 动力；出弯线性恢复）
    if (Math.abs(input.steering) > 0.05) {
      force *= 1 - 0.45 * Math.min(1, Math.abs(input.steering));
    }
    if (this.throttleActual > 0) {
      const fwdSpeed = this.forwardSpeed();
      // 前进限速 200km/h：接近上限时渐入削减动力，避免惯性超调（在 0.98×上限处完全切断）
      if (fwdSpeed >= FORWARD_MAX_SPEED * 0.85) {
        const taper = Math.max(0, 1 - (fwdSpeed - FORWARD_MAX_SPEED * 0.85) / (FORWARD_MAX_SPEED * 0.13));
        force *= taper;
      }
      // 过弯限速“50km/h 硬截断 + ramp 刹车”已移除：转向能力改为随速度衰减（maxSteerAt），
      // 高速过弯靠动力削减与抓地下降自然受限，不再有“撞限速墙”感。
      // 防抬头后翻：PD 反扭矩（等效“防抬头杠”）——抬角度数取“车头相对路面法线的带符号角”
      // （asin(forward·normal)）：车身贴合坡面时天然 ≈0（斜坡不误伤），越过 90°（倒栽）方向依旧正确——
      // 2026-10-23 实测：acos(up·normal) 版在越过 90° 后会把已经翻过头的车继续往旋转方向推，转为失控空翻
      const groundNormal = new CANNON.Vec3(0, 1, 0);
      let groundCount = 0;
      for (const w of this.vehicle.wheelInfos) {
        if (w.isInContact && w.raycastResult.hitNormalWorld) {
          groundNormal.vadd(w.raycastResult.hitNormalWorld, groundNormal);
          groundCount++;
        }
      }
      groundNormal.normalize();

      // 抗 squat 前馈：推进力作用于接地点（重心下方），惯性反作用掀起车头（静态平衡，
      // 悬架差分压缩阻尼无效——实测 21/120 接地率）。施加与总驱动力成比例的低头反扭矩，
      // 保持前轮接地让四驱前轴在直线也生效；空中不介入（groundCount=0 时跳过）。
      // 速度门 <30m/s：squat 只在起步/中速大油门真实发生；高速满舵稳态过弯阶段必须关闭，
      // 否则稳态侧偏翻倍（实测 0.35/0.45 系数下均如此）。
      if (groundCount > 0 && fwdSpeed < 30) {
        const totalDrive = 2 * Math.abs(force) * (1 + FRONT_DRIVE_RATIO);
        const squatCounter = Math.min(ATI_SQUAT_MAX, ATI_SQUAT_FACTOR * totalDrive);
        const rightAxis = new CANNON.Vec3(1, 0, 0);
        this.chassis.quaternion.vmult(rightAxis, rightAxis);
        this.chassis.torque.x += rightAxis.x * squatCounter;
        this.chassis.torque.y += rightAxis.y * squatCounter;
        this.chassis.torque.z += rightAxis.z * squatCounter;
      }

      const fwdNow = new CANNON.Vec3(0, 0, 1);
      this.chassis.quaternion.vmult(fwdNow, fwdNow);
      const pitchUp = Math.asin(Math.max(-1, Math.min(1, fwdNow.dot(groundNormal))));
      // 阈值 0.03：低于“前轮悬垂落空”的俯仰角（≈0.023 rad 的两倍量级），满油门不误压前轮
      if (pitchUp > 0.03) {
        const right = new CANNON.Vec3(1, 0, 0);
        this.chassis.quaternion.vmult(right, right);
        const pitchRate = -this.chassis.angularVelocity.dot(right); // 正=抬头速率
        // 接地轮 <2 时认为“即将离地/坡顶冲出”，启用空中加强版反扭矩压制后空翻
        const counter = Math.min(
          groundCount < 2 ? PITCH_COUNTER_AIR_MAX : PITCH_COUNTER_MAX,
          160000 * pitchUp + 8000 * Math.max(0, pitchRate),
        );
        this.chassis.torque.x += right.x * counter;
        this.chassis.torque.y += right.y * counter;
        this.chassis.torque.z += right.z * counter;
      }
    } else if (input.throttle < 0) {
      // 倒车限制：更小的加速力 + 最高倒车速度
      // 倒车+转向时给满反向动力，让倒车转弯能实际达到 10 m/s 上限
      const reverseRatio = Math.abs(input.steering) > 0.05 ? 1.0 : REVERSE_FORCE_RATIO;
      force = -this.throttleActual * ENGINE_FORCE * reverseRatio;
      const reverseMax = Math.abs(input.steering) > 0.05 ? REVERSE_TURN_MAX_SPEED : REVERSE_MAX_SPEED;
      if (this.forwardSpeed() < -reverseMax || this.chassis.velocity.length() > reverseMax) {
        force = 0;
      }
    }
    // 四驱：前轴每轮额外叠加 force × FRONT_DRIVE_RATIO（前轮接地时才实际产生推力，前轮悬空
    // 时自然回退为纯后驱）；倒车+转向时四轮全给满力（保证倒车转弯能加速到 10 m/s 上限，同旧逻辑）。
    // 四轮每帧必须都设置：cannon 的 wheel.engineForce 跨帧残留，漏设会让上一帧的动力延续。
    const reverseTurnBoost = input.throttle < 0 && Math.abs(input.steering) > 0.05;
    const frontForce = reverseTurnBoost ? force : force * FRONT_DRIVE_RATIO;
    this.vehicle.applyEngineForce(frontForce, 0);
    this.vehicle.applyEngineForce(frontForce, 1);
    this.vehicle.applyEngineForce(force, 2);
    this.vehicle.applyEngineForce(force, 3);

    // 松油门且不踩刹车时施加制动：无转向只缓慢滑行；按住左右键或正在倒车则快速降速
    const reversing = this.forwardSpeed() < -0.5;
    const engineBrake = input.throttle === 0 && input.brake === 0
      ? (Math.abs(input.steering) > 0.05 || reversing ? ENGINE_BRAKE : COAST_BRAKE)
      : 0;
    const brake = Math.max(input.brake * BRAKE_FORCE, engineBrake);
    // 刹车偏置：前 0.6 / 后 1.4（总容量守恒 4×brake）——后偏压制急刹点头，同时前轮保留转向抓地
    this.vehicle.setBrake(brake * BRAKE_BIAS_FRONT, 0);
    this.vehicle.setBrake(brake * BRAKE_BIAS_FRONT, 1);
    this.vehicle.setBrake(brake * (2 - BRAKE_BIAS_FRONT), 2);
    this.vehicle.setBrake(brake * (2 - BRAKE_BIAS_FRONT), 3);

    // 空中姿态阻尼（完全离地时）：温和衰减角速度——防抬头 PD 在空中不会 bang-bang 振荡，落地更顺。
    // 缓慢（~1.2/s），不影响正常跳跃的抛物线与坡顶空中 PD 的救车能力。
    if (this.vehicle.wheelInfos.every((w) => !w.isInContact)) {
      const airDamp = Math.max(0, 1 - AIR_ANGULAR_DAMPING * dt);
      this.chassis.angularVelocity.scale(airDamp, this.chassis.angularVelocity);
    }

    // 滚转稳定（街机防翻辅助）：接地且车身明显侧倾（up.y 低）时，沿车头方向施加反侧倾力矩。
    // 防止“油门+满舵”过弯或山坡瞬态侧翻（角阻尼 1.0 曾每步清零角速度，掩盖了翻车；
    // 降到真实动力学后需要这个辅助保持街机可控感）。空中不介入，落地仍会自然翻转/弹跳。
    {
      let rollWheels = 0;
      for (const w of this.vehicle.wheelInfos) {
        if (w.isInContact) rollWheels++;
      }
      if (rollWheels > 0) {
        const upNow = new CANNON.Vec3(0, 1, 0);
        this.chassis.quaternion.vmult(upNow, upNow);
        if (upNow.y < ROLL_STAB_UP_LIMIT) {
          const rightNow = new CANNON.Vec3(1, 0, 0);
          this.chassis.quaternion.vmult(rightNow, rightNow);
          const fwdNow = new CANNON.Vec3(0, 0, 1);
          this.chassis.quaternion.vmult(fwdNow, fwdNow);
          // 侧倾角：右轴竖直分量>0 = 右侧抬起（车体向左滚转）；>1 侧 = 反向
          const roll = Math.asin(Math.max(-1, Math.min(1, rightNow.y)));
          const rollRate = this.chassis.angularVelocity.dot(fwdNow);
          const counter = Math.min(ROLL_STAB_TORQUE_MAX, ROLL_STAB_P * roll + ROLL_STAB_D * rollRate);
          this.chassis.torque.x -= fwdNow.x * counter;
          this.chassis.torque.y -= fwdNow.y * counter;
          this.chassis.torque.z -= fwdNow.z * counter;
        }
      }
    }

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
    this.throttleActual = 0;
    this.steerVel = 0;
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
