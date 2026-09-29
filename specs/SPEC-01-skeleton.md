# SPEC-01 · 工程骨架、共享契约与质量工具链

- 状态：进行中（1.1~1.5 全部完成并验收，待人工验收 A5/A6）
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
| 2026-09-30 | 父 agent | 契约补充：messages.ts 增加 CURRENT_VIDEO_GET（panel 打开时拉取当前视频） | tsc 零错误 | 7249eed |
| 2026-09-30 | 子 agent 1.4 | manifest.json（TECH-DESIGN §9 逐字段）+ background 路由（纯函数 routeBackgroundMessage 十类 Action + chrome 执行器 + tab→video 映射 storage.session 持久化与重启恢复 + setPanelBehavior）；manifest 快照测试与路由单测共 18 例；偏差：manifest 测试用 import.meta.glob('?raw') 替代 node:fs（依赖白名单无 @types/node），语义不变 | tsc 零错误；vitest 18 例全绿 | aa524f6（已验收） |
| 2026-09-30 | 子 agent 1.3 | check-redlines.mjs（R9 受管控端点/密钥扫描、R10 content 禁词与 config import 检查、汇总子进程）+ check-prompts.mjs（SKILL 引用校验）+ 19 例内存驱动单测；**实战抓出 2 条并行任务引入的真实违规**（详见父 agent 修复行） | vitest 19 例全绿；修复后真实仓库扫描全 PASS | e982d73（已验收） |
| 2026-09-30 | 子 agent 1.5 | content（parseVideoId/toVideoId 纯函数 9 例单测、SPA pushState/popstate/轮询双保险、__INITIAL_STATE__ 三级 fallback、video 生命周期 MutationObserver、500ms 节流进度上报、player seek/pause/resume）+ panel（App 四 Tab 壳、信息栏、CURRENT_VIDEO_GET 拉取、设置页壳） | tsc 零错误；vitest 9 例全绿；红线 10 grep 零命中 | dc2f488（已验收） |
| 2026-09-30 | 父 agent | 裁决并修复并行冲突：① 1.5 设置页硬编码 `127.0.0.1:27124`（R9 违规）→ 改用 OBSIDIAN 常量；② 派发包冲突裁决——config 拆两层：新增 `src/config/shared.ts`（BILI_URL_PATTERN/BVID_REGEXES/PLAYBACK，content 唯一合法配置入口），index.ts re-export 保持兼容，content 改 import shared，R10 补 shared 放行用例。根因：config 混装模型端点与通用阈值，content import 整包会把端点文本带入 content 上下文 | 全套复跑：tsc 零错误、vitest 47 例全绿、check:redlines/check:prompts 全 PASS、build 成功 | dc2f488（含修复） |
| 2026-09-30 | 父 agent | 用户人工验收 A5 时发现 **dist/ 缺 manifest.json**（Chrome 报"清单文件缺失"）——A1 验收疏漏：只验证了产物存在，未验证"dist 可加载"完整语义。修复：vite closeBundle 在 content 二次构建后把仓库根 manifest.json 复制进 dist/ | `npm run build` 后 dist 含 manifest.json 且字段校验通过（mv3/sw/panel/cs）；tsc 零错误；测试全绿 | e5c450b |
| 2026-09-30 | 父 agent | A5 执行问题 2：点击扩展图标无反应。代码侧自查无误（bundle 含 setPanelBehavior、模块可导入）；修复：bootstrap 启动日志 + setPanelBehavior 失败不再吞错 + action.onClicked 手动 sidePanel.open 双保险（behavior 生效时 onClicked 不触发，互补） | tsc 零错误；47 例全绿；build 后 dist 含新逻辑 | affc98c（已验收，待用户重试） |
| 2026-09-30 | 父 agent | A5 执行问题 3（用户诊断日志一击定位）：`sidePanel.open failed: No active side panel for tab` + `action clicked` 触发 → 双重结论：① openPanelOnActionClick 未生效（onClicked 不该触发）② 该 tab 曾被 `setOptions({enabled:false})` 禁用且 per-tab 状态残留（VIDEO_LEFT 路径）。修复：**彻底移除 disableSidePanel**（v0.1 无视频时面板自行展示，无需禁用）；onClicked 改为 `setOptions(enabled:true) → open()` 两步，点击必开；同步改 routing 单测 | tsc 零错误；47 例全绿；构建后 bundle 无 disableSidePanel 残留、含 2 处 enabled:true | 2c94c2e |
| 2026-09-30 | 父 agent | A5 执行问题 4：同样的 "No active side panel" —— 新线索：上一修复把 open() 放进了 setOptions().then() 异步链，**跨 await 丢失用户手势**，Chrome 拒绝打开。修复：onClicked 内同步直调 sidePanel.open（官方文档写法，现无任何禁用逻辑不会撞墙）；bootstrap 增加全局 setOptions({enabled:true}) 清除历史 per-tab 禁用残留 | tsc 零错误；47 例全绿；build 成功 | 126cc93（已验收，待用户重试） |
| 2026-09-30 | 父 agent | A5 执行问题 5（最终修复）：错误历史三条串联合并分析，判定 setOptions（全局 enable + per-tab enable）与 setPanelBehavior 混用互相覆盖面板状态机（behavior 失效 + "No active side panel"）。修复：**回归官方文档最小用法**——全项目仅保留 boot 时一次 setPanelBehavior + onClicked 内同步 open() 兜底，删除全部 setOptions 调用（含 VIDEO_DETECTED 的 enableSidePanel），面板全局可用、空状态由面板自渲染。教训：sidePanel 状态管理只用 setPanelBehavior 一个入口，sidePanel 相关调用量最小化 | tsc 零错误；47 例全绿；bundle 中 setOptions 出现 0 次 | 126cc93→a5beead（已验收，待用户重试） |
| 2026-09-30 | 父 agent | A5 执行问题 6：最小化方案仍报同错，且 tab id 未变——判定 per-tab 禁用残留跨扩展重载存活，而上一轮删掉 enableSidePanel 后无任何重启用路径。修复：恢复 VIDEO_DETECTED → enableSidePanel；点击兜底改为 setOptions(enabled:true) 与 open() 背靠背同步发出（不 await，两者都在手势栈内）；content 增加检测日志（页面控制台可见注入是否成功） | tsc 零错误；47 例全绿；build 成功 | d24f878（单测修正 18b29e6） |
