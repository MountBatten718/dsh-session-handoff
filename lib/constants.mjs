/** dsh-session-handoff 常量：命令名、插件名、默认配置与边界（协议常量，不可配置）。 */

export const PLUGIN_NAME = 'dsh-session-handoff'

export const COMMAND_NAME = 'handoff'

export const SESSION_EVENT_INJECT = 'user/message'

export const DEFAULTS = {
  ENABLED: true,
  TURNS: 50,
  MAX_INPUT_CHARS: 200000,
  // ⚠️ 8000 而不是 4000（2026-10-14 黑匣子实测定案）：
  //    推理模型会先把输出预算花在**思考**上，再写正文。4000 这个预算在两处都翻过车：
  //    ① 10-12 那次"成功"，正文 chars=4095 —— 其实是被 maxTokens 从中间**截断**的；
  //    ② 10-14 两次尝试 finish=max-tokens / chars=0（37s + 40s 全白烧），
  //       思考把预算吃光，一个字正文都没写出来，整篇交接文档降级成结构化拼装。
  //    8000 = LIMITS.MAX_MAX_TOKENS，是内核允许的上限，一次把正文的空间留够。
  MAX_TOKENS: 8000,
  TIMEOUT_MS: 120000,
  // ⚠️ 默认必须 inherit：opencode-go/deepseek-v4.1-flash **不支持 "off"**，
  //    传了会被直接拒绝（2026-10-12 黑匣子实测：`does not support reasoning effort "off"`）。
  //    inherit = 不传该字段，跟随会话/适配器默认。
  REASONING_EFFORT: 'inherit',
  // —— 2026-10-14 v1.2 新增（默认值字面量**只在这里出现一次**，handoff-config.mjs 只引用）——
  /** R1：新会话读完交接文档先给计划、等确认再动手（默认开）。 */
  CHILD_PLAN_FIRST: true,
  /** R2：硬切前等子代理交卷的最长时间（分钟，整数 1–60，默认 10）。 */
  SUBAGENT_DRAIN_TIMEOUT_MIN: 10,
}

/**
 * 交接文档的 5 个固定小节标题（**单一来源**）。
 *
 * host 的 `handoff-doc.mjs` 用它构造 `HANDOFF_DOC_SECTIONS`；客户端画"卡片内文档预览"
 * 也要用它（R4 补 task-27），不能两边各抄一份。顺序即文档顺序（冻结口径）。
 */
export const HANDOFF_DOC_SECTION_TITLES = Object.freeze([
  '用户需求',
  '方案梗概',
  '已完成',
  '涉及文件与产物',
  '接下来做什么',
])

/** 摘要调用的思考强度：inherit＝不传该字段、跟随会话/适配器（**默认**）；off 关闭思考（不是所有模型都支持）；high/max 开思考。 */
export const REASONING_EFFORTS = ['off', 'high', 'max', 'inherit']

/**
 * R4（2026-10-17）手动换会话卡片的**逐字文案**与限长。
 *
 * ⚠️ 清单 §3.7：中文文案统一放常量，禁止散落硬编码；客户端与 host 同源 import。
 * ⚠️ 这里每个字符串都是**口径清单 §1 的逐字口径**，改一个字都是改需求。
 */
export const R4_TEXTS = Object.freeze({
  CARD_TITLE: '要现在换会话吗？',
  NOTE_LABEL: '给下一个会话留一句话',
  NOTE_HINT: '可选。会原封不动写进交接文档，下一个会话第一眼就能看到。',
  NOTE_PLACEHOLDER: '例：先别动界面，先把测试跑通；我明天上午继续。',
  /** 字数计数模板：`已输入 N / 500`（N 由调用方填）。 */
  NOTE_COUNT_TEMPLATE: '已输入 {n} / {max}',
  NOTE_EMPTY_HINT: '留空也行，只是交接文档里不会有「交接人留言」这一节。',
  SKILL_BUTTON: '技能',
  SKILL_PANEL_HINT: '选中即插入 /技能名，发送时由 Harness 注入该技能内容。',
  SKILL_SEARCH_PLACEHOLDER: '搜索技能',
  SKILL_GROUP_LOCAL: '本地安装',
  SKILL_GROUP_MARKET: '市场安装',
  SKILL_EMPTY: '没有找到可用的技能',
  CONFIRM: '换会话',
  CANCEL: '取消',
  /** R4 补（task-27）：卡片内「交接文档预览」区（原型 #qcardDetail）。 */
  PREVIEW_SUMMARY: '看看要交给新会话的交接文档',
  /** 小节数提示模板：`{n} 个小节 · 默认收起`（原型 `8 个 / 9 个` 随留言联动）。 */
  PREVIEW_HINT_TEMPLATE: '{n} 个小节 · 默认收起',
  /** 预览列表最上面那条（仅当有留言时出现）。 */
  PREVIEW_NOTE_ITEM: '0. 交接人留言',
})

/**
 * R4 **工程提示语**（非逐字口径：错误态/加载态内部文案，不属口径清单 §1）。
 * 单独放一组，避免与界面冻结文案 `R4_TEXTS` 混在一起被误当逐字口径。
 */
export const R4_HINTS = Object.freeze({
  /** 技能面板加载中。 */
  SKILL_LOADING: '正在读取技能…',
  /** 技能目录读取失败的前缀（后面接错误原因）。 */
  SKILL_LIST_FAILED: '读不到技能目录：',
  /** 留言已到 500 码点，点技能插不进去。 */
  NOTE_FULL: '留言已满 500 字，插不进去了',
  /** 宿主版本较旧、没有 listSkills 端点。 */
  LIST_SKILLS_UNSUPPORTED: '宿主版本较旧，没有 listSkills 这个方法',
})

/**
 * R6（2026-10-20 止血）子代理会话禁止手动接力 —— **逐字冻结文案**（维护者决定）。
 * 注意：判据只用于"手工路径漏掉的那道守卫"，自动路径既有守卫不动。
 */
export const SUBAGENT_TEXTS = Object.freeze({
  /** 客户端按钮悬停/禁用原因（逐字）。 */
  DISABLED_HINT: '子代理会话不参与会话接力，请在主会话里操作。',
  /** 宿主拒绝时的 throw 文案（逐字，防绕过）。 */
  REJECT: '子代理会话不能接力：请在主会话里操作。',
})

/** R5 运行期兜底文案（非逐字需求口径；与 R4_TEXTS 分开）。 */
export const R5_HINTS = Object.freeze({
  /** 客户端 useStats 超时后的可解释失败态模板（`{sec}` 秒数）。 */
  CLIENT_STATS_TIMEOUT_TEMPLATE: '{sec} 秒内没读出来会话用量，可能是宿主端某个服务没响应；点「重试」再试一次。',
  /** host 侧 stats 降级时记进 `stats().errors` 的说明模板（`{sec}` 秒数）。 */
  HOST_STATS_TIMEOUT_TEMPLATE: '读取会话用量超时（{sec} 秒内没返回），已降级：该会话这一行暂时不可用；点「重试」可再试',
})

/**
 * host 侧 `stats()` 的有界等待（毫秒）：超过就降级返回（rows 为空 + errors 记一条），
 * 绝不让"某个宿主服务对子会话不返回"把客户端永久挂在「正在读取会话用量…」。
 */
export const HOST_STATS_TIMEOUT_MS = 3000

/**
 * 客户端 `useStats` 的兜底超时（毫秒）。
 * 必须 **> HOST_STATS_TIMEOUT_MS**（正常路径永远是 host 先降级返回，客户端这条是最后一道保险）。
 */
export const CLIENT_STATS_TIMEOUT_MS = 8000

/** R4 限长：留言最大码点数（清单 §1「已输入 N / 500」）。 */
export const MAX_NOTE_CHARS = 500

/** R4 限长：技能引用最多条数（防体量失控，M1 §12.8 R4-5）。 */
export const MAX_SKILL_REFS = 50

/** R4 限长：单条技能引用最大码点数。 */
export const MAX_SKILL_REF_CHARS = 200

export const LIMITS = {
  MIN_TURNS: 1,
  MAX_TURNS: 200,
  MIN_MAX_INPUT_CHARS: 1000,
  MAX_MAX_INPUT_CHARS: 200000,
  MIN_MAX_TOKENS: 100,
  MAX_MAX_TOKENS: 8000,
  MIN_TIMEOUT_MS: 5000,
  MAX_TIMEOUT_MS: 600000,
}
