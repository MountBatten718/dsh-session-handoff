// 配置面：默认值 / 边界 / 未知键显式拒绝 / 加载期校验（零依赖，可纯 Node 单测）。
//
// 设计要点：上下文阈值、确认策略、新会话形态与摘要调用参数都在这里收口。
// 校验风格照 @deepseek-ai/dsh-token-meter/lib/index.js:602 `validateConfigKeys`：
// 未知键**显式抛错**，绝不静默忽略（静默忽略是配置写错却查不出来的主因）。

import { PLUGIN_NAME, DEFAULTS, LIMITS, REASONING_EFFORTS } from './constants.mjs'

/** 三档自动模式（§十六 16.2 的书面命名）。 */
export const AUTO_MODES = Object.freeze(['replace', 'hybrid', 'native'])

/** 默认档位 = 混合模式（§十三 表：档 2 推荐）。 */
export const DEFAULT_AUTO_MODE = 'hybrid'

/** 交接文档的生成方式：llm = 一次模型摘要（失败自动降级）；structured = 纯结构化拼装。 */
export const SUMMARY_MODES = Object.freeze(['llm', 'structured'])

/**
 * 「该换会话的时候怎么做」（§一 S1 的"自动程度区"，需求 P0-7）。
 * - notify  ：只提醒（UI 上给一个到点提示，用户自己点）
 * - confirm ：弹窗确认（**默认**；复用原生问答弹窗）
 * - auto    ：全自动（不问，直接换）
 */
export const AUTO_PROMPT_LEVELS = Object.freeze(['notify', 'confirm', 'auto'])

/** 硬切策略默认值。 */
export const HANDOFF_DEFAULTS = Object.freeze({
  autoMode: DEFAULT_AUTO_MODE,
  autoPromptLevel: 'confirm',
  summaryMode: 'llm',
  /**
   * 档② 的会话体积阈值（字节）。**8 MB —— 2026-10-10 用用户真实会话日志校准后确定的**。
   *
   * 校准依据（扫 `~/.dsh/sessions` 全部 76 份会话日志，zstd 解压后统计）：
   *   解压后体积：中位 0.92 MB ｜ P75 1.91 MB ｜ P90 4.77 MB ｜ 历史最大 14.31 MB
   *   事件条数　：中位 231 条 ｜ P75 593 条 ｜ P90 1946 条 ｜ 历史最大 8206 条
   *
   * 8 MB 略高于 P90、低于历史最重档 ⇒ 只在"确实重"的时候才触发（约 5% 左右的会话会碰到）。
   * ⚠️ 原先拍的 20 MB 是错的——用户历史上最重的会话才 14.31 MB，那条线**基本永远不会触发**。
   */
  sessionVolumeBytes: 8 * 1024 * 1024,
  /** 安全阀 A：自上次换会话起累计压缩满 N 次即硬切；null = 不启用（§十七）。仅混合模式生效。 */
  compactionCountTrigger: null,
  /** 档① 抢跑折中系数：切换线 = 原生生效阈值 × 该系数（§十八 定案 0.98）。 */
  replaceSafetyFactor: 0.98,
  /** 读不到原生生效阈值时的兜底比例（§十六 16.1 第 1 条：退化为 0.8 × 生效窗口）。 */
  nativeCompactionRatio: 0.8,
  /** 交接文档落盘（§一 S1"交接文档区"，默认开）。 */
  handoffDocPersist: true,
  /** 交接文档目录（空串 = 用 DSH 数据目录下的默认目录）。 */
  handoffDocDir: '',
  /** 决策日志开关（§一 S1"决策日志区"，默认开）。 */
  decisionLogEnabled: true,
  /** 弹窗确认的超时（毫秒）。**ask() 自身没有超时，必须自传 AbortSignal**（PK-006 同源纪律）。 */
  confirmTimeoutMs: 120 * 1000,
  /**
   * 「先不接力」之后，触发量再涨**百分之多少**就允许再问一次（整数百分比）。
   *
   * 50 = 再涨 50%（即原来的 1.5 倍）——2026-10-12 用户拍板的行为，现在改成可配置。
   * 为什么需要它：体积这类指标是单调递增的，而 P0-5 写的是"直到下次跨过阈值" ——
   * 只按"触发原因有没有变化"去重的话，用户点一次"先不接力"后本会话就**永久静音**了。
   * 唯一的默认值来源就是这里，其它地方一律引用 `HANDOFF_DEFAULTS.askRearmPercent`。
   */
  askRearmPercent: 50,
  /**
   * 新会话**固定**的推理强度（空串 = 跟随原会话的推理强度）。
   *
   * ⚠️ 为什么叫 `childReasoningEffort` 而不是 `reasoningEffort`：
   *    下面「上游命令面」里已经有一个 `reasoningEffort`，它是**摘要调用**的思考强度
   *    （默认 inherit，取值 off/high/max/inherit，被 index.mjs 与 lib/llm.mjs 消费）。
   *    两者语义完全不同：摘要那个是"写交接文档时要不要思考"，这个是"新会话用多强的思考"。
   *    若共用一个键，空串会被 lib/llm.mjs 当成真实取值发给模型（某些 provider 直接拒绝），
   *    把摘要功能打坏（2026-10-12 已实测过同类 `"off"` 被拒）。故新键带 `child` 前缀，
   *    与下面的 `childPermissionPreset` 对称。
   */
  childReasoningEffort: '',
  /**
   * 新会话的工作权限档位名（空串 = 跟随原会话）。
   *
   * ⚠️ 这里**不写死任何档位名**：档位目录由宿主 `permissionPresets.catalog()` 决定
   *    （不同部署可能增删档位），写死会让宿主一变我们就误杀。内核只保证"是个字符串"，
   *    合法性由 RPC 端点在拿到真实 catalog 时兜。
   */
  childPermissionPreset: '',
  // —— 2026-10-14 v1.2 新增（ARB-10：字面量只在 constants.mjs 的 DEFAULTS，这里只引用）——
  /** R1：新会话读完交接文档先给计划、等确认再动手（默认开）。 */
  childPlanFirst: DEFAULTS.CHILD_PLAN_FIRST,
  /** R2：硬切前等子代理交卷的最长时间（分钟，整数 1–60，默认 10）。 */
  subagentDrainTimeoutMin: DEFAULTS.SUBAGENT_DRAIN_TIMEOUT_MIN,
})

/** 硬切策略边界。 */
export const HANDOFF_LIMITS = Object.freeze({
  MIN_SESSION_VOLUME_BYTES: 1024 * 1024,
  MAX_SESSION_VOLUME_BYTES: 512 * 1024 * 1024,
  MIN_COMPACTION_COUNT_TRIGGER: 1,
  MAX_COMPACTION_COUNT_TRIGGER: 100,
  MIN_REPLACE_SAFETY_FACTOR: 0.5,
  MAX_REPLACE_SAFETY_FACTOR: 0.999,
  MIN_NATIVE_COMPACTION_RATIO: 0.05,
  MAX_NATIVE_COMPACTION_RATIO: 0.99,
  MIN_CONFIRM_TIMEOUT_MS: 5 * 1000,
  MAX_CONFIRM_TIMEOUT_MS: 30 * 60 * 1000,
  /** 「先不接力」后的重问涨幅下界：再涨 10% 就重问（已经很小，再低等于没闸门）。 */
  MIN_ASK_REARM_PERCENT: 10,
  /** 上界：再涨 5 倍才重问（再高基本等于永久静音，用户不如直接关弹窗）。 */
  MAX_ASK_REARM_PERCENT: 500,
  /** R2「等子代理交卷的最长时间」下界：1 分钟。 */
  MIN_SUBAGENT_DRAIN_TIMEOUT_MIN: 1,
  /** R2 上界：60 分钟（再长等于没有安全阀）。 */
  MAX_SUBAGENT_DRAIN_TIMEOUT_MIN: 60,
})

/** 全部合法配置键（未知键一律拒绝）。 */
export const KNOWN_CONFIG_KEYS = Object.freeze([
  // —— 硬切策略面（上一块）——
  'autoMode',
  'summaryMode',
  'sessionVolumeBytes',
  'compactionCountTrigger',
  'replaceSafetyFactor',
  'nativeCompactionRatio',
  // —— 界面面（本块：M2 §一 S1）——
  'autoPromptLevel',
  'handoffDocPersist',
  'handoffDocDir',
  'decisionLogEnabled',
  'confirmTimeoutMs',
  'askRearmPercent',
  // —— 新会话的「模型 / 推理强度 / 权限档」面（本块：设置页可改）——
  'childReasoningEffort',
  'childPermissionPreset',
  // —— 2026-10-14 v1.2 新增（R1 先提交计划 / R2 等子代理交卷）——
  'childPlanFirst',
  'subagentDrainTimeoutMin',
  // —— 蓝本 /handoff 命令面（原样保留，不动）——
  'enabled',
  'turns',
  'maxInputChars',
  'maxTokens',
  'timeoutMs',
  'reasoningEffort',
  'provider',
  'model',
].sort())

/**
 * 界面可改的键（设置页只送这些；**host 侧还要再过滤一次**，见 `pickEditable`）。
 * 这是"客户端送什么都照单全收"的防线：RPC 是跨进程序边界，不信客户端。
 *
 * ⚠️ 2026-10-12 方案变更：`provider` / `model` 从"界面不该改"移进来——设置页现在要能
 *    直接选新会话的模型（目录来自 `listModelCatalog`）。`reasoningEffort`（摘要思考强度）
 *    **仍然不在这里**：它是内部调优项，不该让用户随手改坏摘要。
 *    新会话的推理强度是另一个键 `childReasoningEffort`。
 */
export const EDITABLE_CONFIG_KEYS = Object.freeze([
  'enabled',
  'autoMode',
  'sessionVolumeBytes',
  'compactionCountTrigger',
  'autoPromptLevel',
  'handoffDocPersist',
  'decisionLogEnabled',
  'confirmTimeoutMs',
  'summaryMode',
  'askRearmPercent',
  // 新会话的模型路由与推理强度（设置页从模型目录里选）。
  'provider',
  'model',
  'childReasoningEffort',
  'childPermissionPreset',
  // 2026-10-14 v1.2：R1 开关 / R2 数字输入（都在 S1，必须可改）。
  'childPlanFirst',
  'subagentDrainTimeoutMin',
].sort())

const KNOWN_KEY_SET = new Set(KNOWN_CONFIG_KEYS)

/**
 * 未知键显式拒绝（照 dsh-token-meter 的做法，但一次列全，便于一次改完）。
 * @param {unknown} config - 待校验的配置对象。
 * @returns {void}
 * @throws {Error} 配置不是对象，或含未知键。
 */
export function validateConfigKeys(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${PLUGIN_NAME}: config must be a plain object`)
  }
  const unknown = Object.keys(config).filter((key) => !KNOWN_KEY_SET.has(key)).sort()
  if (unknown.length > 0) {
    const listed = unknown.map((key) => `"${key}"`).join(', ')
    throw new Error(`${PLUGIN_NAME}: unknown config key(s) ${listed}; known keys are ${KNOWN_CONFIG_KEYS.join(', ')}`)
  }
}

/**
 * 断言数字落在闭区间内。
 * @param {number} value - 待校验值。
 * @param {number} min - 下界（含）。
 * @param {number} max - 上界（含）。
 * @param {string} label - 错误消息里的键名。
 * @returns {number} 原值。
 */
function inRange(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${PLUGIN_NAME}: ${label} must be a number in [${min}, ${max}], got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 解析 `askRearmPercent`（「先不接力」后触发量再涨多少个百分点才重问）。
 *
 * 口径**故意与 `sessionVolumeBytes` 的"越界抛错"不同**（用户 2026-10-12 定稿）：
 *   · 越界 → **钳制到边界**（10 / 500），不抛错；
 *   · 非整数 → **四舍五入取整**；
 *   · 非有限值（NaN / ±Infinity / undefined / null / 空串）→ **回落默认值 50**；
 *   · 只有真正的**类型错误**（布尔 / 对象 / 数组 / 函数…）才抛带上下文的错误。
 *
 * 为什么钳制而不是抛错：这是"手感微调"项，用户在设置页滑到极端值不该把整份配置
 * 搞成非法、导致插件启动失败；而类型写错是另一回事，必须响亮失败（与既有口径一致）。
 *
 * @param {unknown} value - 原始值（可能来自 profile patch、设置页输入框的字符串）。
 * @returns {number} 落在 [MIN, MAX] 内的整数百分比。
 * @throws {Error} 值不是数字 / 数字字符串类型。
 */
function resolveAskRearmPercent(value) {
  const label = `askRearmPercent must be a number in [${HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT}, ${HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT}]`
  if (value === undefined || value === null) return HANDOFF_DEFAULTS.askRearmPercent
  const kind = typeof value
  if (kind !== 'number' && kind !== 'string') {
    throw new Error(`${PLUGIN_NAME}: ${label}, got ${JSON.stringify(value)}`)
  }
  // 设置面板的空输入框会送空串：按"留空 = 用默认值"处理（同 compactionCountTrigger 的约定）。
  if (typeof value === 'string' && value.trim() === '') return HANDOFF_DEFAULTS.askRearmPercent
  const numeric = kind === 'string' ? Number(value) : value
  // NaN / ±Infinity / 非数字字符串 → 回落默认值（产品口径，不抛错）。
  if (!Number.isFinite(numeric)) return HANDOFF_DEFAULTS.askRearmPercent
  const rounded = Math.round(numeric)
  return Math.min(
    HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT,
    Math.max(HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT, rounded),
  )
}

/**
 * 解析「可留空 = 跟随原会话」的字符串配置（`childReasoningEffort` / `childPermissionPreset`）。
 *
 * 口径：空串 / undefined / null → 空串（＝跟随原会话）；**只有真正的类型错误才抛错**。
 * 为什么不校验取值：推理强度与权限档位都由**宿主目录**决定（模型目录 / `permissionPresets.catalog()`），
 *   不同部署的档位名不一样；内核写死一份等于把宿主的变化变成我们的启动失败。
 *   合法性由 RPC 端点在拿到真实 catalog 时兜（见 `listModelCatalog` / `listPermissionPresets`）。
 *
 * @param {unknown} value - 原始值。
 * @param {string} label - 键名（错误消息用）。
 * @param {string} fallback - 默认值（**唯一来源是 HANDOFF_DEFAULTS**）。
 * @returns {string} 解析后的字符串（空串表示跟随原会话）。
 * @throws {Error} 值存在但不是字符串。
 */
function resolveFollowableText(value, label, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    throw new Error(`${PLUGIN_NAME}: ${label} must be a string (empty = follow the origin session), got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 解析「整数 + 越界钳制 + 非有限值回落默认」配置（R2 `subagentDrainTimeoutMin`）。
 *
 * 口径照架构方案 M1 §11.5 #6：非有限数 / 空串 → 回落默认；越界 → 钳制到边界。
 * 真正的类型错误（布尔 / 对象…）仍响亮抛错——那是配置写错，不是手感微调。
 *
 * @param {unknown} value - 原始值。
 * @param {number} min - 下界（含）。
 * @param {number} max - 上界（含）。
 * @param {number} fallback - 默认值（唯一来源是 HANDOFF_DEFAULTS）。
 * @param {string} label - 键名（错误消息用）。
 * @returns {number} 落在 [min, max] 内的整数。
 * @throws {Error} 值存在但不是数字 / 数字字符串。
 */
function clampInt(value, min, max, fallback, label) {
  if (value === undefined || value === null) return fallback
  const kind = typeof value
  if (kind !== 'number' && kind !== 'string') {
    throw new Error(`${PLUGIN_NAME}: ${label} must be an integer in [${min}, ${max}], got ${JSON.stringify(value)}`)
  }
  if (kind === 'string' && value.trim() === '') return fallback
  const numeric = kind === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

/**
 * 补齐默认值并做加载期校验。**非法配置响亮失败，不静默降级。**
 * 未知键在任何情况下都抛错（含 enabled:false）。
 * @param {Record<string, unknown>} [config] - 原始配置。
 * @returns {object} 补全并校验后的配置。
 * @throws {Error} 任一键未知或取值非法。
 */
export function resolveConfig(config = {}) {
  validateConfigKeys(config)

  const resolved = {
    // 硬切策略面
    autoMode: config.autoMode ?? HANDOFF_DEFAULTS.autoMode,
    autoPromptLevel: config.autoPromptLevel ?? HANDOFF_DEFAULTS.autoPromptLevel,
    summaryMode: config.summaryMode ?? HANDOFF_DEFAULTS.summaryMode,
    sessionVolumeBytes: config.sessionVolumeBytes ?? HANDOFF_DEFAULTS.sessionVolumeBytes,
    compactionCountTrigger: config.compactionCountTrigger ?? HANDOFF_DEFAULTS.compactionCountTrigger,
    replaceSafetyFactor: config.replaceSafetyFactor ?? HANDOFF_DEFAULTS.replaceSafetyFactor,
    nativeCompactionRatio: config.nativeCompactionRatio ?? HANDOFF_DEFAULTS.nativeCompactionRatio,
    handoffDocPersist: config.handoffDocPersist ?? HANDOFF_DEFAULTS.handoffDocPersist,
    handoffDocDir: config.handoffDocDir ?? HANDOFF_DEFAULTS.handoffDocDir,
    decisionLogEnabled: config.decisionLogEnabled ?? HANDOFF_DEFAULTS.decisionLogEnabled,
    confirmTimeoutMs: config.confirmTimeoutMs ?? HANDOFF_DEFAULTS.confirmTimeoutMs,
    // 钳制 / 取整 / 回落都在这里面（默认值唯一来源是 HANDOFF_DEFAULTS）。
    askRearmPercent: resolveAskRearmPercent(config.askRearmPercent),
    // 新会话的推理强度 / 权限档：空串 = 跟随原会话（档位名合法性交给 RPC 端点）。
    childReasoningEffort: resolveFollowableText(config.childReasoningEffort, 'childReasoningEffort', HANDOFF_DEFAULTS.childReasoningEffort),
    childPermissionPreset: resolveFollowableText(config.childPermissionPreset, 'childPermissionPreset', HANDOFF_DEFAULTS.childPermissionPreset),
    // R1：只有**显式 false** 才关（缺省 / 宿主旧版本缺席 = 默认开）。
    childPlanFirst: config.childPlanFirst !== false,
    // R2：越界钳制、非有限值回落（默认值单一来源 = HANDOFF_DEFAULTS）。
    subagentDrainTimeoutMin: clampInt(
      config.subagentDrainTimeoutMin,
      HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN,
      HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN,
      HANDOFF_DEFAULTS.subagentDrainTimeoutMin,
      'subagentDrainTimeoutMin',
    ),
    // 蓝本命令面
    enabled: config.enabled ?? DEFAULTS.ENABLED,
    turns: config.turns ?? DEFAULTS.TURNS,
    maxInputChars: config.maxInputChars ?? DEFAULTS.MAX_INPUT_CHARS,
    maxTokens: config.maxTokens ?? DEFAULTS.MAX_TOKENS,
    timeoutMs: config.timeoutMs ?? DEFAULTS.TIMEOUT_MS,
    reasoningEffort: config.reasoningEffort ?? DEFAULTS.REASONING_EFFORT,
    provider: config.provider ?? undefined,
    model: config.model ?? undefined,
  }

  if (!AUTO_MODES.includes(resolved.autoMode)) {
    throw new Error(`${PLUGIN_NAME}: autoMode must be one of ${AUTO_MODES.join('|')}, got ${JSON.stringify(resolved.autoMode)}`)
  }
  if (!AUTO_PROMPT_LEVELS.includes(resolved.autoPromptLevel)) {
    throw new Error(`${PLUGIN_NAME}: autoPromptLevel must be one of ${AUTO_PROMPT_LEVELS.join('|')}, got ${JSON.stringify(resolved.autoPromptLevel)}`)
  }
  if (!SUMMARY_MODES.includes(resolved.summaryMode)) {
    throw new Error(`${PLUGIN_NAME}: summaryMode must be one of ${SUMMARY_MODES.join('|')}, got ${JSON.stringify(resolved.summaryMode)}`)
  }
  if (typeof resolved.handoffDocPersist !== 'boolean') {
    throw new Error(`${PLUGIN_NAME}: handoffDocPersist must be a boolean`)
  }
  if (typeof resolved.decisionLogEnabled !== 'boolean') {
    throw new Error(`${PLUGIN_NAME}: decisionLogEnabled must be a boolean`)
  }
  if (typeof resolved.handoffDocDir !== 'string') {
    throw new Error(`${PLUGIN_NAME}: handoffDocDir must be a string (empty = default directory)`)
  }
  inRange(
    resolved.confirmTimeoutMs,
    HANDOFF_LIMITS.MIN_CONFIRM_TIMEOUT_MS,
    HANDOFF_LIMITS.MAX_CONFIRM_TIMEOUT_MS,
    'confirmTimeoutMs',
  )
  if (!Number.isInteger(resolved.sessionVolumeBytes)) {
    throw new Error(`${PLUGIN_NAME}: sessionVolumeBytes must be an integer number of bytes`)
  }
  inRange(
    resolved.sessionVolumeBytes,
    HANDOFF_LIMITS.MIN_SESSION_VOLUME_BYTES,
    HANDOFF_LIMITS.MAX_SESSION_VOLUME_BYTES,
    'sessionVolumeBytes',
  )

  // §十七："留空 = 不启用"。设置面板的空输入框会送空串，等价于留空，不算非法配置。
  if (resolved.compactionCountTrigger === '') resolved.compactionCountTrigger = null
  const trigger = resolved.compactionCountTrigger
  if (trigger !== null && trigger !== undefined) {
    if (!Number.isInteger(trigger)) {
      throw new Error(`${PLUGIN_NAME}: compactionCountTrigger must be an integer or null (null = disabled)`)
    }
    if (trigger === 0) {
      throw new Error(`${PLUGIN_NAME}: compactionCountTrigger = 0 is meaningless; leave it empty/null to disable the trigger`)
    }
    inRange(
      trigger,
      HANDOFF_LIMITS.MIN_COMPACTION_COUNT_TRIGGER,
      HANDOFF_LIMITS.MAX_COMPACTION_COUNT_TRIGGER,
      'compactionCountTrigger',
    )
  }
  inRange(
    resolved.replaceSafetyFactor,
    HANDOFF_LIMITS.MIN_REPLACE_SAFETY_FACTOR,
    HANDOFF_LIMITS.MAX_REPLACE_SAFETY_FACTOR,
    'replaceSafetyFactor',
  )
  inRange(
    resolved.nativeCompactionRatio,
    HANDOFF_LIMITS.MIN_NATIVE_COMPACTION_RATIO,
    HANDOFF_LIMITS.MAX_NATIVE_COMPACTION_RATIO,
    'nativeCompactionRatio',
  )

  if (typeof resolved.enabled !== 'boolean') {
    throw new Error(`${PLUGIN_NAME}: enabled must be a boolean`)
  }
  if (!REASONING_EFFORTS.includes(resolved.reasoningEffort)) {
    throw new Error(`${PLUGIN_NAME}: reasoningEffort must be one of ${REASONING_EFFORTS.join('|')}`)
  }
  if (!Number.isInteger(resolved.turns) || resolved.turns < LIMITS.MIN_TURNS || resolved.turns > LIMITS.MAX_TURNS) {
    throw new Error(`${PLUGIN_NAME}: turns must be an integer in [${LIMITS.MIN_TURNS}, ${LIMITS.MAX_TURNS}]`)
  }
  if (!Number.isInteger(resolved.maxInputChars) || resolved.maxInputChars < LIMITS.MIN_MAX_INPUT_CHARS || resolved.maxInputChars > LIMITS.MAX_MAX_INPUT_CHARS) {
    throw new Error(`${PLUGIN_NAME}: maxInputChars must be an integer in [${LIMITS.MIN_MAX_INPUT_CHARS}, ${LIMITS.MAX_MAX_INPUT_CHARS}]`)
  }
  if (!Number.isInteger(resolved.maxTokens) || resolved.maxTokens < LIMITS.MIN_MAX_TOKENS || resolved.maxTokens > LIMITS.MAX_MAX_TOKENS) {
    throw new Error(`${PLUGIN_NAME}: maxTokens must be an integer in [${LIMITS.MIN_MAX_TOKENS}, ${LIMITS.MAX_MAX_TOKENS}]`)
  }
  if (!Number.isInteger(resolved.timeoutMs) || resolved.timeoutMs < LIMITS.MIN_TIMEOUT_MS || resolved.timeoutMs > LIMITS.MAX_TIMEOUT_MS) {
    throw new Error(`${PLUGIN_NAME}: timeoutMs must be an integer in [${LIMITS.MIN_TIMEOUT_MS}, ${LIMITS.MAX_TIMEOUT_MS}]`)
  }
  const hasProvider = resolved.provider !== undefined
  const hasModel = resolved.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error(`${PLUGIN_NAME}: provider and model must be configured together`)
  }
  if (hasProvider && (typeof resolved.provider !== 'string' || resolved.provider.length === 0 || typeof resolved.model !== 'string' || resolved.model.length === 0)) {
    throw new Error(`${PLUGIN_NAME}: provider and model must be non-empty strings`)
  }
  return resolved
}

/**
 * 从客户端送上来的补丁里**只挑界面能改的键**，并做类型规范化。
 *
 * 为什么必须有这一层：`updateConfig` 是跨进程 RPC 入口，客户端送什么都不能照单全收。
 * 未知键、界面不该改的键（`timeoutMs` / `reasoningEffort` …）一律丢弃，
 * 再把剩下的交给 `resolveConfig` 做**取值**校验（超范围照样响亮抛错）。
 *
 * @param {unknown} patch - 客户端补丁。
 * @returns {{patch: object, rejected: string[]}} 过滤后的补丁与被拒绝的键。
 */
export function pickEditable(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error(`${PLUGIN_NAME}: config patch must be a plain object`)
  }
  const allowed = new Set(EDITABLE_CONFIG_KEYS)
  const kept = {}
  const rejected = []
  /**
   * 要**从配置里删掉**的键（不是改成某个值）。
   *
   * 为什么需要：`configStore` 是 merge 语义（`{...raw, ...patch}`），而「跟随原会话」
   * 要求 provider/model **真的消失**（回到默认空）。若把"空"当成"本次不修改"，
   * 用户在下拉里改回「跟随原会话」之后配置里仍留着旧值，新会话还会用那个模型 ——
   * 界面说着"跟随原会话"、实际却把模型固定住了（假跟随）。
   *
   * ⚠️ 不能拿 `null` 表达删除：`compactionCountTrigger` 的 `null` 是**合法值**（不启用），
   *    两者语义不同，混用会互相踩。
   * @type {string[]}
   */
  const cleared = []
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) {
      rejected.push(key)
      continue
    }
    if (key === 'sessionVolumeBytes' || key === 'confirmTimeoutMs') {
      if (value === null || value === undefined) continue
      const numeric = typeof value === 'string' ? Number(value) : value
      if (!Number.isFinite(numeric)) {
        throw new Error(`${PLUGIN_NAME}: ${key} must be a number, got ${JSON.stringify(value)}`)
      }
      kept[key] = Math.round(numeric)
      continue
    }
    if (key === 'compactionCountTrigger') {
      // 空串 / null = 不启用（§十七"留空 = 不启用"）。
      if (value === null || value === undefined || value === '') {
        kept[key] = null
        continue
      }
      const numeric = typeof value === 'string' ? Number(value) : value
      if (!Number.isFinite(numeric)) {
        throw new Error(`${PLUGIN_NAME}: compactionCountTrigger must be a number or empty, got ${JSON.stringify(value)}`)
      }
      kept[key] = Math.round(numeric)
      continue
    }
    if (key === 'childPlanFirst') {
      // 开关只接受布尔（客户端送字符串是 bug，响亮拒绝而不是悄悄当成 true）。
      if (typeof value !== 'boolean') {
        throw new Error(`${PLUGIN_NAME}: childPlanFirst must be a boolean, got ${JSON.stringify(value)}`)
      }
      kept[key] = value
      continue
    }
    if (key === 'subagentDrainTimeoutMin') {
      // A1：越界（0 / 65）**抛错拒绝**，照 `sessionVolumeBytes` 的越界口径，不照 `askRearmPercent` 的钳制口径。
      kept[key] = Math.round(inRange(
        value,
        HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN,
        HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN,
        'subagentDrainTimeoutMin',
      ))
      continue
    }
    if (key === 'provider' || key === 'model') {
      // 空串 / null / undefined = 「跟随原会话的模型」⇒ **把这个键清掉**（见上面 `cleared` 的说明）。
      // ⚠️ 只填一半（一个有值、一个被清）= 回落到 resolveConfig 的"必须成对"响亮报错，不静默凑一对。
      if (value === null || value === undefined || value === '') {
        cleared.push(key)
        continue
      }
      kept[key] = value
      continue
    }
    kept[key] = value
  }
  rejected.sort()
  cleared.sort()
  return { patch: kept, rejected, cleared }
}
