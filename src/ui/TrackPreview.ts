import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCar } from '../car/createCar';
import { CHASSIS_SPAWN_HEIGHT } from '../physics/vehicle';
import type { BuiltTrack } from '../track/generator';

export interface TrackPreviewOptions {
  /** 自由镜头：OrbitControls（拖动旋转/右键平移/滚轮缩放）；默认 false = 环绕慢转 */
  freeCamera?: boolean;
}

/** 赛道/赛车 3D 预览：默认环绕相机缓慢旋转，也可开启自由镜头 */
export class TrackPreview {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private track: BuiltTrack;
  private carColor: string;
  private carGroup: THREE.Group | null = null;
  private center = new THREE.Vector3(0, 0, 0);
  private radius = 180;
  private height = 120;
  private angle = 0;
  private readonly onResize: () => void;
  private readonly freeCamera: boolean;
  private controls: OrbitControls | null = null;

  constructor(container: HTMLElement, track: BuiltTrack, carColor: string, options: TrackPreviewOptions = {}) {
    this.container = container;
    this.track = track;
    this.carColor = carColor;
    this.freeCamera = options.freeCamera ?? false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'preview-canvas';

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6a55, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(120, 180, 80);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
    this.scene.add(this.track.group);
    this.rebuildCar();
    this.frameCamera();
    if (this.freeCamera) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(this.center.clone().add(new THREE.Vector3(0, 2, 0)));
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 900;
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.update();
    }
    this.resize();

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setTrack(track: BuiltTrack): void {
    this.scene.remove(this.track.group);
    this.track = track;
    this.scene.add(this.track.group);
    this.rebuildCar();
    this.frameCamera();
    if (this.controls) {
      this.controls.target.copy(this.center.clone().add(new THREE.Vector3(0, 2, 0)));
      this.controls.update();
    }
    this.resize();
  }

  setColor(color: string): void {
    this.carColor = color;
    this.rebuildCar();
  }

  private rebuildCar(): void {
    if (this.carGroup) {
      this.scene.remove(this.carGroup);
    }
    this.carGroup = buildCar(this.carColor).group;
    const start = this.track.points[0];
    const tangent = this.track.tangents[0].clone();
    tangent.y = 0;
    tangent.normalize();
    this.carGroup.position.set(start.x, start.y + CHASSIS_SPAWN_HEIGHT, start.z);
    this.carGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    this.scene.add(this.carGroup);
  }

  private frameCamera(): void {
    // 以车为中心取景：车体清晰可见，周围赛道弧线入画
    const car = this.track.points[0];
    this.center.set(car.x, car.y, car.z);
    this.radius = 60;
    this.height = 38;
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.controls) {
      this.controls.update();
    } else {
      this.angle += dt * 0.07;
      this.camera.position.set(
        this.center.x + Math.sin(this.angle) * this.radius,
        this.height,
        this.center.z + Math.cos(this.angle) * this.radius,
      );
      this.camera.lookAt(this.center.clone().add(new THREE.Vector3(0, 2, 0)));
    }
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 260;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.controls?.dispose();
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
