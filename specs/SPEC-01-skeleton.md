# SPEC-01 · 工程骨架、共享契约与质量工具链

- 状态：进行中（1.2 已完成，1.1 已派发）
- 依赖：无
- 对应里程碑：M1
- 验收 tag：`spec-01-accepted`

## 1. 目标与范围

**做**：
- 工程初始化：Vite + TypeScript + React + vitest，产出可加载的 Chrome MV3 扩展（`dist/`）
- `manifest.json`：权限严格按 TECH-DESIGN §9，不含 YouTube 等 v0.1 范围外的域名
- **共享契约**（此后仅父 agent 可改）：
  - `src/types.ts`：TECH-DESIGN §4 全部类型（Cue / FetchResult / Section / Density / QaRecord / TermCard / ModelConfig / PipelineTrace）
  - `src/messages.ts`：content ↔ background ↔ panel 消息协议（videoId 变化、播放进度、跳播、暂停、侧边栏状态）
  - `src/config/`：接口端点、默认模型配置、阈值（切片 1800/200、吸附 5s、密度阈值、预算 200k、估算 4 字/秒）
- **质量工具链**：
  - `npm run check:redlines`：红线 9、10 的 grep 规则 + 汇总执行 `check:prompts` 与红线对应单测
  - `npm run check:prompts`：SKILL.md 引用的 `src/prompts/*.md` 存在、关键规则词出现（本期 prompt 目录为空，脚本需能在空目录下通过）
- content script：B 站视频页识别 videoId（`{bvid}_p{page}`）、SPA URL 变化监听、`<video>` 挂载监听，变化时上报
- background：tab → videoId 映射、消息转发、在 B 站视频页为该 tab 启用侧边栏（`chrome.sidePanel.setOptions`），用户点击工具栏图标打开
- 侧边栏：React 挂载，四 Tab 占位（字幕 / 大纲 / 导图 / 问答），顶部显示当前 videoId 与分 P 标题
- 设置页占位：ModelConfig 表单（本期不接入调用）

**不做**：任何字幕请求、模型调用、IndexedDB（属 SPEC-02 起）。

## 2. 前置条件

- Node ≥ 20；Chrome 开发者模式
- 仓库已关联 `git@github.com:phpvincent/ai-video-driver.git`（2026-09-30 完成）

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 1.1 | 工程初始化 | package.json、vite/ts/vitest 配置、目录骨架（TECH-DESIGN §9） | 仓库根配置文件、`src/` 空目录、`tests/unit/` | 0.5d |
| 1.2 | 共享契约 | types.ts、messages.ts、config/ | `src/types.ts`、`src/messages.ts`、`src/config/` | 0.5d |
| 1.3 | 质量工具链 | check-redlines.mjs、check-prompts.mjs 及其自测 | `scripts/`、`tests/unit/scripts/` | 0.5d |
| 1.4 | manifest + background | manifest.json、background/index.ts | `manifest.json`、`src/background/` | 0.5d |
| 1.5 | content script + 侧边栏壳 | content/bilibili.ts、panel 四 Tab、设置页壳 | `src/content/`、`src/panel/` | 1d |

1.2 由父 agent 亲自完成（共享契约归属父 agent），其余子任务可派发。

## 4. 验收标准

- [ ] A1 [自动] `npm run build` 零错误，`dist/` 结构可被 Chrome"加载已解压的扩展程序"
- [ ] A2 [自动] `npm test` 通过；videoId 解析单测覆盖：标准 URL、带 query、带 `?p=3`、无 p 参数默认 1、`/video/BV…/` 尾斜杠、非视频页返回 null
- [ ] A3 [自动] `npm run check:redlines` 通过；并构造两个违规样例（`src/content/` 引用 apiKey、`src/core/` 出现接口 URL）验证脚本能报错
- [ ] A4 [自动] manifest 权限与 TECH-DESIGN §9 完全一致（脚本比对）
- [ ] A5 [人工] 打开测试课程 P2，点击工具栏图标打开侧边栏，显示 `BV1YG7G6eEPR_p2` 与分 P 标题；打开非视频页时工具栏图标不启用侧边栏
- [ ] A6 [人工] 在侧边栏打开状态下，通过播放器分 P 列表从 P2 切到 P3，侧边栏 videoId **无刷新**变为 `_p3`
- [ ] A7 [自动] G1/G2/G3 门禁全过；执行记录已追加；打 tag `spec-01-accepted`

## 5. 风险与回滚

- MV3 Service Worker 被回收导致 tab 状态丢失 → 映射同步写入 `chrome.storage.session`，SW 重启后恢复
- B 站分 P 切换可能不触发整页导航 → 同时监听 URL 变化与 `<video>` 元素替换
- 回滚：新增工程，回退对应 commit

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| 2026-09-30 | 父 agent | 子任务 1.2 共享契约完成：`src/types.ts`（TECH-DESIGN §4 全量类型）、`src/messages.ts`（10 类消息）、`src/config/index.ts`（端点与阈值） | 编译随 1.1 构建验证 | 5ecc048 |
| 2026-09-30 | 子 agent 1.1 | 工程初始化：package.json / tsconfig / vitest / vite 三入口配置（background ES + panel HTML/ES，content IIFE 经 closeBundle 二次构建）、panel.html 与 background/content/panel 占位入口、check 双脚本占位 | `npm run build` 零错误，dist 含 background.js / content.js / panel.html / panel.js；`npm test` 与双 check exit 0；`tsc --noEmit` 零错误 | 904a548（父 agent 复跑 G1/G3 通过，已验收） |
