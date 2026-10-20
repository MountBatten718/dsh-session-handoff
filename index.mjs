// index.mjs — dsh-session-handoff 插件入口（host 面唯一入口；纯 ESM，零构建）。
//
// 本文件现在承载两件事：
//
// A) 【本块交付 · 会话硬切骨架】三档自动硬切
//    ① 替代模式 replace：上下文到「原生生效阈值 × 0.98」就换会话（抢跑，不关原生压缩，§十八）
//    ② 混合模式 hybrid（默认）：会话体积 ≥ 阈值 或 自上次换会话以来压缩次数 ≥ N 时换会话（§十七 17.3）
//    ③ 原生模式 native：不执行任何自动换会话
//    挂点：agent/pre-step waterfall（步骤边界 = 安全点，G2 §3）
//    两个可测指标：上下文占比（tokenMeter ÷ 生效窗口）、会话体积（字节，自算）
//    对外服务：ctx.provide('sessionHandoff', { status, handoffNow, cancelPending })
//       —— 手工硬切优先级最高（§13.4），唯一底线是安全点。
//
// B) 【上游蓝本 · 原样保留】/handoff 命令
//    手工把当前会话交接给一个干净的新会话：LLM 摘要 → 建新会话 → 注入文档。
//
// 只消费公开服务：sessions / commands / llm / agents（inject 声明）；
// tokenMeter / sessionProjections / sessionTitle / workspaceRegistry / agentPresets
// 一律用 ctx.get() 可选查找。

import { randomUUID } from 'node:crypto'
// ⛔ 顶层不得 import 任何 '@deepseek-ai/*'（会让插件启用失败）——见下方 Config 处的说明。
import { createUserMessage } from './lib/dsh-llm-bridge.mjs'
import { COMMAND_NAME, DEFAULTS, LIMITS, PLUGIN_NAME, REASONING_EFFORTS, SESSION_EVENT_INJECT } from './lib/constants.mjs'
import { KNOWN_CONFIG_KEYS, resolveConfig, validateConfigKeys } from './lib/handoff-config.mjs'
import { HANDOFF_NARRATIVE_PROMPT, buildHandoffFacts, formatTurnOutline } from './lib/handoff-doc.mjs'
import { docFileName, persistHandoffDoc, resolveDocDir } from './lib/handoff-docs.mjs'
import { createConfigPersist, createConfigStore } from './lib/handoff-store.mjs'
import { createHandoffController, SERVICE_NAME } from './lib/handoff-controller.mjs'
import { createHealthReporter } from './lib/handoff-report.mjs'
import { createRpcService } from './lib/handoff-rpc.mjs'
import { composeForPreset, resolveRoute } from './lib/handoff-exec.mjs'
import { generateSummary } from './lib/llm.mjs'
import { composeHandoffDoc, extractRecentMessages, parseHandoffArgs } from './lib/summary.mjs'
import { EVENTS_UNAVAILABLE_REASON, sessionEvents } from './lib/session-events.mjs'
import { withAbortTimeout } from './lib/timeout.mjs'

export const name = PLUGIN_NAME

/**
 * 必需服务：缺失即加载失败（响亮）。
 *
 * 本块新增 `userQuestions`：它**必须**在这里声明，理由是 M2 §一 S1 的"弹窗确认"
 * 直接依赖它；少了它，"到点弹窗"这条路径会静默退化成"静默执行"，
 * 那正是需求 P0-7 不允许的行为（宁可在加载期响亮失败，也不做用户没选的自动换会话）。
 * 其余服务（`typert` / `configEditor` / `tokenMeter` / `sessionProjections` / `workspaceRegistry` …）
 * 一律用 `ctx.get()` 可选查找。
 */
export const inject = ['sessions', 'commands', 'llm', 'agents', 'userQuestions']

// ⛔ 曾经这里导出 `Config = Schema.object({...})`（来自 `@deepseek-ai/schemastery`）。
//
// 2026-10-10 实机结论：**插件顶层一旦 import 任何 `@deepseek-ai/*`，整个插件就启用失败**
// （宿主报 `failed to import` / `ERR_MODULE_NOT_FOUND`）。本机两个能正常启用的插件
// （`dsh-market-launcher`、`dsh-skill-center`）**一个内核包都不 import**。
// 详见 lib/dsh-llm-bridge.mjs 顶部的完整排查记录。
//
// 因此这里**不再导出 Config**。配置的默认值、边界与未知键拒绝，全部由本插件自己的
// `lib/handoff-config.mjs`（`resolveConfig` / `validateConfigKeys` / `HANDOFF_DEFAULTS`）
// 承担——它们本来就比 schemastery 声明更严格（未知键显式拒绝）。`apply(ctx, config)`
// 收到的原始 config 会先过 `resolveConfig`，行为与之前一致。

// 供宿主/测试直接使用的配置工具（实现在 lib/handoff-config.mjs）。
export { KNOWN_CONFIG_KEYS, resolveConfig, validateConfigKeys }

/** 取会话标题（无则为 undefined）。 */
function sessionTitleOf(session) {
  const title = session.header?.title
  return typeof title === 'string' && title.length > 0 ? title : undefined
}

// ⚠️ `composeForPreset` 已收敛到 `lib/handoff-exec.mjs`（唯一实现，2026-10-12 审查 P2-20）：
//    原先这里和 exec 各抄了一份一模一样的，会各自漂移。命令路径直接复用那一份。

/**
 * 插件挂载。
 * - enabled:false → 什么都不注册（连服务都不 provide，等于没装）。
 * - 非法配置在加载期响亮抛错（含未知键）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {Partial<ReturnType<typeof resolveConfig>>} [config] - 插件配置。
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const logger = ctx.logger(PLUGIN_NAME)
  if (resolved.enabled === false) {
    logger.info('session-handoff: disabled by config; no hooks registered')
    return
  }

  // 启动自检（2026-10-13）：见 `lib/boot-log.mjs` 的说明 —— 让"DSH 到底加载了哪一版、
  // 模型目录为什么读不到"留下硬证据，而不是靠猜。只写插件自己的文档目录，任何失败都静默。
  void (async () => {
    try {
      const { probeBoot, appendBootLog } = await import('./lib/boot-log.mjs')
      const record = await probeBoot(ctx)
      await appendBootLog(resolveDocDir({ configuredDir: resolved.handoffDocDir }).dir, record)
      logger.info(`session-handoff: boot ${JSON.stringify(record)}`)
    } catch {
      // 自检失败绝不能影响插件本身。
    }
  })()

  /**
   * 交接文档落盘（2026-10-12 代码审查 P1-1 接线）。
   *
   * 审查发现：`persistHandoffDoc` 早就写好了，但**生产代码零调用点** ——
   * 设置页那个"交接文档落盘"开关、以及"查看已有交接文档"入口，实际都是空的。
   * 这里把它接上：开关 `handoffDocPersist`（默认开）、目录 `handoffDocDir`（空 = DSH 数据目录）。
   *
   * ⚠️ 引用的 `live` 在下方才声明；本函数只在命令/硬切真正执行时被调用，届时已就绪。
   * 失败**绝不抛**：文档是给人看的副本，落盘失败不能影响接力本身。
   *
   * @param {{doc?: string, session?: object}} input - 文档正文与会话。
   * @returns {Promise<{ok: boolean, path?: string, error?: string, skipped?: boolean}>} 结果。
   */
  async function persistDoc({ doc, session }) {
    if (live.handoffDocPersist !== true) return { ok: false, skipped: true }
    if (typeof doc !== 'string' || doc.length === 0) return { ok: false, skipped: true }
    try {
      const resolvedDir = resolveDocDir({ configuredDir: live.handoffDocDir })
      if (resolvedDir.ignoredConfiguredDir !== undefined) {
        logger.warn(`handoff: handoffDocDir 必须是绝对路径，已忽略 ${JSON.stringify(resolvedDir.ignoredConfiguredDir)} 并回退到默认目录`)
      }
      const fileName = docFileName({ sessionId: session?.id, at: Date.now() })
      return await persistHandoffDoc({ dir: resolvedDir.dir, fileName, content: doc })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // B) 上游命令面：原样保留。
  ctx.commands.register({
    name: COMMAND_NAME,
    description: 'Summarize this session and continue in a fresh one: creates a new session in the same workspace with the LLM-generated handoff summary as its first message; the origin session is unchanged.',
    input: { hint: '[<N>|all] (default 8)' },
    async handler(invocation) {
      return handleHandoff(invocation, { ctx, logger, resolved, persistDoc })
    },
  })

  // A) 本块交付：运行期配置 + 三档自动硬切 + 手工硬切服务 + RPC（客户端半边用）。
  //
  // 配置走"稳定对象 + 就地更新"：`createConfigStore` 的 `config` 引用不变，
  // 设置页改完立刻生效，控制器不需要重建（也没有"要重启才生效"的假即时）。
  const configPersist = createConfigPersist({ ctx, pluginName: PLUGIN_NAME })
  const configStore = createConfigStore({
    initial: config,
    deps: configPersist === undefined ? {} : { persist: configPersist },
  })
  // ⚠️ 这里**刻意用 store 的对象**（而不是 resolveConfig 的产物）：
  // 两者字段一致，但 store 的那个会被就地更新，闭包住的引用永远读到最新值。
  const live = configStore.config
  // 把加载期解析出来的值灌进去（store 只认原始配置，这里是同一份语义）。
  Object.assign(live, resolved)

  const controller = createHandoffController({
    ctx,
    logger,
    config: live,
    deps: {
      createUserMessage,
      // 交接文档落盘（P1-1）：实现在本文件，自动/手工硬切与 /handoff 命令共用同一个。
      persistDoc,
      // 「以后都自动接力」→ 落盘 autoPromptLevel=auto。
      onAlwaysAuto: () => configStore.update({ autoPromptLevel: 'auto' }),
      // 交接文档的叙事部分：**用当前会话在用的主模型写**（route 由会话本身给出），
      // 一次 llm.stream 调用；失败由 performHandoff 兜住并降级为纯结构化文档（M1 §五）。
      // ⚠️ 必须尊重调用方传进来的 `config`（performHandoff 失败重试时会用更小的输入再试一次）。
      async narrate({ session, route, events, signal, config: narrativeConfig }) {
        const cfg = narrativeConfig ?? live
        // ⚠️ 不传会话原文（用户 2026-10-10 定调）：只把**会话自己的记忆**给模型——
        //    会话标题 + 原始需求（goal 用户原话）+ DSH 压缩摘要 + 待办快照 + 碰过的文件。
        const facts = buildHandoffFacts(events, { cwd: session.header?.cwd, title: session.header?.title })
        // 再加一层"逐轮记忆"（DSH 的 turnOutline 投影）：压缩摘要只覆盖被压掉的旧内容，
        // 它补上最近几轮。**仍然不含成段会话原文。**
        let turnMemory = ''
        try {
          const projections = ctx.get('sessionProjections')
          const outline = projections?.stateOf?.(session, 'turnOutline')
          const formatted = formatTurnOutline(outline)
          if (formatted.length > 0) turnMemory = `\n\n【逐轮记忆（DSH 投影：每轮"要什么/做了什么"）】\n${formatted}`
        } catch (error) {
          logger?.warn?.(`handoff: 读取 turnOutline 记忆失败（忽略）：${error instanceof Error ? error.message : String(error)}`)
        }
        const narrativeInput = `${facts}${turnMemory}`
        if (narrativeInput.length === 0) return undefined
        const summary = await withAbortTimeout((narrativeSignal) => generateSummary({
          llm: ctx.llm,
          session,
          route,
          items: [],
          config: {
            maxInputChars: cfg.maxInputChars,
            maxTokens: cfg.maxTokens,
            reasoningEffort: cfg.reasoningEffort,
            system: HANDOFF_NARRATIVE_PROMPT,
          },
          facts: narrativeInput,
          signal: narrativeSignal,
        }), {
          signal,
          timeoutMs: cfg.timeoutMs,
          label: 'handoff narrative model call',
        })
        return summary.text
      },
    },
  })
  controller.start()

  // 健康度报表器（客户端 S2 的数据源；tokenMeter / 投影只有宿主侧拿得到）。
  const reporter = createHealthReporter({
    get: (serviceName) => {
      try {
        return ctx.get(serviceName)
      } catch {
        return undefined
      }
    },
    configOf: () => live,
    ledgerOf: () => controller.internals.ledger,
    measure: (session) => controller.status(session.id).then((status) => ({
      usedTokens: status?.usedTokens,
      windowTokens: status?.windowTokens,
      windowSource: status?.windowSource,
      ratio: status?.ratio,
      // 量不到的原因（P1-6）：一路带到报表器的 errors 里，别再静默。
      ...(status?.error === undefined ? {} : { error: status.error }),
    })),
    decide: (session) => controller.decideAuto(session),
    chainIndexOf: (session) => controller.internals.chains.get(session.id)?.index ?? 1,
    handedOffOf: (session) => controller.internals.handedOff.has(session.id),
    // 接力失败要让用户看得见（复核 P2-7）：桌面版宿主日志拿不到，
    // 只能经报表器的 errors 走到客户端界面上。
    // R2：子代理收尾失败走**同一条**通道（§11.6），接力成功也不会被清掉（独立于 failures）。
    failuresOf: (sessionId) => controller.failureOf(sessionId) ?? controller.drainErrorOf?.(sessionId),
  })

  // RPC 服务：客户端经 `remote.sessionHandoff.*` 调用（清单见 lib/typert.host.mjs）。
  const rpc = createRpcService({ ctx, controller, configStore, reporter })
  // ⚠️ 服务对象**必须是同一个**：网关校验 `binding.service === 服务实例`
  //    （`dsh-api-gateway/lib/index.js:1450-1452`），一旦换成另一个包裹对象就 binding-invalid。
  //    所以这里**就地**给 RPC 服务补上"同进程插件用"的方法，然后整体 provide 出去。
  // ⚠️ `handoffNow` / `cancelPending` **同时是 typert RPC 端点**，覆盖时必须保留
  //    `handoff-rpc.mjs` 的归一化（`normalizeHandoffResult`）。宿主与客户端的编解码是
  //    **严格**的：多一个键报 `unexpected key`、少一个键报 `missing key`。
  //
  //    2026-10-10 实机事故：这里原来直接塞控制器原始结果 → 成功结果多了 `sessionId`、
  //    失败/排队结果还缺 `childSessionId` → 响应校验失败 → 客户端拿不到任何结果
  //    （`src/client/index.ts` 的 `await remote.handoffNow(...)` 没有 try/catch，
  //    busy 永远卡在"处理中…"）→ 用户看到的就是**按钮点了没反应**。
  const rpcHandoffNow = rpc.handoffNow.bind(rpc)
  const rpcCancelPending = rpc.cancelPending.bind(rpc)
  Object.assign(rpc, {
    status: (sessionId) => controller.status(sessionId),
    /** 同进程插件用对象调用（`handoffNow({ sessionId })`），RPC 用位置参数调用，两种签名都要支持。 */
    handoffNow: (request) => (request !== null && typeof request === 'object'
      ? rpcHandoffNow(request.sessionId, request.source)
      : rpcHandoffNow(request)),
    cancelPending: (request) => rpcCancelPending(request !== null && typeof request === 'object' ? request.sessionId : request),
    mode: () => live.autoMode,
    promptLevel: () => live.autoPromptLevel,
    decisions: (options) => controller.decisions.list(options),
    docDir: () => rpc.listHandoffDocs().then((result) => result.dir),
    /** 供设置页/测试直接读的配置快照。 */
    config: () => configStore.config,
  })
  ctx.provide(SERVICE_NAME, rpc)

  // 端点自检（2026-10-14）：**真的调用一次** `listModelCatalog`，把它的真实返回写进启动日志。
  // 为什么必须"真调用"：boot-log 里那段读取逻辑是我**另写**的一遍，它成功**不代表端点成功**。
  //
  // ⚠️ 2026-10-14 二次加固（PK-028「诊断要一次做够」）：只记端点自己的返回值**还不够**，
  //    从端点返回到客户端之间还隔着**网关的出参编码**（`codec.encode`，见 lib/typert.host.mjs）。
  //    所以这里把同一份结果**按网关的出口口径真编码一次**，记下"过没过 / 编码后多大"。
  //    三样凑齐（读到了什么 / 端点返回什么 / 线上能不能过），一次重启就能定性，不用再挤牙膏。
  //
  // ⚠️ 2026-10-14 追加（PK-030）：这一行现在**必须**是"裸目录"形态（`groups` 直接在顶层）。
  //    上一版记录里的 `ok:true` 是宿主服务自己包的信封 —— 那正是真机下拉为空的根因。
  void (async () => {
    try {
      let probe
      let endpointError
      try {
        // 契约：`listModelCatalog()` 返回**裸目录**，出错才 throw（见 lib/handoff-rpc.mjs 的说明）。
        probe = await rpc.listModelCatalog()
      } catch (error) {
        endpointError = String(error?.message ?? error)
      }
      /** 网关出口口径的编码结果：`{ok, bytes}` 或 `{ok:false, error}`。 */
      let wire
      try {
        const { TYPERT } = await import('./lib/typert.host.mjs')
        // ⚠️ 必须拿**清单里的 codec 对象本身**（它有 `encode`）；`codec.create()` 返回的是
        //    只有 `parse` 的 schema —— 2026-10-14 首版就踩了这个坑，自检写出
        //    `wireOk:false / codec.encode is not a function` 的**假警报**，差点又误判一条方向。
        //    网关走的正是 `codec.encode(value, writeBytes)`（见 lib/typert.host.mjs）。
        const codec = TYPERT.invocations
          .find((entry) => entry.method === 'listModelCatalog')
          ?.result
        wire = typeof codec?.encode !== 'function'
          ? { ok: null, error: 'no-codec' }
          : { ok: true, bytes: JSON.stringify(codec.encode(probe)).length }
      } catch (error) {
        // 这里失败＝网关一定会把整条响应判成 result-invalid（客户端只能看到错误）。
        wire = { ok: false, error: String(error?.message ?? error) }
      }
      const { appendBootLog } = await import('./lib/boot-log.mjs')
      await appendBootLog(resolveDocDir({ configuredDir: resolved.handoffDocDir }).dir, {
        at: new Date().toISOString(),
        endpoint: 'listModelCatalog',
        ok: probe !== undefined,
        groups: probe === undefined ? undefined : probe.groups.map((group) => `${group.id}:${group.models.length}`),
        failures: probe === undefined ? undefined : probe.failures.map((failure) => `${failure.id}:${failure.message}`),
        diagnosis: probe !== undefined && typeof probe.diagnosis === 'string' ? probe.diagnosis : undefined,
        error: endpointError,
        wireOk: wire.ok,
        wireBytes: wire.bytes,
        wireError: wire.error,
      })
    } catch {
      // 自检失败不影响插件。
    }
  })()

  // 清单注册：**完全交给宿主的 typert-loader**。
  //
  // ⛔ 不要在这里自己再注册一次。宿主 `dsh-typert-loader` 的 `processOne()` 会对任何
  //    「loader 条目 + 包导出 `./typert`」的插件自动注册（`dsh-typert-loader/lib/index.js:280-303`），
  //    而它的注册是**异步**的（`loadManifest(...).then(...)`）。我们自己再注册一次会形成竞态：
  //    谁后到谁撞 `typert: package face "<pkg>#host" is already registered`，
  //    且这个错误是从 **loader 内部**抛出的，我们这边的 try/catch 根本拦不住。
  //
  // 实机证据（2026-09-28，DSH Desktop 2.0.15）：
  //   [I] [dsh-session-handoff] session-handoff: autoMode=hybrid, …      ← 宿主半边加载成功
  //   [E] [typert-loader] Error: package face "dsh-session-handoff#host" is already registered
  //   ⇒ RPC 面建不起来 ⇒ 客户端拿不到 remote.sessionHandoff ⇒ 界面全空
  //
  // 原先那句"file:// 直挂会漏、照 dsh-cost-meter 补一条兜底"的判断在本插件场景下是错的：
  // 本插件是**组合包**（列在 profile 的 `dsh.profile.bundles` 里），loader 必然 qualifying，
  // 兜底注册纯属多余且有害。
  ctx.inject(['typert'], () => {
    // 保留 inject 是为了让宿主 typert 面在挂载前就绪；注册动作交给 loader。
  })

  logger.info(`session-handoff: autoMode=${live.autoMode}, autoPromptLevel=${live.autoPromptLevel}, sessionVolumeBytes=${live.sessionVolumeBytes}, compactionCountTrigger=${String(live.compactionCountTrigger)}`)
}

/**
 * /handoff 命令处理器（上游蓝本逻辑，未改动）。
 * @param {import('@deepseek-ai/dsh-commands').CommandInvocation} invocation - 命令调用。
 * @param {{ctx: object, logger: object, resolved: object, persistDoc?: Function}} env - 执行环境。
 * @returns {Promise<import('@deepseek-ai/dsh-commands').CommandResult>} 命令结果。
 */
async function handleHandoff(invocation, { ctx, logger, resolved, persistDoc }) {
  const { agent, rawInput, signal } = invocation
  const session = agent?.session
  if (session === null || session === undefined) {
    return { kind: 'error', text: 'handoff: no active session' }
  }
  const args = parseHandoffArgs(rawInput, resolved.turns, { min: LIMITS.MIN_TURNS, max: LIMITS.MAX_TURNS })
  if (args.invalid !== undefined) return { kind: 'error', text: args.invalid }

  // ⚠️ 事件只能走 sessionEvents()（宿主 Session 没有 `.events` 属性）——
  //    直读 `session.events` 会拿到 undefined 并在这里抛 `events is not iterable`（2026-10-10 实测）。
  const events = sessionEvents(session)
  if (events === undefined) {
    logger.error(`handoff aborted: ${EVENTS_UNAVAILABLE_REASON}`)
    return { kind: 'error', text: `handoff: ${EVENTS_UNAVAILABLE_REASON}` }
  }
  const recent = extractRecentMessages(events, { turns: args.turns })
  if (recent.userCount === 0) {
    return { kind: 'error', text: 'handoff: no user messages to summarize yet (send a message first)' }
  }

  const route = resolveRoute(session, resolved)
  if (route === undefined) {
    return {
      kind: 'error',
      text: 'handoff: no model route available. Send a message in this session first, or configure provider and model for dsh-session-handoff in the plugin settings.',
    }
  }

  // 1) 总结：失败即报错，不创建会话（无副作用）。
  let summary
  try {
    summary = await withAbortTimeout((summarySignal) => generateSummary({
      llm: ctx.llm,
      session,
      route,
      items: recent.items,
      config: {
        maxInputChars: resolved.maxInputChars,
        maxTokens: resolved.maxTokens,
        reasoningEffort: resolved.reasoningEffort,
      },
      signal: summarySignal,
    }), {
      signal,
      timeoutMs: resolved.timeoutMs,
      label: 'summary model call',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`handoff summary failed: ${message}`)
    return { kind: 'error', text: message.startsWith('handoff: ') ? message : `handoff: ${message}` }
  }

  // 2) 新会话 + agent：同工作区全新会话（不复制历史；fork 才会复制）。
  //    必须经 ctx.agents.create 把会话与 agent 一起建：只建裸会话会导致客户端
  //    打开时走 agent resume、撞上"cannot prepare while it is live"。setup 挂载
  //    原会话的 agent preset，让子会话拥有相同的系统提示/工具/技能组成。
  let child
  let childSessionId
  try {
    childSessionId = `session-${randomUUID()}`
    const composition = await composeForPreset(ctx, session.header?.agentPreset)
    const handle = await ctx.agents.create({
      sessionId: childSessionId,
      agentOptions: { provider: route.provider, model: route.model },
      meta: {
        ...(session.header?.cwd !== undefined ? { cwd: session.header.cwd } : {}),
        parentSession: session.id,
        ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
      },
      setup: composition.setup,
    })
    child = handle.agent.session
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`handoff session create failed: ${message}`)
    return { kind: 'error', text: `handoff: failed to create the new session (${message})` }
  }

  // 2.5) 工作区挂载：workspace registry 只在启动时索引 live 会话，新建会话
  //     必须显式 attach，否则落到"未分组"直到下次重启。失败仅告警。
  try {
    const registry = ctx.get('workspaceRegistry')
    const cwd = session.header?.cwd
    if (registry !== undefined && typeof cwd === 'string' && cwd.length > 0) {
      const workspace = await registry.create(cwd)
      await workspace.attachSession(childSessionId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`handoff workspace attach failed (session ${childSessionId} stays ungrouped until restart): ${message}`)
  }

  // 2.6) 子会话标题：pin 一个可辨识的标题（sessionTitle 服务可选，失败仅告警）。
  try {
    const titles = ctx.get('sessionTitle')
    if (titles !== undefined) {
      const sourceTitle = sessionTitleOf(session)
      // ⚠️ 必须 await（2026-10-12 审查 P2-21）：`rename` 是异步的，不 await 时
      //    这个 try/catch 抓不到它的失败，会变成未处理的 rejection；
      //    而且下一句"新会话没事件就算失败"的守卫可能跑在标题真正落盘之前。
      await titles.rename(child, sourceTitle === undefined ? 'handoff: 会话交接' : `handoff: ${sourceTitle}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`handoff child title rename failed (session ${childSessionId}): ${message}`)
  }

  // 3) 注入交接文档为新会话首条消息（user/message，自建 source kind，落日志）。
  //    这条路径**故意不唤醒**新会话（用户自己从侧边栏打开），所以必须自己 append；
  //    自动/手工硬切那条路径要立即唤醒，走 followup 就不能再 append（PK-009）。
  const doc = composeHandoffDoc({ sourceId: session.id, sourceTitle: sessionTitleOf(session), summary: summary.text })
  try {
    child.append(SESSION_EVENT_INJECT, createUserMessage({
      content: [{ type: 'text', text: doc }],
      source: { kind: 'handoff' },
    }), { surfaceOp: 'append' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`handoff notice injection failed: ${message}`)
    return {
      kind: 'error',
      text: `handoff: created session ${child.id} but failed to inject the summary (${message}); the new session is empty.`,
    }
  }

  // 3.5) 交接文档落盘（P1-1；失败只告警，不影响已经建好的新会话）。
  let savedPath
  if (typeof persistDoc === 'function') {
    const saved = await persistDoc({ doc, session })
    if (saved?.ok === true) savedPath = saved.path
    else if (saved?.skipped !== true) logger.warn(`handoff doc persist failed: ${String(saved?.error ?? 'unknown')}`)
  }

  logger.info(`handoff ok: session ${session.id} → new session ${child.id} (${recent.userCount} user message(s) summarized)${savedPath === undefined ? '' : `, doc saved to ${savedPath}`}`)
  const scope = args.turns === 'all'
    ? `all ${recent.userCount} user message(s)`
    : `the last ${recent.userCount} user message(s)`
  const dropNote = summary.dropped > 0
    ? ` (${summary.dropped} earlier message(s) omitted to fit maxInputChars ${resolved.maxInputChars})`
    : ''
  return {
    kind: 'success',
    text: [
      `handoff: created a fresh session \`${child.id}\` in this workspace with a summary of ${scope}${dropNote}.`,
      `Open \`${child.id}\` from the sidebar to continue the task (the origin session \`${session.id}\` is unchanged).`,
    ].join('\n'),
  }
}
