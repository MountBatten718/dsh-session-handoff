# dsh-session-handoff

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green.svg)](package.json)

English | [中文](README.zh-CN.md)

**Hand your long DSH session over to a clean one.** `/handoff` summarizes the recent conversation with an
LLM, creates a **brand-new session + agent** in the same workspace (no history copied), injects a structured
handoff document as its first message, and **auto-opens** it. The origin session is untouched.

The plugin can also do this **automatically** when the context window or session size gets heavy — after
asking you first, by default.

## Why

Long DSH sessions get slow to load, fill up the context window, and the model starts forgetting things.
DSH ships `/compact` and fork (copy the whole history), but there is no one-click
"summarize this session → start a clean one → keep going". This plugin is that step:

1. Summarize the last N user turns into a structured handoff document
   (goal / approach / done / files / next steps / open questions);
2. Create a fresh session + agent in the same workspace, inheriting cwd, model route and agent preset;
3. Inject the handoff document as the new session's first message and **auto-open** it;
4. Leave the origin session intact, with a marker on its title linking to the new one.

## Features

- **Manual** — `/handoff [<N>|all]` (no argument uses the configured `turns`, default 50 user messages)
- **Automatic** — three policies: *replace* (before native compaction) / *hybrid* (when the session gets heavy) /
  *native* (never switch automatically)
- **Asks first** — confirm popup by default; `notify` / `auto` modes available. After you dismiss a suggestion,
  the trigger level must grow by another 50% before asking again
- **Health row** — a persistent "context xx% | session xxMB | ~N turns left" line above the composer
- **Clean handoff** — new session inherits workspace, model route and agent preset (system prompt / tools / skills)
- **Structured document** — persisted to disk as well; browse past handoffs from the settings panel
- **Auto-open** — the client half waits for the child session and navigates to it (once per child, no re-jumps on replay)
- **Decision log** — every decision (action + reason) is recorded and viewable in settings
- **Zero core changes** — a single `dsh.bundle.patch` row; only public host services are used

## Install

Requires DSH desktop or CLI with Node `^22.19.0 || >=24`.

The plugin is a standard DSH bundle: put it into the `node_modules` of **the profile you are using**, then
register it there. Example for the desktop profile:

```sh
# 1) put the repository anywhere
git clone https://github.com/MountBatten718/dsh-session-handoff.git ~/dsh-session-handoff

# 2) link it into the desktop profile's node_modules
ln -s ~/dsh-session-handoff ~/.dsh/profiles/desktop/node_modules/dsh-session-handoff
```

Then register the dependency in that profile's `package.json`:

```jsonc
{
  "dependencies": {
    "dsh-session-handoff": "link:/Users/you/dsh-session-handoff"
  }
}
```

and add `dsh-session-handoff` to the profile's `dsh.profile.bundles`. Restart DSH to apply.

> The `desktop` profile is owned exclusively by the Electron app, so the CLI refuses `plugin add` /
> `--dump-config` for that name; point a differently-named symlink at the same directory for a read-only check.
> For a regular CLI profile, install this directory the same way you install other local plugins.

## Usage

Type in any conversation's input box:

```text
/handoff          # use the configured turns (default 50 user messages)
/handoff 20       # summarize the last 20 user turns
/handoff all      # summarize every user message
```

What happens: the command card shows "summarizing…" → the LLM produces the handoff document →
the new session **auto-opens**; the origin session stays intact and is linked back.

> ⚠️ **Privacy**: the recent conversation text (user + assistant messages in the requested window) is sent
> to the configured model to produce the summary.

## Configuration

Most options live in **DSH → Settings → Plugins → session handoff** (applied immediately). Full profile patch:

```yaml
- id: handoff
  name: dsh-session-handoff
  config:
    autoMode: hybrid            # replace / hybrid (default) / native
    autoPromptLevel: confirm    # confirm (default) / notify / auto
    sessionVolumeBytes: 8388608 # session size threshold (default 8 MB)
    compactionCountTrigger: null # switch after N compactions; null = disabled
    confirmTimeoutMs: 120000    # confirm popup timeout (own hard fallback)
    provider: ''                # fixed provider for the new session
    model: ''                   # fixed model (pair with provider)
    childReasoningEffort: ''    # reasoning effort of the new session
    childPermissionPreset: ''   # read-only / workspace-write / danger-full-access
    childPlanFirst: true        # new session presents a plan first (default on)
    subagentDrainTimeoutMin: 10 # minutes to wait for direct subagents to wrap up (1-60)
    askRearmPercent: 50         # re-ask after the trigger grows by another N points (10-500)
    decisionLogEnabled: true
    handoffDocPersist: true     # persist handoff documents to disk (default on)
    handoffDocDir: ''           # absolute dir; empty = DSH data dir
    turns: 50                   # user-message rounds to extract (1-200)
    maxInputChars: 200000       # input byte cap (oldest dropped first)
    maxTokens: 8000             # summary output budget
    reasoningEffort: inherit    # inherit (default) | off | high | max
                                # ⚠️ do NOT default to 'off': some models reject it outright
    timeoutMs: 120000           # summary call timeout
```

Without `provider`/`model`, the current session's latest logged model route is used.

## How it works

- **Host half** (`index.mjs` + `lib/*.mjs`, plain ESM): public services only — `commands` (`/handoff`),
  `llm`, `agents` (`ctx.agents.create` — session **and** agent together, inheriting the origin's cwd /
  model route / agent preset via `agentPresets.mount`), `workspaceRegistry.attachSession`,
  `sessionTitle.rename`, `userQuestions`. Automatic handoff hooks `agent/pre-step` (step boundary = safe point).
  The client half reads health, edits config and triggers manual handoffs over Typert RPC.
- **Client half** (`src/client/` → `scripts/build-client.mjs` → `lib/client.js`): health row, settings panel
  and handoff card; a `handoff` conversation node auto-opens the child session.
- **Black box**: every handoff writes stages and outcomes to
  `<DSH_HOME>/session-handoff-docs/handoff-trace.jsonl` (long text redacted, rotates at 5 MiB).

## Build

`lib/client.js` is committed; after editing `src/client/**`, rebuild it:

```sh
node scripts/build-client.mjs           # rebuild lib/client.js
node scripts/build-client.mjs --check   # verify the artifact matches the sources byte-for-byte
```

The build script uses only Node's built-in TypeScript type stripping — no dependencies to install.

## Known limitations

- Supports DSH `0.1.0-rc.5` through `rc.8`, `0.1.1-rc.2`, and the desktop kernel `0.2.0-rc.2`.
  DSH `0.1.2-alpha.1` split the conversation UI/service and needs a separate client-side migration.
- `session.snapshotEvents()` is marked `@deprecated` by the host (it still uses it internally); a future
  kernel may need a different read entry point.
- Chain state (which handoff in the chain, "already handed off") is **in-memory only**; after a restart it is
  recovered from the marker on the old session's title, so the chain index degrades to 1 (display only).
- A failed automatic handoff is **not retried automatically**; use the manual "hand off" button instead.
- Auto-open relies on client-side polling; verify edge timing on your DSH version.

## Credits

Based on [WeiYe6/dsh-session-handoff](https://github.com/WeiYe6/dsh-session-handoff) (MIT), which provides the
original `/handoff` command and handoff-document implementation. This fork adds automatic handoff, the health
row, the settings panel, document persistence, decision logging and subagent drain waiting.

## License

[MIT](./LICENSE)
