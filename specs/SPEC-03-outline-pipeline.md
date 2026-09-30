# SPEC-03 · 预读大纲 pipeline

- 状态：进行中（3.1 与 3.2+3.3 已并行派发）
- 依赖：SPEC-02
- 对应里程碑：M3
- 验收 tag：`spec-03-accepted`

## 1. 目标与范围

**做**：
- `core/harness/`：OpenAI 兼容模型客户端（流式与非流式）、Schema 校验与重试、预算熔断、超时、PipelineTrace
- `core/pipeline/outline.ts`：按 TECH-DESIGN §5.1 实现切片 → 并发 → 校验 → 吸附（5s 幻觉阈值）→ 增量合并 → 全局校正 → 密度计算
- `core/context/compiler.ts`：token 估算与预算工具（供 SPEC-05 复用）
- `schemas/outline.ts`：SectionCandidateSchema / OutlineChunkSchema
- `src/prompts/outline.md`（带 promptVersion）+ `.agents/skills/outline-generation/SKILL.md`（仅引用，红线 6）
- `storage/db.ts` 扩展：`outlines`（含 chunkState 续跑）与 `traces` store
- **pipeline 在侧边栏上下文运行**；侧边栏重开时从未完成分块续跑
- 设置页激活：ModelConfig 持久化到 `chrome.storage.local`、连通性测试按钮、trace 导出
- 大纲 Tab：章节树（标题 / mm:ss / 摘要 / 密度标记）、按块增量渲染、点击跳播、token 用量显示、熔断提示

**不做**：导图（SPEC-04）；问答（SPEC-05）；密度主动提示与降速建议（v0.1.x）。

## 2. 前置条件

- SPEC-02 已验收，A6 覆盖率决策已结论
- 用户提供 DeepSeek API key

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 3.1 | harness | 模型客户端、Schema 重试、熔断、trace；用 mock 响应单测 | `src/core/harness/`、`tests/unit/harness/` | 1d |
| 3.2 | 切片与并发 | chunkCues、并发池、超时、chunkState | `src/core/pipeline/outline.ts`、单测 | 0.5d |
| 3.3 | 吸附、合并、密度 | 吸附与幻觉丢弃、增量合并、全局校正、密度算法 | `src/core/pipeline/outline.ts`、单测 | 1d |
| 3.4 | prompt 与 skill | outline.md、SKILL.md、Schema | `src/prompts/`、`.agents/skills/outline-generation/`、`src/schemas/` | 0.5d |
| 3.5 | 设置页与大纲 Tab | ModelConfig 持久化、连通性测试、trace 导出、OutlineTab | `src/panel/`、`src/storage/db.ts` | 1d |
| 3.6 | 回放录制与质量基线 | 模型响应录制、回放测试、黄金样例评分表 | `tests/fixtures/recorded/`、`tests/replay/` | 0.5d |

## 3b. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
| 2026-09-30 | 子 agent + 父 agent | prompt 0.2.1（章节密度从上限改目标区间：每章 2.5~5 分钟、≈时长÷3.5、单块 1~3 自然章）+ 设置页「当前策略」摘要（describeModelStrategy：文本/视觉模型、抽帧状态、路由规则说明）| tsc 零错误；92 例（三套件）+ verify 直连全绿；promptVersion 0.2.1 自动失效旧缓存（用户重新生成） | <随提交回填> |

|---|---|---|---|---|
| 2026-09-30 | 子 agent 3.1 | modelClient（OpenAI 兼容、注入 fetch、URL 规范化、JSON 模式、usage 映射、结构化 throw）+ 设置页激活（GET/SET_SETTINGS 持久化、校验、测试连接按钮、apiKey 脱敏）+ 15 例单测（假域名 + test-key） | tsc 零错误；34 例（harness 15 + panel 19）全绿 | 31127bd（已验收） |
| 2026-09-30 | 子 agent 3.2+3.3 | pipeline 核心：chunkCues（1800/200、Cue 边界切点、超长独立）+ runOutline（工作池并发 3、30s 超时、重试 1、吸附 >5s 幻觉丢弃、增量尾合并、finalize、预算熔断 chars/2 估算）+ 47 例单测（红线 2 集合断言 + 确定性检查）；偏差已裁决：skipped 块用扩展 ChunkState、OutlineSection 省略 density（3.5）、mergeAdjacentMs=60s 可配 | tsc 零错误；47 例全绿 | 725d530（已验收） |
| 2026-09-30 | 父 agent | 3.1/3.2+3.3 并行验收：全套复跑 tsc 零错误、233 例全绿（+62）、红线 R9/R10 PASS、G3 抽查（core 无 URL/密钥字面量）通过 | ✅ | 725d530 |
| 2026-09-30 | 子 agent 3.4 | prompts/outline.md 单一事实源（promptVersion 0.1.0，解析器剥头注释，红线 6）+ outlineLoader（modelClient↔runOutline 组装、buildPrompts 注入正式 system prompt、调用时实时读 settings）+ OutlineTab 五态状态机/章节列表/点章跳播/findActiveSection 跟随高亮/密度占位/未配置模型跳设置 + SKILL.md（只引用不复制）+ 31 例；偏差已裁决：测试用 import.meta.glob('?raw')（沿先例）、SKILL 措辞避"禁止"字样兼容 check-prompts | tsc 零错误；31 例全绿；check-prompts PASS | 8b0c82f（已验收） |
| 2026-09-30 | 子 agent 3.5 | density.ts（computeDensity/attachDensity：术语 trim+小写去重、new/分钟 rate、0.1 分钟 clamp、≥4 章分位数 R-7 分档 / <4 章绝对阈值 3/1、退化情形）+ finalizeOutline 返回升级为 Section[]（方案 a，协变兼容）+ 19 例（含确定性双跑断言，红线 1） | tsc 零错误；19 例全绿；pipeline 套件 66 例无回归 | fc7db80（已验收） |
| 2026-09-30 | 父 agent | 3.4/3.5 并行验收：全套复跑 tsc 零错误、**283 例全绿（+50）**、红线全 PASS（prompts 检查首次实跑：SKILL.md→outline.md 引用校验通过）、build 成功 | ✅ 剩余：OutlineRecord 缓存接线（含 SW 宿主验证 A4b）、进度钩子、A4/A5/A13 联调待用户 | fc7db80 |
| 2026-09-30 | 父 agent | 收尾接线（3.1~3.5 之后的父 agent 亲自部分）：① runOutline 增 onProgress 进度钩子（增量合并阶段按块下标顺序触发、回调异常吞掉）+ 3 例钩子单测；② db 层 outlines store get/save（键 [videoId, promptVersion, model]，红线 7 定向失效；chunkState 断点随存）；③ outlineLoader 接缓存（命中短路、结果落库写失败不阻断）+ 进度透传；④ OutlineResult.sections 升级为 Section[]（与 3.5 finalize 对齐） | tsc 零错误；286 例全绿；红线全 PASS；build 成功 | 3408a28（已验收） |


## 3c. 范围变更记录（2026-09-30，用户驱动的大纲质量迭代）

用户实测 P7（27 分钟）产出 23 章（过度碎片化，均 70 秒/章），提出四项改进。按宪法 §8 记录：

1. **切 Tab 后大纲状态丢失**（显示问题）：Tab 重挂载未自动读缓存 → 改为挂载即自动加载（缓存命中秒显），仅无缓存时显示生成按钮
2.1 **章节时间显示为范围**：UI 显示 `mm:ss-mm:ss`（endMs 已有）；bullets 升级为带开始时间戳的对象，可点跳播
2.2 **密度改 0-100 打分**：score = 代码确定性合成（新知识率 min-max 归一 45% + 术语密度 25% + 模型给出的 importance 1-5 归一 30%）；density 低/中/高徽标保留为分数分档
2.3 **每章单独重新生成 + 用户反馈**：regenerateSection 管道（反馈仅方向性引导，内容仍必须来自字幕素材，防幻觉约束入 prompt）；UI 每章独立重生成按钮 + 反馈输入
4. **Prompt 粒度优化**：prompt v0.2.0（章节粒度约束：全片章节数 ≤ max(3, ceil(分钟数/4))、单章 3-8 分钟、片头寒暄并入首章）+ 代码强制最短章节 90 秒（不足自动合并，finalize 后处理）

连带变更：SectionCandidateSchema bullets → `{text, startSec}` 对象数组（吸附到 Cue 边界）、新增 `importance` 字段、Section 类型新增 importance/score、promptVersion 0.1.0 → 0.2.0（**旧缓存按红线 7 自动失效**，用户需重新生成）、新增 src/prompts/outline-regenerate.md。

### 范围变更五次迭代（2026-09-30 中午，用户对 Qwen 生成质量的反馈）

事实：切到 Qwen 视觉模型后 P12（20:53）只出 3 章（每章 7~11 分钟，过粗）。根因两个叠加：① prompt v0.2.0 的章节数约束是**上限**表述（"不超过 ceil(分钟/4)"），模型往少做；② 分块按 1800 字符（≈7 分钟/块），模型倾向一块一章。用户两次反馈正好框定合理区间：1.2 分钟/章太碎、7 分钟/章太粗 → **每章 2.5~5 分钟**。

施工项：
1. prompt v0.2.1：章节数约束从上限改为目标区间——「每章时长目标 2.5~5 分钟；章节数 ≈ 视频时长 ÷ 3.5 分钟（上下浮动 1 章）；单个分块通常包含 1~3 个自然章节，按内容边界划分」
2. 设置页新增「当前策略」摘要（describeModelStrategy 纯函数 + UI）：当前文本模型 / 视觉模型 / 抽帧状态 / 路由规则说明（带画面的请求 → 视觉模型；术语解释、自由提问、未开抽帧 → 文本模型）

## 4. 验收标准
| 2026-09-30 | 子 agent UI | 范围变更 UI 层：OutlineTab 挂载自动读缓存（修复切 Tab 状态丢失）、章节时间范围显示、bullets 带时间戳可点跳播（approximate 标 ~）、分数徽标（0-100 + 分档配色）、每章独立重生成（内联反馈输入 + 生成中骨架 + 失败重试）；loader 增 loadOutlineCached/generateOutline/regenerateOne（applyRegenerated 替换 + rescoreOutline 重算 + 缓存更新）+ 15 例 | tsc 零错误；342 例全绿 | 77f5246（已验收） |
| 2026-09-30 | 父 agent | SKILL.md schema 段同步 bullets 对象格式与 importance/score；prompts 检查 PASS | ✅ | 77f5246 |


- [ ] A1 [自动] 切片单测：空字幕、单 Cue、单条超长 Cue、恰好 1800 字、切点均落在 Cue 边界
- [ ] A2 [自动] 吸附单测：偏移 ±5s 内吸附后 startMs 严格等于某 Cue.startMs；偏移 > 5s 的章节被丢弃并计入 trace（红线 2）
- [ ] A3 [自动] Schema 单测：首次非法 → 重试成功；两次非法 → 该块标记 failed，其余块正常产出（红线 4）
- [ ] A4 [自动] 增量合并单测：已确认章节在后续块到达后不被修改；全局校正后章节覆盖全片、startMs 严格递增
- [ ] A5 [自动] 密度单测：分位数分档、少于 4 章时的绝对阈值、术语跨章去重
- [ ] A6 [自动] 熔断单测：预算耗尽后不再启动新分块，已完成分块保留，trace 标记熔断
- [ ] A7 [自动] 续跑单测：模拟中途中断，恢复后只请求未完成分块
- [ ] A8 [自动] `core/` 无 `chrome.*` 引用（check:redlines 规则）；`check:prompts` 通过（红线 1、6）
- [ ] A9 [自动] 回放测试：用录制的 P2 字幕与模型响应离线生成大纲，结果与快照一致
- [ ] A10 [人工] 性能：P4（66:45）首个章节 ≤ 12s 可见，完整大纲 ≤ 45s；P2 完整大纲 ≤ 20s
- [ ] A11 [人工] 跳播：P2、P8 各随机点击 5 个章节，跳转误差 ≤ 2s
- [ ] A12 [人工] 密度：P8（代码示例）至少一个章节为 high；与 P2 对比趋势合理
- [ ] A13 [人工] **质量基线**：用户对 P2 / P4 / P8 的大纲按"章节边界合理 / 标题准确 / 无遗漏重要段落"各打 1–5 分，记入执行记录作为基线
- [ ] A14 [人工] 续跑：P4 生成中途关闭侧边栏，重新打开后从未完成分块继续，不重复消耗已完成分块
- [ ] A15 [自动] G1/G2/G3 门禁全过；执行记录已追加；打 tag `spec-03-accepted`

## 5. 风险与回滚

- 模型 JSON 不稳定 → temperature 0.2、prompt 附 few-shot 样例、Schema 重试
- 章节标题语义重复 → 合并阈值配置化，用黄金样例回归
- 侧边栏在生成中被关闭 → chunkState 落盘，重开续跑
- 回滚：pipeline 独立，禁用后退回"仅字幕模式"（SPEC-02 产物可用）

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| — | — | — | — | — |
