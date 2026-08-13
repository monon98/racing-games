import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { buildCar, type CarVisual } from '../car/createCar';
import {
  DISTANCE_PENALTY_SEC_PER_M,
  FLIP_ANGLE_DEG,
  FLIP_HOLD_MS,
  OFFTRACK_HOLD_MS,
  OFFTRACK_MARGIN,
  TIME_PENALTY_MS,
} from '../config';
import { CarPhysics, CHASSIS_SPAWN_HEIGHT, type VehicleInput } from '../physics/vehicle';
import { addLeaderboardEntry } from '../storage/db';
import { findSafeSpawnIndex, type BuiltTrack } from '../track/generator';
import { createHUD, type HudRefs } from '../ui/hud';
import { drawMinimap } from '../ui/minimap';
import { updateLapProgress } from './lapProgress';

export interface GameOptions {
  playerName: string;
  carColor: string;
  onBack: () => void;
  onRestart: () => void;
}

export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly clock = new THREE.Clock();
  private readonly track: BuiltTrack;
  private readonly car: CarVisual;
  private readonly physics: CarPhysics;
  private readonly hud: HudRefs;
  private readonly opts: GameOptions;

  private readonly keys = new Set<string>();
  private paused = false;
  private finished = false;
  private readonly startTime = performance.now();
  private timePenaltyMs = 0;
  private distancePenaltyM = 0;
  private flips = 0;
  private lastS = 0;
  private completedDistance = 0;
  private offTrackTimer = 0;
  private flipTimer = 0;
  private wrongWayTime = 0;
  private shake = 0;
  private readonly flashEl: HTMLDivElement;

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onResize: () => void;

  constructor(container: HTMLElement, track: BuiltTrack, opts: GameOptions) {
    this.container = container;
    this.track = track;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCF 比 PCFSoft 边缘更稳定，减少阴影闪烁
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';

    this.scene.background = new THREE.Color(0x87bceb);
    this.scene.fog = new THREE.Fog(0x87bceb, 260, 1100);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.camera.position.set(0, 6, 20);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7f66, 1.05));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(120, 180, 80);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // 阴影相机跟随车辆，避免车辆在固定阴影图上跨纹素导致阴影抖动
    this.sun.shadow.camera.left = -90;
    this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90;
    this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.far = 500;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(track.group);
    this.car = buildCar(opts.carColor);
    this.scene.add(this.car.group);
    // 轮子改为场景直属子节点：物理返回的是世界坐标变换，作为车体子节点会双重偏移（曾导致轮子“消失”）
    for (const wheel of this.car.wheels) {
      this.scene.add(wheel);
    }

    this.physics = new CarPhysics();
    this.physics.addGround(track.physics.ground);
    for (const b of track.physics.barriers) {
      this.physics.addGround(b);
      this.physics.markBarrier(b);
    }
    this.physics.onBarrierCollide = (impact) => {
      if (impact < 6) return;
      this.shake = Math.min(0.5, 0.12 + impact * 0.008);
      this.flashEl.classList.remove('active');
      void this.flashEl.offsetWidth; // 重启动画
      this.flashEl.classList.add('active');
    };

    this.flashEl = document.createElement('div');
    this.flashEl.className = 'collision-flash';
    container.appendChild(this.flashEl);

    const startIdx = findSafeSpawnIndex(track, 0);
    const start = track.points[startIdx];
    const tangent = track.tangents[0].clone();
    tangent.y = 0;
    tangent.normalize();
    const startQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    this.physics.reset(
      new CANNON.Vec3(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z),
      new CANNON.Quaternion(startQuat.x, startQuat.y, startQuat.z, startQuat.w),
    );
    this.car.group.position.set(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z);
    this.car.group.quaternion.copy(startQuat);
    this.camera.position.copy(start.clone().sub(tangent.clone().multiplyScalar(8)).add(new THREE.Vector3(0, 3.4, 0)));
    this.camera.lookAt(start.clone().add(tangent.clone().multiplyScalar(4)));

    this.hud = createHUD(container);
    this.hud.onBack(() => opts.onBack());
    this.hud.onRestart(() => opts.onRestart());

    this.onKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.finished) {
          this.paused = !this.paused;
          this.hud.showPause(this.paused);
        }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this.onResize = () => this.resize();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    this.resize();

    this.renderer.setAnimationLoop(() => this.tick());
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private computeInput(state: ReturnType<CarPhysics['getState']>): VehicleInput {
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    let throttle = 0;
    let brake = 0;
    if (forward) throttle = 1;
    else if (back) {
      if (state.forwardSpeed > 1) brake = 1;
      else throttle = -0.55;
    }
    // 用户反馈左右方向反了：左键 → +1（左转）
    const steering = (left ? 1 : 0) - (right ? 1 : 0);
    return { throttle, brake, steering };
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.shake = Math.max(0, this.shake - dt * 1.2);
    let state: ReturnType<CarPhysics['getState']>;

    if (!this.paused && !this.finished) {
      const input = this.computeInput(this.physics.getState());
      this.physics.update(input, dt);
      state = this.physics.getState();
      this.syncVisual(state);
      this.updateRules(state, dt);
    } else {
      state = this.physics.getState();
    }

    // 平行光与阴影相机跟随车辆（保持偏移），大幅减轻阴影抖动
    this.sun.position.set(state.position.x + 120, state.position.y + 180, state.position.z + 80);
    this.sun.target.position.set(state.position.x, state.position.y, state.position.z);

    this.updateCamera(dt, state);
    this.hud.update({
      speedKmh: state.absoluteSpeed * 3.6,
      elapsedMs: performance.now() - this.startTime,
      timePenaltyMs: this.timePenaltyMs,
      distancePenaltyM: this.distancePenaltyM,
    });
    drawMinimap(
      this.hud.minimap,
      this.track.points,
      this.track.roadWidth,
      new THREE.Vector3(state.position.x, state.position.y, state.position.z),
      Math.atan2(state.forward.x, state.forward.z),
    );
    this.renderer.render(this.scene, this.camera);
  }

  private syncVisual(state: ReturnType<CarPhysics['getState']>): void {
    const p = state.position;
    const q = state.quaternion;
    this.car.group.position.set(p.x, p.y, p.z);
    this.car.group.quaternion.set(q.x, q.y, q.z, q.w);
    for (let i = 0; i < this.car.wheels.length; i++) {
      const t = this.physics.getWheelTransform(i);
      this.car.wheels[i].position.set(t.position.x, t.position.y, t.position.z);
      this.car.wheels[i].quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
    }
  }

  private nearestIndex(pos: { x: number; y: number; z: number }): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.track.points.length; i++) {
      const p = this.track.points[i];
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

  private respawn(reason: 'flip' | 'offtrack' | 'wrongway'): void {
    if (reason === 'flip') this.flips += 1;
    const state = this.physics.getState();
    const idx = findSafeSpawnIndex(this.track, this.nearestIndex(state.position));
    const respawnS = this.track.lengths[idx];
    if (respawnS < this.lastS) {
      this.distancePenaltyM += this.lastS - respawnS;
    }
    this.timePenaltyMs += TIME_PENALTY_MS;

    const p = this.track.points[idx];
    const tangent = this.track.tangents[idx].clone();
    tangent.y = 0;
    tangent.normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    this.physics.reset(
      new CANNON.Vec3(p.x, p.y + CHASSIS_SPAWN_HEIGHT, p.z),
      new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w),
    );
    this.lastS = respawnS;
    this.offTrackTimer = 0;
    this.flipTimer = 0;
  }

  private updateRules(state: ReturnType<CarPhysics['getState']>, dt: number): void {
    const dtMs = dt * 1000;
    const pos = state.position;
    const idx = this.nearestIndex(pos);
    const p = this.track.points[idx];
    const s = this.track.lengths[idx];
    const halfWidth = this.track.halfWidths[idx];

    // 脱轨判定（水平距离）
    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    const horizontalDist = Math.hypot(dx, dz);
    if (horizontalDist > halfWidth + OFFTRACK_MARGIN) {
      this.offTrackTimer += dtMs;
    } else {
      this.offTrackTimer = 0;
    }
    if (this.offTrackTimer > OFFTRACK_HOLD_MS) {
      this.respawn('offtrack');
      return;
    }

    // 翻车判定（车身上向量偏离竖直）
    const angleDeg = (Math.acos(Math.min(1, Math.max(-1, state.up.y))) * 180) / Math.PI;
    if (angleDeg > FLIP_ANGLE_DEG) {
      this.flipTimer += dtMs;
    } else {
      this.flipTimer = 0;
    }
    if (this.flipTimer > FLIP_HOLD_MS) {
      this.respawn('flip');
      return;
    }

    // 坠落兜底
    if (pos.y < -8) {
      this.respawn('offtrack');
      return;
    }

    // 逆行检测：沿赛道反方向行驶（切线反向速度 > 2 m/s）持续 3s → 警告并重生
    const tangent = this.track.tangents[idx];
    const tLen = Math.hypot(tangent.x, tangent.z) || 1;
    const wrongSpeed = -(state.velocity.x * (tangent.x / tLen) + state.velocity.z * (tangent.z / tLen));
    if (wrongSpeed > 2) {
      this.wrongWayTime += dtMs;
    } else {
      this.wrongWayTime = 0;
    }
    this.hud.showWrongWay(this.wrongWayTime > 0);
    if (this.wrongWayTime > 3000) {
      this.wrongWayTime = 0;
      this.respawn('wrongway');
      return;
    }

    // 进度与冲线（判断必须基于上一帧的 lastS）
    const progress = updateLapProgress(s, this.lastS, this.track.totalLength, this.completedDistance);
    this.completedDistance = progress.completedDistance;
    this.lastS = s;
    if (progress.crossedLine && this.completedDistance > this.track.totalLength * 0.7) {
      this.finish();
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const elapsed = performance.now() - this.startTime;
    const lapTimeMs =
      elapsed + this.timePenaltyMs + this.distancePenaltyM * DISTANCE_PENALTY_SEC_PER_M * 1000;
    void addLeaderboardEntry({
      trackId: this.track.meta.id,
      playerName: this.opts.playerName,
      lapTimeMs,
      timePenaltyMs: this.timePenaltyMs,
      distancePenaltyM: this.distancePenaltyM,
      flips: this.flips,
      date: Date.now(),
    });
    this.hud.showResult({ lapTimeMs, timePenaltyMs: this.timePenaltyMs, distancePenaltyM: this.distancePenaltyM });
  }

  private updateCamera(dt: number, state: ReturnType<CarPhysics['getState']>): void {
    const pos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
    const forward = new THREE.Vector3(state.forward.x, state.forward.y, state.forward.z);
    // 相机更低更近，清晰看到前轮转向状态
    const desired = pos.clone().sub(forward.clone().multiplyScalar(7.6)).add(new THREE.Vector3(0, 2.65, 0));
    if (this.shake > 0) {
      desired.x += (Math.random() - 0.5) * this.shake;
      desired.y += (Math.random() - 0.5) * this.shake;
      desired.z += (Math.random() - 0.5) * this.shake;
    }
    this.camera.position.lerp(desired, Math.min(1, 5 * dt));
    this.camera.lookAt(pos.clone().add(forward.clone().multiplyScalar(4)));
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.physics.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
