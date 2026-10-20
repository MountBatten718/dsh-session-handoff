// 换会话确认卡片（S3）：复用宿主**原生问答弹窗**，不自建组件（NG-1）。
//
// ⚠️ 为什么不是审批弹窗（PK-006）：
// `ctx.userApproval.request()` 有硬性轮次约束（`dsh-user-approval/lib/index.js:128-131`：
// `hasOpenTurn(session)` 为假直接抛错），而我们弹框的时机恰好常在轮次边界 → 必炸。
// `ctx.userQuestions.ask()` 没有任何轮次约束，Web 端还有原生渲染
// （`dsh-client-ui-user-questions`）。plan-mode 就是非工具场景下用它弹框的
// （`dsh-plan-mode/lib/index.js:259-278`），本模块照抄它的调用形状。
//
// ⚠️ `ask()` 自身**没有超时**（`dsh-user-questions/lib/index.js:52-80` 只透传 signal），
// 所以必须自传带超时的 AbortSignal，否则用户不答就会永远挂住这一步（= 会话卡死）。
//
// 本模块不 import 任何 @deepseek-ai/* 包，可纯 Node 单测。

import { buildConfirmQuestion, formatFacts, reduceCardAnswer } from './handoff-health.mjs'
import { HANDOFF_DEFAULTS } from './handoff-config.mjs'

/**
 * 确认卡片的默认超时（毫秒）；配置里可覆盖。
 *
 * ⚠️ P2-23：**唯一来源**是 `handoff-config.mjs` 的 `HANDOFF_DEFAULTS.confirmTimeoutMs`。
 * 以前这里和 config 各写一份两分钟的毫秒字面量，改一处就分叉。这里只做转出，不再自带字面量。
 * （方向无循环依赖：config 不 import 本模块，本模块只 import config 的常量。）
 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = HANDOFF_DEFAULTS.confirmTimeoutMs

/**
 * 超时哨兵（P1-13）：`Promise.race` 用它标识"这一次是硬兜底结算的"。
 * 用 Symbol 而不是对象字面量，避免和宿主真实返回值意外相等。
 */
const TIMED_OUT = Symbol('handoff-confirm-timed-out')

/**
 * 造一个"超时即 abort"的 signal，并监听父 signal。
 *
 * 为什么不用 `AbortSignal.timeout()`：它和父 signal 的合并语义在旧运行时里不一致，
 * 而且我们需要在测试里注入可控定时器，所以自己造（与 `lib/timeout.mjs` 同风格）。
 *
 * @param {{signal?: AbortSignal, timeoutMs?: number, setTimeoutFn?: Function, clearTimeoutFn?: Function}} input - 输入。
 * @returns {{signal: AbortSignal, timedOut: () => boolean, done: () => void}} 结果。
 */
export function createTimedSignal({ signal, timeoutMs, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const controller = new AbortController()
  let timedOut = false
  let timer
  /**
   * 超时 Promise：定时器一到就 resolve。
   *
   * ⚠️ 为什么光有 `AbortSignal` 不够（2026-10-12 代码审查 P1-13）：
   *   `ask()` 只在**进入时**检查 signal aborted（`dsh-user-questions/lib/index.js:669`），
   *   或在其内部抛错时补一次检查（`:688`）。如果对方的 waterfall 既不返回也不抛错，
   *   `await ask(...)` 会**永远挂着** —— 弹窗卡在请求派发之前 = 整条会话线卡死。
   *   所以调用方必须用这个 Promise 做 `Promise.race` 硬兜底，不能只靠 abort。
   * @type {Promise<void>}
   */
  let resolveTimedOut
  const whenTimedOut = new Promise((resolve) => { resolveTimedOut = resolve })
  const onAbort = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeoutFn(() => {
      timedOut = true
      controller.abort(new Error('handoff confirm timed out'))
      resolveTimedOut()
    }, timeoutMs)
    // ⚠️ **刻意不 `timer.unref()`**（2026-10-12 独立复核 P2-5）：
    //    unref 的定时器在"没有其它活跃句柄"的进程里根本不会触发 —— 那样 P1-13 的硬兜底
    //    在 headless / CLI / 退出流程里就形同虚设（子进程会以 unsettled top-level await 直接退出）。
    //    代价：极端情况下这个定时器最多让进程多活一个 confirmTimeoutMs；
    //    正常路径会在 `done()` 里 clearTimeout，不会长期驻留。
  }
  return {
    signal: controller.signal,
    whenTimedOut,
    timedOut: () => timedOut,
    done: () => {
      if (timer !== undefined) clearTimeoutFn(timer)
      if (signal !== undefined) signal.removeEventListener?.('abort', onAbort)
      // 正常路径收尾时把兜底 Promise 一并结算，避免留下悬挂的 Promise。
      resolveTimedOut()
    },
  }
}

/**
 * 弹一次确认卡片，把结果归一化为动作。
 *
 * @param {object} input - 输入。
 * @param {object} input.userQuestions - `ctx.get('userQuestions')`。
 * @param {object} input.health - 健康度（S3 的"事实行"要用）。
 * @param {number} [input.chainIndex] - 本链第几棒。
 * @param {string} [input.reasonLabel] - 触发原因（人话）。
 * @param {string} [input.detail] - 交接文档预览（可展开区块）。
 * @param {AbortSignal} [input.signal] - 父 signal（agent/pre-step 的 signal）。
 * @param {number} [input.timeoutMs] - 超时。
 * @param {object} [input.agent] - 顶层 agent（可选；传了必须是 live 的 runtime root）。
 * @param {Function} [input.setTimeoutFn] - 测试注入。
 * @param {Function} [input.clearTimeoutFn] - 测试注入。
 * @returns {Promise<{action: 'handoff'|'always-auto'|'cancel', reason: string}>} 归一化动作。
 */
export async function askForHandoff(input) {
  const { userQuestions, health } = input
  if (userQuestions === undefined || typeof userQuestions.ask !== 'function') {
    // 没有问答通道（headless / TUI 未挂载）→ 按"先不换"处理，绝不静默换会话。
    return { action: 'cancel', reason: 'no-question-channel' }
  }

  const timed = createTimedSignal({
    signal: input.signal,
    timeoutMs: Number.isFinite(input.timeoutMs) ? input.timeoutMs : DEFAULT_CONFIRM_TIMEOUT_MS,
    setTimeoutFn: input.setTimeoutFn,
    clearTimeoutFn: input.clearTimeoutFn,
  })

  const question = buildConfirmQuestion({
    reason: input.reasonLabel ?? '到点了',
    facts: formatFacts({ health, chainIndex: input.chainIndex, thresholdLabel: input.reasonLabel }),
    detail: input.detail,
  })

  try {
    const askPromise = userQuestions.ask({
      questions: [question],
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      signal: timed.signal,
    })
    // 超时硬兜底后，宿主大概率还会以 ASK_ABORTED 拒绝这个 Promise。
    // 提前挂一个空 handler，避免它变成 unhandled rejection（结果已由 race 结算）。
    askPromise.catch(() => undefined)
    const answer = await Promise.race([
      askPromise,
      // ⚠️ 硬兜底（P1-13）：不依赖对方响应 signal，到了点就自己结算。
      timed.whenTimedOut.then(() => TIMED_OUT),
    ])
    if (answer === TIMED_OUT) return { action: 'cancel', reason: 'timeout' }
    const item = Array.isArray(answer?.answers)
      ? answer.answers.find((entry) => entry?.id === question.id) ?? answer.answers[0]
      : undefined
    const selected = Array.isArray(item?.selected) ? item.selected : []
    const custom = typeof item?.custom === 'string' ? item.custom : undefined
    const label = selected.length === 1 ? selected[0] : undefined
    // ⚠️ 不要按 `question.options` 的**下标**去比对（2026-10-12 审查 P2-24）：
    //    那是同一套标签映射的第二份实现，改标签或调选项顺序时两处会漂移。
    //    统一交给 `reduceCardAnswer` —— 它按 `CARD_LABELS` 判定，是唯一权威。
    return reduceCardAnswer({ kind: 'unanswered', label, custom })
  } catch (error) {
    if (timed.timedOut()) return { action: 'cancel', reason: 'timeout' }
    const code = error?.code
    if (code === 'ASK_CANCELLED' || code === 'ASK_ABORTED') return { action: 'cancel', reason: 'cancelled' }
    return { action: 'cancel', reason: `error:${String(error?.message ?? error)}` }
  } finally {
    timed.done()
  }
}
