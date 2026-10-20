// 宿主半区 `lib/handoff-health.mjs` 的最小类型声明（**只声明客户端真正用到的导出**）。
//
// 为什么不放进 lib/：`lib/**` 归宿主半区所有，客户端改动不许越界（任务说明白名单）。
// 这里用 **wildcard ambient module 声明**（`*/handoff-health.mjs`）——
// TS 不接受「相对路径的 ambient module 声明」（`declare module '../../lib/…'` 实测不生效，
// 仍报 TS7016），而 tsconfig 的 `paths` 又不在本次改动白名单里；
// wildcard 形式按模块说明符尾部匹配，正好覆盖 `src/client/view.ts` 里那条
// `import { … } from '../../lib/handoff-health.mjs'`，且不影响其它模块。
//
// ⚠️ 声明必须与 `lib/handoff-health.mjs` 的运行期实现一致；这份文件只做类型约束，
//    不会被打包（`scripts/build-client.mjs` 只看 `import` 语句，不读 `.d.ts`）。

declare module '*/handoff-health.mjs' {
  /** 三色档位。 */
  export type HealthLevel = 'green' | 'warning' | 'danger'

  /** 上下文指标（`computeHealth` 产出）。 */
  export interface HealthContext {
    usedTokens: number | undefined
    windowTokens: number | undefined
    limitTokens: number | undefined
    ratio: number | undefined
    limitRatio: number | undefined
    showMarker: boolean
  }

  /** 会话体积指标（`computeHealth` 产出）。 */
  export interface HealthVolume {
    bytes: number | undefined
    limitBytes: number | undefined
    ratio: number | undefined
    showMarker: boolean
  }

  /** `computeHealth` 的结论。 */
  export interface Health {
    mode: 'replace' | 'hybrid' | 'native'
    level: HealthLevel
    /** 是否至少有一个指标真的量到了（false 时 level 是"不知道"，不是"接近阈值"）。 */
    measured: boolean
    context: HealthContext
    volume: HealthVolume
    contextCounts: boolean
  }

  /** `computeHealth` 的输入（wire 上的可空字段按 `null` 建模）。 */
  export interface HealthInput {
    mode?: 'replace' | 'hybrid' | 'native'
    usedTokens?: number | null
    windowTokens?: number | null
    nativeThresholdTokens?: number | null
    /** 读不到原生阈值时的兜底比例；不传则用 `HANDOFF_DEFAULTS.nativeCompactionRatio`（唯一来源）。 */
    nativeCompactionRatio?: number
    replaceSafetyFactor?: number
    sessionBytes?: number | null
    sessionVolumeLimitBytes?: number | null
  }

  /** `estimateTurnsLeft` 的结论。 */
  export interface TurnsLeft {
    n?: number
    metric: 'context' | 'volume' | null
    remainingTokens?: number
    remainingBytes?: number
    reason: string
    perTurn?: number
    hoursPerTurn?: number
  }

  /** `conclusionOf` 的结论。 */
  export interface Conclusion {
    icon: string
    text: string
    level: string
    pace: string
  }

  /** 明细表一行。 */
  export interface DetailRow {
    label: string
    current: string
    limit: string
    distance: string
  }

  export const HEALTH_LEVELS: readonly HealthLevel[]
  export const WARN_FACTOR: number

  export function worstLevel(...levels: Array<HealthLevel | undefined>): HealthLevel
  export function levelFor(input: { value?: number | null; limit?: number | null }): HealthLevel | undefined
  export function computeHealth(input: HealthInput): Health

  export function estimateTurnsLeft(input: {
    health: Health
    perTurnTokens?: number | null
    perTurnBytes?: number | null
    perTurnHours?: number | null
  }): TurnsLeft

  export function conclusionOf(input: { health: Health; turnsLeft?: TurnsLeft }): Conclusion
  export function formatPercent(ratio: number | undefined, digits?: number): string
  export function formatBytes(bytes: number | undefined): string
  export function formatCount(value: number | undefined): string

  export function detailRows(input: {
    health: Health
    compactionsSinceHandoff?: number | null
    compactionCountTrigger?: number | null
    messageCount?: number | null
    eventCount?: number | null
  }): { rows: DetailRow[] }
}
