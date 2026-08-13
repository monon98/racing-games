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
import { buildEnvironment } from './environment';

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

const SAMPLE_SPACING = 1.2;
const BARRIER_STEP = 3;

/** 按目标长度缩放闭环 */
function scaleLoop(points: THREE.Vector3[], targetLength: number): THREE.Vector3[] {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    len += points[i].distanceTo(points[(i + 1) % points.length]);
  }
  const s = targetLength / Math.max(1, len);
  return points.map((p) => new THREE.Vector3(p.x * s, p.y, p.z * s));
}

function orient(a1: number, a2: number, b1: number, b2: number, c1: number, c2: number): number {
  return (b1 - a1) * (c2 - a2) - (b2 - a2) * (c1 - a1);
}

function segIntersect(
  a1: number, a2: number, b1: number, b2: number,
  c1: number, c2: number, d1: number, d2: number,
): boolean {
  const o1 = orient(a1, a2, b1, b2, c1, c2);
  const o2 = orient(a1, a2, b1, b2, d1, d2);
  const o3 = orient(c1, c2, d1, d2, a1, a2);
  const o4 = orient(c1, c2, d1, d2, b1, b2);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** 闭环是否在 XZ 平面自交（非相邻段） */
export function loopSelfIntersects(points: THREE.Vector3[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(
        points[i].x, points[i].z, points[(i + 1) % n].x, points[(i + 1) % n].z,
        points[j].x, points[j].z, points[(j + 1) % n].x, points[(j + 1) % n].z,
      )) return true;
    }
  }
  return false;
}

/** 简单赛道：随机控制点 + Catmull-Rom 闭环（不要求直线；光滑、不突左突右；自交则换种子重试） */
function generateSimpleTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const targetLength = 1600 + rng() * 1000; // 1600~2600m 随机
  for (let attempt = 0; attempt < 10; attempt++) {
    const count = 8 + Math.floor(rng() * 4);
    const base = 80 + rng() * 30;
    const p1 = rng() * Math.PI * 2;
    const p2 = rng() * Math.PI * 2;
    const p3 = rng() * Math.PI * 2;
    const controls: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.15;
      const r = Math.max(
        30,
        base + 26 * Math.sin(3 * angle + p1) + 14 * Math.sin(5 * angle + p2) + 7 * Math.sin(7 * angle + p3) + (rng() - 0.5) * 10,
      );
      controls.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
    }
    const curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.6);
    // 按目标长度采样（缩放后间距约 1.2m）
    const steps = Math.max(300, Math.round(targetLength / SAMPLE_SPACING));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < steps; i++) pts.push(curve.getPoint(i / steps));
    const scaled = scaleLoop(pts, targetLength);
    if (!loopSelfIntersects(scaled)) return scaled;
  }
  // 兜底：平滑星形（必然简单）
  const controls: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    controls.push(new THREE.Vector3(Math.cos(angle) * (100 + 18 * Math.sin(3 * angle)), 0, Math.sin(angle) * (100 + 18 * Math.sin(3 * angle))));
  }
  const curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.5);
  const steps = Math.max(300, Math.round(targetLength / SAMPLE_SPACING));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < steps; i++) pts.push(curve.getPoint(i / steps));
  return scaleLoop(pts, targetLength);
}

/** 随机二维高度矩阵（平滑随机场，高度 0~6m） */
function generateHeightMap(rows: number, cols: number, rng: () => number): number[][] {
  const h: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      let v = 0;
      if (c > 0) v = row[c - 1] + (rng() - 0.5) * 3.0;
      else if (r > 0) v = h[r - 1][c] + (rng() - 0.5) * 3.0;
      v = Math.max(0, Math.min(8, v));
      row.push(v);
    }
    h.push(row);
  }
  for (let pass = 0; pass < 2; pass++) {
    const copy = h.map((r) => [...r]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = copy[r][c];
        let cnt = 1;
        if (r > 0) { sum += copy[r - 1][c]; cnt++; }
        if (r < rows - 1) { sum += copy[r + 1][c]; cnt++; }
        if (c > 0) { sum += copy[r][c - 1]; cnt++; }
        if (c < cols - 1) { sum += copy[r][c + 1]; cnt++; }
        h[r][c] = Math.max(0, Math.min(8, sum / cnt));
      }
    }
  }
  return h;
}

/** 随机哈密顿路径（网格）：随机化回溯 + Warnsdorff 启发 + 节点预算，失败回退蛇形。
 * 不要求闭环（末尾由 Catmull-Rom 闭合），搜索极快、不会卡死。 */
function findHamiltonianPath(rows: number, cols: number, rng: () => number): number[] {
  const L = rows * cols;
  const idx = (r: number, c: number) => r * cols + c;
  const neighborsOf = (i: number): number[] => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const out: number[] = [];
    if (r > 0) out.push(idx(r - 1, c));
    if (r < rows - 1) out.push(idx(r + 1, c));
    if (c > 0) out.push(idx(r, c - 1));
    if (c < cols - 1) out.push(idx(r, c + 1));
    return out;
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const start = Math.floor(rng() * L);
    const path: number[] = [start];
    const visited = new Set<number>([start]);
    let budget = 30_000;
    const dfs = (): boolean => {
      if (path.length === L) {
        return true;
      }
      if (--budget <= 0) {
        throw new Error('budget');
      }
      const cur = path[path.length - 1];
      const options = neighborsOf(cur).filter((n) => !visited.has(n));
      options.sort(
        (a, b) =>
          neighborsOf(a).filter((x) => !visited.has(x)).length -
            neighborsOf(b).filter((x) => !visited.has(x)).length || rng() - 0.5,
      );
      for (const n of options) {
        visited.add(n);
        path.push(n);
        if (dfs()) return true;
        path.pop();
        visited.delete(n);
      }
      return false;
    };
    try {
      if (dfs()) return path;
    } catch {
      // 预算用尽，换种子重试
    }
  }
  const fallback: number[] = [];
  for (let r = 0; r < rows; r++) {
    const c0 = r % 2 === 0 ? 0 : cols - 1;
    const dc = r % 2 === 0 ? 1 : -1;
    for (let k = 0; k < cols; k++) fallback.push(idx(r, c0 + k * dc));
  }
  return fallback;
}

/** 复杂赛道：随机 M×N 高度矩阵 + 随机哈密顿路径（非平行车道）；
 * 沿路径相邻格高差 ≤1.0m（一点点升降，坡度可行驶）；Catmull-Rom 平滑为闭环。 */
function generateComplexTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const targetLength = 1800 + rng() * 800; // 1800~2600m 随机
  const rows = 5 + Math.floor(rng() * 4); // 5~8 行
  const cellLen = 24 + rng() * 8; // 每格沿 x 长度（长方体区域）
  const laneGap = 20 + rng() * 8; // 每格沿 z 宽度
  const cols = Math.max(10, Math.round(targetLength / (rows * ((cellLen + laneGap) / 2))));

  const h = generateHeightMap(rows, cols, rng);
  const cycle = findHamiltonianPath(rows, cols, rng);

  // 沿路径钳制相邻格高度差 ≤1.0m（含闭环首尾）
  const clampCell = (a: number, b: number): void => {
    const r1 = Math.floor(b / cols);
    const c1 = b % cols;
    const r0 = Math.floor(a / cols);
    const c0 = a % cols;
    let d = h[r1][c1] - h[r0][c0];
    if (d > 1.0) h[r1][c1] = h[r0][c0] + 1.0;
    if (d < -1.0) h[r1][c1] = h[r0][c0] - 1.0;
    h[r1][c1] = Math.max(0, Math.min(8, h[r1][c1]));
  };
  for (let k = 1; k < cycle.length; k++) clampCell(cycle[k - 1], cycle[k]);
  clampCell(cycle[cycle.length - 1], cycle[0]);

  // 控制点 = 格中心（含高度），Catmull-Rom 闭环平滑
  const controls = cycle.map((i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return new THREE.Vector3((c + 0.5) * cellLen, h[r][c], (r + 0.5) * laneGap);
  });
  const curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.6);
  const steps = Math.max(300, Math.round(targetLength / SAMPLE_SPACING));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < steps; i++) pts.push(curve.getPoint(i / steps));

  const scaled = scaleLoop(pts, targetLength);
  // 最终坡度钳制：相邻采样点最大坡度 ≤ 12%（消除 Catmull-Rom 高度过冲与缩放影响）
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < scaled.length; i++) {
      const j = (i + 1) % scaled.length;
      const dy = scaled[j].y - scaled[i].y;
      const ds = Math.max(0.01, Math.hypot(scaled[j].x - scaled[i].x, scaled[j].z - scaled[i].z));
      const slope = dy / ds;
      if (slope > 0.12) scaled[j].y = scaled[i].y + 0.12 * ds;
      else if (slope < -0.12) scaled[j].y = scaled[i].y - 0.12 * ds;
    }
  }
  return scaled;
}
/** 根据种子生成闭环中心线采样点（简单=随机点光滑曲线；复杂=随机高度矩阵 + 哈密顿环） */
export function generateCenterlinePoints(meta: TrackMeta): THREE.Vector3[] {
  return meta.mode === 'simple' ? generateSimpleTrack(meta) : generateComplexTrack(meta);
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
  const n = points.length;

  const emitSegment = (a: number, b: number): void => {
    // 护栏段两端各取“该采样点的实际路面边缘”，与加宽后的路面精确对齐
    const rightI = new THREE.Vector3(tangents[a].z, 0, -tangents[a].x).normalize();
    const rightJ = new THREE.Vector3(tangents[b].z, 0, -tangents[b].x).normalize();
    const offsetI = halfWidths[a] + BARRIER_THICKNESS / 2 + 0.08;
    const offsetJ = halfWidths[b] + BARRIER_THICKNESS / 2 + 0.08;

    for (const side of [-1, 1]) {
      const eI = new THREE.Vector3(
        points[a].x + rightI.x * offsetI * side,
        points[a].y,
        points[a].z + rightI.z * offsetI * side,
      );
      const eJ = new THREE.Vector3(
        points[b].x + rightJ.x * offsetJ * side,
        points[b].y,
        points[b].z + rightJ.z * offsetJ * side,
      );
      const mid = eI.clone().add(eJ).multiplyScalar(0.5);
      const dir = eJ.clone().sub(eI);
      // 段长放大 1.15 倍让相邻护栏重叠，消除弯道外侧的楔形缝隙
      const len = Math.max(0.4, dir.length() * 1.15);
      const yaw = Math.atan2(dir.x, dir.z);

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(BARRIER_THICKNESS, barrierHeight, len), material);
      mesh.position.set(mid.x, mid.y + barrierHeight / 2, mid.z);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      visual.push(mesh);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(BARRIER_THICKNESS / 2, barrierHeight / 2, len / 2)),
      });
      body.position.set(mid.x, mid.y + barrierHeight / 2, mid.z);
      body.quaternion.setFromEuler(0, yaw, 0);
      bodies.push(body);

    }
  };

  // 弯心两侧各自发一段短护栏（本地切线朝向），避免跨弯心的长段横穿赛道
  const emitLocalSegment = (k: number): void => {
    const right = new THREE.Vector3(tangents[k].z, 0, -tangents[k].x).normalize();
    const offset = halfWidths[k] + BARRIER_THICKNESS / 2 + 0.08;
    const p = points[k];
    const next = points[(k + 1) % n];
    const len = Math.max(1.5, p.distanceTo(next) * 1.3);
    const yaw = Math.atan2(tangents[k].x, tangents[k].z);
    for (const side of [-1, 1]) {
      const cx = p.x + right.x * offset * side;
      const cy = p.y;
      const cz = p.z + right.z * offset * side;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(BARRIER_THICKNESS, barrierHeight, len), material);
      mesh.position.set(cx, cy + barrierHeight / 2, cz);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      visual.push(mesh);
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(BARRIER_THICKNESS / 2, barrierHeight / 2, len / 2)),
      });
      body.position.set(cx, cy + barrierHeight / 2, cz);
      body.quaternion.setFromEuler(0, yaw, 0);
      bodies.push(body);
    }
  };

  for (let i = 0; i < n; i += BARRIER_STEP) {
    const j = (i + BARRIER_STEP) % n;
    // 站对方向差过大（跨弯心）时两侧各自短段，否则端点连接（跟随加宽路面）
    const hI = Math.atan2(tangents[i].x, tangents[i].z);
    const hJ = Math.atan2(tangents[j].x, tangents[j].z);
    let dH = hJ - hI;
    while (dH > Math.PI) dH -= Math.PI * 2;
    while (dH < -Math.PI) dH += Math.PI * 2;
    if (Math.abs(dH) > 0.6) {
      emitLocalSegment(i);
      emitLocalSegment(j);
    } else {
      emitSegment(i, j);
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

/** 找附近不与任何护栏体重叠的安全落点（重生/出生用，避免复活后卡进护栏导致碰撞失效） */
export function findSafeSpawnIndex(track: BuiltTrack, idx: number): number {
  const n = track.points.length;
  const halfW = 1.4;
  const halfL = 2.4;
  const tryIndex = (k: number): boolean => {
    const p = track.points[k];
    for (const b of track.physics.barriers) {
      // 跳过兜底平面（无限 AABB）
      if (b.shapes[0] instanceof CANNON.Plane) continue;
      const bb = b.aabb;
      if (
        p.x > bb.lowerBound.x - halfL &&
        p.x < bb.upperBound.x + halfL &&
        p.z > bb.lowerBound.z - halfW &&
        p.z < bb.upperBound.z + halfW
      ) {
        return false;
      }
    }
    return true;
  };
  for (let d = 0; d < n; d++) {
    const a = (idx + d) % n;
    const b2 = (idx - d + n) % n;
    if (tryIndex(a)) return a;
    if (tryIndex(b2)) return b2;
  }
  return idx;
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

  // 复杂赛道为高架桥式：路面自带起伏，地面统一为平地
  group.add(buildGroundVisual(meta.mode, points, null));

  // 环境装饰（树/石头，避开路面）
  group.add(buildEnvironment(meta, points, halfWidths, Math.max(...halfWidths)));

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
    // 平地面物理：车掉出高架路面时落到地面，而不是无限坠落
    const flatQuat = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
    const flat = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), quaternion: flatQuat });
    flat.updateAABB();
    barrierBodies.push(flat);
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
