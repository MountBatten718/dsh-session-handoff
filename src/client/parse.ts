// 客户端纯函数：/handoff 完成事件识别与新会话 id 提取。
// 无 react / 无 @deepseek-ai 依赖，可用 node --experimental-strip-types 直接单测。

/** 命中交接成功标记的固定前缀（与宿主成功消息第一行一致）。 */
export const SUCCESS_PREFIX = 'handoff: created a fresh session'

/** 命令结果文本里新会话 id 的形态（`` `session-<id>` ``，宿主文案保证）。 */
const SESSION_ID_PATTERN = /`(session-[a-z0-9-]+)`/

/**
 * 从命令结果文本提取新会话 id。
 * @param text - 宿主成功消息文本。
 * @returns 新会话 id；未命中时 undefined。
 */
export function extractChildId(text: string): string | undefined {
  const match = SESSION_ID_PATTERN.exec(text)
  return match?.[1]
}

/**
 * 判断是否为 /handoff 的成功完成事件（command/done + kind=success + 成功标记）。
 * @param event - 会话事件。
 * @returns 是否命中。
 */
export function isHandoffDone(event: unknown): boolean {
  if (event === null || typeof event !== 'object') return false
  const typed = event as { type?: unknown; data?: { kind?: unknown; text?: unknown } }
  if (typed.type !== 'command/done') return false
  const data = typed.data
  if (data?.kind !== 'success' || typeof data.text !== 'string') return false
  return data.text.includes(SUCCESS_PREFIX)
}
