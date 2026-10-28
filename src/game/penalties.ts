import { MIN_DISTANCE_PENALTY_M } from '../config';

/**
 * 单次重生的距离惩罚（m）：
 * - 进度回退距离不足 10m（含原地重生、回退为 0）也按 10m 起始值计；
 * - 实际回退更远时按实际回退距离累加，不封顶。
 */
export function respawnDistancePenaltyM(lastS: number, respawnS: number): number {
  return Math.max(MIN_DISTANCE_PENALTY_M, Math.max(0, lastS - respawnS));
}
