import * as THREE from 'three';

/** 2D Canvas 俯视小地图：赛道轮廓 + 车 + 起终点 */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  points: THREE.Vector3[],
  roadWidth: number,
  carPos: THREE.Vector3,
  heading: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

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
  const pad = 16;
  const scale = Math.min(
    (W - pad * 2) / Math.max(1, maxX - minX),
    (H - pad * 2) / Math.max(1, maxZ - minZ),
  );
  const toScreen = (x: number, z: number): [number, number] => [
    pad + (x - minX) * scale,
    pad + (maxZ - z) * scale,
  ];

  // 路面（粗线描边模拟道路轮廓）
  ctx.beginPath();
  points.forEach((p, i) => {
    const [sx, sy] = toScreen(p.x, p.z);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.lineWidth = Math.max(3, roadWidth * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#565c66';
  ctx.stroke();

  // 中心线
  ctx.beginPath();
  points.forEach((p, i) => {
    const [sx, sy] = toScreen(p.x, p.z);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#9aa1ac';
  ctx.stroke();

  // 起终点
  const p0 = points[0];
  const p1 = points[1 % points.length];
  const [ax, ay] = toScreen(p0.x, p0.z);
  const [bx, by] = toScreen(p1.x, p1.z);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 8;
  const ny = (dx / len) * 8;
  ctx.beginPath();
  ctx.moveTo(ax - nx, ay - ny);
  ctx.lineTo(ax + nx, ay + ny);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // 车辆
  const [cx, cy] = toScreen(carPos.x, carPos.z);
  ctx.beginPath();
  ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd54a';
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 车头朝向
  const dirX = Math.sin(heading) * 12;
  const dirY = -Math.cos(heading) * 12;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dirX, cy + dirY);
  ctx.strokeStyle = '#ffd54a';
  ctx.lineWidth = 2;
  ctx.stroke();
}
