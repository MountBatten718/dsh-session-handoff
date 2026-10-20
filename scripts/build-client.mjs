// 客户端 bundle 构建：零依赖，用 Node 内建的 TypeScript 类型剥离（Node ≥ 22.13）。
//
// 为什么不用 tsdown / esbuild：本插件不安装任何构建依赖，而 tsdown 依赖 esbuild 二进制。
// 本脚本在没有任何 node_modules 的情况下也能构建出可加载的 bundle，产物契约是：
//   `window.__ModuleLoader__.load({ id, factory })`，react 走外部，其余全部内联。
//
// 用法：`node scripts/build-client.mjs`
//
// ⚠️ 它只做三件事，绝不做类型检查/压缩/优化：
//   1. 用 `node:module` 的 `stripTypeScriptTypes({mode:'strip'})` 剥类型（Node ≥ 22.13）；
//   2. 把 `export` 改写成 `exports.x = x`（客户端半区只用具名导出）；
//   3. 把相对 import 改成自带的同步 `require`，react 保留为外部调用。

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const ENTRY = resolve(root, 'src/client/index.ts')
const OUT = resolve(root, 'lib/client.js')

/** 某些打包器的 `?raw` 后缀（本脚本不吃这个后缀，遇到就报错）。 */
const RAW_SUFFIX = '?raw'

/**
 * 把一段 ESM 源码转成"给自带 require 用"的 CJS 片段。
 *
 * 只处理客户端半区实际用到的四种形式：
 *   `export function` / `export const` / `export class` / `export { a, b }`
 * 以及 `import type …`（直接删）、`import x from 'y'`、`import { a } from 'y'`、`import 'y'`。
 *
 * @param {string} source - 原始 TS 源码。
 * @param {string} path - 文件路径（错误信息用）。
 * @returns {string} CJS 片段。
 */
function toCjs(source, path, idOf) {
  let code = stripTypeScriptTypes(source, { mode: 'strip' })

  // `import type ...` 与 `export type ...`（剥离后可能残留）
  code = code.replace(/^\s*import\s+type\s+[^\n]*\n/gm, '')
  code = code.replace(/^\s*export\s+type\s+[^\n]*\n/gm, '')

  // import 语句
  // ⚠️ 具名导入里的 `as` 别名必须改写成对象解构的 `:`（`{createElement as h}` → `{createElement: h}`）。
  code = code.replace(
    /import\s*(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([\s\S]*?)\})?\s*from\s*['"]([^'"]+)['"]/g,
    (_match, defaultName, named, specifier) => {
      const parts = []
      const wire = idOf(specifier, path)
      if (defaultName !== undefined) parts.push(`const ${defaultName} = __req(${JSON.stringify(wire)}).default ?? __req(${JSON.stringify(wire)})`)
      const rewritten = (named ?? '').replace(/\s+/g, ' ')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.replace(/\s+as\s+/, ': '))
        .join(', ')
      parts.push(`const {${rewritten}} = __req(${JSON.stringify(wire)})`)
      return parts.join(';\n')
    },
  )
  code = code.replace(/import\s*['"]([^'"]+)['"]/g, (_m, specifier) => `__req(${JSON.stringify(idOf(specifier, path))})`)

  // export 语句
  // ⚠️ 用零宽前瞻在 `export` **前面**插一条赋值，再把 `export` 前缀删掉——
  //    绝不把 `export function f(){}` 改写成 `function f; exports.f = f`
  //    （那是非法语法：函数声明后面直接跟分号）。
  code = code.replace(/export\s+(?=async\s+function\s+([A-Za-z_$][\w$]*))/g, (_m, name) => `exports.${name} = ${name};\n`)
  code = code.replace(/export\s+(?=function\s+([A-Za-z_$][\w$]*))/g, (_m, name) => `exports.${name} = ${name};\n`)
  code = code.replace(/export\s+(?=class\s+([A-Za-z_$][\w$]*))/g, (_m, name) => `exports.${name} = ${name};\n`)
  const exportedConsts = []
  code = code.replace(/export\s+const\s+([A-Za-z_$][\w$]*)/g, (_m, name) => {
    exportedConsts.push(name)
    return `const ${name}`
  })
  // ⚠️ 顺序很重要（2026-10-12 审查 P2-12）：`export { a, b }` 这种**重导出必须先处理**。
  //    下面那句 `code.replace(/export\s+/g, '')` 会把 `export ` 前缀一并删掉，
  //    之后任何 `export {...}` 正则都再也匹配不到 —— 旧实现正是这样把重导出变成了
  //    一句无意义的块语句 `{ a, b }`（产物里真的出现了），将来谁要用就拿到 undefined。
  //    带 `from` 的形式（`export { a } from './x'`）本构建器不支持：用负向前瞻跳过它，
  //    交给后面的 RAW_SUFFIX 检查报错，而不是悄悄产出错的代码。
  code = code.replace(/export\s*\{([^}]*)\}(?!\s*from\b)/g, (_m, names) => names
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [local, exported] = entry.split(/\s+as\s+/).map((part) => part.trim())
      return `exports.${exported ?? local} = ${local}`
    })
    .join(';\n'))
  code = code.replace(/export\s+/g, '')
  if (exportedConsts.length > 0) {
    code += `\n;${exportedConsts.map((name) => `exports.${name} = ${name}`).join(';')}`
  }

  if (code.includes(RAW_SUFFIX)) throw new Error(`${path}: ${RAW_SUFFIX} imports are not supported by this fallback builder`)
  return code
}

/**
 * 递归收集入口的依赖图（只跟相对路径）。
 * @param {string} entry - 入口绝对路径。
 * @returns {Promise<Map<string, string>>} 路径 → CJS 片段。
 */
async function collect(entry) {
  const seen = new Map()
  const queue = [entry]
  // 模块 id：**相对于仓库根**的 posix 路径（`./src/client/index.ts`）。
  // 为什么不用绝对路径：绝对路径里带着用户名（`/Users/xxx/…`），产物不该泄露本机路径。
  const idOf = (specifier, fromPath) => {
    if (!specifier.startsWith('.')) return specifier
    const target = specifier.endsWith(RAW_SUFFIX) ? specifier.slice(0, -RAW_SUFFIX.length) : specifier
    return `./${relative(root, resolve(dirname(fromPath), target)).split(sep).join('/')}`
  }
  let entryId = ''
  while (queue.length > 0) {
    const path = queue.shift()
    if (seen.has(path)) continue
    const source = await readFile(path, 'utf8')
    const id = `./${relative(root, path).split(sep).join('/')}`
    if (path === entry) entryId = id
    seen.set(path, { id, code: toCjs(source, path, idOf) })
    for (const match of source.matchAll(/^\s*import[^\n]*from\s*['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      queue.push(resolve(dirname(path), specifier.replace(RAW_SUFFIX, '')))
    }
    // 多行 import（`import {\n a,\n b,\n} from 'x'`）也要收进依赖图（[\s\S] 而不是 [^\n]）。
    for (const match of source.matchAll(/^\s*import[\s\S]*?from\s*['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      queue.push(resolve(dirname(path), specifier.replace(RAW_SUFFIX, '')))
    }
    for (const match of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue
      queue.push(resolve(dirname(path), specifier))
    }
  }
  return { modules: seen, entryId }
}

const { modules, entryId } = await collect(ENTRY)
const entries = [...modules.values()]
  .map((module) => `    ${JSON.stringify(module.id)}: (exports, __req) => {\n${indent(module.code, 6)}\n    },`)
  .join('\n')

const banner = `window.__ModuleLoader__.load({
	id: "dsh-session-handoff",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var __modules = {
${entries}
		};
		var __cache = {};
		function __req(specifier) {
			if (specifier === "react") return require("react");
			if (!Object.prototype.hasOwnProperty.call(__modules, specifier)) {
				throw new Error("[dsh-session-handoff] unsupported module request: " + specifier);
			}
			if (!__cache[specifier]) {
				var mod = { exports: {} };
				__cache[specifier] = mod;
				__modules[specifier](mod.exports, __req);
			}
			return __cache[specifier].exports;
		}
		var __entry = __req(${JSON.stringify(entryId)});
		var __public = __entry.apply === undefined ? {} : { name: __entry.name, inject: __entry.inject, apply: __entry.apply };
		Object.assign(exports, __public);
		return exports;
	}
});
`

/**
 * 找出两个 Buffer **首个不同字节**的偏移；逐字节完全相同则返回 -1。
 * @param {Buffer} expected - 期望内容（本次内存重建出的产物）。
 * @param {Buffer} actual - 实际内容（磁盘上的产物）。
 * @returns {number} 首个差异偏移；-1 表示逐字节相同。
 */
export function firstDiffOffset(expected, actual) {
  const common = Math.min(expected.length, actual.length)
  for (let i = 0; i < common; i += 1) {
    if (expected[i] !== actual[i]) return i
  }
  // 前缀完全相同：长度不同也算差异（短的那份是"被截断/少了一段"）。
  return expected.length === actual.length ? -1 : common
}

/**
 * 把磁盘产物与本次内存重建结果**逐字节比对**，不一致就抛错（进程以非 0 退出）。
 *
 * 为什么必须有这一步：`--check` 原先只做语法自检、**从不读产物**，
 * 于是"改了 src/client/** 却没重新构建"也能绿着过 CI —— 门禁形同虚设。
 * @param {Buffer} expected - 本次内存重建出的 bundle（banner 的 utf8 字节）。
 * @param {Buffer} actual - 磁盘上 lib/client.js 的内容。
 * @param {string} outPath - 产物路径（错误信息用）。
 * @throws {Error} 内容不一致时。
 * @returns {void}
 */
export function assertBundleUpToDate(expected, actual, outPath) {
  const offset = firstDiffOffset(expected, actual)
  if (offset === -1) return
  // 差异定位：偏移 → 行号 + 两侧各 40 字节的片段，便于一眼看出改了什么。
  const line = expected.subarray(0, offset).toString('utf8').split('\n').length
  const near = (buf) => JSON.stringify(buf.subarray(Math.max(0, offset - 40), offset + 40).toString('utf8'))
  throw new Error(
    `构建产物过期：${outPath} 与 src/client/** 重新构建的结果不一致（改了源码没重新构建）。\n`
    + `  磁盘产物：${actual.length} 字节\n`
    + `  内存重建：${expected.length} 字节\n`
    + `  首个差异字节偏移：${offset}（约第 ${line} 行）\n`
    + `  重建期望：${near(expected)}\n`
    + `  磁盘实际：${near(actual)}\n`
    + '  修复：运行 `npm run build` 重新生成 lib/client.js 后再提交。',
  )
}

// `--check`：校验"能不能构建出正确产物" + "磁盘产物是否与源码一致"，**不落盘**——
// 让 CI 或任何机器（不装 node_modules）也能验证构建链路。
const checkOnly = process.argv.includes('--check')
if (checkOnly) {
  // ① 语法自检：让 Node 自己解析一遍（bundle 是纯 CJS 片段 + 一层包裹）
  // eslint-disable-next-line no-new-func
  new Function(banner)
  const entry = [...modules.values()].find((module) => module.id === entryId)
  if (entry === undefined) throw new Error('entry module missing from bundle')
  if (!/exports\.apply\s*=/.test(entry.code)) throw new Error('entry module does not export apply()')

  // ② 产物一致性：真的把 lib/client.js 读回来，与内存重建结果逐字节比对
  if (!existsSync(OUT)) {
    throw new Error(`构建产物不存在：${OUT}\n  修复：运行 \`npm run build\` 生成产物后再提交。`)
  }
  const built = Buffer.from(banner, 'utf8')
  assertBundleUpToDate(built, await readFile(OUT), OUT)
  console.log(`build check ok: ${modules.size} modules, ${banner.length} bytes; ${OUT} 与源码逐字节一致`)
} else {
  await writeFile(OUT, banner, 'utf8')
  console.log(`built ${OUT} (${modules.size} modules, ${banner.length} bytes)`)
}

/**
 * 缩进一段代码（保持可读的产物，便于排障）。
 * @param {string} code - 代码。
 * @param {number} spaces - 缩进宽度。
 * @returns {string} 缩进后的代码。
 */
function indent(code, spaces) {
  const pad = ' '.repeat(spaces)
  return code.split('\n').map((line) => (line.length === 0 ? line : pad + line)).join('\n')
}
