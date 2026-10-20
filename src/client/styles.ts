// 样式入口：设计令牌逐字副本 + 本插件样式。
//
// 令牌来源：DSH 桌面端主题变量（prism.css v2），副本见 `lib/client/tokens.css`。
// 组件里**禁止**出现任何硬编码色值/字号，样式统一由本文件与令牌提供。
//
// ⚠️ 令牌同时挂在 `.dark` 下（与 prism.css 一致），因此**暗色模式不需要任何组件分支**。

import { CSS_NS } from './ui.ts'

/** 设计令牌（逐字副本）。 */
export const TOKENS_CSS = `
/* ============================================================================
   DSH 会话硬切插件 · 共享设计令牌 v2（2026-09-27）
   —— 汇总原型图唯一允许引用的令牌文件。原型内禁止出现任何硬编码色值/字号/间距。
   —— 令牌 VALUES 沿用用户 DSH 家族的《UI改版方案_2026-09-27.md》§4 设计令牌 v2 规格，
      保证本插件界面与同族产品视觉一致（设计令牌共享原则）。
   —— 注：文件尾部的 --node-* 画布/节点令牌由家族文件继承而来，本插件界面不使用；
      保留是为了与家族令牌文件保持逐字一致，将来家族升级时可整体替换。
   ============================================================================ */

:root {
  /* ---------- 品牌色（唯一强调色） ---------- */
  --brand-50:  #f1efff;
  --brand-100: #e4e0ff;
  --brand-200: #cfc8fd;
  --brand-500: #604ef7;
  --brand-600: #4f3fd6;
  --brand-700: #3f31ab;

  /* ---------- 语义色 ---------- */
  --success: #189a30;  --success-bg: #e8f6ea;
  --error:   #de3b3d;  --error-bg:   #fdecec;
  --warning: #e88000;  --warning-bg: #fdf3e5;
  --info:    #005de0;  --info-bg:    #e8f1fd;   /* 蓝色降级：只做提示语义，不再当第二强调色 */

  /* ---------- 中性灰阶（13 级，亮色） ---------- */
  --gray-0:   #ffffff;
  --gray-25:  #fcfcfd;
  --gray-50:  #f8f9fa;
  --gray-100: #f2f3f5;
  --gray-200: #e8eaed;
  --gray-300: #dcdfe3;
  --gray-400: #c3c8cf;
  --gray-500: #9aa1ab;
  --gray-600: #6f7780;
  --gray-700: #4b5259;
  --gray-800: #2b3036;
  --gray-900: #16191d;
  --gray-950: #0a0c0e;

  /* ---------- 语义别名（组件只准用这一层） ---------- */
  --bg-app:      var(--gray-50);
  --bg-canvas:   #fcfcfd;
  --bg-surface:  var(--gray-0);
  --bg-raised:   var(--gray-0);
  --bg-sunken:   var(--gray-100);
  --bg-hover:    var(--gray-100);
  --bg-active:   var(--gray-200);
  --bg-inverse:  var(--gray-900);

  --fg-primary:   var(--gray-900);
  --fg-secondary: var(--gray-700);
  --fg-tertiary:  var(--gray-600);
  --fg-muted:     var(--gray-500);
  --fg-inverse:   var(--gray-0);
  --fg-brand:     var(--brand-600);

  --border-strong:  var(--gray-300);
  --border-default: var(--gray-200);
  --border-subtle:  var(--gray-100);
  --border-focus:   var(--brand-500);

  --canvas-bg:  #fcfcfd;
  --canvas-dot: #e3e5e9;
  --edge-color: var(--gray-400);

  /* ---------- 字号阶梯（7 级） ---------- */
  --text-xs:      11px;  --leading-xs:      1.45;
  --text-sm:      12px;  --leading-sm:      1.50;
  --text-base:    13px;  --leading-base:    1.55;
  --text-md:      14px;  --leading-md:      1.50;
  --text-lg:      16px;  --leading-lg:      1.40;
  --text-xl:      20px;  --leading-xl:      1.30;
  --text-display: 28px;  --leading-display: 1.20;

  --weight-normal:   400;
  --weight-medium:   500;
  --weight-semibold: 600;

  /* ---------- 间距（4px 基数） ---------- */
  --space-1:  4px;   --space-2:  8px;   --space-3:  12px;
  --space-4:  16px;  --space-5:  20px;  --space-6:  24px;
  --space-8:  32px;  --space-10: 40px;  --space-12: 48px;
  --space-16: 64px;

  /* ---------- 圆角（4 级） ---------- */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-full: 999px;

  /* ---------- 阴影（5 级） ---------- */
  --shadow-xs: 0 1px 2px rgba(16, 18, 22, .06);
  --shadow-sm: 0 1px 3px rgba(16, 18, 22, .08), 0 1px 2px rgba(16, 18, 22, .04);
  --shadow-md: 0 4px 12px rgba(16, 18, 22, .10);
  --shadow-lg: 0 12px 32px rgba(16, 18, 22, .14);
  --shadow-xl: 0 24px 48px -12px rgba(16, 18, 22, .20);

  /* ---------- 层级（语义 z-index） ---------- */
  --z-canvas:   0;
  --z-node:     10;
  --z-sticky:   100;
  --z-dropdown: 200;
  --z-overlay:  300;
  --z-modal:    400;
  --z-toast:    500;
  --z-tooltip:  600;

  /* ---------- 动效 ---------- */
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 260ms;
  --ease-out: cubic-bezier(.2, .8, .2, 1);

  /* ---------- 遮罩 ---------- */
  --overlay-bg:  rgba(10, 12, 14, .45);
  --overlay-blur: 2px;

  /* ---------- 画布/节点专用（由 v1 --node-* 收敛，补齐旧版缺失的 16 个令牌） ---------- */
  --node-bg:            var(--bg-surface);
  --node-border:        var(--border-default);
  --node-border-active: var(--brand-500);
  --node-header-bg:     var(--gray-50);
  --node-shadow:        var(--shadow-sm);
  --node-shadow-active: var(--shadow-md);
  --node-scrollbar:        var(--gray-300);
  --node-scrollbar-hover:  var(--gray-400);
  --node-prompt-border:    #e0b23e;   /* 木兰同款“提示词”黄框，保留 */
  --node-prompt-bg:        #fffaf0;
  --node-error-soft:       #f0c2c2;
  --node-success-ring:     rgba(24, 154, 48, .35);
  --node-error-ring:       rgba(222, 59, 61, .32);
  --node-handle:           var(--brand-500);
  --node-handle-data:      var(--info);
  --node-run-btn:          var(--gray-900);
  --node-run-btn-hover:    var(--gray-800);
}

/* ============================ 暗色：同名变量换值 ============================
   组件不写任何 dark: 分支即可自动适配——本次改版的核心工程收益。 */
.dark {
  --brand-50:  #1b1830;
  --brand-100: #262047;
  --brand-200: #3a2f78;
  --brand-500: #736dff;
  --brand-600: #8b86ff;
  --brand-700: #a5a1ff;

  --success: #4db155;  --success-bg: #0e2411;
  --error:   #f36069;  --error-bg:   #2c1214;
  --warning: #f6922e;  --warning-bg: #2b1d0d;
  --info:    #4c99f8;  --info-bg:    #0d1f33;

  --gray-0:   #0a0c0e;
  --gray-25:  #0f1114;
  --gray-50:  #131518;
  --gray-100: #1a1d21;
  --gray-200: #24272c;
  --gray-300: #32363c;
  --gray-400: #454a51;
  --gray-500: #6b7178;
  --gray-600: #8d939b;
  --gray-700: #b3b8bf;
  --gray-800: #d5d9de;
  --gray-900: #eceef1;
  --gray-950: #ffffff;

  --bg-app:     #0a0c0e;
  --bg-canvas:  #0f1114;
  --bg-surface: #131518;
  --bg-raised:  #1a1d21;
  --bg-sunken:  #0f1114;
  --bg-hover:   #1f2227;
  --bg-active:  #282c32;
  --bg-inverse: #eceef1;

  --fg-primary:   #eceef1;
  --fg-secondary: #b3b8bf;
  --fg-tertiary:  #8d939b;
  --fg-muted:     #6b7178;
  --fg-inverse:   #0a0c0e;
  --fg-brand:     var(--brand-600);

  --border-strong:  #32363c;
  --border-default: #24272c;
  --border-subtle:  #1a1d21;
  --border-focus:   var(--brand-500);

  --canvas-bg:  #0f1114;
  --canvas-dot: #23262b;
  --edge-color: #454a51;

  --shadow-xs: 0 1px 2px rgba(0, 0, 0, .40);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, .45), 0 1px 2px rgba(0, 0, 0, .30);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, .50);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, .55);
  --shadow-xl: 0 24px 48px -12px rgba(0, 0, 0, .65);

  --overlay-bg: rgba(0, 0, 0, .60);

  --node-prompt-border: #8a6d24;
  --node-prompt-bg:     #1d1a12;
  --node-error-soft:    #6d3a3a;
  --node-success-ring:  rgba(77, 177, 85, .38);
  --node-error-ring:    rgba(243, 96, 105, .34);
}

/* ======================= 兼容层（迁移期用，勿在新代码引用） =======================
   v1 的 --mulan-* / --background 等旧名在此映射到 v2，保证迁移期间旧 className 不炸。 */
:root {
  --background: var(--bg-app);         --foreground: var(--fg-primary);
  --card: var(--bg-surface);           --card-foreground: var(--fg-primary);
  --popover: var(--bg-raised);         --popover-foreground: var(--fg-primary);
  --primary: var(--gray-900);          --primary-foreground: var(--gray-0);
  --secondary: var(--gray-100);        --secondary-foreground: var(--gray-900);
  --muted: var(--gray-100);            --muted-foreground: var(--fg-muted);
  --accent: var(--gray-100);           --accent-foreground: var(--gray-900);
  --destructive: var(--error);
  --border: var(--border-default);
  --input: var(--border-default);
  --ring: var(--border-focus);         --radius: var(--radius-md);

  --mulan-text-primary:   var(--fg-primary);
  --mulan-text-secondary: var(--fg-secondary);
  --mulan-text-tertiary:  var(--fg-tertiary);
  --mulan-text-muted:     var(--fg-muted);
  --mulan-text-subtle:    var(--fg-muted);
  --mulan-text-disabled:  var(--gray-500);
  --mulan-bg-primary:     var(--bg-surface);
  --mulan-bg-secondary:   var(--bg-app);
  --mulan-bg-tertiary:    var(--bg-sunken);
  --mulan-bg-elevated:    var(--bg-raised);
  --mulan-bg-hover:       var(--bg-hover);
  --mulan-bg-dark:        var(--gray-900);
  --mulan-border-default: var(--border-default);
  --mulan-border-subtle:  var(--border-subtle);
  --mulan-accent-purple:  var(--brand-500);
  --mulan-accent-blue:    var(--brand-600);
  --mulan-status-success: var(--success);
  --mulan-status-error:   var(--error);
  --mulan-status-warning: var(--warning);
  --node-btn-dark:        var(--node-run-btn);
}

/* ============================ 基础层 ============================ */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei",
               ui-sans-serif, system-ui, sans-serif;
  font-size: var(--text-base);
  line-height: var(--leading-base);
  color: var(--fg-primary);
  background: var(--bg-app);
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}

::selection { background: var(--brand-100); color: var(--fg-primary); }
/* 画布底为纯色，不使用点阵背景（2026-09-27 用户要求去掉小圆点） */

/* 连接点热区扩大（保持 v1 行为不变：只在节点外侧延伸 48px，不侵入节点内部） */
.react-flow__handle-left::before {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: -48px; border-radius: var(--radius-sm);
}
.react-flow__handle-right::before {
  content: ''; position: absolute; top: 0; left: 0; bottom: 0; right: -48px; border-radius: var(--radius-sm);
}
`

/** 本插件样式（全部引用上面的令牌，零硬编码）。 */
export const PLUGIN_CSS = `
/* ─────────────── 方案 C：让本槽位的紧凑条目在同一行平铺（2026-10-10 用户拍板）───────────────
 *
 * ⚠️ 本段在**模板字符串内部**，注释里**绝对不能出现反引号**（会提前结束模板串、构建直接报语法错）。
 *
 * 背景（逐字取自 DSH 0.2.0-rc.2）：
 *   · 槽位外壳由宿主渲染为 div[data-slot=...] 且带**内联** style: display:contents
 *     （dsh-client-ui-renderer 的 ANCHOR_STYLE = { display: "contents" }）
 *     ⇒ 外壳不生成盒子，条目直接成为外层容器的子项；
 *   · conversation.input.dock 的外层是 .composerStack{flex-direction:column}（垂直列）
 *     ⇒ 这个槽位里的条目**必然各占一行**，插件侧无法让它们并排；
 *   · 但外壳在 DOM 里真实存在、且带稳定的 data-slot 钩子。
 *
 * 做法：**只在本插件在场时**，把该槽位外壳从 display:contents 改成横向 flex（居中、可换行）。
 *   · !important 是必需的——宿主用的是**内联** display:contents，普通样式赢不过内联样式；
 *   · :has(> .CSS_NS-health) 限定作用域：**插件关掉/未加载时宿主完全不受影响**；
 *   · flex-wrap:wrap：宿主的待办/队列面板是 100% 宽，会自然各占一行，不被挤压。
 *
 * ⚠️ 宽度很关键（2026-10-10 实机事故）：宿主那层容器是**满窗口宽**的（composerStack 没有 max-width），
 *    而输入框自己靠 .card{max-width:var(--dsh-composer-card-max-width)} 居中。
 *    所以我们必须**显式把这条带子限制成"和输入框同宽"并整体居中**
 *    （width:100% + max-width:var(--dsh-composer-card-max-width) + margin-inline:auto），
 *    否则 ① 居中的基准是整个窗口、② 同槽位一旦出现别的插件条目，整组会被推离输入框位置。
 *
 * ⚠️ 这是本插件唯一一处**越过边界改宿主容器样式**的地方，仅此一处、且带 :has 守卫。
 *    若将来宿主把 input.dock 改成横向，删掉本段即可（我们的行不依赖它也能正常显示）。
 */
div[data-slot="conversation.input.dock"]:has(.${CSS_NS}-health){display:flex !important;flex-flow:row wrap;justify-content:center;align-items:center;gap:var(--space-2);box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,100%);margin-inline:auto}
/* 同槽位的**兄弟条目**要按内容宽度，否则并排不起来。
 * 实机证据（2026-10-10）：cost-meter 的 Go 配额条根元素 .cm-qstrip 写死了 width:100%，
 * 在横向带子里会把整行吃光，把我们的行挤到下一行（用户截图实测"还是竖着堆"）。
 * 本规则选择器特异性 (0,3,1) 高于 .cm-qstrip 的 (0,1,0)，无需 !important 即可覆盖。
 * 代价（必须知情）：同槽位里**任何**插件的条目都会变成按内容宽度——包括宿主自带的待办/队列面板，
 * 它们原本是整宽，现在会缩到内容宽度（但仍受 max-width:100% 保护，不会溢出）。 */
div[data-slot="conversation.input.dock"]:has(.${CSS_NS}-health) > *{flex:0 1 auto;min-width:0;width:auto;max-width:100%;margin:0}
.${CSS_NS}-health{position:relative;display:flex;flex-direction:column;gap:var(--space-2);align-self:center;flex:0 1 auto;width:fit-content;min-width:0;max-width:100%;margin:0;padding:0;box-sizing:border-box;color:var(--fg-secondary);font-size:var(--text-sm);line-height:var(--leading-sm)}
.${CSS_NS}-health-main{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.${CSS_NS}-meter{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.${CSS_NS}-meter-label{color:var(--fg-muted);white-space:nowrap}
.${CSS_NS}-meter-value{color:var(--fg-primary);font-weight:var(--weight-medium);font-variant-numeric:tabular-nums;white-space:nowrap}
.${CSS_NS}-bar{display:block;min-width:40px;flex:0 1 72px}
.${CSS_NS}-bar-track{position:relative;display:block;height:6px;border-radius:var(--radius-full);background:var(--bg-sunken);overflow:visible}
.${CSS_NS}-bar-fill{display:block;height:100%;border-radius:var(--radius-full);background:var(--gray-400);transition:width var(--dur-base) var(--ease-out)}
.${CSS_NS}-bar[data-level=warn] .${CSS_NS}-bar-fill{background:var(--warning)}
.${CSS_NS}-bar[data-level=danger] .${CSS_NS}-bar-fill{background:var(--brand-500)}
.${CSS_NS}-bar-marker{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;border-radius:var(--radius-full);background:var(--border-strong)}
.${CSS_NS}-verdict{flex:none;border:0;background:transparent;cursor:pointer;padding:0;color:var(--fg-primary);font-size:var(--text-sm);font-weight:var(--weight-medium);white-space:nowrap}
.${CSS_NS}-health[data-level=warn] .${CSS_NS}-verdict{color:var(--warning)}
.${CSS_NS}-health[data-level=danger] .${CSS_NS}-verdict{color:var(--error)}
.${CSS_NS}-health-empty{flex:1;color:var(--fg-muted)}
.${CSS_NS}-health-notice,.${CSS_NS}-notice{padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--warning-bg);color:var(--fg-primary);font-size:var(--text-xs)}
.${CSS_NS}-health-failure{padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--error-bg);color:var(--fg-primary);font-size:var(--text-xs)}
.${CSS_NS}-detail-layer{position:absolute;top:calc(100% + var(--space-1));left:0;z-index:30;min-width:340px;max-width:min(90vw,520px);padding:var(--space-1);border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-surface);box-shadow:var(--shadow-lg)}
.${CSS_NS}-detail{width:100%;border-collapse:collapse;border:1px solid var(--border-default);border-radius:var(--radius-md);overflow:hidden}
.${CSS_NS}-detail th,.${CSS_NS}-detail td{text-align:left;padding:var(--space-1) var(--space-3);border-bottom:1px solid var(--border-subtle);font-size:var(--text-xs)}
.${CSS_NS}-detail th{background:var(--bg-sunken);color:var(--fg-muted);font-weight:var(--weight-medium)}
.${CSS_NS}-detail td{color:var(--fg-secondary)}

.${CSS_NS}-panel{max-width:860px;margin:0 auto;padding:var(--space-4) var(--space-5) var(--space-6);background:var(--bg-surface);color:var(--fg-primary);font-size:var(--text-base);line-height:var(--leading-base);border-radius:var(--radius-lg);box-shadow:var(--shadow-xs);box-sizing:border-box}
.${CSS_NS}-panel-head{margin-bottom:var(--space-4)}
.${CSS_NS}-panel-title{font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--fg-primary)}
.${CSS_NS}-panel-sub{color:var(--fg-muted);font-size:var(--text-sm);margin-top:var(--space-1)}
.${CSS_NS}-group{margin-top:var(--space-4);padding-top:var(--space-3);border-top:1px solid var(--border-subtle)}
.${CSS_NS}-group-title{font-size:var(--text-sm);font-weight:var(--weight-semibold);color:var(--fg-secondary);margin-bottom:var(--space-3)}
.${CSS_NS}-row{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);padding:var(--space-2) 0}
.${CSS_NS}-row-text{min-width:0;flex:1}
.${CSS_NS}-row-title{color:var(--fg-primary);font-size:var(--text-base)}
.${CSS_NS}-row-hint{color:var(--fg-muted);font-size:var(--text-xs);margin-top:2px}
.${CSS_NS}-row-ctl{flex:none;display:flex;align-items:center;gap:var(--space-2)}
.${CSS_NS}-switch{position:relative;flex:none;width:32px;height:18px;padding:0;border:0;border-radius:var(--radius-full);background:var(--gray-400);cursor:pointer;transition:background var(--dur-fast) var(--ease-out)}
.${CSS_NS}-switch[aria-checked=true]{background:var(--brand-500)}
.${CSS_NS}-switch:disabled{opacity:.5;cursor:not-allowed}
.${CSS_NS}-switch-dot{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:var(--radius-full);background:var(--gray-0);transition:transform var(--dur-fast) var(--ease-out)}
.${CSS_NS}-switch[aria-checked=true] .${CSS_NS}-switch-dot{transform:translateX(14px)}
.${CSS_NS}-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-3)}
.${CSS_NS}-mode{display:flex;flex-direction:column;gap:var(--space-3);text-align:left;padding:var(--space-4);border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-raised);color:var(--fg-primary);cursor:pointer;transition:border-color var(--dur-fast) var(--ease-out),background var(--dur-fast) var(--ease-out)}
.${CSS_NS}-mode:hover{background:var(--bg-hover)}
.${CSS_NS}-mode.is-active{border-color:var(--brand-500);background:var(--brand-50)}
.${CSS_NS}-mode-head{display:flex;align-items:center;gap:var(--space-2)}
.${CSS_NS}-mode-title{font-weight:var(--weight-semibold);font-size:var(--text-md)}
.${CSS_NS}-badge{padding:0 var(--space-1);border-radius:var(--radius-sm);background:var(--brand-500);color:var(--gray-0);font-size:var(--text-xs);font-weight:var(--weight-semibold)}
.${CSS_NS}-mode-desc{color:var(--fg-secondary);font-size:var(--text-sm)}
.${CSS_NS}-mode-when{color:var(--fg-muted);font-size:var(--text-xs);margin-top:auto}
.${CSS_NS}-mode-warn{color:var(--warning);font-size:var(--text-xs)}
.${CSS_NS}-segmented{display:inline-flex;border:1px solid var(--border-default);border-radius:var(--radius-md);overflow:hidden;background:var(--bg-sunken)}
.${CSS_NS}-segment{border:0;background:transparent;color:var(--fg-secondary);padding:var(--space-2) var(--space-3);min-height:44px;cursor:pointer;font-size:var(--text-sm)}
.${CSS_NS}-segment.is-active{background:var(--bg-surface);color:var(--fg-brand);font-weight:var(--weight-medium)}
.${CSS_NS}-number{display:inline-flex;align-items:center;gap:var(--space-1)}
.${CSS_NS}-input{width:96px;padding:var(--space-1) var(--space-2);min-height:32px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--fg-primary);font-size:var(--text-base);font-variant-numeric:tabular-nums}
.${CSS_NS}-unit{color:var(--fg-muted);font-size:var(--text-xs)}
.${CSS_NS}-actions{display:flex;gap:var(--space-2);margin-top:var(--space-2)}
.${CSS_NS}-btn{border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--bg-raised);color:var(--fg-primary);padding:var(--space-1) var(--space-3);min-height:32px;cursor:pointer;font-size:var(--text-sm);transition:background var(--dur-fast) var(--ease-out)}
.${CSS_NS}-btn:hover:not(:disabled){background:var(--bg-hover)}
.${CSS_NS}-btn:disabled{opacity:.6;cursor:not-allowed}
.${CSS_NS}-btn.is-primary{border-color:var(--brand-500);background:var(--brand-500);color:var(--gray-0)}
.${CSS_NS}-btn.is-primary:hover:not(:disabled){background:var(--brand-600)}
.${CSS_NS}-btn.is-danger{border-color:var(--error);color:var(--error)}
.${CSS_NS}-doc-preview{max-height:240px;overflow:auto;padding:var(--space-3);border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-sunken);color:var(--fg-secondary);font-size:var(--text-xs);white-space:pre-wrap;margin-top:var(--space-2)}
.${CSS_NS}-empty{padding:var(--space-3);border:1px dashed var(--border-default);border-radius:var(--radius-md);color:var(--fg-muted);font-size:var(--text-xs)}
.${CSS_NS}-decisions{display:flex;flex-direction:column;gap:var(--space-1)}
.${CSS_NS}-decision{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:var(--bg-sunken)}
.${CSS_NS}-decision-time{color:var(--fg-muted);font-size:var(--text-xs);font-variant-numeric:tabular-nums}
.${CSS_NS}-decision-badge{padding:0 var(--space-1);border-radius:var(--radius-sm);background:var(--gray-200);color:var(--fg-primary);font-size:var(--text-xs);font-weight:var(--weight-medium)}
.${CSS_NS}-decision-badge[data-action=handoff],.${CSS_NS}-decision-badge[data-action=handoff-manual]{background:var(--brand-500);color:var(--gray-0)}
.${CSS_NS}-decision-badge[data-action=cancel]{background:var(--warning-bg);color:var(--warning)}
.${CSS_NS}-decision-human{flex:1 1 240px;color:var(--fg-secondary);font-size:var(--text-xs)}
.${CSS_NS}-decision-meta{color:var(--fg-muted);font-size:var(--text-xs)}

/* ============ 新会话区 + 完全权限确认弹窗 + 交接文档列表（2026-10-12 新增） ============
 * 逐字照《汇总原型图.html》的对应样式搬来，只做两件事：
 *   ① 类名统一加 ${CSS_NS}- 前缀（不污染宿主样式）；
 *   ② 所有取值一律引用设计令牌（禁止硬编码色值/字号）。
 */

/* —— 卡片（原型 .card / .card-head / .card-title / .card-desc） —— */
.${CSS_NS}-card{margin-top:var(--space-4);padding:var(--space-5);border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-surface);box-shadow:var(--shadow-xs)}
.${CSS_NS}-card-head{margin-bottom:var(--space-3)}
.${CSS_NS}-card-title{margin:0;font-size:var(--text-lg);font-weight:var(--weight-semibold);line-height:var(--leading-lg);color:var(--fg-primary)}
.${CSS_NS}-card-desc{margin:var(--space-2) 0 0;font-size:var(--text-sm);color:var(--fg-muted)}
.${CSS_NS}-card-desc strong{font-weight:var(--weight-semibold);color:var(--fg-secondary)}

/* —— 设置项行（原型 .setting-row / .setting-label / .setting-control） —— */
.${CSS_NS}-setting-row{display:flex;gap:var(--space-4);align-items:center;padding:var(--space-3) 0}
/* 用通用兄弟选择器（不是相邻）：行之间可能夹着"读取失败"提示行，分隔线不能因此消失。 */
.${CSS_NS}-setting-row ~ .${CSS_NS}-setting-row{border-top:1px solid var(--border-subtle)}
.${CSS_NS}-setting-row:first-child{padding-top:0}
.${CSS_NS}-setting-row:last-child{padding-bottom:0}
.${CSS_NS}-setting-label{flex:1 1 auto;min-width:0;max-width:620px}
.${CSS_NS}-setting-label-t{font-size:var(--text-md);font-weight:var(--weight-medium);color:var(--fg-primary)}
.${CSS_NS}-setting-label-d{margin-top:var(--space-1);font-size:var(--text-sm);color:var(--fg-muted)}
.${CSS_NS}-setting-control{flex:none;margin-left:auto}
.${CSS_NS}-control-inline{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.${CSS_NS}-control-right{display:flex;justify-content:flex-end}

/* —— 下拉（原型 .select-input） —— */
.${CSS_NS}-select-input{height:32px;min-width:220px;max-width:340px;padding:0 var(--space-3);border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-surface);color:var(--fg-primary);font-size:var(--text-sm);font-family:inherit}
.${CSS_NS}-select-input:focus{outline:2px solid var(--brand-200);outline-offset:1px}

/* —— 卡片底部提示（原型 .choice-hint；data-tone=error 时用语义错误色，仍是令牌） —— */
.${CSS_NS}-choice-hint{display:block;margin-top:var(--space-2);font-size:var(--text-xs);color:var(--fg-muted)}
.${CSS_NS}-choice-hint strong{color:var(--fg-secondary)}
.${CSS_NS}-choice-hint[data-tone=error]{color:var(--error)}

/* —— 小号次按钮（原型 .btn-sm / .btn-secondary / .btn-danger） —— */
.${CSS_NS}-btn-sm{min-height:28px;padding:0 var(--space-3);font-size:var(--text-xs)}
.${CSS_NS}-btn-modal{min-height:32px;padding:0 var(--space-4)}

/* —— 徽章（原型 .badge / .badge-neutral） —— */
.${CSS_NS}-badge{display:inline-flex;align-items:center;gap:var(--space-1);height:18px;padding:0 var(--space-2);border-radius:var(--radius-full);background:var(--brand-50);color:var(--brand-700);font-size:var(--text-xs);font-weight:var(--weight-medium);white-space:nowrap}
.${CSS_NS}-badge-neutral{background:var(--bg-sunken);color:var(--fg-secondary)}

/* —— 交接文档列表（原型 .doc-list / .doc-row / .doc-more） —— */
.${CSS_NS}-doc-list{margin-top:var(--space-2);border:1px solid var(--border-default);border-radius:var(--radius-md);overflow:hidden}
.${CSS_NS}-doc-row{display:flex;align-items:center;gap:var(--space-3);width:100%;padding:var(--space-2) var(--space-3);border:0;border-top:1px solid var(--border-subtle);background:var(--bg-surface);color:inherit;font:inherit;text-align:left;cursor:pointer}
.${CSS_NS}-doc-row:first-child{border-top:0}
.${CSS_NS}-doc-row:hover{background:var(--bg-hover)}
.${CSS_NS}-doc-row.is-open{background:var(--brand-50)}
.${CSS_NS}-doc-when{flex:none;font-size:var(--text-sm);font-variant-numeric:tabular-nums;color:var(--fg-primary)}
.${CSS_NS}-doc-who{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm);color:var(--fg-muted)}
.${CSS_NS}-doc-size{flex:none;font-size:var(--text-xs);font-variant-numeric:tabular-nums;color:var(--fg-muted)}
.${CSS_NS}-doc-chev{flex:none;display:inline-flex;color:var(--fg-muted)}
.${CSS_NS}-doc-chev svg{width:14px;height:14px}
.${CSS_NS}-doc-more{padding:var(--space-2) var(--space-3);font-size:var(--text-xs);color:var(--fg-muted);background:var(--bg-sunken)}
.${CSS_NS}-doc-more[data-tone=error]{color:var(--error)}

/* —— 选中文档的全文卡片（原型 .doc-card / .doc-head / .doc-body） —— */
.${CSS_NS}-doc-detail{margin-top:var(--space-3)}
.${CSS_NS}-doc-card{border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--bg-surface);box-shadow:var(--shadow-xs)}
.${CSS_NS}-doc-head{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--border-subtle);flex-wrap:wrap}
.${CSS_NS}-doc-head-icon{width:24px;height:24px;flex:none;border-radius:var(--radius-sm);background:var(--brand-50);color:var(--brand-700);display:inline-flex;align-items:center;justify-content:center}
.${CSS_NS}-doc-head-icon svg{width:14px;height:14px}
.${CSS_NS}-doc-title{font-size:var(--text-md);font-weight:var(--weight-medium);color:var(--fg-primary)}
.${CSS_NS}-doc-time{font-size:var(--text-xs);color:var(--fg-muted)}
.${CSS_NS}-doc-body{padding:var(--space-2) var(--space-5) var(--space-4)}
.${CSS_NS}-doc-text{margin:0;padding:var(--space-3) 0;font-size:var(--text-base);line-height:var(--leading-base);color:var(--fg-secondary);white-space:pre-wrap;word-break:break-word;font-family:inherit}

/* —— 「完全权限」确认弹窗（原型 .modal-mask / .modal-card / …） —— */
.${CSS_NS}-modal-mask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:var(--overlay-bg)}
.${CSS_NS}-modal-card{width:min(92vw,460px);padding:var(--space-5);border:1px solid var(--border-default);border-radius:var(--radius-lg);background:var(--bg-surface);box-shadow:var(--shadow-lg)}
.${CSS_NS}-modal-head{display:flex;gap:var(--space-2);align-items:center}
.${CSS_NS}-modal-icon{color:var(--error);display:inline-flex}
.${CSS_NS}-modal-icon svg{width:22px;height:22px}
.${CSS_NS}-modal-title{margin:0;font-size:var(--text-lg);font-weight:var(--weight-semibold);color:var(--fg-primary)}
.${CSS_NS}-modal-body{margin:var(--space-3) 0 0;font-size:var(--text-sm);line-height:var(--leading-base);color:var(--fg-secondary)}
.${CSS_NS}-modal-actions{display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-5)}

@media (max-width:900px){
  .${CSS_NS}-modes{grid-template-columns:1fr}
  .${CSS_NS}-panel{padding:var(--space-3)}
  .${CSS_NS}-setting-row{flex-direction:column;align-items:flex-start}
  .${CSS_NS}-select-input{min-width:0;width:100%;max-width:none}
}

/* —— R4 手动换会话卡片 · 留言区 · 技能面板（2026-10-17） —— */
.${CSS_NS}-manual-card{display:flex;flex-direction:column;gap:var(--space-2);margin-top:var(--space-3);padding:var(--space-4);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-raised)}
.${CSS_NS}-manual-title{font-size:var(--text-md);font-weight:var(--weight-semibold);color:var(--fg-primary)}
.${CSS_NS}-manual-facts{display:flex;gap:var(--space-3);flex-wrap:wrap;font-size:var(--text-xs);color:var(--fg-muted)}
.${CSS_NS}-manual-label{font-size:var(--text-sm);color:var(--fg-primary)}
.${CSS_NS}-manual-hint{font-size:var(--text-xs);color:var(--fg-muted)}
.${CSS_NS}-manual-note{display:block;width:100%;box-sizing:border-box;min-height:52px;max-height:88px;padding:var(--space-2) var(--space-3);border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--fg-primary);font-family:inherit;font-size:var(--text-sm);line-height:var(--leading-base);resize:none;overflow-y:auto}
.${CSS_NS}-manual-count{align-self:flex-end;font-size:var(--text-xs);color:var(--fg-muted)}
.${CSS_NS}-manual-count[data-full=true]{color:var(--error)}
.${CSS_NS}-manual-skillbar{position:relative;display:flex;gap:var(--space-2)}
.${CSS_NS}-skill-panel{position:absolute;left:0;top:100%;z-index:5;width:min(420px,90vw);max-height:280px;overflow:auto;padding:var(--space-3);border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-raised);box-shadow:var(--shadow-md)}
.${CSS_NS}-skill-search{width:100%;margin:var(--space-2) 0;padding:var(--space-2);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--fg-primary);font-size:var(--text-sm)}
.${CSS_NS}-skill-hint{font-size:var(--text-xs);color:var(--fg-muted)}
.${CSS_NS}-skill-hint[data-tone=error]{color:var(--error)}
.${CSS_NS}-skill-group-title{margin-top:var(--space-2);font-size:var(--text-xs);color:var(--fg-secondary)}
.${CSS_NS}-skill-row{display:flex;align-items:center;gap:var(--space-2);width:100%;padding:var(--space-2);border:0;background:transparent;color:var(--fg-primary);text-align:left;cursor:pointer;font-size:var(--text-sm)}
.${CSS_NS}-skill-row:hover{background:var(--bg-hover)}
.${CSS_NS}-skill-row-ico{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);background:var(--bg-sunken);color:var(--fg-secondary);font-size:var(--text-xs);font-weight:var(--weight-medium)}
.${CSS_NS}-skill-row-main{flex:1;min-width:0}
.${CSS_NS}-skill-row-name{display:block;color:var(--fg-primary);font-weight:var(--weight-medium)}
.${CSS_NS}-skill-row-desc{display:block;margin-top:var(--space-1);color:var(--fg-muted);font-size:var(--text-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.${CSS_NS}-skill-row-slug{flex:none;color:var(--fg-muted);font-size:var(--text-xs)}
.${CSS_NS}-skill-btn-icon{width:13px;height:13px;flex:none}
.${CSS_NS}-skill-desc{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg-muted);font-size:var(--text-xs)}
.${CSS_NS}-skill-cmd{flex:none;color:var(--fg-muted);font-size:var(--text-xs)}
.${CSS_NS}-manual-actions{display:flex;gap:var(--space-2);justify-content:flex-end}
.${CSS_NS}-preview{border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--bg-app);overflow:hidden}
.${CSS_NS}-preview-summary{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);cursor:pointer;list-style:none;font-size:var(--text-sm);font-weight:var(--weight-medium);color:var(--fg-secondary)}
.${CSS_NS}-preview-summary::-webkit-details-marker{display:none}
.${CSS_NS}-preview-hint{margin-left:auto;font-size:var(--text-xs);color:var(--fg-muted);font-weight:var(--weight-normal)}
.${CSS_NS}-preview-body{padding:0 var(--space-4) var(--space-4);display:flex;flex-direction:column;gap:var(--space-3)}
.${CSS_NS}-preview-item{font-size:var(--text-sm)}
.${CSS_NS}-preview-n{color:var(--fg-primary);font-weight:var(--weight-medium)}
.${CSS_NS}-preview-c{margin-top:var(--space-1);color:var(--fg-muted);white-space:pre-wrap}
`

/**
 * 把样式插进 document（幂等：同一个 id 只插一次）。
 * 样式在 factory 执行时立即注入（与宿主其它客户端插件同款做法）。
 * @returns {void}
 */
export function installStyles(): void {
  if (typeof document === 'undefined') return
  const id = 'dsh-session-handoff-styles'
  if (document.getElementById(id) !== null) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `${TOKENS_CSS}\n${PLUGIN_CSS}`
  document.head.appendChild(style)
}

// 模块被物化时立刻注入样式（模块副作用只在首次使用时跑，见 dsh-client-modules README）。
installStyles()
