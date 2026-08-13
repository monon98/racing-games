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
  /** 复杂赛道的地形高度场（简单赛道为 null） */
  terrain: TerrainData | null;
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

/** 随机星形闭环（XZ 平面）：随机控制点 + Catmull-Rom；光滑、不突左突右、不自交 */
function generateStarLoop(rng: () => number, targetLength: number): THREE.Vector3[] {
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

/** 简单赛道：随机控制点 + Catmull-Rom 闭环（不要求直线；光滑、不突左突右；自交则换种子重试） */
function generateSimpleTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const targetLength = 1600 + rng() * 1000; // 1600~2600m 随机
  return generateStarLoop(rng, targetLength);
}

const TERRAIN_CELL = 10; // 地形网格格距（m）
const TERRAIN_MARGIN = 60; // 赛道包围盒外扩（m）
const TERRAIN_MAX_HEIGHT = 14; // 地形高度范围 0~14m（加强高低起伏感）
const TERRAIN_MAX_DIFF = 1.0; // 相邻地形格最大高差（≈10% 坡度，降低野地/对角坡的飞车）
const ROAD_TERRAIN_OFFSET = 0.05; // 贴地路面略抬高，避免被地形遮挡（绿色露出）

export interface TerrainData {
  originX: number;
  originZ: number;
  cell: number;
  rows: number;
  cols: number;
  heights: number[][];
  /** 双线性采样任意点高度（x/z 为世界坐标） */
  sample(x: number, z: number): number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 地形优先：用 2D 高度矩阵生成覆盖赛道的平滑地形（值噪声 + 平滑插值 + 坡度钳制），
 * 并强制一个“山丘”保证复杂赛道必然有可行驶的升降；不处理交叉轨道。 */
export function generateTerrain(loop: THREE.Vector3[], seed: number): TerrainData {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const originX = minX - TERRAIN_MARGIN;
  const originZ = minZ - TERRAIN_MARGIN;
  const width = maxX - minX + TERRAIN_MARGIN * 2;
  const depth = maxZ - minZ + TERRAIN_MARGIN * 2;
  const cols = Math.max(24, Math.ceil(width / TERRAIN_CELL) + 1);
  const rows = Math.max(24, Math.ceil(depth / TERRAIN_CELL) + 1);

  // 粗控制网格（值噪声），再平滑插值到细网格
  const gRows = Math.max(4, Math.round(rows / 7));
  const gCols = Math.max(4, Math.round(cols / 7));
  const grid: number[][] = [];
  for (let r = 0; r < gRows; r++) {
    const row: number[] = [];
    for (let c = 0; c < gCols; c++) row.push(rng() * TERRAIN_MAX_HEIGHT);
    grid.push(row);
  }
  const sampleGrid = (gr: number, gc: number): number => {
    const r0 = Math.min(gRows - 1, Math.max(0, Math.floor(gr)));
    const c0 = Math.min(gCols - 1, Math.max(0, Math.floor(gc)));
    const r1 = Math.min(gRows - 1, r0 + 1);
    const c1 = Math.min(gCols - 1, c0 + 1);
    const fr = smoothstep(Math.min(1, Math.max(0, gr - r0)));
    const fc = smoothstep(Math.min(1, Math.max(0, gc - c0)));
    const h00 = grid[r0][c0];
    const h01 = grid[r0][c1];
    const h10 = grid[r1][c0];
    const h11 = grid[r1][c1];
    return (h00 * (1 - fc) + h01 * fc) * (1 - fr) + (h10 * (1 - fc) + h11 * fc) * fr;
  };

  const heights: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    const gr = (r / (rows - 1)) * (gRows - 1);
    for (let c = 0; c < cols; c++) {
      const gc = (c / (cols - 1)) * (gCols - 1);
      row.push(Math.max(0, Math.min(TERRAIN_MAX_HEIGHT, sampleGrid(gr, gc))));
    }
    heights.push(row);
  }

  // 强制多个山丘：沿赛道不同位置隆起，保证复杂赛道有强烈且连续的高低起伏
  const hills = [
    {
      idx: Math.floor(loop.length * (0.2 + rng() * 0.3)),
      amp: 5 + rng() * 3,
      sigma: 90 + rng() * 50,
    },
    {
      idx: Math.floor(loop.length * (0.55 + rng() * 0.3)),
      amp: 4 + rng() * 3,
      sigma: 100 + rng() * 50,
    },
  ];
  for (const hill of hills) {
    const hx = loop[hill.idx].x;
    const hz = loop[hill.idx].z;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = originX + c * TERRAIN_CELL;
        const z = originZ + r * TERRAIN_CELL;
        const d2 = (x - hx) ** 2 + (z - hz) ** 2;
        const bump = hill.amp * Math.exp(-d2 / (2 * hill.sigma * hill.sigma));
        heights[r][c] = Math.max(0, Math.min(TERRAIN_MAX_HEIGHT, heights[r][c] + bump));
      }
    }
  }

  // 相邻格高差钳制（保证地形本身可行驶；轨道采样后还有最终坡度钳制）
  for (let pass = 0; pass < 3; pass++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cur = heights[r][c];
        if (r > 0 && heights[r - 1][c] - cur > TERRAIN_MAX_DIFF) heights[r - 1][c] = cur + TERRAIN_MAX_DIFF;
        if (r < rows - 1 && heights[r + 1][c] - cur > TERRAIN_MAX_DIFF) heights[r + 1][c] = cur + TERRAIN_MAX_DIFF;
        if (c > 0 && heights[r][c - 1] - cur > TERRAIN_MAX_DIFF) heights[r][c - 1] = cur + TERRAIN_MAX_DIFF;
        if (c < cols - 1 && heights[r][c + 1] - cur > TERRAIN_MAX_DIFF) heights[r][c + 1] = cur + TERRAIN_MAX_DIFF;
      }
    }
  }

  const sample = (x: number, z: number): number => {
    const fc = (x - originX) / TERRAIN_CELL;
    const fr = (z - originZ) / TERRAIN_CELL;
    const c0 = Math.min(cols - 2, Math.max(0, Math.floor(fc)));
    const r0 = Math.min(rows - 2, Math.max(0, Math.floor(fr)));
    const c1 = c0 + 1;
    const r1 = r0 + 1;
    const tc = Math.min(1, Math.max(0, fc - c0));
    const tr = Math.min(1, Math.max(0, fr - r0));
    const h00 = heights[r0][c0];
    const h01 = heights[r0][c1];
    const h10 = heights[r1][c0];
    const h11 = heights[r1][c1];
    return (h00 * (1 - tc) + h01 * tc) * (1 - tr) + (h10 * (1 - tc) + h11 * tc) * tr;
  };

  return { originX, originZ, cell: TERRAIN_CELL, rows, cols, heights, sample };
}

/** 复杂赛道（地形优先）：先生成覆盖区域的 2D 高度图地形，再在其上画 2D 闭环轨道；
 * 轨道逐点采样地形高度，最后钳制坡度 ≤12%；不处理交叉轨道。 */
function generateComplexTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const targetLength = 1800 + rng() * 800; // 1800~2600m 随机
  const loop = generateStarLoop(rng, targetLength);
  const terrain = generateTerrain(loop, meta.seed);
  const pts = loop.map((p) => new THREE.Vector3(p.x, terrain.sample(p.x, p.z), p.z));
  // 最终坡度钳制：相邻采样点最大坡度 ≤ 12%
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const dy = pts[j].y - pts[i].y;
      const ds = Math.max(0.01, Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z));
      const slope = dy / ds;
      if (slope > 0.12) pts[j].y = pts[i].y + 0.12 * ds;
      else if (slope < -0.12) pts[j].y = pts[i].y - 0.12 * ds;
    }
  }
  return pts;
}

/** 根据种子生成闭环中心线采样点（简单=随机点光滑曲线；复杂=地形优先：先高度图后轨道） */
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
  terrain: TerrainData | null,
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
    const lx = p.x - right.x * hw;
    const lz = p.z - right.z * hw;
    const rx = p.x + right.x * hw;
    const rz = p.z + right.z * hw;
    // 地形优先：路面两侧边沿跟随地形高度（贴地），并略抬高避免被地形遮挡
    const ly = terrain ? terrain.sample(lx, lz) + ROAD_TERRAIN_OFFSET : p.y;
    const ry = terrain ? terrain.sample(rx, rz) + ROAD_TERRAIN_OFFSET : p.y;
    positions.push(lx, ly, lz);
    positions.push(rx, ry, rz);
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
  terrain: TerrainData | null,
): { mesh: THREE.Mesh; positions: number[]; indices: number[] } {
  if (mode === 'simple') {
    const geo = new THREE.PlaneGeometry(1800, 1800);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x3e8e41, roughness: 1 }),
    );
    mesh.name = 'ground';
    mesh.position.y = -0.08;
    mesh.receiveShadow = true;
    return { mesh, positions: [], indices: [] };
  }

  const originX = terrain!.originX;
  const originZ = terrain!.originZ;
  const width = (terrain!.cols - 1) * terrain!.cell;
  const depth = (terrain!.rows - 1) * terrain!.cell;
  // 网格细分与地形数据一致（每格一个顶点），避免物理 Trimesh 过密
  const segX = Math.min(140, Math.max(24, Math.round(width / terrain!.cell)));
  const segZ = Math.min(140, Math.max(24, Math.round(depth / terrain!.cell)));
  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    // 平面几何中心在原点：把局部坐标换算成地形世界坐标，并直接写入世界位置
    const wx = originX + posAttr.getX(i) + width / 2;
    const wz = originZ + posAttr.getZ(i) + depth / 2;
    posAttr.setX(i, wx);
    posAttr.setY(i, terrain!.sample(wx, wz));
    posAttr.setZ(i, wz);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3e8e41, roughness: 1 }));
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  const indices: number[] = Array.from(geo.getIndex()?.array ?? []);
  return { mesh, positions: Array.from(posAttr.array as Float32Array), indices };
}

function buildBarriers(
  points: THREE.Vector3[],
  tangents: THREE.Vector3[],
  halfWidths: number[],
  barrierHeight: number,
  terrain: TerrainData | null,
): { visual: THREE.Mesh[]; bodies: CANNON.Body[] } {
  const visual: THREE.Mesh[] = [];
  const bodies: CANNON.Body[] = [];
  const material = new THREE.MeshStandardMaterial({ color: 0xcf4b4b, roughness: 0.8 });
  const n = points.length;

  const emitSegment = (a: number, b: number): void => {
    // 护栏段两端各取“该采样点的实际路面边缘”，与加宽后的路面精确对齐
    const rightI = new THREE.Vector3(tangents[a].z, 0, -tangents[a].x).normalize();
    const rightJ = new THREE.Vector3(tangents[b].z, 0, -tangents[b].x).normalize();
    const offsetI = halfWidths[a] + BARRIER_THICKNESS / 2 + 0.05;
    const offsetJ = halfWidths[b] + BARRIER_THICKNESS / 2 + 0.05;

    for (const side of [-1, 1]) {
      const eIx = points[a].x + rightI.x * offsetI * side;
      const eIz = points[a].z + rightI.z * offsetI * side;
      const eJx = points[b].x + rightJ.x * offsetJ * side;
      const eJz = points[b].z + rightJ.z * offsetJ * side;
      const eI = new THREE.Vector3(eIx, terrain ? terrain.sample(eIx, eIz) : points[a].y, eIz);
      const eJ = new THREE.Vector3(eJx, terrain ? terrain.sample(eJx, eJz) : points[b].y, eJz);
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
    const offset = halfWidths[k] + BARRIER_THICKNESS / 2 + 0.05;
    const p = points[k];
    const next = points[(k + 1) % n];
    const len = Math.max(1.5, p.distanceTo(next) * 1.3);
    const yaw = Math.atan2(tangents[k].x, tangents[k].z);
    for (const side of [-1, 1]) {
      const cx = p.x + right.x * offset * side;
      const cz = p.z + right.z * offset * side;
      const cy = terrain ? terrain.sample(cx, cz) : p.y;
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
  // 地形优先：复杂赛道先生成覆盖区域的高度图地形，轨道/护栏/环境都贴在地形上
  const terrain = meta.mode === 'complex' ? generateTerrain(points, meta.seed) : null;

  const group = new THREE.Group();
  group.name = 'track-root';

  const { geometry, positions, indices } = buildRoadRibbon(points, tangents, halfWidths, terrain);
  const roadMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x3a3f47,
      roughness: 0.95,
      metalness: 0,
      // 贴地路面与地形共面，用多边形偏移避免 z-fighting
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
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
  // 抬高到路面（复杂模式贴地路面 +0.05）之上，避免与路面共面导致起始线显示不完整
  startLine.position.set(p0.x, p0.y + 0.12, p0.z);
  startLine.rotation.y = Math.atan2(t0.x, t0.z);
  group.add(startLine);

  const groundVisual = buildGroundVisual(meta.mode, terrain);
  group.add(groundVisual.mesh);

  // 环境装饰（树/石头，避开路面）
  group.add(buildEnvironment(meta, points, halfWidths, Math.max(...halfWidths), terrain));

  const { visual: barrierVisual, bodies: barrierBodies } = buildBarriers(points, tangents, halfWidths, barrierHeight, terrain);
  for (const b of barrierVisual) group.add(b);

  // 物理地面：简单模式用无限平面；复杂模式用整片地形 Trimesh + y=-30 安全兜底平面
  let ground: CANNON.Body;
  if (meta.mode === 'simple') {
    // cannon-es Plane 默认法线为 (0,0,1)；绕 X 轴旋转 -90° 使其朝上。
    // 必须把四元数放进构造参数并调用 updateAABB()：旋转后不刷新 AABB，
    // broadphase 会按旧的“竖直面”包围盒剔除车头方向（z>0）的轮子射线，导致前轮永不触地。
    const planeQuat = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
    ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), quaternion: planeQuat });
    ground.updateAABB();
  } else {
    const trimesh = new CANNON.Trimesh(groundVisual.positions, groundVisual.indices);
    ground = new CANNON.Body({ mass: 0, shape: trimesh });
    ground.updateAABB();
    // 安全兜底：掉出地形范围时落到 y=-30 平面，而不是无限坠落
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
    terrain,
  };
}
