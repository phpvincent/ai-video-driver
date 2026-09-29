# SPEC-01 · 工程骨架与 B 站识别

- 状态：待开工
- 依赖：无
- 对应里程碑：M1
- 执行者：（派发时填写）

## 1. 目标与范围

**做**：
- 初始化 monorepo 工程：Vite + TypeScript + React，Chrome MV3 扩展可构建产物
- manifest.json（权限按 TECH-DESIGN §9，host_permissions 含 B站/DeepSeek/Obsidian 本地端口）
- Side Panel 空壳（React 挂载，三 Tab 占位：大纲/导图/问答）
- content script：B 站视频页识别（bvid 提取、SPA URL 变化监听、video 元素挂载监听）
- background service worker：消息路由骨架（content ↔ panel 通信打通）
- 设置页占位（modelConfig 表单，暂不持久化调用逻辑）

**不做**：任何网络请求、任何模型调用、字幕抓取（属 SPEC-02/03）。

## 2. 前置条件

- Node ≥ 20（已有），Chrome 开发者模式可用
- 用户三个开放问题的答复不阻塞本 spec（骨架与它们无关）

## 3. 执行方案（可拆为 3 个子任务派发）

| # | 子任务 | 交付物 | 预估 |
|---|---|---|---|
| 1.1 | 工程初始化 | package.json / vite.config / tsconfig / 目录结构（严格按 TECH-DESIGN §9） | 0.5d |
| 1.2 | manifest + background | manifest.json、background/index.ts 消息路由、sidePanel 权限联动 | 0.5d |
| 1.3 | content script + Panel 壳 | bilibili.ts（bvid/URL/video 监听）、panel 三 Tab 占位、设置页表单壳 | 1d |

## 4. 验收标准（父 agent 逐条执行）

- [ ] A1 `npm run build` 零错误零警告，产出 `dist/` 可直接"加载已解压的扩展程序"
- [ ] A2 `npm test` 通过（至少含 bvid 提取的单元测试：标准 URL / 带 query / SPA 路由切换三种）
- [ ] A3 打开任意 B 站视频页，Side Panel 自动打开且显示当前 bvid；切到非视频页不打开
- [ ] A4 视频页内 SPA 跳转（推荐流切视频）后，panel 内 bvid **无刷新更新**
- [ ] A5 G3 红线检查：manifest 无多余权限、无硬编码 key/URL 之外的 secret
- [ ] A6 执行记录已按规范追加

## 5. 风险与回滚

- 风险：MV3 service worker 生命周期导致消息丢失 → 用 chrome.storage 做状态中转
- 回滚：纯新增工程，git revert 即可

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 |
|---|---|---|---|
| — | — | — | — |
