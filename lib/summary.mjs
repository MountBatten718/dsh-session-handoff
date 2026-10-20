/** 会话提取、参数解析与交接文档组装（纯函数，零依赖，可单测）。 */

/**
 * UTF-8 字节数（与 `frameItemsForSummary` 同口径：`Buffer.byteLength`）。
 * @param {string} text - 文本。
 * @returns {number} 字节数。
 */
function utf8Bytes(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * 按 UTF-8 字节数取**头部**切片（绝不切碎多字节字符）。
 * @param {string} text - 文本。
 * @param {number} maxBytes - 字节上限。
 * @returns {string} 前缀。
 */
function headByBytes(text, maxBytes) {
  let bytes = 0
  let out = ''
  for (const char of text) {
    const size = utf8Bytes(char)
    if (bytes + size > maxBytes) break
    bytes += size
    out += char
  }
  return out
}

/**
 * 按 UTF-8 字节数取**尾部**切片（绝不切碎多字节字符）。
 * @param {string} text - 文本。
 * @param {number} maxBytes - 字节上限。
 * @returns {string} 后缀。
 */
function tailByBytes(text, maxBytes) {
  const chars = [...text]
  let bytes = 0
  let out = ''
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const size = utf8Bytes(chars[index])
    if (bytes + size > maxBytes) break
    bytes += size
    out = chars[index] + out
  }
  return out
}

/**
 * 截断标记（把 N 字节的省略量写清楚，避免模型/用户以为内容完整）。
 * @param {number} omitted - 被省略的字节数。
 * @returns {string} 标记。
 */
function omissionMarker(omitted) {
  return `\n…（中间省略 ${omitted} 字节）…\n`
}

/**
 * 按 UTF-8 字节数截断文本：**头部 + 尾部**都要保留，中间插入明确的省略标记。
 *
 * 为什么保留尾部：交接摘要/模型输入里"最近发生了什么、接下来要做什么"往往在尾部，
 * 只留头会把最新状态丢掉；所以超限时掐中间而不是只掐尾巴。
 *
 * 契约（`lib/llm.mjs` 的 `maxInputChars` 依赖它）：
 * - 返回值按 `Buffer.byteLength(…, 'utf8')` **一定 ≤ maxBytes**；
 * - `maxBytes` 非法（非数字 / NaN / Infinity / ≤ 0）时**原样返回**；
 * - 没超限时原样返回（不做任何改写）；
 * - 不会截出半个多字节字符（按码点切，结果仍是合法 UTF-8）。
 *
 * @param {string} text - 原文本。
 * @param {number} maxBytes - UTF-8 字节上限。
 * @returns {string} 截断后的文本。
 */
export function truncateText(text, maxBytes) {
  if (typeof text !== 'string') return text
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return text
  const total = utf8Bytes(text)
  if (total <= maxBytes) return text

  // 用"N = total"的位数预留标记空间：实际省略量 ≤ total，位数只会更少，
  // 所以最终标记一定放得下，返回值天然 ≤ maxBytes（不需要额外回退）。
  const reserved = utf8Bytes(omissionMarker(total))
  const budget = maxBytes - reserved
  if (budget <= 0) {
    // 预算小到连标记都装不下：退化为纯头部截断，仍然严格不超上限。
    return headByBytes(text, maxBytes)
  }
  const headBudget = Math.ceil(budget / 2)
  const tailBudget = budget - headBudget
  const head = headByBytes(text, headBudget)
  const tail = tailByBytes(text, tailBudget)
  const omitted = total - utf8Bytes(head) - utf8Bytes(tail)
  return `${head}${omissionMarker(omitted)}${tail}`
}

/**
 * 从内容块里取出全部 text 块文本。
 * @param {Array<{type: string, text?: string}>|undefined} blocks - 消息内容块。
 * @returns {string} 拼接后的文本（无 text 块则为空串）。
 */
export function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * 从会话事件流中提取最近的对话文本（user/message 与 assistant/message 的
 * text 块）。`turns` 为数字时按"最后 N 轮用户消息"裁剪：保留第 (len-N+1)
 * 条用户消息起的所有条目（含其后的助手回复）；为 'all' 时保留全部。
 * @param {Iterable<object>|undefined} events - 会话事件数组（**必须**经 `session-events.mjs`
 *   的 `sessionEvents()` 取——真实宿主没有 `session.events` 属性，见该模块头注释）。
 * @param {{turns: number|'all'}} options - 保留的用户消息轮数（≥1）或 'all'。
 * @returns {{userCount: number, items: Array<{role: 'user'|'assistant', text: string}>}}
 *   userCount 为裁剪后用户消息数；items 按时间序。
 */
export function extractRecentMessages(events, { turns }) {
  const items = []
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    let role
    let blocks
    if (event.type === 'user/message') {
      role = 'user'
      blocks = event.data?.content
    } else if (event.type === 'assistant/message') {
      role = 'assistant'
      blocks = event.data?.message?.content
    } else {
      continue
    }
    const text = textOfBlocks(blocks)
    if (text.length === 0) continue
    items.push({ role, text })
  }
  const userIndexes = []
  items.forEach((item, index) => {
    if (item.role === 'user') userIndexes.push(index)
  })
  if (userIndexes.length === 0) return { userCount: 0, items: [] }
  const start = turns === 'all' ? 0 : userIndexes[Math.max(0, userIndexes.length - turns)]
  const sliced = items.slice(start)
  return {
    userCount: sliced.filter((item) => item.role === 'user').length,
    items: sliced,
  }
}

/**
 * 解析 /handoff 参数。支持简写与显式两种写法：
 * - 空 → 默认轮数；`all` 或 `turns=all` → 全部；`20` 或 `turns=20` → 20 轮；
 * - 非法输入回退默认值并附带错误提示。
 * @param {string} rawInput - 命令原始输入（去掉命令名后）。
 * @param {number} defaultTurns - 默认轮数。
 * @param {{min: number, max: number}} [bounds] - 轮数边界。
 * @returns {{turns: number|'all', invalid: string|undefined}} 解析结果。
 */
export function parseHandoffArgs(rawInput, defaultTurns, bounds = { min: 1, max: 50 }) {
  const input = typeof rawInput === 'string' ? rawInput.trim() : ''
  if (input.length === 0) return { turns: defaultTurns }
  // 显式 `turns=<值>` 写法与简写 `<值>` 等价。
  const value = /^turns\s*=\s*(.+)$/i.exec(input)?.[1] ?? input
  if (/^all$/i.test(value)) return { turns: 'all' }
  const match = /^(\d+)$/.exec(value)
  if (match === null) return { turns: defaultTurns, invalid: `handoff: unknown argument "${input}" (usage: /handoff [<N>|all])` }
  const turns = Number(match[1])
  if (!Number.isSafeInteger(turns) || turns < bounds.min || turns > bounds.max) {
    return { turns: defaultTurns, invalid: `handoff: turns must be an integer in [${bounds.min}, ${bounds.max}] or "all"` }
  }
  return { turns }
}

/**
 * 把对话条目帧化为送模型的 JSON。
 *
 * 超限时的丢弃策略（2026-10-10 修正）：**先丢最旧的"助手"消息，最后才丢用户消息**——
 * 用户消息是"用户需求"的唯一线索，丢一条就可能丢掉关键信息；助手的长篇回答只是细节。
 * 还不够装就退化为从最旧开始丢（最后一根稻草）。单条消息本身就超限时抛错。
 *
 * @param {Array<{role: 'user'|'assistant', text: string}>} items - 对话条目。
 * @param {number} maxBytes - 输入字节上限。
 * @returns {{framed: string, dropped: number}} 帧化 JSON 与被丢弃的条目数。
 */
export function frameItemsForSummary(items, maxBytes) {
  const frame = (list) => JSON.stringify(list.map((item) => ({ role: item.role, text: item.text })))
  const list = [...items]
  let dropped = 0
  // 先丢最旧的助手消息
  while (utf8Bytes(frame(list)) > maxBytes) {
    const index = list.findIndex((item) => item.role === 'assistant')
    if (index < 0) break
    list.splice(index, 1)
    dropped += 1
  }
  // 还不够就丢最旧的（含用户消息，属最后手段）
  while (list.length > 1 && utf8Bytes(frame(list)) > maxBytes) {
    list.shift()
    dropped += 1
  }
  const framed = frame(list)
  if (utf8Bytes(framed) > maxBytes) {
    throw new Error(`a single conversation message already exceeds maxInputChars ${maxBytes} — raise maxInputChars`)
  }
  return { framed, dropped }
}

/**
 * 组装交接文档（新会话首条消息的正文）。
 * @param {{sourceId: string, sourceTitle: string|undefined, summary: string}} parts - 来源与摘要。
 * @returns {string} Markdown 交接文档。
 */
export function composeHandoffDoc({ sourceId, sourceTitle, summary }) {
  const titleLine = typeof sourceTitle === 'string' && sourceTitle.length > 0 ? `（${sourceTitle}）` : ''
  return [
    '📋 会话交接（handoff）',
    '',
    `来源会话：\`${sourceId}\`${titleLine}`,
    '',
    summary,
    '',
    `> 由 dsh-session-handoff 生成。原会话 \`${sourceId}\` 未改动；需要细节时回到原会话查看。`,
  ].join('\n')
}
