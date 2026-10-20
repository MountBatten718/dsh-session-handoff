// 健康度结论（三色 / N 轮外推 / 文案格式化 / 涨速台账 / 明细表）——**纯计算，零依赖**。
//
// 设计规则：两指标取最差定颜色；「还能撑约 N 轮」由涨速外推。
//
// 本模块同时被两侧使用：
//   - host：`lib/handoff-report.mjs` 组装 DTO 时算不出结论，由客户端算；
//   - client：`src/client/handoff-health.d.ts` 声明类型后直接 import 本文件（内联进 lib/client.js）。
// 因此这里**绝不能 import 任何 @deepseek-ai/* 或 node 内建**。
//
// ⚠️ 唯一允许的跨模块依赖是 `./handoff-config.mjs`（P2-3：兜底比例单一来源）。
//    已逐行确认它与 `./constants.mjs` **都不 import 任何 node 内建 / @deepseek-ai/* 包**，
//    只用纯 JS（Object / JSON / Number），因此内联进浏览器 bundle 是安全的；
//    代价是客户端产物会多内联进一点点配置常量与校验代码（可忽略，换来"比例只有一份"）。

import { HANDOFF_DEFAULTS } from './handoff-config.mjs'

/** 三色档位。 */
export const HEALTH_LEVELS = Object.freeze(['green', 'warning', 'danger'])

/** 琥珀档起点系数：任一指标 ≥ 阈值 × 0.85（设计文档 §一 S2 三色规则）。 */
export const WARN_FACTOR = 0.85

/** 涨速样本窗口（毫秒）。 */
export const HISTORY_WINDOW_MS = 10 * 60 * 1000

/** 样本上限（防止长时间不换会话时无限增长）。 */
export const HISTORY_MAX_SAMPLES = 40

/** 一个"步"的估算时长（毫秒）。只在拿不到"轮次"增量的降级路径里用。 */
export const STEP_MS_FALLBACK = 45 * 1000

/** 一"轮"的步数估算（拿不到 turnIndex 增量时，按每轮约 3 步折算）。 */
export const STEPS_PER_TURN_FALLBACK = 3

/** 结论句里的定性词。 */
export const PACE_WORDS = Object.freeze([
  '很稳',
  '正常',
  '偏快',
  '很快',
])

/**
 * 取两者中最差的颜色（绿 < 琥珀 < 红）。
 *
 * ⚠️ **全空返回 `undefined`，不再返回 `'green'`**（P1-6 修复）：
 *    以前 `indexOf(undefined) = -1`、`worst = 0`，于是「两个指标都量不到」被
 *    `worstLevel` 偷偷解释成绿色健康。现在"量不到"是显式事实，由 `computeHealth`
 *    按保守口径（`measured === false` → `warning`）裁决，本函数不再代替它做决定。
 *
 * @param {...('green'|'warning'|'danger'|undefined)} levels - 候选颜色。
 * @returns {'green'|'warning'|'danger'|undefined} 最差颜色；全部不可用（或没传）时 undefined。
 */
export function worstLevel(...levels) {
  let worst = -1
  for (const level of levels) {
    const index = HEALTH_LEVELS.indexOf(level)
    if (index > worst) worst = index
  }
  return worst < 0 ? undefined : HEALTH_LEVELS[worst]
}

/**
 * 单个指标的档位（≥ 阈值 → danger；≥ 阈值 × 0.85 → warning；否则 green）。
 * 任一输入不可用（NaN / 窗口缺失 / 阈值为 0）→ undefined（明细表里显示「—」）。
 * @param {{value?: number, limit?: number}} input - 当前值与阈值。
 * @returns {'green'|'warning'|'danger'|undefined} 档位。
 */
export function levelFor({ value, limit }) {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return undefined
  if (value >= limit) return 'danger'
  if (value >= limit * WARN_FACTOR) return 'warning'
  return 'green'
}

/**
 * 计算健康度结论（三色 + 每个指标的位置）。
 *
 * 阈值的取法（设计文档 §一 S2 表格）：
 * - 替代模式 replace：上下文阈值 = **原生阈值 × 0.98**（即抢跑线），并给出刻度线；
 * - 混合模式 hybrid：上下文不进判定（交给原生压缩），**不画刻度线**；会话体积进判定；
 * - 原生模式 native：只展示当前值（两个指标都画阈值刻度，但结论恒为绿——插件不动作）。
 *
 * @param {object} input - 输入。
 * @param {'replace'|'hybrid'|'native'} input.mode - 档位。
 * @param {number} [input.usedTokens] - 上下文占用 token。
 * @param {number} [input.windowTokens] - 生效窗口 token。
 * @param {number} [input.nativeThresholdTokens] - 原生生效阈值 token（读不到留空）。
 * @param {number} [input.nativeCompactionRatio] - 读不到原生阈值时的兜底比例；
 *   缺省取 `HANDOFF_DEFAULTS.nativeCompactionRatio`（与 `handoff-policy` 同源，P2-3）。
 * @param {number} [input.replaceSafetyFactor] - 档①抢跑系数。
 * @param {number} [input.sessionBytes] - 会话体积（字节）。
 * @param {number} [input.sessionVolumeLimitBytes] - 会话体积阈值（字节）。
 * @returns {object} 结论对象；`measured` 说明"这次到底量到了什么"。
 */
export function computeHealth(input) {
  const mode = input?.mode ?? 'hybrid'
  const usedTokens = input?.usedTokens
  const windowTokens = input?.windowTokens
  const factor = Number.isFinite(input?.replaceSafetyFactor) ? input.replaceSafetyFactor : 0.98
  // ⚠️ 兜底比例**只此一份**（P2-3）：默认值直接读 `HANDOFF_DEFAULTS.nativeCompactionRatio`
  //    （handoff-config.mjs 的单一来源），与 `handoff-policy.resolveNativeThresholdTokens`
  //    走的是同一个常量——以前这里把比例硬编码成窗口的 8 折（字面量），改了配置两边就漂移。
  //    调用方（host DTO）也可以显式传入已解析的配置值。
  const nativeCompactionRatio = Number.isFinite(input?.nativeCompactionRatio)
    ? input.nativeCompactionRatio
    : HANDOFF_DEFAULTS.nativeCompactionRatio

  const nativeThresholdTokens = Number.isFinite(input?.nativeThresholdTokens) && input.nativeThresholdTokens > 0
    ? Math.floor(input.nativeThresholdTokens)
    : (Number.isFinite(windowTokens) && windowTokens > 0 ? Math.floor(windowTokens * nativeCompactionRatio) : undefined)

  // 上下文阈值：替代模式 = 原生 × 0.98；原生/混合模式 = 原生阈值本身（刻度线用）。
  const contextLimitTokens = nativeThresholdTokens === undefined
    ? undefined
    : (mode === 'replace' ? Math.floor(nativeThresholdTokens * factor) : nativeThresholdTokens)

  const context = {
    usedTokens: Number.isFinite(usedTokens) ? usedTokens : undefined,
    windowTokens: Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : undefined,
    limitTokens: contextLimitTokens,
    ratio: Number.isFinite(usedTokens) && Number.isFinite(windowTokens) && windowTokens > 0 ? usedTokens / windowTokens : undefined,
    limitRatio: contextLimitTokens === undefined || !Number.isFinite(windowTokens) || windowTokens <= 0
      ? undefined
      : contextLimitTokens / windowTokens,
    // 设计文档：只有替代模式画「阈值刻度竖线」；混合模式不画（上下文交给原生压缩）。
    showMarker: mode === 'replace' && contextLimitTokens !== undefined,
  }

  const sessionBytes = Number.isFinite(input?.sessionBytes) ? input.sessionBytes : undefined
  const volumeLimitBytes = Number.isFinite(input?.sessionVolumeLimitBytes) && input.sessionVolumeLimitBytes > 0
    ? input.sessionVolumeLimitBytes
    : undefined
  const volume = {
    bytes: sessionBytes,
    limitBytes: volumeLimitBytes,
    ratio: sessionBytes === undefined || volumeLimitBytes === undefined ? undefined : sessionBytes / volumeLimitBytes,
    showMarker: volumeLimitBytes !== undefined,
  }

  // 上下文是否参与"最差颜色"判定：替代模式参与；混合/原生模式不参与（规格 §一 S2）。
  const contextLevel = mode === 'replace' && context.showMarker
    ? levelFor({ value: context.usedTokens, limit: context.limitTokens })
    : undefined
  const volumeLevel = levelFor({ value: volume.bytes, limit: volume.limitBytes })

  // 「量到了吗」= 这两个指标里**至少有一个真的读到了当前值**（P1-6 修复）：
  //   - 上下文可用：token 计量给了 usedTokens，且窗口/原生阈值能推出生效阈值（否则算不出来）；
  //   - 体积可用：台账给了 sessionBytes，且配了正的体积阈值。
  // 两个都不可用 → measured=false → 结论保守取 warning（既不说健康、也不说危险），
  // 并把 measured 显式带出去，让调用方/文案知道这是"读不到"而不是"健康"。
  const contextUsable = context.usedTokens !== undefined && context.limitTokens !== undefined
  const volumeUsable = volume.bytes !== undefined && volume.limitBytes !== undefined
  const measured = contextUsable || volumeUsable

  // 参与判定的指标全不可用（如混合模式下只有上下文可读、体积读不到）时，
  // worstLevel 给 undefined；此时按"不参与判定 = 不染色"取 green（量到了即非未知）。
  const worst = worstLevel(contextLevel, volumeLevel)
  const level = measured ? (worst ?? 'green') : 'warning'

  return { mode, level, measured, context, volume, contextCounts: mode === 'replace' }
}

/**
 * 计算"还能撑约 N 轮"。
 *
 * 涨速口径（设计文档 §一 S2：「N 由涨速外推；拿不到涨速就退化为显示当前值与距阈值距离」）：
 * ```
 * 每轮增量 = Δ(主导指标) / Δ(turnIndex + 1)
 * N = floor((阈值 − 当前) / 每轮增量)
 * ```
 * 主导指标 = 离自己的阈值更近的那个（体积优先，与判定链一致）。
 * 增速 ≤ 0 → N = 0 且 `reason: 'flat'`（不涨就永远撑得住），never 给负数。
 *
 * @param {object} input - 输入。
 * @param {object} input.health - `computeHealth` 的结果。
 * @param {number} [input.perTurnTokens] - 每轮上下文增量（token）。
 * @param {number} [input.perTurnBytes] - 每轮会话体积增量（字节）。
 * @param {number} [input.perTurnHours] - 每轮耗时（小时）；无轮次增量时的降级口径。
 * @returns {{n?: number, metric: 'context'|'volume'|null, remainingTokens?: number, remainingBytes?: number, reason: string}} 外推结果。
 */
export function estimateTurnsLeft({ health, perTurnTokens, perTurnBytes, perTurnHours }) {
  if (health === undefined) return { metric: null, reason: 'no-health' }

  const contextGap = health.context.limitTokens === undefined || health.context.usedTokens === undefined
    ? undefined
    : health.context.limitTokens - health.context.usedTokens
  const volumeGap = health.volume.limitBytes === undefined || health.volume.bytes === undefined
    ? undefined
    : health.volume.limitBytes - health.volume.bytes

  // 主导指标：谁离阈值更近（比例更小）；不可比时用可用的那个。
  let metric = null
  if (health.contextCounts && contextGap !== undefined && volumeGap !== undefined) {
    const contextLeft = health.context.limitTokens === 0 ? 0 : health.context.usedTokens / health.context.limitTokens
    const volumeLeft = health.volume.limitBytes === 0 ? 0 : health.volume.bytes / health.volume.limitBytes
    metric = volumeLeft <= contextLeft ? 'volume' : 'context'
  } else if (health.contextCounts && contextGap !== undefined) {
    metric = 'context'
  } else if (volumeGap !== undefined) {
    metric = 'volume'
  }

  if (metric === null) return { metric: null, reason: 'no-metric' }

  const gap = metric === 'context' ? contextGap : volumeGap
  const remainingTokens = contextGap
  const remainingBytes = volumeGap
  if (gap === undefined) return { metric, reason: 'no-metric', remainingTokens, remainingBytes }
  if (gap <= 0) return { n: 0, metric, reason: 'reached', remainingTokens, remainingBytes }

  // 每轮增量：host 与 client 用同一份口径（`computeRates` 的产物）。
  const perTurn = metric === 'context' ? perTurnTokens : perTurnBytes
  if (!Number.isFinite(perTurn) || perTurn <= 0) {
    // 设计文档的退化路径：拿不到涨速 → 只报"当前值 + 距阈值距离"，不编 N。
    return { metric, reason: 'no-rate', remainingTokens, remainingBytes, hoursPerTurn: perTurnHours }
  }

  const n = Math.max(0, Math.floor(gap / perTurn))
  return { n, metric, reason: 'extrapolated', perTurn, remainingTokens, remainingBytes, hoursPerTurn: perTurnHours }
}

/**
 * 涨速台账：按会话记录 (时间, 轮次序号, 用量) 采样，算出"每轮增量"。
 *
 * 轮次序号来自 `turn/start` 事件计数（`lib/handoff-metrics.mjs` 的 `turnIndexOf`）。
 * 设计文档要求"必须带涨速"，但**没有**要求把涨速当成开关；样本不足时上层退化为
 * 显示"当前值 + 距阈值距离"。
 *
 * @param {{now?: () => number, windowMs?: number, maxSamples?: number}} [options] - 可注入时间源与窗口。
 * @returns {object} 台账 API。
 */
export function createRateTracker({ now = () => Date.now(), windowMs = HISTORY_WINDOW_MS, maxSamples = HISTORY_MAX_SAMPLES } = {}) {
  /** @type {Map<string, Array<{at: number, turnIndex: number, usedTokens?: number, sessionBytes?: number}>>} */
  const samples = new Map()

  function prune(list) {
    const cutoff = now() - windowMs
    while (list.length > 0 && list[0].at < cutoff) list.shift()
    while (list.length > maxSamples) list.shift()
    return list
  }

  return {
    /**
     * 记一条样本。
     * @param {string} sessionId - 会话 id。
     * @param {{turnIndex?: number, usedTokens?: number, sessionBytes?: number}} sample - 样本。
     * @returns {void}
     */
    observe(sessionId, sample) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const list = prune(samples.get(sessionId) ?? [])
      list.push({
        at: now(),
        turnIndex: Number.isFinite(sample?.turnIndex) ? sample.turnIndex : 0,
        usedTokens: Number.isFinite(sample?.usedTokens) ? sample.usedTokens : undefined,
        sessionBytes: Number.isFinite(sample?.sessionBytes) ? sample.sessionBytes : undefined,
      })
      samples.set(sessionId, list)
    },
    /**
     * 取窗口内最早的一条样本（作为差分基线）。
     * @param {string} sessionId - 会话 id。
     * @returns {object|undefined} 基线样本。
     */
    baseline(sessionId) {
      const list = prune(samples.get(sessionId) ?? [])
      return list[0]
    },
    /**
     * 取窗口内最新的一条样本。
     * @param {string} sessionId - 会话 id。
     * @returns {object|undefined} 最新样本。
     */
    latest(sessionId) {
      const list = prune(samples.get(sessionId) ?? [])
      return list[list.length - 1]
    },
    /** 丢弃某会话的样本（`session/disposed` 时调）。 */
    forget(sessionId) {
      samples.delete(sessionId)
    },
    /** 已采样会话数（排障用）。 */
    get size() {
      return samples.size
    },
  }
}

/**
 * 由台账算出"每轮增量"（token / 字节）。
 * 轮次分母 = Δ(turnIndex) + 1——因为**当前这一步所在轮的增量还没结算**，
 * 用 +1 才能把"本轮已经开始涨的那部分"摊进平均值（否则会长期低估涨速、N 偏大）。
 *
 * @param {object} input - 输入。
 * @param {object} [input.tracker] - `createRateTracker` 的产物。
 * @param {string} input.sessionId - 会话 id。
 * @param {number} [input.turnIndex] - 当前轮次序号。
 * @param {number} [input.usedTokens] - 当前上下文 token。
 * @param {number} [input.sessionBytes] - 当前会话体积字节。
 * @returns {{perTurnTokens?: number, perTurnBytes?: number, hoursPerTurn?: number, turns: number, reason: string}} 涨速。
 */
export function computeRates({ tracker, sessionId, turnIndex, usedTokens, sessionBytes }) {
  if (tracker === undefined) return { turns: 0, reason: 'no-tracker' }
  const base = tracker.baseline(sessionId)
  const last = tracker.latest(sessionId)
  if (base === undefined || last === undefined || base === last) return { turns: 0, reason: 'insufficient-samples' }
  const currentTurn = Number.isFinite(turnIndex) ? turnIndex : last.turnIndex
  const deltaTurns = Math.max(1, (currentTurn - base.turnIndex) + 1)
  const result = {
    turns: deltaTurns,
    elapsedMs: Math.max(0, last.at - base.at),
    reason: 'ok',
  }
  const baseTokens = base.usedTokens
  const lastTokens = Number.isFinite(usedTokens) ? usedTokens : last.usedTokens
  if (Number.isFinite(baseTokens) && Number.isFinite(lastTokens) && lastTokens >= baseTokens) {
    result.perTurnTokens = (lastTokens - baseTokens) / deltaTurns
  }
  const baseBytes = base.sessionBytes
  const lastBytes = Number.isFinite(sessionBytes) ? sessionBytes : last.sessionBytes
  if (Number.isFinite(baseBytes) && Number.isFinite(lastBytes) && lastBytes >= baseBytes) {
    result.perTurnBytes = (lastBytes - baseBytes) / deltaTurns
  }
  if (Number.isFinite(result.elapsedMs) && result.elapsedMs > 0) {
    result.hoursPerTurn = (result.elapsedMs / 3_600_000) / deltaTurns
  }
  return result
}

/**
 * 涨速的定性词（用于"· 涨得偏快"这类追加语）。
 * @param {number|undefined} perTurn - 每轮增量。
 * @param {number|undefined} gap - 距阈值的剩余量。
 * @param {number|undefined} n - 外推出的可撑轮数。
 * @returns {'unknown'|'flat'|'calm'|'normal'|'fast'} 定性。
 */
export function paceOf({ perTurn, gap, n }) {
  if (Number.isFinite(n) && n <= 0) return 'flat'
  if (!Number.isFinite(perTurn) || perTurn <= 0) return Number.isFinite(gap) ? 'flat' : 'unknown'
  if (!Number.isFinite(gap)) return 'unknown'
  if (n === undefined || !Number.isFinite(n) || perTurn <= 0) return 'normal'
  if (n <= 3) return 'fast'
  if (n <= 10) return 'normal'
  return 'calm'
}

/**
 * 结论句（右侧那一段）。**这是本模块唯一的文案出口**，host 与 client 共用同一份。
 *
 * 设计文档三色文案：
 * ```
 * 🟢 健康（< 阈值×0.85）
 * 🟠 还能撑约 N 轮（≥ 阈值×0.85 且 < 阈值）
 * 🔴 建议现在就换（≥ 阈值）
 * ```
 * 外加"必须带涨速"：涨得快时追加「· 涨得偏快」。
 *
 * @param {object} input - 输入。
 * @param {object} input.health - `computeHealth` 结果。
 * @param {object} [input.turnsLeft] - `estimateTurnsLeft` 结果。
 * @returns {{icon: string, text: string, level: string, pace: string}} 结论。
 */
export function conclusionOf({ health, turnsLeft }) {
  const level = health?.level ?? 'green'
  const pace = paceOf({
    perTurn: turnsLeft?.perTurn,
    gap: turnsLeft?.metric === 'context' ? turnsLeft?.remainingTokens : turnsLeft?.remainingBytes,
    n: turnsLeft?.n,
  })
  const icon = level === 'danger' ? '🔴' : level === 'warning' ? '🟠' : '🟢'
  const fastSuffix = pace === 'fast' ? ' · 涨得偏快' : ''

  // 「读不到」不是「健康」（P1-6）：两个指标一个都没量到时，绝不能给 🟢 健康这种
  // 会让人误以为"一切正常"的结论，而要在文案里说清是计量失败。
  if (health?.measured === false) {
    return { icon, level, pace, text: `${icon} 读不到用量（token 计量或上下文窗口投影不可用）` }
  }

  if (level === 'danger') {
    return { icon, level, pace, text: `${icon} 建议现在就换${fastSuffix}` }
  }
  if (level === 'warning') {
    if (Number.isFinite(turnsLeft?.n) && turnsLeft.n > 0) {
      return { icon, level, pace, text: `${icon} 还能撑约 ${turnsLeft.n} 轮${fastSuffix}` }
    }
    if (Number.isFinite(turnsLeft?.remainingTokens) || Number.isFinite(turnsLeft?.remainingBytes)) {
      const gapText = turnsLeft.metric === 'volume'
        ? `还差 ${formatBytes(turnsLeft.remainingBytes)}`
        : `还差 ${formatPercent((turnsLeft.remainingTokens ?? 0) / Math.max(1, health.context.windowTokens ?? 1))}`
      return { icon, level, pace, text: `${icon} 快到线了（${gapText}）${fastSuffix}` }
    }
    return { icon, level, pace, text: `${icon} 快到线了${fastSuffix}` }
  }
  return { icon, level, pace, text: `${icon} 健康` }
}

/**
 * 百分比格式化（0.68 → "68%"）。无效输入给「—」。
 * @param {number|undefined} ratio - 比例。
 * @param {number} [digits] - 小数位（默认 0）。
 * @returns {string} 文案。
 */
export function formatPercent(ratio, digits = 0) {
  if (!Number.isFinite(ratio)) return '—'
  const value = ratio * 100
  return `${value.toFixed(digits)}%`
}

/**
 * 字节格式化（12.3 MB / 812 KB / 900 B）。**图片与附件已并入此数，不单独出现。**
 * @param {number|undefined} bytes - 字节数。
 * @returns {string} 文案。
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  const abs = Math.abs(bytes)
  if (abs < 1024) return `${Math.round(bytes)} B`
  if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(abs < 10 * 1024 ? 1 : 0)} KB`
  // MB 固定 1 位小数（设计文档示例写的是「会话 12 MB」，1 位不会更啰嗦；≥100MB 才收成整数）。
  if (abs < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(abs < 100 * 1024 * 1024 ? 1 : 0)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 千分位整数。 */
export function formatCount(value) {
  if (!Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

/**
 * S2-明细表：**只给「当前 / 阈值 / 距离」**，不做占用构成分解。
 *
 * | 指标 | 当前 | 阈值 | 距离 |
 * | 上下文 | 68% | 80% | 还差 12% |
 * | 会话体积 | 12 MB | 20 MB | 还差 8 MB |
 * | 已压缩次数 | 1 次 | 修正线 2 次 | —— |
 * | 消息 / 事件条数 | 1,240 / 3,400 | —— | 仅供参考，不参与判定 |
 *
 * @param {object} input - 输入。
 * @param {object} input.health - `computeHealth` 结果。
 * @param {number} [input.compactionsSinceHandoff] - 自上次换会话以来的压缩次数。
 * @param {number|null} [input.compactionCountTrigger] - 压缩次数修正线（留空 = 不启用）。
 * @param {number} [input.messageCount] - 用户+助手消息条数。
 * @param {number} [input.eventCount] - 事件条数。
 * @returns {{rows: Array<{label: string, current: string, limit: string, distance: string}>}} 明细。
 */
export function detailRows({ health, compactionsSinceHandoff, compactionCountTrigger, messageCount, eventCount }) {
  const context = health?.context ?? {}
  const volume = health?.volume ?? {}
  const rows = []

  rows.push({
    label: '上下文',
    current: context.windowTokens === undefined
      ? (Number.isFinite(context.usedTokens) ? `${formatCount(context.usedTokens)} token` : '—')
      : `${formatPercent(context.ratio)}（${formatCount(context.usedTokens)} / ${formatCount(context.windowTokens)}）`,
    limit: context.limitTokens === undefined
      ? '跟随原生压缩'
      : `${formatPercent(context.limitRatio)}（${formatCount(context.limitTokens)}）`,
    distance: context.limitTokens === undefined || context.usedTokens === undefined
      ? '—'
      : (context.limitTokens <= context.usedTokens
        ? '已到线'
        : `还差 ${formatCount(context.limitTokens - context.usedTokens)} token`),
  })

  rows.push({
    label: '会话体积',
    current: formatBytes(volume.bytes),
    limit: formatBytes(volume.limitBytes),
    distance: volume.bytes === undefined || volume.limitBytes === undefined
      ? '—'
      : (volume.limitBytes <= volume.bytes ? '已到线' : `还差 ${formatBytes(volume.limitBytes - volume.bytes)}`),
  })

  rows.push({
    label: '已压缩次数',
    current: Number.isFinite(compactionsSinceHandoff) ? `${compactionsSinceHandoff} 次` : '—',
    limit: compactionCountTrigger === null || compactionCountTrigger === undefined
      ? '未启用'
      : `修正线 ${compactionCountTrigger} 次`,
    distance: '——',
  })

  rows.push({
    label: '消息 / 事件条数',
    current: `${formatCount(messageCount)} / ${formatCount(eventCount)}`,
    limit: '——',
    distance: '仅供参考，不参与判定',
  })

  return { rows }
}

/** 取值为 null 或数字的阈值（wire 上 nullable 数字必须走这个，避免 undefined 键）。 */
export function normalizeTrigger(value) {
  if (value === null || value === undefined || value === '') return null
  if (!Number.isFinite(value)) return null
  if (value <= 0) return null
  return Math.floor(value)
}

// ─────────────────────────── 换会话确认卡片（S3）状态机 ───────────────────────────

/** 卡片选项标签（**必须与宿主选项一一对应**；「（推荐）」后缀会被宿主渲染成推荐徽章）。 */
export const CARD_LABELS = Object.freeze({
  handoff: '换会话（推荐）',
  always: '以后都自动换会话',
  later: '先不换',
})

/** 选项的 id 前缀（宿主按选项 label 回传，我们只用 label 比对）。 */
export const CARD_QUESTION_ID = 'session-handoff-confirm'

/**
 * 把用户的回答（或取消/超时）折成一个动作。
 *
 * 设计文档 §二 交互流程：
 * ```
 * 选「接力」/「以后都自动接力」 → 执行换会话（后者同时把自动程度调成"全自动"）
 * 选「先不接力」/ 关掉 / 超时   → 等同取消
 * ```
 *
 * @param {object} input - 输入。
 * @param {'handoff'|'always'|'later'|'cancelled'|'timeout'|'error'} input.kind - 事件类型。
 * @param {string} [input.label] - 用户选中的标签。
 * @param {string} [input.custom] - 用户自由输入的内容。
 * @param {string} [input.error] - 错误文本（kind='error' 时）。
 * @returns {{action: 'handoff'|'always-auto'|'cancel', reason: string}} 归一化动作。
 */
export function reduceCardAnswer({ kind, label, custom, error }) {
  if (kind === 'cancelled' || kind === 'timeout') return { action: 'cancel', reason: kind }
  if (kind === 'error') return { action: 'cancel', reason: error ?? 'error' }
  if (kind === 'later') return { action: 'cancel', reason: 'later' }
  if (kind === 'always') return { action: 'always-auto', reason: 'always' }
  if (kind === 'handoff') return { action: 'handoff', reason: 'approved' }
  // 自由输入兜底：认"换/接力/yes"这类肯定词，其余按不换处理（容错，不误切）。
  const text = typeof custom === 'string' ? custom.trim() : ''
  if (text.length > 0) {
    // ⚠️ 不用 `\b` 收尾：中文字符在 JS 正则里属于非词字符，"换吧\b" 永远匹配不上。
    if (/^(换|接力|好|是|行|可以|yes|ok|y\b)/i.test(text)) return { action: 'handoff', reason: 'custom-approved' }
    return { action: 'cancel', reason: 'custom-declined' }
  }
  if (typeof label === 'string' && label.length > 0) {
    if (label === CARD_LABELS.handoff) return { action: 'handoff', reason: 'approved' }
    if (label === CARD_LABELS.always) return { action: 'always-auto', reason: 'always' }
    return { action: 'cancel', reason: 'later' }
  }
  return { action: 'cancel', reason: 'unanswered' }
}

/**
 * 组装宿主 `ctx.userQuestions.ask()` 的请求体（**照抄 plan-mode 的形状**）。
 *
 * ⚠️ 两个硬约束（照 `dsh-user-questions/lib/index.js:52-80`）：
 * 1. `questions` 不能为空；
 * 2. 带 `intent` 时 `approve` 标签必须真的出现在 options 里，且必须给 `detail`。
 *    （本插件**不传 intent**：「换会话」不是审批语义，传了反而要被审批弹窗的轮次约束咬住。）
 *
 * @param {object} input - 输入。
 * @param {string} input.reason - 触发原因（人话）。
 * @param {string} input.facts - 事实行（用量 / 档位 / 本链第几棒）。
 * @param {string} [input.detail] - 交接文档预览（可展开区块）。
 * @returns {{id: string, header: string, question: string, detail: string, options: Array<object>}} 问题对象。
 */
export function buildConfirmQuestion({ reason, facts, detail }) {
  return {
    id: CARD_QUESTION_ID,
    header: '会话接力',
    question: `要接力到新会话吗？（${reason}）`,
    detail: [facts, typeof detail === 'string' && detail.trim().length > 0 ? detail : undefined]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .join('\n\n'),
    options: [
      { label: CARD_LABELS.handoff, description: '现在把任务交给新会话继续。', recommended: true },
      { label: CARD_LABELS.always, description: '这次接力，并且以后到点不再问我。' },
      { label: CARD_LABELS.later, description: '继续在这个会话里干，下次跨过阈值再问。' },
    ],
  }
}

/** 事实行（S3 卡片头下方那一行）。 */
export function formatFacts({ health, chainIndex, thresholdLabel }) {
  const parts = []
  const context = health?.context ?? {}
  const volume = health?.volume ?? {}
  if (Number.isFinite(context.ratio)) {
    parts.push(`当前用量 ${formatPercent(context.ratio)}（${formatCount(context.usedTokens)} / ${formatCount(context.windowTokens)}）`)
  }
  if (Number.isFinite(volume.bytes)) parts.push(`会话体积 ${formatBytes(volume.bytes)}`)
  if (Number.isFinite(chainIndex)) parts.push(`本链第 ${chainIndex} 棒`)
  if (typeof thresholdLabel === 'string' && thresholdLabel.length > 0) parts.push(`触发原因：${thresholdLabel}`)
  return parts.join(' · ')
}

// ─────────────────────────── 决策日志（S7）状态机 ───────────────────────────

/** 决策动作的书面名（S7 徽章文案）。 */
export const DECISION_ACTIONS = Object.freeze({
  handoff: '硬切接力',
  'handoff-manual': '手工换会话',
  cancel: '取消（用户没换）',
  defer: '挂起（等安全点）',
  none: '不干预',
})

/**
 * 把一次判定折成一条决策日志记录（时间 / 动作 / 一句话理由）。
 *
 * @param {object} input - 输入。
 * @param {number} input.at - 时间戳（毫秒）。
 * @param {string} input.action - 动作键（见 `DECISION_ACTIONS`）。
 * @param {string} [input.reason] - 判定理由键（如 `session-volume`）。
 * @param {object} [input.health] - 当时的健康度。
 * @param {number} [input.chainIndex] - 本链第几棒。
 * @param {object} [input.detail] - 判定明细（判定链的原始数字）。
 * @returns {{at: number, time: string, action: string, label: string, reason: string, human: string, contextPercent: string, volume: string, chainIndex: number, detail: object}} 记录。
 */
export function reduceDecision({ at, action, reason, health, chainIndex, detail }) {
  const label = DECISION_ACTIONS[action] ?? action ?? '不干预'
  const human = humanReason({ action, reason, detail })
  return {
    at,
    time: formatClock(at),
    action: action ?? 'none',
    label,
    reason: reason ?? 'unknown',
    human,
    contextPercent: Number.isFinite(health?.context?.ratio) ? formatPercent(health.context.ratio) : '—',
    volume: formatBytes(health?.volume?.bytes),
    chainIndex: Number.isFinite(chainIndex) ? chainIndex : 1,
    detail: detail ?? {},
  }
}

/**
 * 判定理由的大白话（S7「判定理由」那一列）。
 * @param {{action?: string, reason?: string, detail?: object}} input - 输入。
 * @returns {string} 一句话。
 */
export function humanReason({ action, reason, detail }) {
  const sizeMB = Number.isFinite(detail?.sessionBytes) ? formatBytes(detail.sessionBytes) : undefined
  switch (reason) {
    case 'session-volume':
      return `会话体积到线了（${sizeMB ?? '—'}）→ 换会话`
    case 'compaction-count':
      return `已经压缩了 ${detail?.compactionsSinceHandoff ?? '?'} 次（修正线 ${detail?.compactionCountTrigger ?? '?'} 次）→ 换会话`
    case 'replace-threshold':
      return '上下文到了原生压缩生效线的 98% → 抢在它前面换会话'
    case 'manual':
      return '你点了「换会话」→ 优先级最高，直接换'
    case 'none':
    case 'below-load-thresholds':
      return '两个指标都没到线 → 不干预'
    case 'below-replace-threshold':
      return '还没到原生压缩生效线的 98% → 不干预'
    case 'native-mode':
      return '当前是原生模式 → 插件不自动换会话'
    case 'metric-unavailable':
      return '暂时量不到上下文用量 → 这一步不判定'
    case 'unsafe-point':
      return '现在有工具在跑（不是安全点）→ 挂起，等这一步结束再换'
    default:
      return action === 'handoff' ? '到线了 → 换会话' : '没有满足换会话的条件 → 不干预'
  }
}

/**
 * 时钟格式化（HH:MM:SS，本地时区）。
 * @param {number} at - 毫秒时间戳。
 * @returns {string} 文案。
 */
export function formatClock(at) {
  if (!Number.isFinite(at)) return '—'
  const date = new Date(at)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 决策日志动作筛选（S7 顶部一行筛选）。 */
export const DECISION_FILTERS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'handoff', label: '只看换过会话的' },
  { id: 'none', label: '只看没换的' },
])

/**
 * 按筛选条件过滤决策日志。
 * @param {Array<object>} records - 记录。
 * @param {string} filter - 筛选 id。
 * @returns {Array<object>} 过滤后的记录。
 */
export function filterDecisions(records, filter) {
  const list = Array.isArray(records) ? records : []
  if (filter === 'handoff') return list.filter((row) => row.action === 'handoff' || row.action === 'handoff-manual')
  if (filter === 'none') return list.filter((row) => row.action !== 'handoff' && row.action !== 'handoff-manual')
  return list
}
