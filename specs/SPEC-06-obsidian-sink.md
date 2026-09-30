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


## 范围变更记录（2026-09-30，参考 ai-knowlage 的分层目录与双索引机制）

采纳用户建议（参考 ai-knowlage 实现，支持后续知识二次检索并接入问答）：

1. **分层目录**：`{root}/视频笔记/{课程}/{视频标题}.md`、`{root}/术语/{术语}.md`
2. **双索引**：`{root}/_meta/index.json`（机器检索，KnowledgeIndexEntry 结构）+ `{root}/_索引.md`（人类可读 MOC，Obsidian `[[双链]]`）
3. **摘要预览**：写入时生成 ≤200 字 summaryPreview，检索只喂预览（对应 ai-knowlage 的 ai_summary_preview 轻量化，契合红线 3 预算）
4. **二次检索接入问答**（SPEC-05 范围变更）：问答时可检索个人知识库 top-K 注入"个人知识库素材"分区；命中引用来源（笔记名+链接），未命中明确说明；设置项可开关
5. 检索打分与关键词匹配全部确定性（红线 1），无额外模型调用

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
| 2026-09-30 | 子 agent 全量 | sinks/obsidian（put/get/testConnection 可操作错误文案）+ capture（视频笔记/术语卡 Markdown、frontmatter §4.7、≤200 字预览、_meta/index.json + _索引.md 双链 MOC、确定性去重）+ obsidianLoader（配置/存库/索引维护/terms store）+ 设置激活（key 脱敏/测试连接）+ 大纲与问答存库按钮；78 例 | tsc 零错误；651 例全绿（含回归）；check-prompts/redlines PASS | 29ff5a0（已验收） |
| 2026-09-30 | 子 agent 检索 | 知识库二次检索接入问答：retriever（章节术语优先+停用词、加权打分、top-K 预览截断）+ compiler 知识库分区（预算优先级 区间>知识库>章节）+ segment-qa prompt 0.2.0（引用 knowledgeSources、不得编造、冲突以视频为准）+ ChatTab 参考来源行 + 设置开关；28 例 | tsc 零错误；56 例（含回归）全绿 | 4f00c79（已验收） |
| 2026-09-30 | 父 agent | App 接线：存库按钮（大纲视频笔记/问答术语卡，重复提示原样展示）、DB 版本升 v2 建 usage 表、报告入口；接线中自纠三处（锚点错位/JSX fragment/重复 import） | verify 直连 651 例全绿 | de21270（已验收） |

|---|---|---|---|---|
| — | — | — | — | — |
