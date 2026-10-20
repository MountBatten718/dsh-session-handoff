// 启动自检日志：回答"DSH 到底加载了哪一版插件、模型目录为什么读不到"。
//
// 背景（2026-10-13）：用户反复重启，界面上却一直看不到新功能；而我这边确认磁盘上的代码
// 已经含全部修复、软链路径与内容指纹也一致 —— 中间有一层看不见的东西。
// 与其继续猜，不如让**插件自己在每次启动时留下硬证据**：宿主脚本的 mtime（＝跑的是哪一版）
// 加上关键服务的可见性与数量。下次重启后读这个文件，就能一次性定性。
//
// 只写进插件自己的文档目录（`session-handoff-docs`），碰不到会话数据；任何失败都静默。

import { appendFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 自检日志文件名（放在插件的文档目录下）。 */
export const BOOT_LOG_NAME = 'plugin-boot.log'

/**
 * 宿主脚本的 mtime —— "当前跑的是哪一版"最硬的指纹（内容都一致时它也能分辨新旧）。
 * @returns {Promise<string>} ISO 时间；读不到就返回 `unknown`。
 */
export async function hostBuildTag() {
  try {
    const info = await stat(join(HERE, 'handoff-rpc.mjs'))
    return new Date(info.mtimeMs).toISOString()
  } catch {
    return 'unknown'
  }
}

/**
 * 采集一份启动自检（全字段都可能缺失，绝不抛）。
 * @param {object} ctx - 插件上下文。
 * @returns {Promise<object>} 自检记录（可直接 JSON 序列化）。
 */
export async function probeBoot(ctx) {
  const record = { at: new Date().toISOString(), hostScriptMtime: await hostBuildTag() }
  const get = (name) => {
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }
  const sessionController = get('sessionController')
  const llm = get('llm')
  const settings = get('settings')
  record.hasSessionController = typeof sessionController?.modelCatalog === 'function'
  record.hasLlm = typeof llm?.listProviders === 'function'
  record.hasSettings = typeof settings?.describe === 'function'
  // 权限档位服务（设置页"新会话的工作权限"靠它）；缺失不是错误，但要能一眼看出来。
  const permissionPresets = get('permissionPresets')
  record.hasPermissionPresets = typeof permissionPresets?.catalog === 'function'
  // 供排查：这几个服务在插件 ctx 里到底可不可见（真机 v1.2 就是靠这个定性的）。
  record.visibleServices = ['sessionController', 'llm', 'settings', 'permissionPresets', 'agents', 'sessions']
    .filter((name) => {
      try {
        return ctx.get(name) !== undefined
      } catch {
        return false
      }
    })
  try {
    record.providerCount = llm.listProviders().length
  } catch (error) {
    record.providerCount = `err:${String(error?.message ?? error)}`
  }
  try {
    record.configurableCount = llm.listConfigurableProviders().length
  } catch (error) {
    record.configurableCount = `err:${String(error?.message ?? error)}`
  }
  try {
    record.settingsNamespaces = settings
      .describe({ redactSecrets: true })
      .map((namespace) => namespace?.ns)
      .slice(0, 8)
  } catch (error) {
    record.settingsNamespaces = `err:${String(error?.message ?? error)}`
  }
  // ★ 2026-10-14：模型目录到底读出来了没有 —— 直接记录"每个供应商能从设置里读到几个模型"。
  //   这一步能一次区分三种情况：① 读不到 settings；② 读到了但结构不对；③ 读到了却没进下拉。
  try {
    const configurable = typeof llm?.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() : []
    const namespaces = typeof settings?.describe === 'function' ? settings.describe({ redactSecrets: true }) : []
    record.namespaceCount = Array.isArray(namespaces) ? namespaces.length : 'n/a'
    // 只记「真的读出模型」的那些（前 8 个全是内置声明，看不到用户自己的 provider）。
    /** @type {string[]} */
    const withModels = []
    for (const entry of Array.isArray(configurable) ? configurable : []) {
      let profile = namespaces.find((namespace) => namespace?.ns === entry?.settingsNs)?.value
      for (const key of entry?.settingsPath ?? []) {
        profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
      }
      const models = typeof profile === 'object' && profile !== null ? profile.models : undefined
      if (Array.isArray(models) && models.length > 0) withModels.push(`${String(entry?.provider)}=${models.length}`)
    }
    record.customModelsWithData = withModels.slice(0, 8)
    record.customModelsChecked = Array.isArray(configurable) ? configurable.length : 'n/a'
    // dump 关键 namespace 的**真实结构**（路径猜错时靠它定位）
    const piAi = namespaces.find((namespace) => namespace?.ns === 'llm-pi-ai')
    record.piAiTopKeys = piAi === undefined ? 'no-ns' : Object.keys(piAi.value ?? {}).slice(0, 8)
    record.piAiProviderKeys = piAi?.value?.providers === undefined ? 'no-providers' : Object.keys(piAi.value.providers).slice(0, 12)
    record.customModels = (Array.isArray(configurable) ? configurable : []).slice(0, 8).map((entry) => {
      let profile = namespaces.find((namespace) => namespace?.ns === entry?.settingsNs)?.value
      for (const key of entry?.settingsPath ?? []) {
        profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
      }
      const models = typeof profile === 'object' && profile !== null ? profile.models : undefined
      return `${String(entry?.provider ?? '?')}@${String(entry?.settingsNs ?? '?')}|${(entry?.settingsPath ?? []).join('.')}=${Array.isArray(models) ? models.length : '无'}`
    })
  } catch (error) {
    record.customModels = `err:${String(error?.message ?? error)}`
  }
  return record
}

/**
 * 追加一条自检记录。
 * @param {string} dir - 插件文档目录。
 * @param {object} record - 自检记录。
 * @returns {Promise<boolean>} 是否写入成功（失败不抛）。
 */
export async function appendBootLog(dir, record) {
  try {
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, BOOT_LOG_NAME), `${JSON.stringify(record)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
