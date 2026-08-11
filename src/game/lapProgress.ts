export interface LapProgressResult {
  dS: number;
  completedDistance: number;
  crossedLine: boolean;
}

/**
 * 单圈进度推进（纯函数，便于单测）：
 * 处理弧长回绕（跨过起点）、累计有效前进距离，并判断是否越过起终点线。
 */
export function updateLapProgress(
  s: number,
  lastS: number,
  totalLength: number,
  completedDistance: number,
): LapProgressResult {
  let dS = s - lastS;
  if (dS < -totalLength / 2) dS += totalLength;
  if (dS > totalLength / 2) dS -= totalLength;
  // 必须用“上一帧的 lastS”判断冲线；先更新 lastS 会让条件永远不成立（历史 bug）
  const crossedLine = lastS > totalLength * 0.85 && s < totalLength * 0.15;
  return {
    dS,
    completedDistance: completedDistance + Math.max(0, dS),
    crossedLine,
  };
}
