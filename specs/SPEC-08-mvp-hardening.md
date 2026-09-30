# SPEC-08 · MVP 收口与真机验证

- 状态：待开工（草案，待用户确认后开工）
- 依赖：SPEC-06（代码已落地，验收待补）
- 对应里程碑：M7 前置（SPEC-07 真实使用开始之前必须完成）
- 验收 tag：`spec-08-accepted`

> 来源：`reviews/REVIEW-2026-10-01.md`。这不是新功能 spec：目标是让 SPEC-07 的 10 个视频验证**测得到真实的模式价值**，而不是测到一堆断点。

## 1. 目标与范围

**做**：
- **P0-1 登录态字幕**：真机确认扩展页跨站请求是否带 SESSDATA；若不带，把 B 站三级请求（view → player/wbi → 字幕 JSON）下沉到 content script，经 `MSG` 回传结果（content 仍不得接触模型配置，红线 10 不变）
- **P0-2 笔记回链**：content 上报 `url` / `cid` / `page`；`playbackUrl()` 在 url 缺失时按 bvid + p + t 拼接；Obsidian 笔记与术语卡的时间戳可点
- **P0-3 自定义端点**：`optional_host_permissions`；设置页保存时按 baseUrl 调 `chrome.permissions.request`，被拒时给出明确提示
- **P1-1 问答时间戳可跳**：`<ChatTab>` 接入 `cues`
- **P1-4 问答多轮记忆**：最近 N 轮（默认 4）Q/A 摘要进入上下文，受现有预算约束；换视频时清空
- **治理补课**：SPEC-03~06 逐一对照验收标准补验收记录并打 tag；宪法 §索引状态更新
- **真机冒烟清单**：`tests/fixtures/smoke-checklist.md`，覆盖字幕 / 大纲 / 导图 / 问答 / 上传图片 / 抽帧 / Obsidian / LLM 日志八条主路径
- **SPEC-07 追加观察项**：抽帧开/关对照（不参与判定）

**不做**：
- 流式输出（P1-5）→ 单独立 spec，改动面大
- 薄弱章节标记、错题本、YouTube → EVOLUTION-ROADMAP，SPEC-07 判定"继续"后再排
- 任何新的抽帧策略调整 → 等 SPEC-07 对照数据

## 2. 前置条件

- 用户提供：已登录 B 站的 Chrome；1 个有 CC 字幕、1 个仅 AI 字幕、1 个无字幕的测试视频
- Obsidian Local REST API 插件已开启

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 8.1 | 登录态实测 + 必要时下沉 content | 实测记录；`content/subtitleFetch.ts`；消息协议增量 | `src/content/`、`src/providers/`、`src/panel/subtitleLoader.ts`、`src/messages.ts`（父 agent） | 0.5~1d |
| 8.2 | 视频元信息补全与回链 | url/cid/page 上报；`playbackUrl` 兜底 | `src/content/bilibili.ts`、`src/core/pipeline/capture.ts`、`src/panel/App.tsx` | 0.5d |
| 8.3 | 动态宿主权限 | manifest + 设置页申请流程 | `manifest.json`、`src/panel/settings/` | 0.5d |
| 8.4 | 问答时间戳 + 多轮记忆 | cues 接线；`compiler` 增加对话摘要段 | `src/panel/`、`src/core/context/` | 0.5d |
| 8.5 | 治理补课 | SPEC-03~06 执行记录与 tag；宪法索引 | `specs/`、`CONSTITUTION.md`、`ITERATION-LOG.md` | 0.5d |
| 8.6 | 真机冒烟 | 冒烟清单 + 首轮结果 | `tests/fixtures/` | 0.5d |

每个子任务验收通过即 commit：`<type>(spec-08): <摘要>`。

## 4. 验收标准

- [ ] A1 [人工] 已登录状态下打开有 CC 字幕的视频，字幕来源显示为一级通道（非手动粘贴）
- [ ] A2 [自动] `playbackUrl` 单测：url 为空时按 bvid/p/t 拼出可访问链接
- [ ] A3 [人工] 存入 Obsidian 的笔记中，任一时间戳点击后跳转到原视频对应位置
- [ ] A4 [人工] 设置一个非预置域名的 OpenAI 兼容端点，保存时弹出权限申请，同意后可正常生成大纲
- [ ] A5 [自动] 问答回答中的 `referencedTimestamps` 渲染为可点击按钮（单测断言吸附结果非空）
- [ ] A6 [自动] 多轮记忆：第 2 轮请求的上下文包含第 1 轮问答摘要；换视频后不包含；超预算时最早轮次先被裁掉
- [ ] A7 [人工] 冒烟清单八条主路径全部通过，结果附在执行记录
- [ ] A8 [自动] `spec-03` ~ `spec-06` 与 `spec-08` 的 accepted tag 存在；宪法索引状态与 tag 一致
- [ ] A9 [自动] G1/G2/G3 门禁全过；执行记录已追加

## 5. 风险与回滚

- 字幕下沉 content 后，content 体积与职责变大 → 只搬网络请求，解析仍在 `core/subtitle`；R10 扫描范围不变
- `https://*/*` 可选权限在商店审核中会被追问 → 仅在用户保存自定义端点时申请，不预授权
- 多轮记忆挤占字幕预算 → 摘要限长，并在预算裁剪中排在字幕之后
- 回滚：按子任务 commit 逐个 `git revert`，或回到 `spec-06-accepted`

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| — | — | — | — | — |
