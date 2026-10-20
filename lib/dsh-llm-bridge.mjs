// 内核能力桥接层：把对 `@deepseek-ai/*` 的依赖从「**顶层静态 import**」改成「**运行时按需加载**」。
//
// ─────────────────────────── 为什么必须这么改（2026-10-10 实机结论）───────────────
//
// 现象：插件装进 DSH 0.2.0-rc.2 后，在插件页开启时报
//       `dsh: warning: 1 entry did not activate handoff (dsh-session-handoff): failed to import`
//
// 复现（从 profile 目录按宿主同样的方式 import）：
//   ❌ dsh-session-handoff → ERR_MODULE_NOT_FOUND Cannot find package '@deepseek-ai/dsh-llm'
//   ❌ dsh-cost-meter       → ERR_MODULE_NOT_FOUND Cannot find package '@deepseek-ai/dsh-credentials'
//   ✅ dsh-market-launcher  → 可加载（**一个内核包都没 import**）
//   ✅ dsh-skill-center     → 可加载（**一个内核包都没 import**）
//   ⇒ 规律：**只要顶层 import 了 `@deepseek-ai/*` 就加载不了。**
//
// 根因：`@deepseek-ai/*` 并不存在于插件可解析的任何位置（含 profile 的 node_modules、
//       以及插件路径的所有祖先目录，均已逐一核对为空）。宿主 `dsh-desktop-host` 里
//       唯一的 `registerHooks` 只处理 Office 引擎（`libreoffice-kit-*`），**没有通用解析器**。
//
// 对策：**顶层零内核 import**，内核能力改成 `await import(...)` 且**允许失败**。
//       拿不到时降级（交接摘要退回结构化模式），插件本身照常加载。
//
// ⚠️ 纪律：本文件**不得**出现任何顶层 `import ... from '@deepseek-ai/...'`。

import { randomUUID } from 'node:crypto'

/** 本插件自己的包名（消息 source 里要写）。 */
const PLUGIN_NAME = 'dsh-session-handoff'

/**
 * 默认加载器：**必须保留字面量 `import('@deepseek-ai/dsh-llm')`**
 *（这一行是"内核能力只在运行时按需加载"这条约定的落点）。
 * @returns {Promise<object>} 内核模块。
 */
const defaultKernelImporter = () => import('@deepseek-ai/dsh-llm')

/**
 * 当前使用的内核模块加载器（可注入，测试用；默认走动态 import）。
 * 做成模块级变量是为了模拟"宿主解析器就绪前失败、就绪后成功"的时序。
 */
let kernelLlmImporter = defaultKernelImporter

/**
 * 内核模块缓存：**只缓存成功结果**。
 *
 * ⚠️ P2-17：绝不再缓存失败。首次调用可能发生在宿主解析器就绪之前，
 * 若把拒绝的 Promise 也留在缓存里，之后**每一次**调用都会拿到同一个失败、
 * 永久降级到结构化模式，再也不会重试。失败时清空缓存，下次重新尝试。
 * 成功结果照旧复用（避免反复 import）。
 */
let kernelLlmPromise

/**
 * 注入内核模块加载器（**仅供测试**：模拟加载失败/成功时序）。
 * 传 `undefined` 恢复默认加载器；无论传什么都会**清空模块缓存**，让注入立刻生效。
 * @param {(() => Promise<object>)|undefined} importer - 加载器。
 * @returns {void}
 */
export function setKernelLlmImporter(importer) {
  kernelLlmImporter = importer ?? defaultKernelImporter
  kernelLlmPromise = undefined
}

/**
 * 深冻结（等价内核 `deepFreeze` 的语义：递归冻结普通对象/数组）。
 * @param {unknown} value - 待冻结的值。
 * @returns {unknown} 同一个值。
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/**
 * 构造一条 user 消息。
 *
 * 与内核 `createUserMessage` 等价（`dsh-llm/lib/index.js`：
 * `createMessage({...input, role:'user'})`，而 `createMessage` = `deepFreeze(structuredClone({...input, id: brandString(randomUUID())}))`，
 * 其中 `brandString` 只是类型标记，**运行时无操作**）。这里就地实现，避免 import 内核包。
 * @param {object} input - 含 `content` 与可选 `source`。
 * @returns {object} 冻结的 user 消息。
 */
export function createUserMessage(input) {
  return deepFreeze({ ...structuredClone(input), role: 'user', id: randomUUID() })
}

/**
 * 把 effort 字符串转成内核的 ReasoningEffortId。
 *
 * 内核实现是 `function ReasoningEffortId(id) { return brandString(id) }`，`brandString` 运行时无操作，
 * 所以这里**直接原样返回**。
 * @param {string} id - effort 名称。
 * @returns {string} 同一个字符串。
 */
export function reasoningEffortId(id) {
  return id
}

/**
 * 按需加载内核 `@deepseek-ai/dsh-llm` 中与流式装配相关的导出。
 *
 * 拿不到时**抛一个说得清楚的错误**（调用方据此降级），而不是在加载期把整个插件带走。
 *
 * ⚠️ 失败**不缓存**（P2-17）：报错前先把缓存清空，下一次调用会**重新尝试加载**——
 *    宿主解析器可能只是还没就绪。原始错误通过 `cause` 保留，便于排障。
 * @returns {Promise<{BlockAssembler: Function}>} 内核导出。
 * @throws {Error} 内核包不可解析时（`error.cause` = 原始错误）。
 */
export async function loadKernelLlm() {
  if (kernelLlmPromise === undefined) {
    kernelLlmPromise = kernelLlmImporter().then(
      (module) => module,
      (error) => {
        // 失败绝不留在缓存里：清空后下次调用会再次尝试（旧实现把失败缓存到进程结束）。
        kernelLlmPromise = undefined
        const wrapped = new Error(
          `handoff: 无法加载宿主内核模块 @deepseek-ai/dsh-llm（${String(error?.message ?? error)}）；`
          + '交接摘要将退回结构化模式。',
        )
        // 保留原始错误（旧实现直接丢掉了它，排障时看不到真正的原因）。
        wrapped.cause = error
        throw wrapped
      },
    )
  }
  return kernelLlmPromise
}

/**
 * 内核能力是否可用（不抛错，供调用方先探测再决定路径）。
 * @returns {Promise<boolean>} 可用为 true。
 */
export async function kernelLlmAvailable() {
  try {
    await loadKernelLlm()
    return true
  } catch {
    return false
  }
}
