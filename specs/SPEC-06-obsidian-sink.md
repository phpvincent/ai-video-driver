# SPEC-06 · Obsidian 知识沉淀

- 状态：待开工
- 依赖：SPEC-04, SPEC-05
- 对应里程碑：M6
- 执行者：（派发时填写）

## 1. 目标与范围

**做**：
- `sinks/obsidian.ts`：Local REST API 写入（PUT /vault/{path}，Bearer 鉴权，HTTP 27124）
- 设置页：Obsidian 地址/API Key/笔记根目录配置 + **连通性自检**（含"请确认已启用 Non-encrypted HTTP"的失败提示）
- 视频笔记：一键存库（frontmatter 按 TECH-DESIGN §4.6 契约：title/source/url/platform_id/duration/created/tags/type）
- 术语卡：`术语/` 目录，type: term-card，正文含"在《视频标题》中出现于 mm:ss"反链与跳播时间戳
- 去重：写入前与已有术语表比对（`knowledge-capture` pipeline 计算重复度），>0.8 提示"已存在相似笔记，是否合并"
- `prompts/knowledge-capture.ts` + `.agents/skills/knowledge-capture/SKILL.md` 双维护（红线 6）
- 回放锚点：笔记内时间戳链接可跳回原片（bilibili URL 带 t 参数）

**不做**：跨视频语义检索（v0.2 后端）、Anki 卡片导出（候选）、自动写入（一律手动确认）。

## 2. 前置条件

- SPEC-04/05 已验收（有可沉淀的问答与术语产物）
- Obsidian 已安装 Local REST API 插件并启用 HTTP 模式

## 3. 执行方案（可拆为 3 个子任务派发）

| # | 子任务 | 交付物 | 预估 |
|---|---|---|---|
| 6.1 | Obsidian sink + 设置 | obsidian.ts、连通性自检、地址/Key/目录配置 | 1d |
| 6.2 | 笔记与术语卡生成 | frontmatter 组装、术语卡模板、回放锚点（?t= 秒参数） | 1d |
| 6.3 | 去重与合并 | 重复度评分 pipeline、合并确认 UI、prompt/SKILL 双维护 | 1d |

## 4. 验收标准（父 agent 逐条执行）

- [ ] A1 单测：frontmatter 组装——字段齐全、YAML 合法（解析回读校验）、duration/url 格式正确
- [ ] A2 单测：SRT 时间 → bilibili `?t=` 参数换算正确
- [ ] A3 联调：真实写入 Obsidian 成功，vault 中出现笔记，frontmatter 完整可被 Obsidian 属性面板识别
- [ ] A4 联调：术语卡落 `术语/` 目录，正文反链正确；点击笔记中时间戳链接在浏览器打开原片并定位（误差 ≤ 2s）
- [ ] A5 联调：重复写入同一术语，重复度 >0.8 时出现合并提示而非静默新建
- [ ] A6 联调：Obsidian 未启动 / 未开 HTTP 模式 / API Key 错误三种场景，UI 给出**可操作的具体提示**（对应错误分类），不崩溃
- [ ] A7 prompts/ 与 .agents/skills/ 一致（diff 校验）
- [ ] A8 G1/G2/G3 门禁全过；执行记录已追加

## 5. 风险与回滚

- 风险：HTTPS 自签证书陷阱（TECH-DESIGN §7.2）→ 连通性自检首先探测 HTTP 模式并给出开启指引
- 风险：vault 路径含中文/空格 → URL 编码用例进单测
- 回滚：sink 层独立，禁用后其余功能不受影响

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 |
|---|---|---|---|
| — | — | — | — |
