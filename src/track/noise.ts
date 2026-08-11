import { hash2 } from '../utils/random';

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smoothstep(x - x0);
  const fz = smoothstep(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

/**
 * 多层分形噪声高度函数，用于复杂（起伏）赛道。
 * 返回连续、可驾驶的起伏地形，幅度约 ±4m。
 */
export function makeElevation(seed: number): (x: number, z: number) => number {
  const s1 = seed;
  const s2 = seed ^ 0x9e3779b9;
  const s3 = seed ^ 0x85ebca6b;
  const AMPLITUDE = 4.2;
  return (x: number, z: number) => {
    const n =
      valueNoise(x * 0.011, z * 0.011, s1) * 0.62 +
      valueNoise(x * 0.045 + 137.0, z * 0.045 - 71.0, s2) * 0.28 +
      valueNoise(x * 0.16 + 512.0, z * 0.16 + 233.0, s3) * 0.1;
    return (n - 0.5) * 2 * AMPLITUDE;
  };
}
