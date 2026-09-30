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


## 范围变更记录（2026-09-30，用户对导图质量的否决性反馈）

用户验收否决："导图太粗糙，是章节大纲的翻版"。判定成立：原实现按时间序渲染大纲，零信息增量。产品原则修订：**大纲=时间导航，导图=知识导航**，两者必须承载不同的认知任务。

新设计（概念知识图）：
1. 默认视图改为概念图：根=课程主题 → 概念域（3~6，语义聚类）→ 概念（短语 ≤12 字）→ 折叠细节；节点文本短语化
2. 播放跟随升级为概念级：当前章节涉及的概念节点高亮（section.terms ↔ 概念映射）
3. 概念节点挂多时间锚（跨章节合并出现点），可点跳播；锚点吸附真实 Cue（红线 2 精神）
4. 节点视觉承载 score（大小/色深）
5. 生成：一次结构化模型调用（输入 sections+terms+summaries → ConceptTree JSON，Zod 校验），缓存键 [videoId, conceptMapPromptVersion, model]；红线 1 合规（确定性单调用，非 agent loop）
6. 降级：模型失败 → 确定性术语关联图（terms 按出现章节聚合，零 token）
7. 原章节时间轴视图保留为切换项（次要）

连带：新增 src/prompts/concept-map.md、core/pipeline/conceptMap.ts、ConceptNode 类型、db 概念图缓存。


### 范围变更二次迭代（2026-09-30 上午，用户对概念图 v1 的反馈）

事实：①截图显示的是降级图（模型生成失败静默回退，UI 未告知）——根因：Zod 对 label ≤12 字硬拒绝，模型输出 13~16 字常见 → 重试再败 → 降级；②概念跟随 substring 匹配过松（亮起多个）；③importance 圆点无语义；④形式裁决：**放弃 SVG 图布局，改为 HTML 知识卡片流**（窄边栏媒介适配），"图的形式没必要有拘束"采纳。

施工项：
1. conceptMap.ts：label 的 Zod 约束放宽（≤30，代码负责截断到 12）；降级时 UI 显式提示"模型生成失败，当前为术语关联图"+ 重试按钮
2. MindmapTab：概念图视图从 SVG 树改为 **HTML 知识卡片流**——概念域卡（域名 + 概念数）→ 概念行（名称粗体 + 重要度文字徽标〔核心/重要/一般，替换圆点〕+ 时间 chips 可点跳播 + 细节折叠）；当前概念行高亮（匹配改精确：概念 label ∈ 当前章节 terms，大小写不敏感）
3. 时间轴视图保留；SVG/d3-flextree 代码移除
4. 概念流程图（关系三元组抽取）列入 v0.1.x 候选（EVOLUTION-ROADMAP），本期不做

## 4. 验收标准
| 2026-09-30 | 子 agent 二迭代 | 知识卡片流全量：zod label 放宽至 30（代码截 12，根治降级根因）+ degraded 横幅/重试（App 全链路接线）+ matchConcepts 精确匹配（正反例单测）+ importance 文字徽标（替换圆点）+ details 折叠（grid 过渡）+ 删除 SVG/d3-flextree（依赖同步移除）+ 63 例 | tsc 零错误；458 例全绿；check-prompts PASS；d3-flextree 零引用 | <随提交回填>（已验收） |
| 2026-09-30 | 子 agent | 概念知识图全量：concept-map.md 单一源（grounding 约束：概念必须出自素材术语/要点）+ conceptMap.ts（ConceptTree Zod、buildConceptMap 单次结构化调用含重试、buildTermIndexMap 确定性降级、shortenLabel）+ MindmapTab 重写（自绘 SVG d3-flextree 竖向树、短语节点、渐进揭示 domain 折叠、score 权重视觉、概念跟随高亮、章节时间轴保留为切换视图）+ mindmapLoader（缓存键 concept::videoId::ver::model）+ 48 例 | tsc 零错误；48 例全绿；check-prompts PASS | d084be8（已验收） |
| 2026-09-30 | 父 agent | App 接线（缓存回填 effect/生成 handler 失败降级本地术语图/MindmapTab 全 props）；SSH 推送通道修复（22 端口被网络切断 → ~/.ssh/config 走 ssh.github.com:443 + 官方 ed25519 指纹预置）；npm run verify 直连 443 例全绿 | ✅ 人工验收项：概念图生成/概念跟随/降级图/时间轴切换（用户） | d084be8 |

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
