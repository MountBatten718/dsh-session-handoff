// 宿主面 RPC 服务：把控制器/配置存储/文档/确认卡片包成 `remote.sessionHandoff.*`。
//
// 这个对象的形状由**网关的绑定校验**决定（`dsh-api-gateway/lib/index.js:1441-1453`）：
//   - 必须带一个不可枚举的 `typertRemote = { service: <自己>, serviceKey: 'sessionHandoff', namespace: 'sessionHandoff' }`；
//   - `serviceKey` / `namespace` 必须与 `lib/typert.host.mjs` 清单里每条 invocation 写的一致。
//
// 方法与清单里的 `parameters` **按位置对应**（网关 `descriptor.parameters.map(...)` 后
// `Reflect.apply(method, receiver, args)`）。可选参数在 wire 上缺席时是 `undefined`，
// 所以这里给每个可选参数都留了默认值——**绝不因为少传一个可选参数就炸**。
//
// 返回值的每一层都必须是 JSON 安全值（数字/字符串/布尔/null/数组/纯对象）；
// **不允许出现显式 undefined 属性**（网关会整个判 result-invalid）。

import { open, readFile } from 'node:fs/promises'
import { PLUGIN_NAME, HOST_STATS_TIMEOUT_MS, R5_HINTS, SUBAGENT_TEXTS } from './constants.mjs'
import { listHandoffDocs, resolveDocDir } from './handoff-docs.mjs'
import { askForHandoff } from './handoff-confirm.mjs'
import { normalizeNote, normalizeSkillRefs } from './handoff-note.mjs'
import { resolveWithin } from './timeout.mjs'
import { isSubagentSession } from './handoff-policy.mjs'
// 决策日志的保留上限**只有一份权威**（controller 的环形日志就按它裁剪）：
// 这里读侧再钳一次，避免客户端送 `-1` / `1e9` 让 `slice` 从尾部取或白读一遍。
// （不产生循环依赖：controller 不 import 本文件。）
import { MAX_DECISION_RECORDS } from './handoff-controller.mjs'
import { computeHealth } from './handoff-health.mjs'

/** 决策日志的默认条数（与 typert 签名/controller 的默认值保持 50 一致）。 */
export const DEFAULT_DECISION_LIMIT = 50

/**
 * 把客户端送来的 `decisionLimit` 钳到 `[1, MAX_DECISION_RECORDS]`（P2-10）。
 *
 * 以前是 `Number.isFinite(x) ? x : 50`：负数会让 `slice(0, -1)` **从尾部取**，
 * 非整数被 `slice` 静默截断，巨大值白扫一遍。非有限值（NaN/null/undefined/字符串）回落 50。
 *
 * @param {unknown} value - 客户端送来的条数。
 * @returns {number} 钳好的整数条数。
 */
export function clampDecisionLimit(value) {
  if (!Number.isFinite(value)) return DEFAULT_DECISION_LIMIT
  const integer = Math.trunc(value)
  return Math.min(Math.max(integer, 1), MAX_DECISION_RECORDS)
}

/**
 * 去掉尾部缺席的可选参数（`(a, undefined, undefined)` → `(a)`）。
 *
 * 为什么必须做：网关把 wire 字段**按位置**映射成数组后直接 `Reflect.apply`。
 * 只要清单里声明了某个可选参数，而客户端没送该字段，中间就会出现 `undefined` 占位；
 * 若某个实现用了 `arguments.length` 或 `...rest`，就会把 `undefined` 当成真参数。
 * 我们的实现全部用默认值，所以严格来说不是必须，但这一层是廉价的防呆。
 *
 * @param {unknown[]} args - 位置参数。
 * @returns {unknown[]} 去掉尾部 undefined 的参数。
 */
export function trimArgs(args) {
  const list = [...args]
  while (list.length > 0 && list[list.length - 1] === undefined) list.pop()
  return list
}

/**
 * 把任意值收敛成数组（宿主目录服务的字段缺失时不要炸，宁可给空列表）。
 * @param {unknown} value - 任意值。
 * @returns {Array<unknown>} 数组。
 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * 把宿主的模型目录拍成设置页要的 wire 形状。
 *
 * 为什么必须**拍平** `reasoning.efforts`：宿主 `modelCatalog()` 给的是
 * `models[].reasoning = { efforts: [{id,name,description?}], defaultEffort? }`，
 * 而设置页只需要"这个模型能选哪些思考强度"；把 description 这类可选字段带出去
 * 只会让两侧的严格 codec 互相追着改（P2-4/P2-5 的教训：形状越松越容易悄悄漂移）。
 *
 * @param {unknown} catalog - 宿主 `sessionController.modelCatalog()` 的返回。
 * @returns {{default: object, groups: Array<object>, failures: Array<object>}} wire 形状。
 */
export function normalizeModelCatalog(catalog) {
  const source = catalog !== null && typeof catalog === 'object' ? catalog : {}
  const defaultRoute = source.default !== null && typeof source.default === 'object' ? source.default : {}
  const defaultEffort = typeof defaultRoute.reasoningEffort === 'string' && defaultRoute.reasoningEffort.length > 0
    ? defaultRoute.reasoningEffort
    : undefined
  return {
    default: {
      provider: String(defaultRoute.provider ?? ''),
      model: String(defaultRoute.model ?? ''),
      // 可选字段**缺席就不出现**：显式 undefined 会让网关整个判 result-invalid。
      ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }),
    },
    groups: asArray(source.groups).map((group) => ({
      id: String(group?.id ?? ''),
      name: String(group?.name ?? ''),
      models: asArray(group?.models).map((model) => {
        const reasoning = model?.reasoning
        const effort = typeof reasoning?.defaultEffort === 'string' && reasoning.defaultEffort.length > 0
          ? reasoning.defaultEffort
          : undefined
        return {
          id: String(model?.id ?? ''),
          name: String(model?.name ?? ''),
          // 没有 reasoning 的模型给空数组（设置页据此隐藏思考强度下拉框）。
          efforts: asArray(reasoning?.efforts).map((entry) => ({ id: String(entry?.id ?? ''), name: String(entry?.name ?? '') })),
          ...(effort === undefined ? {} : { defaultEffort: effort }),
        }
      }),
    })),
    failures: asArray(source.failures).map((failure) => ({
      id: String(failure?.id ?? ''),
      name: String(failure?.name ?? ''),
      message: String(failure?.message ?? ''),
    })),
  }
}

/**
 * 把宿主 `permissionPresets.catalog()` 的返回拍成 `{id, name}` 列表。
 * @param {unknown} catalog - catalog() 的返回（数组，或带 presets 数组的对象）。
 * @returns {Array<{id: string, name: string}>} 档位列表。
 */
export function normalizePermissionPresets(catalog) {
  // ⚠️ 宿主 `permissionPresets.catalog()` 返回的是 `{ options, defaultOptions, defaultPreset }`
  //    —— 可用档位在 **options** 里。早期实现读的是不存在的 `presets`，于是设置页只显示
  //    「跟随原会话」一个选项（2026-10-12 真机截图抓到）。`presets` 保留在回退位置，兼容旧形状。
  const list = Array.isArray(catalog) ? catalog : asArray(catalog?.options ?? catalog?.presets)
  return list.map((entry) => ({
    // id 缺失时退回 name：设置页的 value 必须有东西可用（id 才是 set() 的入参，缺了就是宿主的锅）。
    id: String(entry?.id ?? entry?.name ?? ''),
    name: String(entry?.name ?? entry?.id ?? ''),
  }))
}

/**
 * R4（D1）：按**技能目录名**判「本地安装 / 市场安装」。
 *
 * 规则逐字来自已上线的技能中心（`dsh-skill-center/client/parts/40-ui-kit.js:3,7,58-61`）：
 *   · 目录名形如 `<发布者>--<技能名>` ⇒ **市场安装**；
 *   · `local--<name>`（历史本地导入）与其他 ⇒ **本地安装**；
 *   · 没有 path ⇒ 本地安装（兜底，调用方记 warn）。
 *
 * @param {unknown} path - 技能 `SKILL.md` 的路径（内核 `skills/list` 的 `path`，可缺省）。
 * @returns {'local'|'market'} 分组枚举（逐字文案由客户端映射）。
 */
export function skillGroupOfPath(path) {
  if (typeof path !== 'string' || path.length === 0) return 'local'
  const parts = path.split('/').filter((part) => part.length > 0)
  // path 一般指向 `.../skills/<目录名>/SKILL.md`；目录名 = 文件名的上一段。
  const base = parts.length >= 2 ? parts[parts.length - 2] : ''
  if (/^[^/]+--[^/]+$/u.test(base) && !base.startsWith('local--')) return 'market'
  return 'local'
}

/**
 * 从 `SKILL.md` 的 **frontmatter 头部**取 `display_name`（D3：内核出参没有这个字段）。
 *
 * 只读文件头 4KB（不整份读入、更不解析正文）；任何异常（无文件 / 无权限 / 无字段）
 * 都返回 `undefined`，由调用方回落 `name`。
 *
 * @param {string} path - SKILL.md 路径。
 * @returns {Promise<string|undefined>} 显示名。
 */
export async function readSkillDisplayName(path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf8')
    // frontmatter：文档以 `---` 开头，字段在第一段 `---` 之间。
    const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(head)
    if (match === null) return undefined
    const line = /^[ \t]*display_name[ \t]*:[ \t]*(.+?)[ \t]*$/mu.exec(match[1])
    if (line === null) return undefined
    const value = line[1].replace(/^["']|["']$/gu, '').trim()
    return value.length === 0 ? undefined : value
  } catch {
    return undefined
  } finally {
    try {
      await handle?.close()
    } catch {
      // 关不掉不影响结果（只读句柄）。
    }
  }
}

/**
 * 截成"一句话说明"（M2 §11.3：行内说明要截断）。
 * @param {unknown} value - 原始说明。
 * @param {number} [max] - 最大码点数。
 * @returns {string} 截断后的说明。
 */
export function truncateOneLine(value, max = 120) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const points = Array.from(text)
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`
}

/**
 * 造宿主面 RPC 服务。
 *
 * @param {object} input - 输入。
 * @param {object} input.ctx - Cordis 上下文。
 * @param {object} input.controller - 控制器（`lib/handoff-controller.mjs` 的产物）。
 * @param {object} input.configStore - 运行期配置存储（`lib/handoff-store.mjs` 的产物）。
 * @param {object} input.reporter - 健康度报表器（`lib/handoff-report.mjs` 的产物）。
 * @param {object} [input.deps] - 可注入依赖。
 * @param {Function} [input.deps.listDocs] - 列交接文档（默认 `listHandoffDocs`）。
 * @param {Function} [input.deps.readDoc] - 读文档内容。
 * @param {Function} [input.deps.askHandoff] - 弹确认卡片（默认 `askForHandoff`）。
 * @param {Function} [input.deps.now] - 时间源。
 * @returns {object} 服务对象（已带 typertRemote 绑定）。
 */
export function createRpcService({ ctx, controller, configStore, reporter, deps = {} }) {
  const now = deps.now ?? (() => Date.now())
  const listDocs = deps.listDocs ?? listHandoffDocs
  const readDoc = deps.readDoc ?? ((path) => readFile(path, 'utf8'))
  const askHandoff = deps.askHandoff ?? askForHandoff
  /** host 侧 stats 有界等待（测试可注入更短的值；默认 3 秒）。 */
  const statsTimeoutMs = typeof deps.statsTimeoutMs === 'number' && deps.statsTimeoutMs > 0
    ? deps.statsTimeoutMs
    : HOST_STATS_TIMEOUT_MS

  /**
   * RPC 面自己的错误收集（P2-11）。
   *
   * 为什么放在这里：`reporter.errors` 是**只读副本**，而「以后都自动接力」的落盘失败
   * 本就不是"量上下文"失败。以前它被 `.catch(() => undefined)` 静默吞掉 ——
   * 用户以为设置生效了，实际没落盘也没有任何痕迹。现在记进这里，随 `stats().errors`
   * 走**既有**的排障通道透出（形状仍是 `{ sessionId, message }`，不牵动任何 wire 契约）。
   * @type {Array<{sessionId: string, message: string}>}
   */
  const rpcErrors = []

  /**
   * 记一条 RPC 面错误：进错误收集 + 记一条 warn（两条通道任一可用即可见）。
   * @param {string} sessionId - 相关会话 id。
   * @param {unknown} message - 原因（人话）。
   * @returns {void}
   */
  function recordError(sessionId, message) {
    const text = String(message)
    if (rpcErrors.length > 50) rpcErrors.shift()
    rpcErrors.push({ sessionId: typeof sessionId === 'string' ? sessionId : '', message: text })
    try {
      const factory = ctx?.logger
      const logger = typeof factory === 'function' ? factory(PLUGIN_NAME) : factory
      logger?.warn?.(`handoff: ${text}`)
    } catch {
      // 日志通道自己炸了不该影响主流程（错误已经进了 rpcErrors）。
    }
  }

  /** 当前配置的 wire 形状（**只放 JSON 安全的标量**）。 */
  function configWire() {
    const config = configStore.config
    return {
      enabled: config.enabled !== false,
      autoMode: String(config.autoMode),
      autoPromptLevel: String(config.autoPromptLevel),
      summaryMode: String(config.summaryMode),
      sessionVolumeBytes: Number(config.sessionVolumeBytes),
      compactionCountTrigger: config.compactionCountTrigger === null || config.compactionCountTrigger === undefined
        ? null
        : Number(config.compactionCountTrigger),
      confirmTimeoutMs: Number(config.confirmTimeoutMs),
      // 「先不接力」后再涨多少个百分点才重问（设置页要显示真实当前值，必须带出来）。
      askRearmPercent: Number(config.askRearmPercent),
      handoffDocPersist: config.handoffDocPersist === true,
      decisionLogEnabled: config.decisionLogEnabled !== false,
      // —— 新会话的模型 / 推理强度 / 权限档（设置页要把当前值显示出来）——
      // 空串 = 跟随原会话。**绝不出现 undefined**（网关的 JSON 安全校验会整条拒掉）。
      provider: typeof config.provider === 'string' ? config.provider : '',
      model: typeof config.model === 'string' ? config.model : '',
      childReasoningEffort: typeof config.childReasoningEffort === 'string' ? config.childReasoningEffort : '',
      childPermissionPreset: typeof config.childPermissionPreset === 'string' ? config.childPermissionPreset : '',
      // —— 2026-10-14 v1.2 新增（设置页要显示当前值，**绝不能是 undefined**）——
      childPlanFirst: config.childPlanFirst !== false,
      subagentDrainTimeoutMin: Number(config.subagentDrainTimeoutMin),
    }
  }

  /** 交接文档目录（配置优先，否则 DSH 数据目录）。 */
  function docDirInfo() {
    return resolveDocDir({ configuredDir: configStore.config.handoffDocDir })
  }

  /**
   * 插件 ctx 里能不能看到 `llm` 服务、它登记了几个供应商（**只用于空目录时的诊断**）。
   * @returns {number|string} 数量；没有该服务 / 返回非数组 / 调用抛错都给一句人话。
   */
  function countProviders() {
    const llm = safeGet(ctx, 'llm')
    if (llm === undefined || typeof llm.listProviders !== 'function') return '无 llm 服务'
    try {
      const providers = llm.listProviders()
      return Array.isArray(providers) ? providers.length : 'llm 返回非数组'
    } catch {
      return 'llm 调用出错'
    }
  }

  /**
   * 插件 ctx 里能不能看到 `llm` 服务、它登记了几个供应商（**只用于空目录时的诊断**）。
   * @returns {number|string} 数量；没有该服务 / 返回非数组 / 调用抛错都给一句人话。
   */
  function countProviders() {
    const llm = safeGet(ctx, 'llm')
    if (llm === undefined || typeof llm.listProviders !== 'function') return '无 llm 服务'
    try {
      const providers = llm.listProviders()
      return Array.isArray(providers) ? providers.length : 'llm 返回非数组'
    } catch {
      return 'llm 调用出错'
    }
  }

  /**
   * 读「用户在 DSH 设置里手填的模型目录」。
   *
   * **为什么必须自己读**：适配器的 `listModels()` 只走"远端发现"
   *（DeepSeek 适配器就是 `return this.dependencies.discoverModels?.(provider) ?? []`），
   * 用户手填的自定义目录**不在其中** ⇒ `modelCatalog()` 会返回空 groups。
   * 2026-10-13 真机就是这样：DSH 里有 4 个供应商、6 个模型，这里一个都列不出来。
   *
   * 数据源与 DSH 自己的「设置 → 模型」界面**完全同源**：`settings.describe()` 里
   * 按 `provider.settingsPath` 取到的 `models` 字段。
   * @returns {Map<string, Array<object>>} 供应商 id → 模型条目数组。
   */
  function customModelsByProvider() {
    const settings = safeGet(ctx, 'settings')
    const llm = safeGet(ctx, 'llm')
    if (typeof settings?.describe !== 'function' || typeof llm?.listConfigurableProviders !== 'function') {
      return new Map()
    }
    let namespaces
    let providers
    try {
      namespaces = settings.describe({ redactSecrets: true })
      providers = llm.listConfigurableProviders()
    } catch {
      return new Map()
    }
    const found = new Map()
    for (const provider of Array.isArray(providers) ? providers : []) {
      try {
        let profile = namespaces.find((namespace) => namespace?.ns === provider?.settingsNs)?.value
        for (const key of provider?.settingsPath ?? []) {
          profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
        }
        const models = typeof profile === 'object' && profile !== null ? profile.models : undefined
        if (Array.isArray(models) && models.length > 0) found.set(String(provider.provider), models)
      } catch {
        // 单个供应商读不出来不影响其它供应商（列表少几项，好过整页空）。
      }
    }
    return found
  }

  /**
   * 把自定义目录里、`modelCatalog()` 没列出的模型补进目录（缺的档位再问一次适配器）。
   * @param {object} value - `normalizeModelCatalog` 的产物（就地改）。
   * @param {Map<string, Array<object>>} custom - `customModelsByProvider()` 的产物。
   */
  async function mergeCustomModels(value, custom) {
    const llm = safeGet(ctx, 'llm')
    for (const [providerId, entries] of custom) {
      let group = value.groups.find((item) => item.id === providerId)
      if (group === undefined) {
        group = { id: providerId, name: providerId, models: [] }
        value.groups.push(group)
      }
      const known = new Set(group.models.map((model) => model.id))
      for (const entry of entries) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
        if (id.length === 0 || known.has(id)) continue
        const name = typeof entry?.name === 'string' && entry.name.length > 0 ? entry.name : id
        const model = { id, name, efforts: [] }
        // 档位（推理强度）目录里没有，问一次适配器；拿不到就是空数组（诚实，不编）。
        try {
          const info = await llm.resolveModelInfo(providerId, id)
          const efforts = info?.reasoning?.efforts
          if (Array.isArray(efforts)) {
            model.efforts = efforts
              .map((effort) => ({ id: String(effort?.id ?? ''), name: String(effort?.name ?? effort?.id ?? '') }))
              .filter((effort) => effort.id.length > 0)
          }
        } catch {
          // 问不到档位不影响模型本身可用。
        }
        group.models.push(model)
        known.add(id)
      }
    }
  }

  /**
   * 用 `llm` + `settings` 自己组一份模型目录（`sessionController` 拿不到时的退路）。
   *
   * 2026-10-13 真机证据：启动自检日志显示 `hasSessionController: false`，而 `llm` / `settings`
   * 都在（`providerCount: 4`）。既然拿不到宿主那份目录，就用拿得到的两个自己组 ——
   * 每个供应商先要一遍适配器的 `listModels()`（可能为空），用户手填的目录由
   * `mergeCustomModels()` 在后面补上。
   * @returns {Promise<object>} 与 `normalizeModelCatalog` 同形状的目录。
   */
  async function buildCatalogFromLlm() {
    const llm = safeGet(ctx, 'llm')
    let providers = []
    if (typeof llm?.listProviders === 'function') {
      try {
        providers = llm.listProviders()
      } catch {
        providers = []
      }
    }
    const groups = []
    const failures = []
    for (const provider of Array.isArray(providers) ? providers : []) {
      const id = String(provider?.id ?? '')
      if (id.length === 0) continue
      const name = String(provider?.name ?? id)
      let models = []
      try {
        const listed = typeof llm.listModels === 'function' ? await llm.listModels(id) : []
        models = (Array.isArray(listed) ? listed : [])
          .map((entry) => ({ id: String(entry?.id ?? ''), name: String(entry?.name ?? entry?.id ?? ''), efforts: [] }))
          .filter((entry) => entry.id.length > 0)
      } catch (error) {
        // 某个供应商列不出来 → 记账，别的照常（界面上会写明是谁没读到）。
        failures.push({ id, name, message: String(error?.message ?? error) })
      }
      groups.push({ id, name, models })
    }
    // default 路由拿不到（`agentDefaultModel` 不在插件可见范围）→ 留空，界面会只显示「跟随原会话」。
    return { default: { provider: '', model: '' }, groups, failures }
  }

  const service = {
    /**
     * 读侧：配置 + 一批会话的健康度行 + 交接文档目录 + 决策日志。
     * @param {string[]} [sessionIds] - 显式会话 id（客户端总是送自己在的那个）。
     * @param {number} [decisionLimit] - 决策日志条数。
     * @param {string} [decisionFilter] - 决策日志筛选（all / handoff / none）。
     * @returns {Promise<object>} 结果。
     */
    async stats(sessionIds, decisionLimit = DEFAULT_DECISION_LIMIT, decisionFilter = 'all') {
      const ids = Array.isArray(sessionIds) ? sessionIds.filter((id) => typeof id === 'string' && id.length > 0) : []
      // 2026-10-20 真机（子会话健康度卡在「正在读取」）：`rowsFor` 里会对每个会话
      // measureContext → 可能 `await llm.resolveModelInfo(...)`；宿主的某个服务对**子会话**
      // 永不 settle 时，stats 就永久挂起（客户端 RPC 既不返回也不抛 ⇒ 界面永远转圈）。
      // 这里给整批健康度行加**有界等待**：到点就降级返回空 rows + 一条可解释 error，绝不挂起。
      const listedResult = await resolveWithin(reporter.rowsFor(ids), { timeoutMs: statsTimeoutMs, label: 'stats rowsFor' })
      const statsTimedOut = listedResult.status === 'timeout'
      const listed = listedResult.status === 'ok' ? listedResult.value : { rows: [], errors: [] }
      const timeoutErrors = statsTimedOut
        ? [{
            sessionId: ids[0] ?? '',
            message: R5_HINTS.HOST_STATS_TIMEOUT_TEMPLATE.replace('{sec}', String(Math.max(1, Math.round(statsTimeoutMs / 1000)))),
          }]
        : []
      const dir = docDirInfo()
      const limit = clampDecisionLimit(decisionLimit)
      return {
        config: configWire(),
        rows: listed.rows,
        docDir: dir.dir,
        docDirSource: dir.source,
        decisions: configStore.config.decisionLogEnabled === false
          ? []
          : controller.decisions.list({ limit, filter: typeof decisionFilter === 'string' ? decisionFilter : 'all' }),
        // 报表器自己的测量错误 + RPC 面自己的错误（P2-11），同一条排障通道。
        errors: [...(Array.isArray(listed.errors) ? listed.errors : []), ...rpcErrors, ...timeoutErrors],
        // R2（ARB-13）：子代理收尾的运行期状态；没有在进行中的收尾时是**显式 null**。
        drain: typeof controller.drain === 'function' ? (controller.drain() ?? null) : null,
      }
    },

    /**
     * 写侧：校验 + 落盘 + 生效（**先校验，绝不半途改内存**）。
     * @param {object} patch - 补丁。
     * @returns {Promise<object>} 结果。
     */
    async updateConfig(patch) {
      const result = await configStore.update(patch ?? {})
      return {
        ok: result.ok === true,
        error: result.ok === true ? null : String(result.error ?? 'unknown'),
        rejected: Array.isArray(result.rejected) ? result.rejected : [],
        config: configWire(),
      }
    },

    /**
     * 手工换会话（优先级最高）。
     * @param {string} sessionId - 会话 id。
     * @param {string} [source] - 来源标记。
     * @returns {Promise<object>} 结果。
     */
    async handoffNow(sessionId, source = 'client', options) {
      // R6（2026-10-20 止血，维护者决定）：**子代理会话禁止手动接力**。
      // 判据只用内核强制字段 `header.origin` + 自描述投影 `subagent`（**绝不用标题**）；
      // 这是手工路径漏掉的那道守卫，自动路径既有守卫（isAutoEligibleSession）一行不动。
      // 防绕过：必须在 controller.handoffNow / performHandoff 之前抛，保证不建会话、不改状态。
      const currentSession = safeGet(ctx, 'sessions')?.get?.(sessionId)
      if (currentSession !== undefined && currentSession !== null) {
        let subagentProjection = null
        try {
          subagentProjection = safeGet(ctx, 'sessionProjections')?.stateOf?.(currentSession, 'subagent') ?? null
        } catch {
          subagentProjection = null
        }
        if (isSubagentSession({ header: currentSession.header, projection: subagentProjection })) {
          throw new Error(SUBAGENT_TEXTS.REJECT)
        }
      }

      // R4（清单 §1/§2/§3）：第三参**可选**；归一化在 host 侧做（不信客户端），
      // 留言零改写、技能引用只存不执行。出参形状不变（normalizeHandoffResult）。
      const normalizedNote = normalizeNote(options?.note)
      if (normalizedNote.truncated) {
        recordError(sessionId, `交接人留言超过 500 字，已按前 500 个字符截断（原文的其余部分没有进交接文档）`)
      }
      const normalizedRefs = normalizeSkillRefs(options?.skillRefs)
      if (normalizedRefs.dropped > 0) {
        recordError(sessionId, `技能引用有 ${normalizedRefs.dropped} 项被丢弃（重复 / 超长 / 超出条数上限）`)
      }
      return normalizeHandoffResult(await controller.handoffNow({
        sessionId,
        source,
        ...(normalizedNote.note === undefined ? {} : { note: normalizedNote.note }),
        ...(normalizedRefs.skillRefs === undefined ? {} : { skillRefs: normalizedRefs.skillRefs }),
      }), sessionId)
    },

    /**
     * 取消排队中的手工换会话。
     * @param {string} sessionId - 会话 id。
     * @returns {Promise<object>} 结果。
     */
    async cancelPending(sessionId) {
      const cancelled = controller.cancelPending(sessionId) === true
      return {
        ok: cancelled,
        queued: false,
        childSessionId: null,
        reason: cancelled ? 'cancelled' : 'nothing-pending',
        error: null,
      }
    },

    /**
     * 弹宿主原生问答弹窗确认是否换会话（**自传超时**）。
     *
     * ⚠️ P2-25（现状说明，**刻意保留、不改行为**）：这个端点定义了但**生产代码从不调用**。
     *   自动触发那条路径走的是 `controller` 内部由 `deps.askHandoff` 注入的 `askForHandoff`
     *   （见 `handoff-controller.mjs` 的 `autoPromptLevel === 'confirm'` 分支），客户端 UI 的
     *   手工「换会话」按钮也**不弹确认卡片**（点了就换，属产品取舍：手工动作本身就是明确意图）。
     *   之所以不删：它是 typert 清单 / 客户端 descriptor / 本实现的**三方一致**的一项，
     *   删掉要同时动清单与客户端；留着只作为可被 RPC 调用的能力面。
     *
     * @param {string} sessionId - 会话 id。
     * @param {string} [reason] - 触发原因（人话）。
     * @param {string} [detail] - 交接文档预览。
     * @returns {Promise<{action: string, reason: string}>} 归一化动作。
     */
    async confirm(sessionId, reason = '到点了', detail) {
      const session = ctx.get('sessions')?.get?.(sessionId)
      if (session === undefined || session === null) {
        return { action: 'cancel', reason: 'session-not-found' }
      }
      const health = await healthOfSession(session)
      const answer = await askHandoff({
        userQuestions: safeGet(ctx, 'userQuestions'),
        health,
        chainIndex: (await controller.status(sessionId))?.chainIndex ?? 1,
        reasonLabel: typeof reason === 'string' && reason.length > 0 ? reason : '到点了',
        detail: typeof detail === 'string' ? detail : undefined,
        timeoutMs: configStore.config.confirmTimeoutMs,
      })
      if (answer.action === 'always-auto') {
        // 「以后都自动接力」：把自动程度落盘成全自动。
        //
        // ⚠️ P2-11：这里以前是 `await ...update(...).catch(() => undefined)` —— 落盘失败被
        //    静默吞掉：用户看到"以后都自动"，实际既不生效也没有任何痕迹。现在失败必须**可见**：
        //      1. 记一条 warn（`ctx.logger`）；
        //      2. 进 RPC 自己的错误收集，随 `stats().errors` 透出。
        //    返回给客户端的 `confirmResultSchema` 形状**保持不变**（改它会牵动客户端与严格校验）。
        let saved
        try {
          saved = await configStore.update({ autoPromptLevel: 'auto' })
        } catch (error) {
          saved = { ok: false, error: String(error?.message ?? error) }
        }
        if (saved?.ok !== true) {
          recordError(sessionId, `「以后都自动接力」保存失败（设置未生效，仍是原自动程度）：${String(saved?.error ?? 'unknown')}`)
        }
      }
      return { action: String(answer.action), reason: String(answer.reason) }
    },

    /**
     * 读最近一份（或指定）交接文档。
     * @param {string} [name] - 文件名；留空 = 最近一份。
     * @param {boolean} [read] - 是否带内容（默认带）。
     * @returns {Promise<object>} 结果。
     */
    async readHandoffDoc(name, read = true) {
      const dir = docDirInfo()
      const listed = await listDocs({ dir: dir.dir })
      const file = typeof name === 'string' && name.length > 0
        ? listed.files.find((entry) => entry.name === name)
        : listed.files[0]
      if (file === undefined) {
        return { found: false, name: null, path: null, content: null }
      }
      if (read === false) {
        return { found: true, name: file.name, path: file.path, content: null }
      }
      try {
        const content = await readDoc(file.path)
        return { found: true, name: file.name, path: file.path, content: String(content) }
      } catch (error) {
        return { found: true, name: file.name, path: file.path, content: `(读取失败：${String(error?.message ?? error)})` }
      }
    },

    /**
     * 列交接文档目录。
     * @returns {Promise<object>} 结果。
     */
    async listHandoffDocs() {
      const dir = docDirInfo()
      const listed = await listDocs({ dir: dir.dir })
      const files = listed.files
      return {
        dir: listed.dir,
        exists: listed.exists === true,
        files,
        // 总数（截断前）：设置页用它显示「还有 N 份更早的」。旧宿主没给就退化成已列出的条数。
        total: Number.isFinite(listed.total) ? listed.total : files.length,
      }
    },

    /**
     * 列模型目录（设置页选「新会话用哪个模型 / 多强思考」的数据源）。
     *
     * ⚠️ **返回裸目录，不许再包 `{ok,value}`**（2026-10-14 真机血案，见 PK-030）：
     *    网关对每次一元调用**自己**加 `{ok:true, value}` 信封（宿主源码原话与证据见
     *    `lib/typert.host.mjs` 顶部的"出参契约"）。服务再包一层就是**双层信封**，
     *    客户端 `unwrapRemote()` 只剥一层 ⇒ 拿到的"目录"里根本没有 `groups`
     *    ⇒ 设置页三个下拉全空（真机症状）。出错就 `throw`，网关会翻成 `{ok:false,error}`。
     *
     * 空目录**不是错误**：返回带 `diagnosis` 的空目录，让界面说得出原因。
     *
     * @returns {Promise<object>} 裸目录（`normalizeModelCatalog` 的产物）。
     */
    async listModelCatalog() {
      try {
        // ① 宿主现成的目录（拿得到就用，它带 default 路由与内置模型）。
        const sessionController = safeGet(ctx, 'sessionController')
        const hasController = typeof sessionController?.modelCatalog === 'function'
        const value = hasController
          ? normalizeModelCatalog(await sessionController.modelCatalog())
          // ② 拿不到就自己组。2026-10-13 真机证据（启动自检日志 plugin-boot.log）：
          //    `hasSessionController: false` —— 插件上下文里**没有**这个服务；
          //    但 `hasLlm: true / hasSettings: true`、`providerCount: 4` 都在。
          //    所以改用"拿得到的那两个"组目录，数据源与 DSH 自己的模型设置界面同源。
          : await buildCatalogFromLlm()
        // 补上「设置里手填的自定义模型目录」——适配器的 listModels() 不会给（见上方函数说明）。
        // 这一步**失败也不许毁掉端点**：已经列出来的模型照旧可用。
        try {
          await mergeCustomModels(value, customModelsByProvider())
        } catch {
          // 忽略：少列几个总比整页读不出来强。
        }
        // 真的一个模型都没有时才附诊断，让界面说得出原因（否则不打扰）。
        // 带上 `v1.2`：用户截图即可确认"跑的是哪一版界面"，省掉反复猜。
        if (value.groups.length === 0) {
          value.diagnosis = `诊断[v1.2]：本机供应商 ${countProviders()} 个 / 分组 ${value.groups.length} 个 / 失败 ${Array.isArray(value.failures) ? value.failures.length : '未知'} 个 / sessionController ${hasController ? '有' : '无'}`
        }
        return value
      } catch (error) {
        // 抛出 → 网关翻成 {ok:false,error} → 设置页显示「读不到模型目录：…」（不再静默变空）。
        throw new Error(`读取模型目录失败：${String(error?.message ?? error)}`)
      }
    },

    /**
     * 列权限档位（设置页选「新会话用哪档权限」的数据源）。
     *
     * 没启用沙箱的部署**根本没有 `permissionPresets` 服务**，这不是错误，是环境能力差异：
     * 返回 `supported:false` + 人话原因，让设置页把这项显示成"当前环境不支持"而不是报红。
     * 返回**裸值**（信封由网关加，理由同 `listModelCatalog`）。
     *
     * @returns {Promise<object>} 裸值。
     */
    async listPermissionPresets() {
      const service = safeGet(ctx, 'permissionPresets')
      if (service === undefined || typeof service.catalog !== 'function') {
        return { supported: false, reason: '当前环境不支持权限预设（未启用沙箱）', presets: [] }
      }
      try {
        const raw = await service.catalog()
        const presets = normalizePermissionPresets(raw)
        // `current` = 这台机器**没有特别指定时**用的档位（服务的 defaultPreset）。
        // 设置页的「跟随原会话（xxx）」括号里显示它 —— 设置页是全局的，
        // "当前会话"在这里并不确定，用部署默认档才是这个选择真正的含义。
        const defaultId = typeof raw?.defaultPreset === 'string' ? raw.defaultPreset : ''
        // 只给**字符串 id**：中文名由客户端的映射负责（`仅可查看 / 工作区内修改 / 完全权限`），
        // 宿主不重复维护一份中文，避免两处漂移。
        return { supported: true, presets, ...(defaultId.length === 0 ? {} : { current: defaultId }) }
      } catch (error) {
        throw new Error(`读取权限档位失败：${String(error?.message ?? error)}`)
      }
    },

    /**
     * R4（D2 / D4）：列当前会话可用的技能 —— 卡片技能面板的**只读**数据源。
     *
     * host 代理内核 `sessionSkillCatalog.list({ sessionId })`（"不激活 Agent 的元数据读取路径"，
     * M1 §12.2 / 取证 F9-F12）；显示名按 **D3** 读该技能 `SKILL.md` 头部 `display_name`
     * （读失败/无 path 回落 `name`）；分组按 **D1** 用目录名规则。
     *
     * 返回**裸值** `{skills:[{name,displayName,description,group,ref}]}`；失败一律 `throw`
     * （PK-030：信封由网关加，客户端只剥一层）。
     *
     * @param {string} sessionId - 当前会话 id。
     * @returns {Promise<{skills: Array<{name: string, displayName: string, description: string, group: 'local'|'market', ref: string}>}>} 裸值。
     */
    async listSkills(sessionId) {
      const service = safeGet(ctx, 'sessionSkillCatalog')
      if (service === undefined || typeof service.list !== 'function') {
        throw new Error('当前环境没有 skills/list 端点（sessionSkillCatalog 服务不可用）')
      }
      let raw
      try {
        raw = await service.list({ sessionId: String(sessionId ?? '') })
      } catch (error) {
        throw new Error(`读取技能目录失败：${String(error?.message ?? error)}`)
      }
      const list = Array.isArray(raw?.skills) ? raw.skills : []
      const skills = (await Promise.all(list.map(async (entry) => {
        const name = typeof entry?.name === 'string' ? entry.name : ''
        if (name.length === 0) return undefined
        const path = typeof entry?.path === 'string' && entry.path.length > 0 ? entry.path : undefined
        const displayName = (path === undefined ? undefined : await readSkillDisplayName(path)) ?? name
        return {
          name,
          displayName,
          description: truncateOneLine(entry?.description),
          group: skillGroupOfPath(path),
          ref: name,
        }
      }))).filter((entry) => entry !== undefined)
      // 组顺序固定 `本地安装 → 市场安装`；组内按显示名排序（M1 §12.2 / 原型）。
      skills.sort((a, b) => (a.group === b.group ? a.displayName.localeCompare(b.displayName) : (a.group === 'local' ? -1 : 1)))
      return { skills }
    },
  }

  /**
   * 一个会话当前的健康度（`confirm` 的事实行要用）。
   * @param {object} session - 会话。
   * @returns {Promise<object>} 健康度。
   */
  async function healthOfSession(session) {
    const status = await controller.status(session.id)
    const config = configStore.config
    return computeHealth({
      mode: config.autoMode,
      usedTokens: status?.usedTokens,
      windowTokens: status?.windowTokens,
      nativeThresholdTokens: undefined,
      replaceSafetyFactor: config.replaceSafetyFactor,
      sessionBytes: status?.sessionBytes,
      sessionVolumeLimitBytes: config.sessionVolumeBytes,
    })
  }

  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'sessionHandoff', namespace: 'sessionHandoff' },
  })

  return service
}

/**
 * 所有 RPC 方法的统一出口（供控制器内部/测试直接调用，绕开网关）。
 * 注意：这个包裹**不做参数裁剪**——网关那条路径才会产生 `undefined` 占位。
 */
export function rpcSurface(service) {
  return {
    stats: (...args) => service.stats(...trimArgs(args)),
    updateConfig: (...args) => service.updateConfig(...trimArgs(args)),
    handoffNow: (...args) => service.handoffNow(...trimArgs(args)),
    cancelPending: (...args) => service.cancelPending(...trimArgs(args)),
    confirm: (...args) => service.confirm(...trimArgs(args)),
    readHandoffDoc: (...args) => service.readHandoffDoc(...trimArgs(args)),
    listHandoffDocs: (...args) => service.listHandoffDocs(...trimArgs(args)),
    listModelCatalog: (...args) => service.listModelCatalog(...trimArgs(args)),
    listPermissionPresets: (...args) => service.listPermissionPresets(...trimArgs(args)),
    listSkills: (...args) => service.listSkills(...trimArgs(args)),
  }
}

/**
 * 把控制器的结果折成 wire 形状（**不出现 undefined 属性**）。
 * @param {object} result - 控制器结果。
 * @param {string} sessionId - 会话 id。
 * @returns {object} wire 结果。
 */
export function normalizeHandoffResult(result, sessionId) {
  return {
    ok: result?.ok === true,
    queued: result?.queued === true,
    childSessionId: typeof result?.childSessionId === 'string' ? result.childSessionId : null,
    reason: typeof result?.reason === 'string' ? result.reason : null,
    error: typeof result?.error === 'string' ? result.error : null,
  }
}

/**
 * 安全的 `ctx.get`（服务缺席不该抛）。
 * @param {object} ctx - 上下文。
 * @param {string} name - 服务名。
 * @returns {object|undefined} 服务。
 */
export function safeGet(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}
