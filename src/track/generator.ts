import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
  BARRIER_HEIGHT_FACTOR,
  BARRIER_THICKNESS,
  CAR,
  CURVE_WIDEN_MAX,
  CURVE_WIDEN_STRENGTH,
  ROAD_WIDTH_MULTIPLIER,
} from '../config';
import type { TrackMeta } from '../types';
import { mulberry32 } from '../utils/random';
import { makeElevation } from './noise';

export interface BuiltTrack {
  meta: TrackMeta;
  points: THREE.Vector3[];
  tangents: THREE.Vector3[];
  lengths: number[];
  totalLength: number;
  roadWidth: number;
  /** 每个采样点的局部半宽（弯道按曲率加宽） */
  halfWidths: number[];
  barrierHeight: number;
  group: THREE.Group;
  physics: {
    ground: CANNON.Body;
    barriers: CANNON.Body[];
  };
  /** 路面几何数据（用于物理 Trimesh 与 GLB 导出） */
  roadGeometry: { positions: number[]; indices: number[] };
}

const SAMPLE_COUNT = 700;
const BARRIER_STEP = 3;

/** 根据种子生成闭环中心线采样点 */
export function generateCenterlinePoints(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const phase3 = rng() * Math.PI * 2;
  const radiusAt = (angle: number): number =>
    92 + 24 * Math.sin(3 * angle + phase1) + 12 * Math.sin(5 * angle + phase2) + 5 * Math.sin(7 * angle + phase3);

  const controlCount = 10;
  const controls: THREE.Vector3[] = [];
  for (let i = 0; i < controlCount; i++) {
    const angle = (i / controlCount) * Math.PI * 2 + (rng() - 0.5) * 0.06;
    const r = radiusAt(angle);
    controls.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }

  const curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.5);
  const elev = meta.mode === 'complex' ? makeElevation(meta.seed) : null;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const p = curve.getPoint(i / SAMPLE_COUNT);
    if (elev) {
      p.y = elev(p.x, p.z);
    }
    points.push(p);
  }
  return points;
}

function computeTangents(points: THREE.Vector3[]): THREE.Vector3[] {
  const n = points.length;
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    tangents.push(next.clone().sub(prev).normalize());
  }
  return tangents;
}

function computeLengths(points: THREE.Vector3[]): { lengths: number[]; total: number } {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i].distanceTo(points[i - 1]);
    lengths.push(total);
  }
  total += points[0].distanceTo(points[points.length - 1]);
  return { lengths, total };
}

function buildRoadRibbon(
  points: THREE.Vector3[],
  tangents: THREE.Vector3[],
  halfWidths: number[],
): { geometry: THREE.BufferGeometry; positions: number[]; indices: number[] } {
  const n = points.length;
  const positions: number[] = [];
  const rightVectors: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    // (0,1,0) × t = (t.z, 0, -t.x)，即路面横向右向量
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    rightVectors.push(right);
    const p = points[i];
    const hw = halfWidths[i];
    positions.push(p.x - right.x * hw, p.y, p.z - right.z * hw);
    positions.push(p.x + right.x * hw, p.y, p.z + right.z * hw);
  }

  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = i * 2;
    const i1 = (i + 1) % n;
    const a = i0;
    const b = i0 + 1;
    const c = i1 * 2;
    const d = i1 * 2 + 1;
    // 三角面保持法线向上
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, positions, indices };
}

function buildGroundVisual(
  mode: TrackMeta['mode'],
  points: THREE.Vector3[],
  elev: ((x: number, z: number) => number) | null,
): THREE.Mesh {
  if (mode === 'simple') {
    const geo = new THREE.PlaneGeometry(1800, 1800);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x3e8e41, roughness: 1 }),
    );
    mesh.position.y = -0.08;
    mesh.receiveShadow = true;
    return mesh;
  }

  const margin = 45;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const width = maxX - minX + margin * 2;
  const depth = maxZ - minZ + margin * 2;
  const segX = Math.min(140, Math.max(40, Math.round(width / 2)));
  const segZ = Math.min(140, Math.max(40, Math.round(depth / 2)));
  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const originX = minX - margin;
  const originZ = minZ - margin;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const wx = originX + x;
    const wz = originZ + z;
    posAttr.setY(i, (elev ? elev(wx, wz) : 0) - 0.08);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3e8e41, roughness: 1 }));
  mesh.position.set(originX, 0, originZ);
  mesh.receiveShadow = true;
  return mesh;
}

function buildBarriers(
  points: THREE.Vector3[],
  tangents: THREE.Vector3[],
  halfWidths: number[],
  barrierHeight: number,
): { visual: THREE.Mesh[]; bodies: CANNON.Body[] } {
  const visual: THREE.Mesh[] = [];
  const bodies: CANNON.Body[] = [];
  const material = new THREE.MeshStandardMaterial({ color: 0xcf4b4b, roughness: 0.8 });

  for (let i = 0; i < points.length; i += BARRIER_STEP) {
    const p = points[i];
    const t = tangents[i];
    const right = new THREE.Vector3(t.z, 0, -t.x).normalize();
    const next = points[(i + BARRIER_STEP) % points.length];
    // 段长放大 1.4 倍让相邻护栏重叠，消除弯道外侧的楔形缝隙
    const segLen = Math.max(0.4, p.distanceTo(next) * 1.4);
    const offset = halfWidths[i] + BARRIER_THICKNESS / 2 + 0.08;
    const yaw = Math.atan2(t.x, t.z);
    const halfExtents = new CANNON.Vec3(BARRIER_THICKNESS / 2, barrierHeight / 2, segLen / 2);

    for (const side of [-1, 1]) {
      const center = new THREE.Vector3(
        p.x + right.x * offset * side,
        p.y + barrierHeight / 2,
        p.z + right.z * offset * side,
      );
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(BARRIER_THICKNESS, barrierHeight, segLen), material);
      mesh.position.copy(center);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      visual.push(mesh);

      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(halfExtents) });
      body.position.set(center.x, center.y, center.z);
      body.quaternion.setFromEuler(0, yaw, 0);
      bodies.push(body);
    }
  }
  return { visual, bodies };
}

/** 按曲率计算每点局部半宽：直道=基础宽，弯道最多加宽 CURVE_WIDEN_MAX */
function computeHalfWidths(
  points: THREE.Vector3[],
  tangents: THREE.Vector3[],
  baseHalfWidth: number,
): number[] {
  const n = points.length;
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const segLen = Math.max(0.1, points[prevIdx].distanceTo(points[nextIdx]));
    const h0 = Math.atan2(tangents[prevIdx].x, tangents[prevIdx].z);
    const h1 = Math.atan2(tangents[nextIdx].x, tangents[nextIdx].z);
    let dHeading = h1 - h0;
    while (dHeading > Math.PI) dHeading -= Math.PI * 2;
    while (dHeading < -Math.PI) dHeading += Math.PI * 2;
    const curvature = Math.abs(dHeading) / segLen;
    const factor = 1 + Math.min(CURVE_WIDEN_MAX, curvature * CURVE_WIDEN_STRENGTH);
    raw.push(baseHalfWidth * factor);
  }
  // 平滑，避免宽度突变
  return raw.map((w, i) => (raw[(i - 1 + n) % n] + w + raw[(i + 1) % n]) / 3);
}

/** 由中心线构建完整赛道（视觉 + 物理） */
export function buildTrack(meta: TrackMeta, centerline: THREE.Vector3[]): BuiltTrack {
  const points = centerline;
  const tangents = computeTangents(points);
  const { lengths, total } = computeLengths(points);
  const roadWidth = CAR.width * ROAD_WIDTH_MULTIPLIER;
  const halfWidths = computeHalfWidths(points, tangents, roadWidth / 2);
  const barrierHeight = CAR.height * BARRIER_HEIGHT_FACTOR;

  const group = new THREE.Group();
  group.name = 'track-root';

  const { geometry, positions, indices } = buildRoadRibbon(points, tangents, halfWidths);
  const roadMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95, metalness: 0 }),
  );
  roadMesh.name = 'road';
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // 起终点线（白色）
  const t0 = tangents[0];
  const p0 = points[0];
  const startLine = new THREE.Mesh(
    new THREE.BoxGeometry(halfWidths[0] * 2, 0.04, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }),
  );
  startLine.name = 'start-line';
  startLine.position.set(p0.x, p0.y + 0.05, p0.z);
  startLine.rotation.y = Math.atan2(t0.x, t0.z);
  group.add(startLine);

  const elev = meta.mode === 'complex' ? makeElevation(meta.seed) : null;
  group.add(buildGroundVisual(meta.mode, points, elev));

  const { visual: barrierVisual, bodies: barrierBodies } = buildBarriers(points, tangents, halfWidths, barrierHeight);
  for (const b of barrierVisual) group.add(b);

  // 物理地面：简单模式用无限平面；复杂模式用路面 Trimesh + 安全兜底平面
  let ground: CANNON.Body;
  if (meta.mode === 'simple') {
    // cannon-es Plane 默认法线为 (0,0,1)；绕 X 轴旋转 -90° 使其朝上。
    // 必须把四元数放进构造参数并调用 updateAABB()：旋转后不刷新 AABB，
    // broadphase 会按旧的“竖直面”包围盒剔除车头方向（z>0）的轮子射线，导致前轮永不触地。
    const planeQuat = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
    ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), quaternion: planeQuat });
    ground.updateAABB();
  } else {
    const trimesh = new CANNON.Trimesh(positions, indices);
    ground = new CANNON.Body({ mass: 0, shape: trimesh });
    const catcherQuat = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
    const catcher = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      position: new CANNON.Vec3(0, -30, 0),
      quaternion: catcherQuat,
    });
    catcher.updateAABB();
    barrierBodies.push(catcher);
  }

  return {
    meta,
    points,
    tangents,
    lengths,
    totalLength: total,
    roadWidth,
    halfWidths,
    barrierHeight,
    group,
    physics: { ground, barriers: barrierBodies },
    roadGeometry: { positions, indices },
  };
}
