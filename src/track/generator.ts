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

function pushSampled(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[]): void {
  const len = from.distanceTo(to);
  if (len < 0.8) return;
  const n = Math.max(1, Math.round(len / SAMPLE_SPACING));
  for (let k = 1; k <= n; k++) {
    out.push(from.clone().lerp(to, k / n));
  }
}

function pushArc(
  center: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3,
  out: THREE.Vector3[],
): void {
  const v0 = start.clone().sub(center);
  const radius = v0.length();
  if (radius < 1) return;
  const angle = Math.acos(
    Math.max(-1, Math.min(1, v0.clone().normalize().dot(end.clone().sub(center).normalize()))),
  );
  const steps = Math.max(3, Math.round((radius * angle) / SAMPLE_SPACING));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    out.push(center.clone().add(v0.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * t)));
  }
}

/** 凸多边形 + 圆角闭环（y=0）：保证至少一条长直线，弯道为光滑圆弧且保持趋势 */
function generatePolygonLoop(rng: () => number, totalTarget: number): THREE.Vector3[] {
  const vertexCount = 5 + Math.floor(rng() * 3); // 5~7 条边
  const angles: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    angles.push((i / vertexCount) * Math.PI * 2 + (rng() - 0.5) * 0.35);
  }
  angles.sort((a, b) => a - b);
  // 保证至少一条长边（直线段）：把最大角空隙扩到 ≥ 105°
  let maxGap = 0;
  let maxGapIdx = 0;
  for (let i = 0; i < vertexCount; i++) {
    const next = i === vertexCount - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
    const gap = next - angles[i];
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIdx = i;
    }
  }
  if (maxGap < (105 * Math.PI) / 180) {
    angles[(maxGapIdx + 1) % vertexCount] += (110 * Math.PI) / 180 - maxGap;
    angles.sort((a, b) => a - b);
  }
  const vertices = angles.map((a) => {
    const r = 0.75 + rng() * 0.5;
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  });
  let perimeter = 0;
  for (let i = 0; i < vertexCount; i++) {
    perimeter += vertices[i].distanceTo(vertices[(i + 1) % vertexCount]);
  }
  const scale = totalTarget / perimeter;
  for (const v of vertices) v.multiplyScalar(scale);

  const corners = vertices.map((curr, i) => {
    const prev = vertices[(i - 1 + vertexCount) % vertexCount];
    const next = vertices[(i + 1) % vertexCount];
    const inDir = curr.clone().sub(prev).normalize();
    const outDir = next.clone().sub(curr).normalize();
    const r = Math.min(curr.distanceTo(prev) * 0.4, curr.distanceTo(next) * 0.4, 30 + rng() * 35);
    return {
      center: curr.clone(),
      start: curr.clone().sub(inDir.clone().multiplyScalar(r)),
      end: curr.clone().add(outDir.clone().multiplyScalar(r)),
    };
  });

  const points: THREE.Vector3[] = [];
  points.push(corners[0].start.clone());
  pushArc(corners[0].center, corners[0].start, corners[0].end, points);
  for (let i = 1; i < vertexCount; i++) {
    pushSampled(corners[i - 1].end, corners[i].start, points);
    pushArc(corners[i].center, corners[i].start, corners[i].end, points);
  }
  pushSampled(corners[vertexCount - 1].end, corners[0].start, points);
  return points;
}

/** 简单赛道：多边形圆角，长度 1200~2200m 随机 */
function generateSimpleTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  return generatePolygonLoop(rng, 1200 + rng() * 1000);
}

/** 高度规则：弯道平台（不倾斜），直道上用尽量短的坡实现水平差（可连续） */
function assignElevation(points: THREE.Vector3[], rng: () => number): number[] {
  const n = points.length;
  // 曲率（相邻切线航向差 / 弧长）
  const curv: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const h0 = Math.atan2(points[next].x - points[prev].x, points[next].z - points[prev].z);
    const h1 = Math.atan2(points[(next + 1) % n].x - points[i].x, points[(next + 1) % n].z - points[i].z);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const segLen = Math.max(0.1, points[prev].distanceTo(points[next]));
    curv[i] = Math.abs(dh) / segLen;
  }
  const CORNER_CURVE = 0.006;
  // 连续弯道区域编号（环形）
  const regionId: number[] = new Array(n).fill(-1);
  let rid = 0;
  for (let i = 0; i < n; i++) {
    if (curv[i] > CORNER_CURVE) {
      if (i === 0 || curv[i - 1] <= CORNER_CURVE) rid++;
      regionId[i] = rid;
    }
  }
  // 首尾弯道区域合并（若最后一段也是弯道且与开头弯道相连）
  if (regionId[0] >= 0 && regionId[n - 1] >= 0 && regionId[n - 1] === rid) {
    for (let i = 0; i < n && regionId[i] >= 0; i++) regionId[i] = rid;
  }
  // 兜底：若弯道区域少于 2 个（如纯八字曲线无“直线”），按最高曲率点强制制造 2 个平台区域
  if (rid < 2) {
    const forceRegion = (centerIdx: number, id: number, halfSpan: number): void => {
      for (let k = -halfSpan; k <= halfSpan; k++) {
        regionId[(centerIdx + k + n) % n] = id;
      }
    };
    let maxC1 = 0;
    let maxI1 = 0;
    for (let i = 0; i < n; i++) {
      if (curv[i] > maxC1) {
        maxC1 = curv[i];
        maxI1 = i;
      }
    }
    forceRegion(maxI1, 1, Math.max(40, Math.round(n / 8)));
    let maxC2 = 0;
    let maxI2 = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.min(Math.abs(i - maxI1), n - Math.abs(i - maxI1));
      if (d > n / 4 && curv[i] > maxC2) {
        maxC2 = curv[i];
        maxI2 = i;
      }
    }
    if (maxI2 >= 0) {
      forceRegion(maxI2, 2, Math.max(40, Math.round(n / 8)));
      rid = 2;
    } else {
      rid = 1;
    }
  }
  const levels = [0, 3, 6];
  const regionHeight = new Map<number, number>();
  for (let r = 1; r <= rid; r++) {
    let h = levels[Math.floor(rng() * levels.length)];
    if (r > 1 && h === regionHeight.get(r - 1)) h = levels[(levels.indexOf(h) + 1) % levels.length];
    regionHeight.set(r, h);
  }
  const h: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (regionId[i] >= 0) h[i] = regionHeight.get(regionId[i]) ?? 0;
  }
  // 直线段：短坡连接两端平台（坡长 ~18m，可连续；两端同高则平直）
  const rampLen = Math.max(6, Math.round(18 / SAMPLE_SPACING));
  const fillStraight = (s: number, e: number): void => {
    const prevR = regionId[(s - 1 + n) % n];
    const nextR = regionId[(e + 1) % n];
    const hA = prevR >= 0 ? (regionHeight.get(prevR) ?? 0) : 0;
    const hB = nextR >= 0 ? (regionHeight.get(nextR) ?? 0) : 0;
    const len = (e - s + n) % n + 1;
    if (hA === hB) {
      for (let k = 0; k < len; k++) h[(s + k) % n] = hA;
      return;
    }
    // 斜坡长度随高差增大（≤ 0.25 坡度），避免断崖
    const needRamp = Math.max(rampLen, Math.round((Math.abs(hB - hA) * 4) / SAMPLE_SPACING));
    const useRamp = Math.min(needRamp, Math.floor(len / 2));
    const mid = s + Math.floor((len - useRamp) / 2);
    for (let k = 0; k < len; k++) {
      const idx = (s + k) % n;
      if (k < mid - s) h[idx] = hA;
      else if (k >= mid - s + useRamp) h[idx] = hB;
      else h[idx] = hA + (hB - hA) * smoothstep((k - (mid - s)) / Math.max(1, useRamp - 1));
    }
  };
  // 找到所有直线段（环形，含跨 0 段）
  let s = -1;
  for (let i = 0; i < n; i++) {
    if (regionId[i] === -1 && regionId[(i - 1 + n) % n] !== -1) s = i;
  }
  if (s >= 0) {
    let i = s;
    let e = -1;
    while (regionId[i] === -1) {
      e = i;
      i = (i + 1) % n;
      if (i === s) break;
    }
    fillStraight(s, e);
    // 其余直线段
    i = (e + 1) % n;
    while (i !== s) {
      if (regionId[i] === -1) {
        const ss = i;
        let ee = i;
        while (regionId[ee] === -1) {
          ee = (ee + 1) % n;
          if (ee === ss) break;
        }
        ee = (ee - 1 + n) % n;
        fillStraight(ss, ee);
        i = (ee + 1) % n;
      } else {
        i = (i + 1) % n;
      }
    }
  }
  return h;
}

/** 复杂赛道：布局随机（八字 / 多边形），高度=弯道平台 + 直道短坡（水平差、可连续） */
function generateComplexTrack(meta: TrackMeta): THREE.Vector3[] {
  const rng = mulberry32(meta.seed);
  const totalTarget = 1400 + rng() * 800; // 1400~2200m 随机
  let flat: THREE.Vector3[];
  if (rng() < 0.5) {
    // 八字形（lemniscate），中心交叉
    const steps = Math.max(400, Math.round(totalTarget / SAMPLE_SPACING));
    const raw: THREE.Vector3[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * Math.PI * 2;
      const s = 1 + Math.sin(t) ** 2;
      raw.push(new THREE.Vector3(Math.cos(t) / s, 0, (Math.sin(t) * Math.cos(t)) / s));
    }
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += raw[i].distanceTo(raw[i - 1]);
    const scale = totalTarget / len;
    flat = raw.map((p) => new THREE.Vector3(p.x * scale, 0, p.z * scale));
  } else {
    // 多边形圆角
    flat = generatePolygonLoop(rng, totalTarget);
  }
  const heights = assignElevation(flat, rng);
  return flat.map((p, i) => new THREE.Vector3(p.x, heights[i], p.z));
}

/** 根据种子生成闭环中心线采样点（简单=多边形圆角；复杂=八字高架桥） */
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

  for (let i = 0; i < points.length; i += BARRIER_STEP) {
    const j = (i + BARRIER_STEP) % n;
    // 护栏段两端各取“该采样点的实际路面边缘”，与加宽后的路面精确对齐
    const rightI = new THREE.Vector3(tangents[i].z, 0, -tangents[i].x).normalize();
    const rightJ = new THREE.Vector3(tangents[j].z, 0, -tangents[j].x).normalize();
    const offsetI = halfWidths[i] + BARRIER_THICKNESS / 2 + 0.08;
    const offsetJ = halfWidths[j] + BARRIER_THICKNESS / 2 + 0.08;

    for (const side of [-1, 1]) {
      const eI = new THREE.Vector3(
        points[i].x + rightI.x * offsetI * side,
        points[i].y,
        points[i].z + rightI.z * offsetI * side,
      );
      const eJ = new THREE.Vector3(
        points[j].x + rightJ.x * offsetJ * side,
        points[j].y,
        points[j].z + rightJ.z * offsetJ * side,
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
