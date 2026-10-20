// 宿主面 Typert 清单（手写，结构照 `dsh-cost-meter/lib/typert.host.js`）——
// 这是**浏览器半区调用宿主半区的唯一通道**。
//
// 为什么必须手写而不能靠"裸 ctx.provide 就能 ctx.get"：
//   1. 客户端 `ctx.get('sessionHandoff')` 拿到的是**客户端进程自己的**服务表，
//      宿主 `ctx.provide` 出去的对象根本不在那个进程里；
//   2. 宿主网关只认两种端点定义：
//      a) strict 定义：`ctx.typert.local.get('<namespace>/<method>')`
//         —— 由 typert-loader 从包的 `./typert` 导出注册；
//      b) SRC 回退：要求服务实例的**原型方法**带 Remote 标记
//         （`dsh-api-gateway/lib/index.js:995-1013`），普通对象做不到。
//   3. 所以三件套齐了才有得用：`ctx.provide` + `typertRemote` 绑定 + 本清单。
//      绑定校验在 `dsh-api-gateway/lib/index.js:1441-1453`。
//
// ⚠️ 编码器形态（`dsh-api-gateway/lib/index.js:1501-1516` 与 `:1111-1125`）：
//   只有两处用到 codec：`codec.create().parse(value)`（入参）与可选的
//   `codec.encode(value, writeBytes)`（出参）。因此本文件的 codec **完全不依赖 zod**——
//   手写极小校验器即可，少一个包就少一类解析坑（PK-004 的同类教训）。
//
// ⚠️ 返回给客户端的值里**不允许出现显式 undefined 属性**（网关做 JSON 安全校验，
//   `{"a": null}` 可以、`{"a": undefined}` 会让整个 result-invalid；
//   这条坑见 dsh-cost-meter/lib/index.js:2390-2393 的注释）。

// ─────────────────────────── 极小校验器（只用得到 zod 的一个子集） ───────────────────────────

/** 校验失败时抛这个（网关会包成 gateway/input-invalid）。 */
class WireValidationError extends TypeError {
  /**
   * @param {string} message - 说明。
   */
  constructor(message) {
    super(message)
    this.name = 'WireValidationError'
  }
}

/**
 * 人话描述一个值（错误信息里用，避免 `[object Object]`）。
 * @param {unknown} value - 值。
 * @returns {string} 描述。
 */
function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** 字符串 schema。 */
const str = {
  parse(value) {
    if (typeof value !== 'string') throw new WireValidationError(`expected string, got ${describe(value)}`)
    return value
  },
}

/** 布尔 schema。 */
const bool = {
  parse(value) {
    if (typeof value !== 'boolean') throw new WireValidationError(`expected boolean, got ${describe(value)}`)
    return value
  },
}

/** 数字 schema。 */
const num = {
  parse(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new WireValidationError(`expected finite number, got ${describe(value)}`)
    return value
  },
}

/** 整数 schema（`askRearmPercent` 这类百分比字段用）。 */
const int = {
  parse(value) {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new WireValidationError(`expected integer, got ${describe(value)}`)
    return value
  },
}

/** 可空数字（wire 上的显式 null）。 */
const nullableNum = {
  parse(value) {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new WireValidationError(`expected number|null, got ${describe(value)}`)
    return value
  },
}

/** 可空字符串。 */
const nullableStr = {
  parse(value) {
    if (value === null) return null
    if (typeof value !== 'string') throw new WireValidationError(`expected string|null, got ${describe(value)}`)
    return value
  },
}

/**
 * 可空对象（wire 上的显式 null）。用于 `stats().drain`（ARB-13：没有收尾时必须显式 null）。
 * @param {{parse: Function}} inner - 内层对象 schema。
 * @returns {{parse: Function}} schema。
 */
function nullable(inner) {
  return {
    parse(value) {
      if (value === null) return null
      return inner.parse(value)
    },
  }
}

/** 任意标量（字符串 / 有限数字 / 布尔 / null）。 */
const scalar = {
  parse(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    throw new WireValidationError(`expected scalar|null, got ${describe(value)}`)
  },
}

/**
 * 限定取值的字符串 schema（枚举；R4 `listSkills[].group` 用）。
 * @param {string[]} allowed - 合法取值。
 * @returns {{parse: Function}} schema。
 */
function oneOf(allowed) {
  const set = new Set(allowed)
  return {
    parse(value) {
      if (typeof value !== 'string' || !set.has(value)) {
        throw new WireValidationError(`expected one of ${allowed.join('|')}, got ${describe(value)}`)
      }
      return value
    },
  }
}

/**
 * 对象 schema（**严格**：多余键直接拒绝，与内核 strict codec 同口径）。
 *
 * ⚠️ 字段缺席的判定看 schema 自己的 `acceptsUndefined` 标记（`optional()` 会打上）：
 *   必填字段缺席照旧抛 `missing key`（挡住 undefined 键事故）；可选字段缺席直接跳过，
 *   且**不会在出参里留一个显式 undefined**（那会被网关的 JSON 安全校验拒掉）。
 * @param {Record<string, {parse: Function}>} shape - 字段表。
 * @returns {{parse: Function}} schema。
 */
function object(shape) {
  const known = new Set(Object.keys(shape))
  return {
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new WireValidationError(`expected object, got ${describe(value)}`)
      }
      for (const key of Object.keys(value)) {
        if (!known.has(key)) throw new WireValidationError(`unexpected key ${JSON.stringify(key)}`)
      }
      const out = {}
      for (const [key, schema] of Object.entries(shape)) {
        if (value[key] === undefined) {
          if (schema.acceptsUndefined === true) continue
          throw new WireValidationError(`missing key ${JSON.stringify(key)}`)
        }
        out[key] = schema.parse(value[key])
      }
      return out
    },
  }
}

/**
 * 数组 schema。
 * @param {{parse: Function}} item - 元素 schema。
 * @returns {{parse: Function}} schema。
 */
function array(item) {
  return {
    parse(value) {
      if (!Array.isArray(value)) throw new WireValidationError(`expected array, got ${describe(value)}`)
      return value.map((entry) => item.parse(entry))
    },
  }
}

/**
 * 可选 schema（`undefined` 直接放行）。
 *
 * 打 `acceptsUndefined` 标记后，`object()` 也会允许该字段**缺席**
 * （缺席时该键不会出现在出参里，避免显式 undefined 被网关拒掉）。
 * @param {{parse: Function}} inner - 内层 schema。
 * @returns {{parse: Function, acceptsUndefined: true}} schema。
 */
function optional(inner) {
  return {
    acceptsUndefined: true,
    parse(value) {
      if (value === undefined) return undefined
      return inner.parse(value)
    },
  }
}

/**
 * 记录 schema（任意键，值是给定 schema）。
 * @param {{parse: Function}} value - 值 schema。
 * @returns {{parse: Function}} schema。
 */
function record(value) {
  return {
    parse(input) {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new WireValidationError(`expected record, got ${describe(input)}`)
      }
      const out = {}
      for (const [key, raw] of Object.entries(input)) {
        if (raw === undefined) continue
        out[key] = value.parse(raw)
      }
      return out
    },
  }
}

/**
 * 任意 JSON 安全值（递归）。
 *
 * 用途：决策记录的 `detail` 是宿主内部拼的明细对象，未来可能嵌套
 * （现在都是标量，但用 `record(scalar)` 会在某天悄悄把整条 RPC 拒掉）。
 * 仍然拒绝 undefined / 函数 / NaN 这类不是 JSON 的东西。
 * @type {{parse: (value: unknown) => unknown}}
 */
const jsonValue = {
  parse(value) {
    if (value === null) return null
    const kind = typeof value
    if (kind === 'string' || kind === 'boolean') return value
    if (kind === 'number') {
      if (!Number.isFinite(value)) throw new WireValidationError(`expected finite number, got ${describe(value)}`)
      return value
    }
    if (Array.isArray(value)) return value.map((entry) => jsonValue.parse(entry))
    if (kind === 'object') {
      const out = {}
      for (const [key, raw] of Object.entries(value)) {
        if (raw === undefined) continue
        out[key] = jsonValue.parse(raw)
      }
      return out
    }
    throw new WireValidationError(`expected JSON value, got ${describe(value)}`)
  },
}

/**
 * 严格编解码器（loader 要求 mode='strict' + typeSymbol + create()）。
 *
 * ⚠️ **必须带 `encode`**（2026-10-12 代码审查 P2-4）：
 *   宿主 `encodeRpcResult` 走的是 `codec.encode?.(value, writeBytes) ?? value`
 *   （`dsh-api-gateway/lib/index.js:1131`），少了 `encode` 就 `?? value` 原样放行
 *   ⇒ 出参**零校验**，"严格 codec"的防线是空心的。
 *   这里让出参与入参同一口径（同一个 schema）：不合法当场抛，
 *   而不是等客户端拿到坏形状（2026-10-10"界面全空"就是那一类事故）。
 */
const strictCodec = (name, schema) => ({
  mode: 'strict',
  typeSymbol: `dsh-session-handoff#${name}`,
  schema,
  create: () => schema,
  encode: (value) => schema.parse(value),
})

// ─────────────────────────── 形状 ───────────────────────────

/** 明细表的一行（S2-明细：指标 / 当前 / 阈值 / 距离）。 */
const detailRowSchema = object({
  label: str,
  current: str,
  limit: str,
  distance: str,
})

/** 决策日志一条。 */
const decisionSchema = object({
  at: num,
  time: str,
  action: str,
  label: str,
  reason: str,
  human: str,
  contextPercent: str,
  volume: str,
  chainIndex: num,
  // 真实记录**一定**带它（`reduceDecision` 产出 `detail: detail ?? {}`）。
  // 旧 schema 漏了它：现在不炸只因出参没校验；一旦校验生效就会把整条 stats 拒掉（P2-5）。
  detail: jsonValue,
})

/** 健康度行（S2 的 wire 形状；与 lib/handoff-report.mjs 的 buildHealthDto 一一对应）。 */
const healthRowSchema = object({
  v: num,
  sessionId: str,
  title: nullableStr,
  mode: str,
  autoPromptLevel: str,
  safePoint: bool,
  handedOff: bool,
  chainIndex: num,
  usedTokens: nullableNum,
  windowTokens: nullableNum,
  windowSource: nullableStr,
  contextRatio: nullableNum,
  nativeThresholdTokens: nullableNum,
  contextLimitTokens: nullableNum,
  contextLimitRatio: nullableNum,
  contextMarker: bool,
  contextCounts: bool,
  sessionBytes: nullableNum,
  sessionVolumeLimitBytes: nullableNum,
  compactionsSinceHandoff: num,
  compactionCountTrigger: nullableNum,
  turnIndex: num,
  messageCount: num,
  eventCount: num,
  perTurnTokens: nullableNum,
  perTurnBytes: nullableNum,
  rateTurns: num,
  rateReason: str,
  level: str,
  turnsLeft: nullableNum,
  turnsLeftReason: str,
  detail: array(detailRowSchema),
  // R6（2026-10-20 止血）：子代理会话标记（客户端据此置灰「换会话」）。
  subagent: bool,
  decisionAction: str,
  decisionReason: str,
  decisionDetail: record(scalar),
})

/** 配置的 wire 形状（设置页读它）。 */
const configSchema = object({
  enabled: bool,
  autoMode: str,
  autoPromptLevel: str,
  summaryMode: str,
  sessionVolumeBytes: num,
  compactionCountTrigger: nullableNum,
  confirmTimeoutMs: num,
  handoffDocPersist: bool,
  decisionLogEnabled: bool,
  // 「先不接力」后再涨多少个百分点才重问（整数；默认 50，范围 10~500）。
  // ⚠️ **必填**，不是 optional：出参防线留空档正是 P2-5 那类事故的根因
  //    （当时 `decisionSchema` 漏了 `detail`，只因出参没校验才一直没炸）。
  //    `configWire()` 已经带出该字段；谁哪天把它删了，这里会立刻红。
  askRearmPercent: int,
  // —— 新会话的模型 / 推理强度 / 权限档（设置页要显示当前值）——
  // 空串 = 跟随原会话。同样**必填**：`configWire()` 总是带出来（不会是 undefined）。
  provider: str,
  model: str,
  childReasoningEffort: str,
  childPermissionPreset: str,
  // —— 2026-10-14 v1.2 新增（R1 先提交计划 / R2 等子代理交卷）——
  // **必填**：`configWire()` 总是带出来（缺了就当场红，不留防线空档）。
  childPlanFirst: bool,
  subagentDrainTimeoutMin: int,
})

/**
 * R2 子代理收尾的运行期状态（ARB-13）。
 * `drain: null | { phase, waitedSec, timeoutMin, interruptedCount }`。
 */
const drainSchema = object({
  phase: str,
  waitedSec: int,
  timeoutMin: int,
  interruptedCount: int,
})

/** `stats` 的返回。 */
const statsSchema = object({
  config: configSchema,
  rows: array(healthRowSchema),
  docDir: str,
  docDirSource: str,
  decisions: array(decisionSchema),
  errors: array(object({ sessionId: str, message: str })),
  // R2（ARB-13）：没有进行中的收尾时是**显式 null**（可空但键必须在）。
  drain: nullable(drainSchema),
})

/** `updateConfig` 的返回。 */
const updateResultSchema = object({
  ok: bool,
  error: nullableStr,
  rejected: array(str),
  config: configSchema,
})

/** `handoffNow` / `cancelPending` 的返回。 */
const handoffResultSchema = object({
  ok: bool,
  queued: bool,
  childSessionId: nullableStr,
  reason: nullableStr,
  error: nullableStr,
})

/** `confirm` 的返回（换会话确认卡片的结果）。 */
const confirmResultSchema = object({
  action: str,
  reason: str,
})

/** `readHandoffDoc` 的返回。 */
const docResultSchema = object({
  found: bool,
  name: nullableStr,
  path: nullableStr,
  content: nullableStr,
})

/** `listHandoffDocs` 的返回。 */
const docListSchema = object({
  dir: str,
  exists: bool,
  // `reason` = 触发原因的短标签（宿主把每份文档头部读一小段解析出来），
  // 客户端列表要显示「会话短码 · 手工接力」这种行；解析不到就是空串。
  files: array(object({ name: str, path: str, bytes: num, at: num, reason: str })),
  // 截断前的总数：设置页要显示「还有 N 份更早的」。
  total: num,
})

/**
 * ⚠️⚠️ **出参契约（2026-10-14 真机血案，必须牢记）**：
 *
 * 宿主服务方法返回的是**裸值（bare value）**，`{ok, value}` 这层信封由**网关自己加**。
 * 网关客户端（宿主源码里的原话）：
 *
 *   Every unary call resolves to `RemoteResult<T>` — `{ ok: true, value }`
 *   or `{ ok: false, error }` — and never rejects for a carrier problem.
 *   …
 *   const value = descriptor.result.mode === 'strict' && descriptor.result.decode !== undefined
 *     ? descriptor.result.decode(result.value)
 *     : result.value;
 *   return { ok: true, value };
 *
 * 所以**服务方法再自己包一层 `{ok,value}` 就是双层信封**：客户端 `unwrapRemote()` 只剥掉
 * 网关那层，拿到的"目录"其实是我们的信封本身 —— `groups` / `presets` 全都不在顶层。
 * 真机表现（2026-10-14）：设置页三个下拉全空、提示"没读到可用模型/权限档位"，
 * 而宿主启动自检明明真调用端点返回了 12 个模型（PK-030）。
 *
 * **做法**：这里的 schema 描述的是**宿主方法的裸返回值**；出错就 `throw`，
 * 由网关翻译成 `{ok:false, error}`（客户端 `unwrapRemote` 会拿到 `error`）。
 */

/**
 * `listModelCatalog` 的返回体（**裸目录**，不含 ok/value 信封）。
 *
 * `default.reasoningEffort` / `models[].defaultEffort` 是可选字段：缺席时 `object()` 直接跳过，
 * 出参里不会留下显式 undefined（那会被网关整条拒掉）。
 */
const modelCatalogSchema = object({
  default: object({
    provider: str,
    model: str,
    reasoningEffort: optional(str),
  }),
  groups: array(object({
    id: str,
    name: str,
    models: array(object({
      id: str,
      name: str,
      // 宿主 `reasoning.efforts` 在这里已经被拍平成 `[{id,name}]`（没有 reasoning 的模型是空数组）。
      efforts: array(object({ id: str, name: str })),
      defaultEffort: optional(str),
    })),
  })),
  failures: array(object({ id: str, name: str, message: str })),
  // 空目录时的诊断（带数字），让界面能说清"为什么一个模型都没有"。
  diagnosis: optional(str),
})

/** `listPermissionPresets` 的返回体（**裸目录**：supported/reason/presets/current）。 */
const permissionPresetsSchema = object({
  // false = 当前环境没有 permissionPresets 服务（未启用沙箱），不是错误。
  supported: bool,
  reason: optional(str),
  presets: array(object({ id: str, name: str })),
  // 没有特别指定时用的档位 id（服务 defaultPreset）：设置页「跟随原会话（xxx）」括号里显示它。
  current: optional(str),
})

/**
 * R4：`handoffNow` 的**可选第三参** `{ note?, skillRefs? }`（M1 §12.3(a)）。
 * 严格对象：未知键直接拒（绝不用 additionalProperties 兜底）。
 */
const manualOptionsSchema = object({
  note: optional(str),
  skillRefs: optional(array(str)),
})

/** R4：`listSkills` 的返回体（**裸值**，无 ok/value 信封；D4）。 */
const skillListSchema = object({
  skills: array(object({
    name: str,
    displayName: str,
    description: str,
    group: oneOf(['local', 'market']),
    ref: str,
  })),
})

const _stats$codec = strictCodec('SessionHandoffStats', statsSchema)
const _update$codec = strictCodec('SessionHandoffUpdateResult', updateResultSchema)
const _handoff$codec = strictCodec('SessionHandoffResult', handoffResultSchema)
const _confirm$codec = strictCodec('SessionHandoffConfirmResult', confirmResultSchema)
const _doc$codec = strictCodec('SessionHandoffDoc', docResultSchema)
const _docList$codec = strictCodec('SessionHandoffDocList', docListSchema)
const _modelCatalog$codec = strictCodec('SessionHandoffModelCatalog', modelCatalogSchema)
const _permissionPresets$codec = strictCodec('SessionHandoffPermissionPresets', permissionPresetsSchema)
const _manualOptions$codec = strictCodec('SessionHandoffManualOptions', optional(manualOptionsSchema))
const _skillList$codec = strictCodec('SessionHandoffSkillList', skillListSchema)
const _sessionIds$codec = strictCodec('SessionIds', optional(array(str)))
const _sessionId$codec = strictCodec('SessionId', str)
const _patch$codec = strictCodec('SessionHandoffConfigPatch', record(scalar))
const _limit$codec = strictCodec('DecisionLimit', optional(num))
const _filter$codec = strictCodec('DecisionFilter', optional(str))
const _name$codec = strictCodec('DocFileName', optional(str))
const _read$codec = strictCodec('DocRead', optional(bool))
const _reason$codec = strictCodec('ConfirmReason', optional(str))
const _detail$codec = strictCodec('ConfirmDetail', optional(str))

/**
 * 一个 invocation 的公共字段。
 * @param {string} method - 方法名。
 * @returns {object} 描述符骨架。
 */
function invocation(method) {
  return {
    id: `dsh-session-handoff#sessionHandoff/${method}`,
    service: 'sessionHandoff',
    namespace: 'sessionHandoff',
    method,
    invocation: { kind: 'direct' },
  }
}

/**
 * 可选入参描述符。
 *
 * ⚠️ **必须带 `acceptsUndefined: true`**（2026-10-12 代码审查 P1-2）：
 *   客户端网关对 `undefined` 参数**不上线**（`dsh-api-gateway/lib/client.js:1837`
 *   的 `if (value !== void 0) args[parameter.wire] = value`），而宿主
 *   `assertExactArguments`（`dsh-api-gateway/lib/index.js:1497-1508`）只在
 *   `parameter.acceptsUndefined === true`（或 codec.mode === 'src-json'）时放行缺席。
 *   少了它，调用方按签名省略该参数 → `missing "<wire>"` → `gateway/arguments-invalid`。
 *   本插件的 codec 全是 strict，所以这条是唯一放行途径。
 *
 * @param {string} name - 参数名（与 wire 同名）。
 * @param {{parse: Function}} codec - 严格 codec（其 schema 用 `optional(...)` 包过）。
 * @returns {object} 参数描述符。
 */
function optionalParameter(name, codec) {
  return { name, wire: name, source: 'json', codec, acceptsUndefined: true }
}

/** 宿主面 Typert 清单。 */
export const TYPERT = {
  package: 'dsh-session-handoff',
  face: 'host',
  schemas: [],
  invocations: [
    {
      ...invocation('stats'),
      parameters: [
        optionalParameter('sessionIds', _sessionIds$codec),
        optionalParameter('decisionLimit', _limit$codec),
        optionalParameter('decisionFilter', _filter$codec),
      ],
      result: _stats$codec,
    },
    {
      ...invocation('updateConfig'),
      parameters: [
        { name: 'patch', wire: 'patch', source: 'json', codec: _patch$codec },
      ],
      result: _update$codec,
    },
    {
      ...invocation('handoffNow'),
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec },
        optionalParameter('source', _filter$codec),
        // R4：唯一新增的可选第三参（留言 + 技能引用）；出参形状不变（PK-030 / 严格 codec）。
        optionalParameter('options', _manualOptions$codec),
      ],
      result: _handoff$codec,
    },
    {
      ...invocation('cancelPending'),
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec },
      ],
      result: _handoff$codec,
    },
    {
      ...invocation('confirm'),
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec },
        optionalParameter('reason', _reason$codec),
        optionalParameter('detail', _detail$codec),
      ],
      result: _confirm$codec,
    },
    {
      ...invocation('readHandoffDoc'),
      parameters: [
        optionalParameter('name', _name$codec),
        optionalParameter('read', _read$codec),
      ],
      result: _doc$codec,
    },
    {
      ...invocation('listHandoffDocs'),
      parameters: [],
      result: _docList$codec,
    },
    {
      // 设置页的模型目录（无入参）。返回**裸目录**（信封由网关加）；内部出错则 throw。
      ...invocation('listModelCatalog'),
      parameters: [],
      result: _modelCatalog$codec,
    },
    {
      // 设置页的权限档位目录（无入参）。没启用沙箱的部署返回 supported:false（裸值）。
      ...invocation('listPermissionPresets'),
      parameters: [],
      result: _permissionPresets$codec,
    },
    {
      ...invocation('listSkills'),
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: _sessionId$codec },
      ],
      result: _skillList$codec,
    },
  ],
  model: {
    services: [
      {
        description: '会话接力（硬切）服务：健康度读侧、手工换会话、配置读写、交接文档与决策日志。Session handoff service: health reads, manual handoff, config write, docs and decision log.',
        summary: '会话接力服务 (session handoff service)。',
        tags: [],
        jsDoc: '/** 会话接力（硬切）服务：客户端经 remote.sessionHandoff.* 调用。 */',
        key: 'sessionHandoff',
        exportName: 'SessionHandoffService',
        members: [
          {
            kind: 'method',
            name: 'stats',
            signature: 'stats(sessionIds?: string[], decisionLimit?: number, decisionFilter?: string): Promise<SessionHandoffStats>',
            summary: '读当前配置 + 一批会话的健康度行 + 交接文档目录 + 决策日志。Read config, health rows, doc dir and decision log.',
            jsDoc: '/** 客户端健康度行与设置页共用的读侧。 */',
          },
          {
            kind: 'method',
            name: 'updateConfig',
            signature: 'updateConfig(patch: SessionHandoffConfigPatch): Promise<SessionHandoffUpdateResult>',
            summary: '校验并持久化一条设置补丁（只接受界面可改的键）。Validate and persist one settings patch.',
            jsDoc: '/** 设置页的写侧；先校验、再落盘、最后生效。 */',
          },
          {
            kind: 'method',
            name: 'handoffNow',
            signature: 'handoffNow(sessionId: string, source?: string, options?: SessionHandoffManualOptions): Promise<SessionHandoffResult>',
            summary: '手工换会话（优先级最高，唯一底线是安全点）。Manual handoff; the only limit is the safe point.',
            jsDoc: '/** 手工硬切；不在安全点则挂起，等下一个步骤边界。 */',
          },
          {
            kind: 'method',
            name: 'cancelPending',
            signature: 'cancelPending(sessionId: string): Promise<SessionHandoffResult>',
            summary: '取消排队中的手工换会话请求。Cancel a queued manual handoff.',
            jsDoc: '/** 取消排队中的手工请求。 */',
          },
          {
            kind: 'method',
            name: 'confirm',
            signature: 'confirm(sessionId: string, reason?: string, detail?: string): Promise<SessionHandoffConfirmResult>',
            summary: '弹宿主原生问答弹窗确认是否换会话（带自传超时）。Ask the host user-questions dialog whether to hand off.',
            jsDoc: '/** 换会话确认卡片；复用原生问答弹窗，自传超时 AbortSignal。 */',
          },
          {
            kind: 'method',
            name: 'readHandoffDoc',
            signature: 'readHandoffDoc(name?: string, read?: boolean): Promise<SessionHandoffDoc>',
            summary: '读最近一份（或指定）交接文档。Read the latest (or a named) handoff document.',
            jsDoc: '/** 交接文档查看入口（S1「查看已有交接文档」）。 */',
          },
          {
            kind: 'method',
            name: 'listHandoffDocs',
            signature: 'listHandoffDocs(): Promise<SessionHandoffDocList>',
            summary: '列交接文档目录。List the handoff document directory.',
            jsDoc: '/** 交接文档目录（不读内容，只列文件名/大小/时间）。 */',
          },
          {
            kind: 'method',
            name: 'listModelCatalog',
            signature: 'listModelCatalog(): Promise<SessionHandoffModelCatalog>',
            summary: '列宿主可路由的模型与各模型支持的思考强度（设置页选新会话模型用）。List routable models and their reasoning efforts.',
            jsDoc: '/** 模型目录（裸值）；内部出错抛 Error，由网关翻成 {ok:false,error}。 */',
          },
          {
            kind: 'method',
            name: 'listPermissionPresets',
            signature: 'listPermissionPresets(): Promise<SessionHandoffPermissionPresets>',
            summary: '列权限档位；未启用沙箱的部署返回 supported:false。List permission presets; unsupported environments report supported:false.',
            jsDoc: '/** 权限档位目录；服务缺失时 supported:false + 人话原因。 */',
          },
          {
            kind: 'method',
            name: 'listSkills',
            signature: 'listSkills(sessionId: string): Promise<SessionHandoffSkillList>',
            summary: '列当前会话可用的技能（手动换会话卡片的技能面板用；裸值，失败抛错）。List the session skill catalog for the manual handoff card.',
            jsDoc: '/** R4：host 代理内核 skills/list（不激活 Agent 的元数据读取路径）。 */',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
