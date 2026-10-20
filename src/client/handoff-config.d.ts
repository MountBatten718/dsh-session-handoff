// 宿主半区 `lib/handoff-config.mjs` 的最小类型声明（**只声明客户端真正用到的导出**）。
//
// 与 `handoff-health.d.ts` 同理：用 **wildcard ambient module 声明**（`*/handoff-config.mjs`）
// 匹配模块说明符尾部 —— TS 不接受相对路径的 ambient module 声明，wildcard 才行。
// 这样设置页能用宿主**同一份**默认值与范围常量，而不必在客户端再抄一份（抄了就会漂移）。
//
// ⚠️ 声明必须与 `lib/handoff-config.mjs` 的运行期实现一致；本文件只做类型约束，
//    不会被打包（构建脚本只看 `import` 语句，不读 `.d.ts`）。

declare module '*/handoff-config.mjs' {
  /** 全部配置默认值（这里只声明客户端用到的几个）。 */
  export const HANDOFF_DEFAULTS: {
    askRearmPercent: number
    /** R1：新会话先提交计划（默认 true）。 */
    childPlanFirst: boolean
    /** R2：换会话前等子代理交卷的最长时间（分钟，默认 10）。 */
    subagentDrainTimeoutMin: number
  }

  /** 各项取值范围（这里只声明客户端用到的几个）。 */
  export const HANDOFF_LIMITS: {
    MIN_ASK_REARM_PERCENT: number
    MAX_ASK_REARM_PERCENT: number
    /** R2 分钟数下界（1）。 */
    MIN_SUBAGENT_DRAIN_TIMEOUT_MIN: number
    /** R2 分钟数上界（60）。 */
    MAX_SUBAGENT_DRAIN_TIMEOUT_MIN: number
  }
}
