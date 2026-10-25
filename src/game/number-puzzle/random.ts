// 随机源实现（docs/gameplay-number-puzzle.md「随机源接口」）：
// PRNG 算法属实现细节，只需满足「同一种子 + 同一消耗顺序 → 同一序列」。
// 复现与验收测试注入固定种子；玩家局默认用运行时熵（优先 crypto.getRandomValues，
// 不可用时回退 Math.random()）。
import type { Rng } from './rules.js';

/** mulberry32：32 位种子，输出 [0, 1)。 */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    cryptoApi.getRandomValues(buffer);
    return buffer[0]!;
  }
  return Math.floor(Math.random() * 2 ** 32);
}

/** 玩家局随机源：运行时熵种子。 */
export function createRuntimeRng(): Rng {
  return createSeededRng(randomSeed());
}
