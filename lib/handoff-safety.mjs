// 安全点判定（纯函数，零依赖，可纯 Node 单测）。
//
// 规格 §13.4：手工硬切"唯一底线是仍必须落在安全点（没有在途工具调用）"。
// 规格 G2 §（3）：**步骤边界本身就是安全点**——`dsh-agent-loop/lib/index.js:929-955`
//   的 `turn()` 是 while(true)，每次迭代先 `preStep`，而 `preStep` 内部派发
//   `agent/pre-step`（:911）。此刻上一步的 `step/end` 已写入、工具结果已提交，
//   没有任何在途工具调用。
//
// 但 `agent/pre-step` 只是"我们主动触发时"的天然安全点；手工按钮可能来自客户端，
// 时机任意。所以仍需要一个**可从会话日志反推**的显式判定。
//
// 日志事实（dsh-agent-loop/lib/index.js:681-706）：
//   tool/call   → data.callId
//   tool/result → data.message.callId
//   turn/end    → 轮次封闭，之后不可能还有在途工具

/** 从尾部往前找，返回"有调用但没结果"的 tool callId 集合。 */
/**
 * 找出仍在途（已发起、未拿到结果）的工具调用 id。
 * 从日志尾部向前扫描，遇到 `turn/end` 即停——轮次已封闭，之前的不可能还在途。
 * @param {Iterable<object>|undefined} events - 会话事件。
 * @returns {Set<string>} 在途 callId 集合。
 */
export function inFlightToolCallIds(events) {
  const inFlight = new Set()
  const settled = new Set()
  if (events === undefined || events === null) return inFlight
  const list = Array.isArray(events) ? events : [...events]
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index]
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'turn/end') break
    if (event.type === 'tool/result') {
      const callId = event.data?.message?.callId
      if (typeof callId === 'string') settled.add(callId)
      continue
    }
    if (event.type === 'tool/call') {
      const callId = event.data?.callId
      if (typeof callId !== 'string') continue
      // 倒着扫：结果已经见过 = 这条调用已结算；没见过 = 它就是在途的。
      if (settled.has(callId)) settled.delete(callId)
      else inFlight.add(callId)
    }
  }
  return inFlight
}

/**
 * 是否落在安全点（可以换会话）。
 *
 * ⚠️ **读不到事件时返回 `false`（保守）**：2026-10-10 事故里，事件读不到会被当成
 * "没有在途工具调用 = 安全"，于是手工硬切可能在工具执行到一半时把会话切走。
 * 不确定就**不许切**——失败比切错好。
 *
 * 注意区分两种情况：
 *   - `[]`（确实为空的新会话）→ true，真的没有在途调用；
 *   - `undefined` / `null`（读不到）→ false，未知即不安全。
 *
 * @param {Iterable<object>|undefined|null} events - 会话事件。
 * @returns {boolean} 安全返回 true；读不到返回 false。
 */
export function isSafePoint(events) {
  if (events === undefined || events === null) return false
  return inFlightToolCallIds(events).size === 0
}
