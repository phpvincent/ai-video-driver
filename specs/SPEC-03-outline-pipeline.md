# SPEC-03 · 预读大纲 pipeline

- 状态：待开工
- 依赖：SPEC-02
- 对应里程碑：M3
- 执行者：（派发时填写）

## 1. 目标与范围

**做**：
- `background/pipeline/outline.ts`：确定性 map-reduce——切片（单块目标 1800 字，重叠 200 字）→ 并发调用（并发度 3，单块超时 30s，失败重试 1 次）→ 合并去重 → **时间吸附**（章节起点吸附到最近 Cue.startMs）
- `background/context/compiler.ts`：上下文编译器（token 预算控制，供 SPEC-05 复用）
- `schemas/`：SectionSchema（Zod），校验失败自动重试并附错误信息（红线 4）
- `prompts/outline.ts` + `.agents/skills/outline-generation/SKILL.md`：同源双维护（红线 6）
- 模型客户端：OpenAI 兼容 fetch 封装，modelConfig 从设置页读取并持久化（chrome.storage.local）
- 设置页激活：baseUrl/apiKey/model/temperature 可配置，含连通性测试按钮
- Panel 大纲 Tab：章节树渲染（标题 + mm:ss + 摘要），点击跳播，流式渲染（首章节可见 ≤ 12s）
- **信息密度预警（轻量版）**：大纲生成时为每章计算密度指标（新术语数 / 章节时长），Section 增加 `density: 'low'|'mid'|'high'` 字段，大纲 Tab 章节行显示密度标记（高密度醒目标识）。**不做**主动弹提示/自动降速交互（v0.1.x）
- 会话 token 消耗统计展示

**不做**：导图（SPEC-04）、划词/区间问答（SPEC-05）。

## 2. 前置条件

- SPEC-02 已验收（能稳定产出 Cue[]）
- DeepSeek API key 可用

## 3. 执行方案（可拆为 4 个子任务派发）

| # | 子任务 | 交付物 | 预估 |
|---|---|---|---|
| 3.1 | 模型客户端 + 设置页 | fetch 封装、modelConfig 持久化、连通性测试 | 1d |
| 3.2 | 切片与并发调度 | chunkCues()、并发池、超时重试；单测用 mock 模型 | 1d |
| 3.3 | 合并与时间吸附 | 相似章节合并、吸附算法（吸附到最近 Cue 边界，误差阈值 3s）；单测 | 1d |
| 3.4 | 大纲 Tab + prompt/SKILL 同步 | 章节树 UI、流式渲染、跳播回调、双文件同步 | 1d |
| 3.5 | 密度预警轻量版 | Section.density 计算（术语计数/时长归一）、大纲章节密度标记 UI | 0.5d |

## 4. 验收标准（父 agent 逐条执行）

- [ ] A1 单测：切片器边界（空字幕 / 单 Cue / 超长 Cue / 精确 1800 字）全覆盖
- [ ] A2 单测：吸附算法——构造模型输出时间戳偏移 ±5s 的用例，吸附后 startMs 与某真实 Cue.startMs 严格相等（红线 2）；**幻觉时间戳处理**：构造偏移 >5s 的用例，断言该章节被丢弃/重试，而非吸附到远端无关 Cue
- [ ] A3 单测：Zod 校验失败 → 重试一次 → 仍失败则该块标记失败不阻断整体（map-reduce 局部失败容忍）
- [ ] A4 联调：20 分钟 B 站视频，大纲生成 P90 ≤ 20s（60 分钟按并发度 3 线性外推 ≤ 45s），首章节可见 ≤ 12s
- [ ] A4b **SW 存活验证**：60 分钟视频大纲生成全程（含等待期）在 MV3 service worker 上不因空闲被杀——并发 fetch 保活 + 已完成分块即时落盘，SW 意外重启后能从缓存续跑未完成分块（单测模拟 SW 重启场景）
- [ ] A4c **成本熔断**：单视频 token 预算上限（默认 200k，可配）——超限立即停止未开始分块、已生成部分正常渲染、UI 明确提示"已达预算上限"
- [ ] A5 联调：章节点击跳播，跳转位置误差 ≤ 2s
- [ ] A5b **密度预警**：单测密度计算（空章节/超短章节/满术语章节三档）；联调验证高密度章节（如代码演示段）在大纲上有醒目标记；密度字段进缓存随 modelVersion 失效
- [ ] A6 pipeline 为纯函数（无 chrome.* 依赖），单测可脱离浏览器跑（红线 1 的可测性保障）
- [ ] A7 prompts/ 与 .agents/skills/ 内容一致（diff 校验）
- [ ] A8 G1/G2/G3 门禁全过；执行记录已追加

## 5. 风险与回滚

- 风险：**MV3 service worker 空闲 30s 被杀**，长 pipeline 中断 → 缓解见 A4b：pending fetch 保活 + 分块级断点续跑（每完成一块写 IndexedDB）
- 风险：长视频章节合并后标题语义重复 → 合并阈值可配，验收视频用 SPEC-02 §4b 固定清单回归
- 风险：模型 JSON 输出不稳定 → temperature 0.2 + few-shot 样例进 prompt
- 回滚：pipeline 模块独立，可整体禁用回退到"仅字幕模式"（SPEC-02 产物仍可用）

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 |
|---|---|---|---|
| — | — | — | — |
