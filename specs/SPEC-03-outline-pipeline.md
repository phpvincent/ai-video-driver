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
|---|---|---|---|---|
| 2026-09-30 | 子 agent 3.1 | modelClient（OpenAI 兼容、注入 fetch、URL 规范化、JSON 模式、usage 映射、结构化 throw）+ 设置页激活（GET/SET_SETTINGS 持久化、校验、测试连接按钮、apiKey 脱敏）+ 15 例单测（假域名 + test-key） | tsc 零错误；34 例（harness 15 + panel 19）全绿 | 31127bd（已验收） |
| 2026-09-30 | 子 agent 3.2+3.3 | pipeline 核心：chunkCues（1800/200、Cue 边界切点、超长独立）+ runOutline（工作池并发 3、30s 超时、重试 1、吸附 >5s 幻觉丢弃、增量尾合并、finalize、预算熔断 chars/2 估算）+ 47 例单测（红线 2 集合断言 + 确定性检查）；偏差已裁决：skipped 块用扩展 ChunkState、OutlineSection 省略 density（3.5）、mergeAdjacentMs=60s 可配 | tsc 零错误；47 例全绿 | 725d530（已验收） |
| 2026-09-30 | 父 agent | 3.1/3.2+3.3 并行验收：全套复跑 tsc 零错误、233 例全绿（+62）、红线 R9/R10 PASS、G3 抽查（core 无 URL/密钥字面量）通过 | ✅ | 725d530 |

## 4. 验收标准

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
