// 客户端 UI 原子：进度条（带阈值刻度）、开关、分段选择、卡片。
//
// 硬约束（本块任务说明 §5 / M2 §三）：
//   - **禁止硬编码色值/字号/间距**——全部走 CSS 变量；
//   - 开关 **32×18**；
//   - 模式卡**三列一行**，窄屏（< 900px）竖排；
//   - 面板最大宽 **860px**。
//
// 这里刻意**不 import 任何宿主 UI 包**（如 `dsh-client-ui-primitives`）：
// 插槽名与包名能对得上是一回事，把别人的内部组件当 API 用是另一回事（PK-008 的教训）。
// 组件全部用原生元素 + 前缀类名（`dsh-handoff-*`），样式文件另置。

import { createElement as h, type ChangeEvent, type ReactNode } from 'react'

/** 类名前缀（避免污染宿主样式）。 */
export const CSS_NS = 'dsh-handoff'

/**
 * 拼类名。
 * @param parts - 片段。
 * @returns 类名。
 */
export function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ')
}

/**
 * 带阈值刻度线的进度条（C1 · ContextMeter 的 v2 形态）。
 *
 * @param props - 属性。
 * @returns 元素。
 */
export function Bar(props: {
  fill: number
  marker?: number
  level?: 'ok' | 'warn' | 'danger'
  label: string
}): ReactNode {
  const { fill, marker, level = 'ok', label } = props
  return h(
    'span',
    { className: cx(`${CSS_NS}-bar`), 'data-level': level },
    h('span', { className: cx(`${CSS_NS}-bar-track`), role: 'progressbar', 'aria-label': label, 'aria-valuenow': Math.round(fill * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { className: cx(`${CSS_NS}-bar-fill`), style: { width: `${Math.round(fill * 100)}%` } }),
      marker === undefined ? null : h('span', { className: cx(`${CSS_NS}-bar-marker`), style: { left: `${Math.round(marker * 100)}%` }, 'aria-hidden': 'true' }),
    ),
  )
}

/**
 * 32×18 小开关（L2）。**非受控**语义：受控 + onChange。
 * @param props - 属性。
 * @returns 元素。
 */
export function Switch(props: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }): ReactNode {
  const { checked, onChange, label, disabled } = props
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      disabled: disabled === true,
      className: cx(`${CSS_NS}-switch`),
      onClick: () => onChange(!checked),
    },
    h('span', { className: cx(`${CSS_NS}-switch-dot`), 'aria-hidden': 'true' }),
  )
}

/**
 * 分段选择（自动程度三选一用）。
 * @param props - 属性。
 * @returns 元素。
 */
export function Segmented<T extends string>(props: {
  value: T
  options: ReadonlyArray<{ id: T; label: string; description?: string }>
  onChange: (next: T) => void
  name: string
}): ReactNode {
  const { value, options, onChange, name } = props
  return h(
    'div',
    { className: cx(`${CSS_NS}-segmented`), role: 'radiogroup', 'aria-label': name },
    ...options.map((option) => h(
      'button',
      {
        key: option.id,
        type: 'button',
        role: 'radio',
        'aria-checked': option.id === value,
        title: option.description,
        className: cx(`${CSS_NS}-segment`, option.id === value && 'is-active'),
        onClick: () => onChange(option.id),
      },
      option.label,
    )),
  )
}

/**
 * 一行设置项（左标题+说明，右控件）。
 * @param props - 属性。
 * @returns 元素。
 */
export function Row(props: { title: string; hint?: string; children?: ReactNode }): ReactNode {
  return h(
    'div',
    { className: cx(`${CSS_NS}-row`) },
    h('div', { className: cx(`${CSS_NS}-row-text`) },
      h('div', { className: cx(`${CSS_NS}-row-title`) }, props.title),
      props.hint === undefined ? null : h('div', { className: cx(`${CSS_NS}-row-hint`) }, props.hint),
    ),
    props.children === undefined ? null : h('div', { className: cx(`${CSS_NS}-row-ctl`) }, props.children),
  )
}

/**
 * 数字输入（带单位后缀）。
 * @param props - 属性。
 * @returns 元素。
 */
export function NumberInput(props: {
  value: string
  onChange: (next: string) => void
  unit?: string
  placeholder?: string
  ariaLabel: string
  min?: number
  max?: number
}): ReactNode {
  const { value, onChange, unit, placeholder, ariaLabel, min, max } = props
  return h(
    'span',
    { className: cx(`${CSS_NS}-number`) },
    h('input', {
      type: 'number',
      className: cx(`${CSS_NS}-input`),
      value,
      placeholder,
      min,
      max,
      'aria-label': ariaLabel,
      onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    }),
    unit === undefined ? null : h('span', { className: cx(`${CSS_NS}-unit`) }, unit),
  )
}

/**
 * 主/次按钮。
 * @param props - 属性。
 * @returns 元素。
 */
export function Button(props: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
}): ReactNode {
  const { children, onClick, variant = 'ghost', disabled, title } = props
  return h(
    'button',
    {
      type: 'button',
      className: cx(`${CSS_NS}-btn`, `is-${variant}`),
      onClick,
      disabled: disabled === true,
      title,
    },
    children,
  )
}
