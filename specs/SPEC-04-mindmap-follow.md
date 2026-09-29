# SPEC-04 · 思维导图与播放跟随

- 状态：待人工验收（施工完成）
- 依赖：SPEC-03（可与 SPEC-05 并行）
- 对应里程碑：M4
- 验收 tag：`spec-04-accepted`

## 1. 目标与范围

**做**：
- `panel/MindmapTab.tsx`：Section[] 组装为两级 Markdown（标题 + 要点），markmap 渲染，可缩放折叠
- 节点点击跳播（通过 messages.ts 协议发给 content script）
- 统一播放跟随：侧边栏维护"当前播放位置"单一状态，字幕 Tab、大纲 Tab、导图 Tab 共享；二分查找当前 Cue 与 Section
- 导图中高密度章节节点带醒目标记
- videoId 变化（切 P）时导图按当前分 P 重建

**不做**：导图编辑；导出 XMind / HTML（v0.1.x，见 EVOLUTION-ROADMAP §2）。

## 2. 前置条件

- SPEC-03 已验收

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 4.1 | 导图渲染与跳播 | Markdown 组装（纯函数 + 单测）、MindmapTab、节点跳播 | `src/panel/MindmapTab.tsx`、`src/panel/mindmap/`、单测 | 1d |
| 4.2 | 统一播放跟随 | 播放位置状态、二分查找（纯函数 + 单测）、三 Tab 同步高亮 | `src/panel/state/`、`src/panel/*Tab.tsx` 中的跟随逻辑 | 1d |

并行约束：SPEC-05 同时修改 `src/panel/ChatTab.tsx`；本 spec 不得修改 ChatTab 与 `src/core/pipeline/explain.ts`。

## 4. 验收标准

- [ ] A1 [自动] Markdown 组装单测：章节顺序、时间前缀、密度标记、空 bullets 处理
- [ ] A2 [自动] 二分查找单测：边界（第一句前、最后一句后、恰好落在 startMs 上）、跨多章跳跃
- [ ] A3 [半自动] 用录制的 P2 大纲数据渲染导图，节点数与章节数一致，点击节点发出正确的跳播消息
- [ ] A4 [人工] 播放 P2：字幕句、大纲章节、导图节点同步高亮，延迟 ≤ 500ms（肉眼观察 + performance.mark 日志）
- [ ] A5 [人工] 拖动进度条一次跨越 3 个以上章节，三处高亮直接落到目标位置，无闪烁
- [ ] A6 [人工] P4（66:45）导图首次渲染 ≤ 1s，播放过程中侧边栏无明显卡顿
- [ ] A7 [人工] 从 P2 切到 P3，导图随之重建，无 P2 残留
- [ ] A8 [自动] G1/G2/G3 门禁全过；执行记录已追加；打 tag `spec-04-accepted`

## 5. 风险与回滚

- markmap 全量重渲染开销 → 高亮通过节点样式更新实现，不重建树
- 跟随状态分散导致三处不一致 → 单一播放位置状态，Tab 只订阅
- 回滚：导图 Tab 可隐藏入口，退回大纲模式

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
| 2026-09-30 | 子 agent 全量 | MindmapTab：buildMindmapMarkdown（## mm:ss 标题（score分）→ ### mm:ss 要点）、parseNodeTimestamp（累计分钟/00:00 合法）、svg 点击委托跳播（折叠点忽略）、findActiveSectionIndex 二分跟随高亮 + 防抖滚动、markmap 动态 import（空大纲引导不加载引擎）+ 19 例 | tsc 零错误；19 例全绿 | 98b8859（已验收） |
| 2026-09-30 | 父 agent | App 接线：sections 状态上提（OutlineTab onSectionsChanged → 导图/问答共享）、onGoOutline 跳转；npm run verify 直连验收（414 例全绿 + 红线 + build） | ✅ A1~A4 自动/半自动项具备验收条件；A1/A2/A3/A5 待用户人工验收 | 0890644 |

|---|---|---|---|---|
| — | — | — | — | — |
