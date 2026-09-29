# 迭代日志 · video-study-copilot

> 记录格式：日期 | 类型 | 内容 | 结果。append-only，不删改历史。
> 类型：立项 / 决策 / 调研 / 施工 / 验收 / 变更 / 打回 / 回滚

---

## 2026-09-29

| 日期 | 类型 | 内容 | 结果 |
|---|---|---|---|
| 09-29 | 立项 | 需求澄清完成：B站/抖音/本地视频，Obsidian 知识库，v0.1 无后端纯插件，DeepSeek 档模型，MVP=核心+导图 | ✅ 四项关键决策确认 |
| 09-29 | 决策 | 预读采用确定性 map-reduce pipeline，术语解释/区间问答才引入 agentic；时间戳强制吸附 Cue 边界 | ✅ 写入 TECH-DESIGN §3.1/§5.1 |
| 09-29 | 调研 | Agent Harness 主流架构（微内核/控制平面型）、SKILL.md 开放标准、Chrome 内置 AI、竞品格局 | ✅ 调研结论归档 |
| 09-29 | 决策 | 部署形态定稿：v0.1 无后端（MV3 host_permissions 免 CORS），无字幕视频降级手动粘贴 | ✅ 用户确认 |
| 09-29 | 施工 | TECH-DESIGN.md v0.1 完成（12 章：架构/数据模型/pipeline/prompt 契约/接口契约/成本/工程结构/里程碑/风险） | ✅ 已交付 |
| 09-29 | 调研 | ai-knowlage 代码调研（/Users/wangxiaoheng/CodeBuddy/ai-knowlage）：四级降级采集链路、cookie 状态机、rolling caption 去重、whisper segments 验证 | ✅ 采纳进 §7.1/§13 |
| 09-29 | 决策 | 字幕采集从"平铺适配器"改为"有序瀑布+统一状态透传"；ai-knowlage 登记为 v0.2 复用资产 | ✅ TECH-DESIGN 第 2 轮修订 |
| 09-29 | 施工 | 施工治理体系建立：CONSTITUTION.md（宪法）+ 6 个 spec + 本迭代日志 | ✅ spec 全部三要素齐备，状态"待开工" |

---

## 2026-09-30

| 日期 | 类型 | 内容 | 结果 |
|---|---|---|---|
| 09-30 | 决策 | 用户拍板三个开放问题：YouTube 不进 v0.1；术语卡目录从简（功能保留、扁平存放）；学习进度 deferred。v0.1 定位为 MVP 模式验证 | ✅ 全部落入 EVOLUTION-ROADMAP.md |
| 09-30 | 施工 | 建立 EVOLUTION-ROADMAP.md 进化罗盘：deferred 项 / 近期(v0.1.x) / 中期(v0.2) / 远期方向 / 反方向清单，防止进化方向失忆 | ✅ 已交付 |
| 09-30 | 变更 | 开工前审视发现 6 个工程漏洞，2 个修入 spec：**H1 多 P 课程**（videoId 必须为 bvid_p{n}，教程主流形态，修入 SPEC-02 A3b）；**H2 SW 生命周期**（30s 空闲被杀 → 保活+断点续跑，修入 SPEC-03 A4b）；H3 幻觉时间戳阈值（修入 SPEC-03 A2）；H4 固定回归测试集 fixtures（修入 SPEC-02 §4b）；H5 成本熔断（修入 SPEC-03 A4c）；H6 字幕覆盖率预检 <60% 触发云 ASR 提前决策（修入 SPEC-02 A3c） | ✅ 两个 spec 已修订 |
| 09-30 | 决策 | 产品 idea 评审：新增高优进化项——薄弱章节自动标记（qaHistory 数据已有）、信息密度预警（直击原始痛点）；中优——进度续看、双语翻译、导图导出；远期——Anki 化、课程编排、预习模式。评论区精华/画面理解进 v0.2 候选 | ✅ 全部落入 EVOLUTION-ROADMAP.md |
| 09-30 | 决策 | 两个高优 idea 的 v0.1 取舍拍板：**信息密度预警轻量版进 v0.1**（Section.density 字段 + 大纲章节标记，SPEC-03 新增子任务 3.5 与验收 A5b，工期 +0.5d；主动提示交互留 v0.1.x）；**薄弱章节标记放 v0.1.x**（依赖真实问答数据积累），但 SPEC-05 新增 A7b 锁死 qaHistory 可聚合数据结构（videoId/timestampMs/章节 id/交互类型），将来零迁移追加 | ✅ SPEC-03/05 与罗盘已同步 |

---

| 09-30 | 审计 | 开工前全量审计（逐份重读 + 核实文件系统事实），报告 `reviews/AUDIT-2026-09-30.md`：P0 6 项（无 git 仓库致 G3/回滚落空；父 agent 无法执行联调类验收；Side Panel 不能自动打开；Panel 缺字幕视图致划词落空；pipeline 宿主应从 SW 改为 panel + API key 禁入 content script；文档间 9 处漂移）、P1 7 项（缺 MVP 验证判定标准 → 拟增 SPEC-07；大纲质量无验收；双维护 diff 不可执行 → 改单一事实源；红线无检查脚本；缺离线回放测试；并行共享文件冲突 → 契约先行；缺子 agent 派发模板）、P2 6 项 | ⏸ 待用户确认处置方案，确认前 SPEC-01 暂缓开工 |

---

## 待办（下一迭代）

- [ ] 用户确认审计处置方案（AUDIT-2026-09-30）
- [ ] 按确认结果修订宪法 / TECH-DESIGN / SPEC-01~06，新增 SPEC-07 与两份模板
- [ ] 用户提供 10 个真实学习目标视频链接（覆盖率预检 + fixtures + 黄金样例）
- [ ] 开工 SPEC-01（工程骨架），父 agent 派发 + 验收
- [x] ~~用户确认三个开放问题~~（09-30 已全部拍板，见上）
