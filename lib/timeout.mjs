/** Abort-aware timeout wrapper for host-side asynchronous work. */

/**
 * Run an operation with a child timeout while preserving caller cancellation.
 * The operation must honor the supplied signal.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} operation - Work to run.
 * @param {{signal?: AbortSignal, timeoutMs: number, label: string}} options - Cancellation options.
 * @returns {Promise<T>} The operation result.
 */
export async function withAbortTimeout(operation, { signal, timeoutMs, label }) {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => {
    timeoutController.abort(new Error(`${label} timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const combined = signal === undefined
    ? timeoutController.signal
    : AbortSignal.any([signal, timeoutController.signal])

  try {
    combined.throwIfAborted()
    return await operation(combined)
  } catch (error) {
    if (timeoutController.signal.aborted && signal?.aborted !== true) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 给一个 Promise 套"有界等待"：到点无论它是否 settle 都返回 `{status:'timeout'}`。
 *
 * 与 `withAbortTimeout` 的区别（2026-10-20 真机教训）：`withAbortTimeout` 内部仍然
 * `await operation(signal)` —— 对**忽略 signal、永不 settle** 的调用（例如某个宿主服务
 * 对子会话不返回）不构成上限。这里用真 `Promise.race` 赛跑，定时器**不 unref**
 * （unref 会让有界等待被静默截断），正常完成时 clearTimeout。
 *
 * @template T
 * @param {Promise<T>|T} promise - 被等待的操作。
 * @param {{timeoutMs: number, label: string}} options - 超时与标签。
 * @returns {Promise<{status: 'ok', value: T} | {status: 'timeout', label: string}>} 结果。
 */
export async function resolveWithin(promise, { timeoutMs, label }) {
  let timer = null
  try {
    return await Promise.race([
      Promise.resolve(promise).then((value) => ({ status: 'ok', value })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timeout', label }), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
