// R2：硬切前的子代理收尾（prompt → 等待 → 超时打断 → 全部结束才建新会话）。
//
// 规格：M1 技术文档 §11.1（v1.2），内核取证清单 §11.9；裁决 ARB-1 / ARB-3 / ARB-11 / ARB-12 /
// ARB-14 / ARB-16，加 QA 独立审查打回意见 ARB-17 ~ ARB-21（口径清单 §7.5）。
//
// ⚠️ 硬底线（写进代码 + 测试断言）：
//   1) `drainSubagents()` 在任何输入下都**必须 resolve，绝不 reject**；
//   2) **总挂钟有界**（ARB-17）：整个执行体与「`subagentDrainTimeoutMin` 分钟 + 15 秒」赛跑，
//      连"内核调用永不 settle"这种悬挂也必须到点返回 —— 用户绝不会被永久卡在"换会话中"。
//
// 本模块**不 import 任何 @deepseek-ai/* 包**（PK-017：宿主顶层零内核 import），只吃 `ctx.get()`。

import { randomUUID } from 'node:crypto'

/** 请子代理收尾的指令正文（逐字固定，M1 §11.1.3(a)）。 */
export const SUBAGENT_WRAP_UP_PROMPT = '请现在收尾：把你手上这部分做完或做到一个能交接的停点，然后把你自己的交接文档写出来（写清你负责什么、已经做完什么、还没做什么、涉及哪些文件），不要再开新的工作。'

/** 轮询周期（固定常量，不暴露给用户）。 */
export const SUBAGENT_DRAIN_POLL_MS = 1000

/** 打断后的固定收尾窗口（ARB-11：硬编码、不进配置；总挂钟上限 = 配置值 + 这个窗口）。 */
export const SUBAGENT_POST_INTERRUPT_GRACE_MS = 15_000

/** 行状态 ①：已交卷。 */
export const SUBAGENT_ROW_SETTLED = '已交卷'

/** 行状态 ②（ARB-12）：`one-shot` / `unknown` 这类不支持收尾的子代理仍驻留。 */
export const SUBAGENT_ROW_UNSUPPORTED = '未交卷（该子代理不支持收尾）'

/** 行状态 ④（ARB-20）：**收尾没能发起**（控制端点不可用 / prompt 投递失败 / 来不及投递）。 */
export const SUBAGENT_ROW_NO_WRAPUP = '未交卷（没走成收尾）'

/** watchdog 到点的哨兵（`Promise.race` 用；它不是任何合法返回值形状）。 */
const WATCHDOG = Symbol('subagent-drain-watchdog')

/** 默认睡眠实现（测试可注入 `sleep`，注入后不碰真实定时器）。 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 安全取宿主服务（`ctx.get` 抛错也当"没有"）。
 * @param {object} ctx - Cordis 上下文。
 * @param {string} name - 服务名。
 * @returns {object|undefined} 服务实例。
 */
function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name) ?? undefined
  } catch {
    return undefined
  }
}

/** Error → 人话。 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 列出某个父会话的直接子代理。
 *
 * 首选 `subagents.listChildren`；服务不在时走降级①（直接读同一个 `subagentCatalog` 投影）。
 * 两条路都拿不到 ⇒ `{ entries: null }`（调用方按"无子代理"处理）。
 *
 * @param {object} input - 输入。
 * @returns {Promise<{entries: object[]|null, source: 'subagents'|'projection'|'none'}>} 结果。
 */
async function readChildren({ ctx, service, parentSessionId, signal }) {
  if (service !== undefined && typeof service.listChildren === 'function') {
    const listed = await service.listChildren(parentSessionId, signal)
    return { entries: Array.isArray(listed) ? listed : [], source: 'subagents' }
  }
  const query = safeGet(ctx, 'sessionQuery')
  if (query === undefined || typeof query.observeSession !== 'function') return { entries: null, source: 'none' }
  const observation = await query.observeSession(parentSessionId, { signal })
  try {
    const entries = observation?.projections?.values?.subagentCatalog
    return { entries: Array.isArray(entries) ? entries : [], source: 'projection' }
  } finally {
    // 内核 listChildren 也是"读一次、释放一次"；不释放会漏观察者。
    try {
      observation?.dispose?.()
    } catch {
      // dispose 失败不影响收尾结果。
    }
  }
}

/**
 * 读一次子代理当前的可观测状态（基线快照与轮询判定共用它，口径只此一处）。
 *
 * ARB-21：`sessions.get()` 返回 `null` 与 `undefined` 一视同仁（都当"不在驻留"）。
 *
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {string} input.childId - 子会话 id。
 * @returns {{resident: boolean|undefined, timing: object|undefined}} `resident`：是否仍驻留
 *   （`sessions` 服务不在时是 undefined = 判不了）；`timing`：`subagentTiming` 投影。
 */
function readObservation({ ctx, childId }) {
  const sessions = safeGet(ctx, 'sessions')
  const canReadSessions = sessions !== undefined && typeof sessions.get === 'function'
  let childSession
  if (canReadSessions) {
    try {
      childSession = sessions.get(childId)
    } catch {
      childSession = undefined
    }
  }
  if (canReadSessions && (childSession === undefined || childSession === null)) {
    return { resident: false, timing: undefined }
  }
  let timing
  try {
    const projections = safeGet(ctx, 'sessionProjections')
    timing = projections?.stateOf?.(childSession, 'subagentTiming')
  } catch {
    timing = undefined
  }
  if (timing === null || typeof timing !== 'object') timing = undefined
  return { resident: canReadSessions ? true : undefined, timing }
}

/**
 * ARB-16：**prompt 投出之后**是否已交卷（基线比较，防"空闲子代理上一轮刚结束 → 秒判已交卷"）。
 *
 * 判定顺序（只对 **prompt 投递成功** 的子代理适用）：
 *   ① 已不在 `sessions` 里（不驻留）⇒ 已交卷（本来就不在跑）；
 *   ② `settledMs` 与基线**不同** ⇒ 期间发生过新的一次 settle ⇒ 已交卷；
 *   ③ 期间观察到过 `active !== undefined`（它真的跑起来过），且现在 `active === undefined &&
 *      lastTurnCompleted === true` ⇒ 已交卷；
 *   ④ 都不满足 ⇒ **不算已交卷**，继续等，到 `deadline` 才打断。
 *
 * ARB-21：基线只留真正用到的 `settledMs`（原来的 `active` / `lastTurnCompleted` 写了从不读，已删）。
 *
 * @param {object} input - 输入。
 * @param {{settledMs: number|null}|undefined} input.baseline - prompt 那一刻的快照。
 * @param {{resident: boolean|undefined, timing: object|undefined}} input.observation - 当前观测。
 * @param {boolean} input.seenActive - 轮询期间是否观察到过进行中的轮次。
 * @returns {boolean} 已交卷返回 true。
 */
function settledAfterPrompt({ baseline, observation, seenActive }) {
  if (observation.resident === false) return true
  const baseSettled = baseline?.settledMs ?? null
  const observedSettled = typeof observation.timing?.settledMs === 'number' ? observation.timing.settledMs : null
  if (observedSettled !== null && observedSettled !== baseSettled) return true
  if (seenActive && observation.timing?.active === undefined && observation.timing?.lastTurnCompleted === true) return true
  return false
}

/**
 * 组装 R3 第 6 节的行（四种逐字形态见口径清单 §5 / ARB-12 / ARB-20）。
 *
 * @param {object} input - 输入。
 * @param {object[]} input.entries - 最后一次列出的子代理条目。
 * @param {Map<string, string>} input.status - 已判定状态（'settled'|'interrupted'|'no-wrapup'）。
 * @param {number} input.timeoutMin - 配置的等待上限（分钟）。
 * @param {Function} [input.isResident] - `one-shot` / `unknown` 的兜底判据（是否仍驻留）。
 * @returns {string|null} 小节正文（多行）；无子代理返回 null。
 */
export function buildSubagentSection({ entries, status, timeoutMin, isResident }) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const lines = entries.map((entry) => {
    const label = typeof entry?.label === 'string' && entry.label.length > 0 ? entry.label : undefined
    const shortName = label ?? '(未命名)'
    const duty = label ?? '(未提供)'
    const state = rowStateOf({ entry, status, timeoutMin, isResident })
    return `- 子代理 ${shortName}（${duty}）—— ${state}`
  })
  return lines.join('\n')
}

/**
 * 一条记录的行状态。
 * @param {object} input - 输入。
 * @returns {string} 逐字状态文案。
 */
function rowStateOf({ entry, status, timeoutMin, isResident }) {
  const judged = status.get(entry?.id)
  if (judged === 'settled') return SUBAGENT_ROW_SETTLED
  if (judged === 'interrupted') return `未交卷（等待 ${timeoutMin} 分钟后被打断）`
  if (judged === 'no-wrapup') return SUBAGENT_ROW_NO_WRAPUP
  // `one-shot` / `unknown` 不支持收尾（ARB-12）：不再驻留算已交卷，否则用「不支持收尾」形态。
  if (entry?.mode !== 'continuable') {
    let resident = false
    try {
      resident = isResident?.(entry.id) === true
    } catch {
      resident = false
    }
    return resident ? SUBAGENT_ROW_UNSUPPORTED : SUBAGENT_ROW_SETTLED
  }
  // continuable 但没有判定状态 = 收尾没能发起（ARB-20），**不许**误标"不支持收尾"。
  return SUBAGENT_ROW_NO_WRAPUP
}

/**
 * 硬切前的子代理收尾（**唯一实现**，`performHandoff` 单点接入，自动与手工共用）。
 *
 * 流程（M1 §11.1 + ARB-17 ~ ARB-21）：
 *   ⓪ **总挂钟有界**（ARB-17）：整个执行体与「配置分钟 + 15 秒」赛跑，连内核调用悬挂也算到点，
 *      超时按"收尾没做成"返回并继续建新会话；定时器**不 unref**（unref 会让等待被静默截断）；
 *   ① 列出直接子代理（`subagents.listChildren`，服务不在时降级读投影）；
 *   ② 请每个 `continuable` 收尾（ARB-14：只有投递成功的才算"在等"，失败的记「没走成收尾」）；
 *   ③ 轮询判定（ARB-16 基线比较；ARB-19：每轮 relist 新冒出来的 continuable 也 prompt + 等 + 到点打断）；
 *   ④ 到点（配置分钟数）对仍未交卷者 `interruptByParent`，再给固定 15 秒收尾窗口；
 *   ⑤ 全部结束 / 到点 / 异常吞掉后才返回，调用方这时才建新会话。
 *
 * ⚠️ 已知简化（已知限制，见口径清单 §7.5）：结构门禁若在 drain 结束前就确定失败，
 *    **不会**用 AbortSignal 提前取消 drain —— 由上面的挂钟硬上限兜底。
 *
 * **永不 reject**：任何异常都转成 `onError` 一条记录 + `logger.warn`，返回 `skipped: true`。
 *
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} [input.logger] - 日志器。
 * @param {object} input.session - 原会话。
 * @param {object} input.config - 已校验配置（读 `subagentDrainTimeoutMin`）。
 * @param {AbortSignal} [input.signal] - 取消信号。
 * @param {Function} [input.now] - 时间源。
 * @param {Function} [input.sleep] - 睡眠实现（测试注入假实现即可不碰真实定时器）。
 * @param {number} [input.pollMs] - 轮询周期（默认 1000ms）。
 * @param {number} [input.watchdogMs] - 覆盖挂钟上限（**测试钩子**；生产不传，走配置值 + 15 秒）。
 * @param {Function} [input.onState] - 运行期状态回调（ARB-13 的 `drain` wire）。
 * @param {Function} [input.onError] - 失败记录回调（走 `stats().errors` 通道）。
 * @returns {Promise<{section: string|null, interruptedCount: number, skipped: boolean, aborted: boolean}>} 收尾结果。
 */
export async function drainSubagents(input) {
  const {
    ctx, logger, session, config, signal,
    now = () => Date.now(),
    sleep = defaultSleep,
    pollMs = SUBAGENT_DRAIN_POLL_MS,
    watchdogMs,
    onState,
    onError,
  } = input

  const timeoutMin = Number(config?.subagentDrainTimeoutMin) > 0 ? Number(config.subagentDrainTimeoutMin) : 10
  const sessionId = session?.id
  const start = now()
  let interruptedCount = 0

  /** 记一条可见失败（同一次硬切由控制器按 sessionId 去重，最多留一条）。 */
  const report = (message) => {
    try {
      logger?.warn?.(`handoff: ${message}`)
      onError?.(message)
    } catch {
      // 记录失败绝不能反过来把收尾拖垮。
    }
  }

  /** 推运行期状态（ARB-13 的 wire 形状）。 */
  const emit = (phase) => {
    try {
      onState?.({ phase, waitedSec: Math.max(0, Math.floor((now() - start) / 1000)), timeoutMin, interruptedCount })
    } catch {
      // 状态推送失败不影响收尾。
    }
  }

  const service = safeGet(ctx, 'subagents')
  const canPrompt = service !== undefined && typeof service.prompt === 'function'
  const canInterrupt = service !== undefined && typeof service.interruptByParent === 'function'

  /**
   * 收尾主体（真正的业务流程；由外面的 watchdog 兜住任何"永不 settle"的 await）。
   * @returns {Promise<object>} 与 `drainSubagents` 同形状的返回值。
   */
  async function runDrainBody() {
    try {
      let listed
      try {
        listed = await readChildren({ ctx, service, parentSessionId: sessionId, signal })
      } catch (error) {
        // ARB-18①：跳过分支也要 emit('skipped')，文案③才不是死枚举。
        report(`子代理收尾没做成，直接换会话（原因：列子代理失败：${messageOf(error)}）`)
        emit('skipped')
        return { section: null, interruptedCount: 0, skipped: true, aborted: false }
      }

      if (listed.entries === null) {
        report('子代理收尾没做成，直接换会话（原因：subagents / sessionQuery 服务都不可用）')
        emit('skipped')
        return { section: null, interruptedCount: 0, skipped: true, aborted: false }
      }
      if (listed.entries.length === 0) {
        return { section: null, interruptedCount: 0, skipped: false, aborted: false }
      }

      const entries = listed.entries
      const continuable = entries.filter((entry) => entry?.mode === 'continuable')
      /** 已判定状态：childId → 'settled' | 'interrupted' | 'no-wrapup'。 */
      const status = new Map()
      /** 仍在等交卷的 continuable id（ARB-14：**只放 prompt 投递成功**的）。 */
      const unresolved = new Set()
      /** ARB-16 基线（ARB-21：只留真正用到的 `settledMs`）。 */
      const baseline = new Map()
      /** ARB-16 规则③：轮询期间观察到过 `active !== undefined` 的子代理。 */
      const seenActive = new Set()
      /** 建 R3 小节（多处共用）。 */
      const buildSection = (list) => buildSubagentSection({
        entries: list,
        status,
        timeoutMin,
        isResident: (id) => childActive(ctx, id),
      })

      // 服务不可用（靠投影勉强列出来了）：只能出 R3 列表，做不了收尾。
      // ARB-20：continuable 这里要记「没走成收尾」，**不是**「不支持收尾」。
      if (!canPrompt) {
        report('子代理收尾没做成，直接换会话（原因：subagents 服务不可用）')
        for (const entry of continuable) status.set(entry.id, 'no-wrapup')
        emit('skipped')
        return { section: buildSection(entries), interruptedCount: 0, skipped: true, aborted: false }
      }

      if (signal?.aborted) return { section: null, interruptedCount: 0, skipped: false, aborted: true }

      const deadline = start + timeoutMin * 60_000
      const hardStop = deadline + SUBAGENT_POST_INTERRUPT_GRACE_MS

      /**
       * 请一个子代理收尾（ARB-19 复用同一段：中途新冒出来的也走它）。
       * @param {object} entry - 目录条目。
       * @returns {Promise<boolean>} 投递成功返回 true（进等待集合）；失败记 `no-wrapup` 并返回 false。
       */
      const requestWrapUp = async (entry) => {
        // ARB-16：在 prompt **那一刻**记基线快照（读不到就记 null）。
        const before = readObservation({ ctx, childId: entry.id })
        try {
          await service.prompt({
            requestId: randomUUID(),
            parentSessionId: sessionId,
            childSessionId: entry.id,
            mode: 'continuable',
            delivery: childActive(ctx, entry.id) ? 'steer' : 'queue',
            content: [{ type: 'text', text: SUBAGENT_WRAP_UP_PROMPT }],
          }, signal)
        } catch (error) {
          // ARB-14 / ARB-20：投递失败 = 收尾没能发起 ⇒ 立刻移出等待集合、记「没走成收尾」，
          // 既不白等到 deadline，也不谎称"等待 N 分钟后被打断"。
          status.set(entry.id, 'no-wrapup')
          report(`子代理收尾没做成，直接换会话（原因：请子代理收尾失败：${messageOf(error)}）`)
          return false
        }
        baseline.set(entry.id, {
          settledMs: typeof before.timing?.settledMs === 'number' ? before.timing.settledMs : null,
        })
        unresolved.add(entry.id)
        return true
      }

      // ② 首轮：请每个 continuable 收尾。ARB-14：一个都没投出去 ⇒ ③ 一轮都不等。
      let delivered = 0
      for (const entry of continuable) {
        if (signal?.aborted) return { section: null, interruptedCount, skipped: false, aborted: true }
        if (await requestWrapUp(entry)) delivered += 1
      }

      // ③ 轮询等待：只等**投递成功**的子代理。
      let current = entries
      if (unresolved.size > 0) {
        emit('waiting')
        while (unresolved.size > 0) {
          if (signal?.aborted) return { section: null, interruptedCount, skipped: false, aborted: true }
          if (now() >= deadline) break
          await sleep(pollMs)
          emit('waiting')
          try {
            const relisted = await readChildren({ ctx, service, parentSessionId: sessionId, signal })
            if (Array.isArray(relisted.entries)) current = relisted.entries
          } catch (error) {
            logger?.warn?.(`handoff: 重新列子代理失败（沿用上一轮结果）：${messageOf(error)}`)
          }
          // ARB-19：drain 中途新冒出来的直接 continuable 也要 prompt + 记基线 + 纳入等待。
          for (const entry of current) {
            if (entry?.mode !== 'continuable') continue
            if (status.has(entry.id) || unresolved.has(entry.id)) continue
            if (await requestWrapUp(entry)) delivered += 1
          }
          for (const childId of [...unresolved]) {
            const observation = readObservation({ ctx, childId })
            if (observation.timing?.active !== undefined) seenActive.add(childId)
            if (settledAfterPrompt({ baseline: baseline.get(childId), observation, seenActive: seenActive.has(childId) })) {
              unresolved.delete(childId)
              status.set(childId, 'settled')
            }
          }
        }
      }

      // ④ 到点：只对仍未交卷者打断（ARB-1 / ARB-11：硬到点必打断，绝不无限等）。
      let interruptFailed = false
      if (unresolved.size > 0) {
        for (const childId of [...unresolved]) {
          if (signal?.aborted) return { section: null, interruptedCount, skipped: false, aborted: true }
          status.set(childId, 'interrupted')
          if (!canInterrupt) {
            interruptFailed = true
            continue
          }
          try {
            const receipt = service.interruptByParent(childId, sessionId, 'continuable')
            if (receipt?.accepted === true) interruptedCount += 1
          } catch (error) {
            // §11.1.5：interruptByParent 抛错 → 不再等待，直接建新会话（并留一条可见记录）。
            report(`子代理收尾没做成，直接换会话（原因：打断子代理失败：${messageOf(error)}）`)
            interruptFailed = true
          }
        }
        emit('interrupted')
        if (!interruptFailed) {
          // 打断是 fire-and-return：再给固定 15 秒收尾窗口，到点无条件放行。
          while (unresolved.size > 0 && now() < hardStop) {
            if (signal?.aborted) return { section: null, interruptedCount, skipped: false, aborted: true }
            await sleep(pollMs)
            try {
              const relisted = await readChildren({ ctx, service, parentSessionId: sessionId, signal })
              if (Array.isArray(relisted.entries)) current = relisted.entries
            } catch {
              // 收尾窗口里的重列失败忽略（沿用上一轮）。
            }
            for (const childId of [...unresolved]) {
              const observation = readObservation({ ctx, childId })
              if (observation.timing?.active !== undefined) seenActive.add(childId)
              if (settledAfterPrompt({ baseline: baseline.get(childId), observation, seenActive: seenActive.has(childId) })) {
                unresolved.delete(childId)
                status.set(childId, 'settled')
              }
            }
          }
        }
      }

      // ⑤ 最后取一次列表：非空 = 检出子代理（R3 出现），空 = 无子代理（仍是 5 小节）。
      let finalEntries = current
      try {
        const relisted = await readChildren({ ctx, service, parentSessionId: sessionId, signal })
        if (Array.isArray(relisted.entries)) finalEntries = relisted.entries
      } catch {
        // 沿用上一轮列表。
      }
      const skipped = delivered === 0 && continuable.length > 0
      // ARB-18①：一个都没投出去也是"跳过"分支，要让 phase:'skipped' 真的出现在 wire 上。
      if (skipped) emit('skipped')
      return { section: buildSection(finalEntries), interruptedCount, skipped, aborted: false }
    } catch (error) {
      // §11.1.5 最后一道底线：整个 drain 抛任何未捕获异常都必须被吞掉。
      report(`子代理收尾没做成，直接换会话（原因：${messageOf(error)}）`)
      emit('skipped')
      return { section: null, interruptedCount, skipped: true, aborted: false }
    } finally {
      // 收尾结束：发"结束信号"。`skipped` 的驻留由控制器保证（ARB-18②：≥4 秒）。
      try {
        onState?.(null)
      } catch {
        // 忽略。
      }
    }
  }

  // ⓪ ARB-17：总挂钟硬上限 —— 执行体与 watchdog 赛跑。定时器**不 unref**（ARB-17 明确口径）。
  const boundMs = typeof watchdogMs === 'number' && Number.isFinite(watchdogMs) && watchdogMs > 0
    ? watchdogMs
    : timeoutMin * 60_000 + SUBAGENT_POST_INTERRUPT_GRACE_MS
  let watchdogTimer = null
  const watchdog = new Promise((resolve) => {
    watchdogTimer = setTimeout(() => resolve(WATCHDOG), boundMs)
  })
  let outcome
  try {
    outcome = await Promise.race([runDrainBody(), watchdog])
  } finally {
    if (watchdogTimer !== null) clearTimeout(watchdogTimer)
  }
  if (outcome === WATCHDOG) {
    // 内核调用悬挂（prompt / listChildren / observeSession 永不 settle）：按"收尾没做成"放行。
    report(`子代理收尾没做成，直接换会话（原因：收尾整体超时（上限 ${timeoutMin} 分钟 + 15 秒兜底窗口））`)
    emit('skipped')
    return { section: null, interruptedCount: 0, skipped: true, aborted: false }
  }
  return outcome
}

/**
 * 子代理当前是否在跑（决定 prompt 用 `steer` 还是 `queue`）。
 * @param {object} ctx - Cordis 上下文。
 * @param {string} childId - 子会话 id。
 * @returns {boolean} 在跑返回 true。
 */
function childActive(ctx, childId) {
  const sessions = safeGet(ctx, 'sessions')
  if (sessions === undefined || typeof sessions.get !== 'function') return false
  try {
    const session = sessions.get(childId)
    return session !== undefined && session !== null
  } catch {
    return false
  }
}
