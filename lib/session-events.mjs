// 会话事件读取：**宿主契约的唯一出口**。
//
// ⚠️ 真实宿主（@deepseek-ai/dsh-session 的 `Session` 类）**没有 `.events` 属性**，
// 事件只能通过方法拿：
//     snapshotEvents(fromSeq = 0, toSeqExclusive = seq): readonly SessionEvent[]
//     ownEvents(): readonly SessionEvent[]
//     eventAt(seq): SessionEvent | undefined
//   公开成员表见 `Session` 类声明；宿主自己也是 `attached.snapshotEvents()` 这么取的
//   （dsh-api-session-controller 的 types/index.js 与 types/commands.js 各一处）。
//
// 2026-10-10 事故根因：
//   历史代码处处直接读 `session.events`，真实宿主上恒为 `undefined`，
//   又被 `Array.isArray(session.events) ? session.events : []` 吞成**空数组**，
//   于是：交接文档 8 小节全空（`无`）、安全点判定恒为"安全"、摘要环节连模型都没调就返回。
//   空文档还表面"过门禁"，一路静默切了过去。
//
// 本模块的约定（**不许再改**）：
//   1. 只在这里认宿主契约，别处不许再出现 `session.events` 直读；
//   2. **读不到就返回 `undefined`**，绝不伪装成空数组——"读不到"必须由调用方显式裁决
//      （拒绝硬切 / 保守判不安全点 / 标记失败），不许静默降级。

/** 事件读取失败时的统一人话文案（给用户看，含处置结论）。 */
export const EVENTS_UNAVAILABLE_REASON =
  '读不到会话事件（宿主 Session 只提供 snapshotEvents()）；为避免生成空交接文档，本次硬切已取消'

/** 源会话确实一条事件都没有时的文案。 */
export const NO_EVENTS_REASON = '源会话还没有任何事件，没有可交接的内容'

/**
 * 取会话事件（只读快照）。
 *
 * 优先级：`snapshotEvents()`（真实契约）→ `events` 数组（旧版宿主 / 测试桩）。
 * 两条都没有（或抛错、返回非数组）→ `undefined`。
 *
 * @param {object|undefined|null} session - 会话对象。
 * @returns {readonly object[]|undefined} 事件数组；读不到返回 undefined。
 */
export function sessionEvents(session) {
  if (session === null || session === undefined || typeof session !== 'object') return undefined
  if (typeof session.snapshotEvents === 'function') {
    try {
      const events = session.snapshotEvents()
      if (Array.isArray(events)) return events
    } catch {
      // 取一次失败就落到下面的兼容分支，不在这里抛——调用方要的是"读到/读不到"这个事实。
    }
  }
  if (Array.isArray(session.events)) return session.events
  return undefined
}
