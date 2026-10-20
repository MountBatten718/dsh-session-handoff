// 执行一次硬切：生成交接文档 → 建新会话 → 注入文档 → 给新会话起名 → 标记旧会话。
// （规格：M1 技术文档 §2.4；§五 错误降级；§六 并发与边界）
//
// 本模块**只吃注入进来的 ctx 与依赖**，不 import 任何 @deepseek-ai/* 包，
// 因此可以用假 ctx 做纯 Node 单测。
//
// ⚠️ PK-009（本块新发现，必须遵守）：
//   `agent.followup(msg)` **已经是持久投递**——它会把 `agent/inbox/spliced` 写进
//   会话日志（dsh-agent-loop/lib/index.js:190），并且 agent loop 会在该轮第一次
//   尝试时把被 claim 的消息本身 append 成 `user/message`
//   （dsh-agent-loop/lib/index.js:1046）。
//   所以 "自己 append + followup" 会让同一条消息**落两次日志**。
//   蓝本之所以能直接 append，是因为 /handoff 建完会话后**不唤醒** agent。
//   本块的自动/手工硬切要让新会话立刻干活，故**只 followup、不自己 append**。

import { randomUUID } from 'node:crypto'
import { composeHandoffDocument, checkHandoffDocument, countSubstantiveSections, deriveRequirementTitle, extractGoalObjective, HANDOFF_DOC_MARKER, hasChinese, extractOpenTodos, extractTodos, extractTouchedFileEntries, MIN_SUBSTANTIVE_SECTIONS, parseNarrativeTitle, parseSummarySections, sanitizeTitleName } from './handoff-doc.mjs'
import { EVENTS_UNAVAILABLE_REASON, NO_EVENTS_REASON, sessionEvents } from './session-events.mjs'
import { createTrace } from './handoff-trace.mjs'
import { LIMITS } from './constants.mjs'
import { drainSubagents } from './handoff-subagents.mjs'
import { normalizeNote } from './handoff-note.mjs'

/**
 * R1：`childPlanFirst = true` 时，给新会话首条消息追加的指令段（逐字固定，M1 §11.3）。
 *
 * ⚠️ **只进首条消息，绝不进交接文档正文**（doc / 落盘副本 / trace 长度全部不含它）：
 *    正文是"落盘的事实记录"，掺入行为指令会污染交接语义，也会牵动 `hasHandoffDoc()` 幂等链。
 */
export const CHILD_PLAN_FIRST_INSTRUCTION = [
  '---',
  '',
  '## 先给计划、等确认再动手',
  '',
  '读完上面的交接文档后先不要改任何东西：先用一份简短的计划表告诉我你打算怎么做（要做哪几件事、按什么顺序、各动哪些文件），等我说"开始"再动手。',
].join('\n')

/** 新会话首条消息的 source kind。**不能用 'plugin'**（PK-002 / v4 格式硬拒）。 */
export const HANDOFF_SOURCE = Object.freeze({ kind: 'handoff' })

/**
 * 一条事件里是否装着**我们注入的交接文档**（幂等判据，2026-10-12 独立复核的新 P1-1）。
 *
 * 为什么不能只看"有没有 user/message"：PK-009 说 `followup` 会**立刻**写
 * `agent/inbox/spliced`，而真正的 `user/message` 要等 agent loop 取件 —— 中间有时间窗。
 * 只按事件类型判断，会把"上次其实已经投进去了"的会话当成没投过，再投第二遍。
 *
 * @param {object} event - 会话事件。
 * @returns {boolean} 是交接文档返回 true。
 */
function carriesHandoffDoc(event) {
  try {
    return JSON.stringify(event?.data ?? {}).includes(HANDOFF_DOC_MARKER)
  } catch {
    return false
  }
}

/**
 * 子会话里是否已经收过交接文档（排队中或已成消息都算）。
 * @param {object} session - 子会话。
 * @returns {boolean} 已收过返回 true。
 */
function hasHandoffDoc(session) {
  const events = sessionEvents(session)
  if (!Array.isArray(events)) return false
  return events.some((event) => (
    (event?.type === 'user/message' || event?.type === 'agent/inbox/spliced') && carriesHandoffDoc(event)
  ))
}

/**
 * 子会话是否已被**用户**动过（而不是只有我们注入的交接文档）。
 *
 * ⚠️ 我们注入的文档本身就是一条 `user/message`；只按类型判断会把它误当成"用户动过"，
 * 于是丢下已经投递好的会话又新建一个（复核场景 B）。
 *
 * @param {object} session - 子会话。
 * @returns {boolean|undefined} true=用户动过；false=还是空壳；undefined=读不到事件。
 */
function userTouchedChild(session) {
  const events = sessionEvents(session)
  if (!Array.isArray(events)) return undefined
  return events.some((event) => event?.type === 'user/message' && !carriesHandoffDoc(event))
}

/** 旧会话标题前缀（格式 `交接出-<原会话名>→<接棒会话ID>`）。 */
export const HANDED_OFF_MARK = '交接出'

/** 新会话标题前缀（格式 `交接入-<新会话名>`）。 */
export const HANDED_IN_MARK = '交接入'

/** 标题标记的最大字符数（标题服务有上限；超长时压名字，**不压 ID**）。 */
export const MAX_MARKED_TITLE_CHARS = 120

/**
 * 把标题里**上一棒的标记**剥掉，只留原会话自己的名字（重复硬切时不让标记叠成一串）。
 * @param {string} title - 原始标题。
 * @returns {string} 干净的名字（空串表示没有名字）。
 */
export function stripHandoffMark(title) {
  let text = typeof title === 'string' ? title.trim() : ''
  if (text.length === 0) return ''
  // 旧格式：`⏏ 已换会话 → <id> · <名字>`
  const legacy = /^⏏\s*已换会话[^·]*·\s*(.*)$/u.exec(text)
  if (legacy !== null) text = legacy[1].trim()
  if (text.startsWith(`${HANDED_OFF_MARK}-`)) {
    // `交接出-<名字>→<接棒会话ID>`（也兼容早期 `交接出-<名字>-<id>`）
    const rest = text.slice(HANDED_OFF_MARK.length + 1)
    const arrow = rest.lastIndexOf('→')
    if (arrow > 0) text = rest.slice(0, arrow)
    else {
      const index = rest.lastIndexOf('-session-')
      text = index > 0 ? rest.slice(0, index) : ''
    }
  } else if (text.startsWith(`${HANDED_IN_MARK}-`)) {
    // `交接入-<新会话名>`
    text = text.slice(HANDED_IN_MARK.length + 1)
  }
  return text.replace(/^📋\s*/, '').replace(/^交接\s*·\s*/u, '').trim()
}

/**
 * 给旧会话标题加"交接出"标记，格式 **`交接出-原会话名称-接棒会话ID`**。
 *
 * 为什么不写成统一名字（2026-10-10 用户要求）：原会话被标记后如果千篇一律
 * （旧实现是 `⏏ 已换会话 → <id> · （无标题）`），侧栏里同样分不清谁是谁。
 * 现在：带上**它自己的名字** + 接棒的会话 ID（顺着 ID 就能找到新会话）。
 *
 * @param {string|undefined} title - 原标题（原会话自己的名字）。
 * @param {string} childSessionId - 接棒会话 id。
 * @param {string} [fallbackTitle] - 原会话没名字时用的兜底名字。
 * @returns {string} 带标记的标题。
 */
export function markOriginTitle(title, childSessionId, fallbackTitle) {
  // 名字也要清洗：防止上一棒留下的英文标签（如 `Original:`）被继承着传下去
  const own = sanitizeTitleName(stripHandoffMark(title), { maxChars: 60 })
  const fallback = sanitizeTitleName(stripHandoffMark(fallbackTitle), { maxChars: 60 })
  const base = own.length > 0 ? own : (fallback.length > 0 ? fallback : '无标题')
  const prefix = `${HANDED_OFF_MARK}-`
  const suffix = `→${childSessionId}`
  // 超长时**压名字、保住 ID**（ID 是这个标记里最不可替代的信息）
  const room = MAX_MARKED_TITLE_CHARS - prefix.length - suffix.length
  const name = base.length > room ? `${base.slice(0, Math.max(1, room - 1))}…` : base
  return `${prefix}${name}${suffix}`
}

/**
 * 生成新会话 id（可注入替换，便于测试）。
 * @returns {string} `session-<uuid>`。
 */
export function defaultNewSessionId() {
  return `session-${randomUUID()}`
}

/**
 * 读原会话的推理强度（与 provider/model 同处一份 `requestHeader().config`）。
 *
 * 为什么单独抽出来并吞异常：`requestHeader()` 是宿主对象上的方法，拿不到时**不该**
 * 让整次硬切失败；读不到就当"没有"，`resolveRoute` 会把这个键整个省掉（绝不传 undefined）。
 *
 * @param {object} session - 源会话。
 * @returns {string|undefined} 推理强度；读不到返回 undefined。
 */
function readOriginReasoningEffort(session) {
  try {
    const effort = session?.requestHeader?.()?.config?.reasoningEffort
    return typeof effort === 'string' && effort.length > 0 ? effort : undefined
  } catch {
    return undefined
  }
}

/**
 * 解析模型路由：优先插件配置，其次当前会话最近一次 request/header 记录的路由。
 *
 * 推理强度单列：配置里 `childReasoningEffort` 非空就用它，否则**跟随原会话**。
 * 读不到就不带这个键（`agentOptions` 里出现 undefined 会被宿主当成显式取值）。
 *
 * @param {object} session - 会话。
 * @param {{provider?: string, model?: string, childReasoningEffort?: string}} config - 已校验配置。
 * @returns {{provider: string, model: string, reasoningEffort?: string}|undefined} 路由。
 */
export function resolveRoute(session, config) {
  let route
  if (config?.provider !== undefined && config?.model !== undefined) {
    route = { provider: config.provider, model: config.model }
  } else {
    const header = session?.requestHeader?.()
    const fromHeader = header?.config
    if (fromHeader === null || typeof fromHeader !== 'object' || typeof fromHeader.provider !== 'string' || typeof fromHeader.model !== 'string') {
      return undefined
    }
    route = { provider: fromHeader.provider, model: fromHeader.model }
  }
  const effort = typeof config?.childReasoningEffort === 'string' && config.childReasoningEffort.length > 0
    ? config.childReasoningEffort
    : readOriginReasoningEffort(session)
  return effort === undefined ? route : { ...route, reasoningEffort: effort }
}

/**
 * 组装子会话的 agent preset 组合（照抄蓝本的公开服务调用：
 * agentPresets.resolve → mount）。无 preset 服务时退化为空 setup。
 *
 * ⚠️ **唯一实现**（2026-10-12 审查 P2-20）：`index.mjs` 的 `/handoff` 命令路径
 * 原本也抄了一份一模一样的；两份会各自漂移（当时就已经出现"一处 await、一处没有"的
 * 同型问题）。现在由本模块导出，命令路径直接 import。
 *
 * @param {object} ctx - Cordis 上下文。
 * @param {string|undefined} presetId - 原会话记录的 agent preset id。
 * @returns {Promise<{agentPreset?: string, setup: Function}>} 组合结果。
 */
export async function composeForPreset(ctx, presetId) {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) {
    return { setup: () => Promise.resolve() }
  }
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, resolvedId)
    },
  }
}

/**
 * 用纯结构化字段铺满 8 个小节（模型叙事缺席或失败时的**降级版**，M1 §五）。
 *
 * ⚠️ **不搬运会话原文**（2026-10-10 用户定调）：降级版只列**事实**——
 *   已做的事项（待办快照里 completed 的）、接下来要做的事项（in_progress / pending）、
 *   涉及文件、失败的调用。会话原文既长又会把文档结构糊掉，一律不进来。
 *   需要"带判断力"的几段（用户需求 / 方案梗概）交给模型写；
 *   模型没写出来就空着（渲染成占位符 `无`），不拿原文顶替。
 *
 * @param {object} input - 输入。
 * @param {Array<object>} input.events - 源会话事件。
 * @param {string} [input.narrative] - 可选的模型叙事（宽松解析后按小节覆盖）。
 * @returns {Record<string, string|string[]>} 8 个小节的初值。
 */
export function structuredSections({ events, narrative, cwd }) {
  const todos = extractTodos(events ?? [])
  const done = todos
    .filter((todo) => todo?.status === 'completed')
    .map((todo) => String(todo.content ?? '').trim())
    .filter((line) => line.length > 0)
  const open = extractOpenTodos(events ?? [])
  const goal = extractGoalObjective(events ?? [])
  const entries = extractTouchedFileEntries(events ?? [])
  const parsed = parseSummarySections(narrative ?? '')

  // 「涉及文件与产物」：路径用相对工作目录（文档头已写明 cwd），并标出"这个文件是干什么的"。
  const prefix = typeof cwd === 'string' && cwd.length > 0 ? (cwd.endsWith('/') ? cwd : `${cwd}/`) : undefined
  const fileLines = entries.map((entry) => {
    const path = prefix !== undefined && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path
    return `${path} —— ${entry.written ? '本会话改过' : '本会话查看过'}`
  })

  // 「接下来做什么」优先用待办里还没做完的项（这才是真的"下一步"）；
  // 没有待办才退回一句指向原会话的兜底话（不含会话原文）。
  const nextStep = open.length > 0
    ? `接下来要做：\n${open.map((line) => `- ${line}`).join('\n')}`
    : '在原会话 `%SOURCE%` 的工作目录下接着做上一件未完成的事：先跑一次现状检查（相关测试 / `git status`）再动手。'

  return {
    // ① 用户需求：模型凝练总结；模型没写出来就用会话目标（用户原话）兜底
    用户需求: parsed['用户需求'] ?? goal,
    // ② 方案梗概：交给模型写（含方案/设计文档路径）
    方案梗概: parsed['方案梗概'] ?? '',
    // ③ 已完成：待办快照里 completed 的项
    已完成: parsed['已完成'] ?? done,
    // ④ 涉及文件与产物：路径 + 是干什么用的
    涉及文件与产物: parsed['涉及文件与产物'] ?? fileLines,
    // ⑤ 接下来做什么
    接下来做什么: parsed['接下来做什么'] ?? nextStep,
  }
}

/**
 * 生成交接文档（含结构门禁；门禁不过则重试一次纯结构化版本）。
 * @param {object} input - 输入。
 * @param {object} input.meta - 文档元信息。
 * @param {Array<object>} input.events - 源会话事件。
 * @param {string} input.sessionId - 源会话 id。
 * @param {string} [input.narrative] - 模型摘要（可空）。
 * @param {boolean} input.summaryFailed - 摘要是否失败。
 * @param {string} [input.subagentSection] - R3 第 6 节正文（仅检出子代理时非空）。
 * @param {string} [input.noteSection] - R4 交接人留言正文（仅当有留言时非空；原样直插）。
 * @returns {{ok: boolean, doc?: string, error?: string, code?: string}} 结果。
 */
export function buildHandoffDocument({ meta, events, sessionId, narrative, summaryFailed, subagentSection, noteSection }) {
  const substitute = (sections) => Object.fromEntries(
    Object.entries(sections).map(([title, value]) => [
      title,
      Array.isArray(value)
        ? value
        : String(value).replaceAll('%SOURCE%', sessionId),
    ]),
  )
  /** 生成一次候选文档（带小节对象 —— 内容判定必须看它，不能看渲染后的文本）。 */
  const attempt = (narrativeValue, failedFlag) => {
    const sections = substitute(structuredSections({ events, narrative: narrativeValue, cwd: meta.cwd }))
    const doc = composeHandoffDocument({ meta, sections, summaryFailed: failedFlag, subagentSection, noteSection })
    // P2-14：门禁必须吃**结构化小节**——渲染后的文本可能被正文里嵌的同名标题骗到。
    // （handoff-doc 侧签名升级为 checkHandoffDocument(doc, sections?)：传了就以结构化数据为准。）
    return { sections, doc, gate: checkHandoffDocument(doc, sections), substantive: countSubstantiveSections(sections) }
  }
  const acceptable = (result) => result.gate.ok && result.substantive >= MIN_SUBSTANTIVE_SECTIONS

  const first = attempt(narrative, summaryFailed)
  if (acceptable(first)) return { ok: true, doc: first.doc, substantive: first.substantive }

  // 门禁不过 / 内容不够：丢掉模型摘要，重写一次纯结构化版本。
  const second = attempt(undefined, true)
  if (acceptable(second)) return { ok: true, doc: second.doc, substantive: second.substantive }
  if (second.substantive < MIN_SUBSTANTIVE_SECTIONS) {
    return {
      ok: false,
      code: 'no-content',
      error: `handoff document has no substance: 除「接下来做什么」外只有 ${second.substantive} 个小节有内容（要求 ≥ ${MIN_SUBSTANTIVE_SECTIONS}）——多半是源会话事件读不到，或这段会话确实没有可交接的内容`,
    }
  }
  return { ok: false, error: second.gate.message, code: second.gate.code }
}

/**
 * 宿主服务是否可用（`ctx.get` 读不到或抛错都算不可用）。
 * @param {object} ctx - Cordis 上下文。
 * @param {string} name - 服务名。
 * @returns {boolean} 可用返回 true。
 */
function serviceAvailable(ctx, name) {
  try {
    return ctx?.get?.(name) !== undefined
  } catch {
    return false
  }
}

/**
 * 黑匣子 `start` 阶段的快照内容（会话、触发原因、事件数与各服务可用性）。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.session - 源会话。
 * @param {string} input.reason - 触发原因。
 * @param {readonly object[]|undefined} input.events - 源会话事件。
 * @returns {object} `start` 阶段记录体。
 */
function handoffStartSnapshot({ ctx, session, reason, events }) {
  return {
    sessionId: session.id,
    reason,
    eventCount: events === undefined ? null : events.length,
    hasSnapshotEvents: typeof session.snapshotEvents === 'function',
    cwd: session.header?.cwd ?? null,
    services: {
      sessions: serviceAvailable(ctx, 'sessions'),
      agents: serviceAvailable(ctx, 'agents'),
      sessionTitle: serviceAvailable(ctx, 'sessionTitle'),
      workspaceRegistry: serviceAvailable(ctx, 'workspaceRegistry'),
      agentPresets: serviceAvailable(ctx, 'agentPresets'),
    },
  }
}

/**
 * 黑匣子 `route` 阶段的快照内容（模型路由与摘要相关配置）。
 * @param {{provider: string, model: string}|undefined} route - 模型路由。
 * @param {object} config - 已校验配置。
 * @returns {object} `route` 阶段记录体。
 */
function handoffRouteSnapshot(route, config) {
  return {
    route: route === undefined ? null : `${route.provider}/${route.model}`,
    summaryMode: config.summaryMode ?? null,
    turns: config.turns ?? null,
    timeoutMs: config.timeoutMs ?? null,
  }
}

/**
 * 取子会话当前的事件条数（读不到记 `null`，绝不伪装成 0）。
 * @param {object} childSession - 子会话。
 * @returns {number|null} 事件条数。
 */
function childEventCount(childSession) {
  const childEvents = sessionEvents(childSession)
  return childEvents === undefined ? null : childEvents.length
}

/**
 * 造一个把结果写进黑匣子的 `finish`（先摘要脱敏，再 push + flush，最后原样返回结果）。
 * @param {object} trace - 黑匣子。
 * @returns {Function} `(result, stage) => result`。
 */
function createFinish(trace) {
  // P2-2 第二道保险：黑匣子**记的是摘要、不是正文**。`result.doc` 是完整交接文档
  //   （含用户需求原话与文件路径），trace 层虽然还会按长度统一脱敏，这里先把 doc
  //   换成字数 `docChars`，双保险。注意 `finish` 仍**原样返回** result，日志不吃返回值。
  const forTrace = (result) => {
    if (result === null || typeof result !== 'object') return result
    const { doc, ...rest } = result
    return typeof doc === 'string' ? { ...rest, docChars: doc.length } : rest
  }
  return (result, stage) => {
    trace.push(stage, forTrace(result))
    trace.flush()
    return result
  }
}

/**
 * 生成模型叙事摘要：先按配置试一次，失败再缩输入重试一次；两次都失败就标记降级。
 * @param {object} input - 输入。
 * @param {object} input.config - 已校验配置。
 * @param {{provider: string, model: string}|undefined} input.route - 模型路由。
 * @param {object} input.session - 源会话。
 * @param {readonly object[]} input.events - 源会话事件。
 * @param {AbortSignal} [input.signal] - 取消信号。
 * @param {object} input.deps - 可注入依赖。
 * @param {Function} input.now - 时间源。
 * @param {object} input.trace - 黑匣子。
 * @param {object} input.logger - 日志器。
 * @returns {Promise<{narrative: string|undefined, summaryFailed: boolean}>} 叙事文本与降级标记。
 */
async function runNarrativeSummary({ config, route, session, events, signal, deps, now, trace, logger }) {
  let narrative
  let summaryFailed = false
  if (config.summaryMode === 'llm' && route !== undefined && typeof deps.narrate === 'function') {
    const attempts = [
      { label: 'primary', narrativeConfig: config },
      {
        // 兜底重试：缩小输入 + 去掉 reasoningEffort + **把输出预算顶到上限**。
        // ① 去掉 reasoningEffort：实测教训（2026-10-12）某些模型不支持 "off" 会被直接拒绝，
        //    不带该字段重试就能成功。
        // ② 顶高 maxTokens：实测教训（2026-10-14）推理模型会把输出预算先花在思考上，
        //    finish=max-tokens 且 chars=0 —— 缩输入救不了（第二次只送 4 轮、跑了 40 秒，照样 0 字），
        //    真正的杠杆是输出预算，所以重试一律给到上限，让正文有地方写。
        label: 'trimmed',
        narrativeConfig: {
          ...config,
          reasoningEffort: 'inherit',
          turns: Math.max(2, Math.min(config.turns ?? 8, 4)),
          maxInputChars: Math.max(4000, Math.floor((config.maxInputChars ?? 24000) / 2)),
          maxTokens: LIMITS.MAX_MAX_TOKENS,
        },
      },
    ]
    for (const attempt of attempts) {
      const startedAt = now()
      let failure = null
      try {
        const produced = await deps.narrate({ session, route, signal, config: attempt.narrativeConfig, events })
        narrative = typeof produced === 'string' ? produced : undefined
        if (narrative === undefined || narrative.trim().length === 0) {
          narrative = undefined
          failure = '模型返回空内容（没有可用的叙事小节）'
        }
      } catch (thrown) {
        failure = thrown instanceof Error ? thrown.message : String(thrown)
      }
      trace.push('narrate', {
        attempt: attempt.label,
        ok: failure === null,
        route: `${route.provider}/${route.model}`,
        turns: attempt.narrativeConfig.turns ?? null,
        maxInputChars: attempt.narrativeConfig.maxInputChars ?? null,
        ms: now() - startedAt,
        chars: narrative?.length ?? 0,
        error: failure,
      })
      if (failure === null) break
      logger?.warn?.(`handoff narrative attempt (${attempt.label}) failed: ${failure}`)
    }
    if (narrative === undefined) {
      summaryFailed = true
      logger?.warn?.('handoff narrative produced no usable content; falling back to the structured document')
    }
  } else if (config.summaryMode === 'llm') {
    summaryFailed = true
    logger?.warn?.('handoff summary skipped (no model route or no narrate dependency); using the structured document')
  }
  return { narrative, summaryFailed }
}

/**
 * 组装交接文档头部的元信息（来源会话、路由、触发原因、链路位置、创建时间）。
 * @param {object} input - 输入。
 * @param {object} input.session - 源会话。
 * @param {string} input.reason - 触发原因。
 * @param {object} input.detail - 触发细节。
 * @param {{provider: string, model: string}|undefined} input.route - 模型路由。
 * @param {object} input.chain - 链路状态。
 * @param {Function} input.now - 时间源。
 * @returns {object} 文档元信息。
 */
function buildDocumentMeta({ session, reason, detail, route, chain, now }) {
  return {
    fromSession: session.id,
    cwd: session.header?.cwd,
    modelRoute: route,
    agentPreset: session.header?.agentPreset,
    title: session.header?.title,
    trigger: { reason, detail },
    chain: { chainId: chain.chainId, index: chain.index },
    createdAt: now(),
  }
}

/**
 * 规划新会话标题：模型给的 `标题：` 优先，其次会话记忆，再退回不设标题；并剥出正文。
 * @param {object} input - 输入。
 * @param {string|undefined} input.narrative - 模型叙事。
 * @param {readonly object[]} input.events - 源会话事件。
 * @param {object} input.session - 源会话。
 * @returns {{narrativeBody: string, generatedTitle: string, plannedChildTitle: string|undefined}} 标题与正文。
 */
function planChildTitle({ narrative, events, session }) {
  // 新会话标题：模型在文档第一行给的 `标题：xxx` 优先（从需求凝练、能区分任务）；
  // 模型没给就从会话记忆里兜一个；都没有才退回旧的写死标题（2026-10-10 用户要求差异化）。
  const { title: suggestedTitle, rest: narrativeBody } = parseNarrativeTitle(narrative)
  const memoryTitle = deriveRequirementTitle(events, { headerTitle: session.header?.title })
  // ⚠️ 名字必须中文（用户原话就是英文时才允许英文）：
  //    模型给了英文名、而记忆里能兜出中文名时，用中文名（2026-10-12 用户截图：标题里漏出 `Original:`）。
  const generatedTitle = suggestedTitle.length > 0 && (hasChinese(suggestedTitle) || !hasChinese(memoryTitle))
    ? suggestedTitle
    : memoryTitle
  /** 新会话标题：`交接 · <需求凝练>`；模型与记忆都没给出时才退回旧写法。 */
  const plannedChildTitle = generatedTitle.length > 0 ? `${HANDED_IN_MARK}-${generatedTitle}` : undefined
  return { narrativeBody, generatedTitle, plannedChildTitle }
}

/**
 * 复用上次失败遗留的子会话（仅当它还是空壳：除我们注入的文档外没有用户消息）。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {string} [input.existingChildSessionId] - 上次已建出的子会话 id。
 * @returns {{childAgent?: object, childSession?: object, childSessionId?: string}|{}} 命中复用返回三元组，否则空对象。
 */
function reuseResidualChild({ ctx, logger, existingChildSessionId }) {
  // P1-3：上一次尝试已经建出过子会话（注入/落盘阶段失败）时**复用它**，不要再建第二个。
  //   旧实现每次重试都 `agents.create`，一次失败能留下 1～3 个孤儿会话；
  //   宿主 `AgentService` 有 `get(id)`（`dsh-agent/lib/index.js:595`）可拿回 live agent。
  const reusableChildId = typeof existingChildSessionId === 'string' && existingChildSessionId.length > 0
    ? existingChildSessionId
    : undefined
  if (reusableChildId === undefined) return {}
  try {
    const existing = typeof ctx.agents?.get === 'function' ? ctx.agents.get(reusableChildId) : undefined
    if (existing !== undefined && existing !== null && existing.session !== undefined) {
      // ⚠️ **只在"确认它还是空壳"时才复用**：判据是"除我们注入的交接文档外，没有用户消息"。
      //    只按"有没有 user/message"会把**我们自己注入的文档**（它也是 user/message）
      //    误当成用户消息 ⇒ 丢下已投递的会话又新建一个（2026-10-12 独立复核场景 B）。
      const userTouched = userTouchedChild(existing.session)
      if (userTouched === true) {
        logger?.warn?.(`handoff: child ${reusableChildId} has been used by the user; creating a fresh one instead of reusing`)
      } else if (userTouched === undefined) {
        logger?.warn?.(`handoff: cannot read events of child ${reusableChildId}; not reusing it`)
      } else {
        logger?.info?.(`handoff: reusing child session ${reusableChildId} left by a previous failed attempt`)
        return { childAgent: existing, childSession: existing.session, childSessionId: reusableChildId }
      }
    }
  } catch (reuseError) {
    logger?.warn?.(`handoff: could not reuse child ${reusableChildId} (${reuseError instanceof Error ? reuseError.message : String(reuseError)}); creating a new one`)
  }
  return {}
}

/**
 * 新建子会话与 agent（会话与 agent 一起建；meta 字段名是 `meta` 不是 `sessionMeta`，PK-001）。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.session - 源会话。
 * @param {{provider: string, model: string, reasoningEffort?: string}|undefined} input.route - 模型路由。
 * @param {Function} input.newSessionId - 新会话 id 生成器。
 * @returns {Promise<{childAgent: object, childSession: object, childSessionId: string}|{error: string}>} 成功返回三元组，失败返回错误文案。
 */
async function createChildAgentSession({ ctx, logger, session, route, newSessionId }) {
  try {
    const childSessionId = newSessionId()
    const composition = await composeForPreset(ctx, session.header?.agentPreset)
    // 推理强度只在**真的有值**时带上：`agentOptions.reasoningEffort = undefined` 在宿主那边
    // 是"显式传了个空值"，会被写进 requestHeader.config，反而不如不传（与 provider/model 同理）。
    const agentOptions = route === undefined
      ? undefined
      : {
        provider: route.provider,
        model: route.model,
        ...(typeof route.reasoningEffort === 'string' && route.reasoningEffort.length > 0
          ? { reasoningEffort: route.reasoningEffort }
          : {}),
      }
    const handle = await ctx.agents.create({
      sessionId: childSessionId,
      ...(agentOptions === undefined ? {} : { agentOptions }),
      meta: {
        ...(typeof session.header?.cwd === 'string' ? { cwd: session.header.cwd } : {}),
        parentSession: session.id,
        ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
      },
      setup: composition.setup,
    })
    const childAgent = handle.agent
    return { childAgent, childSession: childAgent.session, childSessionId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger?.error?.(`handoff session create failed: ${message}`)
    return { error: message }
  }
}

/**
 * 取宿主服务（`ctx.get` 抛错也当"没有"）。
 *
 * 为什么权限这条链要这么小心：它**不是硬切的必要条件**，任何一步读不到都该优雅降级，
 * 绝不能因为"宿主没装沙箱"就把新会话建不出来。
 *
 * @param {object} ctx - Cordis 上下文。
 * @param {string} name - 服务名。
 * @returns {object|undefined} 服务实例。
 */
function lookupService(ctx, name) {
  try {
    return ctx?.get?.(name) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 把新会话的工作权限设成配置值（配置为空时跟随原会话的档位）。
 *
 * 三个刻意的取舍（都属于"权限没设上不是致命错误"）：
 *   1) **任何失败只记日志**，绝不抛出——硬切不能被权限拖垮；
 *   2) 配置为空且原会话档位是 `custom` 时**不设置**：`custom` 是多档组合、没有对应预设名，
 *      此时保持宿主在 `session/created` 时 pin 的默认档；这就是"跟随原会话"在自定义组合下的
 *      退化行为，也是三项全空时与旧版**完全一致**的原因（旧版从不调 set）；
 *   3) 服务缺失（未启用沙箱）同样只记一条 info，什么都不做。
 *
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.session - 原会话（读它的当前档位名）。
 * @param {object} input.childSession - 新会话（设置目标）。
 * @param {object} input.config - 已校验配置。
 * @param {object} input.trace - 黑匣子。
 * @returns {Promise<void>} 无返回值；结果只体现在日志与黑匣子。
 */
async function applyChildPermission({ ctx, logger, session, childSession, config, trace }) {
  const service = lookupService(ctx, 'permissionPresets')
  if (service === undefined || typeof service.set !== 'function') {
    logger?.info?.('handoff: permissionPresets service unavailable; the child keeps the permission pinned by the host')
    trace.push('permission', { ok: false, preset: null, reason: 'service-unavailable' })
    return
  }
  const configured = typeof config?.childPermissionPreset === 'string' ? config.childPermissionPreset : ''
  let preset = configured
  if (preset.length === 0) {
    let current
    try {
      current = await service.current?.(session)
    } catch (readError) {
      logger?.warn?.(`handoff: cannot read the origin session permission (${readError instanceof Error ? readError.message : String(readError)}); the child keeps the default permission`)
      trace.push('permission', { ok: false, preset: null, reason: 'read-failed' })
      return
    }
    if (typeof current !== 'string' || current.length === 0 || current === 'custom') {
      logger?.warn?.(`handoff: 原会话是自定义权限组合（current=${String(current)}），新会话不做权限设置，按宿主默认档运行`)
      trace.push('permission', { ok: false, preset: null, reason: 'origin-custom' })
      return
    }
    preset = current
  }
  try {
    await service.set(childSession, preset)
    logger?.info?.(`handoff: child session permission set to ${preset}`)
    trace.push('permission', { ok: true, preset })
  } catch (error) {
    logger?.warn?.(`handoff: setting the child session permission failed (the handoff continues): ${error instanceof Error ? error.message : String(error)}`)
    trace.push('permission', { ok: false, preset, reason: 'set-failed' })
  }
}

/**
 * 拿到子会话：优先复用残留的空壳会话，复用不到才新建；成功时记 `created` 阶段。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.session - 源会话。
 * @param {{provider: string, model: string}|undefined} input.route - 模型路由。
 * @param {Function} input.newSessionId - 新会话 id 生成器。
 * @param {string} [input.existingChildSessionId] - 上次已建出的子会话 id。
 * @param {object} input.trace - 黑匣子。
 * @returns {Promise<{childAgent?: object, childSession?: object, childSessionId?: string, error?: string}>} 三元组或错误。
 */
async function ensureChildSession({ ctx, logger, session, route, newSessionId, existingChildSessionId, trace }) {
  const reused = reuseResidualChild({ ctx, logger, existingChildSessionId })
  const child = reused.childAgent === undefined
    ? await createChildAgentSession({ ctx, logger, session, route, newSessionId })
    : reused
  if (child.error === undefined) {
    trace.push('created', { childSessionId: child.childSessionId, childEvents: childEventCount(child.childSession) })
  }
  return child
}

/**
 * 把子会话挂到源会话的工作目录（失败仅告警，会话仍可用）；记 `workspace` 阶段。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.session - 源会话。
 * @param {string} input.childSessionId - 子会话 id。
 * @param {object} input.trace - 黑匣子。
 * @returns {Promise<string|null>} 失败原因；成功为 null。
 */
async function attachWorkspaceForChild({ ctx, logger, session, childSessionId, trace }) {
  let attachError = null
  try {
    const registry = ctx.get('workspaceRegistry')
    const cwd = session.header?.cwd
    if (registry !== undefined && typeof cwd === 'string' && cwd.length > 0) {
      const workspace = await registry.create(cwd)
      await workspace.attachSession(childSessionId)
    }
  } catch (error) {
    attachError = error instanceof Error ? error.message : String(error)
    logger?.warn?.(`handoff workspace attach failed (session ${childSessionId} stays ungrouped until restart): ${attachError}`)
  }
  trace.push('workspace', { ok: attachError === null, error: attachError })
  return attachError
}

/**
 * 给新会话改名（**这是新会话落盘的第一条事件**，失败会让新会话完全不可见）；记 `child-title` 阶段。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.childSession - 子会话。
 * @param {string} input.childSessionId - 子会话 id。
 * @param {string|undefined} input.plannedChildTitle - 规划好的标题。
 * @param {string|undefined} input.originTitle - 源会话原标题（兜底用）。
 * @param {object} input.trace - 黑匣子。
 * @returns {Promise<string|null>} 失败原因；成功为 null。
 */
async function renameChildTitle({ ctx, logger, childSession, childSessionId, plannedChildTitle, originTitle, trace }) {
  let childTitleError = null
  try {
    const titles = ctx.get('sessionTitle')
    if (titles === undefined) {
      childTitleError = 'sessionTitle service unavailable'
    } else {
      await titles.rename(childSession, plannedChildTitle ?? (originTitle === undefined ? 'handoff: 会话交接' : `handoff: ${originTitle}`))
    }
  } catch (error) {
    childTitleError = error instanceof Error ? error.message : String(error)
    logger?.warn?.(`handoff child title rename failed (session ${childSessionId}): ${childTitleError}`)
  }
  trace.push('child-title', { ok: childTitleError === null, error: childTitleError, title: plannedChildTitle ?? null, childEvents: childEventCount(childSession) })
  return childTitleError
}

/**
 * 给失败残留的子会话打上可辨认的标题（让用户一眼看出是残次品、可手删）。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.childSession - 子会话。
 * @returns {Promise<boolean>} 标记成功返回 true。
 */
async function markFailedChildTitle({ ctx, logger, childSession }) {
  let marked = false
  try {
    const titles = ctx.get('sessionTitle')
    if (titles !== undefined) {
      await titles.rename(childSession, '交接失败·可删除')
      marked = true
    }
  } catch (markError) {
    logger?.warn?.(`handoff failed-child title mark failed: ${markError instanceof Error ? markError.message : String(markError)}`)
  }
  return marked
}

/**
 * 注入交接文档（已有就跳过，幂等）并转发已 claim 的用户消息；失败时标记子会话并给出可读错误。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.childAgent - 子 agent。
 * @param {object} input.childSession - 子会话。
 * @param {string} input.childSessionId - 子会话 id。
 * @param {string} input.doc - 交接文档。
 * @param {Function} input.createUserMessage - 消息工厂。
 * @param {Array<object>} input.forwardMessages - 需要转发的已 claim 消息。
 * @returns {Promise<{ok: true, forwarded: number}|{ok: false, error: string}>} 结果。
 */
async function injectHandoffDoc({ ctx, logger, childAgent, childSession, childSessionId, doc, createUserMessage, forwardMessages, planFirst }) {
  let forwarded = 0
  try {
    // 幂等（独立复核的新 P1-1）：复用残留会话重试时，上一次的 `followup` 可能已经投进去了，
    // 再投一次就是**同一份文档两份**。判据看事件**内容**，不看事件类型。
    if (hasHandoffDoc(childSession)) {
      logger?.info?.(`handoff: child ${childSessionId} already carries the handoff document; skipping re-injection (idempotent retry)`)
    } else {
      // R1（§11.3）：指令段只拼进首条消息的文本里；`doc` 本身逐字节不变。
      const firstText = planFirst === true ? `${doc}\n\n${CHILD_PLAN_FIRST_INSTRUCTION}` : doc
      const docMessage = createUserMessage({
        content: [{ type: 'text', text: firstText }],
        source: HANDOFF_SOURCE,
      })
      childAgent.followup(docMessage)
    }
    // PK-003：pre-step 的 claim 发生在 waterfall 之前，若不转发这些已 claim 的消息，
    // 用户那条消息会被永久吞掉。（用户消息每次都转发；只有文档是幂等的。）
    for (const message of forwardMessages) {
      if (message === undefined || message === null) continue
      childAgent.followup(message)
      forwarded += 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger?.error?.(`handoff injection failed: ${message}`)
    // P1-3：新会话**已经建出来了**，不能当"什么都没发生"。
    //   ① 尽力给它一个可辨认的标题，用户一眼能看出这是残次品、可手删；
    //   ② 把 childSessionId 写进错误文案，不让它变成查不到的幽灵会话。
    const marked = await markFailedChildTitle({ ctx, logger, childSession })
    return {
      ok: false,
      error: `新会话 ${childSessionId} 已创建，但交接文档注入失败（${message}）；这是个空会话${marked ? '（标题已标为「交接失败·可删除」）' : ''}，请自行删除`,
    }
  }
  return { ok: true, forwarded }
}

/**
 * 把交接文档落盘（宿主侧注入 `deps.persistDoc`；失败只告警，绝不阻断接力）；记 `doc-persist` 阶段。
 * @param {object} input - 输入。
 * @param {object} input.deps - 可注入依赖。
 * @param {string} input.doc - 交接文档。
 * @param {object} input.session - 源会话。
 * @param {object} input.meta - 文档元信息。
 * @param {string} input.childSessionId - 子会话 id。
 * @param {object} input.logger - 日志器。
 * @param {object} input.trace - 黑匣子。
 * @returns {Promise<string|null>} 落盘路径；没落盘为 null。
 */
async function persistHandoffDoc({ deps, doc, session, meta, childSessionId, logger, trace }) {
  let persistedPath = null
  if (typeof deps.persistDoc === 'function') {
    try {
      const saved = await deps.persistDoc({ doc, session, meta, childSessionId })
      if (saved?.ok === true) persistedPath = saved.path ?? null
      else if (saved?.skipped !== true) logger?.warn?.(`handoff doc persist failed: ${String(saved?.error ?? 'unknown')}`)
    } catch (persistError) {
      logger?.warn?.(`handoff doc persist threw: ${persistError instanceof Error ? persistError.message : String(persistError)}`)
    }
  }
  trace.push('doc-persist', { ok: persistedPath !== null, path: persistedPath })
  return persistedPath
}

/**
 * 给源会话标题打上「交接出-…→子会话」标记（失败仅告警）；记 `origin-mark` 阶段。
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.session - 源会话。
 * @param {string|undefined} input.originTitle - 源会话原标题。
 * @param {string} input.childSessionId - 子会话 id。
 * @param {string} input.generatedTitle - 标题兜底用的需求名。
 * @param {object} input.trace - 黑匣子。
 * @returns {Promise<string|null>} 失败原因；成功为 null。
 */
async function markOriginTitleSafely({ ctx, logger, session, originTitle, childSessionId, generatedTitle, trace }) {
  let originMarkError = null
  try {
    const titles = ctx.get('sessionTitle')
    if (titles === undefined) {
      originMarkError = 'sessionTitle service unavailable'
    } else {
      await titles.rename(session, markOriginTitle(originTitle, childSessionId, generatedTitle))
    }
  } catch (error) {
    originMarkError = error instanceof Error ? error.message : String(error)
    logger?.warn?.(`handoff origin title mark failed (session ${session.id}): ${originMarkError}`)
  }
  trace.push('origin-mark', { ok: originMarkError === null, error: originMarkError })
  return originMarkError
}

/**
 * 判断事件读取结果是否要中止硬切（读不到 / 一条都没有），返回中止原因。
 * @param {readonly object[]|undefined} events - 源会话事件。
 * @returns {{level: string, error: string, code: string}|undefined} 中止信息；可继续返回 undefined。
 */
function abortReasonForEvents(events) {
  if (events === undefined) return { level: 'error', error: EVENTS_UNAVAILABLE_REASON, code: 'events-unavailable' }
  if (events.length === 0) return { level: 'warn', error: NO_EVENTS_REASON, code: 'no-events' }
  return undefined
}

/**
 * 组装文档元信息、规划标题并生成交接文档；成功时记 `document` 阶段。
 * @param {object} input - 输入。
 * @param {object} input.session - 源会话。
 * @param {string} input.reason - 触发原因。
 * @param {object} input.detail - 触发细节。
 * @param {{provider: string, model: string}|undefined} input.route - 模型路由。
 * @param {object} input.chain - 链路状态。
 * @param {readonly object[]} input.events - 源会话事件。
 * @param {string|undefined} input.narrative - 模型叙事。
 * @param {boolean} input.summaryFailed - 摘要是否失败。
 * @param {string} [input.subagentSection] - R3 第 6 节正文（仅检出子代理时非空）。
 * @param {string} [input.noteSection] - R4 交接人留言正文（仅当有留言时非空）。
 * @param {Function} input.now - 时间源。
 * @param {object} input.trace - 黑匣子。
 * @returns {object} 成功 `{ ok: true, doc, meta, generatedTitle, plannedChildTitle }`；失败 `{ ok: false, error, code }`。
 */
function prepareHandoffDocument({ session, reason, detail, route, chain, events, narrative, summaryFailed, subagentSection, noteSection, now, trace }) {
  const meta = buildDocumentMeta({ session, reason, detail, route, chain, now })
  const { narrativeBody, generatedTitle, plannedChildTitle } = planChildTitle({ narrative, events, session })
  const built = buildHandoffDocument({ meta, events, sessionId: session.id, narrative: narrativeBody, summaryFailed, subagentSection, noteSection })
  if (!built.ok) return { ok: false, error: built.error, code: built.code }
  trace.push('document', { ok: true, chars: built.doc.length, summaryFailed, substantive: built.substantive ?? null })
  return { ok: true, doc: built.doc, meta, generatedTitle, plannedChildTitle }
}

/**
 * 把链路状态推进到「已交接」，并给新会话登记下一跳。
 * @param {object} input - 输入。
 * @param {object} [input.chains] - 链路状态存取。
 * @param {object} input.session - 源会话。
 * @param {string} input.childSessionId - 子会话 id。
 * @param {object} input.chain - 当前链路状态。
 * @returns {void}
 */
function commitHandoffChain({ chains, session, childSessionId, chain }) {
  chains?.set?.(session.id, { ...chain, childSessionId, status: 'handed-off' })
  chains?.set?.(childSessionId, {
    chainId: chain.chainId,
    index: chain.index + 1,
    rootSessionId: chain.rootSessionId,
    prevSessionId: session.id,
    status: 'running',
  })
}

/**
 * 执行一次会话硬切。**任何失败都不影响原会话**（M1 §五 总原则）。
 *
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.logger - 日志器。
 * @param {object} input.config - 已校验配置。
 * @param {object} input.session - 源会话。
 * @param {object} [input.agent] - 源 agent（手工带外调用时可能没有）。
 * @param {string} input.reason - 触发原因（replace-threshold / session-volume / compaction-count / manual）。
 * @param {object} [input.detail] - 触发细节（写进交接文档）。
 * @param {string} [input.note] - R4：交接人留言（**已归一化**的原文；留空不传/undefined ⇒ 不出节）。
 * @param {string[]} [input.skillRefs] - R4：技能引用（**只存不执行**；写进 trace/决策日志）。
 * @param {Array<object>} [input.forwardMessages] - 已被 claim、不转发就会丢的消息（PK-003）。
 * @param {object} [input.ledger] - 会话台账（换会话后给新会话归零）。
 * @param {object} [input.chains] - 链路状态存取（{ next, get, set }）。
 * @param {object} [input.deps] - 可注入依赖。
 * @param {Function} [input.deps.createUserMessage] - `@deepseek-ai/dsh-llm` 的 createUserMessage（**必传**）。
 * @param {Function} [input.deps.narrate] - 生成叙事摘要：async ({session, route, signal, config}) => string。
 * @param {Function} [input.deps.newSessionId] - 新会话 id 生成器。
 * @param {Function} [input.deps.now] - 时间源。
 * @param {AbortSignal} [input.signal] - 取消信号。
 * @returns {Promise<{ok: boolean, childSessionId?: string, doc?: string, forwarded?: number, error?: string, reason?: string}>} 执行结果。
 */
export async function performHandoff(input) {
  const {
    ctx, logger, config, session, agent, reason, detail = {},
    forwardMessages = [], ledger, chains, deps = {}, signal, existingChildSessionId,
    note,
  } = input

  if (session === undefined || session === null) {
    return { ok: false, error: 'no origin session', reason }
  }
  // R4 P2（QA）：即使调用方**绕过 RPC 直调** performHandoff，也要再归一化一次 note ——
  // 纯空白 ⇒ 视为没留言（绝不能产出"只有空格的留言节"）；超长按同一口径截 500。
  const safeNote = normalizeNote(note).note

  const createUserMessage = deps.createUserMessage
  if (typeof createUserMessage !== 'function') {
    return { ok: false, error: 'createUserMessage dependency is missing', reason }
  }
  const newSessionId = deps.newSessionId ?? defaultNewSessionId
  const now = deps.now ?? (() => Date.now())
  // 黑匣子：宿主日志在桌面版里拿不到，"看起来成功但什么都没发生"必须能事后定位。
  const trace = createTrace()
  const finish = createFinish(trace)

  // ⚠️ 宿主契约（2026-10-10 事故根因）：事件只能走 sessionEvents()（它优先 `snapshotEvents()`，
  //    真实宿主**没有 `.events` 属性**）。读不到就**拒绝硬切**，绝不把空数组伪装成"会话是空的"。
  const events = sessionEvents(session)
  trace.push('start', handoffStartSnapshot({ ctx, session, reason, events }))
  const aborted = abortReasonForEvents(events)
  if (aborted !== undefined) {
    logger?.[aborted.level]?.(`handoff aborted: ${aborted.error}`)
    return finish({ ok: false, error: aborted.error, reason, code: aborted.code }, 'abort')
  }
  const route = resolveRoute(session, config)
  trace.push('route', handoffRouteSnapshot(route, config))

  // —— 1) 交接文档：叙事交给当前会话的主模型写；失败退化成结构化版本（重试细节见 runNarrativeSummary）——
  // R2（§11.1.1 ④⑤ 并发）：子代理收尾与叙事摘要**并发**跑，产物互不依赖；收尾永不 reject。
  const drainPromise = drainSubagents({
    ctx,
    logger,
    session,
    config,
    signal,
    now,
    sleep: deps.sleep,
    pollMs: deps.subagentPollMs,
    // ARB-17：挂钟硬上限（默认 = 配置分钟 + 15 秒；`subagentWatchdogMs` 只是测试钩子）。
    watchdogMs: deps.subagentWatchdogMs,
    onState: deps.onDrainState,
    onError: (message) => deps.recordError?.(session.id, message),
  })
  const { narrative, summaryFailed } = await runNarrativeSummary({ config, route, session, events, signal, deps, now, trace, logger })
  // ⚠️ 只有收尾**结束**（全部交卷 / 到点打断 / 异常吞掉）之后才继续往下走 —— 不给自己开"边等边建"的旁路。
  const drained = await drainPromise
  if (drained.aborted === true) {
    return finish({ ok: false, error: 'handoff aborted', reason, code: 'aborted' }, 'aborted')
  }
  const chain = chains?.next?.(session.id) ?? { chainId: session.id, index: 1, rootSessionId: session.id }
  const prepared = prepareHandoffDocument({ session, reason, detail, route, chain, events, narrative, summaryFailed, subagentSection: drained.section, noteSection: safeNote, now, trace })
  if (!prepared.ok) {
    logger?.error?.(`handoff document rejected by structure gate (${prepared.code}): ${prepared.error}`)
    return finish({ ok: false, error: prepared.error, reason, code: prepared.code }, 'gate-rejected')
  }
  const { doc, generatedTitle, plannedChildTitle } = prepared

  // —— 2) 新会话 + agent：优先复用上次失败留下的空壳，否则新建（复用判据见 ensureChildSession）——
  const child = await ensureChildSession({ ctx, logger, session, route, newSessionId, existingChildSessionId, trace })
  if (child.error !== undefined) {
    return finish({ ok: false, error: child.error, reason, stage: 'create' }, 'create-failed')
  }
  const { childAgent, childSession, childSessionId } = child
  // 换会话即归零（§16.3 C3 / §17.2 C3）：新会话台账从 0 起算，
  // 之后的注入消息与压缩会正常累加。
  ledger?.reset?.(childSession)

  // 权限必须**在子会话对象拿到之后**设：宿主在 session/created 时已经 pin 过一次默认档，
  // 这里覆盖它即可（之后没有别的自动 pin，不会被再次覆盖）。失败只记日志。
  await applyChildPermission({ ctx, logger, session, childSession, config, trace })

  await attachWorkspaceForChild({ ctx, logger, session, childSessionId, trace })
  const originTitle = typeof session.header?.title === 'string' && session.header.title.length > 0 ? session.header.title : undefined
  const childTitleError = await renameChildTitle({ ctx, logger, childSession, childSessionId, plannedChildTitle, originTitle, trace })
  const injected = await injectHandoffDoc({ ctx, logger, childAgent, childSession, childSessionId, doc, createUserMessage, forwardMessages, planFirst: config.childPlanFirst !== false })
  if (!injected.ok) {
    return finish({ ok: false, error: injected.error, reason, stage: 'inject', childSessionId }, 'inject-failed')
  }
  const forwarded = injected.forwarded
  trace.push('injected', { forwarded, childEvents: childEventCount(childSession) })

  const persistedPath = await persistHandoffDoc({ deps, doc, session, meta: prepared.meta, childSessionId, logger, trace })
  const originMarkError = await markOriginTitleSafely({ ctx, logger, session, originTitle, childSessionId, generatedTitle, trace })

  // ⚠️ 禁止假成功（2026-10-10 实机事故）：新会话建出来了、接口也回了成功，但它**一条事件都没有**
  //    → 不会落盘、多半也不会出现在会话列表里。宁可按失败报，也不许骗人。
  const finalChildEvents = childEventCount(childSession)
  trace.push('child-events', { count: finalChildEvents, childTitleError, originMarkError })
  if (finalChildEvents === 0) {
    const message = `新会话 ${childSessionId} 已创建但没有任何事件（未落盘，可能不会出现在会话列表里）：sessionTitle 服务不可用或无权限，标题事件写不进去`
    logger?.error?.(`handoff not persisted: ${message}`)
    return finish({ ok: false, error: message, reason, stage: 'child-not-persisted', childSessionId }, 'child-not-persisted')
  }

  commitHandoffChain({ chains, session, childSessionId, chain })
  logger?.info?.(`handoff ok (${reason}): session ${session.id} → new session ${childSessionId}${forwarded > 0 ? `, forwarded ${forwarded} claimed message(s)` : ''}${persistedPath === null ? '' : `, doc saved to ${persistedPath}`}`)
  return finish({ ok: true, childSessionId, doc, forwarded, reason, persistedPath, chain: { chainId: chain.chainId, index: chain.index } }, 'done')
}
