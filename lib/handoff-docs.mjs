// 交接文档落盘（S1「交接文档区」+ 需求 M1-P1-2）。
//
// 硬约束（NG-3，用户已拍板）：**绝不写进用户的项目目录**，一律落在 DSH 存储目录下。
// 默认目录 = `<DSH_HOME>/session-handoff-docs`；`handoffDocDir` 可覆盖。
//
// 本模块只依赖 node 内建（fs / path / os）+ `handoff-doc.mjs` 的**纯函数**兜底
//（`safeIsoTime` 零依赖、不碰 node 内建），可纯 Node 单测（注入假 fs 亦可）。

import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { safeIsoTime } from './handoff-doc.mjs'

/** 默认子目录名。 */
export const DEFAULT_DOC_DIR_NAME = 'session-handoff-docs'

/** 列目录时最多返回多少条（面板是给人看的，不需要全量）。 */
export const MAX_LISTED_DOCS = 50

/**
 * 读每份文档的**头部若干字节**去解析触发原因（不读全文）。
 *
 * 为什么在这里做而不是客户端：客户端要显示「会话短码 · 触发原因」，
 * 若由客户端逐份 `readHandoffDoc` 去解析，就是**几十次跨进程往返**；
 * 宿主侧一次本地小读就够（本地 SSD 上每份几毫秒）。
 */
const REASON_HEAD_BYTES = 1024

/**
 * 触发原因 → 给用户看的短标签。
 *
 * ⚠️ 原型里写的是「混合模式到线」，那是**示例数据**（那一次恰好是混合模式 + 体积到线）；
 * 这里按真实原因给标签，格式与原型一致（`会话短码 · 标签`）。
 */
const REASON_LABELS = Object.freeze({
  manual: '手工接力',
  'session-volume': '会话体积到线',
  'compaction-count': '压缩次数到线',
  'replace-threshold': '替代模式到线',
})

/**
 * 从文档头部文本解析触发原因标签（纯函数，便于单测）。
 * @param {string} head - 文档开头的文本。
 * @returns {string} 短标签；解析不到或原因未知时返回空串（**不猜**）。
 */
export function reasonLabelOf(head) {
  const matched = /^- 触发原因：([^\s（(]+)/mu.exec(typeof head === 'string' ? head : '')
  if (matched === null) return ''
  return REASON_LABELS[matched[1]] ?? ''
}

/**
 * 解析 DSH home（照 `@deepseek-ai/dsh-home-paths` 的公开口径：环境变量 → ~/.dsh）。
 * 这里不 import 那个包，是为了保持本模块零 `@deepseek-ai/*` 依赖（可纯 Node 单测）。
 * @param {Record<string, string|undefined>} [env] - 环境变量。
 * @returns {string} DSH home 绝对路径。
 */
export function resolveDshHome(env = process.env) {
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * 解析交接文档目录。
 * @param {{configuredDir?: string, env?: Record<string, string|undefined>, dshHome?: string}} [input] - 输入。
 * @returns {{dir: string, source: 'configured'|'dsh-home'}} 目录与来源。
 */
export function resolveDocDir({ configuredDir, env = process.env, dshHome } = {}) {
  if (typeof configuredDir === 'string' && configuredDir.trim().length > 0) {
    const configured = configuredDir.trim()
    // ⚠️ 只接受**绝对路径**（2026-10-12 代码审查 P2-6，随 P1-1 接线一并加固）：
    //   相对路径会以**进程 cwd**（= 用户当前项目目录）为基准，把交接文档
    //   （含用户需求与文件清单）写进用户的项目、还会污染 git —— 与本模块 NG-3 直接冲突。
    //   之前"落盘从未接线"所以这条不可触发；接线后必须堵上。
    //   配置写错时**回退默认目录**而不是抛错：落盘是附赠能力，不该让硬切失败。
    if (isAbsolute(configured)) return { dir: configured, source: 'configured' }
    return {
      dir: join(dshHome ?? resolveDshHome(env), DEFAULT_DOC_DIR_NAME),
      source: 'dsh-home',
      ignoredConfiguredDir: configured,
    }
  }
  return { dir: join(dshHome ?? resolveDshHome(env), DEFAULT_DOC_DIR_NAME), source: 'dsh-home' }
}

/**
 * 文件名：`<时间戳>-<会话 id 短码>.md`（可排序、可辨认，且不含路径分隔符）。
 *
 * ⚠️ 无效 `at`（NaN / Infinity / 超范围）**不抛**：`new Date(NaN).toISOString()` 会抛
 * `RangeError`，而 `at` 是外部传的；统一走 `safeIsoTime()` 退回**当前时间**，
 * 文件名格式（ISO 时间戳 + 短码）因此保持稳定（P2-16）。
 * @param {{sessionId: string, at?: number}} input - 输入。
 * @returns {string} 文件名。
 */
export function docFileName({ sessionId, at = Date.now() }) {
  // 只保留 `[A-Za-z0-9_-]`：**必须先砍掉路径分隔符与 `..` 段**，防目录穿越；
  // 再截短到 40 字符（文件名要短，且 id 尾部才是唯一性所在）。
  const safeId = String(sessionId ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '')
  const short = safeId.length > 40 ? safeId.slice(-40) : (safeId.length > 0 ? safeId : 'unknown')
  return `${safeIsoTime(at).replace(/[:.]/g, '-')}-${short}.md`
}

/**
 * 落盘一份交接文档。
 *
 * 失败**只告警不阻断**：文档是给人看的副本，换会话本身已经成功，不能因为写盘失败回滚。
 *
 * @param {object} input - 输入。
 * @param {string} input.dir - 目标目录。
 * @param {string} input.fileName - 文件名。
 * @param {string} input.content - 内容（Markdown）。
 * @param {object} [input.deps] - 可注入 fs（测试用）。
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>} 结果。
 */
export async function persistHandoffDoc({ dir, fileName, content, deps = {} }) {
  const mkdirFn = deps.mkdir ?? mkdir
  const writeFn = deps.writeFile ?? writeFile
  try {
    await mkdirFn(dir, { recursive: true })
    const path = join(dir, fileName)
    await writeFn(path, content, 'utf8')
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/**
 * 列已有交接文档（新的在前）。
 * @param {object} input - 输入。
 * @param {string} input.dir - 目录。
 * @param {number} [input.limit] - 上限。
 * @param {object} [input.deps] - 可注入 fs（测试用）。
 * @returns {Promise<{dir: string, exists: boolean, files: Array<{name: string, path: string, bytes: number, at: number}>}>} 列表。
 */
export async function listHandoffDocs({ dir, limit = MAX_LISTED_DOCS, deps = {} }) {
  const readdirFn = deps.readdir ?? readdir
  const statFn = deps.stat ?? stat
  const readHeadFn = deps.readHead ?? readHead
  let names
  try {
    names = await readdirFn(dir)
  } catch {
    return { dir, exists: false, files: [] }
  }
  const files = []
  for (const name of names) {
    if (typeof name !== 'string' || !name.endsWith('.md')) continue
    const path = join(dir, name)
    let info
    try {
      info = await statFn(path)
    } catch {
      continue
    }
    if (info?.isFile?.() === false) continue
    // 只读头部若干字节解析触发原因；失败就是空串（面板少显示一个标签而已，绝不能因此列不出文档）。
    let reason = ''
    try {
      reason = reasonLabelOf(await readHeadFn(path))
    } catch {
      reason = ''
    }
    files.push({ name, path, bytes: Number(info?.size ?? 0), at: Number(info?.mtimeMs ?? 0), reason })
  }
  files.sort((a, b) => b.at - a.at)
  // `total` = **截断前**的总数：设置页要显示「还有 N 份更早的」，
  // 没有它就只能写「还有更早的」（原型要求带具体数字）。
  return { dir, exists: true, files: files.slice(0, limit), total: files.length }
}

/**
 * 读一个文件的开头若干字节（默认实现；测试可注入假实现）。
 * @param {string} path - 文件路径。
 * @returns {Promise<string>} 头部文本。
 */
async function readHead(path) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(REASON_HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, REASON_HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
