// 运行期配置：一个**稳定对象**（随时被 patch）+ 持久化通道 + 订阅。
//
// 为什么要有这一层：设置页改一项就要立刻生效（S1 验收："改完即时生效，不用重启 DSH"），
// 而 `index.mjs` 的 `apply()` 拿到的 `config` 是**加载期快照**。控制器如果直接闭包那个快照，
// 设置页改完就得等插件重载——我们不做这种"看起来生效、其实要重启"的假即时。
//
// 持久化走宿主的 `configEditor.edit(entry, change)`（profile patch），
// **不写用户项目目录**（NG-3）。
//
// 本模块不 import 任何 @deepseek-ai/* 包，可纯 Node 单测。

import { KNOWN_CONFIG_KEYS, pickEditable, resolveConfig } from './handoff-config.mjs'

/**
 * 建立一个运行期配置存储。
 *
 * @param {object} input - 输入。
 * @param {object} input.initial - **原始**配置（未补默认值；与 profile patch 同形）。
 * @param {object} [input.deps] - 可注入依赖。
 * @param {Function} [input.deps.persist] - async (nextRaw) => void，把原始配置落盘。
 * @param {Function} [input.deps.validate] - (raw) => resolved，默认 `resolveConfig`。
 * @returns {object} 存储 API。
 */
export function createConfigStore({ initial = {}, deps = {} } = {}) {
  const validate = deps.validate ?? resolveConfig
  /** 原始配置（只含用户显式写过的键 + 我们 patch 过的键）。 */
  let raw = { ...initial }
  /** 生效配置（resolveConfig 的产物，**对象身份稳定**，就地更新）。 */
  const resolved = validate(raw)
  /** 订阅者。 */
  const listeners = new Set()

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener(resolved)
      } catch {
        // 订阅者自己的错不该影响配置更新
      }
    }
  }

  /**
   * 补丁队列（2026-10-12 代码审查 P1-11）。
   *
   * `update` 中途要 `await persist`，并发调用会各自基于**同一份** `raw` 算 `nextRaw`，
   * 后写回的覆盖先写回的，而两次都返回 `ok:true` —— 用户看到"保存成功"，实际有一项没生效。
   * 这里让补丁**排队**执行，保证每一次都基于上一次的结果。
   * @type {Promise<unknown>}
   */
  let patchQueue = Promise.resolve()

  /**
   * 应用一个补丁（**先校验、再落盘、最后生效**——校验不过绝不改内存也不写盘）。
   *
   * @param {unknown} patch - 客户端补丁（会被 `pickEditable` 过滤）。
   * @param {boolean} persist - 是否落盘。
   * @returns {Promise<{ok: boolean, config: object, rejected: string[], error?: string}>} 结果。
   */
  async function applyPatch(patch, persist) {
      let filtered
      try {
        filtered = pickEditable(patch)
      } catch (error) {
        return { ok: false, config: resolved, rejected: [], error: String(error?.message ?? error) }
      }
      const nextRaw = { ...raw, ...filtered.patch }
      // `cleared` 里的键要**真的删掉**（不是改成某个值）：
      // 设置页把「新会话模型」改回「跟随原会话」时，provider/model 必须消失、回到默认空，
      // 否则界面说着"跟随"、新会话却仍固定用旧模型（假跟随）。
      for (const key of filtered.cleared ?? []) delete nextRaw[key]
      let nextResolved
      try {
        nextResolved = validate(nextRaw)
      } catch (error) {
        return { ok: false, config: resolved, rejected: filtered.rejected, error: String(error?.message ?? error) }
      }
      if (persist && typeof deps.persist === 'function') {
        try {
          await deps.persist(nextRaw)
        } catch (error) {
          return { ok: false, config: resolved, rejected: filtered.rejected, error: `persist failed: ${String(error?.message ?? error)}` }
        }
      }
      raw = nextRaw
      Object.assign(resolved, nextResolved)
      notify()
      return { ok: true, config: resolved, rejected: filtered.rejected }
  }

  return {
    /** 生效配置（稳定对象，控制器长期持有也不会读到旧值）。 */
    get config() {
      return resolved
    },
    /** 原始配置的拷贝（落盘 / 排障用）。 */
    raw() {
      return { ...raw }
    },
    /**
     * 应用一个补丁（**先校验、再落盘、最后生效**）。
     *
     * 并发调用会**排队**（见上方 `patchQueue`），不会互相覆盖。
     *
     * @param {unknown} patch - 客户端补丁（会被 `pickEditable` 过滤）。
     * @param {{persist?: boolean}} [options] - 选项。
     * @returns {Promise<{ok: boolean, config: object, rejected: string[], error?: string}>} 结果。
     */
    update(patch, { persist = true } = {}) {
      const run = () => applyPatch(patch, persist)
      const queued = patchQueue.then(run, run)
      // 队列自身永不 reject：一次校验/落盘失败不许毒化后续更新。
      patchQueue = queued.then(() => undefined, () => undefined)
      return queued
    },
    /**
     * 订阅配置变化（返回解绑函数）。
     * @param {(config: object) => void} listener - 订阅者。
     * @returns {() => void} 解绑。
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** 已知键（设置页用它决定能显示什么）。 */
    knownKeys: KNOWN_CONFIG_KEYS,
  }
}

/**
 * 把 profile patch 的写盘动作包成 `persist` 回调（宿主侧用）。
 *
 * ⚠️ 这里**必须**走宿主的 `configEditor`，而不是自己 `fs.writeFile`：
 * profile patch 有自己的层级合并、锁与 Loader 调和逻辑，绕过去会把配置写坏（PK-007 同类）。
 *
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {string} [input.entryName] - 插件在配置树里的条目名（默认按插件名找）。
 * @param {string} [input.pluginName] - 插件包名。
 * @returns {((nextRaw: object) => Promise<void>)|undefined} persist 回调；拿不到 configEditor 时 undefined。
 */
export function createConfigPersist({ ctx, pluginName, entryName }) {
  const editor = ctx?.get?.('configEditor')
  if (editor === undefined || typeof editor.edit !== 'function') return undefined
  return async (nextRaw) => {
    const entries = typeof editor.entries === 'function' ? editor.entries() : []
    const name = entryName ?? pluginName
    const entry = entries.find((candidate) => candidate?.options?.name === name
      || candidate?.options?.id === name
      || candidate?.id === name)
      ?? entries.find((candidate) => String(candidate?.options?.name ?? '').includes(pluginName))
    if (entry === undefined) {
      throw new Error(`no config entry named ${JSON.stringify(name)} in the profile patch`)
    }
    await editor.edit(entry, (current) => ({ ...current, ...nextRaw }))
  }
}
