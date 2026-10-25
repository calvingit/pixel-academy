// 随机源实现（docs/gameplay-number-puzzle.md「随机源接口」）：
// PRNG 算法属实现细节，只需满足「同一种子 + 同一消耗顺序 → 同一序列」。
// 复现与验收测试注入固定种子；玩家局默认用运行时熵（优先 crypto.getRandomValues，
// 不可用时回退 Math.random()）。
// M5：mulberry32 的全部未来输出由当前 32 位内部状态决定，因此中断局次只需
// 保存该状态（snapshotState）即可在重载后无缝续局（restoreSeededRng），
// 不必记录完整点击序列。
import type { Rng } from './rules.js';

/** 可快照的随机源：snapshotState 返回当前 32 位内部状态（uint32）。 */
export type RestorableRng = Rng & { readonly snapshotState: () => number };

function createMulberry32(initial: number): RestorableRng {
  let a = initial >>> 0;
  const next = (): number => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, { snapshotState: (): number => a >>> 0 });
}

/** mulberry32：32 位种子，输出 [0, 1)。返回值可快照内部状态供中断恢复。 */
export function createSeededRng(seed: number): RestorableRng {
  return createMulberry32(seed);
}

/** 从内部状态恢复（中断续局）：与快照时刻之后的输出序列完全一致，且可再次快照。 */
export function restoreSeededRng(state: number): RestorableRng {
  return createMulberry32(state);
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
export function createRuntimeRng(): RestorableRng {
  return createSeededRng(randomSeed());
}
