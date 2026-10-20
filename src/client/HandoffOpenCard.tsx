// 自动跳转卡片：/handoff 完成节点渲染时，自动打开新会话并隐藏自身。
//
// 副作用只在渲染组件里发生（conversation node 状态机保持纯、可回放）。
// localStorage 标记保证每个子会话只自动打开一次（历史回放不反复跳转）。

import { useEffect } from 'react'

/** localStorage 打开标记前缀（每个子会话 id 一条）。 */
const OPENED_PREFIX = 'dsh.handoff.opened.v1'

interface HandoffOpenCardProps {
  node?: { data?: { kind?: string; childId?: string } }
  waitAndOpen?: (sessionId: string) => Promise<void>
}

/**
 * 自动跳转卡片：渲染时不占空间，等新会话在客户端列表就绪后自动打开。
 * @param props - 节点数据 + 注入的等待-打开回调。
 * @returns 空（不渲染任何内容）。
 */
export function HandoffOpenCard({ node, waitAndOpen }: HandoffOpenCardProps): null {
  const childId = node?.data?.childId
  useEffect(() => {
    if (typeof childId !== 'string' || childId.length === 0) return
    if (typeof waitAndOpen !== 'function') {
      console.info('[dsh-session-handoff] no waitAndOpen injected; auto-open skipped')
      return
    }
    const key = `${OPENED_PREFIX}:${childId}`
    try {
      if (window.localStorage.getItem(key) !== null) return
      // Reserve before awaiting so React Strict Mode cannot open twice.
      window.localStorage.setItem(key, 'opening')
    } catch {
      // localStorage 不可用（隐私模式等）：仍尝试打开一次。
    }
    console.info(`[dsh-session-handoff] auto-opening child session ${childId}`)
    void waitAndOpen(childId)
      .then(() => {
        try {
          window.localStorage.setItem(key, '1')
        } catch {
          // localStorage 不可用不影响已经完成的跳转。
        }
      })
      .catch((error: unknown) => {
        // A later render/history replay may retry after a transient failure.
        try {
          window.localStorage.removeItem(key)
        } catch {
          // Ignore unavailable storage; there is no stale marker to clean up.
        }
        console.warn(`[dsh-session-handoff] auto-open failed: ${String(error)}`)
      })
  }, [childId, waitAndOpen])
  return null
}
