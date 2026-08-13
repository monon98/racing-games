/** 可复现的伪随机数生成器（种子化） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

/** 默认玩家名：玩家 + 5 位随机字母数字（去掉易混淆字符） */
const NAME_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomPlayerName(): string {
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  }
  return `玩家${s}`;
}

/** 二维整数哈希 → [0,1) */
export function hash2(x: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
