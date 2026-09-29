# SPEC-06 · Obsidian 知识沉淀

- 状态：待开工
- 依赖：SPEC-04、SPEC-05
- 对应里程碑：M6
- 验收 tag：`spec-06-accepted`

## 1. 目标与范围

**做**：
- `sinks/obsidian.ts`：Local REST API 写入（`PUT /vault/{path}`，Bearer 鉴权，HTTP 27124，路径逐段 URL 编码）
- 设置页：Obsidian 地址、API Key、笔记根目录；**连通性自检**区分"Obsidian 未启动 / 未开启 HTTP 模式 / API Key 错误 / 目录不可写"并给出对应操作指引
- 视频笔记：一键存库，frontmatter 由代码按 TECH-DESIGN §4.7 组装，正文含大纲与本视频问答摘录
- 术语卡：扁平存放于 `术语/`，`type: term-card`，正文含出处与跳播链接
- 跳播链接：`https://www.bilibili.com/video/{bvid}/?p={page}&t={秒}`（TECH-DESIGN §7.2）
- `core/pipeline/capture.ts`：知识捕获与重复度评分；重复度 > 0.8 时提示合并
- `src/prompts/knowledge-capture.md` + `.agents/skills/knowledge-capture/SKILL.md`（仅引用）

**不做**：自动写入（一律用户确认）；术语卡目录分类；Anki 导出；跨视频检索。

## 2. 前置条件

- SPEC-04、SPEC-05 已验收
- 用户已安装 Obsidian Local REST API 插件并开启 HTTP 模式

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 6.1 | sink 与自检 | obsidian.ts、连通性自检、错误分类、单测 | `src/sinks/`、`src/panel/settings/`、单测 | 1d |
| 6.2 | 笔记与术语卡 | frontmatter 组装、正文模板、跳播链接（纯函数 + 单测） | `src/core/pipeline/capture.ts`、`src/core/note/`、单测 | 1d |
| 6.3 | 去重与存库交互 | 重复度评分、合并确认 UI、prompt 与 skill | `src/prompts/`、`.agents/skills/knowledge-capture/`、`src/panel/` 存库按钮 | 1d |

## 4. 验收标准

- [ ] A1 [自动] frontmatter 单测：字段齐全，YAML 可被解析回读，`video_id` / `url` 含分 P
- [ ] A2 [自动] 跳播链接单测：`startMs` → `?p={page}&t={秒}`，含 page=1 与多 P 用例
- [ ] A3 [自动] 路径编码单测：中文、空格、特殊字符目录名
- [ ] A4 [自动] 错误分类单测：连接拒绝 / 401 / 404 / HTTPS 证书失败分别映射到对应提示
- [ ] A5 [自动] `check:prompts` 通过
- [ ] A6 [人工] P2 一键存库，Obsidian 中出现笔记，属性面板正确识别 frontmatter
- [ ] A7 [人工] 存一张术语卡，点击其中的跳播链接，浏览器打开 P2 对应时间点，误差 ≤ 2s
- [ ] A8 [人工] 对同一术语再次存卡，出现合并提示而非静默新建
- [ ] A9 [人工] 依次模拟 Obsidian 未启动、关闭 HTTP 模式、填错 API Key，设置页自检给出对应提示，侧边栏不崩溃
- [ ] A10 [自动] G1/G2/G3 门禁全过；执行记录已追加；打 tag `spec-06-accepted`

## 5. 风险与回滚

- HTTPS 自签证书 → 自检优先探测 HTTP 端口并给出开启指引
- 模型改写 frontmatter → frontmatter 只由代码生成
- 回滚：sink 独立，禁用后其余功能不受影响

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| — | — | — | — | — |
