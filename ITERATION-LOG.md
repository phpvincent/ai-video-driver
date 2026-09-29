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
| 09-30 | 审计 | 开工前全量审计（逐份重读 + 核实文件系统事实），报告 `reviews/AUDIT-2026-09-30.md`：P0 6 项（无 git 仓库致 G3/回滚落空；父 agent 无法执行联调类验收；Side Panel 不能自动打开；Panel 缺字幕视图致划词落空；pipeline 宿主应从 SW 改为 panel + API key 禁入 content script；文档间 9 处漂移）、P1 7 项（缺 MVP 验证判定标准；大纲质量无验收；双维护 diff 不可执行；红线无检查脚本；缺离线回放测试；并行共享文件冲突；缺子 agent 派发模板）、P2 6 项 | ✅ 用户确认全部采纳（见下一条） |
| 09-30 | 施工 | 关联代码仓库 `git@github.com:phpvincent/ai-video-driver.git`：`git init -b main`，远程原为空仓库；HTTPS 无凭据，改用本机 SSH key（身份 phpvincent）推送；新增 `.gitignore`（含 `tests/fixtures/raw/`）；基线提交 850a1d9 已推送 | ✅ main 跟踪 origin/main |
| 09-30 | 调研 | 测试课程登记：BV1YG7G6eEPR（59 个分 P，全集约 17 小时），用户指定 01~10 集 = P2~P11（P1 为 63 秒导读），合计约 5 小时；匿名 wbi 探测 P1~P11 均返回空字幕列表且 `need_login_subtitle: true`；本机代理隧道连 B 站超时，脚本需 `--noproxy` | ✅ `tests/fixtures/bv-cases.md`；登录态覆盖率待 SPEC-02 A6 |
| 09-30 | 变更 | 按审计全部采纳修订：CONSTITUTION v1.1（用户为最终验收人、验收三级标注、§5 版本控制、共享契约仅父 agent 可改、红线 6/7 改写、新增红线 10 与检查方式列、决策扇出检查）；TECH-DESIGN r3（字幕 Tab、videoId=bvid_p{n}、运行上下文职责、prompt 单一事实源、Section.terms/density 算法、QaRecord、两层缓存、trace、错误分类表含 need_login 优先、跳播链接格式、manifest 去 YouTube、§10 质量保障、§12 M7）；SPEC-01~06 按模板重写；新增 SPEC-07 MVP 验证期、`_SPEC_TEMPLATE.md`、`_DISPATCH_TEMPLATE.md` | ✅ 受影响文档：CONSTITUTION / TECH-DESIGN / SPEC-01~07 / 两份模板 / EVOLUTION-ROADMAP（章节引用与 SPEC 编号同步）/ AUDIT 报告（追加处置结果）/ bv-cases.md，逐个已确认 |
| 09-30 | 决策 | 字幕术语澄清：一级通道抓取的是播放器字幕轨列表（UP 主上传字幕 + 平台 AI 字幕同在 player wbi/v2 的 subtitles 数组，UP 主优先、AI 次之），"博主自己配的字幕"本就是主要抓取对象；AI 字幕无标点/同音字问题 → "顺句"列为条件触发进化项 | ✅ 受影响文档：TECH-DESIGN §1.3/§7.1、EVOLUTION-ROADMAP §2、MEMORY，逐个已改 |
| 09-30 | 施工 | **SPEC-01 开工**：父 agent 完成子任务 1.2 共享契约（types/messages/config，commit 5ecc048）；派发子任务 1.1 工程脚手架，子 agent 交付（commit 904a548），父 agent 复跑 G1（build/test/check 全绿）与 G3（content 占位零 import、config 外无敏感串）验收通过 | ✅ 已推送；剩余 1.3/1.4/1.5 待派发 |
| 09-30 | 施工 | SPEC-01 子任务 1.3/1.4/1.5 **并行派发并全部验收**（aa524f6 / e982d73 / dc2f488）：manifest+background 路由、红线与 prompt 检查脚本、content+panel 壳；并行冲突一处由父 agent 裁决——**config 拆 shared 层**（content 唯一合法配置入口，模型端点彻底隔离出 content 上下文），1.3 的检查脚本在真实仓库扫描中抓出 2 条违规并已修复。当前全套：tsc 零错误、vitest 47 例全绿、check 全 PASS、build 成功 | ✅ A1~A4 自动验收通过；**A5/A6 待用户人工验收**（装 Chrome 验证 videoId 显示与分 P 切换） |
| 09-30 | 验收 | **SPEC-01 全部验收通过，tag spec-01-accepted**。A5（侧边栏打开、videoId/标题/时长/播放状态显示）与 A6（P2→P3 无刷新切换、含关闭面板再打开场景）用户确认通过。期间 6 轮人工验收迭代修复：dist 缺 manifest、sidePanel 点击无反应（per-tab 禁用残留、跨 await 丢手势、关闭面板清空 active 条目需显式 path 绑定）——sidePanel API 坑合集已入项目记忆 | ✅ SPEC-01 关闭；开工 SPEC-02 |
| 09-30 | 施工 | **连夜施工（用户授权自主推进）**：①重生成 UI 丝滑化（grid 折叠动画 + active 高亮跟随 + 平滑滚动）；②新增 `npm run verify` 直连验收命令（管道吞退出码问题两次，彻底根治）；③SPEC-04 导图全量（markmap 渲染/点击跳播/跟随高亮，19 例）与 SPEC-05 问答全量（上下文编译器红线 3/术语+区间 pipeline/双 prompt 单一源/qaHistory/ChatTab 打字机/字幕划词联动，60 例）并行派发完成；④父 agent 接线（sections 上提/explainLoader/pendingTerm 联动/暂停）；⑤记忆压缩（剔除过程性 bug 细节，保留决策/API 坑/进度） | ✅ 414 测试全绿；SPEC-04/05 施工完成待用户人工验收；A5 口径变更（打字机替代 SSE，流式列 v0.1.x）已批准记录 | 
| 09-30 | 打回 | 用户人工验收 A5 首次执行报"清单文件缺失"——**dist/ 无 manifest.json**（构建只产出 JS/HTML，清单未复制），判定为 A1 自动验收的疏漏（只查产物存在，未查"dist 可加载"） | ✅ 父 agent 单点修复：vite closeBundle 复制 manifest.json 进 dist，构建后校验通过；**教训入库：[自动] 验收项的断言必须覆盖验收语句的完整语义**（A1 说"可直接加载"就必须模拟加载条件） |

---

## 待办（下一迭代）

- [ ] 开工 SPEC-01：父 agent 先完成子任务 1.2（共享契约），再派发 1.1/1.3/1.4/1.5
- [ ] SPEC-02 开工首日：用户在已登录 Chrome 中执行 A6 覆盖率预检（P2~P11）
- [ ] SPEC-03 开工前：用户提供 DeepSeek API key
- [x] ~~用户确认审计处置方案~~（09-30 全部采纳）
- [x] ~~修订宪法 / TECH-DESIGN / SPEC-01~06，新增 SPEC-07 与两份模板~~
- [x] ~~用户提供真实学习目标视频~~（BV1YG7G6eEPR 01~10 集）
- [x] ~~用户确认三个开放问题~~（09-30 已全部拍板）
