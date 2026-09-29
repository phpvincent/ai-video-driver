# SPEC-05 · 划词解释与区间问答

- 状态：待开工
- 依赖：SPEC-03（可与 SPEC-04 并行）
- 对应里程碑：M5
- 执行者：（派发时填写）

## 1. 目标与范围

**做**：
- `content/selection.ts`：划词捕获（字幕文本选中 → 浮层"解释"按钮，紧贴选区不遮播放器）
- 区间选择器：问答 Tab 底部常驻"当前区间"控件（默认播放位置 ±30s，可拖动调整，可扩到整章）
- `background/pipeline/explain.ts`：术语解释 + 区间问答两个能力
- **上下文选段**（红线 3）：全局章节列表（~200 token）+ 命中区间原文 + 上轮摘要（≤150 token）；超 3000 字的章二次压缩
- `schemas/`：TermSchema / SegmentAnswerSchema（Zod，红线 4）
- `prompts/term-explainer.ts`、`prompts/segment-qa.ts` + 对应 `.agents/skills/` 双维护（红线 6）
- 问答 Tab：对话区、流式输出（首字 ≤ 1.5s）、回答内引用时间戳可点击跳播
- 提问自动暂停视频（设置可关）
- qaHistory 缓存（IndexedDB）

**不做**：联网检索增强（needsWeb 字段先返回建议，实际检索 v0.2）、多轮跨视频对话。

## 2. 前置条件

- SPEC-03 已验收（Section[]、上下文编译器、模型客户端就绪）

## 3. 执行方案（可拆为 3 个子任务派发）

| # | 子任务 | 交付物 | 预估 |
|---|---|---|---|
| 5.1 | 划词交互层 | selection.ts 浮层、选区→术语提取、content↔panel 消息 | 1d |
| 5.2 | 上下文选段 + 两个 pipeline | compiler 扩展、explain.ts、Schema、prompt/SKILL 双维护 | 1.5d |
| 5.3 | 问答 Tab UI | 对话流、区间选择器、流式渲染、时间戳跳播、自动暂停 | 1.5d |

## 4. 验收标准（父 agent 逐条执行）

- [ ] A1 单测：上下文编译器——构造 12000 字字幕视频，任一提问的实际上下文 ≤ 4000 token，**断言不含全量字幕**（红线 3，日志埋点验证）
- [ ] A2 单测：TermSchema/SegmentAnswerSchema 校验失败重试；区间信息不足时输出显式声明"视频中未涉及"
- [ ] A3 联调：真实视频中划词（选 5 个技术术语），浮层出现位置正确、不遮挡播放器，释义区分"视频语境含义"与"通用定义"两段
- [ ] A4 联调：区间问答（选 02:10–03:40 类区间提问），回答引用时间戳可点击跳播，误差 ≤ 2s
- [ ] A5 性能：划词解释首字 ≤ 1.5s（模型流式 + 埋点验证）
- [ ] A6 提问时视频自动暂停；设置关闭后不暂停
- [ ] A7 prompts/ 与 .agents/skills/ 一致（diff 校验）
- [ ] A7b **qaHistory 可聚合性锁死**（为 v0.1.x 薄弱章节标记零迁移预留）：每条记录必须含 `videoId / timestampMs / 命中章节 id / 交互类型(划词|区间|自由问)`；单测断言：任一章节的提问次数可由 qaHistory 直接 group-by 得出，无需回放或二次解析
- [ ] A8 G1/G2/G3 门禁全过；执行记录已追加

## 5. 风险与回滚

- 风险：B 站页面选区事件与播放器手势冲突 → 只监听字幕区域选区，浮层 pointer-events 受控
- 风险：流式输出在 service worker 中断流 → panel 端直接 fetch（不经 background 中转流）
- 回滚：explain pipeline 独立，可整体禁用回退纯大纲模式

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 |
|---|---|---|---|
| — | — | — | — |
