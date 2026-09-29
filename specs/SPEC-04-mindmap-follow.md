# SPEC-04 · 思维导图与播放跟随

- 状态：待开工
- 依赖：SPEC-03（可与 SPEC-05 并行）
- 对应里程碑：M4
- 执行者：（派发时填写）

## 1. 目标与范围

**做**：
- `panel/MindmapTab.tsx`：markmap 渲染大纲 Markdown（Section → 两级树）
- 节点交互：点击携带 startMs 的节点 → 回调 content script 跳播
- 播放跟随：content script 监听 `video.timeupdate`（节流 500ms）→ background 二分查找当前 Section → panel 高亮 + `scrollIntoView({block:'nearest'})` + 导图节点聚焦
- 双向同步：大纲 Tab 与导图 Tab 共享当前章节状态

**不做**：导图编辑、导出 XMind（v0.2 候选）、多分 P 视频导图（跟随主 P）。

## 2. 前置条件

- SPEC-03 已验收（有稳定 Section[] 与跳播回调链路）

## 3. 执行方案（可拆为 2 个子任务派发）

| # | 子任务 | 交付物 | 预估 |
|---|---|---|---|
| 4.1 | markmap 渲染与跳播 | MindmapTab、Markdown 组装（章节→节点）、onClick 跳播 | 1d |
| 4.2 | 播放跟随同步 | timeupdate 节流监听、二分查找、双 Tab 高亮同步 | 1d |

## 4. 验收标准（父 agent 逐条执行）

- [ ] A1 联调：播放视频，当前章节在大纲 Tab 高亮且自动滚动；导图对应节点同步聚焦，**高亮延迟 ≤ 500ms**（人工秒表 + performance.mark 埋点双重验证）
- [ ] A2 联调：点击导图任意节点，视频跳转到对应时间，误差 ≤ 2s
- [ ] A3 联调：快进跨章节（拖进度条跳跃 3+ 章节），高亮目标章节正确无闪烁抖动
- [ ] A4 性能：长视频（100+ 章节候选）导图初次渲染 ≤ 1s，播放中无可感知卡顿（React Profiler 验证无长任务）
- [ ] A5 B 站 SPA 切换视频后，导图随新 videoId 重建，无残留旧数据
- [ ] A6 G1/G2/G3 门禁全过；执行记录已追加

## 5. 风险与回滚

- 风险：markmap 全量重渲染性能 → 数据驱动 diff，仅更新变更节点
- 风险：timeupdate 与 SPA 路由竞争 → 监听器绑定与解绑配对（MutationObserver 管理 video 生命周期）
- 回滚：MindmapTab 独立 Tab，可隐藏入口回退纯大纲模式

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 |
|---|---|---|---|
| — | — | — | — |
