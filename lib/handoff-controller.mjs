// 硬切控制器：把三档判定、两个指标、安全点、手工优先级、确认卡片、决策日志接到事件流上。
//
// 挂载点（规格 §四 选型理由 / G2 §3）：
//   agent/pre-step  waterfall —— 官方压缩同款挂点，请求派发前判定，排在压缩前面。
//   每个步骤边界都会派发一次（dsh-agent-loop/lib/index.js:911 / :929-955），
//   所以"步骤边界"就是我们能用的安全点，不必等到整轮结束。
//
// 本模块不 import 任何 @deepseek-ai/* 包：ctx 与依赖全部注入，
// 用假 ctx 就能跑纯 Node 单测。

import { createSessionLedger, measureContext } from './handoff-metrics.mjs'
import { isSafePoint } from './handoff-safety.mjs'
import { EVENTS_UNAVAILABLE_REASON, sessionEvents } from './session-events.mjs'
import {
  decideAutoHandoff,
  decideManualHandoff,
  isAutoEligibleSession,
  resolveNativeThresholdTokens,
} from './handoff-policy.mjs'
import { HANDED_OFF_MARK, performHandoff, resolveRoute } from './handoff-exec.mjs'

/**
 * 「已交接」标题的**严格**判据（2026-10-12 独立复核 P2-1）。
 *
 * 为什么不能只判 `startsWith('交接出-')`：用户完全可能自己起一个叫「交接出-我的笔记」
 * 甚至「交接出-」的会话标题，那样会被误判成"已交接"，该会话就**永久不会再被自动硬切**。
 * 现在要求标题里带插件自己写的 `→session-<id>` 结构（id 至少 8 个字符）。
 */
const HANDED_OFF_TITLE_RE = new RegExp(`^${HANDED_OFF_MARK}-.*→session-[A-Za-z0-9-]{8,}$`, 'u')

/** 更早的旧格式标题：`⏏ 已换会话 → <id> · <名字>`（复核 P2-2：这类历史会话也要能恢复）。 */
const LEGACY_HANDED_OFF_TITLE_RE = /^⏏\s*已换会话/u
import { askForHandoff } from './handoff-confirm.mjs'
import { computeHealth, humanReason, reduceDecision } from './handoff-health.mjs'

/** 对外暴露的服务名（供 M2 客户端半边与其它插件调用）。 */
export const SERVICE_NAME = 'sessionHandoff'

/** 连续失败多少次后放弃对该会话的自动重试（防止每个 pre-step 都撞同一堵墙）。 */
export const DEFAULT_MAX_AUTO_ATTEMPTS = 3

/**
 * 残留子会话的**复用时限**：超过它就不再复用（复核 P2-8）。
 *
 * 为什么要有：失败留下的子会话会一直挂在内存里，几小时后用户手工换会话仍可能被
 * 复用它 —— 那已经不是"接着上次的活儿干"，而是往一个陈旧会话里灌新需求。
 * 30 分钟足够覆盖"用户马上重试"的正常场景。
 */
export const CHILD_REUSE_TTL_MS = 30 * 60 * 1000

/** 决策日志保留条数上限（内存环形；持久化留到后续块）。 */
export const MAX_DECISION_RECORDS = 200

/**
 * `drain.phase === 'skipped'` 在 wire 上的**驻留时长**（ARB-18②）。
 *
 * 必须 **> 客户端 3 秒轮询周期**，否则 host 在同一个微任务里 `onState(null)` 清空，
 * 用户永远看不到第三条文案「子代理收尾没做成，直接换会话」。
 */
export const DRAIN_SKIPPED_HOLD_MS = 4000

/**
 * 子代理收尾状态的持有者（ARB-18②）：普通状态即时替换，`'skipped'` 结束信号要**驻留**。
 *
 * 为什么单独抽出来：驻留是"时序正确性"而不是"存个值"，必须能脱离宿主上下文单测。
 *
 * @param {object} [options] - 选项。
 * @param {number} [options.holdMs] - `skipped` 的驻留时长（默认 `DRAIN_SKIPPED_HOLD_MS`）。
 * @param {Function} [options.setTimer] - 定时器实现（测试注入假定时器）。
 * @param {Function} [options.clearTimer] - 清定时器实现。
 * @returns {{push: Function, forget: Function, get: Function}} 持有者。
 */
export function createDrainStateHolder({ holdMs = DRAIN_SKIPPED_HOLD_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  /** @type {{sessionId: string, value: object}|null} */
  let current = null
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  return {
    /**
     * 收一条状态：非空值即时生效；`null`（结束信号）在 `skipped` 时要延后清空。
     * @param {string} sessionId - 会话 id。
     * @param {object|null} value - 状态或结束信号。
     * @returns {void}
     */
    push(sessionId, value) {
      cancelTimer()
      if (value !== null && value !== undefined) {
        current = { sessionId, value }
        return
      }
      // ARB-18②：跳过状态驻留 ≥4 秒（> 客户端 3 秒轮询），否则文案③端到端不可见。
      if (current !== null && current.value?.phase === 'skipped') {
        timer = setTimer(() => {
          timer = null
          if (current !== null && current.value?.phase === 'skipped') current = null
        }, holdMs)
        // 驻留定时器不持有进程（与 ARB-17 说的"等待定时器不 unref"是两回事）。
        timer?.unref?.()
        return
      }
      current = null
    },
    /**
     * 忘掉某个会话的状态（会话销毁 / 新一次硬切开始）。
     * @param {string} [sessionId] - 会话 id；不传 = 无条件清空。
     * @returns {void}
     */
    forget(sessionId) {
      cancelTimer()
      if (current !== null && (sessionId === undefined || current.sessionId === sessionId)) current = null
    },
    /**
     * @returns {object|null} 当前状态（没有则是显式 null）。
     */
    get() {
      return current === null ? null : current.value
    },
  }
}

/**
 * 链路状态存储（M1 §2.2，内存版）。持久化副本留到后续块用 storageDomain 补。
 * @returns {object} 存取 API。
 */
export function createChainStore() {
  /** @type {Map<string, object>} */
  const states = new Map()
  return {
    next(sessionId) {
      const existing = states.get(sessionId)
      if (existing !== undefined) {
        return { chainId: existing.chainId, index: existing.index, rootSessionId: existing.rootSessionId }
      }
      return { chainId: `chain-${sessionId}`, index: 1, rootSessionId: sessionId }
    },
    get(sessionId) {
      return states.get(sessionId)
    },
    set(sessionId, state) {
      states.set(sessionId, state)
    },
    forget(sessionId) {
      states.delete(sessionId)
    },
    get size() {
      return states.size
    },
  }
}

/**
 * 决策日志（内存环形，S7 的数据源）。
 * @param {{max?: number}} [options] - 选项。
 * @returns {object} 日志 API。
 */
export function createDecisionLog({ max = MAX_DECISION_RECORDS } = {}) {
  /** @type {Array<object>} */
  const records = []
  return {
    /**
     * 记一条。
     * @param {object} input - 记录输入。
     * @returns {object} 落库的记录。
     */
    add(input) {
      const record = reduceDecision(input)
      records.push(record)
      while (records.length > max) records.shift()
      return record
    },
    /**
     * 读最近 N 条（新的在前），可按动作筛选。
     * @param {{limit?: number, filter?: string}} [options] - 选项。
     * @returns {Array<object>} 记录。
     */
    list({ limit = 50, filter = 'all' } = {}) {
      const filtered = filter === 'handoff'
        ? records.filter((row) => row.action === 'handoff' || row.action === 'handoff-manual')
        : filter === 'none'
          ? records.filter((row) => row.action !== 'handoff' && row.action !== 'handoff-manual')
          : records
      return [...filtered].reverse().slice(0, limit)
    },
    /** 清空（测试 / 排障）。 */
    clear() {
      records.length = 0
    },
    get size() {
      return records.length
    },
  }
}

/**
 * 建立硬切控制器。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器（ctx.logger(PLUGIN_NAME)）。
 * @param {object} input.config - 已校验配置（**稳定对象**，设置页改完就地更新）。
 * @param {object} [input.deps] - 可注入依赖。
 * @param {Function} input.deps.createUserMessage - `@deepseek-ai/dsh-llm` 的 createUserMessage（**必传**）。
 * @param {Function} [input.deps.narrate] - LLM 叙事摘要：async ({session, route, signal, config, events}) => string。
 * @param {Function} [input.deps.newSessionId] - 新会话 id 生成器。
 * @param {number} [input.deps.maxAutoAttempts] - 连续失败上限。
 * @param {Function} [input.deps.nativeThresholdTokensOf] - 读原生生效阈值（读不到返回 undefined）。
 * @param {Function} [input.deps.now] - 时间源。
 * @param {object} [input.deps.ledgerOptions] - 台账可选项（测试注入字节测量）。
 * @param {Function} [input.deps.askHandoff] - 弹确认卡片（默认 `askForHandoff`；测试注入）。
 * @param {object} [input.deps.decisionLog] - 决策日志（默认新建）。
 * @returns {object} 控制器 API（同时会被 ctx.provide 出去）。
 */
export function createHandoffController({ ctx, logger, config, deps = {} }) {
  const ledger = createSessionLedger(deps.ledgerOptions)
  const chains = createChainStore()
  const decisions = deps.decisionLog ?? createDecisionLog()
  const now = deps.now ?? (() => Date.now())
  const maxAutoAttempts = deps.maxAutoAttempts ?? DEFAULT_MAX_AUTO_ATTEMPTS
  const askHandoff = deps.askHandoff ?? askForHandoff

  /** 正在执行硬切的会话（去重，防同会话并发建两个新会话）。 */
  const busy = new Set()
  /** 已经换过会话的旧会话（不再自动触发）。 */
  const handedOff = new Set()
  /** 手工请求挂起表：非安全点时排队，等下一个 pre-step。 */
  const manualRequests = new Map()
  /** 自动判定连续失败计数。 */
  const autoFailures = new Map()
  /** 触发过"只提醒"的会话（同一个台阶只提醒一次，等用户处理）。 */
  const notified = new Map()
  /**
   * 已经弹窗问过、且用户选择"先不接力"的会话 → 记住"问的是哪一个触发台阶"。
   *
   * 2026-10-12 代码审查 P1-4：M1 产品文档 P0-5 要求「取消或超时后本次不再打扰，
   * 直到下次跨过阈值」，而 `agent/pre-step` 每个步骤边界都会派发一次 —— 没有这个表，
   * 用户拒绝一次就会被**每个步骤**重新弹一次。
   * 存 `reason` 而不是布尔值：触发台阶升级（如从"体积到线"变成"压缩次数到线"）算新台阶，可以再问。
   */
  const asked = new Map()
  /**
   * 上一次尝试**已经建出来、但后续步骤失败**的子会话（P1-3）。
   *
   * 重试时把它交给 `performHandoff` 复用（宿主 `agents.get(id)` 拿回 live agent），
   * 而不是再 `agents.create` 一个 —— 否则一次失败会留下多个孤儿会话。
   *
   * 存 `{ childSessionId, at }`：**超过 `CHILD_REUSE_TTL_MS` 就不再复用**（复核实测：
   * 几小时后手工换会话仍会捡起这个残留会话）。过期的残留交给守卫当"用户可能已经用过"处理。
   */
  const failedChildren = new Map()

  /**
   * 每个会话"上一次接力失败"的人话说明（复核 P2-7）。
   *
   * 失败原来只写日志与决策日志，而桌面版宿主日志根本拿不到 ⇒ 用户什么都看不到。
   * 这里记下来，经 reporter 并进 `stats().errors`，由客户端在健康度行里显示。
   */
  const failures = new Map()

  /**
   * R2（ARB-13 / ARB-18②）：当前子代理收尾的运行期状态持有者。
   * `get()` 返回 `null` = 没有在进行中的收尾；`skipped` 会驻留 ≥4 秒再消失。
   */
  const drainState = createDrainStateHolder()

  /**
   * R2：子代理收尾失败的人话说明（与 `failures` 分开：接力**成功**时 failures 会被清掉，
   * 而收尾失败的可见性必须保留到下一次硬切）。经 reporter 并进 `stats().errors`。
   */
  const drainErrors = new Map()

  const getService = (name) => {
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }

  /**
   * 从会话标题恢复"已交接"状态（2026-10-12 代码审查 P1-5）。
   *
   * 为什么需要：链路状态（`handedOff` / `chains`）都是内存态，DSH 重启后全部清零；
   * 而旧会话的标题里**永久**带着 `交接出-<名字>→<接棒会话ID>` 标记（`markOriginTitle` 写的）。
   * 重启后据此恢复，避免同一个旧会话被再次自动硬切（全自动模式下会直接切成两条线）。
   *
   * 已知取舍：`chains` 的链序号（第几棒）无法从标题反推，重启后退化为 1，
   * 只影响展示，不影响"不再重复硬切"这条安全语义。
   *
   * @param {object} session - 会话。
   * @returns {void}
   */
  function restoreFromTitle(session) {
    if (handedOff.has(session.id)) return
    const title = session?.header?.title
    if (typeof title !== 'string' || title.length === 0) return
    if (!HANDED_OFF_TITLE_RE.test(title) && !LEGACY_HANDED_OFF_TITLE_RE.test(title)) return
    handedOff.add(session.id)
    logger?.info?.(`handoff: session ${session.id} restored as handed-off from its title (DSH restarted?)`)
  }

  /**
   * 按 id 找 live 会话。
   * @param {string} sessionId - 会话 id。
   * @returns {object|undefined} 会话。
   */
  function resolveSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    return getService('sessions')?.get?.(sessionId)
  }

  /**
   * 量当前上下文占用与生效窗口（依赖注入，便于测试打桩）。
   * @param {object} session - 会话。
   * @returns {Promise<object>} 测量结果。
   */
  function measure(session) {
    return measureContext({
      tokenMeter: getService('tokenMeter'),
      sessionProjections: getService('sessionProjections'),
      llm: getService('llm'),
      session,
      route: resolveRoute(session, config),
    })
  }

  /**
   * 读原生上下文压缩的**生效阈值**（读不到就 undefined，由 policy 退化为 0.8 × 窗口）。
   * ⚠️ 内核没有把该阈值挂成服务（已核对：compaction-basic 只导出引擎类，不 provide 服务），
   * 所以默认恒为 undefined——这正是 §十六 16.1 预告的退化路径。
   * @param {object} session - 会话。
   * @returns {number|undefined} 生效阈值 token。
   */
  function nativeThresholdTokensOf(session) {
    if (typeof deps.nativeThresholdTokensOf !== 'function') return undefined
    try {
      return deps.nativeThresholdTokensOf(session)
    } catch {
      return undefined
    }
  }

  /**
   * 组装判定输入（**唯一入口**，`status` / `decideAuto` / 报表器都走它，口径不会漂）。
   * @param {object} session - 会话。
   * @param {object} measured - `measure` 的产物。
   * @returns {object} 判定输入。
   */
  function decisionInput(session, measured) {
    return {
      mode: config.autoMode,
      usedTokens: measured?.usedTokens,
      windowTokens: measured?.windowTokens,
      nativeThresholdTokens: nativeThresholdTokensOf(session),
      nativeCompactionRatio: config.nativeCompactionRatio,
      replaceSafetyFactor: config.replaceSafetyFactor,
      sessionBytes: ledger.bytesOf(session),
      sessionVolumeLimitBytes: config.sessionVolumeBytes,
      compactionsSinceHandoff: ledger.compactionsOf(session),
      compactionCountTrigger: config.compactionCountTrigger,
    }
  }

  /**
   * 对外状态查询（M1 §1.2 契约的读侧；客户端健康度行也读它）。
   * @param {string} sessionId - 会话 id。
   * @returns {Promise<object|undefined>} 状态；会话不存在时 undefined。
   */
  async function status(sessionId) {
    const session = resolveSession(sessionId)
    if (session === undefined) return undefined
    // 重启后状态从标题恢复：让健康度行也能看到"这个会话已经交接过了"。
    restoreFromTitle(session)
    const measured = await measure(session)
    const chain = chains.get(session.id)
    const input = decisionInput(session, measured)
    const decision = decideAutoHandoff(input)
    return {
      sessionId: session.id,
      mode: config.autoMode,
      autoPromptLevel: config.autoPromptLevel,
      usedTokens: measured.usedTokens,
      windowTokens: measured.windowTokens,
      windowSource: measured.windowSource,
      ratio: measured.ratio,
      // 量不到的原因（P1-6）：透传给报表器，让"失败"在排障数据里可见。
      ...(measured.error === undefined ? {} : { error: measured.error }),
      sessionBytes: ledger.bytesOf(session),
      sessionVolumeLimitBytes: config.sessionVolumeBytes,
      compactionsSinceHandoff: ledger.compactionsOf(session),
      compactionCountTrigger: config.compactionCountTrigger,
      turnIndex: ledger.turnIndexOf(session),
      messageCount: ledger.messageCountOf(session),
      eventCount: ledger.eventCountOf(session),
      chainIndex: chain?.index ?? 1,
      chainId: chain?.chainId ?? `chain-${session.id}`,
      safePoint: isSafePoint(sessionEvents(session)),
      handedOff: handedOff.has(session.id),
      autoDecision: { action: decision.action, reason: decision.reason },
    }
  }

  /**
   * 记录一条决策（S7）。不抛错——日志写不进去绝不能影响换会话本身。
   * @param {object} entry - 记录内容。
   * @returns {void}
   */
  function logDecision(entry) {
    if (config.decisionLogEnabled === false) return
    try {
      decisions.add(entry)
    } catch (error) {
      logger?.warn?.(`handoff: decision log write failed: ${String(error?.message ?? error)}`)
    }
  }

  /**
   * 跑一次硬切（带去重）。
   * @param {object} request - 请求。
   * @returns {Promise<object>} 执行结果。
   */
  async function runHandoff(request) {
    const { session, reason, detail, forwardMessages = [], signal, note, skillRefs } = request
    if (busy.has(session.id)) {
      return { ok: false, error: 'a handoff is already in progress for this session', reason }
    }
    busy.add(session.id)
    try {
      // 同一次硬切最多留一条收尾失败记录、状态从零起（§11.6 / ARB-13）。
      drainErrors.delete(session.id)
      drainState.forget()
      const reusableChild = reusableChildOf(session.id)
      const result = await performHandoff({
        ctx,
        logger,
        config,
        session,
        reason,
        detail,
        forwardMessages,
        // R4：留言在**调用这一刻**就已到手（先于 drain），随本次执行一起走（§12.5）。
        ...(note === undefined ? {} : { note }),
        ...(skillRefs === undefined ? {} : { skillRefs }),
        ledger,
        chains,
        deps: {
          ...deps,
          // 收尾状态推送（客户端 ARB-13 的 `drain` wire）与失败留痕（`stats().errors` 通道）。
          // ARB-18②：`skipped` 的驻留由持有者保证（≥4 秒 > 客户端 3 秒轮询）。
          onDrainState: (value) => { drainState.push(session.id, value) },
          recordError: (sessionId, message) => { drainErrors.set(sessionId, { message, at: now() }) },
        },
        signal,
        // 上次失败留下的子会话：**未过期**才复用，否则新建（P1-3 + 复核 P2-8）。
        ...(reusableChild === undefined ? {} : { existingChildSessionId: reusableChild }),
      })
      if (result.ok) {
        handedOff.add(session.id)
        autoFailures.delete(session.id)
        notified.delete(session.id)
        failedChildren.delete(session.id)
        failures.delete(session.id)
      } else {
        // 失败必须**留痕给用户看**（复核 P2-7）：以前只写 logger 与决策日志，
        // 而桌面版宿主日志在磁盘上拿不到 ⇒ 用户完全无感。
        failures.set(session.id, { message: failureMessageOf(result), at: now() })
        if (typeof result.childSessionId === 'string' && result.childSessionId.length > 0) {
          failedChildren.set(session.id, { childSessionId: result.childSessionId, at: now() })
        }
      }
      return result
    } finally {
      busy.delete(session.id)
    }
  }

  /**
   * 手工硬切（§13.4：优先级最高，不看阈值 / 不看档位 / 不看次数限制）。
   * 唯一底线是安全点——不在安全点就先挂起，等下一个步骤边界执行。
   * @param {{sessionId: string, source?: string}|string} request - 会话 id 或请求对象。
   * @returns {Promise<object>} 结果：{ok, queued, childSessionId?, reason?, error?}。
   */
  async function handoffNow(request) {
    const sessionId = typeof request === 'string' ? request : request?.sessionId
    const session = resolveSession(sessionId)
    if (session === undefined) {
      // 带上人话文案：客户端只会显示 `error`，没有它就变成"换会话没成功：null"。
      return { ok: false, queued: false, reason: 'session-not-found', error: `找不到会话 ${String(sessionId)}：它可能已关闭，或只存在于客户端列表里（未在宿主内存中打开）`, sessionId }
    }
    const at = now()
    const measured = await measure(session).catch(() => undefined)
    const chain = chains.get(session.id)
    const detail = { requestedAt: at, source: request?.source ?? 'client' }
    // R4：留言与技能引用（**已由 RPC 层归一化**）；defer 时随挂起项一起保留，到点执行时照用。
    const note = typeof request?.note === 'string' && request.note.length > 0 ? request.note : undefined
    const skillRefs = Array.isArray(request?.skillRefs) && request.skillRefs.length > 0 ? request.skillRefs : undefined
    // 事件读不到时**不去猜**安全点（旧的 `session.events` 恒为 undefined，会被
    // 当成"没有在途工具调用 = 安全"）。这里直接拒绝，并把原因给用户看。
    const events = sessionEvents(session)
    if (events === undefined) {
      logger?.error?.(`handoff(manual) aborted: ${EVENTS_UNAVAILABLE_REASON}`)
      // 拒绝也要留痕：否则"点了没反应"在决策日志里查不到任何记录。
      logDecision({
        at,
        action: 'cancel',
        reason: 'manual-failed',
        chainIndex: chain?.index ?? 1,
        detail: { ...detail, error: EVENTS_UNAVAILABLE_REASON },
      })
      return { ok: false, queued: false, reason: 'events-unavailable', error: EVENTS_UNAVAILABLE_REASON, sessionId: session.id }
    }
    const decision = decideManualHandoff({ safePoint: isSafePoint(events) })
    if (decision.action === 'defer') {
      manualRequests.set(session.id, { requestedAt: at, source: detail.source, note, skillRefs })
      logDecision({
        at,
        action: 'defer',
        reason: decision.reason,
        health: computeHealth({
          mode: config.autoMode,
          usedTokens: measured?.usedTokens,
          windowTokens: measured?.windowTokens,
          nativeThresholdTokens: resolveNativeThresholdTokens({
            windowTokens: measured?.windowTokens,
            nativeThresholdTokens: nativeThresholdTokensOf(session),
            nativeCompactionRatio: config.nativeCompactionRatio,
          }),
          replaceSafetyFactor: config.replaceSafetyFactor,
          sessionBytes: ledger.bytesOf(session),
          sessionVolumeLimitBytes: config.sessionVolumeBytes,
        }),
        chainIndex: chain?.index ?? 1,
        detail,
      })
      logger?.info?.(`handoff(manual): session ${session.id} is not at a safe point; queued for the next step boundary`)
      return { ok: true, queued: true, reason: decision.reason, sessionId: session.id }
    }
    const result = await runHandoff({ session, reason: 'manual', detail, note, skillRefs })
    if (result.ok) {
      logDecision({
        at,
        action: 'handoff-manual',
        reason: 'manual',
        health: computeHealth({
          mode: config.autoMode,
          usedTokens: measured?.usedTokens,
          windowTokens: measured?.windowTokens,
          nativeThresholdTokens: resolveNativeThresholdTokens({
            windowTokens: measured?.windowTokens,
            nativeThresholdTokens: nativeThresholdTokensOf(session),
            nativeCompactionRatio: config.nativeCompactionRatio,
          }),
          replaceSafetyFactor: config.replaceSafetyFactor,
          sessionBytes: ledger.bytesOf(session),
          sessionVolumeLimitBytes: config.sessionVolumeBytes,
        }),
        chainIndex: chain?.index ?? 1,
        // R4：技能引用只做**记账**（不执行、不读技能正文）；留言正文已随 note 进交接文档。
        detail: { ...detail, childSessionId: result.childSessionId, ...(skillRefs === undefined ? {} : { skillRefs }) },
      })
      return { ok: true, queued: false, childSessionId: result.childSessionId, sessionId: session.id }
    }
    logDecision({
      at,
      action: 'cancel',
      reason: 'manual-failed',
      chainIndex: chain?.index ?? 1,
      detail: { ...detail, error: String(result.error ?? 'unknown') },
    })
    return { ok: false, queued: false, reason: 'failed', error: result.error, sessionId: session.id }
  }

  /**
   * 取消该会话排队中的手工请求。
   * @param {string} sessionId - 会话 id。
   * @returns {boolean} 是否取消了挂起项。
   */
  function cancelPending(sessionId) {
    const had = manualRequests.delete(sessionId)
    if (had) {
      logDecision({ at: now(), action: 'cancel', reason: 'cancelled', chainIndex: chains.get(sessionId)?.index ?? 1 })
    }
    return had
  }

  /**
   * 自动判定（不执行；排障 / 报表器用）。
   * @param {object} session - 会话。
   * @returns {Promise<object>} 判定结果。
   */
  async function decideAuto(session) {
    const measured = await measure(session)
    return decideAutoHandoff(decisionInput(session, measured))
  }

  /**
   * 组装"当前这一步"的健康度（弹确认卡片与决策日志都要用）。
   * @param {object} session - 会话。
   * @param {object} measured - `measure` 的产物。
   * @returns {object} 健康度。
   */
  function healthOf(session, measured) {
    return computeHealth({
      mode: config.autoMode,
      usedTokens: measured?.usedTokens,
      windowTokens: measured?.windowTokens,
      nativeThresholdTokens: resolveNativeThresholdTokens({
        windowTokens: measured?.windowTokens,
        nativeThresholdTokens: nativeThresholdTokensOf(session),
        nativeCompactionRatio: config.nativeCompactionRatio,
      }),
      replaceSafetyFactor: config.replaceSafetyFactor,
      sessionBytes: ledger.bytesOf(session),
      sessionVolumeLimitBytes: config.sessionVolumeBytes,
    })
  }

  /**
   * 当前触发台阶的"量"（用来判断它有没有明显上涨，见 `config.askRearmPercent`）。
   *
   * 量不到时返回 `undefined` —— 此时不会重问（保守：不确定涨没涨就别打扰用户）。
   *
   * @param {object} session - 会话。
   * @param {object} decision - 判定结果（用它的 `reason`）。
   * @param {object} measured - `measure` 的产物。
   * @returns {number|undefined} 触发量。
   */
  function triggerAmountOf(session, decision, measured) {
    if (decision.reason === 'session-volume') return ledger.bytesOf(session)
    if (decision.reason === 'compaction-count') return ledger.compactionsOf(session)
    if (decision.reason === 'replace-threshold') return measured?.usedTokens
    return undefined
  }

  /**
   * 可以复用的残留子会话 id：**过期就不复用**（复核 P2-8），顺手清掉过期记录。
   * @param {string} sessionId - 会话 id。
   * @returns {string|undefined} 子会话 id；没有或已过期时 undefined。
   */
  function reusableChildOf(sessionId) {
    const record = failedChildren.get(sessionId)
    if (record === undefined || record === null) return undefined
    if (!Number.isFinite(record.at) || now() - record.at > CHILD_REUSE_TTL_MS) {
      failedChildren.delete(sessionId)
      return undefined
    }
    return typeof record.childSessionId === 'string' && record.childSessionId.length > 0
      ? record.childSessionId
      : undefined
  }

  /**
   * 把失败结果折成给用户看的一句话（复核 P2-7）。
   * @param {object} result - `performHandoff` 的返回值。
   * @returns {string} 人话。
   */
  function failureMessageOf(result) {
    const raw = typeof result?.error === 'string' && result.error.length > 0 ? result.error : '未知原因'
    return `上次接力没成功（${raw}）；可以点「换会话」重试`
  }

  /**
   * 某个会话上一次失败的说明（给 reporter 并进 `stats().errors`，客户端会显示）。
   * @param {string} sessionId - 会话 id。
   * @returns {{message: string, at: number}|undefined} 失败记录。
   */
  function failureOf(sessionId) {
    return failures.get(sessionId)
  }

  /**
   * 注册事件监听（台账 + pre-step 触发）。返回解绑函数由 ctx.effect 托管。
   * @returns {void}
   */
  function start() {
    // 会话体积 / 压缩次数 / 轮序号：首次全量、之后增量（见 handoff-metrics.mjs 顶部注释）。
    ctx.on('session/event', (session, event) => {
      ledger.observe(session, event)
    })
    ctx.on('session/disposed', (session) => {
      ledger.forget(session)
      chains.forget(session.id)
      manualRequests.delete(session.id)
      autoFailures.delete(session.id)
      handedOff.delete(session.id)
      notified.delete(session.id)
      asked.delete(session.id)
      failedChildren.delete(session.id)
      failures.delete(session.id)
      drainErrors.delete(session.id)
      drainState.forget(session.id)
      busy.delete(session.id)
    })

    ctx.on('agent/pre-step', async (payload, next) => {
      const session = payload?.agent?.session
      if (session === undefined || session === null) return next()

      // 安全点复核：pre-step 本身是步骤边界，但保险起见显式验一次"无在途工具调用"。
      // ⚠️ 事件读不到时 isSafePoint 返回 false（保守）：此时**不做任何硬切**，
      //    自动触发也别想在"未知"状态下切会话。
      const events = sessionEvents(session)
      if (!isSafePoint(events)) {
        if (events === undefined) {
          logger?.warn?.(`handoff: cannot read session events for ${session.id}; skipping this pre-step (fail-closed)`)
        }
        if (manualRequests.has(session.id)) {
          logger?.warn?.(`handoff(manual): session ${session.id} still has an in-flight tool call; staying queued`)
        }
        return next()
      }

      const signal = payload?.signal
      const claimed = Array.isArray(payload?.messages) ? payload.messages : []

      // —— 手工优先：不看阈值、不看档位、不看次数限制（§13.4）——
      const pending = manualRequests.get(session.id)
      if (pending !== undefined) {
        manualRequests.delete(session.id)
        const result = await runHandoff({
          session,
          reason: 'manual',
          detail: { requestedAt: pending.requestedAt, source: pending.source },
          forwardMessages: claimed,
          signal,
          // R4：挂起期间保留的留言/技能引用，到点执行时照用（§12.5）。
          ...(pending.note === undefined ? {} : { note: pending.note }),
          ...(pending.skillRefs === undefined ? {} : { skillRefs: pending.skillRefs }),
        })
        if (result.ok) return { kind: 'reject' }
        logger?.error?.(`handoff(manual) failed for session ${session.id}: ${result.error}`)
        return next()
      }

      if (config.enabled === false) return next()
      if (config.autoMode === 'native') return next()
      if (!isAutoEligibleSession(session.header)) return next()
      // 重启后先用标题标记恢复"已交接"，再判断要不要自动切（P1-5）。
      restoreFromTitle(session)
      if (handedOff.has(session.id) || busy.has(session.id)) return next()
      if ((autoFailures.get(session.id) ?? 0) >= maxAutoAttempts) return next()

      const measured = await measure(session)
      const decision = decideAutoHandoff(decisionInput(session, measured))
      const health = healthOf(session, measured)
      const chainIndex = chains.get(session.id)?.index ?? 1

      if (decision.action !== 'handoff') {
        // 没到线（或已回落）：清掉"问过"的标记 —— 对应 P0-5 的"下次跨过阈值再问"。
        asked.delete(session.id)
        // 每次判定都写一条决策日志（§二：无论选了哪个动作）。
        logDecision({
          at: now(),
          action: 'none',
          reason: decision.reason,
          health,
          chainIndex,
          detail: decision.detail,
        })
        return next()
      }

      const thresholdLabel = humanReason({ action: 'handoff', reason: decision.reason, detail: decision.detail })

      // —— 「该换会话的时候怎么做」（§一 S1 自动程度区）——
      if (config.autoPromptLevel === 'notify') {
        // 只提醒：本步不动手，提示由客户端健康度行承担（到点了它就是琥珀/红 + 结论句）。
        // 同一个台阶只提醒一次，避免每一步都刷屏。
        if (!notified.has(session.id)) {
          notified.set(session.id, decision.reason)
          logDecision({ at: now(), action: 'none', reason: `notify:${decision.reason}`, health, chainIndex, detail: decision.detail })
          logger?.info?.(`handoff(notify): session ${session.id} reached ${decision.reason}; waiting for the user`)
        }
        return next()
      }

      if (config.autoPromptLevel === 'confirm') {
        // ⚠️ 同一个台阶**只问一次**（2026-10-12 代码审查 P1-4）。
        //    M1 产品文档 P0-5：「取消或超时后本次不再打扰，直到下次跨过阈值」。
        //    pre-step 每个步骤边界都会派发，没有这道闸门就会每一步重弹一次。
        //    标记在"判定不再触发"时清掉（见上方 asked.delete）；
        //    此外**触发量再涨 `config.askRearmPercent` 个百分点**也算跨过了新台阶
        //    （默认 50%，可在设置里改；2026-10-12 用户拍板引入，见 handoff-config.mjs 的
        //    `HANDOFF_DEFAULTS.askRearmPercent`）——
        //    否则体积这类单调指标会让本会话在用户点过一次"先不接力"后**永久静音**。
        const askedRecord = asked.get(session.id)
        if (askedRecord !== undefined && askedRecord.reason === decision.reason) {
          const current = triggerAmountOf(session, decision, measured)
          // 涨 50%（默认）＝ 1.5 倍；这里在**调用时**读 config，设置页改完立即生效。
          const rearmGrowth = 1 + config.askRearmPercent / 100
          const grewEnough = Number.isFinite(current) && Number.isFinite(askedRecord.amount)
            && askedRecord.amount > 0 && current >= askedRecord.amount * rearmGrowth
          if (!grewEnough) return next()
        }
        const userQuestions = getService('userQuestions')
        // ⚠️ 没有问答通道（headless / 问答 UI 未挂载）时：**不换会话**。
        //
        // 2026-10-10 修正：此处原先写的是"退回静默执行"（无通道就直接换），
        // 与 `lib/handoff-confirm.mjs:73-76` 的写法自相矛盾——那边明确写"按先不换处理，绝不静默换会话"。
        // 以"不换"为准，理由有三：
        //   1. 用户在设置里选了「弹窗确认」，语义就是"换之前先问我"。**问不到就不该替他决定**
        //      ——否则等于把用户的显式选择降级成"全自动"，那正是 `index.mjs` inject 注释里
        //      明确反对的"静默退化成不问就换"。
        //   2. 不换的代价是"晚点再换"（用户随时可以点 [换会话] 手工换，或手动改设置）；
        //      换错的代价是**会话被切走、上下文交接，用户正在做的事被打断**。两者不对等。
        //   3. 与 `handoff-confirm.mjs` 的 no-question-channel 分支保持同一语义，消除矛盾。
        const answer = userQuestions === undefined
          ? { action: 'cancel', reason: 'no-question-channel' }
          : await askHandoff({
          userQuestions,
          health,
          chainIndex,
          reasonLabel: thresholdLabel,
          detail: undefined,
          signal,
          timeoutMs: config.confirmTimeoutMs,
          // ⚠️ 刻意**不传 agent**：传了就必须是注册表里精确的 live runtime root，
          // 传错直接 CALLER_NOT_LIVE / DELEGATED_CALLER（`dsh-user-questions/lib/index.js:52-60`）。
          // plan-mode 传 agent 是因为它本来就在那个 agent 的调用栈里；我们不是。
        })
        if (answer.action === 'always-auto') {
          // 「以后都自动接力」：把自动程度改成全自动（配置侧生效，设置页也能看到）。
          asked.delete(session.id)
          config.autoPromptLevel = 'auto'
          if (typeof deps.onAlwaysAuto === 'function') {
            Promise.resolve(deps.onAlwaysAuto()).catch((error) => {
              logger?.warn?.(`handoff: failed to persist autoPromptLevel=auto: ${String(error?.message ?? error)}`)
            })
          }
        } else if (answer.action !== 'handoff') {
          // 用户选了"先不接力"：记住这个台阶，后续步骤不再重复打扰（P1-4）。
          // ⚠️ 只有"拒绝"才记；用户同意但执行失败时**不记**，否则会把合法重试也挡掉。
          // 同时记下当时的触发量：再涨 `config.askRearmPercent` 个百分点就允许重问（默认 50%）。
          asked.set(session.id, { reason: decision.reason, amount: triggerAmountOf(session, decision, measured) })
          logDecision({
            at: now(),
            action: 'cancel',
            reason: `confirm-${answer.reason}`,
            health,
            chainIndex,
            detail: decision.detail,
          })
          logger?.info?.(`handoff(confirm): session ${session.id} — user chose later (${answer.reason})`)
          return next()
        }
      }

      logger?.info?.(`handoff(auto): session ${session.id} triggered by ${decision.reason} ${JSON.stringify(decision.detail)}`)
      const result = await runHandoff({
        session,
        reason: decision.reason,
        detail: decision.detail,
        forwardMessages: claimed,
        signal,
      })
      if (result.ok) {
        logDecision({
          at: now(),
          action: 'handoff',
          reason: decision.reason,
          health,
          chainIndex,
          detail: { ...decision.detail, childSessionId: result.childSessionId },
        })
        return { kind: 'reject' }
      }

      // P1-3：失败计数要区分"有没有建出会话"。
      //   · 建会话阶段就失败（无 `childSessionId`）→ 没有任何副作用，按次数重试（上限 maxAutoAttempts）。
      //   · 已经建出新会话才失败（注入失败 / 新会话未落盘）→ **一次就停**：
      //     再重试只会再造一个孤儿会话（2026-10-12 审查实测：重试 2 次建出 2 个新会话）。
      const orphanRisk = typeof result.childSessionId === 'string' && result.childSessionId.length > 0
      const failures = orphanRisk ? maxAutoAttempts : (autoFailures.get(session.id) ?? 0) + 1
      autoFailures.set(session.id, failures)
      logDecision({
        at: now(),
        action: 'cancel',
        reason: `failed:${decision.reason}`,
        health,
        chainIndex,
        detail: { ...decision.detail, error: String(result.error ?? 'unknown'), childSessionId: result.childSessionId ?? null },
      })
      logger?.error?.(`handoff(auto) failed for session ${session.id} (${failures}/${maxAutoAttempts}${orphanRisk ? ', orphan session created → auto retry disabled' : ''}): ${result.error}`)
      // 失败绝不阻断原会话：走 next() 让这一步照常进行。
      return next()
    })
  }

  return {
    start,
    status,
    handoffNow,
    cancelPending,
    /** 只读的判定探测（排障 / 测试）。 */
    decideAuto,
    /** 决策日志（S7 的数据源）。 */
    decisions,
    /**
     * 某个会话上一次接力失败的说明（复核 P2-7）。
     * 交给 reporter 并进 `stats().errors`，客户端会在健康度行里显示；
     * 桌面版宿主日志拿不到，这是唯一能让用户看见失败的通道。
     * @param {string} sessionId - 会话 id。
     * @returns {{message: string, at: number}|undefined} 失败记录。
     */
    failureOf,
    /**
     * R2（ARB-13）：当前子代理收尾状态（`null` = 没有在进行中的收尾）。
     * 经 `stats()` 的 `drain` 字段透给客户端；形状见 M1 技术文档 §11.2。
     * @returns {object|null} `{ phase, waitedSec, timeoutMin, interruptedCount }` 或 null。
     */
    drain: () => drainState.get(),
    /**
     * R2：子代理收尾失败的可见记录（与 `failureOf` 同一条 `stats().errors` 通道）。
     * @param {string} sessionId - 会话 id。
     * @returns {{message: string, at: number}|undefined} 记录。
     */
    drainErrorOf: (sessionId) => drainErrors.get(sessionId),
    /** 内部状态句柄（排障 / 测试）。 */
    internals: { ledger, chains, busy, handedOff, manualRequests, autoFailures, notified, asked, failedChildren, failures, drainErrors },
  }
}
