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

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

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

/** 随机有机八字：两片 Catmull-Rom 叶瓣在中心交叉（非圆环） */
function generateFigureEight(rng: () => number, targetLength: number): THREE.Vector3[] {
  const lobe = (side: number): THREE.Vector3[] => {
    const count = 4 + Math.floor(rng() * 3); // 4~6 控制点
    const baseR = 95 + rng() * 45;
    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      const angle = Math.PI * (0.5 + t); // 从上（π/2）扫到下（3π/2），x<0 侧
      const r = baseR * (0.65 + rng() * 0.7);
      const z = Math.sin(angle) * r * (0.7 + rng() * 0.6);
      pts.push(new THREE.Vector3(side * -Math.cos(angle) * r, 0, z));
    }
    pts.push(new THREE.Vector3(0, 0, 0));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const steps = Math.max(200, Math.round((targetLength / 2) / SAMPLE_SPACING));
    const out: THREE.Vector3[] = [];
    for (let i = 1; i <= steps; i++) out.push(curve.getPoint(i / steps));
    return out;
  };
  return [...lobe(-1), ...lobe(1)];
}

/** 复杂赛道：随机有机八字 / lemniscate（均非圆环、中心交叉）；加海拔区段与重叠高度差 */
function generateComplexTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const targetLength = 1800 + rng() * 800; // 1800~2600m 随机
  let flat: THREE.Vector3[];
  if (rng() < 0.55) {
    // 随机有机八字
    flat = generateFigureEight(rng, targetLength);
  } else {
    // lemniscate 8
    flat = [];
    const steps = Math.max(400, Math.round(targetLength / SAMPLE_SPACING));
    for (let k = 0; k < steps; k++) {
      const t = (k / steps) * Math.PI * 2;
      const s = 1 + Math.sin(t) ** 2;
      flat.push(new THREE.Vector3(Math.cos(t) / s, 0, (Math.sin(t) * Math.cos(t)) / s));
    }
  }
  const scaled = scaleLoop(flat, targetLength);
  const heights = assignAltitudeSegments(scaled, rng);
  return scaled.map((p, i) => new THREE.Vector3(p.x, heights[i], p.z));
}

/** 海拔区段：段内平台（弯道水平）、段界短坡；重叠处强制高度差 */
function assignAltitudeSegments(points: THREE.Vector3[], rng: () => number): number[] {
  const n = points.length;
  let segCount = 4 + Math.floor(rng() * 4); // 4~7 段
  const levels = [0, 3, 6];

  // 曲率
  const curv: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const h0 = Math.atan2(points[next].x - points[prev].x, points[next].z - points[prev].z);
    const h1 = Math.atan2(points[(next + 1) % n].x - points[i].x, points[(next + 1) % n].z - points[i].z);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    curv[i] = Math.abs(dh) / Math.max(0.1, points[prev].distanceTo(points[next]));
  }
  // 重叠对（XZ 接近、弧长距离大）
  const overlapPairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 7) {
    for (let j = i + 1; j < n; j += 7) {
      const idxDist = Math.min(j - i, n - (j - i));
      if (idxDist < n / 4) continue;
      const dx = points[i].x - points[j].x;
      const dz = points[i].z - points[j].z;
      if (dx * dx + dz * dz < 225) overlapPairs.push([i, j]);
    }
  }
  // 交叉点集合：段界要避开交叉点（保证重叠处落在平台而非坡上）
  const crossSet = new Set<number>();
  for (const [i, j] of overlapPairs) {
    crossSet.add(i);
    crossSet.add(j);
  }
  const farFromCross = (idx: number): boolean => {
    for (const c of crossSet) {
      const d = Math.min(Math.abs(idx - c), n - Math.abs(idx - c));
      if (d < 40) return false;
    }
    return true;
  };
  // 段界选在各等分区间内、远离交叉点的曲率最低点（坡在直道，弯道保持平台）
  let segStart: number[] = [];
  for (let k = 0; k < segCount; k++) {
    const s = Math.floor((k * n) / segCount);
    const e = Math.floor(((k + 1) * n) / segCount);
    let best = -1;
    let bestC = Infinity;
    for (let i = s; i < e; i++) {
      if (!farFromCross(i)) continue;
      if (curv[i] < bestC) {
        bestC = curv[i];
        best = i;
      }
    }
    if (best < 0) best = s; // 窗口内全在交叉区时兜底
    segStart.push(best);
  }
  // 保证重叠对不在同一段：同段则在两交叉点弧长中点插入段界
  const segIndexOf = (idx: number): number => {
    for (let k = 0; k < segStart.length; k++) {
      const s = segStart[k];
      const e = segStart[(k + 1) % segStart.length];
      if (s <= e) {
        if (idx >= s && idx < e) return k;
      } else if (idx >= s || idx < e) {
        return k;
      }
    }
    return 0;
  };
  for (const [i, j] of overlapPairs) {
    if (segIndexOf(i) === segIndexOf(j)) {
      segStart.push(Math.floor((i + (((j - i + n) % n) / 2)) % n));
    }
  }
  segStart.sort((a, b) => a - b);
  segCount = segStart.length;

  // 段高度（相邻不同）
  const segH: number[] = [];
  for (let k = 0; k < segCount; k++) {
    let h = levels[Math.floor(rng() * levels.length)];
    if (k > 0 && h === segH[k - 1]) h = levels[(levels.indexOf(h) + 1) % levels.length];
    segH.push(h);
  }

  // 重叠处强制高度差：重叠对所在段高度必须不同
  for (let i = 0; i < n; i += 7) {
    for (let j = i + 1; j < n; j += 7) {
      const idxDist = Math.min(j - i, n - (j - i));
      if (idxDist < n / 4) continue;
      const dx = points[i].x - points[j].x;
      const dz = points[i].z - points[j].z;
      if (dx * dx + dz * dz < 225) {
        const ki = segIndexOf(i);
        const kj = segIndexOf(j);
        if (ki !== kj && segH[ki] === segH[kj]) {
          segH[kj] = levels[(levels.indexOf(segH[kj]) + 1) % levels.length];
        }
      }
    }
  }

  // 生成剖面：段内平台 + 段界短坡（~22m，平滑）
  const heights: number[] = new Array(n).fill(0);
  const rampLen = Math.max(8, Math.round(22 / SAMPLE_SPACING));
  const fillSegment = (s: number, e: number, hK: number, hNext: number): void => {
    const len = (e - s + n) % n;
    const effRamp = Math.min(rampLen, Math.floor(len / 2));
    for (let k = 0; k < len; k++) {
      const idx = (s + k) % n;
      const tFromStart = k;
      let hh = hK;
      if (hNext !== hK && tFromStart >= len - effRamp) {
        const t = (tFromStart - (len - effRamp)) / Math.max(1, effRamp - 1);
        hh = hK + (hNext - hK) * smoothstep(t);
      }
      heights[idx] = hh;
    }
  };
  for (let k = 0; k < segCount; k++) {
    fillSegment(segStart[k], segStart[(k + 1) % segCount], segH[k], segH[(k + 1) % segCount]);
  }
  // 邻点坡度直接钳制：保证无断崖（相邻高度差 ≤ 0.5m）
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const d = heights[j] - heights[i];
      if (d > 0.5) {
        heights[j] = heights[i] + 0.5;
      } else if (d < -0.5) {
        heights[j] = heights[i] - 0.5;
      }
    }
  }
  return heights;
}

/** 根据种子生成闭环中心线采样点（简单=随机点光滑曲线；复杂=双圆 8/lemniscate + 海拔区段） */
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
