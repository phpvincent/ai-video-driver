# 视频学习副驾（Video Study Copilot）技术设计文档

版本：v0.1（MVP）
日期：2026-09-29
定位：浏览器侧 AI 工具，在观看教学视频时提供"带时间戳的大纲与导图 + 上下文感知的即时解释 + 沉淀进个人知识库"

---

## 1. 产品定位与范围

### 1.1 要解决的核心问题

视频是线性的，理解是非线性的。当视频信息密度突增或出现陌生名词时，学习者被迫暂停、切走搜索，学习节奏断裂、上下文丢失。本工具的目标不是"替你看视频"，而是把视频**预结构化**成一个可随时跳转、随时打断、随时沉淀的旁听席。

与市面视频摘要工具的本质区别：摘要工具解决"要不要看"，本工具解决"怎么看得下去，并且留下东西"。

### 1.2 v0.1 范围（做）

| 能力 | 说明 |
|---|---|
| 字幕抓取 | B 站官方/AI 字幕轨优先；YouTube 字幕轨次之 |
| 视频预读 | 生成章节级大纲，每个节点绑定 `[mm:ss]` 时间戳 |
| 思维导图 | 由大纲 Markdown 渲染为可交互导图，节点可点击跳播 |
| 大纲/导图跟随 | 播放进度驱动节点高亮与自动滚动 |
| 划词解释 | 选中字幕文本，结合视频上下文与公开知识解释 |
| 区间提问 | 在时间轴上框选起止区间，针对该段提问 |
| 知识库沉淀 | 一键写入 Obsidian，Markdown + frontmatter |

### 1.3 v0.1 范围（不做）

- **无字幕转写（ASR）**：抖音、无字幕本地视频暂不支持，降级为"手动粘贴文案/字幕"。原因是抖音音频地址获取涉及平台签名对抗，投入产出比低，且长音频转写在无后端架构下不可行。
- 跨视频语义检索、向量库：需要本地后端，列为 v0.2。
- 多设备同步、多人协作。
- 画面内容理解（截帧 OCR/VLM）：HoverNotes 类能力，v0.2 再评估。

### 1.4 明确的技术边界

v0.1 **不自建后端**。依据是 MV3 扩展在 `host_permissions` 中声明域名后，扩展发起的请求不受页面 CORS 限制，可直接调用第三方 API；知识库写入则复用 Obsidian 的 Local REST API 插件作为"现成本地后端"。

---

## 2. 用户流程与交互设计

### 2.1 主流程

1. 打开 B 站视频页 → Side Panel 自动识别 `bvid`，查询本地缓存。
2. 命中缓存：直接渲染大纲与导图。
3. 未命中：拉取字幕 → 侧栏显示"预读中"进度条（分段并发，流式渲染已完成章节）→ 完成后写入缓存。
4. 播放过程中：当前章节高亮，导图节点同步聚焦。
5. 遇到障碍：
   - 选中字幕中的词 → 浮层按钮"解释" → 侧栏问答页返回释义卡片；
   - 在时间轴拖选区间 → "解释这段" → 返回该段的重述与要点；
   - 直接在输入框自由提问。
6. 问答结果支持"存入 Obsidian"，生成术语卡或段落笔记，frontmatter 带回源链接与时间戳。

### 2.2 Side Panel 结构

三个 Tab：

- **大纲**：章节树，每项显示标题、`[mm:ss]`、一句话摘要；点击跳转播放。
- **导图**：markmap 渲染，可缩放折叠，节点点击跳播。
- **问答**：对话区 + 输入区；底部常驻"当前区间"选择器（默认跟随播放位置 ±30 秒）。

### 2.3 关键交互约束

- 提问时**自动暂停视频**（可在设置关闭）。
- 划词解释浮层紧贴选中文本，不遮挡播放器主体。
- 大纲生成支持中断与续跑：关闭侧栏不丢失已完成分段。
- 所有 AI 产出必须可一键复制、一键存库。

---

## 3. 系统架构

```
┌─ 1 浏览器插件层 (Chrome MV3 + React Side Panel) ────────────┐
│  字幕抓取器 · 时间轴监听 · 侧栏渲染 · 划词/选区 · 本地缓存   │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─ 2 上下文编译器 ────────────────────────────────────────────┐
│  字幕规范化 · 分段切片 · 时间戳对齐 · 上下文选段 · token 预算 │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─ 3 Agent Harness（控制平面，确定性 pipeline + 单点 agentic） ┐
│  工具注册表 · prompt 模板 · 预算/重试/超时 · 追踪 · 结果校验 │
│  能力：大纲生成 / 术语解释 / 区间问答 / 知识捕获             │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─ 4 沉淀层 ──────────────────────────────────────────────────┐
│  Obsidian Vault（Markdown + frontmatter）· 术语卡 · 索引     │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 为什么 v0.1 是"确定性 pipeline"而不是全 agentic

大纲生成本质是**对全量字幕的分段 map-reduce**，输入确定、输出结构确定、无工具调用需求，用确定性代码最可控、可测、可缓存。只有"术语解释 / 区间问答"需要检索外部知识，才引入模型自主性。

判断准则：**能画出流程图的环节就别用 agent loop。**

### 3.2 开发期的 SKILL.md 与运行时的 prompt 模板

两者同源、形态不同，必须分开维护并显式对应：

- **开发期**：四套 SOP 写成 SKILL.md，放在 `.agents/skills/`，供 Claude Code / Codex / Cursor 在改这段代码时遵循，保证多人多工具修改不跑偏。
- **运行时**：同一套 SOP 编译为 prompt 模板 + JSON Schema 校验器，由插件执行。

后续任何 SOP 变更，必须**同步改两处**，并在 PR 描述中说明。

---

## 4. 数据模型

### 4.1 字幕段 Cue

```ts
interface Cue {
  index: number;      // 全局递增序号
  startMs: number;    // 毫秒，绝对时间
  endMs: number;
  text: string;       // 已去除空行、合并过短句
}
```

规范化规则：合并时长 < 800ms 的相邻段；去除纯语气词段；保留原始时间戳不变。

### 4.2 章节 Section

```ts
interface Section {
  id: string;             // sec_0001
  title: string;          // 8-20 字
  startMs: number;        // 取自该章首条 Cue
  endMs: number;          // 取自下一章首条 Cue - 1ms
  summary: string;        // 一句话，40-80 字
  bullets: string[];      // 2-5 条要点
  cueRange: [number, number]; // 覆盖的 Cue 序号区间
  confidence: number;     // 0-1，模型自检置信度
}
```

约束：章节必须覆盖全片且不重叠；`startMs` 单调不减；末章 `endMs` = 视频时长。

### 4.3 大纲节点（导图渲染用）

大纲由 Section 直接映射为两级 Markdown：

```markdown
# 视频标题
## 00:00 章节一标题
- 要点一
- 要点二
## 05:12 章节二标题
- 要点三
```

markmap 直接消费该 Markdown，节点回调携带 `startMs`。

### 4.4 术语卡 TermCard

```ts
interface TermCard {
  term: string;
  definition: string;       // 结合视频上下文的解释
  generalDefinition: string;// 通用定义
  videoContext: string;     // 在视频中的具体含义
  sourceUrl: string;
  timestampMs: number;
  relatedTerms: string[];
  createdAt: string;        // ISO 8601
}
```

### 4.5 缓存结构（IndexedDB）

```
DB: vsc-cache
  store: videos      key: videoId
    { videoId, platform, title, url, durationMs, cues[], sections[], modelVersion, createdAt }
  store: qaHistory   key: [videoId, timestamp]
    { videoId, question, answer, rangeMs, createdAt }
  store: terms       key: term
    TermCard[]
```

模型版本 `modelVersion` 用于模型或 prompt 升级后**定向失效缓存**，避免旧大纲长期滞留。

### 4.6 Obsidian 笔记 frontmatter 契约

```yaml
---
title: 视频标题
source: bilibili
url: https://www.bilibili.com/video/BV...
platform_id: BV...
duration: 1823
created: 2026-09-29
tags: [ai, 视频笔记, agent]
type: video-note
---
```

术语卡单独成文，落 `术语/` 目录，`type: term-card`，正文含"在《视频标题》中出现于 05:12"的反向链接。

---

## 5. 关键流程

### 5.1 预读 Pipeline（大纲生成）

```
1. 解析 videoId（B 站 bvid → cid）
2. GET 字幕 JSON → Cue[]
3. 切片：按 Cue 累计字符数切块，单块目标 1800 字，块间重叠 200 字
4. 并发调用模型（并发度 3，失败重试 1 次，单块超时 30s）
   每块输入：块内字幕（带 [mm:ss] 前缀）+ 全局任务说明
   每块输出：该块内的候选章节 JSON
5. 合并：按 startMs 排序 → 合并标题相似度高的相邻章节 → 去重
6. 时间对齐校验：章节起点必须等于某条 Cue 的 startMs，否则吸附到最近 Cue
7. 渲染大纲 + markmap，写入缓存
```

第 6 步的**时间吸附**是体验生死线：模型输出的时间戳常有漂移，必须强制吸附到真实 Cue 边界，否则点击跳转会跳到无关位置。

### 5.2 上下文选段策略（控成本的核心）

提问时**不喂全量字幕**，只喂：

```
1. 全局章节列表（标题 + 时间戳，约 200 token）
2. 命中区间的字幕原文（默认 ±30s，可选扩展至整章）
3. 上一轮问答摘要（若有，压缩至 150 token）
4. 用户画像片段（可选：已知基础、偏好深度）
```

长视频单章超过 3000 字时，二次压缩为要点列表再入上下文。

### 5.3 时间轴跟随

content script 监听 `video.timeupdate`（节流 500ms）→ 对 `sections` 做二分查找 → `chrome.runtime.sendMessage` 通知侧栏 → 高亮对应节点 + `scrollIntoView({block:'nearest'})`。

B 站为 SPA，需用 `MutationObserver` 监听 `video` 元素挂载与 URL 变化，重新绑定监听。

---

## 6. Prompt 契约

所有模型输出必须严格 JSON，由 Zod 校验，校验失败自动重试一次并附带错误信息。

### 6.1 大纲生成（分段）

系统指令要点：

- 你是教学视频的结构化助手，只依据给定字幕内容分段，不得引入字幕之外的信息；
- 每个章节标题 8–20 字，`startSec` 必须等于字幕中真实出现的时间戳；
- 输出 JSON：`{sections:[{title, startSec, summary, bullets}]}`；
- 若该段内容是上一主题的延续，标题需体现延续关系而非另起炉灶。

输出 Schema：

```ts
const SectionSchema = z.object({
  title: z.string().min(4).max(40),
  startSec: z.number().int().nonnegative(),
  summary: z.string().max(120),
  bullets: z.array(z.string()).max(5),
});
```

### 6.2 术语解释

输入：术语 + 命中区间字幕 + 全局章节列表。
输出 Schema：

```ts
const TermSchema = z.object({
  term: z.string(),
  inVideoMeaning: z.string(),   // 在本视频语境中的含义
  generalDefinition: z.string(),// 公开知识中的通用定义
  analogy: z.string(),          // 一个类比
  relatedTerms: z.array(z.string()).max(5),
  needsWeb: z.boolean(),        // 是否建议联网检索
});
```

### 6.3 区间问答

输入：选中区间字幕 + 用户问题 + 章节列表。
输出：`{answer, keyPoints[], referencedTimestamps[], followUpQuestions[]}`。若区间内信息不足以作答，必须显式说明"视频中未涉及，以下为公开知识补充"，**禁止用视频内容编造**。

### 6.4 知识捕获

输入：候选笔记内容 + 视频元数据 + 已有术语表（用于去重）。
输出：完整 Markdown（含 frontmatter）+ 建议标签 + 与已有笔记的重复度评分。重复度 > 0.8 时提示"已存在相似笔记，是否合并"。

---

## 7. 外部接口契约

### 7.1 B 站字幕

1. `GET https://api.bilibili.com/x/web-interface/view?bvid={bvid}` → `data.cid`
2. `GET https://api.bilibili.com/x/player/wbi/v2?bvid={bvid}&cid={cid}` → `data.subtitle.subtitles[].subtitle_url`
3. 请求 2 需携带 **wbi 签名**（mixin key 算法）与页面 cookie，签名实现参考开源项目 BiliNote 的 Wbi 模块。
4. `subtitle_url` 为协议相对地址，需补全 `https:` 后拉取 JSON → `body[]`（`from`, `to`, `content`）。

接口随时可能变更，抓取层采用**有序瀑布 + 统一状态透传**（借鉴 ai-knowlage 项目的四级降级链路：social_video_extractor → ytdlp → fetch_subtitle → local_whisper_fallback）：

```ts
interface FetchResult {
  cues: Cue[];              // 空 = 未命中
  status: SubtitleStatus;   // ok | no_subtitle | need_login | api_changed | network | manual_pasted
}
```

- v0.1 瀑布：`B站官方字幕轨(wbi) → 手动粘贴`；v0.2 扩展：`云 ASR → 本地 whisper 桥`
- 每级失败不阻断、降级到下一级；status 写入缓存元数据，UI 透传"字幕从哪来、为何降级"
- 从 ai-knowlage 直接 TS 移植两段逻辑：**rolling caption 连续重复行去重**（自动字幕轨刚需，参照 `_normalize_subtitle_text`）；**错误指纹分类**（区分 cookie 失效/接口改版/网络错误，参照其 cookie 四态状态机 ok/not_configured/browser_missing/broken）
- **ASR 数据模型已验证可统一**：whisper 输出 `segments[].{start, text}` 天然映射为 Cue，v0.2 接入 ASR 无需单独设计数据流；ai-knowlage 可作为 v0.2 本地后端的复用底座（已具备 yt-dlp + whisper + 知识库管理）
- 与 ai-knowlage 的关键差异：它是转存场景、拿到字幕后**丢弃时间戳**；本项目时间戳是核心资产，解析必须保留 `from/to` 产出 Cue，不可合并为纯文本

### 7.2 Obsidian Local REST API

- 安装 Obsidian 插件 **Local REST API**，勾选 **Enable Non-encrypted (HTTP) Server**。
- 默认 `http://127.0.0.1:27124`，鉴权头 `Authorization: Bearer <api-key>`。
- 写入：`PUT /vault/{path}` + `Content-Type: application/json`（或 `text/markdown`）。
- 扩展需在 `host_permissions` 声明 `http://127.0.0.1:27124/*`。

**踩坑预警**：默认 HTTPS 端口 27123 使用自签证书，扩展直连会失败，务必切 HTTP 模式。

### 7.3 大模型

OpenAI 兼容端点，默认 DeepSeek。配置项全部可在设置页覆盖：

```ts
interface ModelConfig {
  baseUrl: string;      // 默认 https://api.deepseek.com
  apiKey: string;
  model: string;        // 默认 deepseek-chat
  temperature: number;  // 大纲 0.2 / 问答 0.4
  maxTokens: number;
}
```

模型标识以官方文档当前版本为准，代码中不硬编码版本号。

---

## 8. 成本与性能预算

以 60 分钟视频（约 12000 字字幕）为例，量级估算：

| 环节 | 输入 token | 输出 token | 说明 |
|---|---|---|---|
| 大纲生成 | ~25k（分 7 块） | ~3k | 并发度 3，约 3 轮 |
| 术语解释（单次） | ~1.5k | ~0.6k | 只喂命中区间 |
| 区间问答（单次） | ~2k | ~0.8k | |

按 DeepSeek 档定价，单次大纲生成量级约**数分人民币**，术语解释/问答单次约**千分之一元**级别。实际以运行后统计为准，插件内置"本次会话累计消耗"显示。

性能目标：

- 60 分钟视频大纲生成 P90 ≤ 45 秒，首章节可见 ≤ 12 秒（流式渲染）；
- 划词解释首字返回 ≤ 1.5 秒；
- 大纲跟随高亮延迟 ≤ 500ms。

---

## 9. 工程结构

```
video-study-copilot/
├── manifest.json                 # MV3，声明 host_permissions
├── src/
│   ├── background/               # Service Worker：调度、缓存、模型调用
│   │   ├── index.ts
│   │   ├── pipeline/outline.ts   # 分段 map-reduce
│   │   ├── pipeline/explain.ts
│   │   ├── context/compiler.ts   # 上下文选段与 token 预算
│   │   └── harness/              # 工具注册表、重试、预算、追踪
│   ├── content/                  # 注入脚本：播放器监听、划词浮层
│   │   ├── bilibili.ts
│   │   ├── youtube.ts
│   │   └── selection.ts
│   ├── providers/                # 字幕采集：有序瀑布（见 §7.1）
│   │   ├── waterfall.ts          # 瀑布编排 + 状态透传（FetchResult）
│   │   ├── bilibili.ts           # 一级：官方字幕轨（wbi 签名）
│   │   ├── manual-paste.ts       # 二级：手动粘贴（v0.1 终点）
│   │   └── errors.ts             # 错误指纹分类（need_login/api_changed/network）
│   ├── sinks/obsidian.ts         # Local REST API 写入
│   ├── panel/                    # React Side Panel
│   │   ├── OutlineTab.tsx
│   │   ├── MindmapTab.tsx        # markmap
│   │   └── ChatTab.tsx
│   ├── prompts/                  # 运行时 prompt 模板
│   ├── schemas/                  # Zod 输出校验
│   └── types.ts
├── .agents/skills/               # 开发期 SKILL.md
│   ├── outline-generation/SKILL.md
│   ├── term-explainer/SKILL.md
│   ├── segment-qa/SKILL.md
│   └── knowledge-capture/SKILL.md
└── tests/
```

`manifest.json` 关键权限：

```json
{
  "manifest_version": 3,
  "host_permissions": [
    "https://api.bilibili.com/*",
    "https://*.hdslb.com/*",
    "https://www.youtube.com/*",
    "https://api.deepseek.com/*",
    "http://127.0.0.1:27124/*"
  ],
  "permissions": ["storage", "sidePanel", "activeTab", "scripting"]
}
```

---

## 10. 开发期 SKILL.md 规范

四个 skill 遵循 Agent Skills 开放标准（agentskills.io）：YAML frontmatter 仅需 `name` + `description`，`description` 即触发器，正文控制在 5000 token 内，长材料放 `references/`。

| Skill | description 触发条件 | 正文要点 |
|---|---|---|
| `outline-generation` | 生成或修改视频大纲/章节/markmap 逻辑时 | 分块策略、时间吸附规则、合并去重规则、JSON Schema |
| `term-explainer` | 实现术语解释、划词释义时 | 上下文选段规则、视频语境与通用定义分离、禁止编造 |
| `segment-qa` | 实现区间提问、时间轴选段问答时 | 区间解析、证据优先、不足时显式声明 |
| `knowledge-capture` | 实现写入 Obsidian、笔记与术语卡生成时 | frontmatter 契约、目录规则、去重与合并策略 |

---

## 11. 里程碑

| 阶段 | 交付物 | 验收标准 |
|---|---|---|
| M1 骨架 | manifest、Side Panel 空壳、B 站 videoId 识别 | 扩展可加载，侧栏在 B 站视频页自动打开 |
| M2 字幕 | B 站字幕抓取 + 规范化 + IndexedDB 缓存 | 同一视频二次打开零请求秒开 |
| M3 大纲 | 分段 map-reduce + 时间吸附 + 大纲渲染 | 60 分钟视频 P90 ≤ 45s，时间戳点击跳转误差 ≤ 2s |
| M4 导图 | markmap 渲染 + 播放跟随高亮 | 高亮延迟 ≤ 500ms |
| M5 问答 | 划词解释 + 区间提问 + 上下文选段 | 首字 ≤ 1.5s，输出 100% 通过 Schema 校验 |
| M6 沉淀 | Obsidian 写入 + 术语卡 + 去重 | 笔记带完整 frontmatter，可跳回原片时间点 |

---

## 12. 风险与开放问题

| 风险 | 等级 | 应对 |
|---|---|---|
| B 站 wbi 签名或接口变更 | 高 | 抓取层做成可替换适配器；失败降级手动粘贴 |
| 模型输出时间戳漂移 | 高 | 强制吸附到真实 Cue 边界 + Schema 校验重试 |
| 长视频成本失控 | 中 | 分块 + 缓存 + 模型版本定向失效 + 会话消耗可视化 |
| Obsidian HTTPS 自签证书 | 中 | 文档强制要求切 HTTP 模式，设置页做连通性自检 |
| key 明文存本地 | 中 | 仅个人自用；设置页显著提示；v0.2 考虑系统钥匙串 |
| 无字幕视频无法处理 | 中 | v0.1 明确降级路径；v0.2 复用 ai-knowlage 转录能力（见 §13.1） |
| 跨视频检索缺失 | 低 | v0.2 引入本地后端后再做（ai-knowlage 可作底座） |

**待你确认的开放问题**：

1. YouTube 是否在 v0.1 就纳入，还是 M6 之后再补？（影响 `providers/youtube.ts` 排期）
2. 术语卡与视频笔记是否分目录存放，还是术语统一进一个 `术语/` 库？
3. 是否需要"学习进度"记录（看到第几章、下次续看）？

---

## 13. 复用资产与参考项目

### 13.1 ai-knowlage（用户自有项目，重点复用）

**路径**：`/Users/wangxiaoheng/CodeBuddy/ai-knowlage`
**性质**：Python 服务端"视频采集 + 转写 + 知识库"系统（yt-dlp / openai-whisper / aiohttp 技术栈，含 web 端、调度器、知识库管理）
**对项目最大价值**：其视频内容采集链路已在实际使用中验证过，是 §7.1 有序瀑布设计的来源；v0.2 本地后端可直接复用而非重写。

模块地图（移植时按此索引）：

| 模块 | 职责 | 对本项目的用途 | 移植时机 |
|---|---|---|---|
| `src/social_video_extractor.py` | 抖音 _ROUTER_DATA SSR 解析（移动端 UA + `iesdouyin.com/share/video/{id}` + 无水印直链 `playwm→play`）；配置驱动零硬编码 | v0.2 抖音适配器的参考实现（含完整正则/端点/page_keys） | v0.2 |
| `src/ytdlp_extractor.py` | yt-dlp metadata-only 通用通道（1800+ 站）+ `fetch_subtitle()` 字幕通道 + cookie 四态状态机（错误文本指纹） | 字幕语言/格式优先级策略、错误指纹分类、rolling caption 去重逻辑 TS 移植 | v0.1（逻辑移植）/ v0.2（能力复用） |
| `src/local_whisper_fallback.py` | 无字幕兜底：worst 画质下载 → ffmpeg 抽音 → whisper 转录 → 清理中间文件；8 态状态机，`min_chars=30` 防假成功 | v0.2 ASR 兜底的直接底座；状态机设计沿用 | v0.2 |
| `src/video_processor.py` | 下载与转写编排；whisper 输出 `segments[].{start, text}` | 验证了 ASR 输出与 Cue 结构天然映射 | 已采纳进数据模型 |
| `src/submit_handler.py` | 四级瀑布总编排，失败永不阻断、状态透传 metadata | 瀑布编排模式 + 状态透传给 UI 的方式 | 已采纳进 §7.1 |
| `src/anti_scrape_utils.py` | 随机 UA / 随机延迟 | 请求礼貌性策略参考 | v0.1 |

**移植注意（方向性差异）**：ai-knowlage 是"转存"场景，拿到字幕后**主动丢弃时间戳**（`_strip_timestamps`、`fetch_subtitle` 合并去时间轴）；本项目时间戳是核心资产，任何移植的解析逻辑必须保留 `from/to` 产出 Cue，禁止合并为纯文本。

**v0.2 复用方式**：扩展通过 Native Messaging 或 localhost HTTP 桥调用 ai-knowlage 的转录能力（无字幕视频丢给它，回传 `segments[]` 转 Cue），避免在扩展内实现 yt-dlp/ffmpeg/whisper。届时需为其增加一个轻量 bridge 端点。

### 13.2 其他参考项目

| 项目 | 参考点 |
|---|---|
| BiliNote（开源） | B 站 wbi 签名算法（mixin key）的参考实现 |
| youtube-digest / bilibili-digest（MIT） | 架构蓝本与提示词参考（Digest for Bilibili 即源自前者） |
| Bilibili Obsidian Clipper（开源） | B 站字幕 → Obsidian Local REST API 的既有实践，含 HTTP 模式踩坑 |
