window.__ModuleLoader__.load({
	id: "dsh-session-handoff",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var __modules = {
    "./src/client/index.ts": (exports, __req) => {
      // dsh-session-handoff 客户端半区（browser half）——本块交付：
      //   1) 健康度行（S2，核心界面）挂 `conversation.composer.dock`（**横向一行**的那个槽位，与原生占用条同容器；`conversation.input.dock` 是垂直列，会竖着堆）
      //   2) 设置页（S1）挂 `settings.section`
      //   3) 换会话确认卡片（S3）走宿主的 `remote.sessionHandoff.confirm`（宿主侧弹原生问答弹窗）
      //   4) 上游蓝本的自动跳转卡片（`conversation.chat.node`）原样保留
      //
      // ⚠️ 与宿主通信**只能**走 `ctx.remote.$mount(contribution)` + `ctx.get('remote.sessionHandoff')`：
      //    客户端插件的 `ctx.get('sessionHandoff')` 拿不到宿主进程里的那个对象（两侧不是同一张服务表）。
      //    （宿主与客户端不共享服务表，只有 Typert 远程通道能跨进程调用。）
      //
      // ⚠️ 本文件**不 import 任何宿主 UI 包**：只用 react + 原生元素 + 本地 CSS 变量。
      //    插槽名与包名对了不代表能当 API 用（PK-008）。

      const {createElement: h, useCallback, useEffect, useMemo, useRef, useState} = __req("react")
      const {HandoffOpenCard} = __req("./src/client/HandoffOpenCard.tsx")
      const {extractChildId, isHandoffDone} = __req("./src/client/parse.ts")
      const {Bar, Button, CSS_NS, NumberInput, Row, Segmented, Switch, cx} = __req("./src/client/ui.ts")
      const {HEALTH_BACKOFF_MAX_MS, HEALTH_POLL_MS, HEALTH_WARMUP_MAX_TRIES, HEALTH_WARMUP_MS, MODE_CARDS, PROMPT_LEVELS, DANGER_PERMISSION, FOLLOW_VALUE, ariaSummary, buildConfigPatch, buildModelOptions, buildPermissionOptions, buildSessionDefaultsPatch, bytesToMb, clampNoteByCodePoints, detailTimeLine, docListViewModel, docTriggerReasonOf, drainBannerTextOf, drainDraftOf, EMPTY_DRAIN_LATCH, filterSkills, handoffPreviewOf, insertSkillText, noteAutoGrowHeightPx, latchDrain, noteCountIsFull, noteCountText, noteLengthOf, pushSkillRef, skillInitialOf, skillGroupsOf, draftSyncDecision, effortOptionsOf, isStaleEpoch, nextChoiceForModel, nextPollStep, parseHandoffDocName, pickRowForSession, rearmDraftOf, sessionDraftFromConfig, unwrapRemote, viewModelOf} = __req("./src/client/view.ts")
      // 默认值取宿主配置模块的**同一份**（不在客户端再写一个 50，避免两边漂移）。
      const {HANDOFF_DEFAULTS, HANDOFF_LIMITS} = __req("./lib/handoff-config.mjs")
      // R4：卡片逐字文案与限长与宿主同源（清单 §3.7）。
      const {R4_TEXTS, R4_HINTS, R5_HINTS, SUBAGENT_TEXTS, CLIENT_STATS_TIMEOUT_MS, HANDOFF_DOC_SECTION_TITLES, MAX_NOTE_CHARS} = __req("./lib/constants.mjs")
      const {resolveWithin} = __req("./lib/timeout.mjs")
      // 设计令牌（`prism.css` 的逐字副本）+ 本插件样式表；两者都由构建脚本内联进 client.js。
      __req("./src/client/styles.ts")

      const name = 'dsh-session-handoff-client'

      // 轮询节奏常量定义在 `view.ts`（纯函数 `nextPollStep` 要用），这里原样再导出，
      // 保持本文件对外的常量出口不变。
      exports.HEALTH_BACKOFF_MAX_MS = HEALTH_BACKOFF_MAX_MS;
      exports.HEALTH_POLL_MS = HEALTH_POLL_MS;
      exports.HEALTH_WARMUP_MAX_TRIES = HEALTH_WARMUP_MAX_TRIES;
      exports.HEALTH_WARMUP_MS = HEALTH_WARMUP_MS

      /**
       * 必需服务：remote（跨进程 RPC）、slots（注册 UI）、sessions（打开会话）、
       * uiConversation（会话事件节点状态机）。
       *
       * ⚠️ 2026-10-10 实机事故修正：这里原写作 `conversationEvents`（上游蓝本针对
       * DSH Desktop 2.0.15 的服务名）。DSH 0.2.0-rc.2 的内核里**已经不存在这个名字**，
       * 于是客户端条目永远停在 `pending (waiting for service: conversationEvents)`，
       * 而 web 启动要求所有条目激活 ⇒ **DSH 直接启动失败**（crash 日志原文：
       * `Error: web boot: 1 entry did not activate`）。
       *
       * 新版的服务是 `uiConversation`（`dsh-client-ui-conversation/lib/client.js`：
       * `super(ctx, "uiConversation")`，其 `.events` 是 `ConversationEventRegistry`），
       * 注册方式为 `ctx.effect(() => ctx.uiConversation.events.register(definition))`，
       * 内核自带范例见 `dsh-client-ui-conversation` 的 `conversation-queue-dock`
       * （`inject: ["slots","conversation","sessions","uiConversation"]`）。
       */
      const inject = ['remote', 'slots', 'sessions', 'uiConversation']

      /** 远程命名空间（与宿主 `lib/typert.host.mjs` 的 `namespace` 必须一致）。 */
      const REMOTE_NAMESPACE = 'sessionHandoff'

      /** 客户端最小上下文接口（**不引入 @deepseek-ai 类型依赖链**，PK-004 的同类纪律）。 */
                                  
                                                                                            
                                                                     
                                       
                                                                           
                
                                                             
                                                                                                                
         
                   
                                       
                                             
                                            
         
       

      /** 远程方法的返回包装（网关口径）。 */
                                                                                                 

      /** `remote.sessionHandoff` 的方法面（我们只声明用到的）。 */
                               
                                                                                                                          
                                                                                          
                                                                                                                                                      
                                                                                     
                                                                                                                               
                                                                                                                                                                  
                                                                                                                                                           
                                                    
                                                                   
                                                       
                                                                             
                                                       
                                                                              
       

      /** R4：`listSkills` 的返回体（裸值；M1 §12.3(b)）。 */
                                  
                                                                                                                         
       

      /** 一行健康度 DTO（shape 由宿主 `lib/handoff-report.mjs` 决定）。 */
                              
                         
                            
                                             
                                                      
                          
                          
                                                            
                          
                          
                                 
                                   
                                   
                                            
                                         
                                        
                              
                              
                                   
                                              
                                       
                                             
                         
                            
                          
                                    
                                   
                          
                     
                                
                               
                                                                                          
       

                               
                        
                                                 
                                                      
                           
                                  
                                             
                                
                                               
                               
                                  
                                   
           
                                                
                           
           
                         
                      
                                                                  
                                     
                                      
                                                            
                                
                                                       
                                        
       

                                
                  
                    
                      
                     
                      
                     
                              
                      
                          
       

                              
                             
                            
                      
                                               
                                   
                                                             
                                                                    
                                 
       

                               
                   
                            
                          
                             
       

                                      
                   
                       
                                     
                             
                            
       

      /** `readHandoffDoc` 的返回体（与 `HandoffRemote` 里的声明一致）。 */
                                   
                      
                           
                           
                              
       

      /**
       * 取远程命名空间服务（没挂上就 undefined——**绝不抛**，UI 要能优雅降级）。
       * @param ctx - 客户端上下文。
       * @returns 远程服务或 undefined。
       */
      function remoteOf(ctx                  )                            {
        try {
          return ctx.get?.(`remote.${REMOTE_NAMESPACE}`)                             
        } catch {
          return undefined
        }
      }

      /**
       * 拉一次 stats（失败归一化成错误文本）。
       * @param remote - 远程服务。
       * @param sessionIds - 要看的会话 id（健康度行只关心当前会话）。
       * @returns 结果。
       */
      async function fetchStats(remote               , sessionIds          )                                                                            {
        try {
          return unwrapRemote(await remote.stats(sessionIds, 50, 'all'))                                                                    
        } catch (error) {
          return { ok: false, error: String((error         )?.message ?? error) }
        }
      }

      /**
       * 轮询 stats 的小 hook（页面不可见时自动停，出错指数退避）。
       *
       * P2-9 修复（2026-10-12 代码审查）：
       *   1) **代次守卫**：每次 effect 重跑（ctx / sessionId 变化）都把代次 +1；
       *      旧代次的响应一律丢弃，绝不覆盖新状态。
       *   2) **一定续期**：下一个定时器在 `run()` 的收尾处无条件重排（成功、业务失败、
       *      调用抛错三条路都排），所以 `tick` 抛错不会让轮询静默死掉。
       *   3) 抛错**不吞**：给出可解释的错误文案（下次重试时自动清掉）。
       *
       * @param ctx - 客户端上下文。
       * @param sessionIds - 会话 id。
       * @returns 轮询状态。
       */
      function useStats(ctx                  , sessionIds          , statsTimeoutMs = CLIENT_STATS_TIMEOUT_MS)   
                            
                      
                           
        {
        const remote = useMemo(() => remoteOf(ctx), [ctx])
        const [stats, setStats] = useState                          (undefined)
        const [error, setError] = useState                    (undefined)
        const backoff = useRef(HEALTH_POLL_MS)
        const timer = useRef                                           (undefined)
        /** 已经"等数据"快轮询过几次（见 nextPollStep 的 warmupTried）。 */
        const warmup = useRef(0)
        /** 代次：effect 每重跑一次 +1；旧代次的响应全部作废。 */
        const epoch = useRef(0)
        /** 给外部 `refresh()` 用的"立刻拉一次"入口（effect 里挂上，卸载时拆掉）。 */
        const runRef = useRef            (() => undefined)
        /** 在途请求标记：`refresh()` 连点 / 轮询重叠时**不叠加请求**，只记一次"完了再拉一轮"。 */
        const inFlight = useRef(false)
        const rerunRequested = useRef(false)
        /** 有界等待：host 若对某会话永不返回，这里到点给出可解释失败态（不再永久转圈）。 */
        const effectiveTimeoutMs = typeof statsTimeoutMs === 'number' && statsTimeoutMs > 0 ? statsTimeoutMs : CLIENT_STATS_TIMEOUT_MS
        const key = sessionIds.join(',')

        const tick = useCallback(async (myEpoch        )                       => {
          if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
          if (remote === undefined) {
            setError('宿主半边的 remote.sessionHandoff 没挂上')
            return 'fail'
          }
          let result                                                                  
          try {
            // 2026-10-20 真机：宿主对子会话可能永不返回（既不 resolve 也不 reject）。
            // 这里与 host 的 stats 有界等待形成双保险；超时后给**可解释失败态**，用户能点「重试」。
            const raced = await resolveWithin(fetchStats(remote, sessionIds), { timeoutMs: effectiveTimeoutMs, label: 'client stats' })
            if (raced.status === 'timeout') {
              if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
              setError(R5_HINTS.CLIENT_STATS_TIMEOUT_TEMPLATE.replace('{sec}', String(Math.max(1, Math.round(effectiveTimeoutMs / 1000)))))
              return 'fail'
            }
            result = raced.value
          } catch (thrown) {
            // fetchStats 内部已经兜了一层；这里保证 tick 本身绝不抛穿，且给出人话。
            if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
            setError(`读取会话用量失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
            return 'throw'
          }
          if (isStaleEpoch(myEpoch, epoch.current)) return 'ok'
          if (result.ok) {
            setStats(result.value)
            setError(undefined)
            // 「还在等我自己的数据」：当前会话没有出现在 rows 里（老会话刚点开、宿主那侧还没注册它）。
            // 这既不是错误也不是"读不到"，但界面会停在"正在读取会话用量…"⇒ 交给 nextPollStep 走快轮询，
            // 让数据一到位界面就自己出现，不用用户手点「重试」。
            const wanted = sessionIds[0]
            const missing = typeof wanted === 'string' && wanted.length > 0
              && !(result.value?.rows ?? []).some((row) => row.sessionId === wanted)
            return missing ? 'warming' : 'ok'
          }
          setError(result.error)
          return 'fail'
        }, [remote, key, effectiveTimeoutMs])

        useEffect(() => {
          epoch.current += 1
          const mine = epoch.current
          let stopped = false

          const run = async ()                => {
            // 「重试」连点 / 轮询与手动刷新重叠：不叠加请求，只记"这一轮结束后再拉一次"。
            if (inFlight.current) {
              rerunRequested.current = true
              return
            }
            inFlight.current = true
            try {
              let outcome              = 'throw'
              try {
                outcome = await tick(mine)
              } catch (thrown) {
                // tick 已保证不抛；这里再兜一层，保证"抛错也续期"这条不变量不靠 tick 自觉。
                if (!stopped && !isStaleEpoch(mine, epoch.current)) {
                  setError(`读取会话用量失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
                }
              }
              // 代次作废 / 已卸载：不再续期（新代次会自己起新一轮）。
              if (stopped || isStaleEpoch(mine, epoch.current)) return
              const hidden = typeof document !== 'undefined' && document.hidden === true
              const step = nextPollStep({ outcome, backoffMs: backoff.current, hidden, warmupTried: warmup.current })
              backoff.current = step.backoffMs
              warmup.current = step.warmupTried
              if (timer.current !== undefined) clearTimeout(timer.current)
              timer.current = setTimeout(() => { void run() }, step.delayMs)
            } finally {
              inFlight.current = false
              // 在途期间用户点过「重试」：此刻**真的重新发起一次**（而不是被吞掉）。
              if (rerunRequested.current && !stopped && !isStaleEpoch(mine, epoch.current)) {
                rerunRequested.current = false
                void run()
              }
            }
          }

          runRef.current = () => { void run() }
          void run()
          return () => {
            stopped = true
            // 代次 +1：卸载/换 key 时，**已经发出去**的那次请求回来也会被判过期 ⇒ 不再 setState、不再续期。
            epoch.current += 1
            runRef.current = () => undefined
            if (timer.current !== undefined) clearTimeout(timer.current)
          }
        }, [tick])

        return {
          stats,
          error,
          // 「重试」= **清掉旧状态、真的重新发起**一次（在途时由 run 合并，连点不会叠加请求）。
          refresh: () => {
            setError(undefined)
            runRef.current()
          },
        }
      }

      // ─────────────────────────── S2 · 健康度行 ───────────────────────────

      /**
       * 一行的视图模型 → JSX。
       * @param props - 属性。
       * @returns 元素。
       */
      function Meter(props                                                                                                  )            {
        return h('span', { className: cx(`${CSS_NS}-meter`) },
          h('span', { className: cx(`${CSS_NS}-meter-label`) }, props.label),
          h('span', { className: cx(`${CSS_NS}-meter-value`) }, props.text),
          // fill 缺席 = 这条指标没有有意义的刻度线（混合/原生模式下的上下文），只显示数字。
          props.fill === undefined ? null : h(Bar, { fill: props.fill, marker: props.marker, level: props.level, label: props.label }),
        )
      }

      /**
       * 健康度行（S2）。
       *
       * 导出是为了方便做组件级验证：健康度行的轮询与失败提示只靠纯函数测不到。
       *
       * @param props - 属性。
       * @returns 元素。
       */
      exports.HealthRow = HealthRow;
      function HealthRow(props                                                                       )            {
        const { ctx, sessionId, statsTimeoutMs } = props
        // `statsTimeoutMs` 只是**测试钩子**（生产不传 = CLIENT_STATS_TIMEOUT_MS）；用于复现"宿主永不返回"。
        const { stats, error, refresh } = useStats(ctx, sessionId.length > 0 ? [sessionId] : [], statsTimeoutMs)
        const [open, setOpen] = useState(false)
        const [busy, setBusy] = useState(false)
        const [notice, setNotice] = useState                    (undefined)
        // —— R4（2026-10-17）手动换会话卡片：全部是**组件本地 state**（D5：不落盘、关页面即丢） ——
        /** 卡片是否打开；点「换会话」只置 true（A1：不动任何数据、零 RPC）。 */
        const [cardOpen, setCardOpen] = useState(false)
        /** 留言草稿（取消后**不清**，下次点「换会话」还在）。 */
        const [draftNote, setDraftNote] = useState('')
        /** 已引用的技能（去重、保持插入顺序），随 `handoffNow` 的第三参交给 host（只存不执行）。 */
        const [skillRefs, setSkillRefs] = useState          ([])
        /** 技能面板是否展开（与卡片独立）。 */
        const [skillPanelOpen, setSkillPanelOpen] = useState(false)
        /** 技能目录的加载态：`undefined` = 还没拉过（零 RPC 直到用户点开面板）。 */
        const [skillState, setSkillState] = useState                                                                                        ({ status: 'idle' })
        const [skillQuery, setSkillQuery] = useState('')
        /** 插入失败/读取失败的残留提示（插入成功后必须清掉，A6）。 */
        const [insertError, setInsertError] = useState                    (undefined)
        /** R4 补：卡片内「交接文档预览」是否展开（默认收起，原型 #qcardDetail）。 */
        const [previewOpen, setPreviewOpen] = useState(false)
        const noteRef = useRef                            (null)
        const skillRootRef = useRef                       (null)

        // R4 补（task-27）：留言框自动增高 —— 2 行起（52px）、长到 4 行封顶（88px）、超出内滚。
        // 原型 r4GrowLeave 口径；纯 DOM 计算，不发任何 RPC。
        useEffect(() => {
          const el = noteRef.current
          if (el === null || !cardOpen) return
          el.style.height = 'auto'
          el.style.height = `${noteAutoGrowHeightPx(el.scrollHeight)}px`
        }, [draftNote, cardOpen])

        // P2-7：**只精确匹配当前会话**。sessionId 为空（挂载早期）时 `rowsFor` 会把所有 live
        // 会话都返回，原来那个 `?? rows[0]` 会把**别的会话**的用量显示成当前会话的。
        // 匹配不到就交给下面的空态（"正在读取…"），宁可显示"读不到"也不张冠李戴。
        const dto = pickRowForSession(stats?.rows, sessionId)
        const model = useMemo(() => (dto === undefined ? undefined : viewModelOf(dto)), [dto])

        // 复核 P2-7：宿主把"上次接力失败"塞进 `stats().errors`（桌面版宿主日志拿不到，
        // 这是唯一能让用户看见失败的通道）。只显示当前会话那一条。
        const failureMessage = (stats?.errors ?? []).find((entry) => entry.sessionId === sessionId)?.message

        // P1-3（2026-10-14）：`drain` 的**本地显示 latch**。
        // host 侧 `skipped` 在 wire 上只驻留 4000ms（ARB-18②），而客户端是定时轮询（正常 3s，
        // 失败退避 6s…60s，hidden 60s）——不加 latch 的话，跳过刚好落在两次轮询之间时，
        // 第三条文案一次都不渲染。契约要求"至少渲染一次且停留 ≥3 秒"（M2 §10.3）。
        const [drainLatch, setDrainLatch] = useState                 (EMPTY_DRAIN_LATCH)
        const incomingDrain = stats?.drain
        useEffect(() => {
          setDrainLatch((previous) => latchDrain({ previous, incoming: incomingDrain, now: Date.now() }))
        }, [incomingDrain])
        // 驻留下限到点才允许清空（用真定时器；测试用假定时器推进，不真等 3 秒）。
        useEffect(() => {
          if (drainLatch.value === null) return undefined
          const remain = Math.max(0, drainLatch.until - Date.now())
          const timer = setTimeout(() => {
            setDrainLatch((previous) => latchDrain({ previous, incoming: null, now: Date.now() }))
          }, remain)
          return () => clearTimeout(timer)
        }, [drainLatch])
        /** R2：子代理收尾的运行期文案（latch 后渲染；从未收到过 ⇒ undefined ⇒ 不渲染）。 */
        const drainText = drainBannerTextOf(drainLatch.value)

        const levelToken = (model?.levelToken ?? 'ok')                            
        // R6（2026-10-20 止血，维护者决定）：子代理会话**照常显示健康度**，但手动「换会话」置灰。
        // 判据来自宿主 RPC 的 `subagent` 字段（内核强制字段 + 投影算出来的），客户端不猜标题。
        const isSubagent = dto?.subagent === true

        const doHandoff = useCallback(async (options                                          ) => {
          const remote = remoteOf(ctx)
          if (remote === undefined) {
            setNotice('宿主半边的 remote.sessionHandoff 没挂上')
            return
          }
          setBusy(true)
          // ⚠️ 必须有 try/catch：RPC **调用本身**抛错时（编解码拒绝、传输失败、宿主半边没挂上），
          //    没有兜底就会让 `busy` 永远停在 true —— 按钮变"处理中…"、再点没反应、也不给任何提示。
          //    （2026-10-10 实机事故：宿主返回的结果少了 `childSessionId`、多了 `sessionId`，
          //      被严格 codec 拒绝，用户看到的就是"点了没反应"。）
          let result                                 
          try {
            // R4：第三参**可选**；不传 ⇒ 与旧行为逐字节一致（A7 兼容）。
            // 留言与技能引用在**这一刻**一次性采集完（先于 drain，M1 §12.5）。
            result = unwrapRemote(await remote.handoffNow(sessionId, 'client', options))
          } catch (thrown) {
            setBusy(false)
            setNotice(`换会话调用失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
            return
          }
          setBusy(false)
          // ⚠️ **两层 ok**（2026-10-14 PK-030）：外层 `result.ok` 是**网关的信封**
          //    （一次一元调用恒为 `{ok,value}` / `{ok,error}`），内层 `value.ok` 才是宿主服务自己的结果。
          //    以前只看外层 ⇒ 宿主明明返回失败（ok:false + error），界面照样报"换会话已开始执行"。
          if (!result.ok) {
            setNotice(`换会话没成功：${result.error}`)
          } else {
            const value = result.value                                    
            if (value?.ok === true) {
              // 成功（含排队）：关卡片；留言草稿保留在 state（用户在弹下一张卡时还能看到上次写的）。
              setCardOpen(false)
              setSkillPanelOpen(false)
              setNotice(value.queued === true ? '已排队：等当前这一步结束后执行换会话' : '换会话已开始执行')
            } else {
              // M2 §11.5：`ok:false` ⇒ 卡片**不关**（用户可改留言重试）。
              setNotice(`换会话没成功：${value?.error ?? '未知原因'}`)
            }
          }
          refresh()
        }, [ctx, sessionId, refresh])

        // R4：技能面板**首次展开时才拉目录**（A1：出卡片零 RPC；失败 → 面板错误态，不阻塞换会话）。
        // ⚠️ 用 ref 做「在途」守卫，而不是把 `skillState.status` 放进依赖：
        //    否则 `idle→loading` 这次 setState 会触发 effect 重跑 → cleanup 把在途请求判成"已卸载"，
        //    结果永远停在「正在读取技能…」（组件测试抓到的真 bug）。
        const skillLoadingRef = useRef(false)
        useEffect(() => {
          if (!skillPanelOpen || skillLoadingRef.current || skillState.status !== 'idle') return undefined
          const remote = remoteOf(ctx)
          if (remote === undefined || typeof remote.listSkills !== 'function') {
            setSkillState({ status: 'error', error: R4_HINTS.LIST_SKILLS_UNSUPPORTED })
            return undefined
          }
          let stopped = false
          skillLoadingRef.current = true
          setSkillState({ status: 'loading' })
          void (async () => {
            try {
              const result = unwrapRemote(await remote.listSkills(sessionId))
              if (!stopped) {
                if (result.ok) {
                  const value = result.value                                
                  setSkillState({ status: 'ok', skills: Array.isArray(value?.skills) ? value.skills : [] })
                } else {
                  setSkillState({ status: 'error', error: result.error })
                }
              }
            } catch (thrown) {
              if (!stopped) setSkillState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
            } finally {
              skillLoadingRef.current = false
            }
          })()
          return () => { stopped = true }
        }, [skillPanelOpen, ctx, sessionId])

        // R4：关面板三条路之「点面板外」（点「技能」按钮本身在 root 内，交给按钮自己的开关）。
        useEffect(() => {
          if (!skillPanelOpen) return undefined
          const onDocDown = (event                      ) => {
            const node = skillRootRef.current
            const target = event?.target
            if (node && target && typeof node.contains === 'function' && node.contains(target        )) return
            setSkillPanelOpen(false)
          }
          document.addEventListener('mousedown', onDocDown                 )
          return () => document.removeEventListener('mousedown', onDocDown                 )
        }, [skillPanelOpen])

        /** 技能面板点行：插入逐字 ` /技能名 ` 到**光标处**；面板不关、清残留错误（A5/A6）。 */
        const applySkill = useCallback((skill            ) => {
          const el = noteRef.current
          if (noteLengthOf(draftNote) >= MAX_NOTE_CHARS) {
            setInsertError(R4_HINTS.NOTE_FULL)
            return
          }
          const inserted = insertSkillText({
            note: draftNote,
            name: skill.name,
            start: el?.selectionStart ?? undefined,
            end: el?.selectionEnd ?? undefined,
          })
          setDraftNote(inserted.note)
          setSkillRefs((previous) => pushSkillRef(previous, skill.ref))
          setInsertError(undefined)
          if (el && typeof el.setSelectionRange === 'function' && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => el.setSelectionRange(inserted.caret, inserted.caret))
          }
        }, [draftNote])

        /** Esc：面板开着就先关面板，否则关卡片（三条关闭路之一）。 */
        const onCardKeyDown = useCallback((event                                               ) => {
          if (event?.key !== 'Escape') return
          event.preventDefault?.()
          if (skillPanelOpen) setSkillPanelOpen(false)
          else setCardOpen(false)
        }, [skillPanelOpen])

        if (model === undefined) {
          return h('div', { className: cx(`${CSS_NS}-health`), 'data-level': 'ok' },
            h('span', { className: cx(`${CSS_NS}-health-empty`) }, error === undefined ? '正在读取会话用量…' : `读取不到会话用量：${error}`),
            h(Button, { onClick: refresh, title: '重新读取', children: '重试' }),
            failureMessage === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-failure`) }, failureMessage),
          )
        }

        const conclusion = model.conclusion
        return h('div', { className: cx(`${CSS_NS}-health`), 'data-level': levelToken, 'aria-label': ariaSummary(model) },
          h('div', { className: cx(`${CSS_NS}-health-main`) },
            h(Meter, { label: '上下文', text: model.context.text, fill: model.context.fill, marker: model.context.marker, level: levelToken }),
            h(Meter, { label: '会话', text: model.volume.text, fill: model.volume.fill, marker: model.volume.marker, level: levelToken }),
            h('button', {
              type: 'button',
              className: cx(`${CSS_NS}-verdict`),
              'aria-expanded': open,
              title: '点开看明细',
              onClick: () => setOpen((value) => !value),
            }, conclusion.text),
            h(Button, {
              variant: 'primary',
              onClick: () => { if (isSubagent) return; setCardOpen(true) },
              disabled: busy || isSubagent,
              title: isSubagent ? SUBAGENT_TEXTS.DISABLED_HINT : '手工换会话（优先级最高）',
              children: busy ? '处理中…' : '换会话',
            }),
          ),
          notice === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-notice`) }, notice),
          // R4（2026-10-17）：手动换会话的**自绘卡片**（出卡片零 RPC；取消保留草稿；A1/A5/A6）。
          // 文案逐字来自 R4_TEXTS（清单 §1）；技能面板数据来自 listSkills（首次展开才拉）。
          cardOpen ? h('div', {
            className: cx(`${CSS_NS}-manual-card`),
            role: 'dialog',
            'aria-label': R4_TEXTS.CARD_TITLE,
            onKeyDown: onCardKeyDown,
          },
          h('div', { className: cx(`${CSS_NS}-manual-title`) }, R4_TEXTS.CARD_TITLE),
          h('div', { className: cx(`${CSS_NS}-manual-facts`) },
            h('span', null, conclusion.text),
            h('span', null, `上下文 ${model.context.text}`),
            h('span', null, `会话 ${model.volume.text}`),
          ),
          h('div', { className: cx(`${CSS_NS}-manual-label`) }, R4_TEXTS.NOTE_LABEL),
          h('div', { className: cx(`${CSS_NS}-manual-hint`) }, R4_TEXTS.NOTE_HINT),
          h('textarea', {
            className: cx(`${CSS_NS}-manual-note`),
            'aria-label': R4_TEXTS.NOTE_LABEL,
            rows: 2,
            maxLength: MAX_NOTE_CHARS,
            placeholder: R4_TEXTS.NOTE_PLACEHOLDER,
            value: draftNote,
            ref: noteRef,
            onChange: (event                                  ) => setDraftNote(clampNoteByCodePoints(event.target.value)),
          }),
          h('div', {
            className: cx(`${CSS_NS}-manual-count`),
            ...(noteCountIsFull(draftNote) ? { 'data-full': 'true' } : {}),
          }, noteCountText(draftNote)),
          h('div', { className: cx(`${CSS_NS}-manual-hint`) }, R4_TEXTS.NOTE_EMPTY_HINT),
          h('div', { className: cx(`${CSS_NS}-manual-skillbar`), ref: skillRootRef },
            h(Button, {
              variant: 'ghost',
              onClick: () => setSkillPanelOpen((value) => !value),
              children: [
                h('svg', {
                  key: 'star',
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  'stroke-width': '1.8',
                  'stroke-linecap': 'round',
                  'stroke-linejoin': 'round',
                  'aria-hidden': 'true',
                  className: cx(`${CSS_NS}-skill-btn-icon`),
                }, h('path', { d: 'M12 3l2.1 5.1L19.5 10l-4.3 3.5 1.2 5.5L12 16.2 7.6 19l1.2-5.5L4.5 10l5.4-1.9z' })),
                R4_TEXTS.SKILL_BUTTON,
              ],
            }),
            skillPanelOpen ? h('div', { className: cx(`${CSS_NS}-skill-panel`), role: 'dialog', 'aria-label': R4_TEXTS.SKILL_BUTTON },
              h('div', { className: cx(`${CSS_NS}-skill-hint`) }, R4_TEXTS.SKILL_PANEL_HINT),
              h('input', {
                className: cx(`${CSS_NS}-skill-search`),
                'aria-label': R4_TEXTS.SKILL_SEARCH_PLACEHOLDER,
                placeholder: R4_TEXTS.SKILL_SEARCH_PLACEHOLDER,
                value: skillQuery,
                onChange: (event                               ) => setSkillQuery(event.target.value),
                onKeyDown: onCardKeyDown,
              }),
              skillState.status === 'loading' ? h('div', { className: cx(`${CSS_NS}-skill-hint`) }, R4_HINTS.SKILL_LOADING) : null,
              skillState.status === 'error' ? h('div', { className: cx(`${CSS_NS}-skill-hint`), 'data-tone': 'error' }, `${R4_HINTS.SKILL_LIST_FAILED}${skillState.error}`) : null,
              insertError === undefined ? null : h('div', { className: cx(`${CSS_NS}-skill-hint`), 'data-tone': 'error' }, insertError),
              ...(() => {
                const filtered = filterSkills(skillState.skills ?? [], skillQuery)
                if (skillState.status === 'ok' && filtered.length === 0) {
                  return [h('div', { key: 'skill-empty', className: cx(`${CSS_NS}-skill-hint`) }, R4_TEXTS.SKILL_EMPTY)]
                }
                return skillGroupsOf(filtered).map((group) => h('div', { key: group.group, className: cx(`${CSS_NS}-skill-group`) },
                  h('div', { className: cx(`${CSS_NS}-skill-group-title`) }, group.label),
                  ...group.skills.map((skill) => h('button', {
                    key: skill.name,
                    type: 'button',
                    className: cx(`${CSS_NS}-skill-row`),
                    onMouseDown: (event                                 ) => { event.preventDefault?.(); applySkill(skill) },
                  },
                  h('span', { className: cx(`${CSS_NS}-skill-row-ico`), 'aria-hidden': 'true' }, skillInitialOf(skill.displayName)),
                  h('span', { className: cx(`${CSS_NS}-skill-row-main`) },
                    h('span', { className: cx(`${CSS_NS}-skill-row-name`) }, skill.displayName),
                    h('span', { className: cx(`${CSS_NS}-skill-row-desc`) }, skill.description),
                  ),
                  h('span', { className: cx(`${CSS_NS}-skill-row-slug`) }, `/${skill.name}`),
                  )),
                ))
              })(),
            ) : null,
          ),
          // R4 补（task-27）：卡片内「交接文档预览」—— 默认收起、纯视觉、零 RPC。
          // 有留言时最上面多一条 `0. 交接人留言`（内容实时跟随输入）；小节数提示随之联动。
          (() => {
            const preview = handoffPreviewOf({ note: draftNote, sectionTitles: HANDOFF_DOC_SECTION_TITLES })
            return h('details', {
              className: cx(`${CSS_NS}-preview`),
              open: previewOpen,
            },
            h('summary', {
              className: cx(`${CSS_NS}-preview-summary`),
              onClick: (event                                 ) => { event.preventDefault?.(); setPreviewOpen((value) => !value) },
            },
            h('span', null, R4_TEXTS.PREVIEW_SUMMARY),
            h('span', { className: cx(`${CSS_NS}-preview-hint`) }, preview.hint),
            ),
            h('div', { className: cx(`${CSS_NS}-preview-body`) },
              ...preview.items.map((item) => h('div', { key: item.n, className: cx(`${CSS_NS}-preview-item`) },
                h('div', { className: cx(`${CSS_NS}-preview-n`) }, item.n),
                h('div', { className: cx(`${CSS_NS}-preview-c`) }, item.c),
              )),
            ),
            )
          })(),
          h('div', { className: cx(`${CSS_NS}-manual-actions`) },
            h(Button, {
              variant: 'primary',
              disabled: busy,
              onClick: () => { void doHandoff({ ...(draftNote.length === 0 ? {} : { note: draftNote }), ...(skillRefs.length === 0 ? {} : { skillRefs }) }) },
              children: busy ? '处理中…' : R4_TEXTS.CONFIRM,
            }),
            h(Button, {
              variant: 'ghost',
              disabled: busy,
              onClick: () => { setCardOpen(false); setSkillPanelOpen(false) },
              children: R4_TEXTS.CANCEL,
            }),
          ),
          ) : null,
          failureMessage === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-failure`) }, failureMessage),
          // R2（ARB-13 / M2 §10.3）：子代理收尾的运行期状态（逐字文案见 `drainBannerTextOf`）。
          // `drain === null` 时不渲染任何新元素（与 v1.1 表现完全一致）。
          drainText === undefined ? null : h('div', { className: cx(`${CSS_NS}-health-notice`) }, drainText),
          // 明细做成**浮层**（绝对定位），展开时不会把同一行里其它插件的东西挤走。
          open ? h('div', { className: cx(`${CSS_NS}-detail-layer`) },
            h('table', { className: cx(`${CSS_NS}-detail`) },
              h('thead', null, h('tr', null,
                h('th', null, '指标'), h('th', null, '当前'), h('th', null, '阈值'), h('th', null, '距离'),
              )),
              h('tbody', null, ...model.detail.map((row) => h('tr', { key: row.label },
                h('td', null, row.label), h('td', null, row.current), h('td', null, row.limit), h('td', null, row.distance),
              ))),
            ),
          ) : null,
        )
      }

      // ─────────────────────────── S1 · 设置页 ───────────────────────────

      /**
       * 交接文档行右侧的箭头（原型 `.doc-row .chev` 里的同一个 svg）。
       * @returns 元素。
       */
      function ChevronIcon()            {
        return h('svg', {
          viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        }, h('path', { d: 'M9 6l6 6-6 6' }))
      }

      /**
       * 交接文档卡头部的小图标（原型 `.doc-head-icon` 里的同一个 svg）。
       * @returns 元素。
       */
      function FileIcon()            {
        return h('svg', {
          viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        },
        h('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z' }),
        h('path', { d: 'M14 3v5h5M9 13h6M9 17h4' }))
      }

      /**
       * 「完全权限」确认弹窗的警示图标（原型 `.modal-icon` 里的同一个 svg）。
       * @returns 元素。
       */
      function WarnIcon()            {
        return h('svg', {
          viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        },
        h('path', { d: 'M12 4.5l8.5 15h-17L12 4.5z' }),
        h('path', { d: 'M12 10v4M12 17h.01' }))
      }

      /**
       * 设置页（S1）。
       *
       * 导出是为了方便做组件级验证：新会话三项的下拉联动、「完全权限」确认弹窗的回退、
       * 文档列表的展开都发生在渲染里。
       *
       * @param props - 属性。
       * @returns 元素。
       */
      exports.SettingsPanel = SettingsPanel;
      function SettingsPanel(props                           )            {
        const { ctx } = props
        const { stats, error, refresh } = useStats(ctx, [])
        const [draft, setDraft] = useState                           (undefined)
        // P2-8：dirty = "用户有还没落盘的改动"。dirty 时宿主 config 变化**不许**覆盖草稿；
        // 保存成功 / 失败回滚后归零，草稿重新跟着宿主走。
        const [dirty, setDirty] = useState(false)
        const [draftMb, setDraftMb] = useState('20')
        const [draftTrigger, setDraftTrigger] = useState('')
        /** 「再涨多少才重问」的草稿（百分比字符串，与 MB / 压缩次数一样走"保存这几项"按钮）。 */
        const [draftRearm, setDraftRearm] = useState(String(HANDOFF_DEFAULTS.askRearmPercent))
        /** R2「等子代理交卷的最长时间」的草稿（分钟字符串，同款"保存 + 失败回滚"）。 */
        const [draftDrainMin, setDraftDrainMin] = useState(String(HANDOFF_DEFAULTS.subagentDrainTimeoutMin))
        const [saving, setSaving] = useState(false)
        const [notice, setNotice] = useState                    (undefined)
        /** 模型目录（S1「新会话用什么样的」；host 旧版本可能没有这个方法）。 */
        const [catalogState, setCatalogState] = useState                                                                                  ({ status: 'loading' })
        /** 工作权限档位表（同上）。 */
        const [presetsState, setPresetsState] = useState                                                                                       ({ status: 'loading' })
        /** 新会话三项的下拉草稿（值与宿主 config 对齐，空串=跟随）。 */
        const [sessionChoice, setSessionChoice] = useState                       ({ model: FOLLOW_VALUE, effort: FOLLOW_VALUE, permission: FOLLOW_VALUE })
        /** 待确认的「完全权限」档位：非 undefined = 确认弹窗开着（此时**还没**落地）。 */
        const [permPending, setPermPending] = useState                    (undefined)
        /** 交接文档列表：是否展开 / 数据 / 每份的正文缓存与读取失败。 */
        const [docListOpen, setDocListOpen] = useState(false)
        const [docState, setDocState] = useState                                                                                      ({ status: 'idle' })
        const [docContent, setDocContent] = useState                        ({})
        const [docErrors, setDocErrors] = useState                        ({})
        const [openDocName, setOpenDocName] = useState                    (undefined)
        /** 正在读的文档（防止同一份被重复读）。 */
        const docInflight = useRef             (new Set())
        // P2-8：保存成功后到 stats "回声"到达之前的记账。没有它，一次 3 秒轮询里
        // 已经发出去的**旧** stats 响应就会把刚保存的值顶回旧值（用户看到开关自己弹回去）。
        const pendingSave = useRef                                        (undefined)

        // P2-8：宿主 config 变化且**不在编辑中**时同步草稿。
        // 原实现 `if (draft !== undefined) return` 只初始化一次，宿主改了再也不跟；
        // 这里改成"每轮 stats 都判一次"，但只有真变了才 setState（`draftSyncDecision` 保证）。
        // 不在渲染期间 setState：所有刷新都走这个 effect。
        useEffect(() => {
          if (stats === undefined) return
          const decision = draftSyncDecision({
            host: stats.config,
            draft,
            dirty,
            pending: pendingSave.current,
          })
          if (decision.clearPending) pendingSave.current = undefined
          if (!decision.sync) return
          const host = stats.config
          setDraft(host)
          setDraftMb(String(bytesToMb(host.sessionVolumeBytes)))
          setDraftTrigger(host.compactionCountTrigger === null ? '' : String(host.compactionCountTrigger))
          setDraftRearm(rearmDraftOf(host))
          setDraftDrainMin(drainDraftOf(host))
        }, [stats, dirty, draft])

        /**
         * P2-8：保存失败 → 草稿回滚成**宿主当前值**并提示。
         * 原实现只 `setNotice`，于是开关停在"用户改过但没存成功"的位置，下一次 patch
         * 还在脏草稿上合并。
         * @param message - 给用户看的提示。
         */
        const rollbackToHost = useCallback((message        ) => {
          pendingSave.current = undefined
          setNotice(message)
          setDirty(false)
          const host = stats?.config
          if (host === undefined) return
          setDraft(host)
          setDraftMb(String(bytesToMb(host.sessionVolumeBytes)))
          setDraftTrigger(host.compactionCountTrigger === null ? '' : String(host.compactionCountTrigger))
          setDraftRearm(rearmDraftOf(host))
          setDraftDrainMin(drainDraftOf(host))
          // 新会话三项也要跟着回滚，否则下拉会停在"用户改过但没存成功"的位置。
          setSessionChoice(sessionDraftFromConfig(host                       ))
        }, [stats])

        const patch = useCallback(async (next                        ) => {
          const remote = remoteOf(ctx)
          if (remote === undefined) {
            setNotice('宿主半边的 remote.sessionHandoff 没挂上，改不了设置')
            return
          }
          const merged = { ...(draft ?? ({}                 )), ...next }
          setDraft(merged)
          setDirty(true)
          setSaving(true)
          // ⚠️ 必须有 try/catch：RPC **调用本身**抛错时（连接没就绪、参数不符、编解码失败），
          //    没有兜底就会让 `saving` 永远停在 true —— 设置页所有控件变灰、再点没反应、也不给提示。
          //    （风格与文案习惯对齐同文件 `doHandoff`。）
          let result                                 
          try {
            result = unwrapRemote(await remote.updateConfig(next                           ))
          } catch (thrown) {
            setSaving(false)
            rollbackToHost(`保存失败：${thrown instanceof Error ? thrown.message : String(thrown)}`)
            return
          }
          setSaving(false)
          // ⚠️ **两层 ok**（2026-10-14 PK-030）：外层 `result.ok` 是网关信封、内层 `value.ok` 才是宿主的结果。
          //    以前只看外层 ⇒ 宿主落盘失败（ok:false + error）也会被显示成"已保存"，用户完全无感。
          if (!result.ok) {
            rollbackToHost(`保存失败：${result.error}`)
            return
          }
          const value = result.value                             
          if (value?.ok !== true) {
            rollbackToHost(`保存失败：${value?.error ?? '未知原因'}`)
            return
          }
          // P2-8：以宿主返回值为准刷新草稿、dirty 归零，并标记"等 stats 追上"。
          pendingSave.current = { before: stats?.config ?? value.config, after: value.config }
          setDraft(value.config)
          setDraftMb(String(bytesToMb(value.config.sessionVolumeBytes)))
          setDraftTrigger(value.config.compactionCountTrigger === null ? '' : String(value.config.compactionCountTrigger))
          setDraftRearm(rearmDraftOf(value.config))
          setDraftDrainMin(drainDraftOf(value.config))
          setDirty(false)
          setNotice(value.rejected.length > 0 ? `已保存；忽略了不可改的键：${value.rejected.join(', ')}` : '已保存')
          refresh()
        }, [ctx, draft, stats, refresh, rollbackToHost])

        const saveNumbers = useCallback(async () => {
          const built = buildConfigPatch({
            enabled: draft?.enabled !== false,
            autoMode: draft?.autoMode,
            autoPromptLevel: draft?.autoPromptLevel,
            sessionVolumeMb: draftMb,
            compactionTrigger: draftTrigger,
            askRearmPercent: draftRearm,
            subagentDrainTimeoutMin: draftDrainMin,
            handoffDocPersist: draft?.handoffDocPersist !== false,
            decisionLogEnabled: draft?.decisionLogEnabled !== false,
          })
          if (!built.ok || built.patch === undefined) {
            setNotice(built.error)
            return
          }
          await patch(built.patch)
        }, [draft, draftMb, draftTrigger, draftRearm, draftDrainMin, patch])

        /**
         * 宿主 config 里"新会话四项"的当前值（用于 `buildSessionDefaultsPatch` 的"只送变化的键"）。
         * 草稿优先：保存是乐观更新，拿草稿比拿 3 秒一轮的 stats 更贴近用户刚看到的状态。
         */
        const sessionHost = useMemo                     (() => {
          const source = draft ?? stats?.config
          return {
            provider: source?.provider,
            model: source?.model,
            childReasoningEffort: source?.childReasoningEffort,
            childPermissionPreset: source?.childPermissionPreset,
          }
        }, [draft, stats?.config])

        // 宿主 config 里这四项变了（含首次到达）就把三项下拉对齐过去。
        useEffect(() => {
          if (stats?.config === undefined) return
          setSessionChoice(sessionDraftFromConfig(stats.config))
        }, [stats?.config?.provider, stats?.config?.model, stats?.config?.childReasoningEffort, stats?.config?.childPermissionPreset])

        // 模型目录 + 权限档位表：挂载时各拉一次；失败/不支持都要能在界面上看出原因。
        useEffect(() => {
          const remote = remoteOf(ctx)
          if (remote === undefined) {
            const message = '宿主半边的 remote.sessionHandoff 没挂上'
            setCatalogState({ status: 'error', error: message })
            setPresetsState({ status: 'error', error: message })
            return
          }
          let stopped = false
          void (async () => {
            try {
              if (typeof remote.listModelCatalog !== 'function') {
                if (!stopped) setCatalogState({ status: 'error', error: '宿主版本较旧，没有 listModelCatalog 这个方法' })
              } else {
                const result = unwrapRemote(await remote.listModelCatalog())
                if (!stopped) {
                  if (result.ok) setCatalogState({ status: 'ok', value: result.value                     })
                  else setCatalogState({ status: 'error', error: result.error })
                }
              }
            } catch (thrown) {
              if (!stopped) setCatalogState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
            }
          })()
          void (async () => {
            try {
              if (typeof remote.listPermissionPresets !== 'function') {
                if (!stopped) setPresetsState({ status: 'error', error: '宿主版本较旧，没有 listPermissionPresets 这个方法' })
              } else {
                const result = unwrapRemote(await remote.listPermissionPresets())
                if (!stopped) {
                  if (result.ok) setPresetsState({ status: 'ok', value: result.value                          })
                  else setPresetsState({ status: 'error', error: result.error })
                }
              }
            } catch (thrown) {
              if (!stopped) setPresetsState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
            }
          })()
          return () => { stopped = true }
        }, [ctx])

        /**
         * 拉一次交接文档列表（`remote.listHandoffDocs`）。
         * ⚠️ 同 `patch`：RPC 调用本身抛错时给一句人话，别让异常变成未处理的 Promise。
         */
        const loadDocs = useCallback(async () => {
          const remote = remoteOf(ctx)
          if (remote === undefined) {
            setDocState({ status: 'error', error: '宿主半边的 remote.sessionHandoff 没挂上' })
            return
          }
          setDocState({ status: 'loading' })
          try {
            const result = unwrapRemote(await remote.listHandoffDocs())
            if (result.ok) setDocState({ status: 'ok', value: result.value                })
            else setDocState({ status: 'error', error: result.error })
          } catch (thrown) {
            setDocState({ status: 'error', error: thrown instanceof Error ? thrown.message : String(thrown) })
          }
        }, [ctx])

        // 挂载就拉一次：列表区的「共 N 份」角标要能直接显示（照原型）。
        useEffect(() => { void loadDocs() }, [loadDocs])

        /**
         * 读一份交接文档的正文（详情 + 列表行里的「触发原因」都用它）。
         * 同一份不会重复读（`docInflight`）。
         * @param name - 文件名。
         */
        const loadDocContent = useCallback(async (name        ) => {
          if (name.length === 0 || docInflight.current.has(name)) return
          docInflight.current.add(name)
          const remote = remoteOf(ctx)
          if (remote === undefined) {
            setDocErrors((prev) => ({ ...prev, [name]: '宿主半边的 remote.sessionHandoff 没挂上' }))
            docInflight.current.delete(name)
            return
          }
          try {
            const result = unwrapRemote(await remote.readHandoffDoc(name, true))
            if (result.ok) {
              const value = result.value                     
              setDocContent((prev) => ({ ...prev, [name]: value.found ? (value.content ?? '(空文档)') : '(这一份已经不在了)' }))
            } else {
              setDocErrors((prev) => ({ ...prev, [name]: `读不到：${result.error}` }))
            }
          } catch (thrown) {
            setDocErrors((prev) => ({ ...prev, [name]: `读取交接文档失败：${thrown instanceof Error ? thrown.message : String(thrown)}` }))
          } finally {
            docInflight.current.delete(name)
          }
        }, [ctx])

        // 宿主旧版本没在 files[] 里给 `reason` 时，逐份把正文读回来解析触发原因（列表行要用）。
        // 每轮最多并发 4 份，读完的会进 docContent ⇒ 下一轮跳过，不会死循环。
        // 宿主 2026-10-12 起直接给 `reason`，这条路径平时不会触发（不会对着每份文档各发一次读）。
        useEffect(() => {
          if (!docListOpen || docState.status !== 'ok') return
          const pending = (docState.value?.files ?? []).filter((file) => {
            const name = typeof file?.name === 'string' ? file.name : ''
            if (name.length === 0) return false
            if (typeof file?.reason === 'string' && file.reason.length > 0) return false
            return docContent[name] === undefined && docErrors[name] === undefined && !docInflight.current.has(name)
          })
          if (pending.length === 0) return
          for (const file of pending.slice(0, 4)) void loadDocContent(String(file?.name))
        }, [docListOpen, docState, docContent, docErrors, loadDocContent])

        /** 每份文档 → 触发原因短标签（正文还没读回来时是 undefined）。 */
        const docReasons = useMemo(() => {
          const map                                     = {}
          for (const [name, content] of Object.entries(docContent)) map[name] = docTriggerReasonOf(content)
          return map
        }, [docContent])

        /** 交接文档列表的视图模型（失败态也给得出来，界面不会静默变空）。 */
        const docView = useMemo                              (() => {
          if (docState.status === 'error') {
            return docListViewModel({ result: { ok: false, error: docState.error ?? 'unknown error' } })
          }
          if (docState.status !== 'ok') return undefined
          return docListViewModel({ result: { ok: true, value: docState.value ?? {} }, reasons: docReasons })
        }, [docState, docReasons])

        const modelOptions = useMemo(
          () => buildModelOptions({ catalog: catalogState.value, current: draft ?? stats?.config }),
          [catalogState.value, draft, stats?.config],
        )
        const effortOptions = useMemo(
          () => effortOptionsOf({
            catalog: catalogState.value,
            modelValue: sessionChoice.model,
            currentEffort: sessionHost.childReasoningEffort,
          }),
          [catalogState.value, sessionChoice.model, sessionHost.childReasoningEffort],
        )
        const permissionOptions = useMemo(
          () => buildPermissionOptions({
            presets: presetsState.value,
            current: sessionChoice.permission === FOLLOW_VALUE ? '' : sessionChoice.permission,
          }),
          [presetsState.value, sessionChoice.permission],
        )

        /**
         * 落地一次新会话三项的选择：**只把真的变了的键**送宿主（全跟随 = 一个键都不送）。
         * @param next - 新的三项选择。
         */
        const applySessionChoice = useCallback((next                       ) => {
          setSessionChoice(next)
          const built = buildSessionDefaultsPatch({ choice: next, host: sessionHost })
          if (built.keys.length === 0) return
          void patch(built.patch                          )
        }, [sessionHost.provider, sessionHost.model, sessionHost.childReasoningEffort, sessionHost.childPermissionPreset, patch])

        const changeModel = useCallback((value        ) => {
          applySessionChoice(nextChoiceForModel({ choice: sessionChoice, catalog: catalogState.value, nextModelValue: value }))
        }, [applySessionChoice, sessionChoice, catalogState.value])

        const changeEffort = useCallback((value        ) => {
          applySessionChoice({ ...sessionChoice, effort: value })
        }, [applySessionChoice, sessionChoice])

        const changePermission = useCallback((value        ) => {
          // 选到「完全权限」**先不落地**：弹确认，取消就保持原样（回退到之前的选项）。
          if (value === DANGER_PERMISSION) {
            setPermPending(value)
            return
          }
          applySessionChoice({ ...sessionChoice, permission: value })
        }, [applySessionChoice, sessionChoice])

        const cancelDanger = useCallback(() => { setPermPending(undefined) }, [])

        const confirmDanger = useCallback(() => {
          setPermPending(undefined)
          applySessionChoice({ ...sessionChoice, permission: DANGER_PERMISSION })
        }, [applySessionChoice, sessionChoice])

        /**
         * 「打开存储目录」：宿主没有"打开目录"这个接口（不新造），所以把目录路径复制给用户，
         * 让他直接在文件管理器里打开。拿不到目录时给一句人话。
         */
        const openDocDir = useCallback(async () => {
          const dir = docState.value?.dir ?? stats?.docDir ?? ''
          if (dir.length === 0) {
            setNotice('还不知道存储目录在哪，先点一下「查看已有交接文档」')
            return
          }
          const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
          if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
            try {
              await clipboard.writeText(dir)
              setNotice(`存储目录已复制：${dir}（在文件管理器里粘贴打开）`)
              return
            } catch {
              // 复制被浏览器拒绝：退化成把路径显示出来。
            }
          }
          setNotice(`存储目录：${dir}`)
        }, [docState.value, stats?.docDir])

        const toggleDocRow = useCallback((name        ) => {
          setOpenDocName((current) => (current === name ? undefined : name))
          if (docContent[name] === undefined && docErrors[name] === undefined) void loadDocContent(name)
        }, [docContent, docErrors, loadDocContent])

        if (stats === undefined) {
          return h('div', { className: cx(`${CSS_NS}-panel`) },
            h('div', { className: cx(`${CSS_NS}-panel-title`) }, '会话接力'),
            h('div', { className: cx(`${CSS_NS}-row-hint`) }, error === undefined ? '正在读取…' : `读取不到配置：${error}`),
          )
        }

        const config = draft ?? stats.config
        return h('div', { className: cx(`${CSS_NS}-panel`) },
          h('div', { className: cx(`${CSS_NS}-panel-head`) },
            h('div', { className: cx(`${CSS_NS}-panel-title`) }, '会话接力'),
            h('div', { className: cx(`${CSS_NS}-panel-sub`) }, '上下文满了或会话太重时，帮你换一个干净的新会话'),
          ),

          // —— 总开关 ——
          h(Row, { title: '启用会话接力', hint: config.enabled ? '已开启' : '已关闭（不换会话、不提示、不触发）' },
            h(Switch, { checked: config.enabled, label: '启用会话接力', disabled: saving, onChange: (next) => { void patch({ enabled: next }) } }),
          ),

          // —— 模式三选一（横向一行三卡；窄屏竖排） ——
          h('div', { className: cx(`${CSS_NS}-group`) },
            h('div', { className: cx(`${CSS_NS}-group-title`) }, '选一个档位'),
            h('div', { className: cx(`${CSS_NS}-modes`) },
              ...MODE_CARDS.map((card) => h('button', {
                key: card.id,
                type: 'button',
                disabled: saving,
                'aria-pressed': config.autoMode === card.id,
                className: cx(`${CSS_NS}-mode`, config.autoMode === card.id && 'is-active'),
                onClick: () => { void patch({ autoMode: card.id                              }) },
              },
              h('div', { className: cx(`${CSS_NS}-mode-head`) },
                h('span', { className: cx(`${CSS_NS}-mode-title`) }, card.title),
                card.recommended ? h('span', { className: cx(`${CSS_NS}-badge`) }, '推荐') : null,
              ),
              h('div', { className: cx(`${CSS_NS}-mode-desc`) }, card.description),
              h('div', { className: cx(`${CSS_NS}-mode-when`) }, card.when),
              card.warning === undefined ? null : h('div', { className: cx(`${CSS_NS}-mode-warn`) }, card.warning),
              )),
            ),
          ),

          // —— 安全阀 ——
          h('div', { className: cx(`${CSS_NS}-group`) },
            h('div', { className: cx(`${CSS_NS}-group-title`) }, '安全阀'),
            h(Row, { title: '会话体积阈值', hint: '混合模式下，会话体积超这条线就换会话（图片/附件已算在里面）' },
              // P2-8：敲输入框也算"编辑中"——否则每 3 秒一次轮询会把用户敲到一半的数字冲掉。
              h(NumberInput, { value: draftMb, onChange: (value) => { setDirty(true); setDraftMb(value) }, unit: 'MB', ariaLabel: '会话体积阈值', min: 1, max: 512 }),
            ),
            h(Row, { title: '每压缩 N 次上下文后执行硬切', hint: '留空 = 不启用；仅混合模式生效；换会话后计数归零' },
              h(NumberInput, { value: draftTrigger, onChange: (value) => { setDirty(true); setDraftTrigger(value) }, placeholder: '留空不启用', ariaLabel: '压缩次数修正线', min: 1, max: 100 }),
            ),
            h(Row, { title: '「先不接力」后再涨多少才重问', hint: '点过「先不接力」后，会话体积再涨这么多才会再问你一次（百分比；默认 50）' },
              h(NumberInput, {
                value: draftRearm,
                onChange: (value) => { setDirty(true); setDraftRearm(value) },
                unit: '%',
                ariaLabel: '再涨多少才重问',
                min: HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT,
                max: HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT,
              }),
            ),
            // R2（2026-10-14）：安全阀**最后一行** —— 换会话前等子代理交卷的最长时间。
            // 文案逐字照《冻结口径清单-2026-10-14》§5 / 原型 S1（里层「打断它」「所有子代理交完卷才换会话」加粗）。
            h('div', { className: cx(`${CSS_NS}-setting-row`) },
              h('div', { className: cx(`${CSS_NS}-setting-label`) },
                h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '换会话前，等子代理交卷的最长时间'),
                h('div', { className: cx(`${CSS_NS}-setting-label-d`) },
                  '先请子代理收尾、写它自己的交接文档；到时间还没完的就',
                  h('strong', null, '打断它'),
                  '，让它专心写文档。',
                  h('strong', null, '所有子代理交完卷才换会话。'),
                ),
              ),
              h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
                h(NumberInput, {
                  value: draftDrainMin,
                  onChange: (value) => { setDirty(true); setDraftDrainMin(value) },
                  unit: '分钟',
                  ariaLabel: '换会话前，等子代理交卷的最长时间',
                  min: HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN,
                  max: HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN,
                }),
              ),
            ),
            h('div', { className: cx(`${CSS_NS}-actions`) },
              h(Button, { variant: 'primary', onClick: () => { void saveNumbers() }, disabled: saving, children: saving ? '保存中…' : '保存这几项' }),
            ),
          ),

          // —— 该换会话的时候怎么做 ——
          h('div', { className: cx(`${CSS_NS}-group`) },
            h('div', { className: cx(`${CSS_NS}-group-title`) }, '该换会话的时候怎么做'),
            // ⚠️ 必须显式实例化泛型参数：`h(Segmented, {…})` 走 `createElement` 时，
            //    `Segmented<T extends string>` 的 T 会被实例化成 `string`（createElement 只按
            //    `FunctionComponent<P>` 反推 P，不会把 props 里的联合类型传回组件泛型），
            //    于是 `next` 是 string、赋不进 `autoPromptLevel` 的联合类型。
            h(Segmented                                  , {
              name: '自动程度',
              value: config.autoPromptLevel,
              options: PROMPT_LEVELS,
              onChange: (next) => { void patch({ autoPromptLevel: next }) },
            }),
            h('div', { className: cx(`${CSS_NS}-row-hint`) }, PROMPT_LEVELS.find((level) => level.id === config.autoPromptLevel)?.description ?? ''),
          ),

          // —— 新会话用什么样的（2026-10-12 新增，照《汇总原型图》1:1） ——
          //    文案 / 顺序 / 层级全部逐字照原型；三项的"当前值"都来自宿主 config（空串 = 跟随）。
          h('div', { className: cx(`${CSS_NS}-card`) },
            h('div', { className: cx(`${CSS_NS}-card-head`) },
              h('h2', { className: cx(`${CSS_NS}-card-title`) }, '新会话用什么样的'),
              h('p', { className: cx(`${CSS_NS}-card-desc`) },
                '新会话开出来之后，',
                h('strong', null, '用哪个模型、想多大力度、能改哪些文件'),
                '。三项都可以选「跟随原会话」——选了就跟现在完全一样。',
              ),
            ),

            // ① 新会话模型
            h('div', { className: cx(`${CSS_NS}-setting-row`) },
              h('div', { className: cx(`${CSS_NS}-setting-label`) },
                h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '新会话模型'),
                h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '第一项是「跟随原会话」；下面是这台机器上真正可用的模型（跟着 DSH 的模型目录走，按供应商分组）。'),
              ),
              h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
                h('select', {
                  className: cx(`${CSS_NS}-select-input`),
                  'aria-label': '新会话模型',
                  value: sessionChoice.model,
                  disabled: saving,
                  onChange: (event                                ) => changeModel(event.target.value),
                },
                h('option', { value: FOLLOW_VALUE }, modelOptions.follow.label),
                ...modelOptions.groups.map((group) => h('optgroup', { key: group.label, label: group.label },
                  ...group.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                )),
                ...modelOptions.extra.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                ),
              ),
            ),
            // 目录读取失败 / 局部失败：必须在界面上看得出来（不静默变空）
            catalogState.status === 'loading'
              ? h('div', { className: cx(`${CSS_NS}-choice-hint`) }, '正在读取模型目录…')
              : null,
            catalogState.status === 'error'
              ? h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, `读不到模型目录：${catalogState.error}`)
              : null,
            ...modelOptions.hints.map((hint, index) => h('div', { key: `model-hint-${index}`, className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, hint)),

            // ② 推理强度（选项跟着上面的模型变；模型选「跟随原会话」时自定义档位禁用）
            h('div', { className: cx(`${CSS_NS}-setting-row`) },
              h('div', { className: cx(`${CSS_NS}-setting-label`) },
                h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '推理强度'),
                h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '选项跟着上面的模型变——每个模型支持的档位不一样。'),
              ),
              h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
                h('select', {
                  className: cx(`${CSS_NS}-select-input`),
                  'aria-label': '推理强度',
                  value: sessionChoice.effort,
                  disabled: saving,
                  onChange: (event                                ) => changeEffort(event.target.value),
                },
                h('option', { value: FOLLOW_VALUE }, effortOptions.follow.label),
                ...effortOptions.options.map((option) => h('option', {
                  key: option.value,
                  value: option.value,
                  disabled: option.disabled === true,
                }, option.label)),
                ),
              ),
            ),
            ...effortOptions.hints.map((hint, index) => h('div', { key: `effort-hint-${index}`, className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, hint)),

            // ③ 新会话的工作权限
            h('div', { className: cx(`${CSS_NS}-setting-row`) },
              h('div', { className: cx(`${CSS_NS}-setting-label`) },
                h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '新会话的工作权限'),
                h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '选「完全权限」时会弹一次确认；「跟随原会话」= 新会话的权限跟当前这个会话一模一样。'),
              ),
              h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
                h('select', {
                  className: cx(`${CSS_NS}-select-input`),
                  'aria-label': '新会话的工作权限',
                  value: sessionChoice.permission,
                  disabled: saving || !permissionOptions.supported,
                  onChange: (event                                ) => changePermission(event.target.value),
                },
                h('option', { value: FOLLOW_VALUE }, permissionOptions.follow.label),
                ...permissionOptions.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                ...permissionOptions.extra.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                ),
              ),
            ),
            presetsState.status === 'loading'
              ? h('div', { className: cx(`${CSS_NS}-choice-hint`) }, '正在读取工作权限档位…')
              : null,
            presetsState.status === 'error'
              ? h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, `读不到工作权限档位：${presetsState.error}`)
              : null,
            permissionOptions.hint === undefined
              ? null
              : h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, permissionOptions.hint),

            // ④ R1（2026-10-14）：新会话先提交计划 —— 紧接「新会话的工作权限」之后。
            // 开关即时写入（与既有开关同款）；右侧文字逐字：开=已开启 / 关=已关闭。
            h('div', { className: cx(`${CSS_NS}-setting-row`) },
              h('div', { className: cx(`${CSS_NS}-setting-label`) },
                h('div', { className: cx(`${CSS_NS}-setting-label-t`) }, '新会话先提交计划'),
                h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '读完交接文档后先给计划，确认后再动手。'),
              ),
              h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
                h('div', { className: cx(`${CSS_NS}-control-inline`) },
                  h('span', { className: cx(`${CSS_NS}-choice-hint`) }, config.childPlanFirst !== false ? '已开启' : '已关闭'),
                  h(Switch, {
                    checked: config.childPlanFirst !== false,
                    label: '新会话先提交计划',
                    disabled: saving,
                    onChange: (next) => { void patch({ childPlanFirst: next }) },
                  }),
                ),
              ),
            ),

            h('div', { className: cx(`${CSS_NS}-choice-hint`) },
              '这三项',
              h('strong', null, '只影响新开出来的会话'),
              '：不改当前会话，也不改 DSH 的全局默认设置。想让某一项保持现状，就选「跟随原会话」。',
            ),
          ),

          // —— 交接文档 ——
          h('div', { className: cx(`${CSS_NS}-group`) },
            h('div', { className: cx(`${CSS_NS}-group-title`) }, '交接文档'),
            h(Row, { title: '把交接文档存到磁盘', hint: `存于 DSH 存储目录，不写入你的项目：${stats.docDir}` },
              h(Switch, { checked: config.handoffDocPersist, label: '交接文档落盘', disabled: saving, onChange: (next) => { void patch({ handoffDocPersist: next }) } }),
            ),

            // 已有交接文档：标题 + 「共 N 份」角标 + 两个按钮
            h('div', { className: cx(`${CSS_NS}-setting-row`) },
              h('div', { className: cx(`${CSS_NS}-setting-label`) },
                h('div', { className: cx(`${CSS_NS}-setting-label-t`) },
                  '已有交接文档 ',
                  h('span', { className: cx(`${CSS_NS}-badge`, `${CSS_NS}-badge-neutral`) }, `共 ${docView?.total ?? '…'} 份`),
                ),
                h('div', { className: cx(`${CSS_NS}-setting-label-d`) }, '按时间倒序（最新在最上面）。点一份就能看当时交接了什么。'),
              ),
              h('div', { className: cx(`${CSS_NS}-setting-control`, `${CSS_NS}-control-right`) },
                h('div', { className: cx(`${CSS_NS}-control-inline`) },
                  h('button', {
                    type: 'button',
                    className: cx(`${CSS_NS}-btn`, 'is-ghost', `${CSS_NS}-btn-sm`),
                    'aria-expanded': docListOpen,
                    onClick: () => setDocListOpen((open) => !open),
                  }, '查看已有交接文档'),
                  h('button', {
                    type: 'button',
                    className: cx(`${CSS_NS}-btn`, 'is-ghost', `${CSS_NS}-btn-sm`),
                    onClick: () => { void openDocDir() },
                  }, '打开存储目录'),
                ),
              ),
            ),

            // 列表（默认收起；点开才显示）
            docListOpen
              ? h('div', { className: cx(`${CSS_NS}-doc-list`) },
                docState.status === 'loading'
                  ? h('div', { className: cx(`${CSS_NS}-doc-more`) }, '正在读取交接文档…')
                  : null,
                docView?.error === undefined
                  ? null
                  : h('div', { className: cx(`${CSS_NS}-doc-more`), 'data-tone': 'error' }, docView.error),
                docView === undefined || docView.ok === false
                  ? null
                  : docView.rows.map((row) => h('button', {
                    key: row.key,
                    type: 'button',
                    className: cx(`${CSS_NS}-doc-row`, openDocName === row.name && 'is-open'),
                    'aria-expanded': openDocName === row.name,
                    onClick: () => toggleDocRow(row.name),
                  },
                  h('span', { className: cx(`${CSS_NS}-doc-when`) }, row.when),
                  h('span', { className: cx(`${CSS_NS}-doc-who`) }, row.who),
                  h('span', { className: cx(`${CSS_NS}-doc-size`) }, row.size),
                  h('span', { className: cx(`${CSS_NS}-doc-chev`), 'aria-hidden': 'true' }, h(ChevronIcon)),
                  )),
                docView?.empty === undefined
                  ? null
                  : h('div', { className: cx(`${CSS_NS}-doc-more`) }, docView.empty),
                docView?.more === undefined
                  ? null
                  : h('div', { className: cx(`${CSS_NS}-doc-more`) }, docView.more),
                )
              : null,

            // 选中那一份的全文（复用原型的文档卡片视觉）
            openDocName === undefined
              ? null
              : h('div', { className: cx(`${CSS_NS}-doc-detail`) },
                h('div', { className: cx(`${CSS_NS}-doc-card`) },
                  h('div', { className: cx(`${CSS_NS}-doc-head`) },
                    h('span', { className: cx(`${CSS_NS}-doc-head-icon`), 'aria-hidden': 'true' }, h(FileIcon)),
                    h('div', null,
                      h('div', { className: cx(`${CSS_NS}-doc-title`) }, '会话硬切交接文档（session handoff）'),
                      h('div', { className: cx(`${CSS_NS}-doc-time`) }, detailTimeLine(
                        (docState.value?.files ?? []).find((file) => file?.name === openDocName)?.at ?? parseHandoffDocName(openDocName).at,
                        parseHandoffDocName(openDocName).sessionCode,
                      )),
                    ),
                  ),
                  h('div', { className: cx(`${CSS_NS}-doc-body`) },
                    docErrors[openDocName] !== undefined
                      ? h('div', { className: cx(`${CSS_NS}-choice-hint`), 'data-tone': 'error' }, docErrors[openDocName])
                      : (docContent[openDocName] === undefined
                        ? h('div', { className: cx(`${CSS_NS}-choice-hint`) }, '正在读取这一份…')
                        : h('pre', { className: cx(`${CSS_NS}-doc-text`) }, docContent[openDocName])),
                  ),
                ),
              ),
          ),

          // —— 决策日志 ——
          h('div', { className: cx(`${CSS_NS}-group`) },
            h('div', { className: cx(`${CSS_NS}-group-title`) }, '决策日志'),
            h(Row, { title: '记录每次判定', hint: '记下"什么时候、因为什么、做了什么"，方便你回头看为什么这么选' },
              h(Switch, { checked: config.decisionLogEnabled, label: '决策日志', disabled: saving, onChange: (next) => { void patch({ decisionLogEnabled: next }) } }),
            ),
            stats.decisions.length === 0
              ? h('div', { className: cx(`${CSS_NS}-empty`) }, '还没有决策记录。等上下文接近阈值时，这里会记下它每次的判断依据。')
              : h('div', { className: cx(`${CSS_NS}-decisions`) }, ...stats.decisions.slice(0, 20).map((row, index) => h('div', { key: `${row.at}-${index}`, className: cx(`${CSS_NS}-decision`) },
                h('span', { className: cx(`${CSS_NS}-decision-time`) }, row.time),
                h('span', { className: cx(`${CSS_NS}-decision-badge`), 'data-action': row.action }, row.label),
                h('span', { className: cx(`${CSS_NS}-decision-human`) }, row.human),
                h('span', { className: cx(`${CSS_NS}-decision-meta`) }, `上下文 ${row.contextPercent} · 会话 ${row.volume} · 本链第 ${row.chainIndex} 棒`),
              ))),
          ),

          // —— 「完全权限」确认弹窗（照原型 S8；开着时不落地，确认了才保留） ——
          permPending === undefined
            ? null
            : h('div', { className: cx(`${CSS_NS}-modal-mask`) },
              h('div', {
                className: cx(`${CSS_NS}-modal-card`),
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': `${CSS_NS}-perm-modal-title`,
              },
              h('div', { className: cx(`${CSS_NS}-modal-head`) },
                h('span', { className: cx(`${CSS_NS}-modal-icon`), 'aria-hidden': 'true' }, h(WarnIcon)),
                h('h2', { className: cx(`${CSS_NS}-modal-title`), id: `${CSS_NS}-perm-modal-title` }, '给新会话「完全权限」？'),
              ),
              h('p', { className: cx(`${CSS_NS}-modal-body`) },
                '新开出来的会话将',
                h('strong', null, '不再弹审批提示'),
                '，可以直接修改工作区以外的文件、执行命令。',
                h('br'),
                '这个设置会一直生效，直到你把它改回其它档位。',
              ),
              h('div', { className: cx(`${CSS_NS}-modal-actions`) },
                h('button', {
                  type: 'button',
                  className: cx(`${CSS_NS}-btn`, 'is-ghost', `${CSS_NS}-btn-modal`),
                  onClick: cancelDanger,
                }, '取消'),
                h('button', {
                  type: 'button',
                  className: cx(`${CSS_NS}-btn`, 'is-danger', `${CSS_NS}-btn-modal`),
                  onClick: confirmDanger,
                }, '我了解，用完全权限'),
              ),
              ),
            ),

          notice === undefined ? null : h('div', { className: cx(`${CSS_NS}-notice`) }, notice),
        )
      }

      // ─────────────────────────── 挂载 ───────────────────────────

      /**
       * 客户端插件挂载。
       * @param ctx - 客户端根上下文。
       */
      exports.apply = apply;
      async function apply(ctx                  )                {
        // ① 远程命名空间：先 mount，再取服务。失败只告警（插件其余部分仍可用）。
        //
        // ⚠️ 必须 **await**（2026-10-10 实机修正）：
        //    `$mount` 是 async，且它**内部自己就注册了 effect**
        //    （`dsh-api-gateway/lib/client.js`：`async $mount(contribution){ const owned =
        //      callerCtx.effect(async () => { ... }); await owned; return async () => { await owned() } }`）。
        //    原实现 `$mount(...).then(() => undefined)` 既没等它完成、又把返回的 disposer 丢了，
        //    于是设置页/健康度行常常在命名空间挂上之前就去读 `remote.sessionHandoff` ⇒ 一直"没挂上"。
        if (ctx.remote?.$mount !== undefined) {
          try {
            await ctx.remote.$mount(CONTRIBUTION)
          } catch (error         ) {
            console.warn(`[dsh-session-handoff] remote contribution mount failed: ${String((error         )?.message ?? error)}`)
          }
        } else {
          console.warn('[dsh-session-handoff] ctx.remote.$mount is unavailable; the health row will show a degraded state')
        }

        // ② S2：健康度行。挂在**输入框上方**、且整体居中。
        //
        // ⚠️ 槽位选择（2026-10-10 用户："我想做到对话框上面，并且能够自适应整体居中展示"）：
        //    两个候选槽位声明完全相同（都是 `{kind:"list", scope:"session"}`），但**位置与容器都不同**：
        //      · `conversation.input.dock` —— 渲染在 `.composerStack` 里、**位于 inputBar【之前】**
        //        （内核：`children:[ …, renderSlot("conversation.input.dock", zone), inputBar ]`）
        //        ⇒ **在输入框上方** ✅；容器 `.composerStack{flex-direction:column;gap:6px}` 是垂直列，
        //          所以必须靠 `align-self:center` 才能整体居中（见 styles.ts 的 `.dsh-handoff-health`）。
        //      · `conversation.composer.dock` —— 渲染在 InputBar 内部的状态栏行里
        //        （和原生 ContextMeter、轮次/token 统计同排）⇒ **在输入框下方**，不符合要求。
        //    结论：用 `conversation.input.dock`（在输入框上方）+ `align-self:center`（整体居中）。
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'session-handoff-health',
            order: 30,
            locale: 'session-handoff',
            inject: (sessionId        ) => ({ sessionId }),
          },
          ((props                        ) => h(HealthRow, {
            ctx,
            sessionId: typeof props.sessionId === 'string' ? props.sessionId : '',
          }))                                          ,
        ))

        // ③ S1：设置页。
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'session-handoff',
            order: 32,
            label: '会话接力',
            locale: 'session-handoff',
          },
          ((props                          ) => h(SettingsPanel, { ctx }))                                          ,
        ))

        // ④ 上游蓝本：/handoff 命令完成后的自动跳转卡片。
        //    DSH 0.2.0-rc.2 的注册入口是 `ctx.uiConversation.events.register(definition)`，
        //    按内核惯例包在 `ctx.effect(...)` 里（`dsh-client-ui-plan` 同款写法）。
        const handoffDefinition = {
          kind: 'handoff',
          target: 'chat',
          match(event         ) {
            if (!isHandoffDone(event)) return null
            const text = (event                              ).data.text
            const childId = extractChildId(text)
            if (childId === undefined) return null
            return { id: `handoff:${String((event                                    ).data.commandId)}`, role: 'start' }
          },
          start(_context         , match                                                                        ) {
            return {
              commandId: String(match.event.data.commandId),
              childId: extractChildId(match.event.data.text),
            }
          },
          update(context                     ) {
            return context.state
          },
          buildViewNode(context   
                       
                      
                                              
                                                            
           ) {
            const state = context.state
            if (state === undefined || typeof state.childId !== 'string') return null
            return {
              key: context.key,
              kind: 'handoff',
              id: context.id,
              target: 'chat',
              anchorSeq: context.start?.event.seq ?? 0,
              location: { kind: 'unresolved' },
              visibility: 'visible',
              data: { kind: 'handoff', commandId: state.commandId ?? '', childId: state.childId },
            }
          },
        }
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => ctx.uiConversation.events.register(handoffDefinition), 'session-handoff: conversation definition')
        } else {
          ctx.uiConversation.events.register(handoffDefinition)
        }

        ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
          {
            name: 'conversation.chat.node',
            key: 'handoff',
            locale: 'handoff',
            inject: ()                                                        => ({
              waitAndOpen: async (sessionId        ) => {
                for (let attempt = 0; attempt < 12; attempt += 1) {
                  if (ctx.sessions.binding(sessionId) !== undefined) {
                    ctx.sessions.open(sessionId)
                    return
                  }
                  await new Promise((resolve) => window.setTimeout(resolve, 500))
                }
                ctx.sessions.open(sessionId)
              },
            }),
          },
          HandoffOpenCard                                          ,
        ))
      }

      /**
       * 客户端远程贡献（手写，结构照 `dsh-cost-meter/lib/client.js` 的 `tn` 常量）：
       * 每个 descriptor 只需要 `method` / `parameters` / `result`——
       * `service` 与 `namespace` 由网关按包的命名空间补全（见 `dsh-api-gateway/lib/client.js` 的 `installNamespace`）。
       *
       * ⚠️ codec 只要 `mode: 'strict'`（客户端 mount 校验只查这一项，见
       *    `dsh-api-gateway/lib/client.js:2067-2075`）；真正的取值校验在宿主侧（`lib/typert.host.mjs`）。
       */
      /**
       * 造一个 strict codec。
       *
       * 形状**逐字对齐**宿主里能正常工作的 `dsh-cost-meter`：
       * `{ mode: 'strict', typeSymbol, schema, create: () => schema }`，
       * 其中 `schema` 只有 `parse`（客户端只做形状占位，真校验在宿主侧）。
       *
       * @param {string} name - 类型名（进 typeSymbol）。
       * @returns {object} codec。
       */
      function codec(name        )         {
        const schema = { parse: (value         ) => value }
        return { mode: 'strict', typeSymbol: `dsh-session-handoff#client/${name}`, schema, create: () => schema }
      }

      /**
       * 造一个"宽松但形状正确"的入参描述符。
       * @param {string} name - 参数名（同时作为 wire 字段名）。
       * @returns {object} 描述符。
       */
      function param(name        )         {
        return { name, wire: name, source: 'json', codec: codec(name) }
      }

      /**
       * 与宿主清单（`lib/typert.host.mjs` 的 `invocation()`）**逐字对应**的描述符骨架。
       *
       * ⚠️ 2026-10-10 实机修正：原实现只写了 `{ method, parameters }`，**缺了
       * `id` / `service` / `namespace` / `invocation` / `result`**。
       * 新版客户端网关 `dsh-api-gateway/lib/client.js` 的 `mountContribution` 会
       * **按 `descriptor.namespace` 分组**再 `installNamespace(namespace, descriptors)`；
       * `namespace` 缺失 ⇒ 建不出 `remote.sessionHandoff`，设置页只会看到
       * 「宿主半边的 remote.sessionHandoff 没挂上」。
       * 正确形状见 `dsh-cost-meter/lib/client.js`：
       *   `{ id: "dsh-cost-meter#costMeter/<m>", service: "costMeter", namespace: "costMeter",
       *      method, invocation: { kind: "direct" }, parameters: [...], result: <codec> }`
       *
       * @param {string} method - 方法名。
       * @returns {object} 描述符骨架。
       */
      function descriptor(method        )                          {
        return {
          id: `dsh-session-handoff#sessionHandoff/${method}`,
          service: 'sessionHandoff',
          namespace: 'sessionHandoff',
          method,
          invocation: { kind: 'direct' },
        }
      }

      /** 客户端侧的远程贡献（必须与宿主清单的 7 条 invocation 一一对应）。 */
      const CONTRIBUTION = {
        package: 'dsh-session-handoff',
        descriptors: [
          { ...descriptor('stats'), parameters: [param('sessionIds'), param('decisionLimit'), param('decisionFilter')], result: codec('stats') },
          { ...descriptor('updateConfig'), parameters: [param('patch')], result: codec('updateConfig') },
          { ...descriptor('handoffNow'), parameters: [param('sessionId'), param('source'), param('options')], result: codec('handoffNow') },
          { ...descriptor('cancelPending'), parameters: [param('sessionId')], result: codec('cancelPending') },
          { ...descriptor('confirm'), parameters: [param('sessionId'), param('reason'), param('detail')], result: codec('confirm') },
          { ...descriptor('readHandoffDoc'), parameters: [param('name'), param('read')], result: codec('readHandoffDoc') },
          { ...descriptor('listHandoffDocs'), parameters: [], result: codec('listHandoffDocs') },
          // S1「新会话用什么样的」：模型目录 + 权限档位表（宿主侧必须同步声明这两条 invocation，
          // 否则客户端贡献与宿主清单对不上，远程网关会挂不上）。
          { ...descriptor('listModelCatalog'), parameters: [], result: codec('listModelCatalog') },
          { ...descriptor('listPermissionPresets'), parameters: [], result: codec('listPermissionPresets') },
          // R4：卡片技能面板的技能目录（宿主清单必须同步声明，否则上面的"一一对应"断言会红）。
          { ...descriptor('listSkills'), parameters: [param('sessionId')], result: codec('listSkills') },
        ],
      }

      ;exports.name = name;exports.inject = inject;exports.REMOTE_NAMESPACE = REMOTE_NAMESPACE
    },
    "./src/client/HandoffOpenCard.tsx": (exports, __req) => {
      // 自动跳转卡片：/handoff 完成节点渲染时，自动打开新会话并隐藏自身。
      //
      // 副作用只在渲染组件里发生（conversation node 状态机保持纯、可回放）。
      // localStorage 标记保证每个子会话只自动打开一次（历史回放不反复跳转）。

      const {useEffect} = __req("react")

      /** localStorage 打开标记前缀（每个子会话 id 一条）。 */
      const OPENED_PREFIX = 'dsh.handoff.opened.v1'

                                      
                                                             
                                                          
       

      /**
       * 自动跳转卡片：渲染时不占空间，等新会话在客户端列表就绪后自动打开。
       * @param props - 节点数据 + 注入的等待-打开回调。
       * @returns 空（不渲染任何内容）。
       */
      exports.HandoffOpenCard = HandoffOpenCard;
      function HandoffOpenCard({ node, waitAndOpen }                      )       {
        const childId = node?.data?.childId
        useEffect(() => {
          if (typeof childId !== 'string' || childId.length === 0) return
          if (typeof waitAndOpen !== 'function') {
            console.info('[dsh-session-handoff] no waitAndOpen injected; auto-open skipped')
            return
          }
          const key = `${OPENED_PREFIX}:${childId}`
          try {
            if (window.localStorage.getItem(key) !== null) return
            // Reserve before awaiting so React Strict Mode cannot open twice.
            window.localStorage.setItem(key, 'opening')
          } catch {
            // localStorage 不可用（隐私模式等）：仍尝试打开一次。
          }
          console.info(`[dsh-session-handoff] auto-opening child session ${childId}`)
          void waitAndOpen(childId)
            .then(() => {
              try {
                window.localStorage.setItem(key, '1')
              } catch {
                // localStorage 不可用不影响已经完成的跳转。
              }
            })
            .catch((error         ) => {
              // A later render/history replay may retry after a transient failure.
              try {
                window.localStorage.removeItem(key)
              } catch {
                // Ignore unavailable storage; there is no stale marker to clean up.
              }
              console.warn(`[dsh-session-handoff] auto-open failed: ${String(error)}`)
            })
        }, [childId, waitAndOpen])
        return null
      }

    },
    "./src/client/parse.ts": (exports, __req) => {
      // 客户端纯函数：/handoff 完成事件识别与新会话 id 提取。
      // 无 react / 无 @deepseek-ai 依赖，可用 node --experimental-strip-types 直接单测。

      /** 命中交接成功标记的固定前缀（与宿主成功消息第一行一致）。 */
      const SUCCESS_PREFIX = 'handoff: created a fresh session'

      /** 命令结果文本里新会话 id 的形态（`` `session-<id>` ``，宿主文案保证）。 */
      const SESSION_ID_PATTERN = /`(session-[a-z0-9-]+)`/

      /**
       * 从命令结果文本提取新会话 id。
       * @param text - 宿主成功消息文本。
       * @returns 新会话 id；未命中时 undefined。
       */
      exports.extractChildId = extractChildId;
      function extractChildId(text        )                     {
        const match = SESSION_ID_PATTERN.exec(text)
        return match?.[1]
      }

      /**
       * 判断是否为 /handoff 的成功完成事件（command/done + kind=success + 成功标记）。
       * @param event - 会话事件。
       * @returns 是否命中。
       */
      exports.isHandoffDone = isHandoffDone;
      function isHandoffDone(event         )          {
        if (event === null || typeof event !== 'object') return false
        const typed = event                                                                 
        if (typed.type !== 'command/done') return false
        const data = typed.data
        if (data?.kind !== 'success' || typeof data.text !== 'string') return false
        return data.text.includes(SUCCESS_PREFIX)
      }

      ;exports.SUCCESS_PREFIX = SUCCESS_PREFIX
    },
    "./src/client/ui.ts": (exports, __req) => {
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

      const {createElement: h} = __req("react")

      /** 类名前缀（避免污染宿主样式）。 */
      const CSS_NS = 'dsh-handoff'

      /**
       * 拼类名。
       * @param parts - 片段。
       * @returns 类名。
       */
      exports.cx = cx;
      function cx(...parts                                   )         {
        return parts.filter((part)                 => typeof part === 'string' && part.length > 0).join(' ')
      }

      /**
       * 带阈值刻度线的进度条（C1 · ContextMeter 的 v2 形态）。
       *
       * @param props - 属性。
       * @returns 元素。
       */
      exports.Bar = Bar;
      function Bar(props   
                    
                       
                                        
                     
       )            {
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
      exports.Switch = Switch;
      function Switch(props                                                                                            )            {
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
      exports.Segmented = Segmented;
      function Segmented                  (props   
                
                                                                              
                                   
                    
       )            {
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
      exports.Row = Row;
      function Row(props                                                        )            {
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
      exports.NumberInput = NumberInput;
      function NumberInput(props   
                     
                                        
                     
                            
                         
                    
                    
       )            {
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
            onChange: (event                               ) => onChange(event.target.value),
          }),
          unit === undefined ? null : h('span', { className: cx(`${CSS_NS}-unit`) }, unit),
        )
      }

      /**
       * 主/次按钮。
       * @param props - 属性。
       * @returns 元素。
       */
      exports.Button = Button;
      function Button(props   
                           
                            
                                                
                          
                      
       )            {
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

      ;exports.CSS_NS = CSS_NS
    },
    "./lib/handoff-config.mjs": (exports, __req) => {
      // 配置面：默认值 / 边界 / 未知键显式拒绝 / 加载期校验（零依赖，可纯 Node 单测）。
      //
      // 设计要点：上下文阈值、确认策略、新会话形态与摘要调用参数都在这里收口。
      // 校验风格照 @deepseek-ai/dsh-token-meter/lib/index.js:602 `validateConfigKeys`：
      // 未知键**显式抛错**，绝不静默忽略（静默忽略是配置写错却查不出来的主因）。

      const {PLUGIN_NAME, DEFAULTS, LIMITS, REASONING_EFFORTS} = __req("./lib/constants.mjs")

      /** 三档自动模式（§十六 16.2 的书面命名）。 */
      const AUTO_MODES = Object.freeze(['replace', 'hybrid', 'native'])

      /** 默认档位 = 混合模式（§十三 表：档 2 推荐）。 */
      const DEFAULT_AUTO_MODE = 'hybrid'

      /** 交接文档的生成方式：llm = 一次模型摘要（失败自动降级）；structured = 纯结构化拼装。 */
      const SUMMARY_MODES = Object.freeze(['llm', 'structured'])

      /**
       * 「该换会话的时候怎么做」（§一 S1 的"自动程度区"，需求 P0-7）。
       * - notify  ：只提醒（UI 上给一个到点提示，用户自己点）
       * - confirm ：弹窗确认（**默认**；复用原生问答弹窗）
       * - auto    ：全自动（不问，直接换）
       */
      const AUTO_PROMPT_LEVELS = Object.freeze(['notify', 'confirm', 'auto'])

      /** 硬切策略默认值。 */
      const HANDOFF_DEFAULTS = Object.freeze({
        autoMode: DEFAULT_AUTO_MODE,
        autoPromptLevel: 'confirm',
        summaryMode: 'llm',
        /**
         * 档② 的会话体积阈值（字节）。**8 MB —— 2026-10-10 用用户真实会话日志校准后确定的**。
         *
         * 校准依据（扫 `~/.dsh/sessions` 全部 76 份会话日志，zstd 解压后统计）：
         *   解压后体积：中位 0.92 MB ｜ P75 1.91 MB ｜ P90 4.77 MB ｜ 历史最大 14.31 MB
         *   事件条数　：中位 231 条 ｜ P75 593 条 ｜ P90 1946 条 ｜ 历史最大 8206 条
         *
         * 8 MB 略高于 P90、低于历史最重档 ⇒ 只在"确实重"的时候才触发（约 5% 左右的会话会碰到）。
         * ⚠️ 原先拍的 20 MB 是错的——用户历史上最重的会话才 14.31 MB，那条线**基本永远不会触发**。
         */
        sessionVolumeBytes: 8 * 1024 * 1024,
        /** 安全阀 A：自上次换会话起累计压缩满 N 次即硬切；null = 不启用（§十七）。仅混合模式生效。 */
        compactionCountTrigger: null,
        /** 档① 抢跑折中系数：切换线 = 原生生效阈值 × 该系数（§十八 定案 0.98）。 */
        replaceSafetyFactor: 0.98,
        /** 读不到原生生效阈值时的兜底比例（§十六 16.1 第 1 条：退化为 0.8 × 生效窗口）。 */
        nativeCompactionRatio: 0.8,
        /** 交接文档落盘（§一 S1"交接文档区"，默认开）。 */
        handoffDocPersist: true,
        /** 交接文档目录（空串 = 用 DSH 数据目录下的默认目录）。 */
        handoffDocDir: '',
        /** 决策日志开关（§一 S1"决策日志区"，默认开）。 */
        decisionLogEnabled: true,
        /** 弹窗确认的超时（毫秒）。**ask() 自身没有超时，必须自传 AbortSignal**（PK-006 同源纪律）。 */
        confirmTimeoutMs: 120 * 1000,
        /**
         * 「先不接力」之后，触发量再涨**百分之多少**就允许再问一次（整数百分比）。
         *
         * 50 = 再涨 50%（即原来的 1.5 倍）——2026-10-12 用户拍板的行为，现在改成可配置。
         * 为什么需要它：体积这类指标是单调递增的，而 P0-5 写的是"直到下次跨过阈值" ——
         * 只按"触发原因有没有变化"去重的话，用户点一次"先不接力"后本会话就**永久静音**了。
         * 唯一的默认值来源就是这里，其它地方一律引用 `HANDOFF_DEFAULTS.askRearmPercent`。
         */
        askRearmPercent: 50,
        /**
         * 新会话**固定**的推理强度（空串 = 跟随原会话的推理强度）。
         *
         * ⚠️ 为什么叫 `childReasoningEffort` 而不是 `reasoningEffort`：
         *    下面「上游命令面」里已经有一个 `reasoningEffort`，它是**摘要调用**的思考强度
         *    （默认 inherit，取值 off/high/max/inherit，被 index.mjs 与 lib/llm.mjs 消费）。
         *    两者语义完全不同：摘要那个是"写交接文档时要不要思考"，这个是"新会话用多强的思考"。
         *    若共用一个键，空串会被 lib/llm.mjs 当成真实取值发给模型（某些 provider 直接拒绝），
         *    把摘要功能打坏（2026-10-12 已实测过同类 `"off"` 被拒）。故新键带 `child` 前缀，
         *    与下面的 `childPermissionPreset` 对称。
         */
        childReasoningEffort: '',
        /**
         * 新会话的工作权限档位名（空串 = 跟随原会话）。
         *
         * ⚠️ 这里**不写死任何档位名**：档位目录由宿主 `permissionPresets.catalog()` 决定
         *    （不同部署可能增删档位），写死会让宿主一变我们就误杀。内核只保证"是个字符串"，
         *    合法性由 RPC 端点在拿到真实 catalog 时兜。
         */
        childPermissionPreset: '',
        // —— 2026-10-14 v1.2 新增（ARB-10：字面量只在 constants.mjs 的 DEFAULTS，这里只引用）——
        /** R1：新会话读完交接文档先给计划、等确认再动手（默认开）。 */
        childPlanFirst: DEFAULTS.CHILD_PLAN_FIRST,
        /** R2：硬切前等子代理交卷的最长时间（分钟，整数 1–60，默认 10）。 */
        subagentDrainTimeoutMin: DEFAULTS.SUBAGENT_DRAIN_TIMEOUT_MIN,
      })

      /** 硬切策略边界。 */
      const HANDOFF_LIMITS = Object.freeze({
        MIN_SESSION_VOLUME_BYTES: 1024 * 1024,
        MAX_SESSION_VOLUME_BYTES: 512 * 1024 * 1024,
        MIN_COMPACTION_COUNT_TRIGGER: 1,
        MAX_COMPACTION_COUNT_TRIGGER: 100,
        MIN_REPLACE_SAFETY_FACTOR: 0.5,
        MAX_REPLACE_SAFETY_FACTOR: 0.999,
        MIN_NATIVE_COMPACTION_RATIO: 0.05,
        MAX_NATIVE_COMPACTION_RATIO: 0.99,
        MIN_CONFIRM_TIMEOUT_MS: 5 * 1000,
        MAX_CONFIRM_TIMEOUT_MS: 30 * 60 * 1000,
        /** 「先不接力」后的重问涨幅下界：再涨 10% 就重问（已经很小，再低等于没闸门）。 */
        MIN_ASK_REARM_PERCENT: 10,
        /** 上界：再涨 5 倍才重问（再高基本等于永久静音，用户不如直接关弹窗）。 */
        MAX_ASK_REARM_PERCENT: 500,
        /** R2「等子代理交卷的最长时间」下界：1 分钟。 */
        MIN_SUBAGENT_DRAIN_TIMEOUT_MIN: 1,
        /** R2 上界：60 分钟（再长等于没有安全阀）。 */
        MAX_SUBAGENT_DRAIN_TIMEOUT_MIN: 60,
      })

      /** 全部合法配置键（未知键一律拒绝）。 */
      const KNOWN_CONFIG_KEYS = Object.freeze([
        // —— 硬切策略面（上一块）——
        'autoMode',
        'summaryMode',
        'sessionVolumeBytes',
        'compactionCountTrigger',
        'replaceSafetyFactor',
        'nativeCompactionRatio',
        // —— 界面面（本块：M2 §一 S1）——
        'autoPromptLevel',
        'handoffDocPersist',
        'handoffDocDir',
        'decisionLogEnabled',
        'confirmTimeoutMs',
        'askRearmPercent',
        // —— 新会话的「模型 / 推理强度 / 权限档」面（本块：设置页可改）——
        'childReasoningEffort',
        'childPermissionPreset',
        // —— 2026-10-14 v1.2 新增（R1 先提交计划 / R2 等子代理交卷）——
        'childPlanFirst',
        'subagentDrainTimeoutMin',
        // —— 蓝本 /handoff 命令面（原样保留，不动）——
        'enabled',
        'turns',
        'maxInputChars',
        'maxTokens',
        'timeoutMs',
        'reasoningEffort',
        'provider',
        'model',
      ].sort())

      /**
       * 界面可改的键（设置页只送这些；**host 侧还要再过滤一次**，见 `pickEditable`）。
       * 这是"客户端送什么都照单全收"的防线：RPC 是跨进程序边界，不信客户端。
       *
       * ⚠️ 2026-10-12 方案变更：`provider` / `model` 从"界面不该改"移进来——设置页现在要能
       *    直接选新会话的模型（目录来自 `listModelCatalog`）。`reasoningEffort`（摘要思考强度）
       *    **仍然不在这里**：它是内部调优项，不该让用户随手改坏摘要。
       *    新会话的推理强度是另一个键 `childReasoningEffort`。
       */
      const EDITABLE_CONFIG_KEYS = Object.freeze([
        'enabled',
        'autoMode',
        'sessionVolumeBytes',
        'compactionCountTrigger',
        'autoPromptLevel',
        'handoffDocPersist',
        'decisionLogEnabled',
        'confirmTimeoutMs',
        'summaryMode',
        'askRearmPercent',
        // 新会话的模型路由与推理强度（设置页从模型目录里选）。
        'provider',
        'model',
        'childReasoningEffort',
        'childPermissionPreset',
        // 2026-10-14 v1.2：R1 开关 / R2 数字输入（都在 S1，必须可改）。
        'childPlanFirst',
        'subagentDrainTimeoutMin',
      ].sort())

      const KNOWN_KEY_SET = new Set(KNOWN_CONFIG_KEYS)

      /**
       * 未知键显式拒绝（照 dsh-token-meter 的做法，但一次列全，便于一次改完）。
       * @param {unknown} config - 待校验的配置对象。
       * @returns {void}
       * @throws {Error} 配置不是对象，或含未知键。
       */
      exports.validateConfigKeys = validateConfigKeys;
      function validateConfigKeys(config) {
        if (config === null || typeof config !== 'object' || Array.isArray(config)) {
          throw new Error(`${PLUGIN_NAME}: config must be a plain object`)
        }
        const unknown = Object.keys(config).filter((key) => !KNOWN_KEY_SET.has(key)).sort()
        if (unknown.length > 0) {
          const listed = unknown.map((key) => `"${key}"`).join(', ')
          throw new Error(`${PLUGIN_NAME}: unknown config key(s) ${listed}; known keys are ${KNOWN_CONFIG_KEYS.join(', ')}`)
        }
      }

      /**
       * 断言数字落在闭区间内。
       * @param {number} value - 待校验值。
       * @param {number} min - 下界（含）。
       * @param {number} max - 上界（含）。
       * @param {string} label - 错误消息里的键名。
       * @returns {number} 原值。
       */
      function inRange(value, min, max, label) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
          throw new Error(`${PLUGIN_NAME}: ${label} must be a number in [${min}, ${max}], got ${JSON.stringify(value)}`)
        }
        return value
      }

      /**
       * 解析 `askRearmPercent`（「先不接力」后触发量再涨多少个百分点才重问）。
       *
       * 口径**故意与 `sessionVolumeBytes` 的"越界抛错"不同**（用户 2026-10-12 定稿）：
       *   · 越界 → **钳制到边界**（10 / 500），不抛错；
       *   · 非整数 → **四舍五入取整**；
       *   · 非有限值（NaN / ±Infinity / undefined / null / 空串）→ **回落默认值 50**；
       *   · 只有真正的**类型错误**（布尔 / 对象 / 数组 / 函数…）才抛带上下文的错误。
       *
       * 为什么钳制而不是抛错：这是"手感微调"项，用户在设置页滑到极端值不该把整份配置
       * 搞成非法、导致插件启动失败；而类型写错是另一回事，必须响亮失败（与既有口径一致）。
       *
       * @param {unknown} value - 原始值（可能来自 profile patch、设置页输入框的字符串）。
       * @returns {number} 落在 [MIN, MAX] 内的整数百分比。
       * @throws {Error} 值不是数字 / 数字字符串类型。
       */
      function resolveAskRearmPercent(value) {
        const label = `askRearmPercent must be a number in [${HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT}, ${HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT}]`
        if (value === undefined || value === null) return HANDOFF_DEFAULTS.askRearmPercent
        const kind = typeof value
        if (kind !== 'number' && kind !== 'string') {
          throw new Error(`${PLUGIN_NAME}: ${label}, got ${JSON.stringify(value)}`)
        }
        // 设置面板的空输入框会送空串：按"留空 = 用默认值"处理（同 compactionCountTrigger 的约定）。
        if (typeof value === 'string' && value.trim() === '') return HANDOFF_DEFAULTS.askRearmPercent
        const numeric = kind === 'string' ? Number(value) : value
        // NaN / ±Infinity / 非数字字符串 → 回落默认值（产品口径，不抛错）。
        if (!Number.isFinite(numeric)) return HANDOFF_DEFAULTS.askRearmPercent
        const rounded = Math.round(numeric)
        return Math.min(
          HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT,
          Math.max(HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT, rounded),
        )
      }

      /**
       * 解析「可留空 = 跟随原会话」的字符串配置（`childReasoningEffort` / `childPermissionPreset`）。
       *
       * 口径：空串 / undefined / null → 空串（＝跟随原会话）；**只有真正的类型错误才抛错**。
       * 为什么不校验取值：推理强度与权限档位都由**宿主目录**决定（模型目录 / `permissionPresets.catalog()`），
       *   不同部署的档位名不一样；内核写死一份等于把宿主的变化变成我们的启动失败。
       *   合法性由 RPC 端点在拿到真实 catalog 时兜（见 `listModelCatalog` / `listPermissionPresets`）。
       *
       * @param {unknown} value - 原始值。
       * @param {string} label - 键名（错误消息用）。
       * @param {string} fallback - 默认值（**唯一来源是 HANDOFF_DEFAULTS**）。
       * @returns {string} 解析后的字符串（空串表示跟随原会话）。
       * @throws {Error} 值存在但不是字符串。
       */
      function resolveFollowableText(value, label, fallback) {
        if (value === undefined || value === null) return fallback
        if (typeof value !== 'string') {
          throw new Error(`${PLUGIN_NAME}: ${label} must be a string (empty = follow the origin session), got ${JSON.stringify(value)}`)
        }
        return value
      }

      /**
       * 解析「整数 + 越界钳制 + 非有限值回落默认」配置（R2 `subagentDrainTimeoutMin`）。
       *
       * 口径照架构方案 M1 §11.5 #6：非有限数 / 空串 → 回落默认；越界 → 钳制到边界。
       * 真正的类型错误（布尔 / 对象…）仍响亮抛错——那是配置写错，不是手感微调。
       *
       * @param {unknown} value - 原始值。
       * @param {number} min - 下界（含）。
       * @param {number} max - 上界（含）。
       * @param {number} fallback - 默认值（唯一来源是 HANDOFF_DEFAULTS）。
       * @param {string} label - 键名（错误消息用）。
       * @returns {number} 落在 [min, max] 内的整数。
       * @throws {Error} 值存在但不是数字 / 数字字符串。
       */
      function clampInt(value, min, max, fallback, label) {
        if (value === undefined || value === null) return fallback
        const kind = typeof value
        if (kind !== 'number' && kind !== 'string') {
          throw new Error(`${PLUGIN_NAME}: ${label} must be an integer in [${min}, ${max}], got ${JSON.stringify(value)}`)
        }
        if (kind === 'string' && value.trim() === '') return fallback
        const numeric = kind === 'string' ? Number(value) : value
        if (!Number.isFinite(numeric)) return fallback
        return Math.min(max, Math.max(min, Math.round(numeric)))
      }

      /**
       * 补齐默认值并做加载期校验。**非法配置响亮失败，不静默降级。**
       * 未知键在任何情况下都抛错（含 enabled:false）。
       * @param {Record<string, unknown>} [config] - 原始配置。
       * @returns {object} 补全并校验后的配置。
       * @throws {Error} 任一键未知或取值非法。
       */
      exports.resolveConfig = resolveConfig;
      function resolveConfig(config = {}) {
        validateConfigKeys(config)

        const resolved = {
          // 硬切策略面
          autoMode: config.autoMode ?? HANDOFF_DEFAULTS.autoMode,
          autoPromptLevel: config.autoPromptLevel ?? HANDOFF_DEFAULTS.autoPromptLevel,
          summaryMode: config.summaryMode ?? HANDOFF_DEFAULTS.summaryMode,
          sessionVolumeBytes: config.sessionVolumeBytes ?? HANDOFF_DEFAULTS.sessionVolumeBytes,
          compactionCountTrigger: config.compactionCountTrigger ?? HANDOFF_DEFAULTS.compactionCountTrigger,
          replaceSafetyFactor: config.replaceSafetyFactor ?? HANDOFF_DEFAULTS.replaceSafetyFactor,
          nativeCompactionRatio: config.nativeCompactionRatio ?? HANDOFF_DEFAULTS.nativeCompactionRatio,
          handoffDocPersist: config.handoffDocPersist ?? HANDOFF_DEFAULTS.handoffDocPersist,
          handoffDocDir: config.handoffDocDir ?? HANDOFF_DEFAULTS.handoffDocDir,
          decisionLogEnabled: config.decisionLogEnabled ?? HANDOFF_DEFAULTS.decisionLogEnabled,
          confirmTimeoutMs: config.confirmTimeoutMs ?? HANDOFF_DEFAULTS.confirmTimeoutMs,
          // 钳制 / 取整 / 回落都在这里面（默认值唯一来源是 HANDOFF_DEFAULTS）。
          askRearmPercent: resolveAskRearmPercent(config.askRearmPercent),
          // 新会话的推理强度 / 权限档：空串 = 跟随原会话（档位名合法性交给 RPC 端点）。
          childReasoningEffort: resolveFollowableText(config.childReasoningEffort, 'childReasoningEffort', HANDOFF_DEFAULTS.childReasoningEffort),
          childPermissionPreset: resolveFollowableText(config.childPermissionPreset, 'childPermissionPreset', HANDOFF_DEFAULTS.childPermissionPreset),
          // R1：只有**显式 false** 才关（缺省 / 宿主旧版本缺席 = 默认开）。
          childPlanFirst: config.childPlanFirst !== false,
          // R2：越界钳制、非有限值回落（默认值单一来源 = HANDOFF_DEFAULTS）。
          subagentDrainTimeoutMin: clampInt(
            config.subagentDrainTimeoutMin,
            HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN,
            HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN,
            HANDOFF_DEFAULTS.subagentDrainTimeoutMin,
            'subagentDrainTimeoutMin',
          ),
          // 蓝本命令面
          enabled: config.enabled ?? DEFAULTS.ENABLED,
          turns: config.turns ?? DEFAULTS.TURNS,
          maxInputChars: config.maxInputChars ?? DEFAULTS.MAX_INPUT_CHARS,
          maxTokens: config.maxTokens ?? DEFAULTS.MAX_TOKENS,
          timeoutMs: config.timeoutMs ?? DEFAULTS.TIMEOUT_MS,
          reasoningEffort: config.reasoningEffort ?? DEFAULTS.REASONING_EFFORT,
          provider: config.provider ?? undefined,
          model: config.model ?? undefined,
        }

        if (!AUTO_MODES.includes(resolved.autoMode)) {
          throw new Error(`${PLUGIN_NAME}: autoMode must be one of ${AUTO_MODES.join('|')}, got ${JSON.stringify(resolved.autoMode)}`)
        }
        if (!AUTO_PROMPT_LEVELS.includes(resolved.autoPromptLevel)) {
          throw new Error(`${PLUGIN_NAME}: autoPromptLevel must be one of ${AUTO_PROMPT_LEVELS.join('|')}, got ${JSON.stringify(resolved.autoPromptLevel)}`)
        }
        if (!SUMMARY_MODES.includes(resolved.summaryMode)) {
          throw new Error(`${PLUGIN_NAME}: summaryMode must be one of ${SUMMARY_MODES.join('|')}, got ${JSON.stringify(resolved.summaryMode)}`)
        }
        if (typeof resolved.handoffDocPersist !== 'boolean') {
          throw new Error(`${PLUGIN_NAME}: handoffDocPersist must be a boolean`)
        }
        if (typeof resolved.decisionLogEnabled !== 'boolean') {
          throw new Error(`${PLUGIN_NAME}: decisionLogEnabled must be a boolean`)
        }
        if (typeof resolved.handoffDocDir !== 'string') {
          throw new Error(`${PLUGIN_NAME}: handoffDocDir must be a string (empty = default directory)`)
        }
        inRange(
          resolved.confirmTimeoutMs,
          HANDOFF_LIMITS.MIN_CONFIRM_TIMEOUT_MS,
          HANDOFF_LIMITS.MAX_CONFIRM_TIMEOUT_MS,
          'confirmTimeoutMs',
        )
        if (!Number.isInteger(resolved.sessionVolumeBytes)) {
          throw new Error(`${PLUGIN_NAME}: sessionVolumeBytes must be an integer number of bytes`)
        }
        inRange(
          resolved.sessionVolumeBytes,
          HANDOFF_LIMITS.MIN_SESSION_VOLUME_BYTES,
          HANDOFF_LIMITS.MAX_SESSION_VOLUME_BYTES,
          'sessionVolumeBytes',
        )

        // §十七："留空 = 不启用"。设置面板的空输入框会送空串，等价于留空，不算非法配置。
        if (resolved.compactionCountTrigger === '') resolved.compactionCountTrigger = null
        const trigger = resolved.compactionCountTrigger
        if (trigger !== null && trigger !== undefined) {
          if (!Number.isInteger(trigger)) {
            throw new Error(`${PLUGIN_NAME}: compactionCountTrigger must be an integer or null (null = disabled)`)
          }
          if (trigger === 0) {
            throw new Error(`${PLUGIN_NAME}: compactionCountTrigger = 0 is meaningless; leave it empty/null to disable the trigger`)
          }
          inRange(
            trigger,
            HANDOFF_LIMITS.MIN_COMPACTION_COUNT_TRIGGER,
            HANDOFF_LIMITS.MAX_COMPACTION_COUNT_TRIGGER,
            'compactionCountTrigger',
          )
        }
        inRange(
          resolved.replaceSafetyFactor,
          HANDOFF_LIMITS.MIN_REPLACE_SAFETY_FACTOR,
          HANDOFF_LIMITS.MAX_REPLACE_SAFETY_FACTOR,
          'replaceSafetyFactor',
        )
        inRange(
          resolved.nativeCompactionRatio,
          HANDOFF_LIMITS.MIN_NATIVE_COMPACTION_RATIO,
          HANDOFF_LIMITS.MAX_NATIVE_COMPACTION_RATIO,
          'nativeCompactionRatio',
        )

        if (typeof resolved.enabled !== 'boolean') {
          throw new Error(`${PLUGIN_NAME}: enabled must be a boolean`)
        }
        if (!REASONING_EFFORTS.includes(resolved.reasoningEffort)) {
          throw new Error(`${PLUGIN_NAME}: reasoningEffort must be one of ${REASONING_EFFORTS.join('|')}`)
        }
        if (!Number.isInteger(resolved.turns) || resolved.turns < LIMITS.MIN_TURNS || resolved.turns > LIMITS.MAX_TURNS) {
          throw new Error(`${PLUGIN_NAME}: turns must be an integer in [${LIMITS.MIN_TURNS}, ${LIMITS.MAX_TURNS}]`)
        }
        if (!Number.isInteger(resolved.maxInputChars) || resolved.maxInputChars < LIMITS.MIN_MAX_INPUT_CHARS || resolved.maxInputChars > LIMITS.MAX_MAX_INPUT_CHARS) {
          throw new Error(`${PLUGIN_NAME}: maxInputChars must be an integer in [${LIMITS.MIN_MAX_INPUT_CHARS}, ${LIMITS.MAX_MAX_INPUT_CHARS}]`)
        }
        if (!Number.isInteger(resolved.maxTokens) || resolved.maxTokens < LIMITS.MIN_MAX_TOKENS || resolved.maxTokens > LIMITS.MAX_MAX_TOKENS) {
          throw new Error(`${PLUGIN_NAME}: maxTokens must be an integer in [${LIMITS.MIN_MAX_TOKENS}, ${LIMITS.MAX_MAX_TOKENS}]`)
        }
        if (!Number.isInteger(resolved.timeoutMs) || resolved.timeoutMs < LIMITS.MIN_TIMEOUT_MS || resolved.timeoutMs > LIMITS.MAX_TIMEOUT_MS) {
          throw new Error(`${PLUGIN_NAME}: timeoutMs must be an integer in [${LIMITS.MIN_TIMEOUT_MS}, ${LIMITS.MAX_TIMEOUT_MS}]`)
        }
        const hasProvider = resolved.provider !== undefined
        const hasModel = resolved.model !== undefined
        if (hasProvider !== hasModel) {
          throw new Error(`${PLUGIN_NAME}: provider and model must be configured together`)
        }
        if (hasProvider && (typeof resolved.provider !== 'string' || resolved.provider.length === 0 || typeof resolved.model !== 'string' || resolved.model.length === 0)) {
          throw new Error(`${PLUGIN_NAME}: provider and model must be non-empty strings`)
        }
        return resolved
      }

      /**
       * 从客户端送上来的补丁里**只挑界面能改的键**，并做类型规范化。
       *
       * 为什么必须有这一层：`updateConfig` 是跨进程 RPC 入口，客户端送什么都不能照单全收。
       * 未知键、界面不该改的键（`timeoutMs` / `reasoningEffort` …）一律丢弃，
       * 再把剩下的交给 `resolveConfig` 做**取值**校验（超范围照样响亮抛错）。
       *
       * @param {unknown} patch - 客户端补丁。
       * @returns {{patch: object, rejected: string[]}} 过滤后的补丁与被拒绝的键。
       */
      exports.pickEditable = pickEditable;
      function pickEditable(patch) {
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          throw new Error(`${PLUGIN_NAME}: config patch must be a plain object`)
        }
        const allowed = new Set(EDITABLE_CONFIG_KEYS)
        const kept = {}
        const rejected = []
        /**
         * 要**从配置里删掉**的键（不是改成某个值）。
         *
         * 为什么需要：`configStore` 是 merge 语义（`{...raw, ...patch}`），而「跟随原会话」
         * 要求 provider/model **真的消失**（回到默认空）。若把"空"当成"本次不修改"，
         * 用户在下拉里改回「跟随原会话」之后配置里仍留着旧值，新会话还会用那个模型 ——
         * 界面说着"跟随原会话"、实际却把模型固定住了（假跟随）。
         *
         * ⚠️ 不能拿 `null` 表达删除：`compactionCountTrigger` 的 `null` 是**合法值**（不启用），
         *    两者语义不同，混用会互相踩。
         * @type {string[]}
         */
        const cleared = []
        for (const [key, value] of Object.entries(patch)) {
          if (!allowed.has(key)) {
            rejected.push(key)
            continue
          }
          if (key === 'sessionVolumeBytes' || key === 'confirmTimeoutMs') {
            if (value === null || value === undefined) continue
            const numeric = typeof value === 'string' ? Number(value) : value
            if (!Number.isFinite(numeric)) {
              throw new Error(`${PLUGIN_NAME}: ${key} must be a number, got ${JSON.stringify(value)}`)
            }
            kept[key] = Math.round(numeric)
            continue
          }
          if (key === 'compactionCountTrigger') {
            // 空串 / null = 不启用（§十七"留空 = 不启用"）。
            if (value === null || value === undefined || value === '') {
              kept[key] = null
              continue
            }
            const numeric = typeof value === 'string' ? Number(value) : value
            if (!Number.isFinite(numeric)) {
              throw new Error(`${PLUGIN_NAME}: compactionCountTrigger must be a number or empty, got ${JSON.stringify(value)}`)
            }
            kept[key] = Math.round(numeric)
            continue
          }
          if (key === 'childPlanFirst') {
            // 开关只接受布尔（客户端送字符串是 bug，响亮拒绝而不是悄悄当成 true）。
            if (typeof value !== 'boolean') {
              throw new Error(`${PLUGIN_NAME}: childPlanFirst must be a boolean, got ${JSON.stringify(value)}`)
            }
            kept[key] = value
            continue
          }
          if (key === 'subagentDrainTimeoutMin') {
            // A1：越界（0 / 65）**抛错拒绝**，照 `sessionVolumeBytes` 的越界口径，不照 `askRearmPercent` 的钳制口径。
            kept[key] = Math.round(inRange(
              value,
              HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN,
              HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN,
              'subagentDrainTimeoutMin',
            ))
            continue
          }
          if (key === 'provider' || key === 'model') {
            // 空串 / null / undefined = 「跟随原会话的模型」⇒ **把这个键清掉**（见上面 `cleared` 的说明）。
            // ⚠️ 只填一半（一个有值、一个被清）= 回落到 resolveConfig 的"必须成对"响亮报错，不静默凑一对。
            if (value === null || value === undefined || value === '') {
              cleared.push(key)
              continue
            }
            kept[key] = value
            continue
          }
          kept[key] = value
        }
        rejected.sort()
        cleared.sort()
        return { patch: kept, rejected, cleared }
      }

      ;exports.AUTO_MODES = AUTO_MODES;exports.DEFAULT_AUTO_MODE = DEFAULT_AUTO_MODE;exports.SUMMARY_MODES = SUMMARY_MODES;exports.AUTO_PROMPT_LEVELS = AUTO_PROMPT_LEVELS;exports.HANDOFF_DEFAULTS = HANDOFF_DEFAULTS;exports.HANDOFF_LIMITS = HANDOFF_LIMITS;exports.KNOWN_CONFIG_KEYS = KNOWN_CONFIG_KEYS;exports.EDITABLE_CONFIG_KEYS = EDITABLE_CONFIG_KEYS
    },
    "./lib/constants.mjs": (exports, __req) => {
      /** dsh-session-handoff 常量：命令名、插件名、默认配置与边界（协议常量，不可配置）。 */

      const PLUGIN_NAME = 'dsh-session-handoff'

      const COMMAND_NAME = 'handoff'

      const SESSION_EVENT_INJECT = 'user/message'

      const DEFAULTS = {
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
      const HANDOFF_DOC_SECTION_TITLES = Object.freeze([
        '用户需求',
        '方案梗概',
        '已完成',
        '涉及文件与产物',
        '接下来做什么',
      ])

      /** 摘要调用的思考强度：inherit＝不传该字段、跟随会话/适配器（**默认**）；off 关闭思考（不是所有模型都支持）；high/max 开思考。 */
      const REASONING_EFFORTS = ['off', 'high', 'max', 'inherit']

      /**
       * R4（2026-10-17）手动换会话卡片的**逐字文案**与限长。
       *
       * ⚠️ 清单 §3.7：中文文案统一放常量，禁止散落硬编码；客户端与 host 同源 import。
       * ⚠️ 这里每个字符串都是**口径清单 §1 的逐字口径**，改一个字都是改需求。
       */
      const R4_TEXTS = Object.freeze({
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
      const R4_HINTS = Object.freeze({
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
      const SUBAGENT_TEXTS = Object.freeze({
        /** 客户端按钮悬停/禁用原因（逐字）。 */
        DISABLED_HINT: '子代理会话不参与会话接力，请在主会话里操作。',
        /** 宿主拒绝时的 throw 文案（逐字，防绕过）。 */
        REJECT: '子代理会话不能接力：请在主会话里操作。',
      })

      /** R5 运行期兜底文案（非逐字需求口径；与 R4_TEXTS 分开）。 */
      const R5_HINTS = Object.freeze({
        /** 客户端 useStats 超时后的可解释失败态模板（`{sec}` 秒数）。 */
        CLIENT_STATS_TIMEOUT_TEMPLATE: '{sec} 秒内没读出来会话用量，可能是宿主端某个服务没响应；点「重试」再试一次。',
        /** host 侧 stats 降级时记进 `stats().errors` 的说明模板（`{sec}` 秒数）。 */
        HOST_STATS_TIMEOUT_TEMPLATE: '读取会话用量超时（{sec} 秒内没返回），已降级：该会话这一行暂时不可用；点「重试」可再试',
      })

      /**
       * host 侧 `stats()` 的有界等待（毫秒）：超过就降级返回（rows 为空 + errors 记一条），
       * 绝不让"某个宿主服务对子会话不返回"把客户端永久挂在「正在读取会话用量…」。
       */
      const HOST_STATS_TIMEOUT_MS = 3000

      /**
       * 客户端 `useStats` 的兜底超时（毫秒）。
       * 必须 **> HOST_STATS_TIMEOUT_MS**（正常路径永远是 host 先降级返回，客户端这条是最后一道保险）。
       */
      const CLIENT_STATS_TIMEOUT_MS = 8000

      /** R4 限长：留言最大码点数（清单 §1「已输入 N / 500」）。 */
      const MAX_NOTE_CHARS = 500

      /** R4 限长：技能引用最多条数（防体量失控，M1 §12.8 R4-5）。 */
      const MAX_SKILL_REFS = 50

      /** R4 限长：单条技能引用最大码点数。 */
      const MAX_SKILL_REF_CHARS = 200

      const LIMITS = {
        MIN_TURNS: 1,
        MAX_TURNS: 200,
        MIN_MAX_INPUT_CHARS: 1000,
        MAX_MAX_INPUT_CHARS: 200000,
        MIN_MAX_TOKENS: 100,
        MAX_MAX_TOKENS: 8000,
        MIN_TIMEOUT_MS: 5000,
        MAX_TIMEOUT_MS: 600000,
      }

      ;exports.PLUGIN_NAME = PLUGIN_NAME;exports.COMMAND_NAME = COMMAND_NAME;exports.SESSION_EVENT_INJECT = SESSION_EVENT_INJECT;exports.DEFAULTS = DEFAULTS;exports.HANDOFF_DOC_SECTION_TITLES = HANDOFF_DOC_SECTION_TITLES;exports.REASONING_EFFORTS = REASONING_EFFORTS;exports.R4_TEXTS = R4_TEXTS;exports.R4_HINTS = R4_HINTS;exports.SUBAGENT_TEXTS = SUBAGENT_TEXTS;exports.R5_HINTS = R5_HINTS;exports.HOST_STATS_TIMEOUT_MS = HOST_STATS_TIMEOUT_MS;exports.CLIENT_STATS_TIMEOUT_MS = CLIENT_STATS_TIMEOUT_MS;exports.MAX_NOTE_CHARS = MAX_NOTE_CHARS;exports.MAX_SKILL_REFS = MAX_SKILL_REFS;exports.MAX_SKILL_REF_CHARS = MAX_SKILL_REF_CHARS;exports.LIMITS = LIMITS
    },
    "./lib/timeout.mjs": (exports, __req) => {
      /** Abort-aware timeout wrapper for host-side asynchronous work. */

      /**
       * Run an operation with a child timeout while preserving caller cancellation.
       * The operation must honor the supplied signal.
       * @template T
       * @param {(signal: AbortSignal) => Promise<T>} operation - Work to run.
       * @param {{signal?: AbortSignal, timeoutMs: number, label: string}} options - Cancellation options.
       * @returns {Promise<T>} The operation result.
       */
      exports.withAbortTimeout = withAbortTimeout;
      async function withAbortTimeout(operation, { signal, timeoutMs, label }) {
        const timeoutController = new AbortController()
        const timer = setTimeout(() => {
          timeoutController.abort(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        const combined = signal === undefined
          ? timeoutController.signal
          : AbortSignal.any([signal, timeoutController.signal])

        try {
          combined.throwIfAborted()
          return await operation(combined)
        } catch (error) {
          if (timeoutController.signal.aborted && signal?.aborted !== true) {
            throw new Error(`${label} timed out after ${timeoutMs}ms`, { cause: error })
          }
          throw error
        } finally {
          clearTimeout(timer)
        }
      }

      /**
       * 给一个 Promise 套"有界等待"：到点无论它是否 settle 都返回 `{status:'timeout'}`。
       *
       * 与 `withAbortTimeout` 的区别（2026-10-20 真机教训）：`withAbortTimeout` 内部仍然
       * `await operation(signal)` —— 对**忽略 signal、永不 settle** 的调用（例如某个宿主服务
       * 对子会话不返回）不构成上限。这里用真 `Promise.race` 赛跑，定时器**不 unref**
       * （unref 会让有界等待被静默截断），正常完成时 clearTimeout。
       *
       * @template T
       * @param {Promise<T>|T} promise - 被等待的操作。
       * @param {{timeoutMs: number, label: string}} options - 超时与标签。
       * @returns {Promise<{status: 'ok', value: T} | {status: 'timeout', label: string}>} 结果。
       */
      exports.resolveWithin = resolveWithin;
      async function resolveWithin(promise, { timeoutMs, label }) {
        let timer = null
        try {
          return await Promise.race([
            Promise.resolve(promise).then((value) => ({ status: 'ok', value })),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ status: 'timeout', label }), timeoutMs)
            }),
          ])
        } finally {
          if (timer !== null) clearTimeout(timer)
        }
      }

    },
    "./src/client/view.ts": (exports, __req) => {
      // 客户端半区的**纯**辅助：DTO → 视图模型、颜色/文案、进度条几何、远程调用归一化。
      // 这一层不碰 React、不碰 DOM、不碰 ctx，因此可以脱离浏览器用纯 Node 单元测试。
      //
      // 三色、N 轮、明细表、确认卡片状态机全部直接 import `lib/handoff-health.mjs`
      // （宿主与客户端**共用同一份纯计算**，两侧永远不会漂移）。

      const {WARN_FACTOR, computeHealth, conclusionOf, detailRows, estimateTurnsLeft, formatBytes, formatCount, formatPercent, levelFor} = __req("./lib/handoff-health.mjs")
                                                                                       
      // 默认值与取值范围从宿主配置模块取（**同一来源**）：设置页的输入范围和校验口径
      // 不能和宿主两处各写一份，否则改一处就会出现"前端放过、宿主拒收"的错位。
      const {HANDOFF_DEFAULTS, HANDOFF_LIMITS} = __req("./lib/handoff-config.mjs")
      // R4（2026-10-17）：卡片的逐字文案与限长与宿主**同一份**（清单 §3.7：文案统一放常量）。
      const {R4_TEXTS, MAX_NOTE_CHARS} = __req("./lib/constants.mjs")

      exports.formatBytes = formatBytes;
      exports.formatCount = formatCount;
      exports.formatPercent = formatPercent

      /** 宿主 `stats` 一行里本层真正读到的字段（wire 上的可空数字按 `null` 建模）。 */
                                      
                                 
                                              
                                  
                                    
                                             
                                    
                                               
                                     
                                    
                                  
                                               
                                              
                                    
                                  
                           
                           
                                                            
                          
       

      /**
       * P2-7：从 `stats.rows` 里挑出**当前会话自己**的那一行。
       *
       * ⚠️ 只认**精确匹配**：`sessionId` 为空（健康度行挂载早期，宿主还没把会话 id 注进来）时
       * 返回 `undefined`——**绝不能**退回 `rows[0]`。
       * 原因：`useStats(ctx, [])` 时宿主会把**所有 live 会话**都返回，`rows[0]` 是别人的会话，
       * 界面就会把别的会话的用量/体积当成当前会话显示（2026-10-12 代码审查 P2-7）。
       *
       * @param rows - `stats.rows`（可空）。
       * @param sessionId - 当前会话 id（可能为空）。
       * @returns 精确命中的那一行；匹配不到返回 `undefined`。
       */
      exports.pickRowForSession = pickRowForSession;
      function pickRowForSession                         (
        rows                                 ,
        sessionId                           ,
      )                {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        if (rows === null || rows === undefined) return undefined
        for (const row of rows) {
          if (row?.sessionId === sessionId) return row
        }
        return undefined
      }

      /** DTO → 健康度行视图模型（渲染层只认这个）。 */
                                        
                         
                          
                                             
                     
                                            
                          
                              
                  
                      
                                   
                                  
                                    
                                               
                                                 
         
                 
                      
                                   
                      
                                    
                                          
                                               
         
                          
                          
                           
       

      /**
       * 数值守卫：语义与 `Number.isFinite(value)` 相同，但能把类型收窄成 `number`。
       * @param value - 任意值。
       * @returns 是否是可用的有限数字。
       */
      function isFiniteNumber(value         )                  {
        return typeof value === 'number' && Number.isFinite(value)
      }

      /** 颜色 → 视觉令牌（**不写任何色值**，只给类名/令牌名，颜色由 CSS 变量决定）。 */
      const LEVEL_TOKEN = Object.freeze({
        green: 'ok',
        warning: 'warn',
        danger: 'danger',
      })

      /** 颜色 → 文案（无障碍标签用）。 */
      const LEVEL_LABEL = Object.freeze({
        green: '健康',
        warning: '接近阈值',
        danger: '已到阈值',
      })

      /**
       * 由 host DTO 重算健康度（**与宿主同一份纯函数**）。
       * @param dto - `stats` 返回的一行。
       * @returns `computeHealth` 的结果。
       */
      exports.healthFromDto = healthFromDto;
      function healthFromDto(dto               )         {
        return computeHealth({
          mode: dto?.mode,
          usedTokens: dto?.usedTokens,
          windowTokens: dto?.windowTokens,
          nativeThresholdTokens: dto?.nativeThresholdTokens,
          replaceSafetyFactor: undefined,
          sessionBytes: dto?.sessionBytes,
          sessionVolumeLimitBytes: dto?.sessionVolumeLimitBytes,
        })
      }

      /**
       * DTO → 健康度行视图模型（渲染层只认这个）。
       *
       * @param dto - `stats` 返回的一行。
       * @returns 视图模型。
       */
      exports.viewModelOf = viewModelOf;
      function viewModelOf(dto               )                  {
        const health = healthFromDto(dto)
        const turnsLeft = estimateTurnsLeft({
          health,
          perTurnTokens: dto?.perTurnTokens,
          perTurnBytes: dto?.perTurnBytes,
        })
        const conclusion = conclusionOf({ health, turnsLeft })
        return {
          sessionId: dto?.sessionId ?? '',
          chainIndex: isFiniteNumber(dto.chainIndex) ? dto.chainIndex : 1,
          mode: dto?.mode ?? 'hybrid',
          level: health.level,
          levelToken: LEVEL_TOKEN[health.level] ?? 'ok',
          levelLabel: health.measured === false ? '读不到用量' : (LEVEL_LABEL[health.level] ?? '健康'),
          conclusion,
          context: {
            // 百分比文案（设计文档：左侧「上下文 68%」）
            text: formatPercent(health.context.ratio),
            ratio: health.context.ratio,
            // ⚠️ 只有替代模式才给上下文画条：
            //    混合/原生模式下上下文"归原生压缩管"，画一条**没有任何刻度**的进度条会让人
            //    以为 100% 就是危险线（其实不是），违反"知道了也没法处置的信息＝噪音"这条设计原则。
            //    所以这两种模式下只显示百分比数字，不给条。
            fill: health.context.showMarker ? clamp01(health.context.ratio) : undefined,
            // 阈值刻度线的位置（只有替代模式才画；混合模式按规格不画）
            marker: health.context.showMarker && Number.isFinite(health.context.limitRatio)
              ? clamp01(health.context.limitRatio)
              : undefined,
            usedTokens: dto?.usedTokens,
            windowTokens: dto?.windowTokens,
          },
          volume: {
            text: formatBytes(health.volume.bytes),
            ratio: health.volume.ratio,
            fill: clamp01(health.volume.ratio),
            // 体积条的阈值刻度线在 100% 处（条本身就是按"到线即满"画的）；
            // 没有阈值（配置缺失）就不画刻度。
            marker: health.volume.limitBytes === undefined ? undefined : 1,
            bytes: dto?.sessionBytes,
            limitBytes: dto?.sessionVolumeLimitBytes,
          },
          safePoint: dto?.safePoint === true,
          handedOff: dto?.handedOff === true,
          detail: detailRows({
            health,
            compactionsSinceHandoff: dto?.compactionsSinceHandoff,
            compactionCountTrigger: dto?.compactionCountTrigger,
            messageCount: dto?.messageCount,
            eventCount: dto?.eventCount,
          }).rows,
        }
      }

      /**
       * 把比例钳到 [0,1]（脏数据不该把进度条拉出容器）。
       * @param {number|undefined} value - 比例。
       * @returns {number} 钳后的比例。
       */
      exports.clamp01 = clamp01;
      function clamp01(value                    )         {
        if (!isFiniteNumber(value)) return 0
        if (value < 0) return 0
        if (value > 1) return 1
        return value
      }

      /**
       * 健康度行的无障碍文本（屏幕阅读器用；视觉文案另有一套）。
       * @param {object} model - 视图模型。
       * @returns {string} 文本。
       */
      exports.ariaSummary = ariaSummary;
      function ariaSummary(model                 )         {
        const parts = [`上下文占用 ${model.context.text}`]
        parts.push(`会话体积 ${model.volume.text}`)
        parts.push(`状态：${model.levelLabel}`)
        if (model.conclusion?.text !== undefined) parts.push(model.conclusion.text)
        return parts.join('，')
      }

      /**
       * 把 `remote.sessionHandoff.*` 的返回值折成"要么数据、要么错误"。
       *
       * ⚠️ 网关的返回形状是 `{ ok: true, value }` 或 `{ ok: false, error }`
       * （证据：`dsh-cost-meter/lib/client.js` 里 `Z.ok !== !0` 那段判定的用法）。
       *
       * @param result - 远程调用结果。
       * @returns {{ok: true, value: unknown}|{ok: false, error: string}} 归一化结果。
       */
      exports.unwrapRemote = unwrapRemote;
      function unwrapRemote(result         )                                                              {
        if (result === null || typeof result !== 'object') {
          return { ok: false, error: 'RPC 没有返回结果（宿主半边可能没挂上）' }
        }
        const shaped = result                                                      
        if (shaped.ok === true) return { ok: true, value: shaped.value }
        const message = (shaped.error                                     )?.message ?? shaped.error ?? 'unknown error'
        return { ok: false, error: String(message) }
      }

      /**
       * 字节 → MB 数字（设置页输入框用）。
       * @param {number|undefined} bytes - 字节。
       * @returns {number} MB（保留一位小数）。
       */
      exports.bytesToMb = bytesToMb;
      function bytesToMb(bytes                           )         {
        if (!isFiniteNumber(bytes)) return 20
        return Math.round((bytes / (1024 * 1024)) * 10) / 10
      }

      /**
       * 「再涨多少才重问」的草稿值（`askRearmPercent`）。
       *
       * ⚠️ **必须兜底**（2026-10-12 真机反馈）：宿主版本比客户端旧时（刚升级、宿主还没重载），
       * 这个**新字段会缺席**，`String(undefined)` 得到 `"undefined"`；而 `<input type="number">`
       * 不接受非数字值 ⇒ 输入框显示成**空框**，用户输入保存后看到"内容消失"。
       * 回落到配置模块里的默认值即可，界面上永远是个能编辑的合法数字。
       *
       * @param config - 宿主 config（可能缺该字段）。
       * @returns 草稿字符串。
       */
      exports.rearmDraftOf = rearmDraftOf;
      function rearmDraftOf(config                                                 )         {
        const raw = config?.askRearmPercent
        return typeof raw === 'number' && Number.isFinite(raw)
          ? String(raw)
          : String(HANDOFF_DEFAULTS.askRearmPercent)
      }

      /**
       * R2「等子代理交卷的最长时间」的草稿值（`subagentDrainTimeoutMin`）。
       *
       * 与 `rearmDraftOf` 同款兜底：宿主版本较旧 / 字段缺席时回落**同一份**默认值
       * （`HANDOFF_DEFAULTS`），绝不能给输入框塞 `"undefined"`。
       *
       * @param config - 宿主 config（可能缺该字段）。
       * @returns 草稿字符串。
       */
      exports.drainDraftOf = drainDraftOf;
      function drainDraftOf(config                                                         )         {
        const raw = config?.subagentDrainTimeoutMin
        return typeof raw === 'number' && Number.isFinite(raw)
          ? String(raw)
          : String(HANDOFF_DEFAULTS.subagentDrainTimeoutMin)
      }

      /**
       * R2 子代理收尾的运行期状态（ARB-13 的 wire 形状）。
       *
       * `null` = 没有进行中的收尾（与 v1.1 表现完全一致，不渲染任何新元素）。
       */
                                   
                                                    
                         
                          
                                
       

      /**
       * 把 `drain.phase` 逐字渲染成三条运行期文案（M2 §10.3，文案不许改写）。
       *
       * @param drain - `stats().drain`（可空）。
       * @returns 要显示的文案；`null` / 未知 phase 返回 undefined（不渲染）。
       */
      exports.drainBannerTextOf = drainBannerTextOf;
      function drainBannerTextOf(drain                               )                     {
        if (drain === null || drain === undefined || typeof drain !== 'object') return undefined
        if (drain.phase === 'waiting') {
          return `等子代理交卷（已等 ${drain.waitedSec} 秒，最多 ${drain.timeoutMin} 分钟）…`
        }
        if (drain.phase === 'interrupted') {
          return `已打断 ${drain.interruptedCount} 个子代理，等它们写完文档`
        }
        if (drain.phase === 'skipped') {
          return '子代理收尾没做成，直接换会话'
        }
        return undefined
      }

      /**
       * `drain` 文案的本地显示 latch 时长（P1-3，2026-10-14）。
       *
       * ⚠️ **为什么要有 latch**：host 侧 `skipped` 在 wire 上只驻留 4000ms（ARB-18②），
       * 而客户端是**定时轮询**（正常 3s，失败退避 6s…60s，页面 hidden 60s）。
       * 若不做 latch，跳过状态刚好落在两次轮询之间时，第三条文案一次都不渲染。
       * 3.5s ≥ 契约要求的"至少停留 3 秒"，且略短于 host 的 4s 窗口。
       */
      const DRAIN_LATCH_MS = 3500

      /** drain 文案的显示状态（本地 latch）。 */
                                        
                                     
                                
                                                       
                     
       

      /** 初始 latch（从未收到过 drain）。 */
      const EMPTY_DRAIN_LATCH                  = Object.freeze({ value: null, until: 0 })

      /**
       * 吸收一次 `stats().drain`，推进本地显示 latch（P1-3 的纯状态机，便于单测）。
       *
       * 规则：
       *   1) 收到**已知 phase** 的非空 drain ⇒ 立刻显示，并把驻留下限续到 `now + DRAIN_LATCH_MS`；
       *   2) 收到 `null` / 缺席 / 未知 phase ⇒ 只要驻留下限没到就**继续显示旧文案**；
       *   3) 到点后才允许清空。
       *
       * @param input - 输入。
       * @param input.previous - 上一份 latch 状态。
       * @param input.incoming - 本次 `stats().drain`。
       * @param input.now - 当前时刻（毫秒；测试注入假时钟）。
       * @returns 新的 latch 状态（无变化时原样返回 `previous`）。
       */
      exports.latchDrain = latchDrain;
      function latchDrain(input   
                                 
                                               
                   
       )                  {
        const { previous, incoming, now } = input
        // 只 latch「能真正渲染出文案」的状态（未知 phase 当没收到，避免 latch 住一段空白）。
        if (drainBannerTextOf(incoming) !== undefined) {
          return { value: incoming              , until: now + DRAIN_LATCH_MS }
        }
        if (previous.value !== null && now < previous.until) return previous
        return previous.value === null ? previous : EMPTY_DRAIN_LATCH
      }

      /**
       * MB 数字 → 字节（设置页提交用）。
       * @param {number|string} mb - MB。
       * @returns {number} 字节。
       */
      exports.mbToBytes = mbToBytes;
      function mbToBytes(mb                 )         {
        const value = typeof mb === 'string' ? Number(mb) : mb
        if (!isFiniteNumber(value) || value <= 0) return 0
        return Math.round(value * 1024 * 1024)
      }

      /** 一张模式卡的形状（`index.ts` 那边 `card.id` / `card.warning` 靠它拿到准确类型）。 */
                                 
                                           
                     
                           
                    
                                   
                            
       

      /**
       * 三张模式卡的定义（S1 的"模式三选一"，文案照设计文档 §一 S1）。
       * 书面用语 + 一句"什么时候会换会话"。
       */
      const MODE_CARDS                          = Object.freeze([
        {
          id: 'replace',
          title: '替代模式',
          description: '达到原生上下文压缩的生效阈值时，直接执行会话切换，完全替代原生上下文压缩。',
          when: '什么时候会换会话：上下文涨到原生压缩生效线的 98%。',
          warning: '需关闭原生自动压缩，否则切换可能无法触发（可行性待真机验证）',
          recommended: false,
        },
        {
          id: 'hybrid',
          title: '混合模式',
          description: '上下文水位交由原生压缩处理；仅当会话负载超出设定阈值时执行会话切换。',
          when: '什么时候会换会话：会话体积超线，或压缩次数到修正线。',
          warning: undefined,
          recommended: true,
        },
        {
          id: 'native',
          title: '原生模式',
          description: '完全沿用原生上下文管理，不执行任何自动会话切换。',
          when: '什么时候会换会话：不会自动换（你仍然可以点「换会话」）。',
          warning: undefined,
          recommended: false,
        },
      ])

      /** 一个自动程度选项（`Segmented` 的泛型靠 `id` 收窄成 union）。 */
                                          
                                         
                     
                           
       

      /** 自动程度三选一（S1 的"该换会话的时候怎么做"）。 */
      const PROMPT_LEVELS                                   = Object.freeze([
        { id: 'notify', label: '只提醒', description: '到点在会话里给一句提示，换不换你自己点。' },
        { id: 'confirm', label: '弹窗确认', description: '到点用宿主原生弹窗问你一句（默认）。' },
        { id: 'auto', label: '全自动', description: '到点直接换，不打扰你。' },
      ])

      /** 设置页草稿（体积以 MB 计，输入框给的是字符串）。 */
                                    
                         
                                                  
                                                       
                                         
                                                  
                                         
                                         
                                      
                                                 
                                   
                                    
       

      // ─────────────── 设置页草稿同步（P2-8：draft 要跟宿主走，失败要回滚） ───────────────

      /**
       * 两个配置对象是否"同一份"（逐键浅比较，键集合也要一致）。
       * 值都是标量，浅比较足够；用来避免每 3 秒一次轮询都拿新对象触发无意义的重渲染。
       *
       * @param a - 任意值。
       * @param b - 任意值。
       * @returns 是否相等。
       */
      exports.sameConfig = sameConfig;
      function sameConfig(a         , b         )          {
        if (a === b) return true
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
        const left = a                           
        const right = b                           
        const keys = new Set([...Object.keys(left), ...Object.keys(right)])
        for (const key of keys) {
          if (left[key] !== right[key]) return false
        }
        return true
      }

      /** P2-8：一次成功保存后用来识别"宿主回声"的记账。 */
                                       
                                                      
                 
                                               
                
       

      /** P2-8：草稿同步决策。 */
                                          
                                   
                     
                             
                             
       

      /**
       * P2-8：给定宿主 config + 界面草稿 + dirty（用户是否在编辑）+ 等回声状态，
       * 算出"要不要用宿主值刷新草稿"。纯函数，好测。
       *
       * 规则：
       * 1. 宿主还没有 config（`undefined`）⇒ 什么都不动；
       * 2. 正在等一次成功保存的回声时：
       *    · stats 还是**保存前**那份 ⇒ 旧回声，丢弃、继续等（否则刚保存的开关会被顶回去）；
       *    · 其它情况 ⇒ 回声到了（或宿主已有更新的值），结束等待，然后按 dirty 规则处理；
       * 3. `dirty === true`（用户有未落盘的改动）⇒ 不用宿主值覆盖草稿；
       * 4. 否则：宿主值和草稿不同才刷新（相同就不 setState，避免每轮轮询都重渲染）。
       *
       * @param input - 决策输入。
       * @returns 决策结果。
       */
      exports.draftSyncDecision = draftSyncDecision;
      function draftSyncDecision   (input   
                           
                            
                      
                                            
                                                                
       )                    {
        const equals = input.equals ?? ((a               , b               ) => sameConfig(a, b))
        const { host, draft, dirty, pending } = input
        if (host === undefined) return { sync: false, clearPending: false }
        if (pending !== undefined) {
          // 旧回声（保存前那份）——丢弃，接着等宿主追上。
          if (equals(host, pending.before)) return { sync: false, clearPending: false }
          if (dirty) return { sync: false, clearPending: true }
          return { sync: !equals(draft, host), clearPending: true }
        }
        if (dirty) return { sync: false, clearPending: false }
        return { sync: !equals(draft, host), clearPending: false }
      }

      // ─────────────── 轮询节奏（P2-9：一次抛错也不能让轮询停摆） ───────────────

      /** 健康度行刷新间隔（毫秒）。健康度是"看着它慢慢涨"的东西，3 秒足够且不吵。 */
      const HEALTH_POLL_MS = 3000

      /** 出错后的退避上限（毫秒）。 */
      const HEALTH_BACKOFF_MAX_MS = 60 * 1000

      /**
       * "等数据"阶段的**快轮询**间隔（毫秒）。
       *
       * 为什么需要：老会话刚点开时，宿主那侧还没把它注册进来，第一次请求拿到的是一张**空列表**
       * —— 那既不是错误、也没有数据。用常规的 3 秒间隔，用户会以为坏了（界面上只有一句
       * "正在读取会话用量…"和一个「重试」按钮），往往等不及就手点重试。
       * 改成 600 毫秒快轮询后，界面会在用户察觉之前自己出现。
       */
      const HEALTH_WARMUP_MS = 600

      /** 快轮询最多连跑多少次（≈ 7 秒），之后回落到常规间隔，避免对着一个永远拿不到的会话高频空转。 */
      const HEALTH_WARMUP_MAX_TRIES = 12

      /** 一次 tick 的四种结局（成功 / 还在等当前会话的数据 / 业务失败 / 调用本身抛错）。 */
                                                                   

      /**
       * P2-9：一次 tick 之后"下一跳怎么排"的纯决策。
       *
       * ⚠️ 关键点：**四种结局都必须给出下一次的延时**（这里没有任何"停止"分支）。
       * 原实现写 `void tick().then(schedule)`：tick 抛错 ⇒ `schedule()` 永不执行 ⇒
       * 轮询静默死掉、界面数字冻结（2026-10-12 代码审查 P2-9）。
       * `throw` 与 `fail` 一样走退避加倍，页面隐藏时统一用长间隔。
       *
       * `warming`（当前会话还没有数据）**不进退避**：它不是错误，退避只会让界面更晚出现。
       *
       * @param input - 本次结局 / 当前退避 / 页面是否隐藏 / 已经快轮询过几次。
       * @returns 下一次延时、新的退避值与快轮询计数。
       */
      exports.nextPollStep = nextPollStep;
      function nextPollStep(input   
                            
                         
                       
                            
       )   
                       
                         
                           
        {
        const rawTried = input.warmupTried
        const tried = typeof rawTried === 'number' && Number.isFinite(rawTried) && rawTried > 0 ? Math.trunc(rawTried) : 0

        if (input.outcome === 'warming') {
          if (!input.hidden && tried < HEALTH_WARMUP_MAX_TRIES) {
            return { delayMs: HEALTH_WARMUP_MS, backoffMs: HEALTH_POLL_MS, warmupTried: tried + 1 }
          }
          // 试够了还没数据：回落到常规间隔（仍然不退避，界面继续正常显示"正在读取…"）。
          return { delayMs: input.hidden ? HEALTH_BACKOFF_MAX_MS : HEALTH_POLL_MS, backoffMs: HEALTH_POLL_MS, warmupTried: 0 }
        }

        const backoffMs = input.outcome === 'ok'
          ? HEALTH_POLL_MS
          : Math.min(input.backoffMs * 2, HEALTH_BACKOFF_MAX_MS)
        const delayMs = input.hidden ? HEALTH_BACKOFF_MAX_MS : backoffMs
        return { delayMs, backoffMs, warmupTried: 0 }
      }

      /**
       * P2-9：代次守卫——本次 tick 所属的代次不是最新代次时，响应已过期，必须丢弃。
       *
       * @param myEpoch - 本次 tick 开始时记下的代次。
       * @param currentEpoch - 当前最新代次。
       * @returns 是否过期。
       */
      exports.isStaleEpoch = isStaleEpoch;
      function isStaleEpoch(myEpoch        , currentEpoch        )          {
        return myEpoch !== currentEpoch
      }

      /** 校验通过后交给 `remote.updateConfig` 的 patch（键名与宿主入参一致）。 */
                                    
                        
                                                             
                                  
                                             
                                                                  
                               
                                               
                                       
                                  
                                   
       

      /**
       * 校验设置页的一次提交（**前端先挡一道**，宿主还会再挡一道）。
       * @param draft - 草稿（MB 单位）。
       * @returns {{ok: boolean, patch?: ConfigPatch, error?: string}} 结果。
       */
      exports.buildConfigPatch = buildConfigPatch;
      function buildConfigPatch(draft             )                                                       {
        const mb = typeof draft?.sessionVolumeMb === 'string' ? Number(draft.sessionVolumeMb) : draft?.sessionVolumeMb
        if (!isFiniteNumber(mb) || mb <= 0) {
          return { ok: false, error: '会话体积阈值要填一个大于 0 的数字（单位 MB）' }
        }
        const bytes = mbToBytes(mb)
        if (bytes < 1024 * 1024 || bytes > 512 * 1024 * 1024) {
          return { ok: false, error: '会话体积阈值要在 1 MB ~ 512 MB 之间' }
        }
        const triggerRaw = draft?.compactionTrigger
        let trigger                = null
        if (triggerRaw !== '' && triggerRaw !== null && triggerRaw !== undefined) {
          const parsed = typeof triggerRaw === 'string' ? Number(triggerRaw) : triggerRaw
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
            return { ok: false, error: '「每压缩 N 次后执行硬切」要填 1 ~ 100 的整数，或者留空表示不启用' }
          }
          trigger = parsed
        }
        // 「先不接力」后再涨多少才重问：留空 = 用默认值；填了必须在配置模块给的范围内。  // 范围与默认值都从 `HANDOFF_LIMITS` / `HANDOFF_DEFAULTS` 取（与宿主同一来源）。
        const rearmRaw = draft?.askRearmPercent
        const rearmText = rearmRaw === undefined || rearmRaw === null || rearmRaw === ''
          ? String(HANDOFF_DEFAULTS.askRearmPercent)
          : String(rearmRaw)
        const rearm = Number(rearmText)
        if (!Number.isInteger(rearm)
          || rearm < HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT
          || rearm > HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT) {
          return {
            ok: false,
            error: `「再涨多少才重问」要填 ${HANDOFF_LIMITS.MIN_ASK_REARM_PERCENT} ~ ${HANDOFF_LIMITS.MAX_ASK_REARM_PERCENT} 的整数（百分比）`,
          }
        }
        // R2「换会话前，等子代理交卷的最长时间」：留空 = 用默认值；填了必须是 1–60 的整数（分钟）。
        // 界面错误文案**冻结**为 ARB-6 的逐字口径（产品文档只写"给出人话"，以本句为准）。
        const drainRaw = draft?.subagentDrainTimeoutMin
        const drainText = drainRaw === undefined || drainRaw === null || drainRaw === ''
          ? String(HANDOFF_DEFAULTS.subagentDrainTimeoutMin)
          : String(drainRaw)
        const drainMin = Number(drainText)
        if (!Number.isInteger(drainMin)
          || drainMin < HANDOFF_LIMITS.MIN_SUBAGENT_DRAIN_TIMEOUT_MIN
          || drainMin > HANDOFF_LIMITS.MAX_SUBAGENT_DRAIN_TIMEOUT_MIN) {
          return { ok: false, error: '请输入 1–60 之间的整数（分钟）' }
        }
        const patch              = {
          enabled: draft?.enabled !== false,
          autoMode: draft?.autoMode,
          sessionVolumeBytes: bytes,
          compactionCountTrigger: trigger,
          autoPromptLevel: draft?.autoPromptLevel,
          askRearmPercent: rearm,
          // R2：等子代理交卷的最长时间（分钟）——越界文案冻结为 ARB-6 的逐字口径。
          subagentDrainTimeoutMin: drainMin,
          // 交接文档区：落盘开关（本轮不做"存目录自定义"，目录由宿主按 DSH 数据目录给）
          handoffDocPersist: draft?.handoffDocPersist !== false,
          decisionLogEnabled: draft?.decisionLogEnabled !== false,
        }
        return { ok: true, patch }
      }

      // ───────────── S1「新会话用什么样的」：模型 / 推理强度 / 工作权限（纯函数） ─────────────
      //
      // 本区照《汇总原型图.html》2026-10-12 新增的卡片 1:1 实现：三项下拉，第一项统一是
      // 「跟随原会话」；选中项变化时**只把变化的键**送宿主（全跟随 = 一个键都不送，
      // 这样"默认什么都不改"时的行为与没有这个区之前**完全一致**）。

      /** 「跟随原会话」在下拉里的取值（与原型 option value 一致）。 */
      const FOLLOW_VALUE = 'follow'

      /** 危险权限档位 id（选中时先弹确认，确认了才落地）。 */
      const DANGER_PERMISSION = 'danger-full-access'

      /**
       * 权限档位 id → 中文名（内置映射，来源：DSH 官方权限 UI 的 i18n）。
       * 未知 id 一律用宿主给的 `name` 兜底（见 `permissionPresetLabel`）。
       */
      const PERMISSION_PRESET_LABELS                                   = Object.freeze({
        'read-only': '仅可查看',
        'workspace-write': '工作区内修改',
        'danger-full-access': '完全权限',
      })

      /**
       * 权限档位的中文名：内置映射优先，未知 id 用宿主给的 name 兜底。
       * @param id - 档位 id。
       * @param fallbackName - 宿主给的显示名。
       * @returns 中文名（绝不返回空串）。
       */
      exports.permissionPresetLabel = permissionPresetLabel;
      function permissionPresetLabel(id         , fallbackName          )         {
        const key = typeof id === 'string' ? id : ''
        const known = PERMISSION_PRESET_LABELS[key]
        if (known !== undefined) return known
        if (typeof fallbackName === 'string' && fallbackName.length > 0) return fallbackName
        return key.length > 0 ? key : '未知档位'
      }

      /** 模型目录里一个模型（`efforts` 是它的推理强度档位）。 */
                                         
                   
                     
                                                       
                              
       

      /** 模型目录里的一个供应商分组。 */
                                         
                   
                     
                                   
       

      /** `remote.listModelCatalog()` 的返回体（宿主契约）。 */
                                         
                                                                                 
                                   
                                                                          
                                                    
                          
       

      /** `remote.listPermissionPresets()` 的返回体（宿主契约）。 */
                                              
                           
                       
                                                       
                                                           
                        
       

      /** 一个 `<option>`。 */
                                     
                     
                     
                                                     
                          
       

      /** 一个 `<optgroup>`。 */
                                          
                     
                               
       

      /** 模型下拉的选项模型。 */
                                     
                                   
                            
                                   
                                              
                             
                                               
                       
       

      /**
       * 在模型目录里找一个模型。
       * @param catalog - 目录。
       * @param provider - 供应商 id。
       * @param model - 模型 id。
       * @returns 模型条目或 undefined。
       */
      function findCatalogModel(catalog                              , provider          , model          )                               {
        if (typeof provider !== 'string' || typeof model !== 'string') return undefined
        for (const group of catalog?.groups ?? []) {
          if (group?.id !== provider) continue
          for (const entry of group.models ?? []) {
            if (entry?.id === model) return entry
          }
        }
        return undefined
      }

      /**
       * 模型显示名（目录里查不到就退化成 model id）。
       * @param catalog - 目录。
       * @param provider - 供应商 id。
       * @param model - 模型 id。
       * @returns 显示名或 undefined。
       */
      exports.modelDisplayName = modelDisplayName;
      function modelDisplayName(catalog                              , provider          , model          )                     {
        const entry = findCatalogModel(catalog, provider, model)
        if (entry !== undefined) {
          if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name
          if (typeof entry.id === 'string' && entry.id.length > 0) return entry.id
        }
        return typeof model === 'string' && model.length > 0 ? model : undefined
      }

      /**
       * 第一项「跟随原会话」的文案（原型：`跟随原会话（DeepSeek-V4.1-Flash）`）。
       * @param catalog - 模型目录。
       * @returns 文案。
       */
      exports.followModelLabel = followModelLabel;
      function followModelLabel(catalog                              )         {
        const name = modelDisplayName(catalog, catalog?.default?.provider, catalog?.default?.model)
        return name === undefined ? '跟随原会话' : `跟随原会话（${name}）`
      }

      /**
       * 拆开下拉值：`follow` 或 `供应商id|模型id`。
       * @param value - 下拉值。
       * @returns 拆解结果。
       */
      exports.splitModelValue = splitModelValue;
      function splitModelValue(value         )                                                         {
        if (typeof value !== 'string' || value.length === 0 || value === FOLLOW_VALUE) return { follow: true }
        const at = value.indexOf('|')
        if (at <= 0 || at === value.length - 1) return { follow: true }
        return { follow: false, provider: value.slice(0, at), model: value.slice(at + 1) }
      }

      /**
       * 配置里的模型 → 下拉值（`provider` 与 `model` 必须同时有才算选中；否则是跟随）。
       * @param config - 宿主配置（可能缺这两个键）。
       * @returns 下拉值。
       */
      exports.modelValueOf = modelValueOf;
      function modelValueOf(config                                                     )         {
        const provider = typeof config?.provider === 'string' ? config.provider : ''
        const model = typeof config?.model === 'string' ? config.model : ''
        return provider.length > 0 && model.length > 0 ? `${provider}|${model}` : FOLLOW_VALUE
      }

      /**
       * 按原型构建模型下拉：第一项「跟随原会话」，下面按 `groups` 分组列模型。
       * @param input - 目录与当前配置。
       * @returns 选项模型。
       */
      exports.buildModelOptions = buildModelOptions;
      function buildModelOptions(input                                                                                   )               {
        const catalog = input.catalog
        const groups                      = []
        for (const group of catalog?.groups ?? []) {
          const options                 = []
          for (const entry of group?.models ?? []) {
            if (typeof entry?.id !== 'string' || entry.id.length === 0) continue
            const groupId = typeof group?.id === 'string' && group.id.length > 0 ? group.id : ''
            if (groupId.length === 0) continue
            options.push({ value: `${groupId}|${entry.id}`, label: (typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id) })
          }
          if (options.length === 0) continue
          groups.push({ label: (typeof group.name === 'string' && group.name.length > 0 ? group.name : (typeof group.id === 'string' ? group.id : '未分组')), options })
        }

        const hints           = []
        for (const failure of catalog?.failures ?? []) {
          const name = (typeof failure?.name === 'string' && failure.name.length > 0) ? failure.name : (typeof failure?.id === 'string' ? failure.id : '未知供应商')
          const message = typeof failure?.message === 'string' && failure.message.length > 0 ? failure.message : '读取失败'
          hints.push(`模型目录里「${name}」没读到：${message}`)
        }

        // ⚠️ 目录整个是空的（既没有分组的模型、也没有失败记录）：必须给出**可解释**的提示。
        //    真实场景（2026-10-12 真机）：宿主 `listProviders()` 拿不到，或各 provider 的 `listModels()`
        //    返回空数组（要联网拉取 / 凭据没配好）⇒ 下拉里只剩「跟随原会话」，用户完全不知道为什么。
        if (catalog !== undefined && groups.length === 0 && hints.length === 0) {
          const why = typeof catalog.diagnosis === 'string' && catalog.diagnosis.length > 0 ? `（${catalog.diagnosis}）` : ''
          hints.push(`这台机器上没读到可用模型${why}：请确认「DSH 设置 → 模型」里能看到模型列表`)
        }

        // 兜底：配置里写着的模型如果不在目录里，也给它一个能显示出来的选项，别让下拉变空。
        const extra                 = []
        const currentValue = modelValueOf(input.current)
        const parsed = splitModelValue(currentValue)
        if (!parsed.follow) {
          const inCatalog = findCatalogModel(catalog, parsed.provider, parsed.model) !== undefined
          if (!inCatalog) {
            extra.push({ value: currentValue, label: modelDisplayName(catalog, parsed.provider, parsed.model) ?? String(parsed.model) })
          }
        }

        return { follow: { value: FOLLOW_VALUE, label: followModelLabel(catalog) }, groups, extra, hints }
      }

      /** 推理强度下拉的选项模型。 */
                                      
                                   
                            
                                                                
                               
                       
       

      /**
       * 按原型构建推理强度下拉：选项**跟着所选模型变**，且**全部可选**。
       *
       * ⚠️ 2026-10-14 真机纠偏：旧实现让"模型选「跟随原会话」"时把自定义档位**全部禁用**
       *    （注释还自称"照原型语义"，其实是错的）。查证依据：
       *      · `汇总原型图.html` 的 `#effortSelect` 四个 `<option>` **没有任何 `disabled`**；
       *      · M2 产品文档 M2-N2 只说"选项跟着所选模型变；第一项恒为「跟随原会话」"；
       *      · 宿主侧 `resolveRoute()` 里 `childReasoningEffort` 与 provider/model **各自独立**生效
       *        （模型留空=跟随原会话，也只影响模型；档位照样按配置发出去）。
       *    ⇒ 用户"模型跟随 + 单独指定推理强度"是完全合法的用法，禁用是多余限制。
       *    （M2 设计文档 §385 的那条联动仍然保留：**换模型**时档位不支持就回落「跟随原会话」。）
       *
       * @param input - 目录、当前模型下拉值、当前会话自己的档位。
       * @returns 选项模型。
       */
      exports.effortOptionsOf = effortOptionsOf;
      function effortOptionsOf(input                                                                              )                {
        const catalog = input.catalog
        const parsed = splitModelValue(input.modelValue)
        const targetProvider = parsed.follow ? catalog?.default?.provider : parsed.provider
        const targetModel = parsed.follow ? catalog?.default?.model : parsed.model
        const entry = findCatalogModel(catalog, targetProvider, targetModel)
        const efforts = entry?.efforts ?? []

        // 「跟随原会话」括号里显示的是：具体模型时=原会话自己的档位；跟随模型时=目录给的默认档位。
        const inheritedId = parsed.follow
          ? catalog?.default?.reasoningEffort
          : (typeof input.currentEffort === 'string' && input.currentEffort.length > 0 ? input.currentEffort : catalog?.default?.reasoningEffort)
        const inheritedName = resolveEffortName(catalog, inheritedId)

        const options                 = []
        for (const effort of efforts) {
          if (typeof effort?.id !== 'string' || effort.id.length === 0) continue
          options.push({ value: effort.id, label: (typeof effort.name === 'string' && effort.name.length > 0 ? effort.name : effort.id) })
        }
        // 兜底两条：①「跟随」标签里那个档位；②**用户当前选中的**那个档位。
        // 它们不在档位表里时补进去，避免下拉"看不见当前值"（否则会显示成空白）。
        for (const fallbackId of [textOf(inheritedId), textOf(input.currentEffort)]) {
          if (fallbackId.length === 0 || options.some((option) => option.value === fallbackId)) continue
          options.push({ value: fallbackId, label: resolveEffortName(catalog, fallbackId) ?? fallbackId })
        }

        const hints           = []
        if (!parsed.follow && entry === undefined) {
          hints.push('这个模型不在当前目录里，推理强度只能跟随原会话')
        }

        return {
          follow: { value: FOLLOW_VALUE, label: inheritedName === undefined ? '跟随原会话' : `跟随原会话（${inheritedName}）` },
          options,
          hints,
        }
      }

      /**
       * 档位 id → 显示名（先在本模型/默认模型的档位表里找，找不到就用 id 本身）。
       * @param catalog - 目录。
       * @param effortId - 档位 id。
       * @returns 显示名或 undefined。
       */
      function resolveEffortName(catalog                              , effortId         )                     {
        const wanted = textOf(effortId)
        if (wanted.length === 0) return undefined
        const candidates                     = []
        const defaultEntry = findCatalogModel(catalog, catalog?.default?.provider, catalog?.default?.model)
        if (defaultEntry !== undefined) candidates.push(defaultEntry)
        for (const group of catalog?.groups ?? []) {
          for (const entry of group?.models ?? []) candidates.push(entry)
        }
        for (const entry of candidates) {
          for (const effort of entry?.efforts ?? []) {
            if (effort?.id === wanted && typeof effort.name === 'string' && effort.name.length > 0) return effort.name
          }
        }
        return wanted
      }

      /**
       * 所选模型**真正支持**的档位 id（不含展示用的兜底项）。
       * @param input - 目录与模型下拉值。
       * @returns 是否只能跟随 + 档位 id。
       */
      exports.effortIdsOfModel = effortIdsOfModel;
      function effortIdsOfModel(input                                                     )                                           {
        const catalog = input.catalog
        const parsed = splitModelValue(input.modelValue)
        const entry = findCatalogModel(
          catalog,
          parsed.follow ? catalog?.default?.provider : parsed.provider,
          parsed.follow ? catalog?.default?.model : parsed.model,
        )
        const ids           = []
        for (const effort of entry?.efforts ?? []) {
          if (typeof effort?.id === 'string' && effort.id.length > 0) ids.push(effort.id)
        }
        return { forcedFollow: parsed.follow || entry === undefined, ids }
      }

      /**
       * 换模型时算下一份选择（推理强度跟着模型联动：新模型没有的档位回落到「跟随原会话」）。
       * @param input - 当前选择、目录、新的模型下拉值。
       * @returns 下一份选择。
       */
      exports.nextChoiceForModel = nextChoiceForModel;
      function nextChoiceForModel(input                                                                                       )                        {
        const support = effortIdsOfModel({ catalog: input.catalog, modelValue: input.nextModelValue })
        const kept = !support.forcedFollow
          && input.choice?.effort !== FOLLOW_VALUE
          && support.ids.includes(input.choice.effort)
          ? input.choice.effort
          : FOLLOW_VALUE
        return { model: input.nextModelValue, effort: kept, permission: input.choice?.permission ?? FOLLOW_VALUE }
      }

      /** 工作权限下拉的选项模型。 */
                                          
                                   
                            
                               
                          
                                          
                                
                                      
                             
       

      /**
       * 按原型构建工作权限下拉：第一项「跟随原会话」，下面三个内置档位。
       * @param input - 宿主返回的档位表与当前配置。
       * @returns 选项模型。
       */
      exports.buildPermissionOptions = buildPermissionOptions;
      function buildPermissionOptions(input                                                        )                    {
        const presets = input.presets
        const currentId = typeof presets?.current === 'string' && presets.current.length > 0
          ? presets.current
          : (typeof input.current === 'string' && input.current.length > 0 ? input.current : undefined)
        const followLabel = currentId === undefined ? '跟随原会话' : `跟随原会话（${permissionPresetLabel(currentId)}）`

        if (presets === undefined) {
          return { follow: { value: FOLLOW_VALUE, label: followLabel }, options: [], supported: false, hint: undefined, extra: [] }
        }
        if (presets.supported === false) {
          return {
            follow: { value: FOLLOW_VALUE, label: followLabel },
            options: [],
            supported: false,
            hint: (typeof presets.reason === 'string' && presets.reason.length > 0 ? presets.reason : '当前 DSH 版本不支持切换新会话的工作权限'),
            extra: [],
          }
        }

        const options                 = []
        for (const preset of presets.presets ?? []) {
          if (typeof preset?.id !== 'string' || preset.id.length === 0) continue
          options.push({ value: preset.id, label: permissionPresetLabel(preset.id, preset.name) })
        }

        const extra                 = []
        const configured = typeof input.current === 'string' ? input.current : ''
        if (configured.length > 0 && !options.some((option) => option.value === configured)) {
          extra.push({ value: configured, label: permissionPresetLabel(configured) })
        }

        // 服务在、但档位一个都没读到：同样要说出来，别让下拉只剩「跟随原会话」（与模型下拉同一口径）。
        const emptyHint = options.length === 0
          ? '没读到可用的权限档位：请确认当前 DSH 版本支持权限切换'
          : undefined
        return { follow: { value: FOLLOW_VALUE, label: followLabel }, options, supported: true, hint: emptyHint, extra }
      }

      /** 新会话三项的一组选择（下拉值）。 */
                                              
                                       
                     
                               
                      
                                 
                          
       

      /**
       * 宿主 config 里这四项的取值（空串 / 缺席 = 跟随原会话）。
       *
       * ⚠️ 键名以宿主 `lib/handoff-config.mjs` 为准（2026-10-12 落地版）：
       *    新会话的推理强度是 **`childReasoningEffort`**，不是 `reasoningEffort`——
       *    后者是上游 /handoff 摘要那个既有键，共用一个会让"跟随原会话"的空串被当成真实取值发给模型。
       */
                                            
                         
                      
                                     
                                      
       

      /** 一次提交的补丁（**只含真的变了的键**）。 */
                                             
                         
                      
                                     
                                      
       

      /**
       * 字符串取值守卫（缺字段一律按空串，空串 = 跟随原会话）。
       * @param value - 任意值。
       * @returns 字符串。
       */
      function textOf(value         )         {
        return typeof value === 'string' ? value : ''
      }

      /**
       * 宿主 config → 三项下拉的当前选择。
       * @param config - 宿主 config（可能缺这些键）。
       * @returns 选择。
       */
      exports.sessionDraftFromConfig = sessionDraftFromConfig;
      function sessionDraftFromConfig(config                                 )                        {
        return {
          model: modelValueOf(config),
          effort: textOf(config?.childReasoningEffort).length > 0 ? textOf(config?.childReasoningEffort) : FOLLOW_VALUE,
          permission: textOf(config?.childPermissionPreset).length > 0 ? textOf(config?.childPermissionPreset) : FOLLOW_VALUE,
        }
      }

      /**
       * 三项下拉 → `remote.updateConfig` 的补丁。
       *
       * ⚠️ 关键不变量：**值没变就不带这个键**。三项全默认「跟随原会话」时返回空补丁 ⇒
       * 设置页的保存行为与新增本区之前**完全一致**（不会平白多出 provider/model 这些键）。
       *
       * @param input - 用户选的三项 + 宿主当前值。
       * @returns 补丁与变化了的键名。
       */
      exports.buildSessionDefaultsPatch = buildSessionDefaultsPatch;
      function buildSessionDefaultsPatch(input                                                                                     )                                                  {
        const host = input.host ?? {}
        const parsed = splitModelValue(input.choice?.model)
        const desiredProvider = parsed.follow ? '' : textOf(parsed.provider)
        const desiredModel = parsed.follow ? '' : textOf(parsed.model)
        const desiredEffort = input.choice?.effort === FOLLOW_VALUE ? '' : textOf(input.choice?.effort)
        const desiredPermission = input.choice?.permission === FOLLOW_VALUE ? '' : textOf(input.choice?.permission)

        const patch                       = {}
        const keys           = []
        if (textOf(host.provider) !== desiredProvider || textOf(host.model) !== desiredModel) {
          patch.provider = desiredProvider
          patch.model = desiredModel
          keys.push('provider', 'model')
        }
        if (textOf(host.childReasoningEffort) !== desiredEffort) {
          patch.childReasoningEffort = desiredEffort
          keys.push('childReasoningEffort')
        }
        if (textOf(host.childPermissionPreset) !== desiredPermission) {
          patch.childPermissionPreset = desiredPermission
          keys.push('childPermissionPreset')
        }
        return { patch, keys }
      }

      // ───────────── 交接文档列表（纯函数：列表行格式化、失败态、上限提示） ─────────────

      /**
       * 列表上限（与宿主 `lib/handoff-docs.mjs` 的 `MAX_LISTED_DOCS` 同值）。
       *
       * ⚠️ 这里**不能 import** 宿主模块：那个模块依赖 node:fs，import 进浏览器 bundle 会炸。
       *    宿主漏给 total 时，本常量用来判断"是不是被截断了"。
       */
      const DOC_LIST_LIMIT = 50

      /**
       * `remote.listHandoffDocs()` 的一个文件条目。
       *
       * `reason` 是宿主 2026-10-12 起直接给的**触发原因短标签**（它已经把文档头部的
       * `- 触发原因：xxx` 解析好了）；宿主旧版本没有这个字段时，客户端才回落去读正文自己解析。
       */
                                    
                     
                     
                      
                   
                       
       

      /** `remote.listHandoffDocs()` 的返回体（`total` 是宿主可选的"一共多少份"）。 */
                                    
                    
                        
                             
                                           
                      
       

      /** 列表里的一行。 */
                               
                   
                    
                             
                    
                             
                   
                        
                    
                                  
       

      /** 补零到两位。 */
      function pad2(value        )         {
        return value < 10 ? `0${value}` : String(value)
      }

      /**
       * 列表行的时间：`MM-DD HH:mm`（本地时区）。
       * @param at - 毫秒时间戳。
       * @returns 文案（无效值给 `—`）。
       */
      exports.formatDocTime = formatDocTime;
      function formatDocTime(at         )         {
        if (!isFiniteNumber(at) || at <= 0) return '—'
        const date = new Date(at)
        if (Number.isNaN(date.getTime())) return '—'
        return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      }

      /**
       * 详情卡的时间：`YYYY-MM-DD HH:mm`（本地时区，照原型 `2026-10-12 13:30`）。
       * @param at - 毫秒时间戳。
       * @returns 文案（无效值给 `—`）。
       */
      exports.formatDocFullTime = formatDocFullTime;
      function formatDocFullTime(at         )         {
        if (!isFiniteNumber(at) || at <= 0) return '—'
        const date = new Date(at)
        if (Number.isNaN(date.getTime())) return '—'
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      }

      /** 交付文档文件名的解析结果。 */
                                            
                                          
                              
                                  
                                       
       

      /** 文件名形态：`2026-10-12T13-30-00-000Z-session-1b523ee9.md`（`safeIsoTime` 把 `:`/`.` 换成了 `-`）。 */
      const DOC_STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.+)$/

      /**
       * 从交接文档文件名里解析"文件时间 + 会话短码"。
       * @param name - 文件名。
       * @returns 解析结果（认不出来时把整段当短码，时间交给 mtime）。
       */
      exports.parseHandoffDocName = parseHandoffDocName;
      function parseHandoffDocName(name         )                      {
        const base = String(name ?? '').replace(/\.md$/i, '')
        const match = DOC_STAMP_RE.exec(base)
        if (match === null) return { at: undefined, sessionCode: base.length > 0 ? base : undefined }
        const at = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`)
        return { at: Number.isFinite(at) ? at : undefined, sessionCode: match[8] !== undefined && match[8].length > 0 ? match[8] : undefined }
      }

      /**
       * 触发原因短标签（列表行里那一段小字）。
       *
       * 文档头部的 `- 触发原因：` 有可能是**原始代码**（manual / session-volume / …），
       * 也有可能是宿主 `humanReason()` 拼出来的一整句话；两种都要能收敛成短标签。
       */
      const TRIGGER_REASON_LABELS                                   = Object.freeze({
        manual: '手工接力',
        'replace-threshold': '替代模式到线',
        'session-volume': '会话体积到线',
        'compaction-count': '压缩次数到线',
      })

      /**
       * 触发原因 → 短标签。
       * @param raw - 原始值（代码或人话）。
       * @returns 短标签或 undefined。
       */
      exports.shortTriggerReason = shortTriggerReason;
      function shortTriggerReason(raw         )                     {
        if (typeof raw !== 'string') return undefined
        const text = raw.trim()
        if (text.length === 0) return undefined
        // 文档头部可能写成 `manual（{"safePoint":true}）`：括号里是细节，不是原因本身，先去干净。
        const cut = (text.split(/[（(→]/, 1)[0] ?? '').trim().replace(/[。，,；;:：]+$/, '')
        const mapped = TRIGGER_REASON_LABELS[text] ?? TRIGGER_REASON_LABELS[cut]
        if (mapped !== undefined) return mapped
        if (cut.length === 0) return undefined
        return cut.length > 16 ? `${cut.slice(0, 16)}…` : cut
      }

      /**
       * 从交接文档正文里取出「触发原因」短标签。
       * @param markdown - 文档全文。
       * @returns 短标签或 undefined。
       */
      exports.docTriggerReasonOf = docTriggerReasonOf;
      function docTriggerReasonOf(markdown         )                     {
        if (typeof markdown !== 'string') return undefined
        const match = /^-\s*触发原因：(.+)$/m.exec(markdown)
        if (match === null) return undefined
        return shortTriggerReason(match[1])
      }

      /**
       * 一个文件 → 列表一行。
       * @param file - 宿主给的条目。
       * @param reason - 已知的触发原因短标签（可能还没读到）。
       * @returns 一行。
       */
      exports.docRowOf = docRowOf;
      function docRowOf(file                         , reason         )         {
        const name = typeof file?.name === 'string' ? file.name : ''
        const parts = parseHandoffDocName(name)
        const who = parts.sessionCode === undefined
          ? (reason === undefined ? name : `${name} · ${reason}`)
          : (reason === undefined ? parts.sessionCode : `${parts.sessionCode} · ${reason}`)
        return {
          key: name,
          name,
          when: formatDocTime(isFiniteNumber(file?.at) && file.at > 0 ? file.at : parts.at),
          who,
          size: formatBytes(isFiniteNumber(file?.bytes) ? file.bytes : Number.NaN),
          reason,
        }
      }

      /** 交接文档列表的视图模型。 */
                                         
                   
                   
                      
                                            
                                 
                                      
                                 
                                
                                
                                               
                                 
       

      /**
       * `listHandoffDocs` 结果 → 列表视图模型。
       * @param input - 远程结果与"已读到的触发原因"表。
       * @returns 视图模型。
       */
      exports.docListViewModel = docListViewModel;
      function docListViewModel(input   
                                                                               
                                                    
       )                   {
        if (!input.result.ok) {
          return { ok: false, dir: '', rows: [], empty: undefined, error: `读取交接文档目录失败：${input.result.error}`, more: undefined, total: undefined }
        }
        const value = input.result.value ?? {}
        const dir = textOf(value.dir)
        const files = Array.isArray(value.files) ? value.files : []
        const rows = [...files]
          .sort((a, b) => (isFiniteNumber(b?.at) ? b.at : 0) - (isFiniteNumber(a?.at) ? a.at : 0))
          // 触发原因优先用宿主直接给的（一跳到位）；宿主旧版本没给才用"读正文解析出来"的那份。
          .map((file) => docRowOf(file, textOf(file?.reason).length > 0 ? textOf(file?.reason) : input.reasons?.[textOf(file?.name)]))
        const total = isFiniteNumber(value.total) ? value.total : undefined
        const more = rows.length >= DOC_LIST_LIMIT
          ? (total !== undefined && total > rows.length
            ? `还有 ${total - rows.length} 份更早的 —— 点「打开存储目录」看全部`
            : '还有更早的 —— 点「打开存储目录」看全部')
          : undefined
        const empty = rows.length > 0
          ? undefined
          : (value.exists === false ? `存储目录还不存在：${dir}` : '还没有交接文档。第一次换会话之后就会出现在这里。')
        return { ok: true, dir, rows, empty, error: undefined, more, total: total ?? rows.length }
      }

      /**
       * 详情卡的标题行时间：`2026-10-12 13:30 · session-1b523ee9`（照原型）。
       * @param at - 时间戳。
       * @param sessionCode - 会话短码。
       * @returns 文案。
       */
      exports.detailTimeLine = detailTimeLine;
      function detailTimeLine(at         , sessionCode         )         {
        const time = formatDocFullTime(at)
        const code = textOf(sessionCode)
        return code.length > 0 ? `${time} · ${code}` : time
      }

      // ─────────────── R4（2026-10-17）：手动换会话卡片 · 留言区 · 技能面板（纯函数） ───────────────

      /** 技能面板一行（`listSkills` 的裸值条目，M1 §12.3(b)）。 */
                                   
                    
                           
                           
                                 
                   
       

      /** 按**码点**截到 500（与 host 侧 `normalizeNote` 同一口径，双保险）。 */
      exports.clampNoteByCodePoints = clampNoteByCodePoints;
      function clampNoteByCodePoints(value        )         {
        const points = Array.from(value)
        return points.length <= MAX_NOTE_CHARS ? value : points.slice(0, MAX_NOTE_CHARS).join('')
      }

      /** 留言的码点长度（字数计数用；`已输入 N / 500` 里的 N）。 */
      exports.noteLengthOf = noteLengthOf;
      function noteLengthOf(value        )         {
        return Array.from(value).length
      }

      /** 字数计数逐字文本（清单 §1：`已输入 N / 500`）。 */
      exports.noteCountText = noteCountText;
      function noteCountText(value        )         {
        return R4_TEXTS.NOTE_COUNT_TEMPLATE
          .replace('{n}', String(noteLengthOf(value)))
          .replace('{max}', String(MAX_NOTE_CHARS))
      }

      /** 到 500 上限 ⇒ 计数标红（清单 §1）。 */
      exports.noteCountIsFull = noteCountIsFull;
      function noteCountIsFull(value        )          {
        return noteLengthOf(value) >= MAX_NOTE_CHARS
      }

      /**
       * 技能面板点击一行：把逐字 ` /技能名 ` 插到留言的**光标处**（清单 §1/§2.5）。
       *
       * 返回新文本与插入后的光标位置（UTF-16 下标，可直接喂 `setSelectionRange`）。
       * 超 500 码点按同一口径截断；**不做任何别的改写**。
       *
       * @param input - 输入。
       * @returns 新留言与光标位置。
       */
      exports.insertSkillText = insertSkillText;
      function insertSkillText(input                                                              )                                  {
        const note = typeof input.note === 'string' ? input.note : ''
        const rawStart = typeof input.start === 'number' && Number.isFinite(input.start) ? input.start : note.length
        const rawEnd = typeof input.end === 'number' && Number.isFinite(input.end) ? input.end : rawStart
        const start = Math.max(0, Math.min(rawStart, note.length))
        const end = Math.max(start, Math.min(rawEnd, note.length))
        const piece = ` /${input.name} `
        const next = clampNoteByCodePoints(`${note.slice(0, start)}${piece}${note.slice(end)}`)
        return { note: next, caret: Math.min(start + piece.length, next.length) }
      }

      /** 技能面板的搜索过滤（本地包含匹配，不新增 RPC；M2 §11.3 规则 5）。 */
      exports.filterSkills = filterSkills;
      function filterSkills(skills              , query        )               {
        const list = Array.isArray(skills) ? skills : []
        const q = String(query ?? '').trim().toLowerCase()
        if (q.length === 0) return list
        return list.filter((skill) => `${skill.displayName} ${skill.name} ${skill.description}`.toLowerCase().includes(q))
      }

      /** `group` 枚举 → 逐字分组名（本地安装 / 市场安装）。 */
      exports.skillGroupLabel = skillGroupLabel;
      function skillGroupLabel(group        )         {
        return group === 'market' ? R4_TEXTS.SKILL_GROUP_MARKET : R4_TEXTS.SKILL_GROUP_LOCAL
      }

      /**
       * 把技能列表按分组切开（**固定顺序**：本地安装 → 市场安装；空组不出现）。
       * @param skills - 已过滤的列表。
       * @returns 分组列表。
       */
      exports.skillGroupsOf = skillGroupsOf;
      function skillGroupsOf(skills              )                                                                            {
        const list = Array.isArray(skills) ? skills : []
        const groups                                                                            = [
          { group: 'local', label: skillGroupLabel('local'), skills: [] },
          { group: 'market', label: skillGroupLabel('market'), skills: [] },
        ]
        for (const skill of list) {
          const target = skill.group === 'market' ? groups[1] : groups[0]
          if (target !== undefined) target.skills.push(skill)
        }
        return groups.filter((entry) => entry.skills.length > 0)
      }

      /** 把技能引用做一次去重（按首次出现顺序），供 `handoffNow` 的 `skillRefs` 用。 */
      exports.pushSkillRef = pushSkillRef;
      function pushSkillRef(refs          , ref        )           {
        const list = Array.isArray(refs) ? refs : []
        return list.includes(ref) ? list : [...list, ref]
      }

      // ─────────────── R4 补（task-27）：视觉与原型 1:1 的纯函数 ───────────────

      /** 留言文本框最小高度（设计文档：2 行起 = 52px）。 */
      const NOTE_MIN_HEIGHT_PX = 52
      /** 留言文本框最大高度（设计文档：4 行封顶 = 88px）。 */
      const NOTE_MAX_HEIGHT_PX = 88

      /**
       * 留言框自动增高（原型 `r4GrowLeave` 口径：2 行起、4 行封顶、超出内滚）。
       *
       * 原型算法：`lineH = scrollHeight / 2`（2 行基线 → 单行高）、`cap = lineH * 4`、
       * `height = min(scrollHeight, cap)`；再用设计文档的 52/88 兜住上下界（避免字体差异越界）。
       *
       * @param scrollHeight - 文本域内容滚动高度（px）。
       * @returns 应设置的像素高度（52–88）。
       */
      exports.noteAutoGrowHeightPx = noteAutoGrowHeightPx;
      function noteAutoGrowHeightPx(scrollHeight        )         {
        if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return NOTE_MIN_HEIGHT_PX
        const linePx = scrollHeight / 2
        const cap = linePx * 4
        return Math.max(NOTE_MIN_HEIGHT_PX, Math.min(scrollHeight, cap, NOTE_MAX_HEIGHT_PX))
      }

      /**
       * 技能行图标里的「显示名首字」（原型 `.skill-row-ico`：显示名首字的小方块）。
       * @param displayName - 技能显示名。
       * @returns 首字（按码点取，emoji 不会被劈开）；空名字回落 `技`。
       */
      exports.skillInitialOf = skillInitialOf;
      function skillInitialOf(displayName        )         {
        const points = Array.from(String(displayName ?? '').trim())
        return points.length > 0 ? points[0]           : '技'
      }

      /** 交接文档预览里的一行。 */
                                           
                                       
                 
                                             
                 
       

      /**
       * 卡片内「交接文档预览」的列表（**纯视觉**，不产生任何 RPC）。
       *
       * 顺序与真实文档一致：留言（仅当有）→ 5 个固定小节。留言为空时 `0. 交接人留言` 不出现
       * （与「留空不出节」一致）；小节数提示随之联动（原型 `8 个 / 9 个` → 本插件 5 / 6 个）。
       *
       * @param input - 输入。
       * @param input.note - 当前留言草稿（空串 = 没留言）。
       * @param input.sectionTitles - 5 个固定小节标题（`HANDOFF_DOC_SECTIONS`，由调用方传入避免客户端再抄一份）。
       * @returns 预览行与小节数提示文本。
       */
      exports.handoffPreviewOf = handoffPreviewOf;
      function handoffPreviewOf(input                                                    )   
                                   
                    
                         
        {
        const note = typeof input.note === 'string' ? input.note : ''
        const titles = Array.isArray(input.sectionTitles) ? input.sectionTitles : []
        const noteItems                       = note.length > 0
          ? [{ n: R4_TEXTS.PREVIEW_NOTE_ITEM, c: note }]
          : []
        const sectionItems                       = titles.map((title, index) => ({
          n: `${index + 1}. ${title}`,
          c: PREVIEW_SECTION_HINTS[title] ?? '由本次会话整理',
        }))
        const items = [...noteItems, ...sectionItems]
        return {
          items,
          hint: R4_TEXTS.PREVIEW_HINT_TEMPLATE.replace('{n}', String(items.length)),
          baseCount: titles.length,
        }
      }

      /** 每个固定小节在预览里的一句"会写什么"（视觉占位，不是真实内容）。 */
      const PREVIEW_SECTION_HINTS                                   = Object.freeze({
        用户需求: '从本次会话提炼你的目标与原话',
        方案梗概: '模型总结最近几轮的做法与取舍',
        已完成: '列出已经做完的事与产物',
        涉及文件与产物: '列出碰过的文件与产物',
        接下来做什么: '给新会话的下一步与待办',
      })

      ;exports.LEVEL_TOKEN = LEVEL_TOKEN;exports.LEVEL_LABEL = LEVEL_LABEL;exports.DRAIN_LATCH_MS = DRAIN_LATCH_MS;exports.EMPTY_DRAIN_LATCH = EMPTY_DRAIN_LATCH;exports.MODE_CARDS = MODE_CARDS;exports.PROMPT_LEVELS = PROMPT_LEVELS;exports.HEALTH_POLL_MS = HEALTH_POLL_MS;exports.HEALTH_BACKOFF_MAX_MS = HEALTH_BACKOFF_MAX_MS;exports.HEALTH_WARMUP_MS = HEALTH_WARMUP_MS;exports.HEALTH_WARMUP_MAX_TRIES = HEALTH_WARMUP_MAX_TRIES;exports.FOLLOW_VALUE = FOLLOW_VALUE;exports.DANGER_PERMISSION = DANGER_PERMISSION;exports.PERMISSION_PRESET_LABELS = PERMISSION_PRESET_LABELS;exports.DOC_LIST_LIMIT = DOC_LIST_LIMIT;exports.TRIGGER_REASON_LABELS = TRIGGER_REASON_LABELS;exports.NOTE_MIN_HEIGHT_PX = NOTE_MIN_HEIGHT_PX;exports.NOTE_MAX_HEIGHT_PX = NOTE_MAX_HEIGHT_PX
    },
    "./src/client/styles.ts": (exports, __req) => {
      // 样式入口：设计令牌逐字副本 + 本插件样式。
      //
      // 令牌来源：DSH 桌面端主题变量（prism.css v2），副本见 `lib/client/tokens.css`。
      // 组件里**禁止**出现任何硬编码色值/字号，样式统一由本文件与令牌提供。
      //
      // ⚠️ 令牌同时挂在 `.dark` 下（与 prism.css 一致），因此**暗色模式不需要任何组件分支**。

      const {CSS_NS} = __req("./src/client/ui.ts")

      /** 设计令牌（逐字副本）。 */
      const TOKENS_CSS = `
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
      const PLUGIN_CSS = `
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
      exports.installStyles = installStyles;
      function installStyles()       {
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

      ;exports.TOKENS_CSS = TOKENS_CSS;exports.PLUGIN_CSS = PLUGIN_CSS
    },
    "./lib/handoff-health.mjs": (exports, __req) => {
      // 健康度结论（三色 / N 轮外推 / 文案格式化 / 涨速台账 / 明细表）——**纯计算，零依赖**。
      //
      // 设计规则：两指标取最差定颜色；「还能撑约 N 轮」由涨速外推。
      //
      // 本模块同时被两侧使用：
      //   - host：`lib/handoff-report.mjs` 组装 DTO 时算不出结论，由客户端算；
      //   - client：`src/client/handoff-health.d.ts` 声明类型后直接 import 本文件（内联进 lib/client.js）。
      // 因此这里**绝不能 import 任何 @deepseek-ai/* 或 node 内建**。
      //
      // ⚠️ 唯一允许的跨模块依赖是 `./handoff-config.mjs`（P2-3：兜底比例单一来源）。
      //    已逐行确认它与 `./constants.mjs` **都不 import 任何 node 内建 / @deepseek-ai/* 包**，
      //    只用纯 JS（Object / JSON / Number），因此内联进浏览器 bundle 是安全的；
      //    代价是客户端产物会多内联进一点点配置常量与校验代码（可忽略，换来"比例只有一份"）。

      const {HANDOFF_DEFAULTS} = __req("./lib/handoff-config.mjs")

      /** 三色档位。 */
      const HEALTH_LEVELS = Object.freeze(['green', 'warning', 'danger'])

      /** 琥珀档起点系数：任一指标 ≥ 阈值 × 0.85（设计文档 §一 S2 三色规则）。 */
      const WARN_FACTOR = 0.85

      /** 涨速样本窗口（毫秒）。 */
      const HISTORY_WINDOW_MS = 10 * 60 * 1000

      /** 样本上限（防止长时间不换会话时无限增长）。 */
      const HISTORY_MAX_SAMPLES = 40

      /** 一个"步"的估算时长（毫秒）。只在拿不到"轮次"增量的降级路径里用。 */
      const STEP_MS_FALLBACK = 45 * 1000

      /** 一"轮"的步数估算（拿不到 turnIndex 增量时，按每轮约 3 步折算）。 */
      const STEPS_PER_TURN_FALLBACK = 3

      /** 结论句里的定性词。 */
      const PACE_WORDS = Object.freeze([
        '很稳',
        '正常',
        '偏快',
        '很快',
      ])

      /**
       * 取两者中最差的颜色（绿 < 琥珀 < 红）。
       *
       * ⚠️ **全空返回 `undefined`，不再返回 `'green'`**（P1-6 修复）：
       *    以前 `indexOf(undefined) = -1`、`worst = 0`，于是「两个指标都量不到」被
       *    `worstLevel` 偷偷解释成绿色健康。现在"量不到"是显式事实，由 `computeHealth`
       *    按保守口径（`measured === false` → `warning`）裁决，本函数不再代替它做决定。
       *
       * @param {...('green'|'warning'|'danger'|undefined)} levels - 候选颜色。
       * @returns {'green'|'warning'|'danger'|undefined} 最差颜色；全部不可用（或没传）时 undefined。
       */
      exports.worstLevel = worstLevel;
      function worstLevel(...levels) {
        let worst = -1
        for (const level of levels) {
          const index = HEALTH_LEVELS.indexOf(level)
          if (index > worst) worst = index
        }
        return worst < 0 ? undefined : HEALTH_LEVELS[worst]
      }

      /**
       * 单个指标的档位（≥ 阈值 → danger；≥ 阈值 × 0.85 → warning；否则 green）。
       * 任一输入不可用（NaN / 窗口缺失 / 阈值为 0）→ undefined（明细表里显示「—」）。
       * @param {{value?: number, limit?: number}} input - 当前值与阈值。
       * @returns {'green'|'warning'|'danger'|undefined} 档位。
       */
      exports.levelFor = levelFor;
      function levelFor({ value, limit }) {
        if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return undefined
        if (value >= limit) return 'danger'
        if (value >= limit * WARN_FACTOR) return 'warning'
        return 'green'
      }

      /**
       * 计算健康度结论（三色 + 每个指标的位置）。
       *
       * 阈值的取法（设计文档 §一 S2 表格）：
       * - 替代模式 replace：上下文阈值 = **原生阈值 × 0.98**（即抢跑线），并给出刻度线；
       * - 混合模式 hybrid：上下文不进判定（交给原生压缩），**不画刻度线**；会话体积进判定；
       * - 原生模式 native：只展示当前值（两个指标都画阈值刻度，但结论恒为绿——插件不动作）。
       *
       * @param {object} input - 输入。
       * @param {'replace'|'hybrid'|'native'} input.mode - 档位。
       * @param {number} [input.usedTokens] - 上下文占用 token。
       * @param {number} [input.windowTokens] - 生效窗口 token。
       * @param {number} [input.nativeThresholdTokens] - 原生生效阈值 token（读不到留空）。
       * @param {number} [input.nativeCompactionRatio] - 读不到原生阈值时的兜底比例；
       *   缺省取 `HANDOFF_DEFAULTS.nativeCompactionRatio`（与 `handoff-policy` 同源，P2-3）。
       * @param {number} [input.replaceSafetyFactor] - 档①抢跑系数。
       * @param {number} [input.sessionBytes] - 会话体积（字节）。
       * @param {number} [input.sessionVolumeLimitBytes] - 会话体积阈值（字节）。
       * @returns {object} 结论对象；`measured` 说明"这次到底量到了什么"。
       */
      exports.computeHealth = computeHealth;
      function computeHealth(input) {
        const mode = input?.mode ?? 'hybrid'
        const usedTokens = input?.usedTokens
        const windowTokens = input?.windowTokens
        const factor = Number.isFinite(input?.replaceSafetyFactor) ? input.replaceSafetyFactor : 0.98
        // ⚠️ 兜底比例**只此一份**（P2-3）：默认值直接读 `HANDOFF_DEFAULTS.nativeCompactionRatio`
        //    （handoff-config.mjs 的单一来源），与 `handoff-policy.resolveNativeThresholdTokens`
        //    走的是同一个常量——以前这里把比例硬编码成窗口的 8 折（字面量），改了配置两边就漂移。
        //    调用方（host DTO）也可以显式传入已解析的配置值。
        const nativeCompactionRatio = Number.isFinite(input?.nativeCompactionRatio)
          ? input.nativeCompactionRatio
          : HANDOFF_DEFAULTS.nativeCompactionRatio

        const nativeThresholdTokens = Number.isFinite(input?.nativeThresholdTokens) && input.nativeThresholdTokens > 0
          ? Math.floor(input.nativeThresholdTokens)
          : (Number.isFinite(windowTokens) && windowTokens > 0 ? Math.floor(windowTokens * nativeCompactionRatio) : undefined)

        // 上下文阈值：替代模式 = 原生 × 0.98；原生/混合模式 = 原生阈值本身（刻度线用）。
        const contextLimitTokens = nativeThresholdTokens === undefined
          ? undefined
          : (mode === 'replace' ? Math.floor(nativeThresholdTokens * factor) : nativeThresholdTokens)

        const context = {
          usedTokens: Number.isFinite(usedTokens) ? usedTokens : undefined,
          windowTokens: Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : undefined,
          limitTokens: contextLimitTokens,
          ratio: Number.isFinite(usedTokens) && Number.isFinite(windowTokens) && windowTokens > 0 ? usedTokens / windowTokens : undefined,
          limitRatio: contextLimitTokens === undefined || !Number.isFinite(windowTokens) || windowTokens <= 0
            ? undefined
            : contextLimitTokens / windowTokens,
          // 设计文档：只有替代模式画「阈值刻度竖线」；混合模式不画（上下文交给原生压缩）。
          showMarker: mode === 'replace' && contextLimitTokens !== undefined,
        }

        const sessionBytes = Number.isFinite(input?.sessionBytes) ? input.sessionBytes : undefined
        const volumeLimitBytes = Number.isFinite(input?.sessionVolumeLimitBytes) && input.sessionVolumeLimitBytes > 0
          ? input.sessionVolumeLimitBytes
          : undefined
        const volume = {
          bytes: sessionBytes,
          limitBytes: volumeLimitBytes,
          ratio: sessionBytes === undefined || volumeLimitBytes === undefined ? undefined : sessionBytes / volumeLimitBytes,
          showMarker: volumeLimitBytes !== undefined,
        }

        // 上下文是否参与"最差颜色"判定：替代模式参与；混合/原生模式不参与（规格 §一 S2）。
        const contextLevel = mode === 'replace' && context.showMarker
          ? levelFor({ value: context.usedTokens, limit: context.limitTokens })
          : undefined
        const volumeLevel = levelFor({ value: volume.bytes, limit: volume.limitBytes })

        // 「量到了吗」= 这两个指标里**至少有一个真的读到了当前值**（P1-6 修复）：
        //   - 上下文可用：token 计量给了 usedTokens，且窗口/原生阈值能推出生效阈值（否则算不出来）；
        //   - 体积可用：台账给了 sessionBytes，且配了正的体积阈值。
        // 两个都不可用 → measured=false → 结论保守取 warning（既不说健康、也不说危险），
        // 并把 measured 显式带出去，让调用方/文案知道这是"读不到"而不是"健康"。
        const contextUsable = context.usedTokens !== undefined && context.limitTokens !== undefined
        const volumeUsable = volume.bytes !== undefined && volume.limitBytes !== undefined
        const measured = contextUsable || volumeUsable

        // 参与判定的指标全不可用（如混合模式下只有上下文可读、体积读不到）时，
        // worstLevel 给 undefined；此时按"不参与判定 = 不染色"取 green（量到了即非未知）。
        const worst = worstLevel(contextLevel, volumeLevel)
        const level = measured ? (worst ?? 'green') : 'warning'

        return { mode, level, measured, context, volume, contextCounts: mode === 'replace' }
      }

      /**
       * 计算"还能撑约 N 轮"。
       *
       * 涨速口径（设计文档 §一 S2：「N 由涨速外推；拿不到涨速就退化为显示当前值与距阈值距离」）：
       * ```
       * 每轮增量 = Δ(主导指标) / Δ(turnIndex + 1)
       * N = floor((阈值 − 当前) / 每轮增量)
       * ```
       * 主导指标 = 离自己的阈值更近的那个（体积优先，与判定链一致）。
       * 增速 ≤ 0 → N = 0 且 `reason: 'flat'`（不涨就永远撑得住），never 给负数。
       *
       * @param {object} input - 输入。
       * @param {object} input.health - `computeHealth` 的结果。
       * @param {number} [input.perTurnTokens] - 每轮上下文增量（token）。
       * @param {number} [input.perTurnBytes] - 每轮会话体积增量（字节）。
       * @param {number} [input.perTurnHours] - 每轮耗时（小时）；无轮次增量时的降级口径。
       * @returns {{n?: number, metric: 'context'|'volume'|null, remainingTokens?: number, remainingBytes?: number, reason: string}} 外推结果。
       */
      exports.estimateTurnsLeft = estimateTurnsLeft;
      function estimateTurnsLeft({ health, perTurnTokens, perTurnBytes, perTurnHours }) {
        if (health === undefined) return { metric: null, reason: 'no-health' }

        const contextGap = health.context.limitTokens === undefined || health.context.usedTokens === undefined
          ? undefined
          : health.context.limitTokens - health.context.usedTokens
        const volumeGap = health.volume.limitBytes === undefined || health.volume.bytes === undefined
          ? undefined
          : health.volume.limitBytes - health.volume.bytes

        // 主导指标：谁离阈值更近（比例更小）；不可比时用可用的那个。
        let metric = null
        if (health.contextCounts && contextGap !== undefined && volumeGap !== undefined) {
          const contextLeft = health.context.limitTokens === 0 ? 0 : health.context.usedTokens / health.context.limitTokens
          const volumeLeft = health.volume.limitBytes === 0 ? 0 : health.volume.bytes / health.volume.limitBytes
          metric = volumeLeft <= contextLeft ? 'volume' : 'context'
        } else if (health.contextCounts && contextGap !== undefined) {
          metric = 'context'
        } else if (volumeGap !== undefined) {
          metric = 'volume'
        }

        if (metric === null) return { metric: null, reason: 'no-metric' }

        const gap = metric === 'context' ? contextGap : volumeGap
        const remainingTokens = contextGap
        const remainingBytes = volumeGap
        if (gap === undefined) return { metric, reason: 'no-metric', remainingTokens, remainingBytes }
        if (gap <= 0) return { n: 0, metric, reason: 'reached', remainingTokens, remainingBytes }

        // 每轮增量：host 与 client 用同一份口径（`computeRates` 的产物）。
        const perTurn = metric === 'context' ? perTurnTokens : perTurnBytes
        if (!Number.isFinite(perTurn) || perTurn <= 0) {
          // 设计文档的退化路径：拿不到涨速 → 只报"当前值 + 距阈值距离"，不编 N。
          return { metric, reason: 'no-rate', remainingTokens, remainingBytes, hoursPerTurn: perTurnHours }
        }

        const n = Math.max(0, Math.floor(gap / perTurn))
        return { n, metric, reason: 'extrapolated', perTurn, remainingTokens, remainingBytes, hoursPerTurn: perTurnHours }
      }

      /**
       * 涨速台账：按会话记录 (时间, 轮次序号, 用量) 采样，算出"每轮增量"。
       *
       * 轮次序号来自 `turn/start` 事件计数（`lib/handoff-metrics.mjs` 的 `turnIndexOf`）。
       * 设计文档要求"必须带涨速"，但**没有**要求把涨速当成开关；样本不足时上层退化为
       * 显示"当前值 + 距阈值距离"。
       *
       * @param {{now?: () => number, windowMs?: number, maxSamples?: number}} [options] - 可注入时间源与窗口。
       * @returns {object} 台账 API。
       */
      exports.createRateTracker = createRateTracker;
      function createRateTracker({ now = () => Date.now(), windowMs = HISTORY_WINDOW_MS, maxSamples = HISTORY_MAX_SAMPLES } = {}) {
        /** @type {Map<string, Array<{at: number, turnIndex: number, usedTokens?: number, sessionBytes?: number}>>} */
        const samples = new Map()

        function prune(list) {
          const cutoff = now() - windowMs
          while (list.length > 0 && list[0].at < cutoff) list.shift()
          while (list.length > maxSamples) list.shift()
          return list
        }

        return {
          /**
           * 记一条样本。
           * @param {string} sessionId - 会话 id。
           * @param {{turnIndex?: number, usedTokens?: number, sessionBytes?: number}} sample - 样本。
           * @returns {void}
           */
          observe(sessionId, sample) {
            if (typeof sessionId !== 'string' || sessionId.length === 0) return
            const list = prune(samples.get(sessionId) ?? [])
            list.push({
              at: now(),
              turnIndex: Number.isFinite(sample?.turnIndex) ? sample.turnIndex : 0,
              usedTokens: Number.isFinite(sample?.usedTokens) ? sample.usedTokens : undefined,
              sessionBytes: Number.isFinite(sample?.sessionBytes) ? sample.sessionBytes : undefined,
            })
            samples.set(sessionId, list)
          },
          /**
           * 取窗口内最早的一条样本（作为差分基线）。
           * @param {string} sessionId - 会话 id。
           * @returns {object|undefined} 基线样本。
           */
          baseline(sessionId) {
            const list = prune(samples.get(sessionId) ?? [])
            return list[0]
          },
          /**
           * 取窗口内最新的一条样本。
           * @param {string} sessionId - 会话 id。
           * @returns {object|undefined} 最新样本。
           */
          latest(sessionId) {
            const list = prune(samples.get(sessionId) ?? [])
            return list[list.length - 1]
          },
          /** 丢弃某会话的样本（`session/disposed` 时调）。 */
          forget(sessionId) {
            samples.delete(sessionId)
          },
          /** 已采样会话数（排障用）。 */
          get size() {
            return samples.size
          },
        }
      }

      /**
       * 由台账算出"每轮增量"（token / 字节）。
       * 轮次分母 = Δ(turnIndex) + 1——因为**当前这一步所在轮的增量还没结算**，
       * 用 +1 才能把"本轮已经开始涨的那部分"摊进平均值（否则会长期低估涨速、N 偏大）。
       *
       * @param {object} input - 输入。
       * @param {object} [input.tracker] - `createRateTracker` 的产物。
       * @param {string} input.sessionId - 会话 id。
       * @param {number} [input.turnIndex] - 当前轮次序号。
       * @param {number} [input.usedTokens] - 当前上下文 token。
       * @param {number} [input.sessionBytes] - 当前会话体积字节。
       * @returns {{perTurnTokens?: number, perTurnBytes?: number, hoursPerTurn?: number, turns: number, reason: string}} 涨速。
       */
      exports.computeRates = computeRates;
      function computeRates({ tracker, sessionId, turnIndex, usedTokens, sessionBytes }) {
        if (tracker === undefined) return { turns: 0, reason: 'no-tracker' }
        const base = tracker.baseline(sessionId)
        const last = tracker.latest(sessionId)
        if (base === undefined || last === undefined || base === last) return { turns: 0, reason: 'insufficient-samples' }
        const currentTurn = Number.isFinite(turnIndex) ? turnIndex : last.turnIndex
        const deltaTurns = Math.max(1, (currentTurn - base.turnIndex) + 1)
        const result = {
          turns: deltaTurns,
          elapsedMs: Math.max(0, last.at - base.at),
          reason: 'ok',
        }
        const baseTokens = base.usedTokens
        const lastTokens = Number.isFinite(usedTokens) ? usedTokens : last.usedTokens
        if (Number.isFinite(baseTokens) && Number.isFinite(lastTokens) && lastTokens >= baseTokens) {
          result.perTurnTokens = (lastTokens - baseTokens) / deltaTurns
        }
        const baseBytes = base.sessionBytes
        const lastBytes = Number.isFinite(sessionBytes) ? sessionBytes : last.sessionBytes
        if (Number.isFinite(baseBytes) && Number.isFinite(lastBytes) && lastBytes >= baseBytes) {
          result.perTurnBytes = (lastBytes - baseBytes) / deltaTurns
        }
        if (Number.isFinite(result.elapsedMs) && result.elapsedMs > 0) {
          result.hoursPerTurn = (result.elapsedMs / 3_600_000) / deltaTurns
        }
        return result
      }

      /**
       * 涨速的定性词（用于"· 涨得偏快"这类追加语）。
       * @param {number|undefined} perTurn - 每轮增量。
       * @param {number|undefined} gap - 距阈值的剩余量。
       * @param {number|undefined} n - 外推出的可撑轮数。
       * @returns {'unknown'|'flat'|'calm'|'normal'|'fast'} 定性。
       */
      exports.paceOf = paceOf;
      function paceOf({ perTurn, gap, n }) {
        if (Number.isFinite(n) && n <= 0) return 'flat'
        if (!Number.isFinite(perTurn) || perTurn <= 0) return Number.isFinite(gap) ? 'flat' : 'unknown'
        if (!Number.isFinite(gap)) return 'unknown'
        if (n === undefined || !Number.isFinite(n) || perTurn <= 0) return 'normal'
        if (n <= 3) return 'fast'
        if (n <= 10) return 'normal'
        return 'calm'
      }

      /**
       * 结论句（右侧那一段）。**这是本模块唯一的文案出口**，host 与 client 共用同一份。
       *
       * 设计文档三色文案：
       * ```
       * 🟢 健康（< 阈值×0.85）
       * 🟠 还能撑约 N 轮（≥ 阈值×0.85 且 < 阈值）
       * 🔴 建议现在就换（≥ 阈值）
       * ```
       * 外加"必须带涨速"：涨得快时追加「· 涨得偏快」。
       *
       * @param {object} input - 输入。
       * @param {object} input.health - `computeHealth` 结果。
       * @param {object} [input.turnsLeft] - `estimateTurnsLeft` 结果。
       * @returns {{icon: string, text: string, level: string, pace: string}} 结论。
       */
      exports.conclusionOf = conclusionOf;
      function conclusionOf({ health, turnsLeft }) {
        const level = health?.level ?? 'green'
        const pace = paceOf({
          perTurn: turnsLeft?.perTurn,
          gap: turnsLeft?.metric === 'context' ? turnsLeft?.remainingTokens : turnsLeft?.remainingBytes,
          n: turnsLeft?.n,
        })
        const icon = level === 'danger' ? '🔴' : level === 'warning' ? '🟠' : '🟢'
        const fastSuffix = pace === 'fast' ? ' · 涨得偏快' : ''

        // 「读不到」不是「健康」（P1-6）：两个指标一个都没量到时，绝不能给 🟢 健康这种
        // 会让人误以为"一切正常"的结论，而要在文案里说清是计量失败。
        if (health?.measured === false) {
          return { icon, level, pace, text: `${icon} 读不到用量（token 计量或上下文窗口投影不可用）` }
        }

        if (level === 'danger') {
          return { icon, level, pace, text: `${icon} 建议现在就换${fastSuffix}` }
        }
        if (level === 'warning') {
          if (Number.isFinite(turnsLeft?.n) && turnsLeft.n > 0) {
            return { icon, level, pace, text: `${icon} 还能撑约 ${turnsLeft.n} 轮${fastSuffix}` }
          }
          if (Number.isFinite(turnsLeft?.remainingTokens) || Number.isFinite(turnsLeft?.remainingBytes)) {
            const gapText = turnsLeft.metric === 'volume'
              ? `还差 ${formatBytes(turnsLeft.remainingBytes)}`
              : `还差 ${formatPercent((turnsLeft.remainingTokens ?? 0) / Math.max(1, health.context.windowTokens ?? 1))}`
            return { icon, level, pace, text: `${icon} 快到线了（${gapText}）${fastSuffix}` }
          }
          return { icon, level, pace, text: `${icon} 快到线了${fastSuffix}` }
        }
        return { icon, level, pace, text: `${icon} 健康` }
      }

      /**
       * 百分比格式化（0.68 → "68%"）。无效输入给「—」。
       * @param {number|undefined} ratio - 比例。
       * @param {number} [digits] - 小数位（默认 0）。
       * @returns {string} 文案。
       */
      exports.formatPercent = formatPercent;
      function formatPercent(ratio, digits = 0) {
        if (!Number.isFinite(ratio)) return '—'
        const value = ratio * 100
        return `${value.toFixed(digits)}%`
      }

      /**
       * 字节格式化（12.3 MB / 812 KB / 900 B）。**图片与附件已并入此数，不单独出现。**
       * @param {number|undefined} bytes - 字节数。
       * @returns {string} 文案。
       */
      exports.formatBytes = formatBytes;
      function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return '—'
        const abs = Math.abs(bytes)
        if (abs < 1024) return `${Math.round(bytes)} B`
        if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(abs < 10 * 1024 ? 1 : 0)} KB`
        // MB 固定 1 位小数（设计文档示例写的是「会话 12 MB」，1 位不会更啰嗦；≥100MB 才收成整数）。
        if (abs < 1024 * 1024 * 1024) {
          const mb = bytes / (1024 * 1024)
          return `${mb.toFixed(abs < 100 * 1024 * 1024 ? 1 : 0)} MB`
        }
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
      }

      /** 千分位整数。 */
      exports.formatCount = formatCount;
      function formatCount(value) {
        if (!Number.isFinite(value)) return '—'
        return Math.round(value).toLocaleString('en-US')
      }

      /**
       * S2-明细表：**只给「当前 / 阈值 / 距离」**，不做占用构成分解。
       *
       * | 指标 | 当前 | 阈值 | 距离 |
       * | 上下文 | 68% | 80% | 还差 12% |
       * | 会话体积 | 12 MB | 20 MB | 还差 8 MB |
       * | 已压缩次数 | 1 次 | 修正线 2 次 | —— |
       * | 消息 / 事件条数 | 1,240 / 3,400 | —— | 仅供参考，不参与判定 |
       *
       * @param {object} input - 输入。
       * @param {object} input.health - `computeHealth` 结果。
       * @param {number} [input.compactionsSinceHandoff] - 自上次换会话以来的压缩次数。
       * @param {number|null} [input.compactionCountTrigger] - 压缩次数修正线（留空 = 不启用）。
       * @param {number} [input.messageCount] - 用户+助手消息条数。
       * @param {number} [input.eventCount] - 事件条数。
       * @returns {{rows: Array<{label: string, current: string, limit: string, distance: string}>}} 明细。
       */
      exports.detailRows = detailRows;
      function detailRows({ health, compactionsSinceHandoff, compactionCountTrigger, messageCount, eventCount }) {
        const context = health?.context ?? {}
        const volume = health?.volume ?? {}
        const rows = []

        rows.push({
          label: '上下文',
          current: context.windowTokens === undefined
            ? (Number.isFinite(context.usedTokens) ? `${formatCount(context.usedTokens)} token` : '—')
            : `${formatPercent(context.ratio)}（${formatCount(context.usedTokens)} / ${formatCount(context.windowTokens)}）`,
          limit: context.limitTokens === undefined
            ? '跟随原生压缩'
            : `${formatPercent(context.limitRatio)}（${formatCount(context.limitTokens)}）`,
          distance: context.limitTokens === undefined || context.usedTokens === undefined
            ? '—'
            : (context.limitTokens <= context.usedTokens
              ? '已到线'
              : `还差 ${formatCount(context.limitTokens - context.usedTokens)} token`),
        })

        rows.push({
          label: '会话体积',
          current: formatBytes(volume.bytes),
          limit: formatBytes(volume.limitBytes),
          distance: volume.bytes === undefined || volume.limitBytes === undefined
            ? '—'
            : (volume.limitBytes <= volume.bytes ? '已到线' : `还差 ${formatBytes(volume.limitBytes - volume.bytes)}`),
        })

        rows.push({
          label: '已压缩次数',
          current: Number.isFinite(compactionsSinceHandoff) ? `${compactionsSinceHandoff} 次` : '—',
          limit: compactionCountTrigger === null || compactionCountTrigger === undefined
            ? '未启用'
            : `修正线 ${compactionCountTrigger} 次`,
          distance: '——',
        })

        rows.push({
          label: '消息 / 事件条数',
          current: `${formatCount(messageCount)} / ${formatCount(eventCount)}`,
          limit: '——',
          distance: '仅供参考，不参与判定',
        })

        return { rows }
      }

      /** 取值为 null 或数字的阈值（wire 上 nullable 数字必须走这个，避免 undefined 键）。 */
      exports.normalizeTrigger = normalizeTrigger;
      function normalizeTrigger(value) {
        if (value === null || value === undefined || value === '') return null
        if (!Number.isFinite(value)) return null
        if (value <= 0) return null
        return Math.floor(value)
      }

      // ─────────────────────────── 换会话确认卡片（S3）状态机 ───────────────────────────

      /** 卡片选项标签（**必须与宿主选项一一对应**；「（推荐）」后缀会被宿主渲染成推荐徽章）。 */
      const CARD_LABELS = Object.freeze({
        handoff: '换会话（推荐）',
        always: '以后都自动换会话',
        later: '先不换',
      })

      /** 选项的 id 前缀（宿主按选项 label 回传，我们只用 label 比对）。 */
      const CARD_QUESTION_ID = 'session-handoff-confirm'

      /**
       * 把用户的回答（或取消/超时）折成一个动作。
       *
       * 设计文档 §二 交互流程：
       * ```
       * 选「接力」/「以后都自动接力」 → 执行换会话（后者同时把自动程度调成"全自动"）
       * 选「先不接力」/ 关掉 / 超时   → 等同取消
       * ```
       *
       * @param {object} input - 输入。
       * @param {'handoff'|'always'|'later'|'cancelled'|'timeout'|'error'} input.kind - 事件类型。
       * @param {string} [input.label] - 用户选中的标签。
       * @param {string} [input.custom] - 用户自由输入的内容。
       * @param {string} [input.error] - 错误文本（kind='error' 时）。
       * @returns {{action: 'handoff'|'always-auto'|'cancel', reason: string}} 归一化动作。
       */
      exports.reduceCardAnswer = reduceCardAnswer;
      function reduceCardAnswer({ kind, label, custom, error }) {
        if (kind === 'cancelled' || kind === 'timeout') return { action: 'cancel', reason: kind }
        if (kind === 'error') return { action: 'cancel', reason: error ?? 'error' }
        if (kind === 'later') return { action: 'cancel', reason: 'later' }
        if (kind === 'always') return { action: 'always-auto', reason: 'always' }
        if (kind === 'handoff') return { action: 'handoff', reason: 'approved' }
        // 自由输入兜底：认"换/接力/yes"这类肯定词，其余按不换处理（容错，不误切）。
        const text = typeof custom === 'string' ? custom.trim() : ''
        if (text.length > 0) {
          // ⚠️ 不用 `\b` 收尾：中文字符在 JS 正则里属于非词字符，"换吧\b" 永远匹配不上。
          if (/^(换|接力|好|是|行|可以|yes|ok|y\b)/i.test(text)) return { action: 'handoff', reason: 'custom-approved' }
          return { action: 'cancel', reason: 'custom-declined' }
        }
        if (typeof label === 'string' && label.length > 0) {
          if (label === CARD_LABELS.handoff) return { action: 'handoff', reason: 'approved' }
          if (label === CARD_LABELS.always) return { action: 'always-auto', reason: 'always' }
          return { action: 'cancel', reason: 'later' }
        }
        return { action: 'cancel', reason: 'unanswered' }
      }

      /**
       * 组装宿主 `ctx.userQuestions.ask()` 的请求体（**照抄 plan-mode 的形状**）。
       *
       * ⚠️ 两个硬约束（照 `dsh-user-questions/lib/index.js:52-80`）：
       * 1. `questions` 不能为空；
       * 2. 带 `intent` 时 `approve` 标签必须真的出现在 options 里，且必须给 `detail`。
       *    （本插件**不传 intent**：「换会话」不是审批语义，传了反而要被审批弹窗的轮次约束咬住。）
       *
       * @param {object} input - 输入。
       * @param {string} input.reason - 触发原因（人话）。
       * @param {string} input.facts - 事实行（用量 / 档位 / 本链第几棒）。
       * @param {string} [input.detail] - 交接文档预览（可展开区块）。
       * @returns {{id: string, header: string, question: string, detail: string, options: Array<object>}} 问题对象。
       */
      exports.buildConfirmQuestion = buildConfirmQuestion;
      function buildConfirmQuestion({ reason, facts, detail }) {
        return {
          id: CARD_QUESTION_ID,
          header: '会话接力',
          question: `要接力到新会话吗？（${reason}）`,
          detail: [facts, typeof detail === 'string' && detail.trim().length > 0 ? detail : undefined]
            .filter((part) => typeof part === 'string' && part.length > 0)
            .join('\n\n'),
          options: [
            { label: CARD_LABELS.handoff, description: '现在把任务交给新会话继续。', recommended: true },
            { label: CARD_LABELS.always, description: '这次接力，并且以后到点不再问我。' },
            { label: CARD_LABELS.later, description: '继续在这个会话里干，下次跨过阈值再问。' },
          ],
        }
      }

      /** 事实行（S3 卡片头下方那一行）。 */
      exports.formatFacts = formatFacts;
      function formatFacts({ health, chainIndex, thresholdLabel }) {
        const parts = []
        const context = health?.context ?? {}
        const volume = health?.volume ?? {}
        if (Number.isFinite(context.ratio)) {
          parts.push(`当前用量 ${formatPercent(context.ratio)}（${formatCount(context.usedTokens)} / ${formatCount(context.windowTokens)}）`)
        }
        if (Number.isFinite(volume.bytes)) parts.push(`会话体积 ${formatBytes(volume.bytes)}`)
        if (Number.isFinite(chainIndex)) parts.push(`本链第 ${chainIndex} 棒`)
        if (typeof thresholdLabel === 'string' && thresholdLabel.length > 0) parts.push(`触发原因：${thresholdLabel}`)
        return parts.join(' · ')
      }

      // ─────────────────────────── 决策日志（S7）状态机 ───────────────────────────

      /** 决策动作的书面名（S7 徽章文案）。 */
      const DECISION_ACTIONS = Object.freeze({
        handoff: '硬切接力',
        'handoff-manual': '手工换会话',
        cancel: '取消（用户没换）',
        defer: '挂起（等安全点）',
        none: '不干预',
      })

      /**
       * 把一次判定折成一条决策日志记录（时间 / 动作 / 一句话理由）。
       *
       * @param {object} input - 输入。
       * @param {number} input.at - 时间戳（毫秒）。
       * @param {string} input.action - 动作键（见 `DECISION_ACTIONS`）。
       * @param {string} [input.reason] - 判定理由键（如 `session-volume`）。
       * @param {object} [input.health] - 当时的健康度。
       * @param {number} [input.chainIndex] - 本链第几棒。
       * @param {object} [input.detail] - 判定明细（判定链的原始数字）。
       * @returns {{at: number, time: string, action: string, label: string, reason: string, human: string, contextPercent: string, volume: string, chainIndex: number, detail: object}} 记录。
       */
      exports.reduceDecision = reduceDecision;
      function reduceDecision({ at, action, reason, health, chainIndex, detail }) {
        const label = DECISION_ACTIONS[action] ?? action ?? '不干预'
        const human = humanReason({ action, reason, detail })
        return {
          at,
          time: formatClock(at),
          action: action ?? 'none',
          label,
          reason: reason ?? 'unknown',
          human,
          contextPercent: Number.isFinite(health?.context?.ratio) ? formatPercent(health.context.ratio) : '—',
          volume: formatBytes(health?.volume?.bytes),
          chainIndex: Number.isFinite(chainIndex) ? chainIndex : 1,
          detail: detail ?? {},
        }
      }

      /**
       * 判定理由的大白话（S7「判定理由」那一列）。
       * @param {{action?: string, reason?: string, detail?: object}} input - 输入。
       * @returns {string} 一句话。
       */
      exports.humanReason = humanReason;
      function humanReason({ action, reason, detail }) {
        const sizeMB = Number.isFinite(detail?.sessionBytes) ? formatBytes(detail.sessionBytes) : undefined
        switch (reason) {
          case 'session-volume':
            return `会话体积到线了（${sizeMB ?? '—'}）→ 换会话`
          case 'compaction-count':
            return `已经压缩了 ${detail?.compactionsSinceHandoff ?? '?'} 次（修正线 ${detail?.compactionCountTrigger ?? '?'} 次）→ 换会话`
          case 'replace-threshold':
            return '上下文到了原生压缩生效线的 98% → 抢在它前面换会话'
          case 'manual':
            return '你点了「换会话」→ 优先级最高，直接换'
          case 'none':
          case 'below-load-thresholds':
            return '两个指标都没到线 → 不干预'
          case 'below-replace-threshold':
            return '还没到原生压缩生效线的 98% → 不干预'
          case 'native-mode':
            return '当前是原生模式 → 插件不自动换会话'
          case 'metric-unavailable':
            return '暂时量不到上下文用量 → 这一步不判定'
          case 'unsafe-point':
            return '现在有工具在跑（不是安全点）→ 挂起，等这一步结束再换'
          default:
            return action === 'handoff' ? '到线了 → 换会话' : '没有满足换会话的条件 → 不干预'
        }
      }

      /**
       * 时钟格式化（HH:MM:SS，本地时区）。
       * @param {number} at - 毫秒时间戳。
       * @returns {string} 文案。
       */
      exports.formatClock = formatClock;
      function formatClock(at) {
        if (!Number.isFinite(at)) return '—'
        const date = new Date(at)
        const pad = (value) => String(value).padStart(2, '0')
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      }

      /** 决策日志动作筛选（S7 顶部一行筛选）。 */
      const DECISION_FILTERS = Object.freeze([
        { id: 'all', label: '全部' },
        { id: 'handoff', label: '只看换过会话的' },
        { id: 'none', label: '只看没换的' },
      ])

      /**
       * 按筛选条件过滤决策日志。
       * @param {Array<object>} records - 记录。
       * @param {string} filter - 筛选 id。
       * @returns {Array<object>} 过滤后的记录。
       */
      exports.filterDecisions = filterDecisions;
      function filterDecisions(records, filter) {
        const list = Array.isArray(records) ? records : []
        if (filter === 'handoff') return list.filter((row) => row.action === 'handoff' || row.action === 'handoff-manual')
        if (filter === 'none') return list.filter((row) => row.action !== 'handoff' && row.action !== 'handoff-manual')
        return list
      }

      ;exports.HEALTH_LEVELS = HEALTH_LEVELS;exports.WARN_FACTOR = WARN_FACTOR;exports.HISTORY_WINDOW_MS = HISTORY_WINDOW_MS;exports.HISTORY_MAX_SAMPLES = HISTORY_MAX_SAMPLES;exports.STEP_MS_FALLBACK = STEP_MS_FALLBACK;exports.STEPS_PER_TURN_FALLBACK = STEPS_PER_TURN_FALLBACK;exports.PACE_WORDS = PACE_WORDS;exports.CARD_LABELS = CARD_LABELS;exports.CARD_QUESTION_ID = CARD_QUESTION_ID;exports.DECISION_ACTIONS = DECISION_ACTIONS;exports.DECISION_FILTERS = DECISION_FILTERS
    },
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
		var __entry = __req("./src/client/index.ts");
		var __public = __entry.apply === undefined ? {} : { name: __entry.name, inject: __entry.inject, apply: __entry.apply };
		Object.assign(exports, __public);
		return exports;
	}
});
