# DSH 会话接力插件

> 仓库名：`dsh-session-handoff` ｜ 中文名：**DSH 会话接力插件**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green.svg)](package.json)

[English](README.md) | 中文

**把长会话"接力"到一个干净的新会话**：手动 `/handoff`，或让插件在上下文 / 会话变重时自动弹出确认、
生成结构化交接文档、开一个新会话继续干。原会话保持不变。

## 它解决什么问题

DSH 的会话越聊越长之后：历史加载变慢、上下文快满、模型开始忘事。官方有"压缩"（`/compact`）和
"分叉"（fork 整个历史），但没有"总结当前会话 → 开一个干净的新会话 → 接着干"的一键能力。

本插件补的就是这一步：

1. 用 LLM 把最近的对话总结成一份结构化交接文档（用户需求 / 方案梗概 / 已完成 / 涉及文件与产物 / 接下来做什么）；
2. 在同一工作区建一个**全新会话 + agent**（不复制旧历史，继承工作区、模型路由、agent preset）；
3. 把交接文档作为新会话的**第一条消息**注入，并**自动打开**新会话；
4. 旧会话原样保留，标题上留一条回到新会话的标记。

## 特性

- **手动**——`/handoff [<N>|all]`（不填则用配置里的 `turns`，默认 50 轮用户消息）
- **自动**——按策略到点触发；三档模式：**替代**（抢在原生压缩前切）/ **混合**（会话过重时切）/ **原生**（不自动切）
- **先问你**——默认「弹窗确认」，可改成「只提醒」或「全自动」；点过「先不接力」后，触发量**再涨 50%**（可在设置里改）才会重问
- **健康度行**——输入框上方常驻「上下文 xx% ｜ 会话 xxMB ｜ 还能撑约 N 轮」，点开看明细
- **干净的接力**——新会话继承原会话的工作区、模型路由与 agent preset（系统提示 / 工具 / 技能），无上下文臃肿
- **结构化交接文档**——并在磁盘留一份，设置页可翻历次记录
- **自动打开**——客户端等新会话就绪后自动跳转（每个子会话只自动打开一次，历史回放不反复跳）
- **决策留痕**——每次判定都记一条决策日志（选了哪个动作、为什么），设置页可查
- **新会话可预设**——新会话用哪个模型、多强推理、什么工作权限，三项都可选「跟随原会话」
- **零核心改动**——只插入一行 `dsh.bundle.patch`，全部走宿主公开服务

## 安装

要求：DSH 桌面版或 CLI，Node `^22.19.0 || >=24`。

插件是标准的 DSH bundle 包，核心只有两件事：放进**你正在用的 profile** 的 `node_modules`，
并在该 profile 里登记。以桌面版（`desktop` profile）为例：

```sh
# 1) 把仓库放到任意目录
git clone https://github.com/MountBatten718/dsh-session-handoff.git ~/dsh-session-handoff

# 2) 软链进 desktop profile 的 node_modules
ln -s ~/dsh-session-handoff ~/.dsh/profiles/desktop/node_modules/dsh-session-handoff
```

然后在 profile 的 `package.json` 里登记依赖：

```jsonc
{
  "dependencies": {
    "dsh-session-handoff": "link:/Users/you/dsh-session-handoff"
  }
}
```

并把 `dsh-session-handoff` 加进该 profile 的 `dsh.profile.bundles`。重启 DSH 后生效。

> 桌面版的 `desktop` profile 由 Electron 独占，CLI 会拒绝对它执行 `plugin add` / `--dump-config`；
> 想只读验证组合结果，可以做一个**换个名字**的软链指向同一目录再 `--dump-config`。
> 如果你用的是普通 CLI profile，也可以按该 profile 的常规插件安装方式装入本目录。

## 使用

在任意会话输入框敲：

```text
/handoff          # 用配置里的轮数（默认 50 轮用户消息）
/handoff 20       # 总结最近 20 轮
/handoff all      # 总结全部用户消息
```

执行后：命令卡片显示"正在总结…" → LLM 生成交接文档 → 新会话**自动打开**，原会话原样保留并回链。

> ⚠️ **隐私提示**：所选窗口内的对话文本（用户 + 助手消息）会发送给配置的模型用于生成摘要。

## 配置

大多数选项在 **DSH 设置 → 插件 → 会话接力** 里就能改（即时生效）。profile patch 里可写的完整键：

```yaml
- id: handoff
  name: dsh-session-handoff
  config:
    # —— 自动接力 ——
    autoMode: hybrid            # replace（替代）/ hybrid（混合，默认）/ native（原生，不自动切）
    autoPromptLevel: confirm    # confirm（弹窗确认，默认）/ notify（只提醒）/ auto（全自动）
    sessionVolumeBytes: 8388608 # 会话体积阈值（默认 8 MB）
    compactionCountTrigger: null # 每压缩 N 次就切；null/留空 = 不启用
    confirmTimeoutMs: 120000    # 确认弹窗超时（自有硬兜底，不依赖宿主）
    # —— 新会话形态（留空 = 跟随原会话；设置页里可直接选）——
    provider: ''                # 新会话固定用的供应商
    model: ''                   # 新会话固定用的模型（与 provider 成对）
    childReasoningEffort: ''    # 新会话的推理强度（与摘要调用的 reasoningEffort 不是同一个键）
    childPermissionPreset: ''   # 新会话的工作权限：read-only / workspace-write / danger-full-access
    childPlanFirst: true        # 新会话读完交接文档先给计划、等确认再动手（默认开）
    subagentDrainTimeoutMin: 10 # 换会话前等子代理交卷的最长时间（分钟，1–60）
    askRearmPercent: 50         # 点过「先不接力」后，触发量再涨这么多百分点才重问（10~500）
    decisionLogEnabled: true    # 决策日志开关
    # —— 交接文档落盘 ——
    handoffDocPersist: true     # 默认开；落盘目录 = DSH 数据目录
    handoffDocDir: ''           # 留空用默认；只接受绝对路径
    # —— 摘要调用 ——
    turns: 50                   # 取多少轮（1–200）
    maxInputChars: 200000       # 输入字节上限（超限保留头 + 尾）
    maxTokens: 8000             # 输出 token 上限（推理模型会先把预算花在思考上）
    reasoningEffort: inherit    # inherit（默认，跟随会话）| off | high | max
                                # ⚠️ 别默认写 off：部分模型会直接拒绝该参数
    timeoutMs: 120000           # 摘要调用超时
```

未配 `provider` / `model` 时，自动使用当前会话最近一次请求的模型路由。

## 原理

- **宿主侧**（`index.mjs` + `lib/*.mjs`，纯 ESM）：只消费宿主公开服务——`commands`（/handoff）、`llm`、
  `agents`（会话与 agent 一起建，经 `agentPresets.mount` 继承 cwd / 模型路由 / preset）、
  `workspaceRegistry.attachSession`、`sessionTitle.rename`、`userQuestions`（原生问答弹窗）。
  自动接力挂 `agent/pre-step` 瀑布（步骤边界 = 安全点）；客户端经 Typert RPC 读健康度、改配置、手工换会话。
- **客户端侧**（`src/client/` → `scripts/build-client.mjs` → `lib/client.js`）：健康度行 + 设置面板 +
  会话接力卡片；命中成功事件后自动打开子会话（轮询等待可寻址，localStorage 去重）。
- **黑匣子**：每次接力把阶段与结果写进 `<DSH_HOME>/session-handoff-docs/handoff-trace.jsonl`，
  长文本脱敏成 `[omitted N chars]`，文件超 5 MiB 自动轮转。

## 构建

客户端半区的产物 `lib/client.js` 已随仓库提供；改了 `src/client/**` 之后需要重建：

```sh
node scripts/build-client.mjs           # 重建 lib/client.js
node scripts/build-client.mjs --check   # 校验产物与源码逐字节一致
```

构建脚本只依赖 Node 内建的 TypeScript 类型剥离，不需要安装任何依赖。

## 已知限制

- 支持 DSH `0.1.0-rc.5` 至 `rc.8`、`0.1.1-rc.2` 以及桌面版内核 `0.2.0-rc.2`；
  `0.1.2-alpha.1` 拆分了会话 UI / 服务，需要单独迁移客户端半区。
- `session.snapshotEvents()` 已被宿主标注 `@deprecated`（宿主内部仍在使用）；未来内核换入口时需要跟改。
- 链路状态（第几棒 / 已交接）只存内存：重启后靠旧会话标题上的标记恢复"已交接"，链序号会退化为 1（仅影响展示）。
- 自动接力失败后不会自动重试（避免重复创建会话），可在会话里手工「换会话」。
- 自动跳转依赖客户端轮询时序，真实浏览器下的极端时序仍需按你的 DSH 版本自测。

## 致谢

本项目基于 [WeiYe6/dsh-session-handoff](https://github.com/WeiYe6/dsh-session-handoff)（MIT）扩展而来。
上游提供了 `/handoff` 命令与交接文档的基础实现；本仓库在此基础上增加了自动接力、健康度行、设置面板、
交接文档落盘、决策日志与子代理收尾等待等能力。

## License

[MIT](./LICENSE)
