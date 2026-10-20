// 客户端半区的**纯**辅助：DTO → 视图模型、颜色/文案、进度条几何、远程调用归一化。
// 这一层不碰 React、不碰 DOM、不碰 ctx，因此可以脱离浏览器用纯 Node 单元测试。
//
// 三色、N 轮、明细表、确认卡片状态机全部直接 import `lib/handoff-health.mjs`
// （宿主与客户端**共用同一份纯计算**，两侧永远不会漂移）。

import {
  WARN_FACTOR,
  computeHealth,
  conclusionOf,
  detailRows,
  estimateTurnsLeft,
  formatBytes,
  formatCount,
  formatPercent,
  levelFor,
} from '../../lib/handoff-health.mjs'
import type { Conclusion, DetailRow, Health } from '../../lib/handoff-health.mjs'
// 默认值与取值范围从宿主配置模块取（**同一来源**）：设置页的输入范围和校验口径
// 不能和宿主两处各写一份，否则改一处就会出现"前端放过、宿主拒收"的错位。
import { HANDOFF_DEFAULTS, HANDOFF_LIMITS } from '../../lib/handoff-config.mjs'
// R4（2026-10-17）：卡片的逐字文案与限长与宿主**同一份**（清单 §3.7：文案统一放常量）。
import { R4_TEXTS, MAX_NOTE_CHARS } from '../../lib/constants.mjs'

export { formatBytes, formatCount, formatPercent }

/** 宿主 `stats` 一行里本层真正读到的字段（wire 上的可空数字按 `null` 建模）。 */
export interface HealthRowLike {
  sessionId?: string | null
  mode?: 'replace' | 'hybrid' | 'native'
  usedTokens?: number | null
  windowTokens?: number | null
  nativeThresholdTokens?: number | null
  sessionBytes?: number | null
  sessionVolumeLimitBytes?: number | null
  perTurnTokens?: number | null
  perTurnBytes?: number | null
  chainIndex?: number | null
  compactionsSinceHandoff?: number | null
  compactionCountTrigger?: number | null
  messageCount?: number | null
  eventCount?: number | null
  safePoint?: boolean
  handedOff?: boolean
  /** R6（2026-10-20 止血）：子代理会话标记由宿主 RPC 透出（客户端不自己猜）。 */
  subagent?: boolean
}

/**
 * P2-7：从 `stats.rows` 里挑出**当前会话自己**的那一行。
 *
 * ⚠️ 只认**精确匹配**：`sessionId` 为空（健康度行挂载早期，宿主还没把会话 id 注进来）时
 * 返回 `undefined`——**绝不能**退回 `rows[0]`。
 * 原因：`useStats(ctx, [])` 时宿主会把**所有 live 会话**都返回，`rows[0]` 是别人的会话，
 * 界面就会把别的会话的用量/体积当成当前会话显示（2026-10-12 代码审查 P2-7）。
 *
 * @param rows - `stats.rows`（可空）。
 * @param sessionId - 当前会话 id（可能为空）。
 * @returns 精确命中的那一行；匹配不到返回 `undefined`。
 */
export function pickRowForSession<T extends HealthRowLike>(
  rows: readonly T[] | null | undefined,
  sessionId: string | null | undefined,
): T | undefined {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  if (rows === null || rows === undefined) return undefined
  for (const row of rows) {
    if (row?.sessionId === sessionId) return row
  }
  return undefined
}

/** DTO → 健康度行视图模型（渲染层只认这个）。 */
export interface HealthViewModel {
  sessionId: string
  chainIndex: number
  mode: 'replace' | 'hybrid' | 'native'
  level: string
  levelToken: 'ok' | 'warn' | 'danger'
  levelLabel: string
  conclusion: Conclusion
  context: {
    text: string
    ratio: number | undefined
    fill: number | undefined
    marker: number | undefined
    usedTokens: number | null | undefined
    windowTokens: number | null | undefined
  }
  volume: {
    text: string
    ratio: number | undefined
    fill: number
    marker: number | undefined
    bytes: number | null | undefined
    limitBytes: number | null | undefined
  }
  safePoint: boolean
  handedOff: boolean
  detail: DetailRow[]
}

/**
 * 数值守卫：语义与 `Number.isFinite(value)` 相同，但能把类型收窄成 `number`。
 * @param value - 任意值。
 * @returns 是否是可用的有限数字。
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 颜色 → 视觉令牌（**不写任何色值**，只给类名/令牌名，颜色由 CSS 变量决定）。 */
export const LEVEL_TOKEN = Object.freeze({
  green: 'ok',
  warning: 'warn',
  danger: 'danger',
})

/** 颜色 → 文案（无障碍标签用）。 */
export const LEVEL_LABEL = Object.freeze({
  green: '健康',
  warning: '接近阈值',
  danger: '已到阈值',
})

/**
 * 由 host DTO 重算健康度（**与宿主同一份纯函数**）。
 * @param dto - `stats` 返回的一行。
 * @returns `computeHealth` 的结果。
 */
export function healthFromDto(dto: HealthRowLike): Health {
  return computeHealth({
    mode: dto?.mode,
    usedTokens: dto?.usedTokens,
    windowTokens: dto?.windowTokens,
    nativeThresholdTokens: dto?.nativeThresholdTokens,
    replaceSafetyFactor: undefined,
    sessionBytes: dto?.sessionBytes,
    sessionVolumeLimitBytes: dto?.sessionVolumeLimitBytes,
  })
}

/**
 * DTO → 健康度行视图模型（渲染层只认这个）。
 *
 * @param dto - `stats` 返回的一行。
 * @returns 视图模型。
 */
export function viewModelOf(dto: HealthRowLike): HealthViewModel {
  const health = healthFromDto(dto)
  const turnsLeft = estimateTurnsLeft({
    health,
    perTurnTokens: dto?.perTurnTokens,
    perTurnBytes: dto?.perTurnBytes,
  })
  const conclusion = conclusionOf({ health, turnsLeft })
  return {
    sessionId: dto?.sessionId ?? '',
    chainIndex: isFiniteNumber(dto.chainIndex) ? dto.chainIndex : 1,
    mode: dto?.mode ?? 'hybrid',
    level: health.level,
    levelToken: LEVEL_TOKEN[health.level] ?? 'ok',
    levelLabel: health.measured === false ? '读不到用量' : (LEVEL_LABEL[health.level] ?? '健康'),
    conclusion,
    context: {
      // 百分比文案（设计文档：左侧「上下文 68%」）
      text: formatPercent(health.context.ratio),
      ratio: health.context.ratio,
      // ⚠️ 只有替代模式才给上下文画条：
      //    混合/原生模式下上下文"归原生压缩管"，画一条**没有任何刻度**的进度条会让人
      //    以为 100% 就是危险线（其实不是），违反"知道了也没法处置的信息＝噪音"这条设计原则。
      //    所以这两种模式下只显示百分比数字，不给条。
      fill: health.context.showMarker ? clamp01(health.context.ratio) : undefined,
      // 阈值刻度线的位置（只有替代模式才画；混合模式按规格不画）
      marker: health.context.showMarker && Number.isFinite(health.context.limitRatio)
        ? clamp01(health.context.limitRatio)
        : undefined,
      usedTokens: dto?.usedTokens,
      windowTokens: dto?.windowTokens,
    },
    volume: {
      text: formatBytes(health.volume.bytes),
      ratio: health.volume.ratio,
      fill: clamp01(health.volume.ratio),
      // 体积条的阈值刻度线在 100% 处（条本身就是按"到线即满"画的）；
      // 没有阈值（配置缺失）就不画刻度。
      marker: health.volume.limitBytes === undefined ? undefined : 1,
      bytes: dto?.sessionBytes,
      limitBytes: dto?.sessionVolumeLimitBytes,
    },
    safePoint: dto?.safePoint === true,
    handedOff: dto?.handedOff === true,
    detail: detailRows({
      health,
      compactionsSinceHandoff: dto?.compactionsSinceHandoff,
      compactionCountTrigger: dto?.compactionCountTrigger,
      messageCount: dto?.messageCount,
      eventCount: dto?.eventCount,
    }).rows,
  }
}

/**
 * 把比例钳到 [0,1]（脏数据不该把进度条拉出容器）。
 * @param {number|undefined} value - 比例。
 * @returns {number} 钳后的比例。
 */
export function clamp01(value: number | undefined): number {
  if (!isFiniteNumber(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * 健康度行的无障碍文本（屏幕阅读器用；视觉文案另有一套）。
 * @param {object} model - 视图模型。
 * @returns {string} 文本。
 */
export function ariaSummary(model: HealthViewModel): string {
  const parts = [`上下文占用 ${model.context.text}`]
  parts.push(`会话体积 ${model.volume.text}`)
  parts.push(`状态：${model.levelLabel}`)
  if (model.conclusion?.text !== undefined) parts.push(model.conclusion.text)
  return parts.join('，')
}

/**
 * 把 `remote.sessionHandoff.*` 的返回值折成"要么数据、要么错误"。
 *
 * ⚠️ 网关的返回形状是 `{ ok: true, value }` 或 `{ ok: false, error }`
 * （证据：`dsh-cost-meter/lib/client.js` 里 `Z.ok !== !0` 那段判定的用法）。
 *
 * @param result - 远程调用结果。
 * @returns {{ok: true, value: unknown}|{ok: false, error: string}} 归一化结果。
 */
export function unwrapRemote(result: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (result === null || typeof result !== 'object') {
    return { ok: false, error: 'RPC 没有返回结果（宿主半边可能没挂上）' }
  }
  const shaped = result as { ok?: unknown; value?: unknown; error?: unknown }
  if (shaped.ok === true) return { ok: true, value: shaped.value }
  const message = (shaped.error as { message?: unknown } | undefined)?.message ?? shaped.error ?? 'unknown error'
  return { ok: false, error: String(message) }
}

/**
 * 字节 → MB 数字（设置页输入框用）。
 * @param {number|undefined} bytes - 字节。
 * @returns {number} MB（保留一位小数）。
 */
export function bytesToMb(bytes: number | null | undefined): number {
  if (!isFiniteNumber(bytes)) return 20
  return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

/**
 * 「再涨多少才重问」的草稿值（`askRearmPercent`）。
 *
 * ⚠️ **必须兜底**（2026-10-12 真机反馈）：宿主版本比客户端旧时（刚升级、宿主还没重载），
 * 这个**新字段会缺席**，`String(undefined)` 得到 `"undefined"`；而 `<input type="number">`
 * 不接受非数字值 ⇒ 输入框显示成**空框**，用户输入保存后看到"内容消失"。
 * 回落到配置模块里的默认值即可，界面上永远是个能编辑的合法数字。
 *
 * @param config - 宿主 config（可能缺该字段）。
 * @returns 草稿字符串。
 */
export function rearmDraftOf(config: { askRearmPercent?: number | null } | undefined): string {
  const raw = config?.askRearmPercent
  return typeof raw === 'number' && Number.isFinite(raw)
    ? String(raw)
    : String(HANDOFF_DEFAULTS.askRearmPercent)
}

/**
 * R2「等子代理交卷的最长时间」的草稿值（`subagentDrainTimeoutMin`）。
 *
 * 与 `rearmDraftOf` 同款兜底：宿主版本较旧 / 字段缺席时回落**同一份**默认值
 * （`HANDOFF_DEFAULTS`），绝不能给输入框塞 `"undefined"`。
 *
 * @param config - 宿主 config（可能缺该字段）。
 * @returns 草稿字符串。
 */
export function drainDraftOf(config: { subagentDrainTimeoutMin?: number | null } | undefined): string {
  const raw = config?.subagentDrainTimeoutMin
  return typeof raw === 'number' && Number.isFinite(raw)
    ? String(raw)
    : String(HANDOFF_DEFAULTS.subagentDrainTimeoutMin)
}

/**
 * R2 子代理收尾的运行期状态（ARB-13 的 wire 形状）。
 *
 * `null` = 没有进行中的收尾（与 v1.1 表现完全一致，不渲染任何新元素）。
 */
export interface DrainState {
  phase: 'waiting' | 'interrupted' | 'skipped'
  waitedSec: number
  timeoutMin: number
  interruptedCount: number
}

/**
 * 把 `drain.phase` 逐字渲染成三条运行期文案（M2 §10.3，文案不许改写）。
 *
 * @param drain - `stats().drain`（可空）。
 * @returns 要显示的文案；`null` / 未知 phase 返回 undefined（不渲染）。
 */
export function drainBannerTextOf(drain: DrainState | null | undefined): string | undefined {
  if (drain === null || drain === undefined || typeof drain !== 'object') return undefined
  if (drain.phase === 'waiting') {
    return `等子代理交卷（已等 ${drain.waitedSec} 秒，最多 ${drain.timeoutMin} 分钟）…`
  }
  if (drain.phase === 'interrupted') {
    return `已打断 ${drain.interruptedCount} 个子代理，等它们写完文档`
  }
  if (drain.phase === 'skipped') {
    return '子代理收尾没做成，直接换会话'
  }
  return undefined
}

/**
 * `drain` 文案的本地显示 latch 时长（P1-3，2026-10-14）。
 *
 * ⚠️ **为什么要有 latch**：host 侧 `skipped` 在 wire 上只驻留 4000ms（ARB-18②），
 * 而客户端是**定时轮询**（正常 3s，失败退避 6s…60s，页面 hidden 60s）。
 * 若不做 latch，跳过状态刚好落在两次轮询之间时，第三条文案一次都不渲染。
 * 3.5s ≥ 契约要求的"至少停留 3 秒"，且略短于 host 的 4s 窗口。
 */
export const DRAIN_LATCH_MS = 3500

/** drain 文案的显示状态（本地 latch）。 */
export interface DrainLatchState {
  /** 当前要渲染的状态；`null` = 不渲染。 */
  value: DrainState | null
  /** latch 到期时刻（毫秒时间戳）；`value === null` 时无意义。 */
  until: number
}

/** 初始 latch（从未收到过 drain）。 */
export const EMPTY_DRAIN_LATCH: DrainLatchState = Object.freeze({ value: null, until: 0 })

/**
 * 吸收一次 `stats().drain`，推进本地显示 latch（P1-3 的纯状态机，便于单测）。
 *
 * 规则：
 *   1) 收到**已知 phase** 的非空 drain ⇒ 立刻显示，并把驻留下限续到 `now + DRAIN_LATCH_MS`；
 *   2) 收到 `null` / 缺席 / 未知 phase ⇒ 只要驻留下限没到就**继续显示旧文案**；
 *   3) 到点后才允许清空。
 *
 * @param input - 输入。
 * @param input.previous - 上一份 latch 状态。
 * @param input.incoming - 本次 `stats().drain`。
 * @param input.now - 当前时刻（毫秒；测试注入假时钟）。
 * @returns 新的 latch 状态（无变化时原样返回 `previous`）。
 */
export function latchDrain(input: {
  previous: DrainLatchState
  incoming: DrainState | null | undefined
  now: number
}): DrainLatchState {
  const { previous, incoming, now } = input
  // 只 latch「能真正渲染出文案」的状态（未知 phase 当没收到，避免 latch 住一段空白）。
  if (drainBannerTextOf(incoming) !== undefined) {
    return { value: incoming as DrainState, until: now + DRAIN_LATCH_MS }
  }
  if (previous.value !== null && now < previous.until) return previous
  return previous.value === null ? previous : EMPTY_DRAIN_LATCH
}

/**
 * MB 数字 → 字节（设置页提交用）。
 * @param {number|string} mb - MB。
 * @returns {number} 字节。
 */
export function mbToBytes(mb: number | string): number {
  const value = typeof mb === 'string' ? Number(mb) : mb
  if (!isFiniteNumber(value) || value <= 0) return 0
  return Math.round(value * 1024 * 1024)
}

/** 一张模式卡的形状（`index.ts` 那边 `card.id` / `card.warning` 靠它拿到准确类型）。 */
export interface ModeCard {
  id: 'replace' | 'hybrid' | 'native'
  title: string
  description: string
  when: string
  warning: string | undefined
  recommended: boolean
}

/**
 * 三张模式卡的定义（S1 的"模式三选一"，文案照设计文档 §一 S1）。
 * 书面用语 + 一句"什么时候会换会话"。
 */
export const MODE_CARDS: ReadonlyArray<ModeCard> = Object.freeze([
  {
    id: 'replace',
    title: '替代模式',
    description: '达到原生上下文压缩的生效阈值时，直接执行会话切换，完全替代原生上下文压缩。',
    when: '什么时候会换会话：上下文涨到原生压缩生效线的 98%。',
    warning: '需关闭原生自动压缩，否则切换可能无法触发（可行性待真机验证）',
    recommended: false,
  },
  {
    id: 'hybrid',
    title: '混合模式',
    description: '上下文水位交由原生压缩处理；仅当会话负载超出设定阈值时执行会话切换。',
    when: '什么时候会换会话：会话体积超线，或压缩次数到修正线。',
    warning: undefined,
    recommended: true,
  },
  {
    id: 'native',
    title: '原生模式',
    description: '完全沿用原生上下文管理，不执行任何自动会话切换。',
    when: '什么时候会换会话：不会自动换（你仍然可以点「换会话」）。',
    warning: undefined,
    recommended: false,
  },
])

/** 一个自动程度选项（`Segmented` 的泛型靠 `id` 收窄成 union）。 */
export interface PromptLevelOption {
  id: 'notify' | 'confirm' | 'auto'
  label: string
  description: string
}

/** 自动程度三选一（S1 的"该换会话的时候怎么做"）。 */
export const PROMPT_LEVELS: ReadonlyArray<PromptLevelOption> = Object.freeze([
  { id: 'notify', label: '只提醒', description: '到点在会话里给一句提示，换不换你自己点。' },
  { id: 'confirm', label: '弹窗确认', description: '到点用宿主原生弹窗问你一句（默认）。' },
  { id: 'auto', label: '全自动', description: '到点直接换，不打扰你。' },
])

/** 设置页草稿（体积以 MB 计，输入框给的是字符串）。 */
export interface ConfigDraft {
  enabled?: boolean
  autoMode?: 'replace' | 'hybrid' | 'native'
  autoPromptLevel?: 'notify' | 'confirm' | 'auto'
  sessionVolumeMb?: number | string
  compactionTrigger?: number | string | null
  /** 「先不接力」后再涨多少个百分点才重问（整数百分比）。 */
  askRearmPercent?: number | string
  /** R2：换会话前等子代理交卷的最长时间（分钟）。 */
  subagentDrainTimeoutMin?: number | string
  handoffDocPersist?: boolean
  decisionLogEnabled?: boolean
}

// ─────────────── 设置页草稿同步（P2-8：draft 要跟宿主走，失败要回滚） ───────────────

/**
 * 两个配置对象是否"同一份"（逐键浅比较，键集合也要一致）。
 * 值都是标量，浅比较足够；用来避免每 3 秒一次轮询都拿新对象触发无意义的重渲染。
 *
 * @param a - 任意值。
 * @param b - 任意值。
 * @returns 是否相等。
 */
export function sameConfig(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

/** P2-8：一次成功保存后用来识别"宿主回声"的记账。 */
export interface PendingSave<T> {
  /** 保存**前**宿主的那份 config：stats 里的旧回声长这样，要丢弃。 */
  before: T
  /** 宿主已经接受的那份 config：stats 追上了才会长这样。 */
  after: T
}

/** P2-8：草稿同步决策。 */
export interface DraftSyncDecision {
  /** 是否用宿主当前 config 刷新草稿。 */
  sync: boolean
  /** 是否结束"等宿主回声"状态。 */
  clearPending: boolean
}

/**
 * P2-8：给定宿主 config + 界面草稿 + dirty（用户是否在编辑）+ 等回声状态，
 * 算出"要不要用宿主值刷新草稿"。纯函数，好测。
 *
 * 规则：
 * 1. 宿主还没有 config（`undefined`）⇒ 什么都不动；
 * 2. 正在等一次成功保存的回声时：
 *    · stats 还是**保存前**那份 ⇒ 旧回声，丢弃、继续等（否则刚保存的开关会被顶回去）；
 *    · 其它情况 ⇒ 回声到了（或宿主已有更新的值），结束等待，然后按 dirty 规则处理；
 * 3. `dirty === true`（用户有未落盘的改动）⇒ 不用宿主值覆盖草稿；
 * 4. 否则：宿主值和草稿不同才刷新（相同就不 setState，避免每轮轮询都重渲染）。
 *
 * @param input - 决策输入。
 * @returns 决策结果。
 */
export function draftSyncDecision<T>(input: {
  host: T | undefined
  draft: T | undefined
  dirty: boolean
  pending?: PendingSave<T> | undefined
  equals?: (a: T | undefined, b: T | undefined) => boolean
}): DraftSyncDecision {
  const equals = input.equals ?? ((a: T | undefined, b: T | undefined) => sameConfig(a, b))
  const { host, draft, dirty, pending } = input
  if (host === undefined) return { sync: false, clearPending: false }
  if (pending !== undefined) {
    // 旧回声（保存前那份）——丢弃，接着等宿主追上。
    if (equals(host, pending.before)) return { sync: false, clearPending: false }
    if (dirty) return { sync: false, clearPending: true }
    return { sync: !equals(draft, host), clearPending: true }
  }
  if (dirty) return { sync: false, clearPending: false }
  return { sync: !equals(draft, host), clearPending: false }
}

// ─────────────── 轮询节奏（P2-9：一次抛错也不能让轮询停摆） ───────────────

/** 健康度行刷新间隔（毫秒）。健康度是"看着它慢慢涨"的东西，3 秒足够且不吵。 */
export const HEALTH_POLL_MS = 3000

/** 出错后的退避上限（毫秒）。 */
export const HEALTH_BACKOFF_MAX_MS = 60 * 1000

/**
 * "等数据"阶段的**快轮询**间隔（毫秒）。
 *
 * 为什么需要：老会话刚点开时，宿主那侧还没把它注册进来，第一次请求拿到的是一张**空列表**
 * —— 那既不是错误、也没有数据。用常规的 3 秒间隔，用户会以为坏了（界面上只有一句
 * "正在读取会话用量…"和一个「重试」按钮），往往等不及就手点重试。
 * 改成 600 毫秒快轮询后，界面会在用户察觉之前自己出现。
 */
export const HEALTH_WARMUP_MS = 600

/** 快轮询最多连跑多少次（≈ 7 秒），之后回落到常规间隔，避免对着一个永远拿不到的会话高频空转。 */
export const HEALTH_WARMUP_MAX_TRIES = 12

/** 一次 tick 的四种结局（成功 / 还在等当前会话的数据 / 业务失败 / 调用本身抛错）。 */
export type PollOutcome = 'ok' | 'warming' | 'fail' | 'throw'

/**
 * P2-9：一次 tick 之后"下一跳怎么排"的纯决策。
 *
 * ⚠️ 关键点：**四种结局都必须给出下一次的延时**（这里没有任何"停止"分支）。
 * 原实现写 `void tick().then(schedule)`：tick 抛错 ⇒ `schedule()` 永不执行 ⇒
 * 轮询静默死掉、界面数字冻结（2026-10-12 代码审查 P2-9）。
 * `throw` 与 `fail` 一样走退避加倍，页面隐藏时统一用长间隔。
 *
 * `warming`（当前会话还没有数据）**不进退避**：它不是错误，退避只会让界面更晚出现。
 *
 * @param input - 本次结局 / 当前退避 / 页面是否隐藏 / 已经快轮询过几次。
 * @returns 下一次延时、新的退避值与快轮询计数。
 */
export function nextPollStep(input: {
  outcome: PollOutcome
  backoffMs: number
  hidden: boolean
  warmupTried?: number
}): {
  delayMs: number
  backoffMs: number
  warmupTried: number
} {
  const rawTried = input.warmupTried
  const tried = typeof rawTried === 'number' && Number.isFinite(rawTried) && rawTried > 0 ? Math.trunc(rawTried) : 0

  if (input.outcome === 'warming') {
    if (!input.hidden && tried < HEALTH_WARMUP_MAX_TRIES) {
      return { delayMs: HEALTH_WARMUP_MS, backoffMs: HEALTH_POLL_MS, warmupTried: tried + 1 }
    }
    // 试够了还没数据：回落到常规间隔（仍然不退避，界面继续正常显示"正在读取…"）。
    return { delayMs: input.hidden ? HEALTH_BACKOFF_MAX_MS : HEALTH_POLL_MS, backoffMs: HEALTH_POLL_MS, warmupTried: 0 }
  }

  const backoffMs = input.outcome === 'ok'
    ? HEALTH_POLL_MS
    : Math.min(input.backoffMs * 2, HEALTH_BACKOFF_MAX_MS)
  const delayMs = input.hidden ? HEALTH_BACKOFF_MAX_MS : backoffMs
  return { delayMs, backoffMs, warmupTried: 0 }
}

/**
 * P2-9：代次守卫——本次 tick 所属的代次不是最新代次时，响应已过期，必须丢弃。
 *
 * @param myEpoch - 本次 tick 开始时记下的代次。
 * @param currentEpoch - 当前最新代次。
 * @returns 是否过期。
 */
export function isStaleEpoch(myEpoch: number, currentEpoch: number): boolean {
  return myEpoch !== currentEpoch
}

/** 校验通过后交给 `remote.updateConfig` 的 patch（键名与宿主入参一致）。 */
export interface ConfigPatch {
  enabled: boolean
  autoMode: 'replace' | 'hybrid' | 'native' | undefined
  sessionVolumeBytes: number
  compactionCountTrigger: number | null
  autoPromptLevel: 'notify' | 'confirm' | 'auto' | undefined
  askRearmPercent: number
  /** R2：换会话前等子代理交卷的最长时间（分钟，1–60 的整数）。 */
  subagentDrainTimeoutMin: number
  handoffDocPersist: boolean
  decisionLogEnabled: boolean
}

/**
 * 校验设置页的一次提交（**前端先挡一道**，宿主还会再挡一道）。
 * @param draft - 草稿（MB 单位）。
 * @returns {{ok: boolean, patch?: ConfigPatch, error?: string}} 结果。
 */
export function buildConfigPatch(draft: ConfigDraft): { ok: boolean; patch?: ConfigPatch; error?: string } {
  const mb = typeof draft?.sessionVolumeMb === 'string' ? Number(draft.sessionVolumeMb) : draft?.sessionVolumeMb
  if (!isFiniteNumber(mb) || mb <= 0) {
    return { ok: false, error: '会话体积阈值要填一个大于 0 的数字（单位 MB）' }
  }
  const bytes = mbToBytes(mb)
  if (bytes < 1024 * 1024 || bytes > 512 * 1024 * 1024) {
    return { ok: false, error: '会话体积阈值要在 1 MB ~ 512 MB 之间' }
  }
  const triggerRaw = draft?.compactionTrigger
  let trigger: number | null = null
  if (triggerRaw !== '' && triggerRaw !== null && triggerRaw !== undefined) {
    const parsed = typeof triggerRaw === 'string' ? Number(triggerRaw) : triggerRaw
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return { ok: false, error: '「每压缩 N 次后执行硬切」要填 1 ~ 100 的整数，或者留空表示不启用' }
    }
    trigger = parsed
  }
  // 「先不接力」后再涨多少才重问：留空 = 用默认值；填了必须在配置模块给的范围内。  // 范围与默认值都从 `HANDOFF_LIMITS` / `HANDOFF_DEFAULTS` 取（与宿主同一来源）。
  const rearmRaw = draft?.askRearmPercent
  const rearmText = rearmRaw === undefined || rearmRaw === null || rearmRaw === ''
    ? String(HANDOFF_DEFAULTS.askRearmPercent)
    : String(rearmRaw)
  const rearm = Number(rearmText)
  if (!Number.isInteger(rearm)
    || rearm < HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT
    || rearm > HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT) {
    return {
      ok: false,
      error: `「再涨多少才重问」要填 ${HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT} ~ ${HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT} 的整数（百分比）`,
    }
  }
  // R2「换会话前，等子代理交卷的最长时间」：留空 = 用默认值；填了必须是 1–60 的整数（分钟）。
  // 界面错误文案**冻结**为 ARB-6 的逐字口径（产品文档只写"给出人话"，以本句为准）。
  const drainRaw = draft?.subagentDrainTimeoutMin
  const drainText = drainRaw === undefined || drainRaw === null || drainRaw === ''
    ? String(HANDOFF_DEFAULTS.subagentDrainTimeoutMin)
    : String(drainRaw)
  const drainMin = Number(drainText)
  if (!Number.isInteger(drainMin)
    || drainMin < HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN
    || drainMin > HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN) {
    return { ok: false, error: '请输入 1–60 之间的整数（分钟）' }
  }
  const patch: ConfigPatch = {
    enabled: draft?.enabled !== false,
    autoMode: draft?.autoMode,
    sessionVolumeBytes: bytes,
    compactionCountTrigger: trigger,
    autoPromptLevel: draft?.autoPromptLevel,
    askRearmPercent: rearm,
    // R2：等子代理交卷的最长时间（分钟）——越界文案冻结为 ARB-6 的逐字口径。
    subagentDrainTimeoutMin: drainMin,
    // 交接文档区：落盘开关（本轮不做"存目录自定义"，目录由宿主按 DSH 数据目录给）
    handoffDocPersist: draft?.handoffDocPersist !== false,
    decisionLogEnabled: draft?.decisionLogEnabled !== false,
  }
  return { ok: true, patch }
}

// ───────────── S1「新会话用什么样的」：模型 / 推理强度 / 工作权限（纯函数） ─────────────
//
// 本区照《汇总原型图.html》2026-10-12 新增的卡片 1:1 实现：三项下拉，第一项统一是
// 「跟随原会话」；选中项变化时**只把变化的键**送宿主（全跟随 = 一个键都不送，
// 这样"默认什么都不改"时的行为与没有这个区之前**完全一致**）。

/** 「跟随原会话」在下拉里的取值（与原型 option value 一致）。 */
export const FOLLOW_VALUE = 'follow'

/** 危险权限档位 id（选中时先弹确认，确认了才落地）。 */
export const DANGER_PERMISSION = 'danger-full-access'

/**
 * 权限档位 id → 中文名（内置映射，来源：DSH 官方权限 UI 的 i18n）。
 * 未知 id 一律用宿主给的 `name` 兜底（见 `permissionPresetLabel`）。
 */
export const PERMISSION_PRESET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'read-only': '仅可查看',
  'workspace-write': '工作区内修改',
  'danger-full-access': '完全权限',
})

/**
 * 权限档位的中文名：内置映射优先，未知 id 用宿主给的 name 兜底。
 * @param id - 档位 id。
 * @param fallbackName - 宿主给的显示名。
 * @returns 中文名（绝不返回空串）。
 */
export function permissionPresetLabel(id: unknown, fallbackName?: unknown): string {
  const key = typeof id === 'string' ? id : ''
  const known = PERMISSION_PRESET_LABELS[key]
  if (known !== undefined) return known
  if (typeof fallbackName === 'string' && fallbackName.length > 0) return fallbackName
  return key.length > 0 ? key : '未知档位'
}

/** 模型目录里一个模型（`efforts` 是它的推理强度档位）。 */
export interface CatalogModelLike {
  id?: string
  name?: string
  efforts?: Array<{ id?: string; name?: string }>
  defaultEffort?: string
}

/** 模型目录里的一个供应商分组。 */
export interface CatalogGroupLike {
  id?: string
  name?: string
  models?: CatalogModelLike[]
}

/** `remote.listModelCatalog()` 的返回体（宿主契约）。 */
export interface ModelCatalogLike {
  default?: { provider?: string; model?: string; reasoningEffort?: string }
  groups?: CatalogGroupLike[]
  failures?: Array<{ id?: string; name?: string; message?: string }>
  /** 空目录时宿主给的**诊断**（带数字）：让"一个模型都没有"能说出为什么。 */
  diagnosis?: string
}

/** `remote.listPermissionPresets()` 的返回体（宿主契约）。 */
export interface PermissionPresetsLike {
  supported?: boolean
  reason?: string
  presets?: Array<{ id?: string; name?: string }>
  /** 可选：宿主若愿意多给一个"当前会话"的档位，第一项就能显示成「跟随原会话（完全权限）」。 */
  current?: string
}

/** 一个 `<option>`。 */
export interface SelectOption {
  value: string
  label: string
  /** true = 看得见但选不了（原型：模型选「跟随原会话」时自定义档位禁用）。 */
  disabled?: boolean
}

/** 一个 `<optgroup>`。 */
export interface SelectOptionGroup {
  label: string
  options: SelectOption[]
}

/** 模型下拉的选项模型。 */
export interface ModelOptions {
  /** 第一项：跟随原会话（当前模型的显示名）。 */
  follow: SelectOption
  groups: SelectOptionGroup[]
  /** 目录里没有、但配置里写着的那个模型（兜底显示，别让下拉变空）。 */
  extra: SelectOption[]
  /** 目录**局部**失败的人话（界面必须能看出原因，不许静默变空）。 */
  hints: string[]
}

/**
 * 在模型目录里找一个模型。
 * @param catalog - 目录。
 * @param provider - 供应商 id。
 * @param model - 模型 id。
 * @returns 模型条目或 undefined。
 */
function findCatalogModel(catalog: ModelCatalogLike | undefined, provider?: unknown, model?: unknown): CatalogModelLike | undefined {
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined
  for (const group of catalog?.groups ?? []) {
    if (group?.id !== provider) continue
    for (const entry of group.models ?? []) {
      if (entry?.id === model) return entry
    }
  }
  return undefined
}

/**
 * 模型显示名（目录里查不到就退化成 model id）。
 * @param catalog - 目录。
 * @param provider - 供应商 id。
 * @param model - 模型 id。
 * @returns 显示名或 undefined。
 */
export function modelDisplayName(catalog: ModelCatalogLike | undefined, provider?: unknown, model?: unknown): string | undefined {
  const entry = findCatalogModel(catalog, provider, model)
  if (entry !== undefined) {
    if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name
    if (typeof entry.id === 'string' && entry.id.length > 0) return entry.id
  }
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

/**
 * 第一项「跟随原会话」的文案（原型：`跟随原会话（DeepSeek-V4.1-Flash）`）。
 * @param catalog - 模型目录。
 * @returns 文案。
 */
export function followModelLabel(catalog: ModelCatalogLike | undefined): string {
  const name = modelDisplayName(catalog, catalog?.default?.provider, catalog?.default?.model)
  return name === undefined ? '跟随原会话' : `跟随原会话（${name}）`
}

/**
 * 拆开下拉值：`follow` 或 `供应商id|模型id`。
 * @param value - 下拉值。
 * @returns 拆解结果。
 */
export function splitModelValue(value: unknown): { follow: boolean; provider?: string; model?: string } {
  if (typeof value !== 'string' || value.length === 0 || value === FOLLOW_VALUE) return { follow: true }
  const at = value.indexOf('|')
  if (at <= 0 || at === value.length - 1) return { follow: true }
  return { follow: false, provider: value.slice(0, at), model: value.slice(at + 1) }
}

/**
 * 配置里的模型 → 下拉值（`provider` 与 `model` 必须同时有才算选中；否则是跟随）。
 * @param config - 宿主配置（可能缺这两个键）。
 * @returns 下拉值。
 */
export function modelValueOf(config: { provider?: unknown; model?: unknown } | undefined): string {
  const provider = typeof config?.provider === 'string' ? config.provider : ''
  const model = typeof config?.model === 'string' ? config.model : ''
  return provider.length > 0 && model.length > 0 ? `${provider}|${model}` : FOLLOW_VALUE
}

/**
 * 按原型构建模型下拉：第一项「跟随原会话」，下面按 `groups` 分组列模型。
 * @param input - 目录与当前配置。
 * @returns 选项模型。
 */
export function buildModelOptions(input: { catalog?: ModelCatalogLike; current?: { provider?: unknown; model?: unknown } }): ModelOptions {
  const catalog = input.catalog
  const groups: SelectOptionGroup[] = []
  for (const group of catalog?.groups ?? []) {
    const options: SelectOption[] = []
    for (const entry of group?.models ?? []) {
      if (typeof entry?.id !== 'string' || entry.id.length === 0) continue
      const groupId = typeof group?.id === 'string' && group.id.length > 0 ? group.id : ''
      if (groupId.length === 0) continue
      options.push({ value: `${groupId}|${entry.id}`, label: (typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id) })
    }
    if (options.length === 0) continue
    groups.push({ label: (typeof group.name === 'string' && group.name.length > 0 ? group.name : (typeof group.id === 'string' ? group.id : '未分组')), options })
  }

  const hints: string[] = []
  for (const failure of catalog?.failures ?? []) {
    const name = (typeof failure?.name === 'string' && failure.name.length > 0) ? failure.name : (typeof failure?.id === 'string' ? failure.id : '未知供应商')
    const message = typeof failure?.message === 'string' && failure.message.length > 0 ? failure.message : '读取失败'
    hints.push(`模型目录里「${name}」没读到：${message}`)
  }

  // ⚠️ 目录整个是空的（既没有分组的模型、也没有失败记录）：必须给出**可解释**的提示。
  //    真实场景（2026-10-12 真机）：宿主 `listProviders()` 拿不到，或各 provider 的 `listModels()`
  //    返回空数组（要联网拉取 / 凭据没配好）⇒ 下拉里只剩「跟随原会话」，用户完全不知道为什么。
  if (catalog !== undefined && groups.length === 0 && hints.length === 0) {
    const why = typeof catalog.diagnosis === 'string' && catalog.diagnosis.length > 0 ? `（${catalog.diagnosis}）` : ''
    hints.push(`这台机器上没读到可用模型${why}：请确认「DSH 设置 → 模型」里能看到模型列表`)
  }

  // 兜底：配置里写着的模型如果不在目录里，也给它一个能显示出来的选项，别让下拉变空。
  const extra: SelectOption[] = []
  const currentValue = modelValueOf(input.current)
  const parsed = splitModelValue(currentValue)
  if (!parsed.follow) {
    const inCatalog = findCatalogModel(catalog, parsed.provider, parsed.model) !== undefined
    if (!inCatalog) {
      extra.push({ value: currentValue, label: modelDisplayName(catalog, parsed.provider, parsed.model) ?? String(parsed.model) })
    }
  }

  return { follow: { value: FOLLOW_VALUE, label: followModelLabel(catalog) }, groups, extra, hints }
}

/** 推理强度下拉的选项模型。 */
export interface EffortOptions {
  /** 第一项：跟随原会话（当前档位的显示名）。 */
  follow: SelectOption
  /** 跟着所选模型变的档位（**全部可选**，见下方 `effortOptionsOf` 的原型依据）。 */
  options: SelectOption[]
  hints: string[]
}

/**
 * 按原型构建推理强度下拉：选项**跟着所选模型变**，且**全部可选**。
 *
 * ⚠️ 2026-10-14 真机纠偏：旧实现让"模型选「跟随原会话」"时把自定义档位**全部禁用**
 *    （注释还自称"照原型语义"，其实是错的）。查证依据：
 *      · `汇总原型图.html` 的 `#effortSelect` 四个 `<option>` **没有任何 `disabled`**；
 *      · M2 产品文档 M2-N2 只说"选项跟着所选模型变；第一项恒为「跟随原会话」"；
 *      · 宿主侧 `resolveRoute()` 里 `childReasoningEffort` 与 provider/model **各自独立**生效
 *        （模型留空=跟随原会话，也只影响模型；档位照样按配置发出去）。
 *    ⇒ 用户"模型跟随 + 单独指定推理强度"是完全合法的用法，禁用是多余限制。
 *    （M2 设计文档 §385 的那条联动仍然保留：**换模型**时档位不支持就回落「跟随原会话」。）
 *
 * @param input - 目录、当前模型下拉值、当前会话自己的档位。
 * @returns 选项模型。
 */
export function effortOptionsOf(input: { catalog?: ModelCatalogLike; modelValue?: string; currentEffort?: unknown }): EffortOptions {
  const catalog = input.catalog
  const parsed = splitModelValue(input.modelValue)
  const targetProvider = parsed.follow ? catalog?.default?.provider : parsed.provider
  const targetModel = parsed.follow ? catalog?.default?.model : parsed.model
  const entry = findCatalogModel(catalog, targetProvider, targetModel)
  const efforts = entry?.efforts ?? []

  // 「跟随原会话」括号里显示的是：具体模型时=原会话自己的档位；跟随模型时=目录给的默认档位。
  const inheritedId = parsed.follow
    ? catalog?.default?.reasoningEffort
    : (typeof input.currentEffort === 'string' && input.currentEffort.length > 0 ? input.currentEffort : catalog?.default?.reasoningEffort)
  const inheritedName = resolveEffortName(catalog, inheritedId)

  const options: SelectOption[] = []
  for (const effort of efforts) {
    if (typeof effort?.id !== 'string' || effort.id.length === 0) continue
    options.push({ value: effort.id, label: (typeof effort.name === 'string' && effort.name.length > 0 ? effort.name : effort.id) })
  }
  // 兜底两条：①「跟随」标签里那个档位；②**用户当前选中的**那个档位。
  // 它们不在档位表里时补进去，避免下拉"看不见当前值"（否则会显示成空白）。
  for (const fallbackId of [textOf(inheritedId), textOf(input.currentEffort)]) {
    if (fallbackId.length === 0 || options.some((option) => option.value === fallbackId)) continue
    options.push({ value: fallbackId, label: resolveEffortName(catalog, fallbackId) ?? fallbackId })
  }

  const hints: string[] = []
  if (!parsed.follow && entry === undefined) {
    hints.push('这个模型不在当前目录里，推理强度只能跟随原会话')
  }

  return {
    follow: { value: FOLLOW_VALUE, label: inheritedName === undefined ? '跟随原会话' : `跟随原会话（${inheritedName}）` },
    options,
    hints,
  }
}

/**
 * 档位 id → 显示名（先在本模型/默认模型的档位表里找，找不到就用 id 本身）。
 * @param catalog - 目录。
 * @param effortId - 档位 id。
 * @returns 显示名或 undefined。
 */
function resolveEffortName(catalog: ModelCatalogLike | undefined, effortId: unknown): string | undefined {
  const wanted = textOf(effortId)
  if (wanted.length === 0) return undefined
  const candidates: CatalogModelLike[] = []
  const defaultEntry = findCatalogModel(catalog, catalog?.default?.provider, catalog?.default?.model)
  if (defaultEntry !== undefined) candidates.push(defaultEntry)
  for (const group of catalog?.groups ?? []) {
    for (const entry of group?.models ?? []) candidates.push(entry)
  }
  for (const entry of candidates) {
    for (const effort of entry?.efforts ?? []) {
      if (effort?.id === wanted && typeof effort.name === 'string' && effort.name.length > 0) return effort.name
    }
  }
  return wanted
}

/**
 * 所选模型**真正支持**的档位 id（不含展示用的兜底项）。
 * @param input - 目录与模型下拉值。
 * @returns 是否只能跟随 + 档位 id。
 */
export function effortIdsOfModel(input: { catalog?: ModelCatalogLike; modelValue?: string }): { forcedFollow: boolean; ids: string[] } {
  const catalog = input.catalog
  const parsed = splitModelValue(input.modelValue)
  const entry = findCatalogModel(
    catalog,
    parsed.follow ? catalog?.default?.provider : parsed.provider,
    parsed.follow ? catalog?.default?.model : parsed.model,
  )
  const ids: string[] = []
  for (const effort of entry?.efforts ?? []) {
    if (typeof effort?.id === 'string' && effort.id.length > 0) ids.push(effort.id)
  }
  return { forcedFollow: parsed.follow || entry === undefined, ids }
}

/**
 * 换模型时算下一份选择（推理强度跟着模型联动：新模型没有的档位回落到「跟随原会话」）。
 * @param input - 当前选择、目录、新的模型下拉值。
 * @returns 下一份选择。
 */
export function nextChoiceForModel(input: { choice: SessionDefaultsChoice; catalog?: ModelCatalogLike; nextModelValue: string }): SessionDefaultsChoice {
  const support = effortIdsOfModel({ catalog: input.catalog, modelValue: input.nextModelValue })
  const kept = !support.forcedFollow
    && input.choice?.effort !== FOLLOW_VALUE
    && support.ids.includes(input.choice.effort)
    ? input.choice.effort
    : FOLLOW_VALUE
  return { model: input.nextModelValue, effort: kept, permission: input.choice?.permission ?? FOLLOW_VALUE }
}

/** 工作权限下拉的选项模型。 */
export interface PermissionOptions {
  /** 第一项：跟随原会话（当前档位的中文名）。 */
  follow: SelectOption
  options: SelectOption[]
  supported: boolean
  /** 服务不支持 / 读不到时的人话（界面必须能看出原因）。 */
  hint: string | undefined
  /** 配置里写着、但宿主没给这条的档位（兜底显示）。 */
  extra: SelectOption[]
}

/**
 * 按原型构建工作权限下拉：第一项「跟随原会话」，下面三个内置档位。
 * @param input - 宿主返回的档位表与当前配置。
 * @returns 选项模型。
 */
export function buildPermissionOptions(input: { presets?: PermissionPresetsLike; current?: unknown }): PermissionOptions {
  const presets = input.presets
  const currentId = typeof presets?.current === 'string' && presets.current.length > 0
    ? presets.current
    : (typeof input.current === 'string' && input.current.length > 0 ? input.current : undefined)
  const followLabel = currentId === undefined ? '跟随原会话' : `跟随原会话（${permissionPresetLabel(currentId)}）`

  if (presets === undefined) {
    return { follow: { value: FOLLOW_VALUE, label: followLabel }, options: [], supported: false, hint: undefined, extra: [] }
  }
  if (presets.supported === false) {
    return {
      follow: { value: FOLLOW_VALUE, label: followLabel },
      options: [],
      supported: false,
      hint: (typeof presets.reason === 'string' && presets.reason.length > 0 ? presets.reason : '当前 DSH 版本不支持切换新会话的工作权限'),
      extra: [],
    }
  }

  const options: SelectOption[] = []
  for (const preset of presets.presets ?? []) {
    if (typeof preset?.id !== 'string' || preset.id.length === 0) continue
    options.push({ value: preset.id, label: permissionPresetLabel(preset.id, preset.name) })
  }

  const extra: SelectOption[] = []
  const configured = typeof input.current === 'string' ? input.current : ''
  if (configured.length > 0 && !options.some((option) => option.value === configured)) {
    extra.push({ value: configured, label: permissionPresetLabel(configured) })
  }

  // 服务在、但档位一个都没读到：同样要说出来，别让下拉只剩「跟随原会话」（与模型下拉同一口径）。
  const emptyHint = options.length === 0
    ? '没读到可用的权限档位：请确认当前 DSH 版本支持权限切换'
    : undefined
  return { follow: { value: FOLLOW_VALUE, label: followLabel }, options, supported: true, hint: emptyHint, extra }
}

/** 新会话三项的一组选择（下拉值）。 */
export interface SessionDefaultsChoice {
  /** `follow` 或 `供应商id|模型id`。 */
  model: string
  /** `follow` 或档位 id。 */
  effort: string
  /** `follow` 或权限档位 id。 */
  permission: string
}

/**
 * 宿主 config 里这四项的取值（空串 / 缺席 = 跟随原会话）。
 *
 * ⚠️ 键名以宿主 `lib/handoff-config.mjs` 为准（2026-10-12 落地版）：
 *    新会话的推理强度是 **`childReasoningEffort`**，不是 `reasoningEffort`——
 *    后者是上游 /handoff 摘要那个既有键，共用一个会让"跟随原会话"的空串被当成真实取值发给模型。
 */
export interface SessionDefaultsHost {
  provider?: string
  model?: string
  childReasoningEffort?: string
  childPermissionPreset?: string
}

/** 一次提交的补丁（**只含真的变了的键**）。 */
export interface SessionDefaultsPatch {
  provider?: string
  model?: string
  childReasoningEffort?: string
  childPermissionPreset?: string
}

/**
 * 字符串取值守卫（缺字段一律按空串，空串 = 跟随原会话）。
 * @param value - 任意值。
 * @returns 字符串。
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 宿主 config → 三项下拉的当前选择。
 * @param config - 宿主 config（可能缺这些键）。
 * @returns 选择。
 */
export function sessionDraftFromConfig(config: SessionDefaultsHost | undefined): SessionDefaultsChoice {
  return {
    model: modelValueOf(config),
    effort: textOf(config?.childReasoningEffort).length > 0 ? textOf(config?.childReasoningEffort) : FOLLOW_VALUE,
    permission: textOf(config?.childPermissionPreset).length > 0 ? textOf(config?.childPermissionPreset) : FOLLOW_VALUE,
  }
}

/**
 * 三项下拉 → `remote.updateConfig` 的补丁。
 *
 * ⚠️ 关键不变量：**值没变就不带这个键**。三项全默认「跟随原会话」时返回空补丁 ⇒
 * 设置页的保存行为与新增本区之前**完全一致**（不会平白多出 provider/model 这些键）。
 *
 * @param input - 用户选的三项 + 宿主当前值。
 * @returns 补丁与变化了的键名。
 */
export function buildSessionDefaultsPatch(input: { choice?: Partial<SessionDefaultsChoice>; host?: SessionDefaultsHost | undefined }): { patch: SessionDefaultsPatch; keys: string[] } {
  const host = input.host ?? {}
  const parsed = splitModelValue(input.choice?.model)
  const desiredProvider = parsed.follow ? '' : textOf(parsed.provider)
  const desiredModel = parsed.follow ? '' : textOf(parsed.model)
  const desiredEffort = input.choice?.effort === FOLLOW_VALUE ? '' : textOf(input.choice?.effort)
  const desiredPermission = input.choice?.permission === FOLLOW_VALUE ? '' : textOf(input.choice?.permission)

  const patch: SessionDefaultsPatch = {}
  const keys: string[] = []
  if (textOf(host.provider) !== desiredProvider || textOf(host.model) !== desiredModel) {
    patch.provider = desiredProvider
    patch.model = desiredModel
    keys.push('provider', 'model')
  }
  if (textOf(host.childReasoningEffort) !== desiredEffort) {
    patch.childReasoningEffort = desiredEffort
    keys.push('childReasoningEffort')
  }
  if (textOf(host.childPermissionPreset) !== desiredPermission) {
    patch.childPermissionPreset = desiredPermission
    keys.push('childPermissionPreset')
  }
  return { patch, keys }
}

// ───────────── 交接文档列表（纯函数：列表行格式化、失败态、上限提示） ─────────────

/**
 * 列表上限（与宿主 `lib/handoff-docs.mjs` 的 `MAX_LISTED_DOCS` 同值）。
 *
 * ⚠️ 这里**不能 import** 宿主模块：那个模块依赖 node:fs，import 进浏览器 bundle 会炸。
 *    宿主漏给 total 时，本常量用来判断"是不是被截断了"。
 */
export const DOC_LIST_LIMIT = 50

/**
 * `remote.listHandoffDocs()` 的一个文件条目。
 *
 * `reason` 是宿主 2026-10-12 起直接给的**触发原因短标签**（它已经把文档头部的
 * `- 触发原因：xxx` 解析好了）；宿主旧版本没有这个字段时，客户端才回落去读正文自己解析。
 */
export interface DocFileLike {
  name?: string
  path?: string
  bytes?: number
  at?: number
  reason?: string
}

/** `remote.listHandoffDocs()` 的返回体（`total` 是宿主可选的"一共多少份"）。 */
export interface DocListLike {
  dir?: string
  exists?: boolean
  files?: DocFileLike[]
  /** 可选：一共多少份（有它才能显示「还有 N 份更早的」）。 */
  total?: number
}

/** 列表里的一行。 */
export interface DocRow {
  key: string
  name: string
  /** `MM-DD HH:mm`。 */
  when: string
  /** `会话短码 · 触发原因`。 */
  who: string
  /** `8.2 KB`。 */
  size: string
  reason: string | undefined
}

/** 补零到两位。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 列表行的时间：`MM-DD HH:mm`（本地时区）。
 * @param at - 毫秒时间戳。
 * @returns 文案（无效值给 `—`）。
 */
export function formatDocTime(at: unknown): string {
  if (!isFiniteNumber(at) || at <= 0) return '—'
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * 详情卡的时间：`YYYY-MM-DD HH:mm`（本地时区，照原型 `2026-10-12 13:30`）。
 * @param at - 毫秒时间戳。
 * @returns 文案（无效值给 `—`）。
 */
export function formatDocFullTime(at: unknown): string {
  if (!isFiniteNumber(at) || at <= 0) return '—'
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 交付文档文件名的解析结果。 */
export interface HandoffDocNameParts {
  /** 文件名里带的时间戳（`<ISO>-<短码>.md`）。 */
  at: number | undefined
  /** 会话短码（文件名时间戳之后的那一段）。 */
  sessionCode: string | undefined
}

/** 文件名形态：`2026-10-12T13-30-00-000Z-session-1b523ee9.md`（`safeIsoTime` 把 `:`/`.` 换成了 `-`）。 */
const DOC_STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.+)$/

/**
 * 从交接文档文件名里解析"文件时间 + 会话短码"。
 * @param name - 文件名。
 * @returns 解析结果（认不出来时把整段当短码，时间交给 mtime）。
 */
export function parseHandoffDocName(name: unknown): HandoffDocNameParts {
  const base = String(name ?? '').replace(/\.md$/i, '')
  const match = DOC_STAMP_RE.exec(base)
  if (match === null) return { at: undefined, sessionCode: base.length > 0 ? base : undefined }
  const at = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`)
  return { at: Number.isFinite(at) ? at : undefined, sessionCode: match[8] !== undefined && match[8].length > 0 ? match[8] : undefined }
}

/**
 * 触发原因短标签（列表行里那一段小字）。
 *
 * 文档头部的 `- 触发原因：` 有可能是**原始代码**（manual / session-volume / …），
 * 也有可能是宿主 `humanReason()` 拼出来的一整句话；两种都要能收敛成短标签。
 */
export const TRIGGER_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  manual: '手工接力',
  'replace-threshold': '替代模式到线',
  'session-volume': '会话体积到线',
  'compaction-count': '压缩次数到线',
})

/**
 * 触发原因 → 短标签。
 * @param raw - 原始值（代码或人话）。
 * @returns 短标签或 undefined。
 */
export function shortTriggerReason(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (text.length === 0) return undefined
  // 文档头部可能写成 `manual（{"safePoint":true}）`：括号里是细节，不是原因本身，先去干净。
  const cut = (text.split(/[（(→]/, 1)[0] ?? '').trim().replace(/[。，,；;:：]+$/, '')
  const mapped = TRIGGER_REASON_LABELS[text] ?? TRIGGER_REASON_LABELS[cut]
  if (mapped !== undefined) return mapped
  if (cut.length === 0) return undefined
  return cut.length > 16 ? `${cut.slice(0, 16)}…` : cut
}

/**
 * 从交接文档正文里取出「触发原因」短标签。
 * @param markdown - 文档全文。
 * @returns 短标签或 undefined。
 */
export function docTriggerReasonOf(markdown: unknown): string | undefined {
  if (typeof markdown !== 'string') return undefined
  const match = /^-\s*触发原因：(.+)$/m.exec(markdown)
  if (match === null) return undefined
  return shortTriggerReason(match[1])
}

/**
 * 一个文件 → 列表一行。
 * @param file - 宿主给的条目。
 * @param reason - 已知的触发原因短标签（可能还没读到）。
 * @returns 一行。
 */
export function docRowOf(file: DocFileLike | undefined, reason?: string): DocRow {
  const name = typeof file?.name === 'string' ? file.name : ''
  const parts = parseHandoffDocName(name)
  const who = parts.sessionCode === undefined
    ? (reason === undefined ? name : `${name} · ${reason}`)
    : (reason === undefined ? parts.sessionCode : `${parts.sessionCode} · ${reason}`)
  return {
    key: name,
    name,
    when: formatDocTime(isFiniteNumber(file?.at) && file.at > 0 ? file.at : parts.at),
    who,
    size: formatBytes(isFiniteNumber(file?.bytes) ? file.bytes : Number.NaN),
    reason,
  }
}

/** 交接文档列表的视图模型。 */
export interface DocListViewModel {
  ok: boolean
  dir: string
  rows: DocRow[]
  /** 空列表时的说明（按"目录不存在 / 还没有文档"分两种）。 */
  empty: string | undefined
  /** 失败原因（界面必须能看出原因，不许静默变空）。 */
  error: string | undefined
  /** 超过上限时列表底部那句（照原型）。 */
  more: string | undefined
  /** 一共多少份（宿主给 total 时用它，否则就是已列出的份数）。 */
  total: number | undefined
}

/**
 * `listHandoffDocs` 结果 → 列表视图模型。
 * @param input - 远程结果与"已读到的触发原因"表。
 * @returns 视图模型。
 */
export function docListViewModel(input: {
  result: { ok: true; value: DocListLike } | { ok: false; error: string }
  reasons?: Record<string, string | undefined>
}): DocListViewModel {
  if (!input.result.ok) {
    return { ok: false, dir: '', rows: [], empty: undefined, error: `读取交接文档目录失败：${input.result.error}`, more: undefined, total: undefined }
  }
  const value = input.result.value ?? {}
  const dir = textOf(value.dir)
  const files = Array.isArray(value.files) ? value.files : []
  const rows = [...files]
    .sort((a, b) => (isFiniteNumber(b?.at) ? b.at : 0) - (isFiniteNumber(a?.at) ? a.at : 0))
    // 触发原因优先用宿主直接给的（一跳到位）；宿主旧版本没给才用"读正文解析出来"的那份。
    .map((file) => docRowOf(file, textOf(file?.reason).length > 0 ? textOf(file?.reason) : input.reasons?.[textOf(file?.name)]))
  const total = isFiniteNumber(value.total) ? value.total : undefined
  const more = rows.length >= DOC_LIST_LIMIT
    ? (total !== undefined && total > rows.length
      ? `还有 ${total - rows.length} 份更早的 —— 点「打开存储目录」看全部`
      : '还有更早的 —— 点「打开存储目录」看全部')
    : undefined
  const empty = rows.length > 0
    ? undefined
    : (value.exists === false ? `存储目录还不存在：${dir}` : '还没有交接文档。第一次换会话之后就会出现在这里。')
  return { ok: true, dir, rows, empty, error: undefined, more, total: total ?? rows.length }
}

/**
 * 详情卡的标题行时间：`2026-10-12 13:30 · session-1b523ee9`（照原型）。
 * @param at - 时间戳。
 * @param sessionCode - 会话短码。
 * @returns 文案。
 */
export function detailTimeLine(at: unknown, sessionCode: unknown): string {
  const time = formatDocFullTime(at)
  const code = textOf(sessionCode)
  return code.length > 0 ? `${time} · ${code}` : time
}

// ─────────────── R4（2026-10-17）：手动换会话卡片 · 留言区 · 技能面板（纯函数） ───────────────

/** 技能面板一行（`listSkills` 的裸值条目，M1 §12.3(b)）。 */
export interface SkillEntry {
  name: string
  displayName: string
  description: string
  group: 'local' | 'market'
  ref: string
}

/** 按**码点**截到 500（与 host 侧 `normalizeNote` 同一口径，双保险）。 */
export function clampNoteByCodePoints(value: string): string {
  const points = Array.from(value)
  return points.length <= MAX_NOTE_CHARS ? value : points.slice(0, MAX_NOTE_CHARS).join('')
}

/** 留言的码点长度（字数计数用；`已输入 N / 500` 里的 N）。 */
export function noteLengthOf(value: string): number {
  return Array.from(value).length
}

/** 字数计数逐字文本（清单 §1：`已输入 N / 500`）。 */
export function noteCountText(value: string): string {
  return R4_TEXTS.NOTE_COUNT_TEMPLATE
    .replace('{n}', String(noteLengthOf(value)))
    .replace('{max}', String(MAX_NOTE_CHARS))
}

/** 到 500 上限 ⇒ 计数标红（清单 §1）。 */
export function noteCountIsFull(value: string): boolean {
  return noteLengthOf(value) >= MAX_NOTE_CHARS
}

/**
 * 技能面板点击一行：把逐字 ` /技能名 ` 插到留言的**光标处**（清单 §1/§2.5）。
 *
 * 返回新文本与插入后的光标位置（UTF-16 下标，可直接喂 `setSelectionRange`）。
 * 超 500 码点按同一口径截断；**不做任何别的改写**。
 *
 * @param input - 输入。
 * @returns 新留言与光标位置。
 */
export function insertSkillText(input: { note: string; name: string; start?: number; end?: number }): { note: string; caret: number } {
  const note = typeof input.note === 'string' ? input.note : ''
  const rawStart = typeof input.start === 'number' && Number.isFinite(input.start) ? input.start : note.length
  const rawEnd = typeof input.end === 'number' && Number.isFinite(input.end) ? input.end : rawStart
  const start = Math.max(0, Math.min(rawStart, note.length))
  const end = Math.max(start, Math.min(rawEnd, note.length))
  const piece = ` /${input.name} `
  const next = clampNoteByCodePoints(`${note.slice(0, start)}${piece}${note.slice(end)}`)
  return { note: next, caret: Math.min(start + piece.length, next.length) }
}

/** 技能面板的搜索过滤（本地包含匹配，不新增 RPC；M2 §11.3 规则 5）。 */
export function filterSkills(skills: SkillEntry[], query: string): SkillEntry[] {
  const list = Array.isArray(skills) ? skills : []
  const q = String(query ?? '').trim().toLowerCase()
  if (q.length === 0) return list
  return list.filter((skill) => `${skill.displayName} ${skill.name} ${skill.description}`.toLowerCase().includes(q))
}

/** `group` 枚举 → 逐字分组名（本地安装 / 市场安装）。 */
export function skillGroupLabel(group: string): string {
  return group === 'market' ? R4_TEXTS.SKILL_GROUP_MARKET : R4_TEXTS.SKILL_GROUP_LOCAL
}

/**
 * 把技能列表按分组切开（**固定顺序**：本地安装 → 市场安装；空组不出现）。
 * @param skills - 已过滤的列表。
 * @returns 分组列表。
 */
export function skillGroupsOf(skills: SkillEntry[]): Array<{ group: 'local' | 'market'; label: string; skills: SkillEntry[] }> {
  const list = Array.isArray(skills) ? skills : []
  const groups: Array<{ group: 'local' | 'market'; label: string; skills: SkillEntry[] }> = [
    { group: 'local', label: skillGroupLabel('local'), skills: [] },
    { group: 'market', label: skillGroupLabel('market'), skills: [] },
  ]
  for (const skill of list) {
    const target = skill.group === 'market' ? groups[1] : groups[0]
    if (target !== undefined) target.skills.push(skill)
  }
  return groups.filter((entry) => entry.skills.length > 0)
}

/** 把技能引用做一次去重（按首次出现顺序），供 `handoffNow` 的 `skillRefs` 用。 */
export function pushSkillRef(refs: string[], ref: string): string[] {
  const list = Array.isArray(refs) ? refs : []
  return list.includes(ref) ? list : [...list, ref]
}

// ─────────────── R4 补（task-27）：视觉与原型 1:1 的纯函数 ───────────────

/** 留言文本框最小高度（设计文档：2 行起 = 52px）。 */
export const NOTE_MIN_HEIGHT_PX = 52
/** 留言文本框最大高度（设计文档：4 行封顶 = 88px）。 */
export const NOTE_MAX_HEIGHT_PX = 88

/**
 * 留言框自动增高（原型 `r4GrowLeave` 口径：2 行起、4 行封顶、超出内滚）。
 *
 * 原型算法：`lineH = scrollHeight / 2`（2 行基线 → 单行高）、`cap = lineH * 4`、
 * `height = min(scrollHeight, cap)`；再用设计文档的 52/88 兜住上下界（避免字体差异越界）。
 *
 * @param scrollHeight - 文本域内容滚动高度（px）。
 * @returns 应设置的像素高度（52–88）。
 */
export function noteAutoGrowHeightPx(scrollHeight: number): number {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return NOTE_MIN_HEIGHT_PX
  const linePx = scrollHeight / 2
  const cap = linePx * 4
  return Math.max(NOTE_MIN_HEIGHT_PX, Math.min(scrollHeight, cap, NOTE_MAX_HEIGHT_PX))
}

/**
 * 技能行图标里的「显示名首字」（原型 `.skill-row-ico`：显示名首字的小方块）。
 * @param displayName - 技能显示名。
 * @returns 首字（按码点取，emoji 不会被劈开）；空名字回落 `技`。
 */
export function skillInitialOf(displayName: string): string {
  const points = Array.from(String(displayName ?? '').trim())
  return points.length > 0 ? points[0] as string : '技'
}

/** 交接文档预览里的一行。 */
export interface HandoffPreviewItem {
  /** 行号 + 标题（逐字，如 `1. 用户需求`）。 */
  n: string
  /** 这一行会写什么（视觉预览用；不调 RPC、不生成真实内容）。 */
  c: string
}

/**
 * 卡片内「交接文档预览」的列表（**纯视觉**，不产生任何 RPC）。
 *
 * 顺序与真实文档一致：留言（仅当有）→ 5 个固定小节。留言为空时 `0. 交接人留言` 不出现
 * （与「留空不出节」一致）；小节数提示随之联动（原型 `8 个 / 9 个` → 本插件 5 / 6 个）。
 *
 * @param input - 输入。
 * @param input.note - 当前留言草稿（空串 = 没留言）。
 * @param input.sectionTitles - 5 个固定小节标题（`HANDOFF_DOC_SECTIONS`，由调用方传入避免客户端再抄一份）。
 * @returns 预览行与小节数提示文本。
 */
export function handoffPreviewOf(input: { note: string; sectionTitles: readonly string[] }): {
  items: HandoffPreviewItem[]
  hint: string
  baseCount: number
} {
  const note = typeof input.note === 'string' ? input.note : ''
  const titles = Array.isArray(input.sectionTitles) ? input.sectionTitles : []
  const noteItems: HandoffPreviewItem[] = note.length > 0
    ? [{ n: R4_TEXTS.PREVIEW_NOTE_ITEM, c: note }]
    : []
  const sectionItems: HandoffPreviewItem[] = titles.map((title, index) => ({
    n: `${index + 1}. ${title}`,
    c: PREVIEW_SECTION_HINTS[title] ?? '由本次会话整理',
  }))
  const items = [...noteItems, ...sectionItems]
  return {
    items,
    hint: R4_TEXTS.PREVIEW_HINT_TEMPLATE.replace('{n}', String(items.length)),
    baseCount: titles.length,
  }
}

/** 每个固定小节在预览里的一句"会写什么"（视觉占位，不是真实内容）。 */
const PREVIEW_SECTION_HINTS: Readonly<Record<string, string>> = Object.freeze({
  用户需求: '从本次会话提炼你的目标与原话',
  方案梗概: '模型总结最近几轮的做法与取舍',
  已完成: '列出已经做完的事与产物',
  涉及文件与产物: '列出碰过的文件与产物',
  接下来做什么: '给新会话的下一步与待办',
})
