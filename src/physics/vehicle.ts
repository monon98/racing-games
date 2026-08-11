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
  forwardSpeed: number;
  absoluteSpeed: number;
}

const MAX_STEER = 0.55;
const ENGINE_FORCE = 3200;
const BRAKE_FORCE = 170;

/** cannon-es 四轮车辆（RaycastVehicle 悬架） */
export class CarPhysics {
  readonly world: CANNON.World;
  readonly chassis: CANNON.Body;
  private readonly vehicle: CANNON.RaycastVehicle;
  private steerCurrent = 0;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    const chassisShape = new CANNON.Box(
      new CANNON.Vec3(CAR.width / 2 - 0.05, CAR.height * 0.32, CAR.length / 2 - 0.05),
    );
    this.chassis = new CANNON.Body({
      mass: 550,
      shape: chassisShape,
      // 线性阻尼模拟空气阻力/滚动阻力，避免松油门后滑行过长
      linearDamping: 0.25,
      angularDamping: 0.3,
    });

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
      suspensionStiffness: 30,
      suspensionRestLength: 0.32,
      maxSuspensionTravel: 0.35,
      frictionSlip: 2.1,
      dampingRelaxation: 2.4,
      dampingCompression: 4.0,
      maxSuspensionForce: 200000,
      rollInfluence: 0.08,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      useCustomSlidingRotationalSpeed: true,
      customSlidingRotationalSpeed: 30,
    };

    const zFront = CAR.length * 0.37;
    const zRear = -CAR.length * 0.37;
    // 轮距略宽于车身，前轮在追尾视角下可见
    const xOffset = CAR.width / 2 + 0.12;
    const yOffset = -0.3;
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
  }

  addGround(body: CANNON.Body): void {
    this.world.addBody(body);
  }

  update(input: VehicleInput, dt: number): void {
    const targetSteer = input.steering * MAX_STEER;
    this.steerCurrent += (targetSteer - this.steerCurrent) * Math.min(1, 6 * dt);

    this.vehicle.setSteeringValue(this.steerCurrent, 0);
    this.vehicle.setSteeringValue(this.steerCurrent, 1);

    // RaycastVehicle 在 right=X(0)/forward=Z(2)/up=Y(1) 配置下，
    // 正发动机力会沿 -Z 推（实测倒车），因此取反：正油门 = 向前(+Z)。
    const force = -input.throttle * ENGINE_FORCE;
    this.vehicle.applyEngineForce(force, 2);
    this.vehicle.applyEngineForce(force, 3);

    // 松油门且不踩刹车时施加“发动机制动”，避免无阻力滑行
    const engineBrake = input.throttle === 0 && input.brake === 0 ? 90 : 0;
    const brake = Math.max(input.brake * BRAKE_FORCE, engineBrake);
    this.vehicle.setBrake(brake, 0);
    this.vehicle.setBrake(brake, 1);
    this.vehicle.setBrake(brake, 2);
    this.vehicle.setBrake(brake, 3);

    this.world.step(1 / 60, dt, 3);
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

  dispose(): void {
    this.vehicle.removeFromWorld(this.world);
    this.world.removeBody(this.chassis);
  }
}
