// 健康度 DTO 组装（host 面）：把"能读到什么"与"客户端该显示什么"分开。
//
// 为什么把 DTO 组装留在 host：tokenMeter / sessionProjections 只有 host 拿得到；
// 而三色、N 轮、文案这些**纯计算**放在 `lib/handoff-health.mjs`，两侧共用同一份，
// 客户端拿到 DTO 再本地算结论——这样颜色与文案永远不会两侧漂移。
//
// 本模块**不 import 任何 @deepseek-ai/* 包**（ctx 与依赖全注入），可纯 Node 单测。

import {
  computeHealth,
  computeRates,
  createRateTracker,
  detailRows,
  estimateTurnsLeft,
} from './handoff-health.mjs'
import { isSubagentSession, resolveNativeThresholdTokens } from './handoff-policy.mjs'
import { isSafePoint } from './handoff-safety.mjs'
import { sessionEvents } from './session-events.mjs'

/** 传给客户端的 DTO 形状版本（改字段就 +1）。 */
export const HEALTH_DTO_VERSION = 2 // R6：新增 `subagent` 字段

/**
 * 数字或 null（wire 安全：**显式 null 比缺键好判断**）。
 * @param {unknown} value - 原值。
 * @returns {number|null} 结果。
 */
function num(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * 判定明细只留 JSON 安全的标量。
 * @param {object|undefined} detail - 判定明细。
 * @returns {object} 净化后的明细。
 */
export function sanitizeDetail(detail) {
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return {}
  const out = {}
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value
    else if (Number.isFinite(value)) out[key] = value
    else if (value === null) out[key] = null
  }
  return out
}

/**
 * 组装一个会话的健康度行 DTO。
 *
 * @param {object} input - 输入。
 * @param {object} input.session - 会话。
 * @param {object} input.measured - `measureContext` 的产物。
 * @param {number} [input.sessionBytes] - 会话体积（字节）。
 * @param {number} [input.compactionsSinceHandoff] - 自上次换会话以来的压缩次数。
 * @param {number} [input.turnIndex] - 当前轮序号。
 * @param {number} [input.messageCount] - 消息条数（仅参考）。
 * @param {number} [input.eventCount] - 事件条数（仅参考）。
 * @param {object} input.config - 已校验配置。
 * @param {number} [input.nativeThresholdTokens] - 读到的原生阈值 token（读不到留空）。
 * @param {object} [input.decision] - 判定结果（`decideAutoHandoff` 的产物）。
 * @param {number} [input.chainIndex] - 本链第几棒。
 * @param {boolean} [input.handedOff] - 该会话是否已经换过会话。
 * @param {boolean} [input.safePoint] - 是否处于安全点。
 * @param {{perTurnTokens?: number, perTurnBytes?: number, turns: number, reason: string}} [input.rates] - 涨速。
 * @param {boolean} [input.subagent] - 该会话是否是子代理会话（R6：客户端据此置灰「换会话」）。
 * @returns {object} DTO（全部字段 JSON 安全）。
 */
export function buildHealthDto(input) {
  const { session, measured, config } = input
  const nativeThresholdTokens = Number.isFinite(input.nativeThresholdTokens) && input.nativeThresholdTokens > 0
    ? input.nativeThresholdTokens
    : resolveNativeThresholdTokens({
      windowTokens: measured?.windowTokens,
      nativeThresholdTokens: undefined,
      nativeCompactionRatio: config.nativeCompactionRatio,
    })

  const health = computeHealth({
    mode: config.autoMode,
    usedTokens: measured?.usedTokens,
    windowTokens: measured?.windowTokens,
    nativeThresholdTokens,
    replaceSafetyFactor: config.replaceSafetyFactor,
    sessionBytes: input.sessionBytes,
    sessionVolumeLimitBytes: config.sessionVolumeBytes,
  })

  const turnsLeft = estimateTurnsLeft({
    health,
    perTurnTokens: input.rates?.perTurnTokens,
    perTurnBytes: input.rates?.perTurnBytes,
  })

  const detail = detailRows({
    health,
    compactionsSinceHandoff: input.compactionsSinceHandoff,
    compactionCountTrigger: config.compactionCountTrigger,
    messageCount: input.messageCount,
    eventCount: input.eventCount,
  })

  return {
    v: HEALTH_DTO_VERSION,
    sessionId: session.id,
    title: typeof session.header?.title === 'string' ? session.header.title : null,
    mode: config.autoMode,
    autoPromptLevel: config.autoPromptLevel,
    safePoint: input.safePoint === true,
    handedOff: input.handedOff === true,
    chainIndex: num(input.chainIndex) ?? 1,
    // —— 上下文 ——
    usedTokens: num(measured?.usedTokens),
    windowTokens: num(measured?.windowTokens),
    windowSource: typeof measured?.windowSource === 'string' ? measured.windowSource : null,
    contextRatio: num(measured?.ratio),
    nativeThresholdTokens: num(nativeThresholdTokens),
    contextLimitTokens: num(health.context.limitTokens),
    contextLimitRatio: num(health.context.limitRatio),
    contextMarker: health.context.showMarker === true,
    contextCounts: health.contextCounts === true,
    // —— 会话体积（图片/附件已并入此数，任何地方都不单独出现）——
    sessionBytes: num(input.sessionBytes),
    sessionVolumeLimitBytes: num(health.volume.limitBytes),
    // —— 其它口径 ——
    compactionsSinceHandoff: num(input.compactionsSinceHandoff) ?? 0,
    compactionCountTrigger: config.compactionCountTrigger ?? null,
    turnIndex: num(input.turnIndex) ?? 0,
    messageCount: num(input.messageCount) ?? 0,
    eventCount: num(input.eventCount) ?? 0,
    // —— 涨速 ——
    perTurnTokens: num(input.rates?.perTurnTokens),
    perTurnBytes: num(input.rates?.perTurnBytes),
    rateTurns: num(input.rates?.turns) ?? 0,
    rateReason: typeof input.rates?.reason === 'string' ? input.rates.reason : 'no-tracker',
    // —— 结论（host 也算一份，便于排障；客户端用同一份纯函数算出用户看到的文案）——
    level: health.level,
    turnsLeft: num(turnsLeft.n),
    turnsLeftReason: turnsLeft.reason,
    // —— 明细表（S2-明细）——
    detail: detail.rows,
    // —— R6（2026-10-20 止血）：子代理会话标记（客户端据此置灰手动「换会话」）——
    // 判据由调用方用内核字段 + 投影算好传进来，这里只透传，不猜标题。
    subagent: input.subagent === true,
    // —— 判定（S7 决策日志用）——
    decisionAction: input.decision?.action ?? 'none',
    decisionReason: input.decision?.reason ?? 'unknown',
    decisionDetail: sanitizeDetail(input.decision?.detail),
  }
}

/**
 * 健康度报表器：采样 → 算涨速 → 出 DTO 列表。
 *
 * @param {object} input - 输入。
 * @param {(name: string) => object|undefined} input.get - `ctx.get` 的安全包装。
 * @param {() => object} input.configOf - 读当前生效配置（设置页改完立刻生效）。
 * @param {() => object|undefined} input.ledgerOf - 读台账。
 * @param {(session: object) => Promise<object>} input.measure - 量上下文。
 * @param {(session: object) => Promise<object>|object} [input.decide] - 自动判定（可注入）。
 * @param {(session: object) => number} [input.chainIndexOf] - 读链序号。
 * @param {(session: object) => boolean} [input.handedOffOf] - 读"是否已换过会话"。
 * @param {object} [input.tracker] - 涨速台账（默认新建）。
 * @param {number} [input.maxSessions] - 单次返回的会话数上限。
 * @returns {object} 报表 API。
 */
export function createHealthReporter({
  get,
  configOf,
  ledgerOf,
  measure,
  decide,
  chainIndexOf,
  handedOffOf,
  failuresOf,
  tracker = createRateTracker(),
  maxSessions = 20,
}) {
  /** 最近若干条测量错误（排障用，不对外暴露堆栈）。 */
  const errors = []

  /**
   * 记一条测量错误（与既有 `{ sessionId, message }` 形状一致）。
   * @param {string} sessionId - 会话 id。
   * @param {unknown} message - 原因（字符串或 Error）。
   * @returns {void}
   */
  function pushError(sessionId, message) {
    if (errors.length > 50) errors.shift()
    errors.push({ sessionId: typeof sessionId === 'string' ? sessionId : '', message: String(message) })
  }

  /**
   * 把"插件自己记下的失败"并进 errors（复核 P2-7 / P2-11 的可见性）。
   *
   * 为什么走这条通道：桌面版宿主日志在磁盘上拿不到，用户界面上唯一能显示错误的地方
   * 就是健康度行读到的 `stats().errors`。**同一会话同一条文案只留一条**，否则每次轮询都会堆一遍。
   *
   * @param {string} sessionId - 会话 id。
   * @returns {void}
   */
  function pushPluginFailure(sessionId) {
    if (typeof failuresOf !== 'function') return
    const failure = failuresOf(sessionId)
    if (failure === undefined || failure === null) return
    const message = String(failure.message ?? failure)
    if (message.length === 0) return
    if (errors.some((entry) => entry.sessionId === sessionId && entry.message === message)) return
    pushError(sessionId, message)
  }

  /**
   * 组装单个会话的 DTO（并顺手记一条涨速样本）。
   * @param {object} session - 会话。
   * @param {boolean} [record] - 是否记样本。
   * @returns {Promise<object>} DTO。
   */
  async function dtoFor(session, record = true) {
    const config = configOf()
    const ledger = ledgerOf?.()
    let measured
    try {
      measured = await measure(session)
    } catch (error) {
      pushError(session?.id, error?.message ?? error)
      measured = { ratio: undefined }
    }
    // 「量不到」的失败原因（measureContext 的 error 字段）也要进排障数据（P1-6）：
    // 以前空 catch 吞掉失败，报表 errors 里完全看不到为什么量不到。
    if (typeof measured?.error === 'string' && measured.error.length > 0) {
      pushError(session?.id, measured.error)
    }
    const sessionBytes = ledger?.bytesOf?.(session)
    const turnIndex = ledger?.turnIndexOf?.(session)
    const rates = computeRates({
      tracker,
      sessionId: session.id,
      turnIndex,
      usedTokens: measured?.usedTokens,
      sessionBytes,
    })
    let decision
    if (typeof decide === 'function') {
      try {
        decision = await decide(session)
      } catch {
        decision = undefined
      }
    }
    let safePoint
    try {
      safePoint = isSafePoint(sessionEvents(session))
    } catch {
      safePoint = false
    }
    // R6（2026-10-20 止血）：子代理会话判据 —— 内核强制字段 origin + 自描述投影，
    // **绝不用标题**（标题会被模型改写）。取不到投影服务时退化为只看 header。
    let subagentProjection = null
    try {
      subagentProjection = get('sessionProjections')?.stateOf?.(session, 'subagent') ?? null
    } catch {
      subagentProjection = null
    }
    const subagent = isSubagentSession({ header: session?.header, projection: subagentProjection })
    const dto = buildHealthDto({
      session,
      measured,
      config,
      sessionBytes,
      compactionsSinceHandoff: ledger?.compactionsOf?.(session),
      turnIndex,
      messageCount: ledger?.messageCountOf?.(session),
      eventCount: ledger?.eventCountOf?.(session),
      // 内核当前没有把原生阈值挂成服务（上一块已核对：compaction-basic 不 provide），
      // 所以这里恒为 undefined，由 policy 退化为 0.8 × 生效窗口（§十六 16.1）。
      nativeThresholdTokens: undefined,
      decision,
      chainIndex: typeof chainIndexOf === 'function' ? chainIndexOf(session) : 1,
      handedOff: typeof handedOffOf === 'function' ? handedOffOf(session) : false,
      safePoint,
      rates,
      subagent,
    })
    if (record) {
      tracker.observe(session.id, { turnIndex, usedTokens: measured?.usedTokens, sessionBytes })
    }
    return dto
  }

  return {
    /** 涨速台账（controller 的 `session/disposed` 里要 forget）。 */
    tracker,
    /**
     * 列出一批会话的健康度行。
     * @param {string[]} [sessionIds] - 会话 id 列表；留空 = 当前 live 会话。
     * @returns {Promise<{rows: object[], errors: object[]}>} 结果。
     */
    async rowsFor(sessionIds) {
      const sessions = get('sessions')
      const ids = Array.isArray(sessionIds) && sessionIds.length > 0 ? sessionIds : listLiveSessionIds(sessions)
      const rows = []
      for (const id of ids.slice(0, maxSessions)) {
        // 先并"插件自己记的失败"：**即使会话已经不在宿主内存里**，也要能看到上次为啥失败（复核 P2-7）。
        pushPluginFailure(id)
        const session = sessions?.get?.(id)
        if (session === undefined || session === null) continue
        rows.push(await dtoFor(session))
      }
      return { rows, errors: [...errors] }
    },
    /**
     * 单会话。
     * @param {string} sessionId - 会话 id。
     * @returns {Promise<object|undefined>} DTO；会话不存在时 undefined。
     */
    async rowFor(sessionId) {
      const session = get('sessions')?.get?.(sessionId)
      if (session === undefined || session === null) return undefined
      return dtoFor(session)
    },
    /**
     * 手动记一条样本（agent/pre-step 里调，让涨速在**同一步内**也有采样点）。
     * @param {object} session - 会话。
     * @returns {void}
     */
    observe(session) {
      const ledger = ledgerOf?.()
      tracker.observe(session.id, {
        turnIndex: ledger?.turnIndexOf?.(session),
        usedTokens: undefined,
        sessionBytes: ledger?.bytesOf?.(session),
      })
    },
    /** 丢弃某会话的样本。 */
    forget(sessionId) {
      tracker.forget(sessionId)
    },
    /** 最近的测量错误（排障）。 */
    get errors() {
      return [...errors]
    },
  }
}

/**
 * 列出当前 live 会话 id（拿不到就空数组，**不猜**）。
 *
 * ⚠️ 这里刻意只认 `list()` / `all()` 这两种明确实现；内核的 `sessions` 服务若都不提供，
 * 就返回空数组——客户端本来就总是显式送 `sessionIds`（它知道自己在哪个会话里），
 * 所以这条路径只是"没送 id 时的兜底"，宁可为空也不猜错。
 *
 * @param {object|undefined} sessions - sessions 服务。
 * @returns {string[]} 会话 id。
 */
export function listLiveSessionIds(sessions) {
  if (sessions === undefined || sessions === null) return []
  const candidates = []
  try {
    if (typeof sessions.list === 'function') candidates.push(...(sessions.list() ?? []))
    else if (typeof sessions.all === 'function') candidates.push(...(sessions.all() ?? []))
  } catch {
    return []
  }
  return candidates
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter((id) => typeof id === 'string' && id.length > 0)
}
