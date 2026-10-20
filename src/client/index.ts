// dsh-session-handoff 客户端半区（browser half）——本块交付：
//   1) 健康度行（S2，核心界面）挂 `conversation.composer.dock`（**横向一行**的那个槽位，与原生占用条同容器；`conversation.input.dock` 是垂直列，会竖着堆）
//   2) 设置页（S1）挂 `settings.section`
//   3) 换会话确认卡片（S3）走宿主的 `remote.sessionHandoff.confirm`（宿主侧弹原生问答弹窗）
//   4) 上游蓝本的自动跳转卡片（`conversation.chat.node`）原样保留
//
// ⚠️ 与宿主通信**只能**走 `ctx.remote.$mount(contribution)` + `ctx.get('remote.sessionHandoff')`：
//    客户端插件的 `ctx.get('sessionHandoff')` 拿不到宿主进程里的那个对象（两侧不是同一张服务表）。
//    （宿主与客户端不共享服务表，只有 Typert 远程通道能跨进程调用。）
//
// ⚠️ 本文件**不 import 任何宿主 UI 包**：只用 react + 原生元素 + 本地 CSS 变量。
//    插槽名与包名对了不代表能当 API 用（PK-008）。

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType, type ReactNode } from 'react'
import { HandoffOpenCard } from './HandoffOpenCard.tsx'
import { extractChildId, isHandoffDone } from './parse.ts'
import { Bar, Button, CSS_NS, NumberInput, Row, Segmented, Switch, cx } from './ui.ts'
import {
  HEALTH_BACKOFF_MAX_MS,
  HEALTH_POLL_MS,
  HEALTH_WARMUP_MAX_TRIES,
  HEALTH_WARMUP_MS,
  MODE_CARDS,
  PROMPT_LEVELS,
  DANGER_PERMISSION,
  FOLLOW_VALUE,
  ariaSummary,
  buildConfigPatch,
  buildModelOptions,
  buildPermissionOptions,
  buildSessionDefaultsPatch,
  bytesToMb,
  clampNoteByCodePoints,
  detailTimeLine,
  docListViewModel,
  docTriggerReasonOf,
  drainBannerTextOf,
  drainDraftOf,
  EMPTY_DRAIN_LATCH,
  filterSkills,
  handoffPreviewOf,
  insertSkillText,
  noteAutoGrowHeightPx,
  latchDrain,
  noteCountIsFull,
  noteCountText,
  noteLengthOf,
  pushSkillRef,
  skillInitialOf,
  skillGroupsOf,
  draftSyncDecision,
  effortOptionsOf,
  isStaleEpoch,
  nextChoiceForModel,
  nextPollStep,
  parseHandoffDocName,
  pickRowForSession,
  rearmDraftOf,
  sessionDraftFromConfig,
  unwrapRemote,
  viewModelOf,
  type DocListLike,
  type DocListViewModel,
  type DrainLatchState,
  type DrainState,
  type ModelCatalogLike,
  type PendingSave,
  type PermissionPresetsLike,
  type PollOutcome,
  type SessionDefaultsChoice,
  type SessionDefaultsHost,
  type SkillEntry,
} from './view.ts'
// 默认值取宿主配置模块的**同一份**（不在客户端再写一个 50，避免两边漂移）。
import { HANDOFF_DEFAULTS, HANDOFF_LIMITS } from '../../lib/handoff-config.mjs'
// R4：卡片逐字文案与限长与宿主同源（清单 §3.7）。
import { R4_TEXTS, R4_HINTS, R5_HINTS, SUBAGENT_TEXTS, CLIENT_STATS_TIMEOUT_MS, HANDOFF_DOC_SECTION_TITLES, MAX_NOTE_CHARS } from '../../lib/constants.mjs'
import { resolveWithin } from '../../lib/timeout.mjs'
// 设计令牌（`prism.css` 的逐字副本）+ 本插件样式表；两者都由构建脚本内联进 client.js。
import './styles.ts'

export const name = 'dsh-session-handoff-client'

// 轮询节奏常量定义在 `view.ts`（纯函数 `nextPollStep` 要用），这里原样再导出，
// 保持本文件对外的常量出口不变。
export { HEALTH_BACKOFF_MAX_MS, HEALTH_POLL_MS, HEALTH_WARMUP_MAX_TRIES, HEALTH_WARMUP_MS }

/**
 * 必需服务：remote（跨进程 RPC）、slots（注册 UI）、sessions（打开会话）、
 * uiConversation（会话事件节点状态机）。
 *
 * ⚠️ 2026-10-10 实机事故修正：这里原写作 `conversationEvents`（上游蓝本针对
 * DSH Desktop 2.0.15 的服务名）。DSH 0.2.0-rc.2 的内核里**已经不存在这个名字**，
 * 于是客户端条目永远停在 `pending (waiting for service: conversationEvents)`，
 * 而 web 启动要求所有条目激活 ⇒ **DSH 直接启动失败**（crash 日志原文：
 * `Error: web boot: 1 entry did not activate`）。
 *
 * 新版的服务是 `uiConversation`（`dsh-client-ui-conversation/lib/client.js`：
 * `super(ctx, "uiConversation")`，其 `.events` 是 `ConversationEventRegistry`），
 * 注册方式为 `ctx.effect(() => ctx.uiConversation.events.register(definition))`，
 * 内核自带范例见 `dsh-client-ui-conversation` 的 `conversation-queue-dock`
 * （`inject: ["slots","conversation","sessions","uiConversation"]`）。
 */
export const inject = ['remote', 'slots', 'sessions', 'uiConversation']

/** 远程命名空间（与宿主 `lib/typert.host.mjs` 的 `namespace` 必须一致）。 */
export const REMOTE_NAMESPACE = 'sessionHandoff'

/** 客户端最小上下文接口（**不引入 @deepseek-ai 类型依赖链**，PK-004 的同类纪律）。 */
interface HandoffClientCtx {
  remote?: { $mount?: (contribution: unknown) => Promise<() => Promise<void> | void> }
  effect?: (callback: () => unknown, label?: string) => unknown
  get?: (name: string) => unknown
  uiConversation: { events: { register(definition: unknown): void } }
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>): unknown
  }
  sessions: {
    open(sessionId: string): void
    binding(sessionId: string): unknown
    scope?(sessionId: string): unknown
  }
}

/** 远程方法的返回包装（网关口径）。 */
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } }

/** `remote.sessionHandoff` 的方法面（我们只声明用到的）。 */
interface HandoffRemote {
  stats(sessionIds?: string[], decisionLimit?: number, decisionFilter?: string): Promise<RemoteResult<StatsPayload>>
  updateConfig(patch: Record<string, unknown>): Promise<RemoteResult<UpdatePayload>>
  handoffNow(sessionId: string, source?: string, options?: { note?: string; skillRefs?: string[] }): Promise<RemoteResult<HandoffResultPayload>>
  cancelPending(sessionId: string): Promise<RemoteResult<HandoffResultPayload>>
  confirm(sessionId: string, reason?: string, detail?: string): Promise<RemoteResult<{ action: string; reason: string }>>
  readHandoffDoc(name?: string, read?: boolean): Promise<RemoteResult<{ found: boolean; name: string | null; path: string | null; content: string | null }>>
  listHandoffDocs(): Promise<RemoteResult<{ dir: string; exists: boolean; files: Array<{ name: string; path: string; bytes: number; at: number }> }>>
  /** 模型目录（S1「新会话用什么样的」用）。宿主版本较旧时这个方法可能不存在。 */
  listModelCatalog(): Promise<RemoteResult<ModelCatalogLike>>
  /** 工作权限档位表（S1「新会话用什么样的」用）。宿主版本较旧时这个方法可能不存在。 */
  listPermissionPresets(): Promise<RemoteResult<PermissionPresetsLike>>
  /** R4：技能目录（手动换会话卡片的技能面板用）。宿主版本较旧时这个方法可能不存在。 */
  listSkills(sessionId: string): Promise<RemoteResult<SkillListPayload>>
}

/** R4：`listSkills` 的返回体（裸值；M1 §12.3(b)）。 */
interface SkillListPayload {
  skills: Array<{ name: string; displayName: string; description: string; group: 'local' | 'market'; ref: string }>
}

/** 一行健康度 DTO（shape 由宿主 `lib/handoff-report.mjs` 决定）。 */
interface HealthRowDto {
  sessionId: string
  title: string | null
  mode: 'replace' | 'hybrid' | 'native'
  autoPromptLevel: 'notify' | 'confirm' | 'auto'
  safePoint: boolean
  handedOff: boolean
  /** R6（2026-10-20 止血）：是不是子代理会话（宿主透出；据此置灰手动「换会话」）。 */
  subagent?: boolean
  chainIndex: number
  usedTokens: number | null
  windowTokens: number | null
  contextRatio: number | null
  nativeThresholdTokens: number | null
  contextLimitTokens: number | null
  contextLimitRatio: number | null
  contextMarker: boolean
  contextCounts: boolean
  sessionBytes: number | null
  sessionVolumeLimitBytes: number | null
  compactionsSinceHandoff: number
  compactionCountTrigger: number | null
  turnIndex: number
  messageCount: number
  eventCount: number
  perTurnTokens: number | null
  perTurnBytes: number | null
  rateReason: string
  level: string
  turnsLeft: number | null
  turnsLeftReason: string
  detail: Array<{ label: string; current: string; limit: string; distance: string }>
}

interface ConfigPayload {
  enabled: boolean
  autoMode: 'replace' | 'hybrid' | 'native'
  autoPromptLevel: 'notify' | 'confirm' | 'auto'
  summaryMode: string
  sessionVolumeBytes: number
  compactionCountTrigger: number | null
  confirmTimeoutMs: number
  /** 「先不接力」后再涨多少个百分点才重问（整数百分比，默认 50）。 */
  askRearmPercent: number
  handoffDocPersist: boolean
  decisionLogEnabled: boolean
  /**
   * 新会话默认项（2026-10-12 新增；宿主版本较旧时这几个键会缺席）。
   * 空串 / 缺席 = 跟随原会话。
   */
  provider?: string
  model?: string
  /** 新会话的推理强度（空串 = 跟随原会话）。⚠️ 不是上游摘要那个 `reasoningEffort`。 */
  childReasoningEffort?: string
  childPermissionPreset?: string
  /** R1（2026-10-14）：新会话读完交接文档先给计划、等确认再动手（默认 true）。 */
  childPlanFirst?: boolean
  /** R2（2026-10-14）：换会话前等子代理交卷的最长时间（分钟，1–60）。 */
  subagentDrainTimeoutMin?: number
}

interface DecisionRecord {
  at: number
  time: string
  action: string
  label: string
  reason: string
  human: string
  contextPercent: string
  volume: string
  chainIndex: number
}

interface StatsPayload {
  config: ConfigPayload
  rows: HealthRowDto[]
  docDir: string
  docDirSource: 'configured' | 'dsh-home'
  decisions: DecisionRecord[]
  errors: Array<{ sessionId: string; message: string }>
  /** R2（ARB-13）：子代理收尾的运行期状态；null = 没有进行中的收尾（旧宿主缺席也算 null）。 */
  drain?: DrainState | null
}

interface UpdatePayload {
  ok: boolean
  error: string | null
  rejected: string[]
  config: ConfigPayload
}

interface HandoffResultPayload {
  ok: boolean
  queued: boolean
  childSessionId: string | null
  reason: string | null
  error: string | null
}

/** `readHandoffDoc` 的返回体（与 `HandoffRemote` 里的声明一致）。 */
interface HandoffDocPayload {
  found: boolean
  name: string | null
  path: string | null
  content: string | null
}

/**
 * 取远程命名空间服务（没挂上就 undefined——**绝不抛**，UI 要能优雅降级）。
 * @param ctx - 客户端上下文。
 * @returns 远程服务或 undefined。
 */
function remoteOf(ctx: HandoffClientCtx): HandoffRemote | undefined {
  try {
    return ctx.get?.(`remote.${REMOTE_NAMESPACE}`) as HandoffRemote | undefined
  } catch {
    return undefined
  }
}

/**
 * 拉一次 stats（失败归一化成错误文本）。
 * @param remote - 远程服务。
 * @param sessionIds - 要看的会话 id（健康度行只关心当前会话）。
 * @returns 结果。
 */
async function fetchStats(remote: HandoffRemote, sessionIds: string[]): Promise<{ ok: true; value: StatsPayload } | { ok: false; error: string }> {
  try {
    return unwrapRemote(await remote.stats(sessionIds, 50, 'all')) as { ok: true; value: StatsPayload } | { ok: false; error: string }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) }
  }
}

/**
 * 轮询 stats 的小 hook（页面不可见时自动停，出错指数退避）。
 *
 * P2-9 修复（2026-10-12 代码审查）：
 *   1) **代次守卫**：每次 effect 重跑（ctx / sessionId 变化）都把代次 +1；
 *      旧代次的响应一律丢弃，绝不覆盖新状态。
 *   2) **一定续期**：下一个定时器在 `run()` 的收尾处无条件重排（成功、业务失败、
 *      调用抛错三条路都排），所以 `tick` 抛错不会让轮询静默死掉。
 *   3) 抛错**不吞**：给出可解释的错误文案（下次重试时自动清掉）。
 *
 * @param ctx - 客户端上下文。
 * @param sessionIds - 会话 id。
 * @returns 轮询状态。
 */
function useStats(ctx: HandoffClientCtx, sessionIds: string[], statsTimeoutMs = CLIENT_STATS_TIMEOUT_MS): {
  stats?: StatsPayload
  error?: string
  refresh: () => void
} {
  const remote = useMemo(() => remoteOf(ctx), [ctx])
  const [stats, setStats] = useState<StatsPayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const backoff = useRef(HEALTH_POLL_MS)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 已经"等数据"快轮询过几次（见 nextPollStep 的 warmupTried）。 */
  const warmup = useRef(0)
  /** 代次：effect 每重跑一次 +1；旧代次的响应全部作废。 */
  const epoch = useRef(0)
  /** 给外部 `refresh()` 用的"立刻拉一次"入口（effect 里挂上，卸载时拆掉）。 */
  const runRef = useRef<() => void>(() => undefined)
  /** 在途请求标记：`refresh()` 连点 / 轮询重叠时**不叠加请求**，只记一次"完了再拉一轮"。 */
  const inFlight = useRef(false)
  const rerunRequested = useRef(false)
  /** 有界等待：host 若对某会话永不返回，这里到点给出可解释失败态（不再永久转圈）。 */
  const effectiveTimeoutMs = typeof statsTimeoutMs === 'number' && statsTimeoutMs > 0 ? statsTimeoutMs : CLIENT_STATS_TIMEOUT_MS
  const key = sessionIds.join(',')

  const tick = useCallback(async (myEpoch: number): Promise<PollOutcome> => {
    if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
    if (remote === undefined) {
      setError('宿主半边的 remote.sessionHandoff 没挂上')
      return 'fail'
    }
    let result: { ok: true; value: StatsPayload } | { ok: false; error: string }
    try {
      // 2026-10-20 真机：宿主对子会话可能永不返回（既不 resolve 也不 reject）。
      // 这里与 host 的 stats 有界等待形成双保险；超时后给**可解释失败态**，用户能点「重试」。
      const raced = await resolveWithin(fetchStats(remote, sessionIds), { timeoutMs: effectiveTimeoutMs, label: 'client stats' })
      if (raced.status === 'timeout') {
        if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
        setError(R5_HINTS.CLIENT_STATS_TIMEOUT_TEMPLATE.replace('{sec}', String(Math.max(1, Math.round(effectiveTimeoutMs / 1000)))))
        return 'fail'
      }
      result = raced.value
    } catch (thrown) {
      // fetchStats 内部已经兜了一层；这里保证 tick 本身绝不抛穿，且给出人话。
      if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
      setError(`读取会话用量失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
      return 'throw'
    }
    if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
    if (result.ok) {
      setStats(result.value)
      setError(undefined)
      // 「还在等我自己的数据」：当前会话没有出现在 rows 里（老会话刚点开、宿主那侧还没注册它）。
      // 这既不是错误也不是"读不到"，但界面会停在"正在读取会话用量…"⇒ 交给 nextPollStep 走快轮询，
      // 让数据一到位界面就自己出现，不用用户手点「重试」。
      const wanted = sessionIds[0]
      const missing = typeof wanted === 'string' && wanted.length > 0
        && !(result.value?.rows ?? []).some((row) => row.sessionId === wanted)
      return missing ? 'warming' : 'ok'
    }
    setError(result.error)
    return 'fail'
  }, [remote, key, effectiveTimeoutMs])

  useEffect(() => {
    epoch.current += 1
    const mine = epoch.current
    let stopped = false

    const run = async (): Promise<void> => {
      // 「重试」连点 / 轮询与手动刷新重叠：不叠加请求，只记"这一轮结束后再拉一次"。
      if (inFlight.current) {
        rerunRequested.current = true
        return
      }
      inFlight.current = true
      try {
        let outcome: PollOutcome = 'throw'
        try {
          outcome = await tick(mine)
        } catch (thrown) {
          // tick 已保证不抛；这里再兜一层，保证"抛错也续期"这条不变量不靠 tick 自觉。
          if (!stopped && !isStaleEpoch(mine, epoch.current)) {
            setError(`读取会话用量失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
          }
        }
        // 代次作废 / 已卸载：不再续期（新代次会自己起新一轮）。
        if (stopped || isStaleEpoch(mine, epoch.current)) return
        const hidden = typeof document !== 'undefined' && document.hidden === true
        const step = nextPollStep({ outcome, backoffMs: backoff.current, hidden, warmupTried: warmup.current })
        backoff.current = step.backoffMs
        warmup.current = step.warmupTried
        if (timer.current !== undefined) clearTimeout(timer.current)
        timer.current = setTimeout(() => { void run() }, step.delayMs)
      } finally {
        inFlight.current = false
        // 在途期间用户点过「重试」：此刻**真的重新发起一次**（而不是被吞掉）。
        if (rerunRequested.current && !stopped && !isStaleEpoch(mine, epoch.current)) {
          rerunRequested.current = false
          void run()
        }
      }
    }

    runRef.current = () => { void run() }
    void run()
    return () => {
      stopped = true
      // 代次 +1：卸载/换 key 时，**已经发出去**的那次请求回来也会被判过期 ⇒ 不再 setState、不再续期。
      epoch.current += 1
      runRef.current = () => undefined
      if (timer.current !== undefined) clearTimeout(timer.current)
    }
  }, [tick])

  return {
    stats,
    error,
    // 「重试」= **清掉旧状态、真的重新发起**一次（在途时由 run 合并，连点不会叠加请求）。
    refresh: () => {
      setError(undefined)
      runRef.current()
    },
  }
}

// ─────────────────────────── S2 · 健康度行 ───────────────────────────

/**
 * 一行的视图模型 → JSX。
 * @param props - 属性。
 * @returns 元素。
 */
function Meter(props: { label: string; text: string; fill?: number; marker?: number; level: 'ok' | 'warn' | 'danger' }): ReactNode {
  return h('span', { className: cx(`${CSS_NS}-meter`) },
    h('span', { className: cx(`${CSS_NS}-meter-label`) }, props.label),
    h('span', { className: cx(`${CSS_NS}-meter-value`) }, props.text),
    // fill 缺席 = 这条指标没有有意义的刻度线（混合/原生模式下的上下文），只显示数字。
    props.fill === undefined ? null : h(Bar, { fill: props.fill, marker: props.marker, level: props.level, label: props.label }),
  )
}

/**
 * 健康度行（S2）。
 *
 * 导出是为了方便做组件级验证：健康度行的轮询与失败提示只靠纯函数测不到。
 *
 * @param props - 属性。
 * @returns 元素。
 */
export function HealthRow(props: { ctx: HandoffClientCtx; sessionId: string; statsTimeoutMs?: number }): ReactNode {
  const { ctx, sessionId, statsTimeoutMs } = props
  // `statsTimeoutMs` 只是**测试钩子**（生产不传 = CLIENT_STATS_TIMEOUT_MS）；用于复现"宿主永不返回"。
  const { stats, error, refresh } = useStats(ctx, sessionId.length > 0 ? [sessionId] : [], statsTimeoutMs)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  // —— R4（2026-10-17）手动换会话卡片：全部是**组件本地 state**（D5：不落盘、关页面即丢） ——
  /** 卡片是否打开；点「换会话」只置 true（A1：不动任何数据、零 RPC）。 */
  const [cardOpen, setCardOpen] = useState(false)
  /** 留言草稿（取消后**不清**，下次点「换会话」还在）。 */
  const [draftNote, setDraftNote] = useState('')
  /** 已引用的技能（去重、保持插入顺序），随 `handoffNow` 的第三参交给 host（只存不执行）。 */
  const [skillRefs, setSkillRefs] = useState<string[]>([])
  /** 技能面板是否展开（与卡片独立）。 */
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  /** 技能目录的加载态：`undefined` = 还没拉过（零 RPC 直到用户点开面板）。 */
  const [skillState, setSkillState] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; skills?: SkillEntry[]; error?: string }>({ status: 'idle' })
  const [skillQuery, setSkillQuery] = useState('')
  /** 插入失败/读取失败的残留提示（插入成功后必须清掉，A6）。 */
  const [insertError, setInsertError] = useState<string | undefined>(undefined)
  /** R4 补：卡片内「交接文档预览」是否展开（默认收起，原型 #qcardDetail）。 */
  const [previewOpen, setPreviewOpen] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const skillRootRef = useRef<HTMLDivElement | null>(null)

  // R4 补（task-27）：留言框自动增高 —— 2 行起（52px）、长到 4 行封顶（88px）、超出内滚。
  // 原型 r4GrowLeave 口径；纯 DOM 计算，不发任何 RPC。
  useEffect(() => {
    const el = noteRef.current
    if (el === null || !cardOpen) return
    el.style.height = 'auto'
    el.style.height = `${noteAutoGrowHeightPx(el.scrollHeight)}px`
  }, [draftNote, cardOpen])

  // P2-7：**只精确匹配当前会话**。sessionId 为空（挂载早期）时 `rowsFor` 会把所有 live
  // 会话都返回，原来那个 `?? rows[0]` 会把**别的会话**的用量显示成当前会话的。
  // 匹配不到就交给下面的空态（"正在读取…"），宁可显示"读不到"也不张冠李戴。
  const dto = pickRowForSession(stats?.rows, sessionId)
  const model = useMemo(() => (dto === undefined ? undefined : viewModelOf(dto)), [dto])

  // 复核 P2-7：宿主把"上次接力失败"塞进 `stats().errors`（桌面版宿主日志拿不到，
  // 这是唯一能让用户看见失败的通道）。只显示当前会话那一条。
  const failureMessage = (stats?.errors ?? []).find((entry) => entry.sessionId === sessionId)?.message

  // P1-3（2026-10-14）：`drain` 的**本地显示 latch**。
  // host 侧 `skipped` 在 wire 上只驻留 4000ms（ARB-18②），而客户端是定时轮询（正常 3s，
  // 失败退避 6s…60s，hidden 60s）——不加 latch 的话，跳过刚好落在两次轮询之间时，
  // 第三条文案一次都不渲染。契约要求"至少渲染一次且停留 ≥3 秒"（M2 §10.3）。
  const [drainLatch, setDrainLatch] = useState<DrainLatchState>(EMPTY_DRAIN_LATCH)
  const incomingDrain = stats?.drain
  useEffect(() => {
    setDrainLatch((previous) => latchDrain({ previous, incoming: incomingDrain, now: Date.now() }))
  }, [incomingDrain])
  // 驻留下限到点才允许清空（用真定时器；测试用假定时器推进，不真等 3 秒）。
  useEffect(() => {
    if (drainLatch.value === null) return undefined
    const remain = Math.max(0, drainLatch.until - Date.now())
    const timer = setTimeout(() => {
      setDrainLatch((previous) => latchDrain({ previous, incoming: null, now: Date.now() }))
    }, remain)
    return () => clearTimeout(timer)
  }, [drainLatch])
  /** R2：子代理收尾的运行期文案（latch 后渲染；从未收到过 ⇒ undefined ⇒ 不渲染）。 */
  const drainText = drainBannerTextOf(drainLatch.value)

  const levelToken = (model?.levelToken ?? 'ok') as 'ok' | 'warn' | 'danger'
  // R6（2026-10-20 止血，维护者决定）：子代理会话**照常显示健康度**，但手动「换会话」置灰。
  // 判据来自宿主 RPC 的 `subagent` 字段（内核强制字段 + 投影算出来的），客户端不猜标题。
  const isSubagent = dto?.subagent === true

  const doHandoff = useCallback(async (options?: { note?: string; skillRefs?: string[] }) => {
    const remote = remoteOf(ctx)
    if (remote === undefined) {
      setNotice('宿主半边的 remote.sessionHandoff 没挂上')
      return
    }
    setBusy(true)
    // ⚠️ 必须有 try/catch：RPC **调用本身**抛错时（编解码拒绝、传输失败、宿主半边没挂上），
    //    没有兜底就会让 `busy` 永远停在 true —— 按钮变"处理中…"、再点没反应、也不给任何提示。
    //    （2026-10-10 实机事故：宿主返回的结果少了 `childSessionId`、多了 `sessionId`，
    //      被严格 codec 拒绝，用户看到的就是"点了没反应"。）
    let result: ReturnType<typeof unwrapRemote>
    try {
      // R4：第三参**可选**；不传 ⇒ 与旧行为逐字节一致（A7 兼容）。
      // 留言与技能引用在**这一刻**一次性采集完（先于 drain，M1 §12.5）。
      result = unwrapRemote(await remote.handoffNow(sessionId, 'client', options))
    } catch (thrown) {
      setBusy(false)
      setNotice(`换会话调用失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
      return
    }
    setBusy(false)
    // ⚠️ **两层 ok**（2026-10-14 PK-030）：外层 `result.ok` 是**网关的信封**
    //    （一次一元调用恒为 `{ok,value}` / `{ok,error}`），内层 `value.ok` 才是宿主服务自己的结果。
    //    以前只看外层 ⇒ 宿主明明返回失败（ok:false + error），界面照样报"换会话已开始执行"。
    if (!result.ok) {
      setNotice(`换会话没成功：${result.error}`)
    } else {
      const value = result.value as HandoffResultPayload | undefined
      if (value?.ok === true) {
        // 成功（含排队）：关卡片；留言草稿保留在 state（用户在弹下一张卡时还能看到上次写的）。
        setCardOpen(false)
        setSkillPanelOpen(false)
        setNotice(value.queued === true ? '已排队：等当前这一步结束后执行换会话' : '换会话已开始执行')
      } else {
        // M2 §11.5：`ok:false` ⇒ 卡片**不关**（用户可改留言重试）。
        setNotice(`换会话没成功：${value?.error ?? '未知原因'}`)
      }
    }
    refresh()
  }, [ctx, sessionId, refresh])

  // R4：技能面板**首次展开时才拉目录**（A1：出卡片零 RPC；失败 → 面板错误态，不阻塞换会话）。
  // ⚠️ 用 ref 做「在途」守卫，而不是把 `skillState.status` 放进依赖：
  //    否则 `idle→loading` 这次 setState 会触发 effect 重跑 → cleanup 把在途请求判成"已卸载"，
  //    结果永远停在「正在读取技能…」（组件测试抓到的真 bug）。
  const skillLoadingRef = useRef(false)
  useEffect(() => {
    if (!skillPanelOpen || skillLoadingRef.current || skillState.status !== 'idle') return undefined
    const remote = remoteOf(ctx)
    if (remote === undefined || typeof remote.listSkills !== 'function') {
      setSkillState({ status: 'error', error: R4_HINTS.LIST_SKILLS_UNSUPPORTED })
      return undefined
    }
    let stopped = false
    skillLoadingRef.current = true
    setSkillState({ status: 'loading' })
    void (async () => {
      try {
        const result = unwrapRemote(await remote.listSkills(sessionId))
        if (!stopped) {
          if (result.ok) {
            const value = result.value as SkillListPayload | undefined
            setSkillState({ status: 'ok', skills: Array.isArray(value?.skills) ? value.skills : [] })
          } else {
            setSkillState({ status: 'error', error: result.error })
          }
        }
      } catch (thrown) {
        if (!stopped) setSkillState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
      } finally {
        skillLoadingRef.current = false
      }
    })()
    return () => { stopped = true }
  }, [skillPanelOpen, ctx, sessionId])

  // R4：关面板三条路之「点面板外」（点「技能」按钮本身在 root 内，交给按钮自己的开关）。
  useEffect(() => {
    if (!skillPanelOpen) return undefined
    const onDocDown = (event: { target?: unknown }) => {
      const node = skillRootRef.current
      const target = event?.target
      if (node && target && typeof node.contains === 'function' && node.contains(target as Node)) return
      setSkillPanelOpen(false)
    }
    document.addEventListener('mousedown', onDocDown as EventListener)
    return () => document.removeEventListener('mousedown', onDocDown as EventListener)
  }, [skillPanelOpen])

  /** 技能面板点行：插入逐字 ` /技能名 ` 到**光标处**；面板不关、清残留错误（A5/A6）。 */
  const applySkill = useCallback((skill: SkillEntry) => {
    const el = noteRef.current
    if (noteLengthOf(draftNote) >= MAX_NOTE_CHARS) {
      setInsertError(R4_HINTS.NOTE_FULL)
      return
    }
    const inserted = insertSkillText({
      note: draftNote,
      name: skill.name,
      start: el?.selectionStart ?? undefined,
      end: el?.selectionEnd ?? undefined,
    })
    setDraftNote(inserted.note)
    setSkillRefs((previous) => pushSkillRef(previous, skill.ref))
    setInsertError(undefined)
    if (el && typeof el.setSelectionRange === 'function' && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => el.setSelectionRange(inserted.caret, inserted.caret))
    }
  }, [draftNote])

  /** Esc：面板开着就先关面板，否则关卡片（三条关闭路之一）。 */
  const onCardKeyDown = useCallback((event: { key?: string; preventDefault?: () => void }) => {
    if (event?.key !== 'Escape') return
    event.preventDefault?.()
    if (skillPanelOpen) setSkillPanelOpen(false)
    else setCardOpen(false)
  }, [skillPanelOpen])

  if (model === undefined) {
    return h('div', { className: cx(`${CSS_NS}-health`), 'data-level': 'ok' },
      h('span', { className: cx(`${CSS_NS}-health-empty`) }, error === undefined ? '正在读取会话用量…' : `读取不到会话用量：${error}`),
      h(Button, { onClick: refresh, title: '重新读取', children: '重试' }),
      failureMessage === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-failure`) }, failureMessage),
    )
  }

  const conclusion = model.conclusion
  return h('div', { className: cx(`${CSS_NS}-health`), 'data-level': levelToken, 'aria-label': ariaSummary(model) },
    h('div', { className: cx(`${CSS_NS}-health-main`) },
      h(Meter, { label: '上下文', text: model.context.text, fill: model.context.fill, marker: model.context.marker, level: levelToken }),
      h(Meter, { label: '会话', text: model.volume.text, fill: model.volume.fill, marker: model.volume.marker, level: levelToken }),
      h('button', {
        type: 'button',
        className: cx(`${CSS_NS}-verdict`),
        'aria-expanded': open,
        title: '点开看明细',
        onClick: () => setOpen((value) => !value),
      }, conclusion.text),
      h(Button, {
        variant: 'primary',
        onClick: () => { if (isSubagent) return; setCardOpen(true) },
        disabled: busy || isSubagent,
        title: isSubagent ? SUBAGENT_TEXTS.DISABLED_HINT : '手工换会话（优先级最高）',
        children: busy ? '处理中…' : '换会话',
      }),
    ),
    notice === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-notice`) }, notice),
    // R4（2026-10-17）：手动换会话的**自绘卡片**（出卡片零 RPC；取消保留草稿；A1/A5/A6）。
    // 文案逐字来自 R4_TEXTS（清单 §1）；技能面板数据来自 listSkills（首次展开才拉）。
    cardOpen ? h('div', {
      className: cx(`${CSS_NS}-manual-card`),
      role: 'dialog',
      'aria-label': R4_TEXTS.CARD_TITLE,
      onKeyDown: onCardKeyDown,
    },
    h('div', { className: cx(`${CSS_NS}-manual-title`) }, R4_TEXTS.CARD_TITLE),
    h('div', { className: cx(`${CSS_NS}-manual-facts`) },
      h('span', null, conclusion.text),
      h('span', null, `上下文 ${model.context.text}`),
      h('span', null, `会话 ${model.volume.text}`),
    ),
    h('div', { className: cx(`${CSS_NS}-manual-label`) }, R4_TEXTS.NOTE_LABEL),
    h('div', { className: cx(`${CSS_NS}-manual-hint`) }, R4_TEXTS.NOTE_HINT),
    h('textarea', {
      className: cx(`${CSS_NS}-manual-note`),
      'aria-label': R4_TEXTS.NOTE_LABEL,
      rows: 2,
      maxLength: MAX_NOTE_CHARS,
      placeholder: R4_TEXTS.NOTE_PLACEHOLDER,
      value: draftNote,
      ref: noteRef,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraftNote(clampNoteByCodePoints(event.target.value)),
    }),
    h('div', {
      className: cx(`${CSS_NS}-manual-count`),
      ...(noteCountIsFull(draftNote) ? { 'data-full': 'true' } : {}),
    }, noteCountText(draftNote)),
    h('div', { className: cx(`${CSS_NS}-manual-hint`) }, R4_TEXTS.NOTE_EMPTY_HINT),
    h('div', { className: cx(`${CSS_NS}-manual-skillbar`), ref: skillRootRef },
      h(Button, {
        variant: 'ghost',
        onClick: () => setSkillPanelOpen((value) => !value),
        children: [
          h('svg', {
            key: 'star',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.8',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            className: cx(`${CSS_NS}-skill-btn-icon`),
          }, h('path', { d: 'M12 3l2.1 5.1L19.5 10l-4.3 3.5 1.2 5.5L12 16.2 7.6 19l1.2-5.5L4.5 10l5.4-1.9z' })),
          R4_TEXTS.SKILL_BUTTON,
        ],
      }),
      skillPanelOpen ? h('div', { className: cx(`${CSS_NS}-skill-panel`), role: 'dialog', 'aria-label': R4_TEXTS.SKILL_BUTTON },
        h('div', { className: cx(`${CSS_NS}-skill-hint`) }, R4_TEXTS.SKILL_PANEL_HINT),
        h('input', {
          className: cx(`${CSS_NS}-skill-search`),
          'aria-label': R4_TEXTS.SKILL_SEARCH_PLACEHOLDER,
          placeholder: R4_TEXTS.SKILL_SEARCH_PLACEHOLDER,
          value: skillQuery,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setSkillQuery(event.target.value),
          onKeyDown: onCardKeyDown,
        }),
        skillState.status === 'loading' ? h('div', { className: cx(`${CSS_NS}-skill-hint`) }, R4_HINTS.SKILL_LOADING) : null,
        skillState.status === 'error' ? h('div', { className: cx(`${CSS_NS}-skill-hint`), 'data-tone': 'error' }, `${R4_HINTS.SKILL_LIST_FAILED}${skillState.error}`) : null,
        insertError === undefined ? null : h('div', { className: cx(`${CSS_NS}-skill-hint`), 'data-tone': 'error' }, insertError),
        ...(() => {
          const filtered = filterSkills(skillState.skills ?? [], skillQuery)
          if (skillState.status === 'ok' && filtered.length === 0) {
            return [h('div', { key: 'skill-empty', className: cx(`${CSS_NS}-skill-hint`) }, R4_TEXTS.SKILL_EMPTY)]
          }
          return skillGroupsOf(filtered).map((group) => h('div', { key: group.group, className: cx(`${CSS_NS}-skill-group`) },
            h('div', { className: cx(`${CSS_NS}-skill-group-title`) }, group.label),
            ...group.skills.map((skill) => h('button', {
              key: skill.name,
              type: 'button',
              className: cx(`${CSS_NS}-skill-row`),
              onMouseDown: (event: { preventDefault?: () => void }) => { event.preventDefault?.(); applySkill(skill) },
            },
            h('span', { className: cx(`${CSS_NS}-skill-row-ico`), 'aria-hidden': 'true' }, skillInitialOf(skill.displayName)),
            h('span', { className: cx(`${CSS_NS}-skill-row-main`) },
              h('span', { className: cx(`${CSS_NS}-skill-row-name`) }, skill.displayName),
              h('span', { className: cx(`${CSS_NS}-skill-row-desc`) }, skill.description),
            ),
            h('span', { className: cx(`${CSS_NS}-skill-row-slug`) }, `/${skill.name}`),
            )),
          ))
        })(),
      ) : null,
    ),
    // R4 补（task-27）：卡片内「交接文档预览」—— 默认收起、纯视觉、零 RPC。
    // 有留言时最上面多一条 `0. 交接人留言`（内容实时跟随输入）；小节数提示随之联动。
    (() => {
      const preview = handoffPreviewOf({ note: draftNote, sectionTitles: HANDOFF_DOC_SECTION_TITLES })
      return h('details', {
        className: cx(`${CSS_NS}-preview`),
        open: previewOpen,
      },
      h('summary', {
        className: cx(`${CSS_NS}-preview-summary`),
        onClick: (event: { preventDefault?: () => void }) => { event.preventDefault?.(); setPreviewOpen((value) => !value) },
      },
      h('span', null, R4_TEXTS.PREVIEW_SUMMARY),
      h('span', { className: cx(`${CSS_NS}-preview-hint`) }, preview.hint),
      ),
      h('div', { className: cx(`${CSS_NS}-preview-body`) },
        ...preview.items.map((item) => h('div', { key: item.n, className: cx(`${CSS_NS}-preview-item`) },
          h('div', { className: cx(`${CSS_NS}-preview-n`) }, item.n),
          h('div', { className: cx(`${CSS_NS}-preview-c`) }, item.c),
        )),
      ),
      )
    })(),
    h('div', { className: cx(`${CSS_NS}-manual-actions`) },
      h(Button, {
        variant: 'primary',
        disabled: busy,
        onClick: () => { void doHandoff({ ...(draftNote.length === 0 ? {} : { note: draftNote }), ...(skillRefs.length === 0 ? {} : { skillRefs }) }) },
        children: busy ? '处理中…' : R4_TEXTS.CONFIRM,
      }),
      h(Button, {
        variant: 'ghost',
        disabled: busy,
        onClick: () => { setCardOpen(false); setSkillPanelOpen(false) },
        children: R4_TEXTS.CANCEL,
      }),
    ),
    ) : null,
    failureMessage === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-failure`) }, failureMessage),
    // R2（ARB-13 / M2 §10.3）：子代理收尾的运行期状态（逐字文案见 `drainBannerTextOf`）。
    // `drain === null` 时不渲染任何新元素（与 v1.1 表现完全一致）。
    drainText === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-notice`) }, drainText),
    // 明细做成**浮层**（绝对定位），展开时不会把同一行里其它插件的东西挤走。
    open ? h('div', { className: cx(`${CSS_NS}-detail-layer`) },
      h('table', { className: cx(`${CSS_NS}-detail`) },
        h('thead', null, h('tr', null,
          h('th', null, '指标'), h('th', null, '当前'), h('th', null, '阈值'), h('th', null, '距离'),
        )),
        h('tbody', null, ...model.detail.map((row) => h('tr', { key: row.label },
          h('td', null, row.label), h('td', null, row.current), h('td', null, row.limit), h('td', null, row.distance),
        ))),
      ),
    ) : null,
  )
}

// ─────────────────────────── S1 · 设置页 ───────────────────────────

/**
 * 交接文档行右侧的箭头（原型 `.doc-row .chev` 里的同一个 svg）。
 * @returns 元素。
 */
function ChevronIcon(): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  }, h('path', { d: 'M9 6l6 6-6 6' }))
}

/**
 * 交接文档卡头部的小图标（原型 `.doc-head-icon` 里的同一个 svg）。
 * @returns 元素。
 */
function FileIcon(): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  h('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z' }),
  h('path', { d: 'M14 3v5h5M9 13h6M9 17h4' }))
}

/**
 * 「完全权限」确认弹窗的警示图标（原型 `.modal-icon` 里的同一个 svg）。
 * @returns 元素。
 */
function WarnIcon(): ReactNode {
  return h('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  h('path', { d: 'M12 4.5l8.5 15h-17L12 4.5z' }),
  h('path', { d: 'M12 10v4M12 17h.01' }))
}

/**
 * 设置页（S1）。
 *
 * 导出是为了方便做组件级验证：新会话三项的下拉联动、「完全权限」确认弹窗的回退、
 * 文档列表的展开都发生在渲染里。
 *
 * @param props - 属性。
 * @returns 元素。
 */
export function SettingsPanel(props: { ctx: HandoffClientCtx }): ReactNode {
  const { ctx } = props
  const { stats, error, refresh } = useStats(ctx, [])
  const [draft, setDraft] = useState<ConfigPayload | undefined>(undefined)
  // P2-8：dirty = "用户有还没落盘的改动"。dirty 时宿主 config 变化**不许**覆盖草稿；
  // 保存成功 / 失败回滚后归零，草稿重新跟着宿主走。
  const [dirty, setDirty] = useState(false)
  const [draftMb, setDraftMb] = useState('20')
  const [draftTrigger, setDraftTrigger] = useState('')
  /** 「再涨多少才重问」的草稿（百分比字符串，与 MB / 压缩次数一样走"保存这几项"按钮）。 */
  const [draftRearm, setDraftRearm] = useState(String(HANDOFF_DEFAULTS.askRearmPercent))
  /** R2「等子代理交卷的最长时间」的草稿（分钟字符串，同款"保存 + 失败回滚"）。 */
  const [draftDrainMin, setDraftDrainMin] = useState(String(HANDOFF_DEFAULTS.subagentDrainTimeoutMin))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  /** 模型目录（S1「新会话用什么样的」；host 旧版本可能没有这个方法）。 */
  const [catalogState, setCatalogState] = useState<{ status: 'loading' | 'ok' | 'error'; value?: ModelCatalogLike; error?: string }>({ status: 'loading' })
  /** 工作权限档位表（同上）。 */
  const [presetsState, setPresetsState] = useState<{ status: 'loading' | 'ok' | 'error'; value?: PermissionPresetsLike; error?: string }>({ status: 'loading' })
  /** 新会话三项的下拉草稿（值与宿主 config 对齐，空串=跟随）。 */
  const [sessionChoice, setSessionChoice] = useState<SessionDefaultsChoice>({ model: FOLLOW_VALUE, effort: FOLLOW_VALUE, permission: FOLLOW_VALUE })
  /** 待确认的「完全权限」档位：非 undefined = 确认弹窗开着（此时**还没**落地）。 */
  const [permPending, setPermPending] = useState<string | undefined>(undefined)
  /** 交接文档列表：是否展开 / 数据 / 每份的正文缓存与读取失败。 */
  const [docListOpen, setDocListOpen] = useState(false)
  const [docState, setDocState] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; value?: DocListLike; error?: string }>({ status: 'idle' })
  const [docContent, setDocContent] = useState<Record<string, string>>({})
  const [docErrors, setDocErrors] = useState<Record<string, string>>({})
  const [openDocName, setOpenDocName] = useState<string | undefined>(undefined)
  /** 正在读的文档（防止同一份被重复读）。 */
  const docInflight = useRef<Set<string>>(new Set())
  // P2-8：保存成功后到 stats "回声"到达之前的记账。没有它，一次 3 秒轮询里
  // 已经发出去的**旧** stats 响应就会把刚保存的值顶回旧值（用户看到开关自己弹回去）。
  const pendingSave = useRef<PendingSave<ConfigPayload> | undefined>(undefined)

  // P2-8：宿主 config 变化且**不在编辑中**时同步草稿。
  // 原实现 `if (draft !== undefined) return` 只初始化一次，宿主改了再也不跟；
  // 这里改成"每轮 stats 都判一次"，但只有真变了才 setState（`draftSyncDecision` 保证）。
  // 不在渲染期间 setState：所有刷新都走这个 effect。
  useEffect(() => {
    if (stats === undefined) return
    const decision = draftSyncDecision({
      host: stats.config,
      draft,
      dirty,
      pending: pendingSave.current,
    })
    if (decision.clearPending) pendingSave.current = undefined
    if (!decision.sync) return
    const host = stats.config
    setDraft(host)
    setDraftMb(String(bytesToMb(host.sessionVolumeBytes)))
    setDraftTrigger(host.compactionCountTrigger === null ? '' : String(host.compactionCountTrigger))
    setDraftRearm(rearmDraftOf(host))
    setDraftDrainMin(drainDraftOf(host))
  }, [stats, dirty, draft])

  /**
   * P2-8：保存失败 → 草稿回滚成**宿主当前值**并提示。
   * 原实现只 `setNotice`，于是开关停在"用户改过但没存成功"的位置，下一次 patch
   * 还在脏草稿上合并。
   * @param message - 给用户看的提示。
   */
  const rollbackToHost = useCallback((message: string) => {
    pendingSave.current = undefined
    setNotice(message)
    setDirty(false)
    const host = stats?.config
    if (host === undefined) return
    setDraft(host)
    setDraftMb(String(bytesToMb(host.sessionVolumeBytes)))
    setDraftTrigger(host.compactionCountTrigger === null ? '' : String(host.compactionCountTrigger))
    setDraftRearm(rearmDraftOf(host))
    setDraftDrainMin(drainDraftOf(host))
    // 新会话三项也要跟着回滚，否则下拉会停在"用户改过但没存成功"的位置。
    setSessionChoice(sessionDraftFromConfig(host as SessionDefaultsHost))
  }, [stats])

  const patch = useCallback(async (next: Partial<ConfigPayload>) => {
    const remote = remoteOf(ctx)
    if (remote === undefined) {
      setNotice('宿主半边的 remote.sessionHandoff 没挂上，改不了设置')
      return
    }
    const merged = { ...(draft ?? ({} as ConfigPayload)), ...next }
    setDraft(merged)
    setDirty(true)
    setSaving(true)
    // ⚠️ 必须有 try/catch：RPC **调用本身**抛错时（连接没就绪、参数不符、编解码失败），
    //    没有兜底就会让 `saving` 永远停在 true —— 设置页所有控件变灰、再点没反应、也不给提示。
    //    （风格与文案习惯对齐同文件 `doHandoff`。）
    let result: ReturnType<typeof unwrapRemote>
    try {
      result = unwrapRemote(await remote.updateConfig(next as Record<string, unknown>))
    } catch (thrown) {
      setSaving(false)
      rollbackToHost(`保存失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
      return
    }
    setSaving(false)
    // ⚠️ **两层 ok**（2026-10-14 PK-030）：外层 `result.ok` 是网关信封、内层 `value.ok` 才是宿主的结果。
    //    以前只看外层 ⇒ 宿主落盘失败（ok:false + error）也会被显示成"已保存"，用户完全无感。
    if (!result.ok) {
      rollbackToHost(`保存失败：${result.error}`)
      return
    }
    const value = result.value as UpdatePayload | undefined
    if (value?.ok !== true) {
      rollbackToHost(`保存失败：${value?.error ?? '未知原因'}`)
      return
    }
    // P2-8：以宿主返回值为准刷新草稿、dirty 归零，并标记"等 stats 追上"。
    pendingSave.current = { before: stats?.config ?? value.config, after: value.config }
    setDraft(value.config)
    setDraftMb(String(bytesToMb(value.config.sessionVolumeBytes)))
    setDraftTrigger(value.config.compactionCountTrigger === null ? '' : String(value.config.compactionCountTrigger))
    setDraftRearm(rearmDraftOf(value.config))
    setDraftDrainMin(drainDraftOf(value.config))
    setDirty(false)
    setNotice(value.rejected.length > 0 ? `已保存；忽略了不可改的键：${value.rejected.join(', ')}` : '已保存')
    refresh()
  }, [ctx, draft, stats, refresh, rollbackToHost])

  const saveNumbers = useCallback(async () => {
    const built = buildConfigPatch({
      enabled: draft?.enabled !== false,
      autoMode: draft?.autoMode,
      autoPromptLevel: draft?.autoPromptLevel,
      sessionVolumeMb: draftMb,
      compactionTrigger: draftTrigger,
      askRearmPercent: draftRearm,
      subagentDrainTimeoutMin: draftDrainMin,
      handoffDocPersist: draft?.handoffDocPersist !== false,
      decisionLogEnabled: draft?.decisionLogEnabled !== false,
    })
    if (!built.ok || built.patch === undefined) {
      setNotice(built.error)
      return
    }
    await patch(built.patch)
  }, [draft, draftMb, draftTrigger, draftRearm, draftDrainMin, patch])

  /**
   * 宿主 config 里"新会话四项"的当前值（用于 `buildSessionDefaultsPatch` 的"只送变化的键"）。
   * 草稿优先：保存是乐观更新，拿草稿比拿 3 秒一轮的 stats 更贴近用户刚看到的状态。
   */
  const sessionHost = useMemo<SessionDefaultsHost>(() => {
    const source = draft ?? stats?.config
    return {
      provider: source?.provider,
      model: source?.model,
      childReasoningEffort: source?.childReasoningEffort,
      childPermissionPreset: source?.childPermissionPreset,
    }
  }, [draft, stats?.config])

  // 宿主 config 里这四项变了（含首次到达）就把三项下拉对齐过去。
  useEffect(() => {
    if (stats?.config === undefined) return
    setSessionChoice(sessionDraftFromConfig(stats.config))
  }, [stats?.config?.provider, stats?.config?.model, stats?.config?.childReasoningEffort, stats?.config?.childPermissionPreset])

  // 模型目录 + 权限档位表：挂载时各拉一次；失败/不支持都要能在界面上看出原因。
  useEffect(() => {
    const remote = remoteOf(ctx)
    if (remote === undefined) {
      const message = '宿主半边的 remote.sessionHandoff 没挂上'
      setCatalogState({ status: 'error', error: message })
      setPresetsState({ status: 'error', error: message })
      return
    }
    let stopped = false
    void (async () => {
      try {
        if (typeof remote.listModelCatalog !== 'function') {
          if (!stopped) setCatalogState({ status: 'error', error: '宿主版本较旧，没有 listModelCatalog 这个方法' })
        } else {
          const result = unwrapRemote(await remote.listModelCatalog())
          if (!stopped) {
            if (result.ok) setCatalogState({ status: 'ok', value: result.value as ModelCatalogLike })
            else setCatalogState({ status: 'error', error: result.error })
          }
        }
      } catch (thrown) {
        if (!stopped) setCatalogState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
      }
    })()
    void (async () => {
      try {
        if (typeof remote.listPermissionPresets !== 'function') {
          if (!stopped) setPresetsState({ status: 'error', error: '宿主版本较旧，没有 listPermissionPresets 这个方法' })
        } else {
          const result = unwrapRemote(await remote.listPermissionPresets())
          if (!stopped) {
            if (result.ok) setPresetsState({ status: 'ok', value: result.value as PermissionPresetsLike })
            else setPresetsState({ status: 'error', error: result.error })
          }
        }
      } catch (thrown) {
        if (!stopped) setPresetsState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
      }
    })()
    return () => { stopped = true }
  }, [ctx])

  /**
   * 拉一次交接文档列表（`remote.listHandoffDocs`）。
   * ⚠️ 同 `patch`：RPC 调用本身抛错时给一句人话，别让异常变成未处理的 Promise。
   */
  const loadDocs = useCallback(async () => {
    const remote = remoteOf(ctx)
    if (remote === undefined) {
      setDocState({ status: 'error', error: '宿主半边的 remote.sessionHandoff 没挂上' })
      return
    }
    setDocState({ status: 'loading' })
    try {
      const result = unwrapRemote(await remote.listHandoffDocs())
      if (result.ok) setDocState({ status: 'ok', value: result.value as DocListLike })
      else setDocState({ status: 'error', error: result.error })
    } catch (thrown) {
      setDocState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
    }
  }, [ctx])

  // 挂载就拉一次：列表区的「共 N 份」角标要能直接显示（照原型）。
  useEffect(() => { void loadDocs() }, [loadDocs])

  /**
   * 读一份交接文档的正文（详情 + 列表行里的「触发原因」都用它）。
   * 同一份不会重复读（`docInflight`）。
   * @param name - 文件名。
   */
  const loadDocContent = useCallback(async (name: string) => {
    if (name.length === 0 || docInflight.current.has(name)) return
    docInflight.current.add(name)
    const remote = remoteOf(ctx)
    if (remote === undefined) {
      setDocErrors((prev) => ({ ...prev, [name]: '宿主半边的 remote.sessionHandoff 没挂上' }))
      docInflight.current.delete(name)
      return
    }
    try {
      const result = unwrapRemote(await remote.readHandoffDoc(name, true))
      if (result.ok) {
        const value = result.value as HandoffDocPayload
        setDocContent((prev) => ({ ...prev, [name]: value.found ? (value.content ?? '(空文档)') : '(这一份已经不在了)' }))
      } else {
        setDocErrors((prev) => ({ ...prev, [name]: `读不到：${result.error}` }))
      }
    } catch (thrown) {
      setDocErrors((prev) => ({ ...prev, [name]: `读取交接文档失败：${thrown instanceof Error ? thrown.message : String(thrown)}` }))
    } finally {
      docInflight.current.delete(name)
    }
  }, [ctx])

  // 宿主旧版本没在 files[] 里给 `reason` 时，逐份把正文读回来解析触发原因（列表行要用）。
  // 每轮最多并发 4 份，读完的会进 docContent ⇒ 下一轮跳过，不会死循环。
  // 宿主 2026-10-12 起直接给 `reason`，这条路径平时不会触发（不会对着每份文档各发一次读）。
  useEffect(() => {
    if (!docListOpen || docState.status !== 'ok') return
    const pending = (docState.value?.files ?? []).filter((file) => {
      const name = typeof file?.name === 'string' ? file.name : ''
      if (name.length === 0) return false
      if (typeof file?.reason === 'string' && file.reason.length > 0) return false
      return docContent[name] === undefined && docErrors[name] === undefined && !docInflight.current.has(name)
    })
    if (pending.length === 0) return
    for (const file of pending.slice(0, 4)) void loadDocContent(String(file?.name))
  }, [docListOpen, docState, docContent, docErrors, loadDocContent])

  /** 每份文档 → 触发原因短标签（正文还没读回来时是 undefined）。 */
  const docReasons = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    for (const [name, content] of Object.entries(docContent)) map[name] = docTriggerReasonOf(content)
    return map
  }, [docContent])

  /** 交接文档列表的视图模型（失败态也给得出来，界面不会静默变空）。 */
  const docView = useMemo<DocListViewModel | undefined>(() => {
    if (docState.status === 'error') {
      return docListViewModel({ result: { ok: false, error: docState.error ?? 'unknown error' } })
    }
    if (docState.status !== 'ok') return undefined
    return docListViewModel({ result: { ok: true, value: docState.value ?? {} }, reasons: docReasons })
  }, [docState, docReasons])

  const modelOptions = useMemo(
    () => buildModelOptions({ catalog: catalogState.value, current: draft ?? stats?.config }),
    [catalogState.value, draft, stats?.config],
  )
  const effortOptions = useMemo(
    () => effortOptionsOf({
      catalog: catalogState.value,
      modelValue: sessionChoice.model,
      currentEffort: sessionHost.childReasoningEffort,
    }),
    [catalogState.value, sessionChoice.model, sessionHost.childReasoningEffort],
  )
  const permissionOptions = useMemo(
    () => buildPermissionOptions({
      presets: presetsState.value,
      current: sessionChoice.permission === FOLLOW_VALUE ? '' : sessionChoice.permission,
    }),
    [presetsState.value, sessionChoice.permission],
  )

  /**
   * 落地一次新会话三项的选择：**只把真的变了的键**送宿主（全跟随 = 一个键都不送）。
   * @param next - 新的三项选择。
   */
  const applySessionChoice = useCallback((next: SessionDefaultsChoice) => {
    setSessionChoice(next)
    const built = buildSessionDefaultsPatch({ choice: next, host: sessionHost })
    if (built.keys.length === 0) return
    void patch(built.patch as Partial<ConfigPayload>)
  }, [sessionHost.provider, sessionHost.model, sessionHost.childReasoningEffort, sessionHost.childPermissionPreset, patch])

  const changeModel = useCallback((value: string) => {
    applySessionChoice(nextChoiceForModel({ choice: sessionChoice, catalog: catalogState.value, nextModelValue: value }))
  }, [applySessionChoice, sessionChoice, catalogState.value])

  const changeEffort = useCallback((value: string) => {
    applySessionChoice({ ...sessionChoice, effort: value })
  }, [applySessionChoice, sessionChoice])

  const changePermission = useCallback((value: string) => {
    // 选到「完全权限」**先不落地**：弹确认，取消就保持原样（回退到之前的选项）。
    if (value === DANGER_PERMISSION) {
      setPermPending(value)
      return
    }
    applySessionChoice({ ...sessionChoice, permission: value })
  }, [applySessionChoice, sessionChoice])

  const cancelDanger = useCallback(() => { setPermPending(undefined) }, [])

  const confirmDanger = useCallback(() => {
    setPermPending(undefined)
    applySessionChoice({ ...sessionChoice, permission: DANGER_PERMISSION })
  }, [applySessionChoice, sessionChoice])

  /**
   * 「打开存储目录」：宿主没有"打开目录"这个接口（不新造），所以把目录路径复制给用户，
   * 让他直接在文件管理器里打开。拿不到目录时给一句人话。
   */
  const openDocDir = useCallback(async () => {
    const dir = docState.value?.dir ?? stats?.docDir ?? ''
    if (dir.length === 0) {
      setNotice('还不知道存储目录在哪，先点一下「查看已有交接文档」')
      return
    }
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(dir)
        setNotice(`存储目录已复制：${dir}（在文件管理器里粘贴打开）`)
        return
      } catch {
        // 复制被浏览器拒绝：退化成把路径显示出来。
      }
    }
    setNotice(`存储目录：${dir}`)
  }, [docState.value, stats?.docDir])

  const toggleDocRow = useCallback((name: string) => {
    setOpenDocName((current) => (current === name ? undefined : name))
    if (docContent[name] === undefined && docErrors[name] === undefined) void loadDocContent(name)
  }, [docContent, docErrors, loadDocContent])

  if (stats === undefined) {
    return h('div', { className: cx(`${CSS_NS}-panel`) },
      h('div', { className: cx(`${CSS_NS}-panel-title`) }, '会话接力'),
      h('div', { className: cx(`${CSS_NS}-row-hint`) }, error === undefined ? '正在读取…' : `读取不到配置：${error}`),
    )
  }

  const config = draft ?? stats.config
  return h('div', { className: cx(`${CSS_NS}-panel`) },
    h('div', { className: cx(`${CSS_NS}-panel-head`) },
      h('div', { className: cx(`${CSS_NS}-panel-title`) }, '会话接力'),
      h('div', { className: cx(`${CSS_NS}-panel-sub`) }, '上下文满了或会话太重时，帮你换一个干净的新会话'),
    ),

    // —— 总开关 ——
    h(Row, { title: '启用会话接力', hint: config.enabled ? '已开启' : '已关闭（不换会话、不提示、不触发）' },
      h(Switch, { checked: config.enabled, label: '启用会话接力', disabled: saving, onChange: (next) => { void patch({ enabled: next }) } }),
    ),

    // —— 模式三选一（横向一行三卡；窄屏竖排） ——
    h('div', { className: cx(`${CSS_NS}-group`) },
      h('div', { className: cx(`${CSS_NS}-group-title`) }, '选一个档位'),
      h('div', { className: cx(`${CSS_NS}-modes`) },
        ...MODE_CARDS.map((card) => h('button', {
          key: card.id,
          type: 'button',
          disabled: saving,
          'aria-pressed': config.autoMode === card.id,
          className: cx(`${CSS_NS}-mode`, config.autoMode === card.id && 'is-active'),
          onClick: () => { void patch({ autoMode: card.id as ConfigPayload['autoMode'] }) },
        },
        h('div', { className: cx(`${CSS_NS}-mode-head`) },
          h('span', { className: cx(`${CSS_NS}-mode-title`) }, card.title),
          card.recommended ? h('span', { className: cx(`${CSS_NS}-badge`) }, '推荐') : null,
        ),
        h('div', { className: cx(`${CSS_NS}-mode-desc`) }, card.description),
        h('div', { className: cx(`${CSS_NS}-mode-when`) }, card.when),
        card.warning === undefined ? null : h('div', { className: cx(`${CSS_NS}-mode-warn`) }, card.warning),
        )),
      ),
    ),

    // —— 安全阀 ——
    h('div', { className: cx(`${CSS_NS}-group`) },
      h('div', { className: cx(`${CSS_NS}-group-title`) }, '安全阀'),
      h(Row, { title: '会话体积阈值', hint: '混合模式下，会话体积超这条线就换会话（图片/附件已算在里面）' },
        // P2-8：敲输入框也算"编辑中"——否则每 3 秒一次轮询会把用户敲到一半的数字冲掉。
        h(NumberInput, { value: draftMb, onChange: (value) => { setDirty(true); setDraftMb(value) }, unit: 'MB', ariaLabel: '会话体积阈值', min: 1, max: 512 }),
      ),
      h(Row, { title: '每压缩 N 次上下文后执行硬切', hint: '留空 = 不启用；仅混合模式生效；换会话后计数归零' },
        h(NumberInput, { value: draftTrigger, onChange: (value) => { setDirty(true); setDraftTrigger(value) }, placeholder: '留空不启用', ariaLabel: '压缩次数修正线', min: 1, max: 100 }),
      ),
      h(Row, { title: '「先不接力」后再涨多少才重问', hint: '点过「先不接力」后，会话体积再涨这么多才会再问你一次（百分比；默认 50）' },
        h(NumberInput, {
          value: draftRearm,
          onChange: (value) => { setDirty(true); setDraftRearm(value) },
          unit: '%',
          ariaLabel: '再涨多少才重问',
          min: HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT,
          max: HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT,
        }),
      ),
      // R2（2026-10-14）：安全阀**最后一行** —— 换会话前等子代理交卷的最长时间。
      // 文案逐字照《冻结口径清单-2026-10-14》§5 / 原型 S1（里层「打断它」「所有子代理交完卷才换会话」加粗）。
      h('div', { className: cx(`${CSS_NS}-setting-row`) },
        h('div', { className: cx(`${CSS_NS}-setting-label`) },
          h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '换会话前，等子代理交卷的最长时间'),
          h('div', { className: cx(`${CSS_NS}-setting-label-d`) },
            '先请子代理收尾、写它自己的交接文档；到时间还没完的就',
            h('strong', null, '打断它'),
            '，让它专心写文档。',
            h('strong', null, '所有子代理交完卷才换会话。'),
          ),
        ),
        h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
          h(NumberInput, {
            value: draftDrainMin,
            onChange: (value) => { setDirty(true); setDraftDrainMin(value) },
            unit: '分钟',
            ariaLabel: '换会话前，等子代理交卷的最长时间',
            min: HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN,
            max: HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN,
          }),
        ),
      ),
      h('div', { className: cx(`${CSS_NS}-actions`) },
        h(Button, { variant: 'primary', onClick: () => { void saveNumbers() }, disabled: saving, children: saving ? '保存中…' : '保存这几项' }),
      ),
    ),

    // —— 该换会话的时候怎么做 ——
    h('div', { className: cx(`${CSS_NS}-group`) },
      h('div', { className: cx(`${CSS_NS}-group-title`) }, '该换会话的时候怎么做'),
      // ⚠️ 必须显式实例化泛型参数：`h(Segmented, {…})` 走 `createElement` 时，
      //    `Segmented<T extends string>` 的 T 会被实例化成 `string`（createElement 只按
      //    `FunctionComponent<P>` 反推 P，不会把 props 里的联合类型传回组件泛型），
      //    于是 `next` 是 string、赋不进 `autoPromptLevel` 的联合类型。
      h(Segmented<ConfigPayload['autoPromptLevel']>, {
        name: '自动程度',
        value: config.autoPromptLevel,
        options: PROMPT_LEVELS,
        onChange: (next) => { void patch({ autoPromptLevel: next }) },
      }),
      h('div', { className: cx(`${CSS_NS}-row-hint`) }, PROMPT_LEVELS.find((level) => level.id === config.autoPromptLevel)?.description ?? ''),
    ),

    // —— 新会话用什么样的（2026-10-12 新增，照《汇总原型图》1:1） ——
    //    文案 / 顺序 / 层级全部逐字照原型；三项的"当前值"都来自宿主 config（空串 = 跟随）。
    h('div', { className: cx(`${CSS_NS}-card`) },
      h('div', { className: cx(`${CSS_NS}-card-head`) },
        h('h2', { className: cx(`${CSS_NS}-card-title`) }, '新会话用什么样的'),
        h('p', { className: cx(`${CSS_NS}-card-desc`) },
          '新会话开出来之后，',
          h('strong', null, '用哪个模型、想多大力度、能改哪些文件'),
          '。三项都可以选「跟随原会话」——选了就跟现在完全一样。',
        ),
      ),

      // ① 新会话模型
      h('div', { className: cx(`${CSS_NS}-setting-row`) },
        h('div', { className: cx(`${CSS_NS}-setting-label`) },
          h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '新会话模型'),
          h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '第一项是「跟随原会话」；下面是这台机器上真正可用的模型（跟着 DSH 的模型目录走，按供应商分组）。'),
        ),
        h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
          h('select', {
            className: cx(`${CSS_NS}-select-input`),
            'aria-label': '新会话模型',
            value: sessionChoice.model,
            disabled: saving,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => changeModel(event.target.value),
          },
          h('option', { value: FOLLOW_VALUE }, modelOptions.follow.label),
          ...modelOptions.groups.map((group) => h('optgroup', { key: group.label, label: group.label },
            ...group.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          )),
          ...modelOptions.extra.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ),
        ),
      ),
      // 目录读取失败 / 局部失败：必须在界面上看得出来（不静默变空）
      catalogState.status === 'loading'
        ? h('div', { className: cx(`${CSS_NS}-choice-hint`) }, '正在读取模型目录…')
        : null,
      catalogState.status === 'error'
        ? h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, `读不到模型目录：${catalogState.error}`)
        : null,
      ...modelOptions.hints.map((hint, index) => h('div', { key: `model-hint-${index}`, className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, hint)),

      // ② 推理强度（选项跟着上面的模型变；模型选「跟随原会话」时自定义档位禁用）
      h('div', { className: cx(`${CSS_NS}-setting-row`) },
        h('div', { className: cx(`${CSS_NS}-setting-label`) },
          h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '推理强度'),
          h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '选项跟着上面的模型变——每个模型支持的档位不一样。'),
        ),
        h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
          h('select', {
            className: cx(`${CSS_NS}-select-input`),
            'aria-label': '推理强度',
            value: sessionChoice.effort,
            disabled: saving,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => changeEffort(event.target.value),
          },
          h('option', { value: FOLLOW_VALUE }, effortOptions.follow.label),
          ...effortOptions.options.map((option) => h('option', {
            key: option.value,
            value: option.value,
            disabled: option.disabled === true,
          }, option.label)),
          ),
        ),
      ),
      ...effortOptions.hints.map((hint, index) => h('div', { key: `effort-hint-${index}`, className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, hint)),

      // ③ 新会话的工作权限
      h('div', { className: cx(`${CSS_NS}-setting-row`) },
        h('div', { className: cx(`${CSS_NS}-setting-label`) },
          h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '新会话的工作权限'),
          h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '选「完全权限」时会弹一次确认；「跟随原会话」= 新会话的权限跟当前这个会话一模一样。'),
        ),
        h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
          h('select', {
            className: cx(`${CSS_NS}-select-input`),
            'aria-label': '新会话的工作权限',
            value: sessionChoice.permission,
            disabled: saving || !permissionOptions.supported,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => changePermission(event.target.value),
          },
          h('option', { value: FOLLOW_VALUE }, permissionOptions.follow.label),
          ...permissionOptions.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ...permissionOptions.extra.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ),
        ),
      ),
      presetsState.status === 'loading'
        ? h('div', { className: cx(`${CSS_NS}-choice-hint`) }, '正在读取工作权限档位…')
        : null,
      presetsState.status === 'error'
        ? h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, `读不到工作权限档位：${presetsState.error}`)
        : null,
      permissionOptions.hint === undefined
        ? null
        : h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, permissionOptions.hint),

      // ④ R1（2026-10-14）：新会话先提交计划 —— 紧接「新会话的工作权限」之后。
      // 开关即时写入（与既有开关同款）；右侧文字逐字：开=已开启 / 关=已关闭。
      h('div', { className: cx(`${CSS_NS}-setting-row`) },
        h('div', { className: cx(`${CSS_NS}-setting-label`) },
          h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '新会话先提交计划'),
          h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '读完交接文档后先给计划，确认后再动手。'),
        ),
        h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
          h('div', { className: cx(`${CSS_NS}-control-inline`) },
            h('span', { className: cx(`${CSS_NS}-choice-hint`) }, config.childPlanFirst !== false ? '已开启' : '已关闭'),
            h(Switch, {
              checked: config.childPlanFirst !== false,
              label: '新会话先提交计划',
              disabled: saving,
              onChange: (next) => { void patch({ childPlanFirst: next }) },
            }),
          ),
        ),
      ),

      h('div', { className: cx(`${CSS_NS}-choice-hint`) },
        '这三项',
        h('strong', null, '只影响新开出来的会话'),
        '：不改当前会话，也不改 DSH 的全局默认设置。想让某一项保持现状，就选「跟随原会话」。',
      ),
    ),

    // —— 交接文档 ——
    h('div', { className: cx(`${CSS_NS}-group`) },
      h('div', { className: cx(`${CSS_NS}-group-title`) }, '交接文档'),
      h(Row, { title: '把交接文档存到磁盘', hint: `存于 DSH 存储目录，不写入你的项目：${stats.docDir}` },
        h(Switch, { checked: config.handoffDocPersist, label: '交接文档落盘', disabled: saving, onChange: (next) => { void patch({ handoffDocPersist: next }) } }),
      ),

      // 已有交接文档：标题 + 「共 N 份」角标 + 两个按钮
      h('div', { className: cx(`${CSS_NS}-setting-row`) },
        h('div', { className: cx(`${CSS_NS}-setting-label`) },
          h('div', { className: cx(`${CSS_NS}-setting-label-t`) },
            '已有交接文档 ',
            h('span', { className: cx(`${CSS_NS}-badge`, `${CSS_NS}-badge-neutral`) }, `共 ${docView?.total ?? '…'} 份`),
          ),
          h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '按时间倒序（最新在最上面）。点一份就能看当时交接了什么。'),
        ),
        h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
          h('div', { className: cx(`${CSS_NS}-control-inline`) },
            h('button', {
              type: 'button',
              className: cx(`${CSS_NS}-btn`, 'is-ghost', `${CSS_NS}-btn-sm`),
              'aria-expanded': docListOpen,
              onClick: () => setDocListOpen((open) => !open),
            }, '查看已有交接文档'),
            h('button', {
              type: 'button',
              className: cx(`${CSS_NS}-btn`, 'is-ghost', `${CSS_NS}-btn-sm`),
              onClick: () => { void openDocDir() },
            }, '打开存储目录'),
          ),
        ),
      ),

      // 列表（默认收起；点开才显示）
      docListOpen
        ? h('div', { className: cx(`${CSS_NS}-doc-list`) },
          docState.status === 'loading'
            ? h('div', { className: cx(`${CSS_NS}-doc-more`) }, '正在读取交接文档…')
            : null,
          docView?.error === undefined
            ? null
            : h('div', { className: cx(`${CSS_NS}-doc-more`), 'data-tone': 'error' }, docView.error),
          docView === undefined || docView.ok === false
            ? null
            : docView.rows.map((row) => h('button', {
              key: row.key,
              type: 'button',
              className: cx(`${CSS_NS}-doc-row`, openDocName === row.name && 'is-open'),
              'aria-expanded': openDocName === row.name,
              onClick: () => toggleDocRow(row.name),
            },
            h('span', { className: cx(`${CSS_NS}-doc-when`) }, row.when),
            h('span', { className: cx(`${CSS_NS}-doc-who`) }, row.who),
            h('span', { className: cx(`${CSS_NS}-doc-size`) }, row.size),
            h('span', { className: cx(`${CSS_NS}-doc-chev`), 'aria-hidden': 'true' }, h(ChevronIcon)),
            )),
          docView?.empty === undefined
            ? null
            : h('div', { className: cx(`${CSS_NS}-doc-more`) }, docView.empty),
          docView?.more === undefined
            ? null
            : h('div', { className: cx(`${CSS_NS}-doc-more`) }, docView.more),
          )
        : null,

      // 选中那一份的全文（复用原型的文档卡片视觉）
      openDocName === undefined
        ? null
        : h('div', { className: cx(`${CSS_NS}-doc-detail`) },
          h('div', { className: cx(`${CSS_NS}-doc-card`) },
            h('div', { className: cx(`${CSS_NS}-doc-head`) },
              h('span', { className: cx(`${CSS_NS}-doc-head-icon`), 'aria-hidden': 'true' }, h(FileIcon)),
              h('div', null,
                h('div', { className: cx(`${CSS_NS}-doc-title`) }, '会话硬切交接文档（session handoff）'),
                h('div', { className: cx(`${CSS_NS}-doc-time`) }, detailTimeLine(
                  (docState.value?.files ?? []).find((file) => file?.name === openDocName)?.at ?? parseHandoffDocName(openDocName).at,
                  parseHandoffDocName(openDocName).sessionCode,
                )),
              ),
            ),
            h('div', { className: cx(`${CSS_NS}-doc-body`) },
              docErrors[openDocName] !== undefined
                ? h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, docErrors[openDocName])
                : (docContent[openDocName] === undefined
                  ? h('div', { className: cx(`${CSS_NS}-choice-hint`) }, '正在读取这一份…')
                  : h('pre', { className: cx(`${CSS_NS}-doc-text`) }, docContent[openDocName])),
            ),
          ),
        ),
    ),

    // —— 决策日志 ——
    h('div', { className: cx(`${CSS_NS}-group`) },
      h('div', { className: cx(`${CSS_NS}-group-title`) }, '决策日志'),
      h(Row, { title: '记录每次判定', hint: '记下"什么时候、因为什么、做了什么"，方便你回头看为什么这么选' },
        h(Switch, { checked: config.decisionLogEnabled, label: '决策日志', disabled: saving, onChange: (next) => { void patch({ decisionLogEnabled: next }) } }),
      ),
      stats.decisions.length === 0
        ? h('div', { className: cx(`${CSS_NS}-empty`) }, '还没有决策记录。等上下文接近阈值时，这里会记下它每次的判断依据。')
        : h('div', { className: cx(`${CSS_NS}-decisions`) }, ...stats.decisions.slice(0, 20).map((row, index) => h('div', { key: `${row.at}-${index}`, className: cx(`${CSS_NS}-decision`) },
          h('span', { className: cx(`${CSS_NS}-decision-time`) }, row.time),
          h('span', { className: cx(`${CSS_NS}-decision-badge`), 'data-action': row.action }, row.label),
          h('span', { className: cx(`${CSS_NS}-decision-human`) }, row.human),
          h('span', { className: cx(`${CSS_NS}-decision-meta`) }, `上下文 ${row.contextPercent} · 会话 ${row.volume} · 本链第 ${row.chainIndex} 棒`),
        ))),
    ),

    // —— 「完全权限」确认弹窗（照原型 S8；开着时不落地，确认了才保留） ——
    permPending === undefined
      ? null
      : h('div', { className: cx(`${CSS_NS}-modal-mask`) },
        h('div', {
          className: cx(`${CSS_NS}-modal-card`),
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': `${CSS_NS}-perm-modal-title`,
        },
        h('div', { className: cx(`${CSS_NS}-modal-head`) },
          h('span', { className: cx(`${CSS_NS}-modal-icon`), 'aria-hidden': 'true' }, h(WarnIcon)),
          h('h2', { className: cx(`${CSS_NS}-modal-title`), id: `${CSS_NS}-perm-modal-title` }, '给新会话「完全权限」？'),
        ),
        h('p', { className: cx(`${CSS_NS}-modal-body`) },
          '新开出来的会话将',
          h('strong', null, '不再弹审批提示'),
          '，可以直接修改工作区以外的文件、执行命令。',
          h('br'),
          '这个设置会一直生效，直到你把它改回其它档位。',
        ),
        h('div', { className: cx(`${CSS_NS}-modal-actions`) },
          h('button', {
            type: 'button',
            className: cx(`${CSS_NS}-btn`, 'is-ghost', `${CSS_NS}-btn-modal`),
            onClick: cancelDanger,
          }, '取消'),
          h('button', {
            type: 'button',
            className: cx(`${CSS_NS}-btn`, 'is-danger', `${CSS_NS}-btn-modal`),
            onClick: confirmDanger,
          }, '我了解，用完全权限'),
        ),
        ),
      ),

    notice === undefined ? null : h('div', { className: cx(`${CSS_NS}-notice`) }, notice),
  )
}

// ─────────────────────────── 挂载 ───────────────────────────

/**
 * 客户端插件挂载。
 * @param ctx - 客户端根上下文。
 */
export async function apply(ctx: HandoffClientCtx): Promise<void> {
  // ① 远程命名空间：先 mount，再取服务。失败只告警（插件其余部分仍可用）。
  //
  // ⚠️ 必须 **await**（2026-10-10 实机修正）：
  //    `$mount` 是 async，且它**内部自己就注册了 effect**
  //    （`dsh-api-gateway/lib/client.js`：`async $mount(contribution){ const owned =
  //      callerCtx.effect(async () => { ... }); await owned; return async () => { await owned() } }`）。
  //    原实现 `$mount(...).then(() => undefined)` 既没等它完成、又把返回的 disposer 丢了，
  //    于是设置页/健康度行常常在命名空间挂上之前就去读 `remote.sessionHandoff` ⇒ 一直"没挂上"。
  if (ctx.remote?.$mount !== undefined) {
    try {
      await ctx.remote.$mount(CONTRIBUTION)
    } catch (error: unknown) {
      console.warn(`[dsh-session-handoff] remote contribution mount failed: ${String((error as Error)?.message ?? error)}`)
    }
  } else {
    console.warn('[dsh-session-handoff] ctx.remote.$mount is unavailable; the health row will show a degraded state')
  }

  // ② S2：健康度行。挂在**输入框上方**、且整体居中。
  //
  // ⚠️ 槽位选择（2026-10-10 用户："我想做到对话框上面，并且能够自适应整体居中展示"）：
  //    两个候选槽位声明完全相同（都是 `{kind:"list", scope:"session"}`），但**位置与容器都不同**：
  //      · `conversation.input.dock` —— 渲染在 `.composerStack` 里、**位于 inputBar【之前】**
  //        （内核：`children:[ …, renderSlot("conversation.input.dock", zone), inputBar ]`）
  //        ⇒ **在输入框上方** ✅；容器 `.composerStack{flex-direction:column;gap:6px}` 是垂直列，
  //          所以必须靠 `align-self:center` 才能整体居中（见 styles.ts 的 `.dsh-handoff-health`）。
  //      · `conversation.composer.dock` —— 渲染在 InputBar 内部的状态栏行里
  //        （和原生 ContextMeter、轮次/token 统计同排）⇒ **在输入框下方**，不符合要求。
  //    结论：用 `conversation.input.dock`（在输入框上方）+ `align-self:center`（整体居中）。
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'session-handoff-health',
      order: 30,
      locale: 'session-handoff',
      inject: (sessionId: string) => ({ sessionId }),
    },
    ((props: { sessionId?: string }) => h(HealthRow, {
      ctx,
      sessionId: typeof props.sessionId === 'string' ? props.sessionId : '',
    })) as ComponentType<Record<string, unknown>>,
  ))

  // ③ S1：设置页。
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'session-handoff',
      order: 32,
      label: '会话接力',
      locale: 'session-handoff',
    },
    ((props: { renderSlot?: unknown }) => h(SettingsPanel, { ctx })) as ComponentType<Record<string, unknown>>,
  ))

  // ④ 上游蓝本：/handoff 命令完成后的自动跳转卡片。
  //    DSH 0.2.0-rc.2 的注册入口是 `ctx.uiConversation.events.register(definition)`，
  //    按内核惯例包在 `ctx.effect(...)` 里（`dsh-client-ui-plan` 同款写法）。
  const handoffDefinition = {
    kind: 'handoff',
    target: 'chat',
    match(event: unknown) {
      if (!isHandoffDone(event)) return null
      const text = (event as { data: { text: string } }).data.text
      const childId = extractChildId(text)
      if (childId === undefined) return null
      return { id: `handoff:${String((event as { data: { commandId: unknown } }).data.commandId)}`, role: 'start' }
    },
    start(_context: unknown, match: { event: { data: { text: string; commandId: unknown }; seq: number } }) {
      return {
        commandId: String(match.event.data.commandId),
        childId: extractChildId(match.event.data.text),
      }
    },
    update(context: { state?: unknown }) {
      return context.state
    },
    buildViewNode(context: {
      key: string
      id: string
      start?: { event: { seq: number } }
      state?: { commandId?: string; childId?: string }
    }) {
      const state = context.state
      if (state === undefined || typeof state.childId !== 'string') return null
      return {
        key: context.key,
        kind: 'handoff',
        id: context.id,
        target: 'chat',
        anchorSeq: context.start?.event.seq ?? 0,
        location: { kind: 'unresolved' },
        visibility: 'visible',
        data: { kind: 'handoff', commandId: state.commandId ?? '', childId: state.childId },
      }
    },
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => ctx.uiConversation.events.register(handoffDefinition), 'session-handoff: conversation definition')
  } else {
    ctx.uiConversation.events.register(handoffDefinition)
  }

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'handoff',
      locale: 'handoff',
      inject: (): { waitAndOpen: (sessionId: string) => Promise<void> } => ({
        waitAndOpen: async (sessionId: string) => {
          for (let attempt = 0; attempt < 12; attempt += 1) {
            if (ctx.sessions.binding(sessionId) !== undefined) {
              ctx.sessions.open(sessionId)
              return
            }
            await new Promise((resolve) => window.setTimeout(resolve, 500))
          }
          ctx.sessions.open(sessionId)
        },
      }),
    },
    HandoffOpenCard as ComponentType<Record<string, unknown>>,
  ))
}

/**
 * 客户端远程贡献（手写，结构照 `dsh-cost-meter/lib/client.js` 的 `tn` 常量）：
 * 每个 descriptor 只需要 `method` / `parameters` / `result`——
 * `service` 与 `namespace` 由网关按包的命名空间补全（见 `dsh-api-gateway/lib/client.js` 的 `installNamespace`）。
 *
 * ⚠️ codec 只要 `mode: 'strict'`（客户端 mount 校验只查这一项，见
 *    `dsh-api-gateway/lib/client.js:2067-2075`）；真正的取值校验在宿主侧（`lib/typert.host.mjs`）。
 */
/**
 * 造一个 strict codec。
 *
 * 形状**逐字对齐**宿主里能正常工作的 `dsh-cost-meter`：
 * `{ mode: 'strict', typeSymbol, schema, create: () => schema }`，
 * 其中 `schema` 只有 `parse`（客户端只做形状占位，真校验在宿主侧）。
 *
 * @param {string} name - 类型名（进 typeSymbol）。
 * @returns {object} codec。
 */
function codec(name: string): object {
  const schema = { parse: (value: unknown) => value }
  return { mode: 'strict', typeSymbol: `dsh-session-handoff#client/${name}`, schema, create: () => schema }
}

/**
 * 造一个"宽松但形状正确"的入参描述符。
 * @param {string} name - 参数名（同时作为 wire 字段名）。
 * @returns {object} 描述符。
 */
function param(name: string): object {
  return { name, wire: name, source: 'json', codec: codec(name) }
}

/**
 * 与宿主清单（`lib/typert.host.mjs` 的 `invocation()`）**逐字对应**的描述符骨架。
 *
 * ⚠️ 2026-10-10 实机修正：原实现只写了 `{ method, parameters }`，**缺了
 * `id` / `service` / `namespace` / `invocation` / `result`**。
 * 新版客户端网关 `dsh-api-gateway/lib/client.js` 的 `mountContribution` 会
 * **按 `descriptor.namespace` 分组**再 `installNamespace(namespace, descriptors)`；
 * `namespace` 缺失 ⇒ 建不出 `remote.sessionHandoff`，设置页只会看到
 * 「宿主半边的 remote.sessionHandoff 没挂上」。
 * 正确形状见 `dsh-cost-meter/lib/client.js`：
 *   `{ id: "dsh-cost-meter#costMeter/<m>", service: "costMeter", namespace: "costMeter",
 *      method, invocation: { kind: "direct" }, parameters: [...], result: <codec> }`
 *
 * @param {string} method - 方法名。
 * @returns {object} 描述符骨架。
 */
function descriptor(method: string): Record<string, unknown> {
  return {
    id: `dsh-session-handoff#sessionHandoff/${method}`,
    service: 'sessionHandoff',
    namespace: 'sessionHandoff',
    method,
    invocation: { kind: 'direct' },
  }
}

/** 客户端侧的远程贡献（必须与宿主清单的 7 条 invocation 一一对应）。 */
const CONTRIBUTION = {
  package: 'dsh-session-handoff',
  descriptors: [
    { ...descriptor('stats'), parameters: [param('sessionIds'), param('decisionLimit'), param('decisionFilter')], result: codec('stats') },
    { ...descriptor('updateConfig'), parameters: [param('patch')], result: codec('updateConfig') },
    { ...descriptor('handoffNow'), parameters: [param('sessionId'), param('source'), param('options')], result: codec('handoffNow') },
    { ...descriptor('cancelPending'), parameters: [param('sessionId')], result: codec('cancelPending') },
    { ...descriptor('confirm'), parameters: [param('sessionId'), param('reason'), param('detail')], result: codec('confirm') },
    { ...descriptor('readHandoffDoc'), parameters: [param('name'), param('read')], result: codec('readHandoffDoc') },
    { ...descriptor('listHandoffDocs'), parameters: [], result: codec('listHandoffDocs') },
    // S1「新会话用什么样的」：模型目录 + 权限档位表（宿主侧必须同步声明这两条 invocation，
    // 否则客户端贡献与宿主清单对不上，远程网关会挂不上）。
    { ...descriptor('listModelCatalog'), parameters: [], result: codec('listModelCatalog') },
    { ...descriptor('listPermissionPresets'), parameters: [], result: codec('listPermissionPresets') },
    // R4：卡片技能面板的技能目录（宿主清单必须同步声明，否则上面的"一一对应"断言会红）。
    { ...descriptor('listSkills'), parameters: [param('sessionId')], result: codec('listSkills') },
  ],
}
