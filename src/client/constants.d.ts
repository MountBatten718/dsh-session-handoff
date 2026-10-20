// 宿主半区 `lib/constants.mjs` 的最小类型声明（**只声明客户端真正用到的导出**）。
//
// 与 `handoff-config.d.ts` 同理：用 wildcard ambient module 声明匹配模块说明符尾部。
// ⚠️ 声明必须与 `lib/constants.mjs` 的运行期实现一致；本文件不参与打包。

declare module '*/constants.mjs' {
  /** R4（2026-10-17）卡片逐字文案（口径清单 §1）。 */
  export const R4_TEXTS: {
    CARD_TITLE: string
    NOTE_LABEL: string
    NOTE_HINT: string
    NOTE_PLACEHOLDER: string
    NOTE_COUNT_TEMPLATE: string
    NOTE_EMPTY_HINT: string
    SKILL_BUTTON: string
    SKILL_PANEL_HINT: string
    SKILL_SEARCH_PLACEHOLDER: string
    SKILL_GROUP_LOCAL: string
    SKILL_GROUP_MARKET: string
    SKILL_EMPTY: string
    CONFIRM: string
    CANCEL: string
    PREVIEW_SUMMARY: string
    PREVIEW_HINT_TEMPLATE: string
    PREVIEW_NOTE_ITEM: string
  }

  /** R4 工程提示语（非逐字口径：加载/错误态内部文案）。 */
  export const R4_HINTS: {
    SKILL_LOADING: string
    SKILL_LIST_FAILED: string
    NOTE_FULL: string
    LIST_SKILLS_UNSUPPORTED: string
  }

  /** R6（2026-10-20 止血）子代理会话禁止手动接力的逐字文案。 */
  export const SUBAGENT_TEXTS: {
    DISABLED_HINT: string
    REJECT: string
  }

  /** R5 运行期兜底文案（非逐字需求口径）。 */
  export const R5_HINTS: {
    CLIENT_STATS_TIMEOUT_TEMPLATE: string
    HOST_STATS_TIMEOUT_TEMPLATE: string
  }

  /** host 侧 stats 有界等待（毫秒）。 */
  export const HOST_STATS_TIMEOUT_MS: number
  /** 客户端 useStats 兜底超时（毫秒，必须 > HOST_STATS_TIMEOUT_MS）。 */
  export const CLIENT_STATS_TIMEOUT_MS: number

  /** 交接文档的 5 个固定小节标题（单一来源；卡片文档预览用）。 */
  export const HANDOFF_DOC_SECTION_TITLES: readonly string[]

  /** 留言最大码点数（500）。 */
  export const MAX_NOTE_CHARS: number
  /** 技能引用最多条数。 */
  export const MAX_SKILL_REFS: number
  /** 单条技能引用最大码点数。 */
  export const MAX_SKILL_REF_CHARS: number
}
