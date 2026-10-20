/** LLM 交接摘要生成：经 ctx.llm.stream 的一次性辅助调用（参考官方 session-title-llm）。 */

// ⚠️ 这里**不能**顶层 import '@deepseek-ai/dsh-llm'：插件顶层一旦引内核包，
//    宿主 import 插件时就会 ERR_MODULE_NOT_FOUND → 整个插件启用失败（2026-10-10 实机）。
//    详见 lib/dsh-llm-bridge.mjs 顶部的排查记录。
import { createUserMessage, loadKernelLlm, reasoningEffortId } from './dsh-llm-bridge.mjs'
import { frameItemsForSummary, truncateText } from './summary.mjs'

/** 稳定的交接摘要系统提示（模型可见；输出为结构化 Markdown）。 */
export const HANDOFF_SYSTEM_PROMPT = [
  'You are producing a handoff document that lets a fresh agent session continue a task started in an earlier session.',
  'The user input is a JSON array of recent conversation turns: {"role":"user"|"assistant","text":"..."}.',
  'Write a concise handoff in Markdown with EXACTLY these five sections:',
  '## 用户需求 (the user\'s requirement, condensed but complete)',
  '## 方案梗概 (plan/approach overview; include paths of any plan docs)',
  '## 已完成 (what is done, item by item)',
  '## 涉及文件与产物 (each file/artifact: path — what it is for)',
  '## 接下来做什么 (next steps, ordered and concrete)',
  'Write in the language of the conversation. Be concrete and factual; do not invent facts.',
  'Return only the handoff document, no preamble, no code fences.',
].join('\n')

/**
 * 把终态 finish reason 翻译成可操作的错误（无错误返回 undefined）。
 * @param {{kind?: string, failure?: {message?: string}}|undefined} finish - BlockAssembler.finish。
 * @param {number} maxTokens - 输出预算（错误消息里给出建议）。
 * @returns {Error|undefined} 终止错误或 undefined。
 */
function finishError(finish, maxTokens) {
  if (finish === null || typeof finish !== 'object') {
    return new Error('model stream finished without a finish reason')
  }
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const detail = typeof finish.failure?.message === 'string' ? finish.failure.message : `model stream ${finish.kind}`
      return new Error(detail)
    }
    case 'max-tokens':
      return new Error(`summary output reached maxTokens ${maxTokens}; high reasoning effort may have consumed the budget — raise maxTokens`)
    case 'tool-calls':
      return new Error('summary model unexpectedly requested a tool')
    default:
      return new Error(`unsupported finish reason "${String(finish.kind)}"`)
  }
}

/**
 * 调用模型生成交接摘要。输入超限时由 frameItemsForSummary 自动丢弃最旧
 * 条目以适配 maxInputChars（返回 dropped 计数供调用方提示）；
 * `facts`（会话记忆，自动硬切只送它）同样按 maxInputChars 做字节截断，
 * 保证"缩小输入重试"真的缩小输入（P1-7）。
 * @param {{llm: object, session: object, route: {provider: string, model: string}, items: Array<{role: string, text: string}>, config: {maxInputChars: number, maxTokens: number, reasoningEffort: string, system?: string}, signal: AbortSignal}} deps - 依赖与输入。
 * @returns {Promise<{text: string, dropped: number}>} 摘要文本与被丢弃的条目数。
 */
export async function generateSummary({ llm, session, route, items, config, signal, facts }) {
  const { framed, dropped } = frameItemsForSummary(items, config.maxInputChars)
  // 「事实段」在前（会话目标 / 待办快照 / 碰过的文件），对话原文 JSON 在后。
  // 模型据此做凝练与标注，而不是只从字里行间猜（2026-10-10 用户质疑"为什么只能凭几轮盲猜"）。
  //
  // ⚠️ P1-7 修复：自动硬切的主路径传 `items: []`（只送会话记忆），此时
  //    `frameItemsForSummary([], …)` 永远装得下 `'[]'`，maxInputChars 形同虚设，
  //    真正送模型的 facts（会话记忆）没有任何上限；`handoff-exec.mjs` 的兜底重试
  //    把 maxInputChars 减半也就成了空操作。所以 facts 必须**自己**过同一道字节上限。
  const factsRaw = typeof facts === 'string' ? facts.trim() : ''
  const factsPart = truncateText(factsRaw, config.maxInputChars)
  // 有会话记忆就只用记忆（不塞对话原文）；两者都没有才退回原文（老路径 /handoff 命令用）。
  const promptText = factsPart.length > 0
    ? (items.length > 0 ? `${factsPart}\n\n【对话原文（JSON 数组）】\n${framed}` : factsPart)
    : framed
  const messages = [createUserMessage({
    content: [{ type: 'text', text: promptText }],
    source: { kind: 'plugin', plugin: 'dsh-session-handoff', form: 'handoff-request', summary: 'handoff' },
  })]
  const options = {
    provider: route.provider,
    model: route.model,
    messages,
    // system 可由调用方覆盖（硬切骨架用 HANDOFF_NARRATIVE_PROMPT 只让它写 4 段叙事，
    // 保证小节标题与 HANDOFF_DOC_SECTIONS 逐字对齐）；不传则用蓝本默认提示。
    system: config.system ?? HANDOFF_SYSTEM_PROMPT,
    maxTokens: config.maxTokens,
    // 摘要调用默认关闭思考：思考 token 会挤占输出预算且对压缩任务无益；
    // inherit 表示不传该字段，跟随会话/适配器默认。
    ...(config.reasoningEffort !== undefined && config.reasoningEffort !== 'inherit'
      ? { reasoningEffort: reasoningEffortId(config.reasoningEffort) }
      : {}),
    sessionId: session.id,
    signal,
  }
  // 内核的 BlockAssembler 是正经的流式装配器（处理 block-start / *-delta / block-end / finish），
  // **不重写**（重写容易与内核语义跑偏）；改为运行时按需加载。拿不到就抛错，由调用方降级到结构化摘要。
  const { BlockAssembler } = await loadKernelLlm()
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    signal?.throwIfAborted?.()
    assembler.push(chunk)
  }
  signal?.throwIfAborted?.()
  const terminal = finishError(assembler.finish, config.maxTokens)
  if (terminal !== undefined) throw terminal
  const blocks = assembler.blocks()
  const text = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    const hasReasoning = blocks.some((block) => block.type === 'reasoning')
    throw new Error(hasReasoning
      ? 'summary model produced only reasoning (thinking) and no text — raise maxTokens or lower reasoning effort'
      : 'summary model produced no text')
  }
  return { text: trimmed, dropped }
}
