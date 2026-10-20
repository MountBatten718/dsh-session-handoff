// 三档模式的判定逻辑（纯函数，零依赖，可纯 Node 单测）。
//
// 权威规格：
//   §十三 13.1 三个档 / 13.4 手工硬切优先级
//   §十六 16.1（删除上下文阈值配置，档① 跟原生走） / 16.2（命名）
//   §十七 17.3（档② 完整判定链：体积 → 压缩次数）
//   §十八（档① = 原生生效阈值 × 0.98 抢跑折中）
//
// 本模块**不碰任何 ctx / 服务**，只吃数字、吐判定，便于穷举测试。

import { HANDOFF_DEFAULTS } from './handoff-config.mjs'

/** 判定结果的动作。 */
export const HANDOFF_ACTION = 'handoff'
/** 判定结果的动作：不动。 */
export const NO_ACTION = 'none'
/** 手工请求在非安全点时的动作：挂起，等下一个安全点。 */
export const DEFER_ACTION = 'defer'

/**
 * 原生上下文压缩的**生效阈值**（token）。
 * 规格 §十六 16.1 第 1 条：优先读原生生效阈值（公式 min(W × thresholdRatio, W − maxTokens − headroom)）；
 * 读不到则退化为 nativeCompactionRatio × 生效窗口。
 * @param {{windowTokens?: number, nativeThresholdTokens?: number, nativeCompactionRatio?: number}} input - 输入。
 * @returns {number|undefined} 生效阈值 token；无法确定时 undefined。
 */
export function resolveNativeThresholdTokens({
  windowTokens,
  nativeThresholdTokens,
  nativeCompactionRatio = HANDOFF_DEFAULTS.nativeCompactionRatio,
}) {
  if (Number.isFinite(nativeThresholdTokens) && nativeThresholdTokens > 0) {
    return Math.floor(nativeThresholdTokens)
  }
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return undefined
  return Math.floor(windowTokens * nativeCompactionRatio)
}

/**
 * 档① 的切换线（token）= 原生生效阈值 × replaceSafetyFactor（定案 0.98，§十八）。
 * @param {{windowTokens?: number, nativeThresholdTokens?: number, nativeCompactionRatio?: number, replaceSafetyFactor?: number}} input - 输入。
 * @returns {number|undefined} 切换线 token；无法确定时 undefined。
 */
export function resolveReplaceSwitchTokens({
  windowTokens,
  nativeThresholdTokens,
  nativeCompactionRatio = HANDOFF_DEFAULTS.nativeCompactionRatio,
  replaceSafetyFactor = HANDOFF_DEFAULTS.replaceSafetyFactor,
}) {
  const native = resolveNativeThresholdTokens({ windowTokens, nativeThresholdTokens, nativeCompactionRatio })
  if (native === undefined) return undefined
  return Math.floor(native * replaceSafetyFactor)
}

/**
 * 档② 的安全阀判定：自上次换会话起累计压缩满 N 次即触发；留空则不启用。
 * @param {{compactionsSinceHandoff?: number, compactionCountTrigger?: number|null}} input - 输入。
 * @returns {boolean} 是否因压缩次数触发。
 */
export function compactionTriggerArmed({ compactionsSinceHandoff, compactionCountTrigger }) {
  if (compactionCountTrigger === null || compactionCountTrigger === undefined) return false
  if (!Number.isInteger(compactionCountTrigger) || compactionCountTrigger < 1) return false
  if (!Number.isFinite(compactionsSinceHandoff)) return false
  return compactionsSinceHandoff >= compactionCountTrigger
}

/**
 * 自动判定（**唯一**决定"要不要自动换会话"的入口）。
 *
 * 档① 替代模式：达到原生生效阈值 × 0.98 即换会话（抢跑，不关原生压缩，§十八）。
 * 档② 混合模式：体积 ≥ 阈值 → 换；自上次换会话以来压缩次数 ≥ N → 换（N 留空跳过）。
 * 档③ 原生模式：永不自动换会话。
 *
 * @param {object} input - 判定输入。
 * @param {'replace'|'hybrid'|'native'} input.mode - 档位。
 * @param {number} [input.usedTokens] - 当前上下文占用的 token。
 * @param {number} [input.windowTokens] - 生效窗口 token（分母）。
 * @param {number} [input.nativeThresholdTokens] - 读到的原生生效阈值 token（读不到留空）。
 * @param {number} [input.nativeCompactionRatio] - 读不到原生阈值时的兜底比例。
 * @param {number} [input.replaceSafetyFactor] - 档① 抢跑系数。
 * @param {number} [input.sessionBytes] - 会话体积（字节）。
 * @param {number} [input.sessionVolumeLimitBytes] - 体积阈值（字节）。
 * @param {number} [input.compactionsSinceHandoff] - 自上次换会话以来的压缩次数。
 * @param {number|null} [input.compactionCountTrigger] - 安全阀 A（留空 = 不启用）。
 * @returns {{action: 'handoff'|'none', reason: string, detail: object}} 判定结果。
 */
export function decideAutoHandoff(input) {
  const mode = input?.mode

  if (mode === 'native') {
    return { action: NO_ACTION, reason: 'native-mode', detail: { mode } }
  }

  if (mode === 'replace') {
    const switchTokens = resolveReplaceSwitchTokens(input ?? {})
    if (switchTokens === undefined || !Number.isFinite(input?.usedTokens)) {
      // §五 降级：量不到用量就静默跳过本次判定，下次 pre-step 再试。
      return { action: NO_ACTION, reason: 'metric-unavailable', detail: { mode, switchTokens } }
    }
    if (input.usedTokens >= switchTokens) {
      return {
        action: HANDOFF_ACTION,
        reason: 'replace-threshold',
        detail: { mode, usedTokens: input.usedTokens, switchTokens },
      }
    }
    return {
      action: NO_ACTION,
      reason: 'below-replace-threshold',
      detail: { mode, usedTokens: input.usedTokens, switchTokens },
    }
  }

  if (mode === 'hybrid') {
    // §十七 17.3 判定链第 1 段：会话体积
    const limit = input?.sessionVolumeLimitBytes
    if (Number.isFinite(input?.sessionBytes) && Number.isFinite(limit) && input.sessionBytes >= limit) {
      return {
        action: HANDOFF_ACTION,
        reason: 'session-volume',
        detail: { mode, sessionBytes: input.sessionBytes, sessionVolumeLimitBytes: limit },
      }
    }
    // §十七 17.3 判定链第 2 段：压缩次数（仅混合模式生效；留空跳过）
    if (compactionTriggerArmed(input ?? {})) {
      return {
        action: HANDOFF_ACTION,
        reason: 'compaction-count',
        detail: {
          mode,
          compactionsSinceHandoff: input.compactionsSinceHandoff,
          compactionCountTrigger: input.compactionCountTrigger,
        },
      }
    }
    return { action: NO_ACTION, reason: 'below-load-thresholds', detail: { mode } }
  }

  // 配置校验已挡住未知档位；这里只是防御性兜底（不静默切）。
  return { action: NO_ACTION, reason: 'unknown-mode', detail: { mode } }
}

/**
 * 手工硬切判定（§13.4：优先级最高，不看阈值/档位/次数限制）。
 * **唯一底线是安全点**——不能在工具执行中切。
 * @param {{safePoint: boolean}} input - 安全点判定结果。
 * @returns {{action: 'handoff'|'defer', reason: string, detail: object}} 判定结果。
 */
export function decideManualHandoff({ safePoint }) {
  if (safePoint !== true) {
    return { action: DEFER_ACTION, reason: 'unsafe-point', detail: { safePoint: false } }
  }
  return { action: HANDOFF_ACTION, reason: 'manual', detail: { safePoint: true } }
}

/**
 * 会话是否参与自动硬切（NG-7 / D10：subagent 与 agent teams 会话不生效）。
 * @param {{origin?: string, delegationDepth?: number}|undefined} header - 会话头。
 * @returns {boolean} 是否参与自动判定。
 */
export function isAutoEligibleSession(header) {
  if (header === undefined || header === null || typeof header !== 'object') return false
  if (header.origin === 'subagent') return false
  if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return false
  return true
}

/**
 * 会话是否是**子代理会话**（2026-10-20 止血；架构师 task-33 取证）。
 *
 * 判据（与内核 `isSubagentOwner()` 第一分支同源；**绝不用标题**——标题会被模型改写）：
 * ① 内核强制字段 `session.header.origin === 'subagent'`；
 * ② 自描述投影 `sessionProjections.stateOf(session,'subagent') != null`。
 *
 * @param {{header?: object, projection?: unknown}} input - 会话头与 subagent 投影值。
 * @returns {boolean} 是否子代理会话。
 */
export function isSubagentSession(input) {
  const { header, projection } = input ?? {}
  if (header !== undefined && header !== null && typeof header === 'object' && header.origin === 'subagent') return true
  return projection !== undefined && projection !== null
}
