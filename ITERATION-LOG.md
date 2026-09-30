# 迭代日志 · video-study-copilot

> 记录格式：日期 | 类型 | 内容 | 结果。append-only，不删改历史。
> 类型：立项 / 决策 / 调研 / 施工 / 验收 / 变更 / 打回 / 回滚

---

## 2026-09-29

| 日期 | 类型 | 内容 | 结果 |
|---|---|---|---|
| 09-29 | 立项 | 需求澄清完成：B站/抖音/本地视频，Obsidian 知识库，v0.1 无后端纯插件，DeepSeek 档模型，MVP=核心+导图 | ✅ 四项关键决策确认 |
| 09-29 | 决策 | 预读采用确定性 map-reduce pipeline，术语解释/区间问答才引入 agentic；时间戳强制吸附 Cue 边界 | ✅ 写入 TECH-DESIGN §3.1/§5.1 |
| 09-29 | 调研 | Agent Harness 主流架构（微内核/控制平面型）、SKILL.md 开放标准、Chrome 内置 AI、竞品格局 | ✅ 调研结论归档 |
| 09-29 | 决策 | 部署形态定稿：v0.1 无后端（MV3 host_permissions 免 CORS），无字幕视频降级手动粘贴 | ✅ 用户确认 |
| 09-29 | 施工 | TECH-DESIGN.md v0.1 完成（12 章：架构/数据模型/pipeline/prompt 契约/接口契约/成本/工程结构/里程碑/风险） | ✅ 已交付 |
| 09-29 | 调研 | ai-knowlage 代码调研（/Users/wangxiaoheng/CodeBuddy/ai-knowlage）：四级降级采集链路、cookie 状态机、rolling caption 去重、whisper segments 验证 | ✅ 采纳进 §7.1/§13 |
| 09-29 | 决策 | 字幕采集从"平铺适配器"改为"有序瀑布+统一状态透传"；ai-knowlage 登记为 v0.2 复用资产 | ✅ TECH-DESIGN 第 2 轮修订 |
| 09-29 | 施工 | 施工治理体系建立：CONSTITUTION.md（宪法）+ 6 个 spec + 本迭代日志 | ✅ spec 全部三要素齐备，状态"待开工" |

---

## 2026-09-30

| 日期 | 类型 | 内容 | 结果 |
|---|---|---|---|
| 09-30 | 决策 | 用户拍板三个开放问题：YouTube 不进 v0.1；术语卡目录从简（功能保留、扁平存放）；学习进度 deferred。v0.1 定位为 MVP 模式验证 | ✅ 全部落入 EVOLUTION-ROADMAP.md |
| 09-30 | 施工 | 建立 EVOLUTION-ROADMAP.md 进化罗盘：deferred 项 / 近期(v0.1.x) / 中期(v0.2) / 远期方向 / 反方向清单，防止进化方向失忆 | ✅ 已交付 |
| 09-30 | 变更 | 开工前审视发现 6 个工程漏洞，2 个修入 spec：**H1 多 P 课程**（videoId 必须为 bvid_p{n}，教程主流形态，修入 SPEC-02 A3b）；**H2 SW 生命周期**（30s 空闲被杀 → 保活+断点续跑，修入 SPEC-03 A4b）；H3 幻觉时间戳阈值（修入 SPEC-03 A2）；H4 固定回归测试集 fixtures（修入 SPEC-02 §4b）；H5 成本熔断（修入 SPEC-03 A4c）；H6 字幕覆盖率预检 <60% 触发云 ASR 提前决策（修入 SPEC-02 A3c） | ✅ 两个 spec 已修订 |
| 09-30 | 决策 | 产品 idea 评审：新增高优进化项——薄弱章节自动标记（qaHistory 数据已有）、信息密度预警（直击原始痛点）；中优——进度续看、双语翻译、导图导出；远期——Anki 化、课程编排、预习模式。评论区精华/画面理解进 v0.2 候选 | ✅ 全部落入 EVOLUTION-ROADMAP.md |
| 09-30 | 决策 | 两个高优 idea 的 v0.1 取舍拍板：**信息密度预警轻量版进 v0.1**（Section.density 字段 + 大纲章节标记，SPEC-03 新增子任务 3.5 与验收 A5b，工期 +0.5d；主动提示交互留 v0.1.x）；**薄弱章节标记放 v0.1.x**（依赖真实问答数据积累），但 SPEC-05 新增 A7b 锁死 qaHistory 可聚合数据结构（videoId/timestampMs/章节 id/交互类型），将来零迁移追加 | ✅ SPEC-03/05 与罗盘已同步 |
| 09-30 | 审计 | 开工前全量审计（逐份重读 + 核实文件系统事实），报告 `reviews/AUDIT-2026-09-30.md`：P0 6 项（无 git 仓库致 G3/回滚落空；父 agent 无法执行联调类验收；Side Panel 不能自动打开；Panel 缺字幕视图致划词落空；pipeline 宿主应从 SW 改为 panel + API key 禁入 content script；文档间 9 处漂移）、P1 7 项（缺 MVP 验证判定标准；大纲质量无验收；双维护 diff 不可执行；红线无检查脚本；缺离线回放测试；并行共享文件冲突；缺子 agent 派发模板）、P2 6 项 | ✅ 用户确认全部采纳（见下一条） |
| 09-30 | 施工 | 关联代码仓库 `git@github.com:phpvincent/ai-video-driver.git`：`git init -b main`，远程原为空仓库；HTTPS 无凭据，改用本机 SSH key（身份 phpvincent）推送；新增 `.gitignore`（含 `tests/fixtures/raw/`）；基线提交 850a1d9 已推送 | ✅ main 跟踪 origin/main |
| 09-30 | 调研 | 测试课程登记：BV1YG7G6eEPR（59 个分 P，全集约 17 小时），用户指定 01~10 集 = P2~P11（P1 为 63 秒导读），合计约 5 小时；匿名 wbi 探测 P1~P11 均返回空字幕列表且 `need_login_subtitle: true`；本机代理隧道连 B 站超时，脚本需 `--noproxy` | ✅ `tests/fixtures/bv-cases.md`；登录态覆盖率待 SPEC-02 A6 |
| 09-30 | 变更 | 按审计全部采纳修订：CONSTITUTION v1.1（用户为最终验收人、验收三级标注、§5 版本控制、共享契约仅父 agent 可改、红线 6/7 改写、新增红线 10 与检查方式列、决策扇出检查）；TECH-DESIGN r3（字幕 Tab、videoId=bvid_p{n}、运行上下文职责、prompt 单一事实源、Section.terms/density 算法、QaRecord、两层缓存、trace、错误分类表含 need_login 优先、跳播链接格式、manifest 去 YouTube、§10 质量保障、§12 M7）；SPEC-01~06 按模板重写；新增 SPEC-07 MVP 验证期、`_SPEC_TEMPLATE.md`、`_DISPATCH_TEMPLATE.md` | ✅ 受影响文档：CONSTITUTION / TECH-DESIGN / SPEC-01~07 / 两份模板 / EVOLUTION-ROADMAP（章节引用与 SPEC 编号同步）/ AUDIT 报告（追加处置结果）/ bv-cases.md，逐个已确认 |
| 09-30 | 决策 | 字幕术语澄清：一级通道抓取的是播放器字幕轨列表（UP 主上传字幕 + 平台 AI 字幕同在 player wbi/v2 的 subtitles 数组，UP 主优先、AI 次之），"博主自己配的字幕"本就是主要抓取对象；AI 字幕无标点/同音字问题 → "顺句"列为条件触发进化项 | ✅ 受影响文档：TECH-DESIGN §1.3/§7.1、EVOLUTION-ROADMAP §2、MEMORY，逐个已改 |
| 09-30 | 施工 | **SPEC-01 开工**：父 agent 完成子任务 1.2 共享契约（types/messages/config，commit 5ecc048）；派发子任务 1.1 工程脚手架，子 agent 交付（commit 904a548），父 agent 复跑 G1（build/test/check 全绿）与 G3（content 占位零 import、config 外无敏感串）验收通过 | ✅ 已推送；剩余 1.3/1.4/1.5 待派发 |
| 09-30 | 施工 | SPEC-01 子任务 1.3/1.4/1.5 **并行派发并全部验收**（aa524f6 / e982d73 / dc2f488）：manifest+background 路由、红线与 prompt 检查脚本、content+panel 壳；并行冲突一处由父 agent 裁决——**config 拆 shared 层**（content 唯一合法配置入口，模型端点彻底隔离出 content 上下文），1.3 的检查脚本在真实仓库扫描中抓出 2 条违规并已修复。当前全套：tsc 零错误、vitest 47 例全绿、check 全 PASS、build 成功 | ✅ A1~A4 自动验收通过；**A5/A6 待用户人工验收**（装 Chrome 验证 videoId 显示与分 P 切换） |
| 09-30 | 验收 | **SPEC-01 全部验收通过，tag spec-01-accepted**。A5（侧边栏打开、videoId/标题/时长/播放状态显示）与 A6（P2→P3 无刷新切换、含关闭面板再打开场景）用户确认通过。期间 6 轮人工验收迭代修复：dist 缺 manifest、sidePanel 点击无反应（per-tab 禁用残留、跨 await 丢手势、关闭面板清空 active 条目需显式 path 绑定）——sidePanel API 坑合集已入项目记忆 | ✅ SPEC-01 关闭；开工 SPEC-02 |
| 09-30 | 施工 | **连夜施工（用户授权自主推进）**：①重生成 UI 丝滑化（grid 折叠动画 + active 高亮跟随 + 平滑滚动）；②新增 `npm run verify` 直连验收命令（管道吞退出码问题两次，彻底根治）；③SPEC-04 导图全量（markmap 渲染/点击跳播/跟随高亮，19 例）与 SPEC-05 问答全量（上下文编译器红线 3/术语+区间 pipeline/双 prompt 单一源/qaHistory/ChatTab 打字机/字幕划词联动，60 例）并行派发完成；④父 agent 接线（sections 上提/explainLoader/pendingTerm 联动/暂停）；⑤记忆压缩（剔除过程性 bug 细节，保留决策/API 坑/进度） | ✅ 414 测试全绿；SPEC-04/05 施工完成待用户人工验收；A5 口径变更（打字机替代 SSE，流式列 v0.1.x）已批准记录 | 
| 09-30 | 决策 | **按模块选择模型**（用户建议）：当前全局单模型 → 改为"默认模型 + 命名模型方案 + 各 Tab 下拉单独选择"。动机：大纲适合便宜文本模型、问答适合多模态。设计：ModelConfig 增 name/supportsVision（视觉能力随方案走，修全局勾选的语义错位）；Settings 增 modelProfiles/moduleModel；loader 按模块解析（outline/mindmap/qa，persona 随 qa）；删除被引用方案时回退默认 | 记录于 SPEC-03 范围变更；施工派发 | 
| 09-30 | 打回 | 用户人工验收 A5 首次执行报"清单文件缺失"——**dist/ 无 manifest.json**（构建只产出 JS/HTML，清单未复制），判定为 A1 自动验收的疏漏（只查产物存在，未查"dist 可加载"） | ✅ 父 agent 单点修复：vite closeBundle 复制 manifest.json 进 dist，构建后校验通过；**教训入库：[自动] 验收项的断言必须覆盖验收语句的完整语义**（A1 说"可直接加载"就必须模拟加载条件） |
| 09-30 | 决策 | **模型配置回归"一套"**（用户拍板，推翻上一条"按模块选择模型"）：删除「各平台 API Key」与「模型方案」两个模块，大纲/导图/问答共用一套配置；Key **按预设槽位存两份**（`Settings.modelSlots`），UI 只露一个 Key 输入框，切换预设各带各的 Key | 记录于 TECH-DESIGN §7.4；`modelProfiles` / `moduleModel` / `endpointKeys` 标 deprecated 并写读时迁移 |
| 09-30 | 决策 | **公开资料检索内置 DuckDuckGo**（用户拍板）：放弃用户自填 Tavily/Serper 的方案，改走免 Key 的 DuckDuckGo Instant Answer，问答时自动调用、用户无感知；设置页删除该配置区 | 记录于 TECH-DESIGN §7.4.1；manifest 增 `https://api.duckduckgo.com/*` |
| 09-30 | 施工 | 模型配置重构（预设槽位）：types 增 modelSlots + 三字段 deprecated；modelForm 重写（presetConfigOf/slotConfigOf/slotHasKey/writeSlot/migrateLegacyModelSettings/resolveModel 取代旧的方案与端点 Key 一族）；SettingsPage 删两个模块、切换预设改为「先存草稿再带出」（未保存编辑不再被清空，根因修复）、"已保存"改读当前槽位、去掉"留空表示不修改"矛盾文案与被下一行清空的提示 bug；ModelPicker 改为两个预设的下拉（多模态标红、缺 Key 红色提示 + 去设置）、三 Tab 共用同一份配置；四个 loader 的 resolveModuleModel → resolveModel；检索改 DuckDuckGo 并加 8s 超时 | ✅ tsc 零错误、vitest 867 例全绿、check:redlines 全 PASS、build 成功；manifest 同步去掉已废弃的 dashscope 权限 |
| 09-30 | 修复 | **API Key 互踩根因**（用户报告"配了 A 模型，B 模型的显示被覆盖为空"）：①切换预设时用 `savedKeyForEndpoint` 覆写表单 → 未保存的 Key 被静默清空；②"已保存"提示恒读单一 `settings.model.apiKey`，看起来像互相覆盖；③`applyPreset` 不清 Key，极端情况把 A 平台的 Key 打到 B 端点 → 401。三者由「预设槽位 + 草稿 + 按槽位显示」一并解决 | ✅ 复现脚本验证：两份 Key 在槽位中各存各的，切走再切回完整带出 |
| 09-30 | 修复 | **控制台 "CSP blocks the use of eval"**：根因不是业务代码——zod v4 的对象 schema 在实例化时读 `util.allowsEval.value`，该探测实现为 `new Function("")`，MV3 扩展页 CSP（script-src 'self'）禁止 → zod 内部 try/catch 吞掉并回退非 JIT，**功能无损、仅为噪音**。修法：新增 `src/core/zodEnv.ts` 置 `z.config({ jitless: true })`，由 `panel/main.tsx` 首行 import 保证先于任何 schema 模块求值；双重保险（jit=false 短路 + allowsEval 自身见 jitless 直接返回 false） | ✅ 单测断言：schema 实例化后 `allowsEval` 缓存未被求值；校验功能不变 |
| 09-30 | 施工 | **LLM 交互日志子模块**（验证期报告内）：新增 `core/metrics/llmLog`（环形缓冲 200 条 + 订阅 + console 镜像 `[vsc][llm]` + 截断 + 密钥脱敏）；`harness/modelClient` 作为唯一出口在成功/失败各记一条（含 HTTP 码、耗时、token、请求与响应报文预览、错误原文）；DB 升 v3 增 `logs` store + `DbLike.delete`；`panel/llmLogStore` 落库（开关 `llmLogEnabled`，默认开）；`panel/LlmLogView` 展示（失败红色高亮并默认展开、复制全部、清空）；调用点加 `label`（outline/mindmap/qa/persona/frame-plan） | ✅ tsc 零错误、vitest 897 例全绿、check:redlines PASS、build 成功 |
| 09-30 | 修复 | **错误文案未脱敏**（单测捕获）：上游错误可能回显 API Key，原先只脱敏了报文预览，`error` 字段与抛给 UI 的异常文案仍可能带 Key。修法：`chatCompletion` 内加 `safe()`，所有进入日志与异常的文案统一过 `redactSecrets` | ✅ 单测：响应体回显 Key 的用例下，整条日志 JSON 不含 Key |
| 09-30 | 修复 | **概念图内容偏薄：抽帧只有 3 张**（用户反馈"根本没起到指示作用"）：根因是**抽帧 prompt 主动鼓励少抽**（`frame-plan.md` 原话"如果 3 帧已经覆盖全部知识块，就不要凑到 5 帧"，而模型看不到画面、覆盖率只能靠字幕猜，必然高估覆盖）；叠加预算只有 4 帧、`suggestFrameRange` 下限只有 3（模型给 3 就放行，不触发公式补齐）。修法：①`frame-plan.md` 升 0.3.0，下限改为硬要求 + "宁可多给一帧也不要漏块"；②`suggestFrameRange` 下限提到 `max(ideal, ⌈budget×2/3⌉)` 且至少 2；③`VISION`：`maxFramesPerRequest` 6→8、`mindmapFrames` 4→6、`qaFrames` 3→4；④顺带修 outline 抽帧长期落空的接线缺陷（原按 `chunk[0].startMs` 精确匹配预抽帧 targetMs，几乎不可能命中，改为按块下标顺序分配） | ✅ 52 文件 / 911 例全绿、redlines PASS、build 成功 |
| 09-30 | 施工 | **LLM 交互日志展示图像**：日志条目增 `frames`（每帧时间点 + 字节数，轻）与可选 `thumbnails`（最多 3 张、单张 ≤30KB，**默认关闭**避免撑爆 IndexedDB）；`ChatImage`/`ExplainModelImage` 增 `timeMs` 并在四个调用点透传；视图摘要显示"N 帧 [时间点列表]"，展开后是缩略图网格（时间 + 体积），工具栏加「保存图像缩略图」开关 | ✅ 4 条单测（含数量/体积双限） |
| 09-30 | 施工 | **概念图视觉增强（代码侧富渲染，非 LLM 输出 HTML）**：顶部统计条（阶段/概念/可跳播数）、阶段序号五色轮转、概念按 importance 做 1→5 级左侧热力色条、5 级概念加粗强调 | ✅ 保持结构化输出可缓存/可校验/可跳播/可降级，零 XSS 面 |
| 09-30 | 修复 | **概念图"模型输出不是合法 JSON"**（用户提供真实报文：HTTP 200，但 JSON 缺最外层 `}`——**输出被截断**）：①新增 `core/pipeline/jsonRepair.ts`（`repairTruncatedJson` / `parseJsonLoose`）——先严格解析，失败则补齐缺失的闭合括号，若元素写了一半则回退到最后一个完整元素再补齐；接入 `parseConceptStages` 与 `parseModelOutline`；②重试提示按失败类型分化：截断时明确要求"输出更短、务必闭合"（同上下文重试否则会再截一次）；③日志新增 `finish_reason`（`length` 即撞 maxTokens），视图上直接标"输出被截断(length)"；④`concept-map.md` 升 0.3.0，要求**紧凑输出**（压成一行、宁可少写 details 也要闭合）从源头压体积 | ✅ 10 条单测（含线上真实报文回归）；tsc 零错误、vitest 907 全绿、redlines PASS、build 成功 |
| 09-30 | 施工 | **帧预算改为按时长与密度自适应**（用户原话：十分钟的知识密集视频，几帧肯定不行）：①新增 `FRAME_PLAN`（outline 90s/帧·3~8 帧、mindmap 45s/帧·6~16 帧、qa 30s/帧·2~8 帧）与 `FRAME_DENSE_BOOST=1.5`；②`framePlanner` 新增 `frameBudgetFor` 与 `isDenseSections`（术语密度阈值复用 `DENSITY.highNewTermsPerMin`）；③**修掉两个让预算形同虚设的硬瓶颈**——content 侧 `DEFAULT_MAX_FRAMES` 写死 6（规划 16 帧实际只抽 6 帧）、候选窗口按 `durationMs/8` 切（10 分钟仅 8 个窗口，选不出 16 帧）→ 改为跟随目标数（兜底 24）与 `max(30s, durationMs/24)`；④抽帧前先暂停视频（连续 seek 会让画面一路乱跳，帧越多越明显），抽完恢复原状态 | ✅ 10 分钟密集视频的导图可取到上限 16 帧；53 文件 / 923 例全绿、redlines PASS、build 成功 |
| 10-01 | 决策 | **抽帧从"模型报秒数"改为"代码列结构候选、模型按编号挑"**（用户：让 LLM 发挥主观能动性 + 章节首尾与知识点代表章节演进）。分工：代码知道结构（章节开头 / bullets 知识点 / 章节结尾，每个候选附该时刻字幕），模型看得懂内容（据此取舍并写 covers/why）；代码保留护栏（预算区间、每章至少一帧、间隔去重）。**图像不降清晰度**：token 由像素尺寸决定、与 JPEG 质量无关，512px 下代码小字不可读；省 token 改为 dHash 去重复画面 | ✅ 采纳 |
| 10-01 | 施工 | ①新增 `core/vision/structuralCandidates.ts`（候选生成 / 优先级兜底 / 章节覆盖护栏 / 帧说明）与 `core/vision/dhash.ts`；②`frame-plan.md` 0.4.0 重写为候选制，`concept-map.md` 0.4.0 增加"首尾对照看演进、概念优先从画面提炼、冲突以字幕为准"；③**帧-字幕交错发送**：`ChatImage.caption` 紧贴图前（`【画面 i/N · mm:ss · 第 k 章「标题」· 章节开头/知识点/结尾】此刻字幕：…`），大纲/导图/问答三处接线，问答规划改传区间内章节；④`VISION.maxSize` 512→896 且**首次接线**到 content（此前 content 写死 512，常量未使用）；⑤content 侧算 9×8 dHash + 160px 缩略图，`dedupeFrames` 优先用汉明距离；⑥日志每帧显示配对字幕，缩略图改用小图并与帧对位 | ✅ 54 文件 / 948 例全绿、redlines PASS、build 成功 |
| 10-01 | 修复 | 顺带发现的三个吞帧/错配缺陷：**FramePlanSchema.targets.max(12)** 低于导图预算 16——模型老实给 13+ 帧时整份规划被 Schema 拒掉、静默回退公式；**大纲帧按下标分配**（第 i 帧给第 i 块，与时间无关）→ 改为按时间归属分块；**日志缩略图**跳过超限项导致下标错位、且 896px 原图几乎全被 30KB 门槛挡掉 → 与帧对位 + 用 160px 小图 | ✅ 各有回归用例 |
| 10-01 | 施工 | **导图帧预算随视频时长增长**（用户：很长的视频理应获得很多帧）：`FRAME_PLAN` 改为分段递减 tiers（导图 0~10 分钟 45s/帧、10~60 分钟 90s/帧、60 分钟后 180s/帧）+ 每章至少 2 帧兜底 + 密集 ×1.5，只受 `hardMax=40` 成本护栏约束（10/30/60 分钟 → 14/27/40 帧，原来全部卡在 16）。同时修掉链路上三个会把长视频帧数吃掉的隐性上限：①抽帧规划 `maxTokens` 写死 1024（40 帧的 JSON 约 3k token，必截断 → 回退公式）→ 按预算放大；②规划解析改用 `parseJsonLoose`，截断也能保留已完整的帧；③content `DEFAULT_MAX_FRAMES` 24→48，并加单测守住 ≥ hardMax | ✅ 54 文件 / 952 例全绿、redlines PASS、build 成功 |

---

---

## 待办（下一迭代）

- [ ] 开工 SPEC-01：父 agent 先完成子任务 1.2（共享契约），再派发 1.1/1.3/1.4/1.5
- [ ] SPEC-02 开工首日：用户在已登录 Chrome 中执行 A6 覆盖率预检（P2~P11）
- [ ] SPEC-03 开工前：用户提供 DeepSeek API key
- [x] ~~用户确认审计处置方案~~（09-30 全部采纳）
- [x] ~~修订宪法 / TECH-DESIGN / SPEC-01~06，新增 SPEC-07 与两份模板~~
- [x] ~~用户提供真实学习目标视频~~（BV1YG7G6eEPR 01~10 集）
- [x] ~~用户确认三个开放问题~~（09-30 已全部拍板）
