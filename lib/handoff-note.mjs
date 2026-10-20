// R4（2026-10-17）：手动换会话卡片的两个入参归一化（host 侧不信客户端）。
//
// 规格：M1 技术文档 §12.3(c)；口径清单 §1 / §2.2 / §2.4 / §3。
//
// ⚠️ 三条铁律：
//   1. 留言**零改写**：不 trim / 不折叠空白 / 不转义 / 不归一换行（A2 要求逐字符一致）；
//   2. 只做「有没有」与「超没超」两件事；纯空白 = 没留言（否则会插出一节全是空格的假留言）；
//   3. 技能引用**只存不执行**：不读技能正文、不解析、不注入（清单 §0「不做」）。

import { MAX_NOTE_CHARS, MAX_SKILL_REFS, MAX_SKILL_REF_CHARS } from './constants.mjs'

/** 纯空白判定（含全角空格）——用于"这段留言算不算有内容"。 */
const WHITESPACE_ONLY_RE = /^[\s\u3000]*$/u

/**
 * 把任意输入按**码点**截到 `max` 个字符（不是 UTF-16 单元，避免把 emoji 劈成两半）。
 * @param {string} text - 原文。
 * @param {number} max - 上限（码点数）。
 * @returns {{text: string, truncated: boolean}} 截断结果。
 */
function sliceCodePoints(text, max) {
  const points = Array.from(text)
  if (points.length <= max) return { text, truncated: false }
  return { text: points.slice(0, max).join(''), truncated: true }
}

/**
 * 归一化 `note`（留言）。
 *
 * 规则（M1 §12.3(c)）：
 *   · 只有 `typeof === 'string'` 才收；其余（数组 / 数字 / 对象…）一律视为**没留言**，不抛错；
 *   · **不 trim、不折叠空白、不转义、不归一换行** —— 原文逐字符保留；
 *   · 按**码点**截到 `MAX_NOTE_CHARS`（500）；截断由调用方记 warn；
 *   · 空串 / 纯空白 ⇒ 视为**没留言**（`undefined`）。
 *
 * @param {unknown} value - 原始入参。
 * @returns {{note: string|undefined, truncated: boolean}} 归一化结果。
 */
export function normalizeNote(value) {
  if (typeof value !== 'string') return { note: undefined, truncated: false }
  if (value.length === 0 || WHITESPACE_ONLY_RE.test(value)) return { note: undefined, truncated: false }
  const sliced = sliceCodePoints(value, MAX_NOTE_CHARS)
  return { note: sliced.text, truncated: sliced.truncated }
}

/**
 * 归一化 `skillRefs`（技能引用）。
 *
 * 规则（M1 §12.3(c)）：字符串数组、逐项 `String(x)`、去重（保持首次出现顺序）、
 * 单条按码点限长 `MAX_SKILL_REF_CHARS`、整体最多 `MAX_SKILL_REFS` 条；空串项丢弃。
 * **只存引用不执行**：这里既不解析也不读技能正文。
 *
 * @param {unknown} value - 原始入参。
 * @returns {{skillRefs: string[]|undefined, dropped: number}} 归一化结果（没有有效引用时 `undefined`）。
 */
export function normalizeSkillRefs(value) {
  if (!Array.isArray(value)) return { skillRefs: undefined, dropped: 0 }
  const seen = new Set()
  const refs = []
  let dropped = 0
  for (const raw of value) {
    const text = String(raw)
    if (text.length === 0) {
      dropped += 1
      continue
    }
    const sliced = sliceCodePoints(text, MAX_SKILL_REF_CHARS)
    if (sliced.truncated) dropped += 1
    if (seen.has(sliced.text)) {
      dropped += 1
      continue
    }
    if (refs.length >= MAX_SKILL_REFS) {
      dropped += 1
      continue
    }
    seen.add(sliced.text)
    refs.push(sliced.text)
  }
  return { skillRefs: refs.length === 0 ? undefined : refs, dropped }
}
