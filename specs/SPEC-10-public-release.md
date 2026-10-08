# SPEC-10 · 公网发布产品化（P0/P1 批次）

- 状态：进行中（2026-10-08 用户确认全部 10 项决策，当日开工）
- 依赖：SPEC-09（已施工完成；人工验收项与本品并行，互不阻塞）
- 对应里程碑：v0.1.x → 公网发布
- 验收 tag：`spec-10-accepted`

## 0. 决策记录（用户拍板，2026-10-08 PM 评审后）

| # | 决策 |
|---|---|
| 1 | API Key 冷启动：面板内引导文案 + README 完整指引 |
| 2 | 隐私与信任：隐私政策 + 权限说明 + 数据流向披露（README 与面板内） |
| 3 | 弱模型容错：输出形状归一化救回 + 重试纠偏提示（"错误类型 catch"） |
| 4 | **Obsidian 解绑**：未配置 Obsidian 时所有 .md 模块可直接下载到本地；.md 必须自带来源信息与固定标签（无目录结构时读单个文件也能知道内容是什么）；全部模块统一调整 |
| 5 | 数据备份：用户可一键下载全部数据 + 导入恢复（下载链接 + 本地同步按钮） |
| 6 | 等待体验：流式输出 vs 加载遮罩 → **选遮罩+已耗时提示**（流式需拆 JSON 协议，另立 spec） |
| 7 | 生成进度：切 tab 不中断（面板常驻），本期只答复不改代码 |
| 8 | 成本透明：预设模型价格表 + 估算费用展示（不同模型计费不同，按官方价估算） |
| 9 | 面板内帮助：增加 |
| 10 | P2 差异化方向登记进 EVOLUTION-ROADMAP（与既有条目合并） |

## 1. 目标与范围

**做**：

| # | 项 | 交付物 |
|---|---|---|
| 10.1 | 冷启动引导 | README.md（新建）；设置页模型区注册链接（URL 进 config，红线 9）；未配置占位文案改三步引导 |
| 10.2 | 隐私与信任 | README 隐私政策与权限说明章节；设置页「关于与隐私」段 |
| 10.3 | 弱模型容错 | `normalizeConceptStages` 恢复（adf3821 已验证实现，不含已回退的 prompt 改动）+ 重试纠偏提示 + 单测 |
| 10.4 | Obsidian 解绑与统一 .md | 未配置 Obsidian → 视频/术语卡自动降级为本地下载 .md；frontmatter 检索友好字段统一（platform/来源/标签）；单测 |
| 10.5 | 数据备份与恢复 | 设置页「数据管理」：全量导出 JSON（vsc-backup v1）/ 导入恢复；`panel/dataBackup.ts` |
| 10.6 | 问答等待体验 | 思考中遮罩 + 已耗时秒数 + 时长预期提示 |
| 10.7 | 生成进度 | 答复性说明（切 tab 不中断；关面板中断，大纲分块断点已设计） |
| 10.8 | 成本估算 | config 预设价格表（元/百万 token）；验证期报告增加估算费用（自定义模型仅 token） |
| 10.9 | 面板内帮助 | 面板头部「？」按钮 + 帮助浮层（三步上手/各 Tab 说明/隐私/FAQ） |
| 10.10 | P2 登记 | EVOLUTION-ROADMAP 追加公网产品化 P2 条目 |

**不做**：流式输出（SSE，单独立 spec）、托管后端/官方 Key、弹幕联动（P2 评估）、云同步（无后端）。

## 2. 关键设计

### 2.1 统一 .md 检索友好格式（10.4）

所有 .md（视频笔记 / 术语卡 / 本地导出）的 frontmatter 统一含：`title` / `source: bilibili` / `url`（含 p 参数）/ `video_id` / `duration` / `created` / `tags`（含 `ai` + 类型 + `B站`）/ `type`。正文首段固定「来源：」行（回链 + 时长 + video_id）。裸读单文件即可判断内容来源与类型。落库 Obsidian 与本地下载共用同一 `buildVideoNoteMarkdown` / `buildTermCardMarkdown`（单一事实源），**本地下载不是另一套格式**。

### 2.2 Obsidian 降级链（10.4）

`saveVideoNoteToObsidian` / `saveTermCardToObsidian`：配置齐全 → 原路径；未配置 → **自动降级为本地 .md 下载**（platform/files），返回值加 `local: true` 标记，UI 文案区分「已存入 Obsidian」/「未配置 Obsidian，已下载：xx.md」。用户零配置也有完整沉淀体验。

### 2.3 数据备份格式 `vsc-backup` v1（10.5）

```json
{ "format": "vsc-backup", "version": "1.0", "exportedAt": "…",
  "data": { "outlines": [{ "key": "…", "value": {…} }], "qaHistory": […], "notes": […], "terms": […], "usage": […] } }
```

- 覆盖**用户价值数据**五 store（subtitles 可重拉、logs/traces 是调试数据，不导出）
- key 由记录内容推导（outlines=cacheKey；qa/notes=id；terms=[term,videoId]；usage=videoId）
- 导入 = 逐条 put（同 key 覆盖），不删既有数据；DB 版本不匹配时报告并跳过该 store

### 2.4 成本估算（10.8）

config `PRICING`：预设模型 → `{ inputPerM, outputPerM }`（元/百万 token，官方公示价，标注"估算"）。报告聚合各模型 token → 估算费用；命中不到价格表的模型只显示 token 并注明。价格随官网变动，代码常量可维护（红线 9 允许：非端点、非密钥）。

## 3. 执行方案

| # | 允许修改的路径 |
|---|---|
| 10.1/10.2 | README.md（新）、docs/、src/config/、src/panel/settings/、各 Tab 占位文案 |
| 10.3 | src/core/pipeline/conceptMap.ts、tests/unit/pipeline/ |
| 10.4 | src/core/pipeline/capture.ts、src/panel/obsidianLoader.ts、src/panel/（接线处）、src/platform/ |
| 10.5 | src/panel/dataBackup.ts（新）、src/panel/settings/ |
| 10.6 | src/panel/ChatTab.tsx、chat.css |
| 10.8 | src/config/、src/core/metrics/ |
| 10.9 | src/panel/HelpOverlay.tsx（新）、App.tsx |
| 10.10 | EVOLUTION-ROADMAP.md |

## 4. 验收标准

- [ ] B1 [自动] 弱模型容错：线上畸形形态（stages 混入 string/number/array）归一化后可救回；全合法输入恒等（单测）
- [ ] B2 [自动] 统一 .md：视频笔记与术语卡 frontmatter 含全部检索友好字段；本地下载与 Obsidian 落盘同一构建函数（单测）
- [ ] B3 [自动] Obsidian 降级：未配置时存入操作返回 local=true 且走下载路径（单测，mock 下载）
- [ ] B4 [自动] 备份往返：导出 → 清空 → 导入后五 store 记录逐字段相等（单测，内存 DbLike）
- [ ] B5 [自动] 成本估算：预设模型费用=token×单价；未知模型仅 token（单测）
- [ ] B6 [自动] 红线 11：下载/导入等平台调用只在 src/platform/；红线 9：新增 URL 只在 config
- [ ] B7 [人工] README 指引可照做完成配置；帮助浮层与设置页数据管理可用；问答等待显示已耗时
- [ ] B8 [自动] G1/G2/G3 门禁全过

## 5. 风险与回滚

- 价格表时效：标注"估算、以官网为准"；不作为计费依据
- 备份导入恶意文件：zod 校验 format/version + 单条记录 try/catch 跳过，不整批失败
- 本地下载在无下载权限环境：Web 标准 blob 下载，降级报错由 UI 行内展示

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| 10-08 | 父 agent | 起草（依据用户 10 项决策） | — | 本提交 |
| 10-08 | 父 agent | 10.3 弱模型容错：normalizeConceptStages 恢复（自 adf3821 已验证实现，**不含已回退的 0.7.x prompt 改动**）+ 重试纠偏提示（识别 expected object）| 单测 +8（含线上畸形形态复现、幂等、越界截断） | 本提交 |
| 10-08 | 父 agent | 10.4 Obsidian 解绑：未配置时视频笔记/术语卡自动降级本地 .md 下载（SaveNoteResult.local 标记，UI 文案区分）；统一检索友好格式（tags 加 B站、TERM_FRONTMATTER_TAGS、localMarkdownFileName 与交换格式同构）；本地下载与 Obsidian 落盘共用同一构建函数 | 单测更新 3 例（tags/降级路径/去重绕过） | 本提交 |
| 10-08 | 父 agent | 10.5 数据备份：panel/dataBackup.ts（vsc-backup v1，五 store，keyOf 键推导单一事实源）+ 设置页「数据管理」段（导出/导入+结果反馈） | 单测 7 例（keyOf 全口径、非法文件拒绝） | 本提交 |
| 10-08 | 父 agent | 10.6 问答等待：QaLoadingHint（呼吸圆点 + 已耗时秒数 + 时长预期 + "可切走"提示）；流式输出登记进 ROADMAP 单独立 spec | ChatTab 单测无回归 | 本提交 |
| 10-08 | 父 agent | 10.8 成本估算：config PRICING（8 预设，元/百万 token）+ core/metrics/cost.ts（priceOf/estimateCostCny/summarizeCost）+ 验证期报告"费用估算"行（未知模型仅计 token） | 单测 13 例（前缀匹配/线性/聚合/无价格降级/格式化） | 本提交 |
| 10-08 | 父 agent | 10.9 面板内帮助：HelpOverlay（三步上手/各 Tab/隐私/FAQ）+ 顶部「？」按钮 | renderToString 无回归 | 本提交 |
| 10-08 | 父 agent | 10.1 冷启动：设置页三步引导框（注册链接直达 config consoleUrl + 费用提示）；OutlineTab/MindmapTab 未配置文案改为可照做的步骤 | 文案断言测试跟随更新 | 本提交 |
| 10-08 | 父 agent | 10.1b/10.2 README.md（新建）：快速上手三步表、隐私与数据表、权限说明表、FAQ、安装指引 | 文档评审待用户 | 本提交 |
| 10-08 | 父 agent | 10.10 EVOLUTION-ROADMAP §6 公网产品化 P2 登记（分享裂变★★★/流式★★★/高能弹幕★★/自定义价格★/多P课程★★） | — | 本提交 |
| 10-08 | 父 agent | 10.7 答复（不改代码）：Chrome 同窗口切 tab 侧栏常驻、生成不中断（inflight 续等）；关面板/关浏览器中断，大纲分块断点已设计 | — | — |
| 10-09 | 父 agent | CWS 上架收尾（发布前最后一块）：图标 4 尺寸生成（public/icons/，扁平蓝底播放三角+时间戳 chip）+ manifest icons/default_icon/minimum_chrome_version 114；PRIVACY.md 独立隐私政策（数据流向/权限/删除/无服务器承诺）；docs/STORE-LISTING.md（商店文案复制区/截图脚本/权限理由逐条/Data usage 披露口径/提交前检查单） | manifest 单测更新过；dist 含 icons；1076 例全绿 | 本提交 |
