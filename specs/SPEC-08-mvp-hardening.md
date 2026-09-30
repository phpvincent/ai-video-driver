# SPEC-08 · MVP 收口与真机验证

- 状态：待开工（2026-10-01 用户确认范围）
- 依赖：SPEC-06（代码已落地，验收在本 spec 8.7 补齐）
- 对应里程碑：M7 前置——**SPEC-07 的真实使用必须在本 spec 验收后开始**
- 验收 tag：`spec-08-accepted`

> 来源：`reviews/REVIEW-2026-10-01.md` §4。目标不是加功能，而是让 SPEC-07 的 10 个视频验证**测到这种学习方式本身的价值**，而不是测到一堆断点。

## 0. 范围变更记录（append-only）

| 日期 | 变更 | 依据 |
|---|---|---|
| 10-01 | **删除"登录态字幕下沉 content"**：用户在已登录 Chrome 实测 `BV15yxMeKELY_p1`，字幕来源显示「AI 字幕 ai-zh」——AI 字幕需登录才能拿到，说明扩展页请求已带上 SESSDATA，首轮 P0-1 判断不成立；该项降为冒烟检查 | 用户截图 |
| 10-01 | **新增 AI 字幕顺句**（原 EVOLUTION-ROADMAP ★★，触发条件"学习视频主要依赖 AI 字幕"已满足） | 用户确认"加" |
| 10-01 | 多轮记忆默认 **5 轮** | 用户确认 |
| 10-01 | **新增 SPEC-07 缺口补齐**（回顾问卷入库、视频结束检测、存库/token 统计），见 8.8 | 用户询问 SPEC-07 完成度 |

## 1. 目标与范围

**做**：

| # | 项 | 说明 |
|---|---|---|
| 8.1 | 登录态字幕冒烟 | 只验证，不改代码 |
| 8.2 | 笔记回链 | content 上报 `url` / `cid` / `page`；`playbackUrl()` 在 url 为空时按 `bvid + p + t` 拼接 |
| 8.3 | 自定义端点动态权限 | `optional_host_permissions`；设置页保存时按 baseUrl origin 调 `permissions.request` |
| 8.4 | 问答时间戳可跳 + 多轮记忆 | `<ChatTab>` 接入 `cues`；最近 5 轮问答摘要进上下文 |
| 8.5 | AI 字幕顺句 | 仅对 `bili_ai` 来源、按需触发：模型只加标点和改同音错字，**不改时间戳、不合并/拆分 Cue** |
| 8.6 | 真机冒烟清单 | `tests/fixtures/smoke-checklist.md`，8 条主路径 |
| 8.7 | 治理补课 | SPEC-03~06 逐条对照验收、补执行记录、打 tag；宪法 §9 索引更新 |
| 8.8 | SPEC-07 缺口补齐 | 回顾问卷入库、视频结束触发问卷、存库次数与 token 进统计、抽帧开/关对照观察项 |

**不做**：
- 流式输出 → 单独立 spec（EVOLUTION-ROADMAP ★★★）
- 大纲笔记与导入导出 → SPEC-09
- 浏览器移植 → EVOLUTION-ROADMAP；本 spec 只遵守宪法新增的"可移植性"条款（§6 红线 11）
- 抽帧策略调整 → 等 SPEC-07 对照数据

## 2. 前置条件

- 已登录 B 站的 Chrome；测试视频三类：UP 主 CC 字幕 / 仅 AI 字幕（如 `BV15yxMeKELY_p1`）/ 无字幕
- Obsidian Local REST API 插件已开启
- 一个非预置域名的 OpenAI 兼容端点（验证 8.3，可用任意第三方网关）

## 3. 执行方案

执行顺序：8.2 → 8.4 → 8.3 → 8.5 → 8.8 → 8.6 → 8.7（先修影响学习体验的，最后补流程）。

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 8.2 | 视频元信息补全与回链 | content 上报 url/cid/page；`playbackUrl` 兜底；App 去掉 `cid: 0, url: ''` | `src/content/bilibili.ts`、`src/messages.ts`（父）、`src/core/pipeline/capture.ts`、`src/panel/App.tsx` | 0.5d |
| 8.4a | 问答时间戳可跳 | `<ChatTab cues>` 接线 | `src/panel/App.tsx`、`src/panel/ChatTab.tsx` | 0.1d |
| 8.4b | 多轮记忆 | `compiler` 新增"对话摘要"段；ChatTab 维护最近 5 轮；换视频清空 | `src/core/context/`、`src/panel/ChatTab.tsx`、`src/panel/explainLoader.ts`、`src/config/`（父） | 0.5d |
| 8.3 | 动态宿主权限 | manifest `optional_host_permissions`；`ensureHostPermission(origin)`；设置页保存流程 | `manifest.json`（父）、`src/panel/settings/`、`src/platform/`（新） | 0.5d |
| 8.5 | AI 字幕顺句 | `src/prompts/subtitle-punctuate.md`；`core/subtitle/punctuate.ts`（分块 + 按 Cue 序号对齐 + 校验）；字幕 Tab「整理字幕」按钮；结果按 `videoId + 来源 + promptVersion` 缓存 | `src/core/subtitle/`、`src/prompts/`、`src/panel/SubtitleTab.tsx`、`src/panel/subtitleLoader.ts` | 1d |
| 8.8 | SPEC-07 缺口 | 问卷入库（usage store 追加字段，不升 DB 版本）；content 上报 `ended`；看完触发一题回顾（可跳过）；统计存库次数、token 用量；报告追加"抽帧开/关"观察段 | `src/core/metrics/`、`src/panel/ValidationReportView.tsx`、`src/panel/App.tsx`、`src/content/player.ts` | 0.5d |
| 8.6 | 真机冒烟 | 冒烟清单 + 首轮结果 | `tests/fixtures/` | 0.5d |
| 8.7 | 治理补课 | SPEC-03~06 执行记录与 tag；宪法 §9 索引 | `specs/`、`CONSTITUTION.md`、`ITERATION-LOG.md` | 0.5d |

每个子任务验收通过即 commit：`<type>(spec-08): <摘要>`。

### 关键设计约束

- **8.4b 多轮记忆**：每轮摘要 = 问题原文（≤80 字）+ 回答 keyPoints 前 3 条（每条 ≤40 字），不拼完整回答；总长受 `CONTEXT` 预算约束，**裁剪优先级低于命中区间字幕**（先裁对话、后裁字幕）；术语解释不进记忆；红线 3 的"上轮摘要"条款正是为此预留。
- **8.5 顺句**：模型输入/输出都是 `[{i, text}]`，按 `i` 对齐回原 Cue，**数量、顺序、时间戳必须与输入完全一致**，否则整块丢弃、保留原文（红线 5：禁止丢时间戳）；只允许加标点、改同音字，单句改动字数超过原文 30% 视为越权改写，丢弃该句。
- **8.3 权限**：只在用户保存自定义端点时申请，精确到 origin，**不预授权 `https://*/*`**；平台调用封装在 `src/platform/`（红线 11）。

## 4. 验收标准

- [ ] A1 [人工] 已登录状态下，CC 字幕视频显示「UP 主字幕」，仅 AI 字幕视频显示「AI 字幕」，均不落到手动粘贴
- [ ] A2 [自动] `playbackUrl` 单测：url 为空时拼出 `https://www.bilibili.com/video/{bvid}?p={p}&t={sec}`；分 P 与秒数正确
- [ ] A3 [人工] 存入 Obsidian 的视频笔记与术语卡中，任一时间戳点击后跳到原视频对应位置；frontmatter `url` 非空
- [ ] A4 [人工] 设置一个非预置域名端点，保存时弹出权限申请；同意后能生成大纲；拒绝时设置页给出明确提示且不保存
- [ ] A5 [自动] 问答回答的 `referencedTimestamps` 吸附到真实 Cue 并渲染为可点击按钮
- [ ] A6 [自动] 多轮记忆：第 2 轮上下文含第 1 轮摘要；第 7 轮只含最近 5 轮；换视频后为空；预算不足时先裁对话摘要
- [ ] A7 [自动] 顺句：输出 Cue 数量、顺序、startMs/endMs 与输入逐一相等；模型漏句/多句/越权改写时该块回落原文
- [ ] A8 [人工] `BV15yxMeKELY_p1` 点「整理字幕」后出现标点，时间戳不变，划词命中率肉眼改善
- [ ] A9 [自动] 问卷入库后重开面板仍在；报告的回顾问卷项读取入库数据；存库次数与 token 进入统计
- [ ] A10 [人工] 视频播放到结尾时弹出一题回顾，可跳过
- [ ] A11 [人工] 冒烟清单 8 条主路径全部通过，结果附执行记录
- [ ] A12 [自动] `spec-03` ~ `spec-06`、`spec-08` 的 accepted tag 存在；宪法 §9 索引状态与 tag 一致
- [ ] A13 [自动] `src/platform/` 之外新增代码不出现 `chrome.permissions`（红线 11 首次落地）
- [ ] A14 [自动] G1/G2/G3 门禁全过；执行记录已追加

## 5. 风险与回滚

- 顺句模型改写原意 → 按句校验改动比例，越权即丢弃；原文永远保留，可一键切回
- 顺句成本（42 分钟视频约 800 句）→ 用户手动触发、按块并发、结果缓存；不自动执行
- 多轮记忆挤占字幕预算 → 摘要限长、裁剪优先级最低
- 回滚：按子任务 commit 逐个 `git revert`

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| 10-01 | 父 agent | 起草并按用户反馈修订范围（删 P0-1 修复、加顺句、5 轮记忆、补 SPEC-07 缺口） | — | 本提交 |
