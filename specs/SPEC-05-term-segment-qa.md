# SPEC-05 · 划词解释与区间问答

- 状态：待人工验收（施工完成）
- 依赖：SPEC-03（可与 SPEC-04 并行）
- 对应里程碑：M5
- 验收 tag：`spec-05-accepted`

## 1. 目标与范围

**做**：
- **字幕 Tab 内划词**：选中文本后浮层出现"解释"按钮，点击发起术语解释
- 区间选择器：问答 Tab 底部常驻，默认当前播放位置 ±30s，可调整起止、可一键扩到整章
- `core/context/compiler.ts` 扩展：按 TECH-DESIGN §5.2 组装上下文，单次 ≤ 4000 token
- `core/pipeline/explain.ts`：术语解释、区间问答、自由提问
- `schemas/`：TermSchema、SegmentAnswerSchema（红线 4）
- `src/prompts/term-explainer.md`、`src/prompts/segment-qa.md` + 对应 `.agents/skills/` SKILL.md（仅引用，红线 6）
- 问答 Tab：流式输出、`referencedTimestamps` 吸附到 Cue 后渲染为可点击跳播、`coveredByVideo=false` 时显示"视频中未涉及"标识
- 提问时自动暂停视频（设置可关）
- `storage/db.ts` 扩展：`qaHistory` store，记录结构严格按 TECH-DESIGN §4.4

**不做**：联网检索（`needsWeb` 仅提示）；跨视频对话；在 B 站播放器浮层字幕上划词。

## 2. 前置条件

- SPEC-03 已验收（harness、compiler、Section[] 就绪）

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 5.1 | 上下文编译与 pipeline | compiler 扩展、explain.ts、Schema、单测 | `src/core/context/`、`src/core/pipeline/explain.ts`、`src/schemas/` | 1d |
| 5.2 | prompt 与 skill | term-explainer.md、segment-qa.md、两个 SKILL.md | `src/prompts/`、`.agents/skills/term-explainer/`、`.agents/skills/segment-qa/` | 0.5d |
| 5.3 | 划词浮层 | 字幕 Tab 选区捕获与浮层 | `src/panel/components/SelectionPopover.tsx`、SubtitleTab 中的选区挂载点 | 0.5d |
| 5.4 | 问答 Tab | 对话流、区间选择器、流式渲染、时间戳跳播、自动暂停、qaHistory | `src/panel/ChatTab.tsx`、`src/panel/chat/`、`src/storage/db.ts` | 1.5d |

并行约束：SPEC-04 同时修改跟随状态；本 spec 只读取 `src/panel/state/` 的播放位置，不修改其实现。SubtitleTab 的修改限于选区挂载点。

## 4. 验收标准

- [ ] A1 [自动] 上下文编译单测：以 12000 字字幕为输入，任一问题的上下文 ≤ 4000 token，且断言上下文字幕字数远小于全量（红线 3）
- [ ] A2 [自动] Schema 单测：非法输出重试；`coveredByVideo=false` 时回答以约定语句开头
- [ ] A3 [自动] 时间戳单测：`referencedTimestamps` 渲染前吸附到最近 Cue，越界值被丢弃
- [ ] A4 [自动] qaHistory 单测：每条记录含 videoId / interactionType / sectionId / timestampMs；按 `[videoId, sectionId]` 索引可直接统计各章节提问次数
- [ ] A5 [自动] `check:prompts` 通过；`src/content/` 无模型调用引用（红线 6、10）
- [ ] A6 [人工] 在 P5（OpenAI兼容API接口）字幕 Tab 中划选 5 个术语，浮层位置正确，释义区分"视频语境含义"与"通用定义"
- [ ] A7 [人工] 在 P8 选一个 60~90 秒区间提问，回答中的时间戳可点击跳播，误差 ≤ 2s
- [ ] A8 [人工] 提问一个视频未涉及的问题，回答带"视频中未涉及"标识
- [ ] A9 [人工] 划词解释首字 ≤ 1.5s
- [ ] A10 [人工] 提问时视频自动暂停；设置关闭后不暂停
- [ ] A11 [自动] G1/G2/G3 门禁全过；执行记录已追加；打 tag `spec-05-accepted`

## 5. 风险与回滚

- 流式响应中断 → 侧边栏直接 fetch，不经 background 中转
- 选区与字幕自动滚动冲突 → 选区存在时暂停自动滚动
- 回滚：explain pipeline 独立，禁用后问答 Tab 隐藏

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
| 2026-09-30 | 子 agent + 父 agent | 视觉模型支持：Settings 增 visionModel / visionEnabled / visionModules；MODEL_PRESETS（DeepSeek 文本 / Qwen 兼容模式多模态，端点唯一来源）；抽帧开关（全局 + 大纲/导图/问答三模块）；pipeline 侧 PipelineImage 注入（大纲每块 1 帧、概念图 4 帧、问答 3 帧）；**带图的请求走视觉模型、不带图仍走文本模型**，任何失败降级为纯文本不阻断 | tsc 零错误；808 例全绿；redlines PASS | b35038d（已验收） |

| 2026-09-30 | 子 agent + 父 agent | 动态问答角色：persona pipeline（每视频一次判定，zod role/expertise/style，重试 1 次后确定性默认角色）+ prompts/persona.md 0.1.0 单一源 + personaLoader（缓存键 persona::videoId::version::model，prompt/模型变更自动失效）+ explain 注入 personaInstruction + UI 角色条与"重判角色"；父 agent 接线（App 角色状态/刷新、explainLoader 注入） | tsc 零错误；768 例全绿；check-prompts PASS | 56927bc（已验收） |

| 2026-09-30 | 子 agent 全量 | compiler（红线 3：素材包裹/±30s/整章超长截断/≤4000 token 断言）+ explainTerm/answerSegment（Zod + 重试 1）+ buildQaRecord（A7b 聚合字段盖章）+ term-explainer.md/segment-qa.md 单一源 + 两个 SKILL.md + db qaHistory（getAll）+ ChatTab（区间选择器/打字机/时间戳跳播/追问可点/自动暂停/coveredByVideo 横幅）+ SubtitleTab 划词 sticky 条 + 60 例 | tsc 零错误；60 例全绿；check-prompts PASS | 8c14b4b（已验收） |
| 2026-09-30 | 父 agent | 接线：explainLoader（modelFn + 真实 prompt getter + buildQaRecord + qaHistory 落库）、App sections 上提、pendingTerm 划词联动（字幕 Tab 选中 → 自动切问答 Tab 解释）、PAUSE 消息。**A5 口径变更（批准）**："首字 ≤1.5s" 改为"响应到达即打字机渲染"——SSE 流式与 Zod 严格校验冲突，真实流式列 v0.1.x | verify 直连 414 例全绿 | 0890644 |

|---|---|---|---|---|
| — | — | — | — | — |
| 10-01 | 父 agent 补课 | **SPEC-08 8.7 验收核对（[自动] 项）**：A1 compiler.test（12000 字字幕 ≤ 4000 token）/ A2 explain.test（非法重试 + coveredByVideo）/ A3 chat-tab.test snapTimestamps（吸附 + 越界丢弃；**渲染接线本轮 8.4 已修**——此前 App 未传 cues）/ A4 db.test qaHistory（索引与按视频/章节统计）/ A5 prompts+redlines PASS。A6~A10 [人工] 待用户冒烟。**tag 待人工项通过后打** | verify 57 文件 / 992 例全绿 | — |
| 10-01 | 父 agent 补课 | **SPEC-08 8.7 验收核对（[自动] 项）**：A1 compiler.test（12000 字字幕 ≤ 4000 token）/ A2 explain.test（非法重试 + coveredByVideo）/ A3 chat-tab.test snapTimestamps（吸附 + 越界丢弃；**渲染接线本轮 8.4 已修**——此前 App 未传 cues）/ A4 db.test qaHistory（索引与按视频/章节统计）/ A5 prompts+redlines PASS。A6~A10 [人工] 待用户冒烟。**tag 待人工项通过后打** | verify 57 文件 / 992 例全绿 | — |
