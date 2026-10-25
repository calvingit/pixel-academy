// 离线缓存状态与版本更新策略（PLAN.md M6）：纯 TypeScript 逻辑，无 DOM、
// 无 Service Worker / Cache Storage 依赖，可被 node --test 直接覆盖
// （tests/offline.test.mjs）。浏览器接线在 main.ts；Service Worker 侧由
// scripts/build-sw.mjs 把 web/sw.source.js 模板生成 web/sw.js，其缓存名前缀、
// 版本格式与旧缓存清理策略必须与本文保持一致（两侧文件头均有交叉说明）。
//
// 版本策略（M6 验收：新版本生效不破坏进行中的局次、清理旧版本缓存）：
// - 版本标记由构建时对全部预缓存资源（入口、脚本、样式与随构建进入产物的
//   练习数据模块）计算哈希得出，格式 assets-v1-<12 位十六进制>；
// - 缓存名 = 前缀 + 版本标记，新版本使用全新缓存名安装，安装失败不影响旧版本；
// - Service Worker 不自动 skipWaiting：等待中的新版本由页面在「非单局中途」
//   的时机（选择屏且无进行中局次）决定生效；单局数据全部在内存中，局次中途
//   不发生任何网络请求，激活推迟保证页面不会中途换用新旧资源；
// - 激活后按 staleCacheNames 清理同前缀旧缓存，其他来源的缓存不动。

/** 缓存名前缀：与 scripts/build-sw.mjs 生成的 sw.js 保持一致。 */
export const CACHE_PREFIX = 'pixel-academy:number-puzzle:';

/** 版本标记格式：assets-v1- + 12 位十六进制（构建脚本 computeAssetVersion 生成）。 */
export const VERSION_PATTERN = /^assets-v1-[0-9a-f]{12}$/;

/** 缓存名：前缀 + 资源版本标记；页面侧用于解析 SW 上报的版本。 */
export function buildCacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/**
 * 版本切换后的清理决策：输入 Cache Storage 的全部缓存名与当前版本缓存名，
 * 返回应删除的旧版本缓存（本应用前缀下、非当前名），按字典序排序保证确定性；
 * 其他应用或其他前缀的缓存一律不动。空数组表示无需清理。
 */
export function staleCacheNames(
  cacheNames: readonly string[],
  currentCacheName: string,
): string[] {
  return cacheNames
    .filter(name => name.startsWith(CACHE_PREFIX) && name !== currentCacheName)
    .sort();
}

// ---------------------------------------------------------------------------
// 更新采用时机（decideUpdateAdoption）
// ---------------------------------------------------------------------------

/** 页面所在界面归类：选择屏可安全切换版本，其余界面一律推迟。 */
export type UpdateScreen = 'select' | 'other';

export interface UpdateAdoptionInput {
  /** 是否存在等待中的新版本 Service Worker。 */
  readonly updateWaiting: boolean;
  /** 是否有进行中的单局（会话处于 running 或 paused；结算完成不算进行中）。 */
  readonly roundInProgress: boolean;
  /** 当前界面：仅选择屏（select）允许立即切换。 */
  readonly screen: UpdateScreen;
}

export interface UpdateAdoption {
  readonly action: 'adopt' | 'defer' | 'none';
  /** defer / adopt 时展示给玩家的提示；none 为 null。 */
  readonly notice: string | null;
}

export const UPDATE_DEFERRED_NOTICE =
  '新版本已下载，返回年级选择后自动生效；进行中的局次不受影响。';
export const UPDATE_ADOPTING_NOTICE = '正在应用新版本，页面即将刷新。';

/**
 * 决定何时让等待中的新版本生效：
 * - 无等待版本 → none（不提示）；
 * - 单局进行中，或不在选择屏 → defer（新版本已缓存但不激活，避免单局中途换资源）；
 * - 选择屏且无进行中局次 → adopt（页面向 SW 发送 skip-waiting，激活后刷新）。
 */
export function decideUpdateAdoption(input: UpdateAdoptionInput): UpdateAdoption {
  if (!input.updateWaiting) return { action: 'none', notice: null };
  if (input.roundInProgress || input.screen !== 'select') {
    return { action: 'defer', notice: UPDATE_DEFERRED_NOTICE };
  }
  return { action: 'adopt', notice: UPDATE_ADOPTING_NOTICE };
}

// ---------------------------------------------------------------------------
// 采用动作的执行决策（planAdoptionExecution）
// ---------------------------------------------------------------------------

export interface AdoptionExecutionInput {
  /** registration.waiting 是否存在（等待中的新版本 worker）。 */
  readonly waitingWorkerPresent: boolean;
  /** 当前 controller 是否不同于页面加载时记录的 controller（新版本已激活并接管）。 */
  readonly controllerChanged: boolean;
}

export type AdoptionExecutionAction =
  | 'send-skip-waiting'  // 向等待中的 worker 发 skip-waiting，等 controllerchange 后刷新
  | 'reload'             // 新版本已直接激活接管（waiting 被浏览器跳过）：直接刷新载入新版本
  | 'settle';            // 无实际版本变化：仅清除更新提示状态，不刷新（防无意义刷新循环）

export interface AdoptionExecution {
  readonly action: AdoptionExecutionAction;
  /** settle 时为 null（调用方应清除更新提示）；send-skip-waiting 时为「正在应用」提示。 */
  readonly notice: string | null;
}

/**
 * adopt 决策的执行计划。waiting 语义不可依赖：部分浏览器（或时序）会让新版本
 * 跳过 waiting 直接激活接管（独立复核第 1 轮实测），此时 waiting 为 null，向其
 * 发消息是静默无操作，页面会停在「正在应用新版本」且不刷新。此函数用
 * controllerChanged 区分两种情形：
 * - 已接管（controllerChanged=true）→ 立即刷新补上「返回年级选择后生效」，
 *   刷新后新页面以新版本为初始 controller，不会重复刷新；
 * - 未接管 → 更新状态已陈旧，仅收敛提示，保持可玩。
 */
export function planAdoptionExecution(input: AdoptionExecutionInput): AdoptionExecution {
  if (input.waitingWorkerPresent) return { action: 'send-skip-waiting', notice: UPDATE_ADOPTING_NOTICE };
  if (input.controllerChanged) return { action: 'reload', notice: null };
  return { action: 'settle', notice: null };
}

// ---------------------------------------------------------------------------
// 离线状态提示（describeOfflineStatus）
// ---------------------------------------------------------------------------

/**
 * 离线能力阶段：
 * - unsupported：浏览器不支持 Service Worker 或非安全上下文；
 * - preparing：首次安装进行中（预缓存未完成）；
 * - ready：当前版本缓存已就绪（SW 激活或已被控制）；
 * - failed：预缓存未完成（安装失败）；已有旧版本被控制时旧缓存仍可用。
 */
export type OfflinePhase = 'unsupported' | 'preparing' | 'ready' | 'failed';

export interface OfflineStatusInput {
  readonly phase: OfflinePhase;
  /** navigator.onLine === false。 */
  readonly offline: boolean;
  /** 页面当前被某个 Service Worker 控制（旧版本缓存可用）。 */
  readonly controlled: boolean;
  /** SW 上报的当前缓存版本标记；未知为 null。 */
  readonly version: string | null;
  /** 版本更新提示（decideUpdateAdoption 的 notice）；无则 null，优先展示。 */
  readonly updateNotice: string | null;
}

export interface OfflineStatus {
  readonly text: string;
  readonly warning: boolean;
  /** 是否可承诺离线可玩（缓存就绪，或旧版本缓存仍完整可用）。 */
  readonly playableOffline: boolean;
}

/** ready 阶段的在线文案：带版本标记，便于更新验证（M6：版本可识别）。 */
function readyText(version: string | null): string {
  return version
    ? `离线缓存已就绪（版本 ${version}），断网也能游玩。`
    : '离线缓存已就绪，断网也能游玩。';
}

/**
 * 由离线阶段、联网状态与更新提示推导页面提示文案。
 * 首次访问未完成缓存前（preparing）与缓存失败（failed）都不承诺离线可玩；
 * failed 但旧版本仍被控制时，如实说明仍可离线游玩的是旧版本。
 */
export function describeOfflineStatus(input: OfflineStatusInput): OfflineStatus {
  const { phase, offline, controlled, version, updateNotice } = input;
  let base: OfflineStatus;
  if (phase === 'ready') {
    base = offline
      ? {
          text: version
            ? `当前处于离线状态，正在使用已缓存资源（版本 ${version}）。`
            : '当前处于离线状态，正在使用已缓存资源。',
          warning: false, playableOffline: true,
        }
      : { text: readyText(version), warning: false, playableOffline: true };
  } else if (phase === 'preparing') {
    base = offline
      ? { text: '当前处于离线状态，离线缓存尚未完成，本次可能无法游玩。', warning: true, playableOffline: false }
      : { text: '正在准备离线缓存……完成前断网可能无法游玩。', warning: false, playableOffline: false };
  } else if (phase === 'failed') {
    base = offline
      ? (controlled
        ? { text: '当前处于离线状态，离线缓存更新未完成，正在使用上一个可用版本。', warning: true, playableOffline: true }
        : { text: '当前处于离线状态，且离线缓存未完成，无法保证正常游玩。请联网后重试。', warning: true, playableOffline: false })
      : (controlled
        ? { text: '离线缓存更新未完成，当前仍可离线游玩旧版本；请联网后刷新本页重试。', warning: true, playableOffline: true }
        : { text: '离线缓存未完成，断网可能无法游玩。请联网后刷新本页重试。', warning: true, playableOffline: false });
  } else {
    base = offline
      ? { text: '当前处于离线状态，且此浏览器不支持离线缓存。', warning: true, playableOffline: false }
      : { text: '当前浏览器不支持离线缓存，仅联网时可游玩。', warning: true, playableOffline: false };
  }
  return updateNotice
    ? { text: updateNotice, warning: base.warning, playableOffline: base.playableOffline }
    : base;
}
