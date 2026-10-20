// 宿主半区 `lib/timeout.mjs` 的最小类型声明（客户端有界等待用）。
// 与 handoff-config.d.ts 同理：wildcard ambient module 才能匹配相对路径说明符尾部。
// ⚠️ 声明必须与 `lib/timeout.mjs` 的运行期实现一致；本文件不参与打包。

declare module '*/timeout.mjs' {
  export function withAbortTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: { signal?: AbortSignal; timeoutMs: number; label: string },
  ): Promise<T>

  export function resolveWithin<T>(
    promise: Promise<T> | T,
    options: { timeoutMs: number; label: string },
  ): Promise<{ status: 'ok'; value: T } | { status: 'timeout'; label: string }>
}
