// 交接文档：8 个**逐字固定**的小节 + 结构门禁 + 从会话事件零成本提取的结构化字段。
// （规格：M1 技术文档 §2.3；门禁照 dsh-auto-memory 的硬门禁做法）
//
// 纯函数零依赖，可纯 Node 单测。LLM 摘要由调用方以 narrate() 注入，
// 注入失败/缺字段时用纯结构化字段拼**降级版**（M1 §五：摘要失败仍继续接力）。

/**
 * 交接文档的小节（**逐字固定、顺序即文档顺序**）。
 *
 * 2026-10-10 用户定调：交接文档只涵盖这 5 块——
 *   ① 用户的原始完整需求（凝练总结，不丢关键信息）
 *   ② 方案或计划梗概（写过方案文档就把文档路径写进来）
 *   ③ 方案里已完成的项目
 *   ④ 会话涉及的文件/产物（**要讲清楚每个是做什么用的**）
 *   ⑤ 接下来做什么
 * 其余小节（试过且失败的路、关键决策、遗留问题…）不再单列：需要时写进「方案梗概」或「接下来做什么」。
 */
import { HANDOFF_DOC_SECTION_TITLES } from './constants.mjs'
export const HANDOFF_DOC_SECTIONS = Object.freeze([...HANDOFF_DOC_SECTION_TITLES])
/** 空小节必须显式写出来的占位（门禁允许空，但不允许"看起来漏了"）。 */
export const EMPTY_SECTION_TEXT = '无'

/**
 * R3：交接文档第 6 节的标题（**逐字**，2026-10-14 口径清单 §5）。
 *
 * ⚠️ **不进 `HANDOFF_DOC_SECTIONS`**（ARB-4：既有 5 节标题与顺序不动）。
 * 它只在检出子代理时作为第 6 节出现；结构门禁 / 实质内容计数都只看那 5 项，故门禁影响为零。
 */
export const SUBAGENT_DOC_SECTION = '子代理、交接情况'

/**
 * R4：交接文档的「交接人留言（原话）」节标题（**逐字**，口径清单 §1 / 2026-10-17）。
 *
 * ⚠️ **不进 `HANDOFF_DOC_SECTIONS`**：它不参与实体小节计数，也不参与 `MIN_NEXT_STEP_CHARS`
 * 门禁；只在有留言时插到**头部之后、5 个小节之前**（清单 §2.9）。
 */
export const HANDOFF_NOTE_SECTION = '交接人留言（原话）'

/**
 * 交接文档正文的固定识别串（标题里的一段）。
 *
 * ⚠️ **单一来源**：`composeHandoffDocument` 的标题用它拼，`handoff-exec.mjs` 的
 * "这个子会话是不是已经收过我们的文档"幂等判据也用它（2026-10-12 独立复核的新 P1-1）。
 * 两处各写一份字符串的话，改标题就会静默破坏幂等。
 */
export const HANDOFF_DOC_MARKER = '会话硬切交接文档'

/** 「接下来做什么」的最小长度（M1 §2.3 门禁第 2 条）。 */
export const MIN_NEXT_STEP_CHARS = 10

/**
 * 除「接下来做什么」外，至少要有几个小节有实质内容（内容判定，2026-10-10 事故补丁）。
 *
 * 定成 **1**：只要不是"8 个小节全空"就算有东西可交接。
 * （曾定 2，但那时文档里会塞"会话原文摘录"来凑数；现在按用户定调**不搬运原文**，
 *   降级版只剩"已完成 / 下一步 / 涉及文件"这些事实项，卡 2 会误伤正常会话。）
 * 空小节渲染出的占位符 `无` 不算内容。
 */
export const MIN_SUBSTANTIVE_SECTIONS = 1

/**
 * 生成**叙事小节**的模型提示（只让模型写它才能写得好的四段）。
 * 标题与 HANDOFF_DOC_SECTIONS 逐字一致——对不上就会被 parseSummarySections 丢掉，
 * 退回结构化兜底（不会翻车，但会丢信息，所以这里必须对齐）。
 */
export const HANDOFF_NARRATIVE_PROMPT = [
  '你在为"会话硬切"写一份交接文档：下一个**全新的会话**要靠它接着干，它看不到你们之前的对话。',
  '输入是【会话记忆】——DSH 自己维护的结构化记忆：会话标题、用户原始需求、压缩摘要、逐轮「要什么/做了什么」、待办快照、碰过的文件。**这不是对话原文**，不要假设你看过完整对话。',
  '第一行先给**这个新会话**起个标题，格式：`标题：<不超过 20 字的**中文**短语>`（用户原话就是英文时才用英文）——要从用户需求凝练、能**一眼区分这是哪件事**，不要用"会话交接""硬切""继续任务"这类放在哪都行的通用词，也不要出现 Original/goal/title 这类英文标签。',
  '然后空一行，再只输出下面 5 个小节，标题逐字照抄（含 ## 前缀），不要输出别的小节、不要开场白、不要代码块：',
  ...HANDOFF_DOC_SECTIONS.map((title) => `## ${title}`),
  '各节要求：',
  '「用户需求」：把用户真正要的东西凝练总结。**需求常常分很多轮才说清、还会中途改口**，必须综合【需求演进】【用户历轮提出的要求】和压缩摘要，写出**最终结论**（不是只写第一句，也不是逐条流水账）；改口的地方要写清最终按哪个。**不许丢关键信息**（可以不是原话，但不许编造）。',
  '「方案梗概」：方案/计划的核心思路与关键取舍；会话里写过方案/设计文档的，把**文档路径**写进来。',
  '「已完成」：方案里已经做完的项，逐条列，写清改了什么、验证到什么程度。',
  '「涉及文件与产物」：逐条写 `路径 —— 这个文件/产物是做什么用的`（改了什么、为什么改）。',
  '「接下来做什么」：按顺序列下一步动作，可执行、具体（不要写"继续推进"这种空话）。',
  '用对话本身的语言书写；只说对话里出现过的事实，不要编造。',
].join('\n')

/**
 * 从会话事件里取最后一次 `todo/write` 快照（last-write-wins，照 dsh-tool-todo 的投影）。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @returns {Array<{content?: string, status?: string}>} 待办列表（无则空数组）。
 */
export function extractTodos(events) {
  let latest = []
  if (events === undefined || events === null) return latest
  for (const event of events) {
    if (event?.type === 'todo/write' && Array.isArray(event.data?.todos)) latest = event.data.todos
  }
  return latest
}

/** 工具入参里可能承载文件路径的键名（不同工具的命名习惯）。 */
const FILE_PATH_KEYS = Object.freeze(['file_path', 'filePath', 'path', 'notebook_path', 'target_file'])

/** "写"类工具：交接文档的「涉及文件」优先列这些工具碰过的文件（改过的才是要去查的）。 */
const WRITE_TOOL_NAMES = Object.freeze(new Set([
  'edit', 'write', 'str_replace_editor', 'str_replace', 'apply_patch', 'multi_edit', 'notebook_edit',
]))

/**
 * 把 `tool/call.data.arguments` 归一成对象。
 *
 * ⚠️ 真实会话日志里它是 **JSON 字符串**（`"{\"file_path\":\"/a/b.mjs\"}"`），不是对象。
 *    旧代码 `typeof args !== 'object' → continue` 把所有调用都跳过，
 *    于是「涉及文件」在真实会话里**永远是空的**（2026-10-10 实机发现）。
 * @param {unknown} raw - 原始入参。
 * @returns {object|null} 对象入参；解析不出返回 null。
 */
function normalizeToolArgs(raw) {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 取入参里第一个像文件路径的值。 */
function pathOfArgs(args) {
  if (args === null) return undefined
  for (const key of FILE_PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * 从 `tool/call` 的入参里尽力提取被碰过的文件路径。
 *
 * 排序规则（2026-10-10 用户定调："让下一个会话顺着这两点去找文件、去查"）：
 *   **改过的文件排在前面**（edit/write 这类工具），只是读过的排在后面；
 *   去重、保持出现顺序、默认最多 20 条（列表太长反而没人看）。
 *
 * 这是**尽力而为**的近似（更准的真源是 ctx.workspaceChanges，是否可用随内核版本而变）。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{limit?: number}} [options] - `limit` 为最多返回多少条（默认 20）。
 * @returns {string[]} 文件路径列表（改过的在前）。
 */
export function extractTouchedFileEntries(events, { limit = 20 } = {}) {
  /** 首次出现顺序（决定同档次内的先后）。 */
  const order = []
  /** path → 是否被"写"类工具碰过（同一个文件先读后改，要按"改过"算）。 */
  const writtenBy = new Map()
  if (events === undefined || events === null) return []
  for (const event of events) {
    if (event?.type !== 'tool/call') continue
    const value = pathOfArgs(normalizeToolArgs(event.data?.arguments))
    if (value === undefined) continue
    const isWrite = WRITE_TOOL_NAMES.has(String(event.data?.name ?? ''))
    if (!writtenBy.has(value)) {
      order.push(value)
      writtenBy.set(value, isWrite)
    } else if (isWrite) {
      writtenBy.set(value, true)
    }
  }
  return order
    .map((path) => ({ path, written: writtenBy.get(path) === true }))
    .sort((a, b) => Number(b.written) - Number(a.written))
    .slice(0, limit)
}

/**
 * 同上的"只要路径"版本（测试与调用方图省事时用）。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{limit?: number}} [options] - `limit` 为最多返回多少条。
 * @returns {string[]} 文件路径列表（改过的在前）。
 */
export function extractTouchedFiles(events, options) {
  return extractTouchedFileEntries(events, options).map((entry) => entry.path)
}

/**
 * 取会话目标（用户当初提的原始需求）。
 *
 * 来源：`goal/change` 事件的 `data.goal.objective`（`dsh-goal` 写入的结构化字段，
 * 就是用户原话，不是会话闲聊）。交接文档的「用户需求」优先用模型凝练的版本，
 * 模型没写出来时用它兜底——**这是唯一允许直接引用用户原话的地方**。
 *
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @returns {string} 目标文本；没有则空串。
 */
export function extractGoalObjective(events) {
  let objective = ''
  if (events === undefined || events === null) return objective
  for (const event of events) {
    const goal = event?.data?.goal
    if (typeof goal?.objective === 'string' && goal.objective.trim().length > 0) objective = goal.objective.trim()
  }
  return objective
}

/**
 * 取待办快照里**还没做完**的项（`in_progress` 排在 `pending` 前面）。
 * 交接文档的「接下来做什么」优先用它——这比任何兜底句都更接近"接下来要做什么"。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{limit?: number}} [options] - `limit` 为最多返回多少条（默认 8）。
 * @returns {string[]} 未完成事项文本。
 */
export function extractOpenTodos(events, { limit = 8 } = {}) {
  const todos = extractTodos(events)
  const doing = todos.filter((todo) => todo?.status === 'in_progress').map((todo) => String(todo.content ?? '').trim())
  const pending = todos.filter((todo) => todo?.status === 'pending').map((todo) => String(todo.content ?? '').trim())
  return [...doing, ...pending].filter((line) => line.length > 0).slice(0, limit)
}


/**
 * 取**DSH 自己的压缩记忆**（`compaction/summary` 事件）——会话被压缩时，
 * 宿主会让模型把此前的内容总结成一份结构化记忆（原始需求 / 关键决策 / 文件 / 待办 / 下一步…）。
 *
 * 这就是"会话自己的记忆"，是写交接文档**最好的输入**：比逐字对话短、比猜测准。
 * 2026-10-10 用户定调：交接文档**不搬运会话原文**，改用它。
 *
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{limit?: number}} [options] - `limit` 为最多保留多少字符（默认 20000，取最新一条的尾部）。
 * @returns {string} 记忆正文（没有则空串）。
 */
export function extractCompactionMemory(events, { limit = 20000 } = {}) {
  if (events === undefined || events === null) return ''
  let latest = ''
  for (const event of events) {
    if (event?.type !== 'compaction/summary') continue
    const raw = event.data?.summary
    let text = ''
    if (typeof raw === 'string') {
      // 真实日志里 summary 是"JSON 字符串"，内容形如 [{"type":"text","text":"…"}]
      try {
        const blocks = JSON.parse(raw)
        text = Array.isArray(blocks)
          ? blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
          : raw
      } catch {
        text = raw
      }
    } else if (Array.isArray(raw)) {
      text = raw.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
    }
    if (text.trim().length > 0) latest = text.trim()
  }
  if (latest.length <= limit) return latest
  return `（记忆较长，保留后半部分）\n${latest.slice(-limit)}`
}

/**
 * 取**会话目标的历次修订**（`goal/change` 事件的 objective，去重保序）。
 *
 * ⚠️ 为什么要全部而不是只取最后一条：**用户往往要好幾轮才把需求说清楚**，
 *    中途还会改口（"不是，你改我的目标干什么?我的目的就是要做硬切"）。
 *    只留最后一条会丢掉"需求是怎么演进过来的"，只留第一条更糟（2026-10-10 用户强调）。
 *
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @returns {string[]} 按时间顺序的目标修订（去重）。
 */
export function extractGoalTimeline(events) {
  const seen = new Set()
  const timeline = []
  if (events === undefined || events === null) return timeline
  for (const event of events) {
    const objective = event?.data?.goal?.objective
    if (typeof objective !== 'string') continue
    const text = objective.trim()
    if (text.length === 0 || seen.has(text)) continue
    seen.add(text)
    timeline.push(text)
  }
  return timeline
}

/** 宿主注入到用户消息里的系统内容（不是用户说的话）。 */
const INJECTED_MESSAGE_PREFIXES = Object.freeze([
  '<goal_round>', '<system-reminder>', '<time', '<current_time', '<turn>', '<context',
  'Current runtime context',   // DSH 注入的运行时快照
  'Agent ',                     // Agent Team 队友消息（"Agent <id> sent a message:"）
  'Background subagent',        // 子代理完成通知
  'Background job',             // 后台任务通知
  'background job',
  'Subagent ',
  'Time sampled while preparing turn',   // 独立的时间戳消息（不是用户说的）
  'The approval policy changed',         // 宿主状态通知
  'The sandbox mode changed',
  '📋 会话硬切交接文档',        // 上一棒投进来的交接文档（不是用户当轮的要求）
])

/** 宿主附在用户消息尾部的时间样板（删掉，别当成需求）。 */
const INJECTED_MESSAGE_MARKERS = Object.freeze([
  '\nTime sampled while preparing turn',
  '\nBrowser time zone for this request',
  '\nElapsed since the preceding',
  '\nElapsed since the preceding model-visible message',
])

/**
 * 清洗一条用户消息：去掉宿主注入的尾巴；若整条都是注入内容则返回空串。
 * @param {string} text - 原始文本。
 * @returns {string} 清洗后的用户原话。
 */
export function cleanUserAsk(text) {
  let value = String(text ?? '').trim()
  for (const marker of INJECTED_MESSAGE_MARKERS) {
    const index = value.indexOf(marker)
    if (index >= 0) value = value.slice(0, index).trim()
  }
  const head = value.trimStart()
  if (INJECTED_MESSAGE_PREFIXES.some((prefix) => head.startsWith(prefix))) return ''
  return value
}

/**
 * 取**用户历轮提出的要求**（用户消息，按时间顺序，逐条截断）。
 *
 * ⚠️ 用途：需求可能分布在很多轮里，光靠"第一句话"或"最后一次目标"都会失真。
 *    这里只取**用户自己说的话**（不含助手回复、不含工具输出），每条截断，
 *    总额超限时**保头部 + 尾部**（开头是原始诉求，结尾是最终定稿）——中间细节由压缩摘要负责。
 *
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{perAskChars?: number, limit?: number}} [options] - 单条截断与总额上限。
 * @returns {string[]} 用户要求列表（已截断）。
 */
export function extractUserAsks(events, { perAskChars = 200, limit = 6000 } = {}) {
  const asks = []
  if (events === undefined || events === null) return asks
  for (const event of events) {
    if (event?.type !== 'user/message') continue
    const content = event.data?.message?.content ?? event.data?.content
    const text = Array.isArray(content)
      ? content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
      : typeof content === 'string' ? content : ''
    const trimmed = cleanUserAsk(text)
    if (trimmed.length === 0) continue
    asks.push(trimmed.length <= perAskChars ? trimmed : `${trimmed.slice(0, perAskChars)}…`)
  }
  let total = asks.reduce((sum, ask) => sum + ask.length + 2, 0)
  if (total <= limit) return asks
  // 超限：保头部 + 尾部（丢掉中段）
  const head = []
  const tail = []
  let headSize = 0
  let tailSize = 0
  let low = 0
  let high = asks.length - 1
  while (low <= high) {
    if (headSize <= tailSize && headSize + asks[low].length < limit / 2) {
      head.push(asks[low]); headSize += asks[low].length + 2; low += 1
    } else if (tailSize + asks[high].length < limit / 2) {
      tail.unshift(asks[high]); tailSize += asks[high].length + 2; high -= 1
    } else break
  }
  const dropped = high - low + 1
  return [...head, `（中间省略 ${dropped} 条）`, ...tail]
}

/**
 * 把 DSH 的 `turnOutline` 投影（全局逐轮大纲）格式化成"逐轮记忆"。
 *
 * 它和压缩摘要互补：**压缩摘要覆盖被压掉的旧内容，逐轮大纲覆盖整段日志（含最近几轮）**。
 * 每轮只保留"用户要什么 + 这轮干了什么"的开头，成段原文不进交接文档。
 *
 * @param {{turns?: Array<{turn?: number, prompt?: string, response?: string}>}|undefined} outline - 投影值。
 * @param {{promptChars?: number, responseChars?: number, limit?: number}} [options] - 每轮截断长度与总长上限。
 * @returns {string} 逐轮记忆（没有则空串）。
 */
export function formatTurnOutline(outline, { promptChars = 300, responseChars = 200, limit = 8000 } = {}) {
  const turns = Array.isArray(outline?.turns) ? outline.turns : []
  /** 每轮一个块，避免超限时把某一轮切在句子中间。 */
  const blocks = []
  for (const turn of turns) {
    const prompt = String(turn?.prompt ?? '').trim()
    const response = String(turn?.response ?? '').trim()
    if (prompt.length === 0 && response.length === 0) continue
    const lines = [`第 ${turn?.turn ?? '?'} 轮` + (prompt.length > 0 ? ` · 用户要什么：${prompt.slice(0, promptChars)}` : '')]
    if (response.length > 0) lines.push(`  做了/进展：${response.slice(0, responseChars)}`)
    blocks.push(lines.join('\n'))
  }
  if (blocks.length === 0) return ''
  // 超限时**保头部 + 尾部**：头部是需求怎么提的，尾部是现在到哪一步了（中间交给压缩摘要）
  // ⚠️ `kept` 是"头部正序 push + 尾部倒序 push"混着来的，**不是**从 blocks 直接过滤出来的，
  //    所以必须排序；但排序要按块在 `blocks` 里的**真实下标**，不能用 `blocks.indexOf(文本)`——
  //    内容完全相同的块会取到首次出现的位置，导致靠后的重复块被排到前面（顺序错乱），
  //    而且 `indexOf` 让复杂度变成 O(n²)（P2-15）。
  const kept = []
  let size = 0
  let low = 0
  let high = blocks.length - 1
  while (low <= high) {
    if (size + blocks[low].length + 1 <= limit / 2) {
      kept.push({ index: low, text: blocks[low] }); size += blocks[low].length + 1; low += 1
    } else if (size + blocks[high].length + 1 <= limit) {
      kept.push({ index: high, text: blocks[high] }); size += blocks[high].length + 1; high -= 1
    } else break
  }
  kept.sort((a, b) => a.index - b.index)
  const omitted = high - low + 1
  const text = kept.map((entry) => entry.text).join('\n')
  return omitted > 0 ? `（中间省略 ${omitted} 轮）\n${text}` : text
}

/**
 * 把**会话自己的记忆**拼成给模型的输入——**不含任何会话原文**。
 *
 * 内容：会话标题 + 原始需求（goal 里用户原话）+ DSH 自动压缩摘要 + 待办快照 + 碰过的文件。
 * 2026-10-10 用户定调：交接文档只写"需求 / 方案 / 已做 / 要做 / 参考资料"，
 * **不要把会话原文传给下一个会话**，直接读会话记忆即可。
 *
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{cwd?: string, title?: string, limit?: number}} [options] - 选项。
 * @returns {string} 事实段（没有可用事实时返回空串）。
 */
export function buildHandoffFacts(events, { cwd, title, limit = 30 } = {}) {
  if (events === undefined || events === null) return ''
  const lines = []
  if (typeof title === 'string' && title.trim().length > 0) lines.push('【会话标题】', title.trim())
  const goalTimeline = extractGoalTimeline(events)
  if (goalTimeline.length > 0) {
    lines.push('', '【需求演进（会话目标的历次修订，用户原话，按时间顺序）】')
    lines.push(...goalTimeline.map((objective, index) => `${index + 1}. ${objective}`))
  }
  const asks = extractUserAsks(events)
  if (asks.length > 0) {
    lines.push('', '【用户历轮提出的要求（按时间顺序，逐条截断）】')
    lines.push(...asks.map((ask, index) => `${index + 1}. ${ask}`))
  }
  const memory = extractCompactionMemory(events)
  if (memory.length > 0) lines.push('', '【会话记忆（DSH 自动压缩摘要，含需求/方案/进度/文件/下一步）】', memory)
  const todos = extractTodos(events)
  const done = todos.filter((todo) => todo?.status === 'completed').map((todo) => String(todo.content ?? '').trim()).filter((line) => line.length > 0)
  const open = extractOpenTodos(events)
  if (done.length > 0 || open.length > 0) {
    lines.push('', '【待办快照（会话最后一次 todo 状态）】')
    if (done.length > 0) lines.push('已完成：', ...done.map((line) => `- ${line}`))
    if (open.length > 0) lines.push('未完成：', ...open.map((line) => `- ${line}`))
  }
  const entries = extractTouchedFileEntries(events, { limit })
  if (entries.length > 0) {
    const prefix = typeof cwd === 'string' && cwd.length > 0 ? (cwd.endsWith('/') ? cwd : `${cwd}/`) : undefined
    lines.push('', '【本会话碰过的文件（改过 / 只看过）】')
    for (const entry of entries) {
      const path = prefix !== undefined && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path
      lines.push(`- ${path}（${entry.written ? '改过' : '查看过'}）`)
    }
  }
  return lines.length === 0 ? '' : lines.join('\n')
}

/**
 * 从 `tool/result` 里取失败的调用名（供上层参考；交接文档已不单列这一小节）。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @returns {string[]} 失败的调用描述列表。
 */
export function extractFailedCalls(events) {
  const nameByCallId = new Map()
  const failures = []
  if (events === undefined || events === null) return failures
  for (const event of events) {
    if (event?.type === 'tool/call' && typeof event.data?.callId === 'string') {
      nameByCallId.set(event.data.callId, typeof event.data.name === 'string' ? event.data.name : 'unknown-tool')
      continue
    }
    if (event?.type === 'tool/result') {
      const callId = event.data?.message?.callId
      const isError = event.data?.message?.isError === true || event.data?.error !== undefined
      if (isError && typeof callId === 'string') failures.push(nameByCallId.get(callId) ?? 'unknown-tool')
    }
  }
  return failures
}

/**
 * 渲染小节正文：空 → 显式占位；多行 → 逐行加 `- ` 的项目符号不变。
 * @param {string|string[]|undefined} value - 小节内容。
 * @returns {string} 正文（非空）。
 */
function renderSectionBody(value) {
  if (Array.isArray(value)) {
    const lines = value.map((line) => String(line).trim()).filter((line) => line.length > 0)
    return lines.length === 0 ? EMPTY_SECTION_TEXT : lines.map((line) => `- ${line}`).join('\n')
  }
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length === 0 ? EMPTY_SECTION_TEXT : text
}

/**
 * 安全序列化：**任何输入都不抛**（P2-16）。
 *
 * 为什么需要：`meta.trigger.detail` 来自判定链，理论上是标量对象，但"理论"挡不住
 * 循环引用（对象自己指向自己）与 BigInt —— `JSON.stringify` 对这两种输入会直接抛
 * `TypeError`，于是组装交接文档这一步整个炸掉、硬切失败。文档只是给人看的副本，
 * 不该有这种杀伤力。
 *
 * 口径：
 *   - BigInt → 十进制字符串（`10n` → `"10"`），保住信息不丢；
 *   - 循环引用 / 其它序列化失败 → 固定占位串 `[unserializable]`（可读、可搜索，绝不上抛）；
 *   - 顶层 `undefined` / 函数 / Symbol 等 `JSON.stringify` 返回 `undefined` 的情况 → `String(value)`。
 *
 * @param {unknown} value - 任意值。
 * @returns {string} 可读文本。
 */
export function safeStringify(value) {
  try {
    const text = JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))
    return text === undefined ? String(value) : text
  } catch {
    return '[unserializable]'
  }
}

/**
 * 安全 ISO 时间：**无效时间戳也不抛**（P2-16）。
 *
 * `new Date(NaN).toISOString()` 会抛 `RangeError: Invalid time value`；而 `createdAt`
 * （文档头）与 `at`（文件名时间戳）都是外部传进来的，不能假设它们一定有效。
 *
 * 兜底口径**选「当前时间」**（另一可选是写「未知时间」）：这两处表达的都是"这一刻产出的"，
 * 用当前时间既不撒谎（确实就是现在），又能保住文件名 `<时间戳>-<会话短码>.md` 的可排序格式。
 * 只有当连注入的 `now()` 都坏掉时才退到 Unix 纪元，确保永远不上抛。
 *
 * `null` / `undefined` / 空串按"未提供"处理（同 `??` 语义 → 当前时间），不是 1970。
 *
 * @param {unknown} value - 毫秒时间戳（或 `Date`）。
 * @param {{now?: () => number}} [options] - 可注入时间源（测试用）。
 * @returns {string} ISO 字符串（永远可解析，绝不上抛）。
 */
export function safeIsoTime(value, { now = Date.now } = {}) {
  const raw = value instanceof Date
    ? value.getTime()
    : (value === null || value === undefined || value === '' ? Number.NaN : Number(value))
  const date = new Date(Number.isFinite(raw) ? raw : now())
  if (!Number.isNaN(date.getTime())) return date.toISOString()
  const fallback = new Date(now())
  return (Number.isNaN(fallback.getTime()) ? new Date(0) : fallback).toISOString()
}

/**
 * 组装交接文档（新会话首条消息的正文）。
 *
 * ⚠️ **设计约束（2026-10-10 用户定调）**：交接文档**不搬运会话原文**。
 *    它只需要把「已经做的事项」和「接下来要做的事项」写清楚，
 *    让下一个会话能顺着这两点去找文件、去查。
 *    所以这里**没有"最近对话摘录"这种兜底**——宁可小节是「无」，也不把对话原文塞进去
 *    （原文既长又会让文档结构糊掉，读者和模型都难以分辨小节）。
 *
 * @param {object} input - 输入。
 * @param {object} input.meta - 文档元信息（fromSession/cwd/modelRoute/preset/trigger/chain）。
 * @param {object} [input.sections] - 各小节内容（键名须是 HANDOFF_DOC_SECTIONS 成员）。
 * @param {boolean} [input.summaryFailed] - 模型叙事是否失败（失败时头部标注）。
 * @param {string} [input.subagentSection] - R3 第 6 节正文（**仅当非空**时插入；无子代理不传）。
 * @param {string} [input.noteSection] - R4 交接人留言正文（**仅当非空**时插入；原样直插、零加工）。
 * @returns {string} Markdown 交接文档。
 */
export function composeHandoffDocument({ meta, sections = {}, summaryFailed = false, subagentSection, noteSection }) {
  const header = [
    `📋 ${HANDOFF_DOC_MARKER}（session handoff）`,
    '',
    `- 来源会话：\`${meta.fromSession}\``,
    `- 工作目录：${meta.cwd === undefined ? '（未记录）' : `\`${meta.cwd}\``}`,
    `- 模型路由：${meta.modelRoute === undefined ? '（未记录）' : `\`${meta.modelRoute.provider}/${meta.modelRoute.model}\``}`,
    `- Agent Preset：${meta.agentPreset === undefined ? '（未记录）' : `\`${meta.agentPreset}\``}`,
    // 这两处都用兜底版本（P2-16）：怪数据（循环引用 detail / 无效 createdAt）只退化成
    // 可读文本，绝不让整次硬切失败。
    `- 触发原因：${meta.trigger?.reason ?? 'unknown'}${meta.trigger?.detail === undefined ? '' : `（${safeStringify(meta.trigger.detail)}）`}`,
    `- 链路：${meta.chain === undefined ? '（未记录）' : `第 ${meta.chain.index} 棒 / 链 \`${meta.chain.chainId}\``}`,
    `- 生成时间：${safeIsoTime(meta.createdAt)}`,
    ...(summaryFailed ? ['', '> ⚠️ 摘要生成失败（模型没写出可用内容）：本轮由结构化字段拼装，只列事实、不含会话原文。'] : []),
    '',
  ]

  // R4（清单 §2.9）：留言节插在**头部之后、5 个小节之前**；**原样直插、零加工**。
  // ⚠️ 判定用 `length > 0`（纯空白在 host 入参层已归零）：不 trim、不折叠空白、不转义、不归一换行。
  const note = typeof noteSection === 'string' && noteSection.length > 0
    ? [`## ${HANDOFF_NOTE_SECTION}`, noteSection, '']
    : []

  const body = HANDOFF_DOC_SECTIONS.map((title) => {
    const value = sections[title]
    return `## ${title}\n${renderSectionBody(value)}`
  })

  // R3（ARB-4）：只检出子代理时插在 5 个小节**之后**、tail 之前，作第 6 节。
  const subagent = typeof subagentSection === 'string' && subagentSection.trim().length > 0
    ? [`## ${SUBAGENT_DOC_SECTION}\n${subagentSection}`]
    : []

  const tail = ['', '---', '', '请从「接下来做什么」继续。原会话未改动，需要细节时回原会话查看。']

  return [...header, ...note, ...body, ...subagent, ...tail].join('\n')
}

/**
 * 从模型写出的叙事里取出**会话标题**（第一行的 `标题：xxx`）。
 *
 * 为什么要它：新会话如果都用写死的标题（如 `handoff: 会话交接`），
 * 侧栏里一堆新会话长得一模一样、根本分不清（2026-10-10 用户提出）。
 * 所以让主模型在写文档时顺带给一个**从需求凝练、能区分任务**的短标题。
 *
 * @param {string|undefined} narrative - 模型输出。
 * @param {{maxChars?: number}} [options] - 标题最长字数（默认 24）。
 * @returns {{title: string, rest: string}} 标题与去掉标题行之后的正文。
 */
export function parseNarrativeTitle(narrative, { maxChars = 24 } = {}) {
  const text = String(narrative ?? '')
  const match = /^[ \t]*(?:标题|title)[ \t]*[:：][ \t]*(.+?)[ \t]*$/im.exec(text)
  if (match === null) return { title: '', rest: text }
  // 统一清洗（去英文标签 / markdown / 引号 + 截断）——名字必须是中文短语
  const title = sanitizeTitleName(match[1], { maxChars })
  const rest = text.slice(0, match.index) + text.slice(match.index + match[0].length)
  return { title, rest }
}

/** 是否含中日韩文字（用来判断"这是不是中文名"）。 */
export function hasChinese(text) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(String(text ?? ''))
}

/**
 * 把候选标题清洗成**能直接当会话名用的中文短语**。
 *
 * 踩坑（2026-10-12 用户截图）：压缩记忆里写的是 `- Original goal: "去阅读代码review…"`，
 * 只清 `Original goal:` 会漏掉 `Original:`，于是英文标签直接进了会话名。
 * 这里统一：去英文标签 → 去 markdown/引号 → 压空白 → 截断。
 *
 * @param {string} text - 候选文本。
 * @param {{maxChars?: number}} [options] - 最长字数（默认 20）。
 * @returns {string} 清洗后的名字（可能为空串）。
 */
export function sanitizeTitleName(text, { maxChars = 20 } = {}) {
  let value = String(text ?? '').replace(/[\r\n]+/g, ' ')
  // 英文标签（含引号/冒号）：Original: / Original goal: / Goal: / Primary Request: / Title: …
  value = value.replace(/^[\s\-*]*\b(?:original(?:\s+goal)?|goal|primary\s+request(?:\s+and\s+intent)?|title|titleinput|session\s+title)\b\s*[:：]\s*/iu, '')
  value = value
    .replace(/[*`#]/g, '')
    .replace(/^[\s"'“”「『]+|[\s"'“”」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (value.length === 0) return ''
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`
}

/**
 * 模型没给标题时，从**会话记忆**里兜一个能区分的标题（目标原文 → 第一条用户要求）。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @param {{maxChars?: number}} [options] - 标题最长字数（默认 20）。
 * @returns {string} 标题；没有可用来源时返回空串。
 */
export function deriveRequirementTitle(events, { maxChars = 20, headerTitle } = {}) {
  if (events === undefined || events === null) return ''
  const goal = sanitizeTitleName(extractGoalObjective(events), { maxChars })
  const asks = extractUserAsks(events, { perAskChars: 80 })
  // 优先级：会话目标（用户原话）→ 会话自己的标题（DSH 自动生成/用户重命名）
  // → 压缩记忆里的首要意图 → 第一条用户要求。标记类标题（交接出入/已换会话）跳过。
  const own = typeof headerTitle === 'string' ? headerTitle.trim() : ''
  const headerCandidate = own.length > 0 && !own.includes('已换会话') && !own.startsWith('📋') && !/^交接[入出]-/u.test(own)
    ? sanitizeTitleName(own, { maxChars })
    : ''
  const memory = extractCompactionMemory(events)
  const intentMatch = /##\s*Primary Request and Intent\s*\n+([^\n]+)/.exec(memory)
  const intent = sanitizeTitleName(intentMatch?.[1] ?? '', { maxChars })
  const firstAsk = sanitizeTitleName(asks[0] ?? '', { maxChars })
  const candidates = [goal, headerCandidate, intent, firstAsk].filter((candidate) => candidate.length > 0)
  // ⚠️ 名字必须中文（2026-10-12 用户要求）：有中文候选就用中文；
  //    全是英文时才用英文（那是用户自己写的英文，允许保留）。
  return candidates.find(hasChinese) ?? candidates[0] ?? ''
}

/**
 * 数一数"除「接下来做什么」外，有几个小节真的有内容"。
 *
 * ⚠️ **必须在渲染前的小节对象上数，不许在渲染后的 Markdown 文本上数**（2026-10-10 实机教训）：
 *   交接文档的「任务目标」正文**经常本身就含 `## xxx` 行**——新会话的第一条消息就是一份交接文档。
 *   在文本上"找标题取正文"会被嵌在正文里的同名标题带偏，把真实内容误判成占位符「无」，
 *   于是一份有内容的文档被门禁拒掉。
 *
 * @param {Record<string, string|string[]|undefined>} sections - 各小节内容。
 * @returns {number} 有实质内容的小节数（占位符 `无` / 空数组不算）。
 */
export function countSubstantiveSections(sections) {
  return HANDOFF_DOC_SECTIONS.filter((title) => title !== '接下来做什么').filter((title) => {
    const value = sections?.[title]
    if (Array.isArray(value)) return value.some((line) => String(line).trim().length > 0)
    return typeof value === 'string' && value.trim().length > 0 && value.trim() !== EMPTY_SECTION_TEXT
  }).length
}

/**
 * 结构门禁（M1 §2.3）：
 *   1) 5 个标题必须齐全，任一缺失或拼错 → 拒绝；
 *   2) 「接下来做什么」非空且 ≥ MIN_NEXT_STEP_CHARS 个字符。
 *
 * **两种判定口径（2026-10-12 独立复核 P2-14 修）**：
 *   - 传了第二个参数 `sections`（结构化小节对象）→ **以小节对象为准**：标题齐全 = 5 个
 *     标题都在 `sections` 的键里；「接下来做什么」取该键的正文长度。
 *   - 没传 `sections` → 退回**文本反解**（下面的文本路径），保持向后兼容。
 *
 * ⚠️ **调用方约定**：`buildHandoffDocument()`（`handoff-exec.mjs`）渲染文档时手里已经有
 *    `sections` 对象，**必须把它一起传进来**：`checkHandoffDocument(doc, sections)`。
 *    只在渲染后的 Markdown 文本上反解会被"正文里嵌着的同名标题"带偏——新会话的第一条消息
 *    本身就是一份交接文档，于是「用户需求」正文里也带着 `## 接下来做什么` 这些行；
 *    `sectionBodyOf()` 会先撞上嵌在正文里的那一份，把真小节读错（多为读成很短 → 误判
 *    `next-step-too-short`），于是一份好文档被拒、模型写的整篇叙事被丢掉退回结构化版。
 *    这里**不自己解析文本**，所以传 `sections` 时不受嵌入标题影响。
 *
 * 「有没有实质内容」这条**不在这里判**，由 `buildHandoffDocument()` 在渲染前用
 * `countSubstantiveSections()` 判（原因见该函数说明：渲染后的文本无法可靠地反解小节）。
 *
 * @param {string} doc - 交接文档全文。
 * @param {Record<string, string|string[]|undefined>} [sections] - 渲染这份文档用的结构化小节；
 *   传了就以它为准（推荐），不传则退回文本反解。
 * @returns {{ok: true} | {ok: false, code: string, message: string}} 门禁结果。
 */
export function checkHandoffDocument(doc, sections) {
  if (typeof doc !== 'string' || doc.trim().length === 0) {
    return { ok: false, code: 'empty', message: 'handoff document is empty' }
  }
  // 只有真的给了"小节对象"才走结构化口径；null / 数组 / 非对象一律忽略（向后兼容）。
  const useSections = sections !== null && typeof sections === 'object' && !Array.isArray(sections)
  const missing = []
  for (const title of HANDOFF_DOC_SECTIONS) {
    if (useSections) {
      // 结构化口径：5 个标题必须都在 sections 里（值允许为空——空小节渲染成占位符 `无`）。
      if (!Object.hasOwn(sections, title)) missing.push(title)
      continue
    }
    // 文本口径：标题必须作为独立一行的二级标题逐字出现。
    const pattern = new RegExp(`^## ${title}$`, 'm')
    if (!pattern.test(doc)) missing.push(title)
  }
  if (missing.length > 0) {
    return { ok: false, code: 'missing-sections', message: `handoff document is missing section(s): ${missing.join(', ')}` }
  }
  // 长度口径与文本路径严格一致：都用"这一段最终会渲染成的那段文字"来数
  //（数组会逐行加 `- `、空小节是占位符 `无`），阈值仍是 MIN_NEXT_STEP_CHARS，没动。
  const nextStep = useSections ? renderSectionBody(sections['接下来做什么']) : sectionBodyOf(doc, '接下来做什么')
  if (nextStep.length < MIN_NEXT_STEP_CHARS) {
    return {
      ok: false,
      code: 'next-step-too-short',
      message: `handoff document 「接下来做什么」 must be at least ${MIN_NEXT_STEP_CHARS} characters, got ${nextStep.length}`,
    }
  }
  return { ok: true }
}

/**
 * 取某个小节的正文（仅供门禁取「接下来做什么」与测试使用）。
 * ⚠️ 这是**尽力而为**的文本解析：正文里嵌同名标题时可能取错段落。
 * 判断"有没有内容"请用 `countSubstantiveSections()`，不要在渲染后的文本上做判断。
 * @param {string} doc - 交接文档全文。
 * @param {string} title - 小节标题。
 * @returns {string} 小节正文（不含标题行，已 trim）。
 */
export function sectionBodyOf(doc, title) {
  // ⚠️ 结尾不能用 `$`：`m` 模式下的 `$` 会匹配**任意行尾**，多行正文会被截断在第一行
  //    （2026-10-10 实测：「接下来做什么」变成多行后，门禁只读到第一行 → 误判太短）。
  //    用 (?!([\s\S])) 表示"后面再没有任何字符"＝真正的文末。
  const pattern = new RegExp(`^## ${title}$\\n([\\s\\S]*?)(?=\\n## |\\n---\\n|(?![\\s\\S]))`, 'm')
  const match = pattern.exec(doc)
  return match === null ? '' : match[1].trim()
}

/**
 * 规整标题行文本：去掉标题上的 markdown 装饰与首尾空白（`**用户需求**` / `` `用户需求` ``）。
 * @param {string} raw - `##` 之后、换行之前的原始文本。
 * @returns {string} 规整后的标题文本。
 */
function normalizeHeadingText(raw) {
  // 只剥"装饰性"的首尾字符，中间内容原样保留（正文可能以 * 开头，剥了会丢信息）。
  return String(raw ?? '').replace(/^[*`_\s]+/, '').replace(/[*`_\s]+$/, '')
}

/**
 * 把"标题后面的尾巴"清成同行正文。
 *
 * 支持的标题变体（2026-10-12 P2-13）：
 *   - 行尾多余的冒号，全角半角都算：`## 用户需求：` / `## 用户需求:`；
 *   - 标题后的英文括注：`## 方案梗概 (current progress)` / `## 已完成 [done]`——
 *     括注里只要有拉丁字母，就整段当标题装饰（不当正文），`(1)` 这种数字括注不动它；
 *   - 标题标记：`## **用户需求** 正文`。
 * 其余情况原样当同行正文返回（`## 用户需求 把 A 做完` → `把 A 做完`）。
 *
 * @param {string} tail - 标题之后（已确认以某个小节标题开头）的剩余文本。
 * @returns {string} 同行正文；没有则空串。
 */
function cleanInlineHeadingBody(tail) {
  let value = String(tail ?? '').replace(/^[*`_\s]+/, '').trim()
  // 纯英文括注（含至少一个拉丁字母）＝标题装饰，不是正文
  value = value.replace(/^[（(【\[]([^）)】\]]*[A-Za-z][^）)】\]]*)[）)】\]]/, '').trim()
  // 标题后的冒号（全/半角，可能连续几个）也算装饰
  value = value.replace(/^[:：]+/, '').trim()
  return value
}

/**
 * 判断一个标题行是不是 `HANDOFF_DOC_SECTIONS` 里的某一节，并拆出**同行正文**。
 *
 * 只认这 5 个标题的前缀（`startsWith`，兼容标题后带英文括注的旧写法），
 * 认不到返回 `undefined`——**不是**"随便一行都当标题"：调用方只把 `##` / `###` 开头的行送进来。
 *
 * @param {string} raw - `##`/`###` 之后、换行之前的原始文本。
 * @returns {{title: string, inline: string}|undefined} 命中的小节与同行正文。
 */
function matchSectionHeading(raw) {
  const text = normalizeHeadingText(raw)
  for (const title of HANDOFF_DOC_SECTIONS) {
    if (!text.startsWith(title)) continue
    return { title, inline: cleanInlineHeadingBody(text.slice(title.length)) }
  }
  return undefined
}

/**
 * 把 LLM 摘要按小节切开（宽松解析）。
 *
 * 2026-10-12 P2-13 修：只认"`## 标题` 单独成行、正文在下一行"时会**静默丢叙事**——
 * 模型只要写成 `## 用户需求 把 A 做完`（标题与正文同一行），正文就被算成空、
 * 该节整段被丢，用户只看到文档缩水、没有任何报错。现在支持：
 *   - **标题与正文同一行**：`## 用户需求 把 A 做完` → 正文 `把 A 做完`（可再接后续行）；
 *   - **`###` 三级标题**（以及行首多余空白、`#` 后多余空格）；
 *   - **标题变体容错**：行尾多余的全角/半角冒号、英文括注（详见 cleanInlineHeadingBody）。
 *
 * 语义保持不变：
 *   - 只认 `HANDOFF_DOC_SECTIONS` 里的 5 个标题，别的标题行一律忽略（但它仍是**边界**，
 *     后面那段文字不会并进上一节）；
 *   - **先出现者优先**：同名标题出现多次，只取第一次有正文的那次；
 *   - 正文为空的节不写进结果（保持原行为）。
 *   ⚠️ 若整个摘要连一个可识别标题都没有，返回**空对象** `{}`——不做任何猜测性兜底，
 *      调用方（`structuredSections`）会退回纯结构化版本（旧注释里"认不到就退化为整段塞进
 *      某节"的说法与实际不符，已删除）。
 *
 * 只做**宽松**解析，严格门禁由 checkHandoffDocument 负责。
 * @param {string} summary - 模型输出的 Markdown 摘要。
 * @returns {Record<string, string>} 小节映射（无可用小节时为空对象）。
 */
export function parseSummarySections(summary) {
  const sections = {}
  if (typeof summary !== 'string' || summary.trim().length === 0) return sections
  // 标题行：2~3 级标题（`##` / `###`）——`####` 这类只是当边界，不会命中 5 个标题。
  const pattern = /^[ \t]*#{2,3}[ \t]*(.+?)[ \t]*$/gm
  const hits = []
  let match
  while ((match = pattern.exec(summary)) !== null) {
    hits.push({
      // 未命中 5 个小节的标题行 heading 为 undefined，但仍要占位当"下一节从这里开始"的边界。
      heading: matchSectionHeading(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  for (let index = 0; index < hits.length; index += 1) {
    const heading = hits[index].heading
    if (heading === undefined) continue
    const end = index + 1 < hits.length ? hits[index + 1].start : summary.length
    const tail = summary.slice(hits[index].end, end).trim()
    // 同行正文在前、后续行在后（两者都有就都要，不再二选一丢一边）。
    const body = [heading.inline, tail].filter((part) => part.length > 0).join('\n').trim()
    if (body.length > 0 && sections[heading.title] === undefined) sections[heading.title] = body
  }
  return sections
}
