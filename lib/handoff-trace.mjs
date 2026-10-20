// 硬切"黑匣子"：把每次硬切的关键阶段按行追加到 JSONL，便于事后定位。
//
// 为什么需要它（2026-10-10 实机事故）：
//   桌面版 DSH 的宿主日志在磁盘上拿不到（`~/Library/Logs` 下只有崩溃日志），
//   一旦硬切"看起来成功但什么都没发生"，从外部完全无从查起——只能靠猜。
//   本模块把**每次硬切的阶段与结果**写进插件自己的目录，诊断时直接读文件即可。
//
// 纪律：黑匣子**永远不许影响硬切本身**——任何写盘失败都必须被吞掉。
//
// ⚠️ 为什么不记长文本（P2-2，2026-10-12 独立复核）：
//   调用点曾把整份交接文档（`result.doc`，含**用户需求原话、文件路径**）直接 push 进来，
//   实测 `~/.dsh/session-handoff-docs/handoff-trace.jsonl` 22 条记录就涨到 125 KB。
//   黑匣子的用途是**故障定位**，需要的是阶段名、错误消息、路由、耗时、id 这类
//   短元数据；文档正文属于**用户隐私**，一旦落盘就没有回收途径。
//   因此 `push()` **统一递归脱敏**（不改调用点，避免漏改）：
//     单个字符串长度 > `MAX_FIELD_CHARS`（**200 字符**）就替换为 `[omitted N chars]`。
//   选 200 的原因：真实诊断字段里最长的是错误消息/路径，基本在 120 字符内；
//   而交接文档正文有几 KB，200 能一刀切开两者，且不需要维护字段白名单。
//
// ⚠️ 为什么要有大小上限与轮转（P2-1）：
//   黑匣子只增不减会无限膨胀（进程反复硬切时尤其明显）。`flush()` 写盘前先看目标
//   文件大小，超过 `MAX_TRACE_BYTES`（**5 MiB**）就把它轮转成 `<file>.1`（覆盖旧的 `.1`），
//   新内容写进新文件。保留一代即可：诊断只看最近一次，容量上限约 10 MiB。
//   轮转本身失败时**直接追加**，绝不因为轮转失败丢掉本次要写的内容。

import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 与交接文档同一个目录（`<DSH_HOME>/session-handoff-docs`）。 */
export const TRACE_DIR_NAME = 'session-handoff-docs'

/** 黑匣子文件名。 */
export const TRACE_FILE_NAME = 'handoff-trace.jsonl'

/** 单个字符串超过这个字符数就脱敏（真实诊断字段远小于它，文档正文远大于它）。 */
export const MAX_FIELD_CHARS = 200

/** 黑匣子主文件大小上限：超过就轮转成 `<file>.1`。 */
export const MAX_TRACE_BYTES = 5 * 1024 * 1024

/** 轮转出的历史文件名后缀。 */
export const TRACE_ROTATED_SUFFIX = '.1'

/** 默认 fs（测试可注入假 fs，避免真的往用户目录写）。 */
const DEFAULT_FS = Object.freeze({
  appendFileSync: nodeFs.appendFileSync,
  mkdirSync: nodeFs.mkdirSync,
  renameSync: nodeFs.renameSync,
  rmSync: nodeFs.rmSync,
  statSync: nodeFs.statSync,
})

/**
 * 解析 DSH 数据目录（`DSH_HOME` 优先，其次 `~/.dsh`）。
 * @param {Record<string, string|undefined>} [env] - 环境变量。
 * @returns {string} 目录绝对路径。
 */
export function resolveTraceHome(env = process.env) {
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * 是不是"朴素对象"（只递归它；Date/Map 等原样保留，避免改变序列化语义）。
 * @param {unknown} value - 待判断值。
 * @returns {boolean} 是朴素对象返回 true。
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 递归脱敏：过长字符串替换为 `[omitted N chars]`；循环引用替换为 `[circular]`。
 *
 * @param {unknown} value - 任意待脱敏值。
 * @param {WeakSet<object>} [seen] - 递归栈（区分真循环与共享引用，内部用）。
 * @returns {unknown} 脱敏后的值（新对象，不改原值）。
 */
export function sanitizeTraceData(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_CHARS ? `[omitted ${value.length} chars]` : value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out = value.map((item) => sanitizeTraceData(item, seen))
    seen.delete(value)
    return out
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeTraceData(item, seen)
    seen.delete(value)
    return out
  }
  return value
}

/**
 * 读文件字节数（读不到按 0 算：轮转判断失败不许影响写入）。
 * @param {object} fs - fs 实现。
 * @param {string} path - 目标文件。
 * @returns {number} 字节数。
 */
function fileBytes(fs, path) {
  try {
    const stat = fs.statSync(path)
    return typeof stat?.size === 'number' ? stat.size : 0
  } catch {
    return 0
  }
}

/**
 * 把主文件轮转成 `<file>.1`（覆盖旧的 `.1`）。
 * 失败会抛出，由调用方兜住并继续追加——**绝不因轮转失败丢内容**。
 * @param {object} fs - fs 实现。
 * @param {string} path - 主文件路径。
 * @returns {void}
 */
function rotateTraceFile(fs, path) {
  const rotated = `${path}${TRACE_ROTATED_SUFFIX}`
  try {
    fs.rmSync(rotated, { force: true })
  } catch {
    // 旧的 .1 删不掉就继续试 rename；rename 会覆盖（POSIX）或被调用方兜住（Windows/假 fs）
  }
  fs.renameSync(path, rotated)
}

/**
 * 建一个内存缓冲式的黑匣子；`flush()` 时一次性追加。
 * @param {{dshHome?: string, now?: () => number, env?: Record<string, string|undefined>, fs?: object}} [options] - 选项。
 * @returns {{push: Function, flush: Function, lines: Array<object>, path: string, enabled: boolean}} 黑匣子句柄。
 */
export function createTrace({ dshHome, now = () => Date.now(), env = process.env, fs = DEFAULT_FS } = {}) {
  const forced = env?.DSH_HANDOFF_TRACE
  const enabled = forced === 'on' || (forced !== 'off' && env?.NODE_TEST_CONTEXT === undefined)
  const dir = join(dshHome ?? resolveTraceHome(env), TRACE_DIR_NAME)
  const path = join(dir, TRACE_FILE_NAME)
  /** @type {Array<object>} */
  const lines = []
  return {
    lines,
    path,
    enabled,
    /**
     * 记一条阶段记录（长文本在这里统一脱敏，**不要写对话正文**）。
     * @param {string} stage - 阶段名。
     * @param {object} [data] - 附加字段。
     * @returns {void}
     */
    push(stage, data = {}) {
      if (!enabled) return
      try {
        lines.push({ at: new Date(now()).toISOString(), stage, ...sanitizeTraceData(data) })
      } catch {
        // 序列化失败就丢掉这一条，绝不影响硬切
      }
    },
    /**
     * 追加写盘（失败静默）；超过上限先轮转再写。
     * @returns {void}
     */
    flush() {
      if (!enabled || lines.length === 0) return
      /** 先序列化：任一行 JSON 化失败就整批放弃（绝不阻断硬切）。 */
      let payload
      try {
        payload = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
      } catch {
        return
      }
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        // 目录建不出来也让 append 自己去失败
      }
      try {
        if (fileBytes(fs, path) > MAX_TRACE_BYTES) rotateTraceFile(fs, path)
      } catch {
        // 轮转失败：不丢本次内容，直接追加到原文件（文件暂时超限，下次再试）
      }
      try {
        fs.appendFileSync(path, payload, 'utf8')
        lines.length = 0 // 写完清空：重复 flush 不许重复写
      } catch {
        // 黑匣子写不进去，绝不阻断硬切
      }
    },
  }
}
