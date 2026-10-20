// 两个可测指标 + 压缩次数台账（零 @deepseek 依赖，可纯 Node 单测）。
//
// 指标一 · 上下文占比 = ctx.tokenMeter.measure(session).totalTokens ÷ 生效窗口
//   窗口优先 ctx.sessionProjections.stateOf(session,'contextPressure').contextWindow，
//   兜底 ctx.llm.resolveModelInfo(provider, model).context.contextWindow。
//   （证据：dsh-token-meter/lib/index.js:641 measure 的返回字段；
//          dsh-token-meter/lib/index.js:395 contextPressureStateSchema.contextWindow；
//          dsh-compaction-basic/lib/index.js:936 用 info.context.contextWindow）
//
// 指标二 · 会话体积（字节）——session.seq 拿不到字节，必须自己算：
//   首次对该会话全量累加**会话事件**的序列化字节（走 session-events.mjs 的
//   `sessionEvents()`：真实宿主是 `snapshotEvents()`，**没有 `.events` 属性**），
//   之后靠 session/event 增量累加。
//   （关键事实：dsh-session/lib/index.js:1426 先 `this.log.push(event)` 再派发
//     `session/event`，所以增量累加不会漏；而"首次全量"必须按整条日志算，
//     否则会把触发监听之前的老事件漏掉。）

import { sessionEvents } from './session-events.mjs'

/** 压缩成功事件：compaction/end 且不带 error（失败收尾会带 data.error）。 */
export const COMPACTION_END = 'compaction/end'

/** 轮次开始事件（用来给涨速样本一个"轮"的分母）。 */
export const TURN_START = 'turn/start'

/**
 * UTF-8 字节数（宿主是 Node；测试同样是 Node，但仍留浏览器兜底）。
 * @param {string} text - 文本。
 * @returns {number} 字节数。
 */
export function utf8Bytes(text) {
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(text, 'utf8')
  }
  return new TextEncoder().encode(text).length
}

/**
 * 一条会话事件的序列化字节数（含 type/seq/time/data，与落盘 JSONL 的量级同阶）。
 * 不可序列化时返回 0——体积是**参考指标**，不能因为一条怪事件把判定打崩。
 * @param {object} event - 会话事件。
 * @returns {number} 字节数。
 */
export function eventBytes(event) {
  if (event === null || typeof event !== 'object') return 0
  try {
    const json = JSON.stringify(event, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
    return json === undefined ? 0 : utf8Bytes(json)
  } catch {
    return 0
  }
}

/**
 * 判断一条事件是否代表"一次成功的上下文压缩"。
 * @param {object} event - 会话事件。
 * @returns {boolean} 是否成功压缩收尾。
 */
export function isSuccessfulCompaction(event) {
  return event?.type === COMPACTION_END && event?.data?.error === undefined
}

/**
 * 数会话日志里出现过多少次 `turn/start`（= 当前是第几轮，1 基）。
 *
 * 用途：给涨速样本一个**与真实轮次挂钩的分母**（M2 §一 S2「N 由涨速外推」）。
 * `turn/start` 由 agent loop 在每轮开头写入（与 `turn/end` 成对），
 * 因此"当前轮序号 = turn/start 条数"。
 *
 * @param {Array<object>} [events] - 会话事件。
 * @returns {number} 当前轮序号（无 turn/start 时 0）。
 */
export function turnIndexOf(events) {
  if (!Array.isArray(events)) return 0
  let count = 0
  for (const event of events) {
    if (event?.type === TURN_START) count += 1
  }
  return count
}

/**
 * 取出会话的事件数组（**读不到返回 `undefined`，绝不伪装成空数组**）。
 * ⚠️ 与 `session-events.mjs` 的约定一致：读不到必须由调用方显式裁决。
 *    本模块的裁决是**保守返回 `undefined`**（见 `createSessionLedger` 的注释），
 *    **绝不**把 undefined 当 0——0 会让"体积触发线"形同虚设（P1-12）。
 * @param {{snapshotEvents?: Function, events?: unknown}} session - 会话。
 * @returns {readonly object[]|undefined} 事件数组；读不到 undefined。
 */
function eventsOf(session) {
  return sessionEvents(session)
}

/**
 * 会话台账：每个会话一份 { bytes, compactions }。
 *
 * 归零口径（§16.3 C3 / §17.2 C3）：压缩次数 = **自上次换会话以来**的压缩次数，
 * 换会话即归零——新会话第一次进场时 reset()，否则跨会话累计会立刻再次触发、形成抖动。
 *
 * ⚠️ 读不到事件时的语义（P1-12 修复，**保守，不许改**）：
 *   会话事件读不到（`sessionEvents()` 返回 undefined）时，**不写缓存、不当成 0**，
 *   所有读接口返回 `undefined` = 「这次量不到」。下一次调用会重新尝试 prime，
 *   所以事件恢复可读后数值会自动补上，不会被一条假的 0 基线**永久驻留**。
 *   判定侧必须用 `Number.isFinite(...)` 判空（`lib/handoff-policy.mjs` 就是这么写的）——
 *   undefined 的表达是"未知"，**绝不允许当 0 使用**（当 0 会让体积触发线形同虚设）。
 *
 * @param {{measureEvent?: (event: object) => number}} [options] - 可注入的字节测量函数（测试用）。
 * @returns {object} 台账 API。
 */
export function createSessionLedger({ measureEvent = eventBytes } = {}) {
  /** @type {Map<string, {bytes: number, compactions: number, turnIndex: number, messageCount: number, eventCount: number}>} */
  const entries = new Map()

  const keyOf = (session) => session?.id ?? ''

  /** 一条事件属于"消息"吗（明细表里的"消息 / 事件条数"只作参考）。 */
  function isMessageEvent(event) {
    return event?.type === 'user/message' || event?.type === 'assistant/message'
  }

  /**
   * 全量累加该会话的整条日志并登记。
   * @param {object} session - 会话。
   * @returns {object|undefined} 登记后的台账条目；事件读不到时**不登记**并返回 undefined。
   */
  function prime(session) {
    const events = eventsOf(session)
    // 读不到就什么都不写：不登记 = 下次还会重新尝试（不留下假的 0 基线）。
    if (!Array.isArray(events)) return undefined
    let bytes = 0
    let compactions = 0
    let turnIndex = 0
    let messageCount = 0
    let eventCount = 0
    for (const event of events) {
      bytes += measureEvent(event)
      if (isSuccessfulCompaction(event)) compactions += 1
      if (event?.type === TURN_START) turnIndex += 1
      if (isMessageEvent(event)) messageCount += 1
      eventCount += 1
    }
    const entry = { bytes, compactions, turnIndex, messageCount, eventCount }
    entries.set(keyOf(session), entry)
    return entry
  }

  /**
   * 读台账条目；未登记时尝试 prime。
   * @param {object} session - 会话。
   * @returns {object|undefined} 条目；事件读不到时 undefined。
   */
  function entryFor(session) {
    const key = keyOf(session)
    return entries.get(key) ?? prime(session)
  }

  return {
    /**
     * 首次对该会话全量累加（幂等：已存在则原样返回）。
     * @param {object} session - 会话。
     * @returns {object|undefined} 条目；事件读不到时 undefined（未登记）。
     */
    prime,
    /** 会话体积（字节）；未登记时自动全量累加。事件读不到 → undefined（量不到，**不是 0**）。 */
    bytesOf(session) {
      return entryFor(session)?.bytes
    },
    /** 自上次换会话以来的压缩次数；未登记时自动全量累加。事件读不到 → undefined。 */
    compactionsOf(session) {
      return entryFor(session)?.compactions
    },
    /** 当前轮序号（= 日志里 `turn/start` 的条数）；未登记时自动全量累加。事件读不到 → undefined。 */
    turnIndexOf(session) {
      return entryFor(session)?.turnIndex
    },
    /** 消息条数；事件读不到 → undefined。 */
    messageCountOf(session) {
      return entryFor(session)?.messageCount
    },
    /** 事件总条数；事件读不到 → undefined。 */
    eventCountOf(session) {
      return entryFor(session)?.eventCount
    },
    /**
     * 增量累加一条事件（挂 ctx.on('session/event', …) 用）。
     * 未登记时走 prime（整条日志已含该事件，避免重复计数）；
     * 若 prime 读不到事件，则**不写任何基线**，留给下一次调用重试（P1-12）。
     * @param {object} session - 会话。
     * @param {object} event - 刚追加的事件。
     * @returns {void}
     */
    observe(session, event) {
      const key = keyOf(session)
      const existing = entries.get(key)
      if (existing === undefined) {
        prime(session)
        return
      }
      existing.bytes += measureEvent(event)
      if (isSuccessfulCompaction(event)) existing.compactions += 1
      if (event?.type === TURN_START) existing.turnIndex += 1
      if (isMessageEvent(event)) existing.messageCount += 1
      existing.eventCount += 1
    },
    /** 换会话后归零（在新会话上调用，之后的注入消息会正常累加）。 */
    reset(session) {
      entries.set(keyOf(session), { bytes: 0, compactions: 0, turnIndex: 0, messageCount: 0, eventCount: 0 })
    },
    /** 会话销毁时丢弃（挂 ctx.on('session/disposed', …)）。 */
    forget(session) {
      entries.delete(keyOf(session))
    },
    /** 已登记会话数（测试与排障用）。 */
    get size() {
      return entries.size
    },
    /** 读原始台账条目（测试用；未登记返回 undefined）。 */
    peek(session) {
      return entries.get(keyOf(session))
    },
  }
}

/**
 * 上下文占比（纯计算）。窗口未知/非正时返回 undefined（不猜、不除零）。
 * @param {{usedTokens?: number, windowTokens?: number}} input - 输入。
 * @returns {number|undefined} 占比 ∈ [0, ∞)；不可测时 undefined。
 */
export function contextRatio({ usedTokens, windowTokens }) {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(windowTokens) || windowTokens <= 0) return undefined
  return usedTokens / windowTokens
}

/**
 * 量当前上下文占用与生效窗口（依赖注入，便于打桩单测）。
 *
 * 分母优先级：contextPressure.contextWindow → llm.resolveModelInfo().context.contextWindow。
 * 两者都没有 → windowTokens undefined，上层据此静默跳过本次判定。
 *
 * @param {object} deps - 依赖。
 * @param {{measure?: (session: object) => {totalTokens?: number}|undefined}} [deps.tokenMeter] - 会话 tokenMeter 服务。
 * @param {{stateOf?: (session: object, key: string) => object|undefined}} [deps.sessionProjections] - 投影服务。
 * @param {{resolveModelInfo?: (provider: string, model: string) => Promise<object>|object}} [deps.llm] - 模型服务。
 * @param {object} deps.session - 目标会话。
 * @param {{provider?: string, model?: string}|undefined} [deps.route] - 当前路由（兜底查询用）。
 * @returns {Promise<{usedTokens?: number, windowTokens?: number, ratio?: number, windowSource?: string, error?: string}>} 测量结果；
 *   任一服务抛错时额外带 `error`（失败原因键，排障用；成功时不带这个键）。
 */
export async function measureContext({ tokenMeter, sessionProjections, llm, session, route }) {
  // 失败原因台账（P1-6）：以前三个空 catch 把失败整个吞掉，报表 errors 里
  // 完全看不到"量不到"是因为服务挂了还是压根没有。这里记下原因，随结果一起交出去。
  const failures = []

  let usedTokens
  try {
    const measured = tokenMeter?.measure?.(session)
    if (Number.isFinite(measured?.totalTokens)) usedTokens = measured.totalTokens
  } catch {
    usedTokens = undefined
    failures.push('token-meter-failed')
  }

  let windowTokens
  let windowSource
  try {
    const pressure = sessionProjections?.stateOf?.(session, 'contextPressure')
    if (Number.isFinite(pressure?.contextWindow) && pressure.contextWindow > 0) {
      windowTokens = pressure.contextWindow
      windowSource = 'contextPressure'
    }
  } catch {
    // 投影缺失：走兜底；但把失败记下来（兜底成功与否都算"投影这条路挂了"）
    failures.push('context-projection-failed')
  }

  if (windowTokens === undefined && route !== undefined && typeof llm?.resolveModelInfo === 'function') {
    try {
      const info = await llm.resolveModelInfo(route.provider, route.model)
      const fromModel = info?.context?.contextWindow
      if (Number.isFinite(fromModel) && fromModel > 0) {
        windowTokens = fromModel
        windowSource = 'resolveModelInfo'
      }
    } catch {
      // 兜底也失败：windowTokens 保持 undefined，上层静默跳过；原因同样记下
      failures.push('model-info-failed')
    }
  }

  return {
    ...(usedTokens === undefined ? {} : { usedTokens }),
    ...(windowTokens === undefined ? {} : { windowTokens }),
    ...(windowSource === undefined ? {} : { windowSource }),
    // 只在真有失败时带上 error 键（成功时保持既有形状不变）。
    ...(failures.length === 0 ? {} : { error: failures.join(',') }),
    ratio: contextRatio({ usedTokens, windowTokens }),
  }
}
