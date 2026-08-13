import { WRONG_WAY_HEADING_DOT, WRONG_WAY_SPEED } from '../config';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * 逆行判定：只有“车头朝后（与赛道切线反向）且沿车头方向前进”才算逆行。
 * 倒车（车头朝前向后开）或车头朝后但向后开（实际沿赛道方向移动）都不触发。
 */
export function isWrongWay(forward: Vec3Like, tangent: Vec3Like, forwardSpeed: number): boolean {
  const fl = Math.hypot(forward.x, forward.y, forward.z);
  const tl = Math.hypot(tangent.x, tangent.y, tangent.z);
  const denom = (fl * tl) || 1;
  const headingDot = (forward.x * tangent.x + forward.y * tangent.y + forward.z * tangent.z) / denom;
  return headingDot < WRONG_WAY_HEADING_DOT && forwardSpeed > WRONG_WAY_SPEED;
}
