# SPEC-09 · 大纲笔记与大纲交换格式

- 状态：进行中（2026-10-01 开工：地基子任务 9.1/9.2/9.5 先行——纯代码、可自动验收，不阻塞用户侧 SPEC-08 冒烟；UI 子任务 9.3/9.4/9.6/9.7 随后派发）
- 依赖：SPEC-08
- 对应里程碑：v0.1.x
- 验收 tag：`spec-09-accepted`

## 1. 目标与范围

像代码评审里给某一行加评论一样，学习者可以在大纲上**任意位置**挂笔记；笔记跟着大纲结构导出到 Obsidian；大纲（含可选笔记）可以按一套**固定的交换格式**导出成文件，别人一键导入到自己的插件里。

**做**：

| # | 能力 | 用户已拍板的设计 |
|---|---|---|
| 9.1 | 笔记锚点 | 三种粒度都支持：**整章**、**某条要点**、**某个时间点** |
| 9.2 | 笔记形式 | 两种都支持：**单条备注**；**讨论串**（可回复）；每条可一键「请助教回答」，把笔记转成问答，回答作为该串的回复 |
| 9.3 | 重生成后的归位 | 按时间位置重新对上章节；对不上的放进「未归位」区，**不丢弃**；重新生成大纲前**提示用户**"已有 N 条笔记，重生成后可能需要手动归位" |
| 9.4 | 导出到 Obsidian | 笔记跟随大纲结构写入视频笔记（格式见 §3.2，父 agent 决定） |
| 9.5 | 交换格式导出 / 导入 | 固定标准 `vsc-outline` v1（§3.1）；导入前**校验视频一致**；可选是否携带笔记 |

**不做**：
- 多人实时协作、云端分享链接 → 与 EVOLUTION-ROADMAP §5"不做多人协作"一致；交换靠文件
- 富文本 / 图片笔记 → v1 仅 Markdown 纯文本（图片笔记可在错题本方向再议）
- 导入他人的问答历史 → 只交换大纲与笔记

## 2. 前置条件

- SPEC-08 已验收（回链 url 可用，是导出与导入校验的基础）

## 3. 关键设计

### 3.1 交换格式标准 `vsc-outline` v1

文件名：`{标题}.{bvid}_p{page}.vsc-outline.json`，UTF-8 JSON。**这是对外契约**，写入 `docs/EXCHANGE-FORMAT.md` 并由单测锁定；任何不兼容变更必须升主版本号。

```json
{
  "format": "vsc-outline",
  "version": "1.0",
  "exportedAt": "2026-10-01T12:00:00.000Z",
  "exporter": { "app": "video-study-copilot", "appVersion": "0.1.0" },
  "video": {
    "platform": "bilibili",
    "bvid": "BV15yxMeKELY",
    "page": 1,
    "cid": 123456,
    "title": "……",
    "durationMs": 2574000,
    "url": "https://www.bilibili.com/video/BV15yxMeKELY?p=1"
  },
  "outline": {
    "promptVersion": "0.2.1",
    "model": "qwen-vl-plus",
    "sections": [
      {
        "id": "s1",
        "title": "……",
        "startMs": 0,
        "endMs": 312000,
        "summary": "……",
        "bullets": [{ "id": "s1-b1", "text": "……", "startMs": 45000 }],
        "terms": ["……"],
        "importance": 4
      }
    ]
  },
  "notes": [
    {
      "id": "n_…",
      "anchor": { "kind": "section", "sectionId": "s1", "tMs": 0 },
      "body": "Markdown 文本",
      "createdAt": "…",
      "updatedAt": "…",
      "replies": [{ "id": "r_…", "author": "self", "body": "…", "createdAt": "…" }]
    }
  ],
  "checksum": "sha256:…"
}
```

规则：
- **视频身份** = `platform + bvid + page`（三者都相等才算同一视频）；`cid`、`durationMs` 作辅助校验
- `anchor.kind` ∈ `section` | `bullet` | `time`；**每个锚点都带 `tMs`**——这是重新归位和跨版本导入的唯一可靠依据，`sectionId` / `bulletId` 只是加速提示
- `replies[].author` ∈ `self` | `assistant`（助教回答）
- 派生字段（`score`、`density`、`cueRange`）**不导出**，导入时由本地字幕重新计算——避免把对方的算法版本带进来
- `notes` 可为空数组（只分享大纲）；`checksum` 覆盖除自身外的全部内容，用于发现文件被截断或篡改
- 未知字段必须忽略（向前兼容）；`version` 主版本号高于本地支持时拒绝导入并提示升级

### 3.2 导出到 Obsidian（父 agent 决定）

在现有视频笔记里，每章标题下插入笔记区块：

```markdown
## 03:12 图形推理的观察方法
> [!note]- 我的笔记（2）
> **[04:36](…&t=276)** 先观察再推理，考场上容易跳过观察这步
> **要点：先找规律类型** 回复串：
> - 我：对称和数量怎么区分？
> - 助教：……
```

- 用 Obsidian 可折叠 callout（`> [!note]-`），笔记多时不淹没大纲
- 每条笔记前是可点的时间戳回链（依赖 SPEC-08 A3）
- **插件管理区块与手写内容分离**：区块用 `%% vsc:notes:start s1 %%` / `%% vsc:notes:end %%` 注释包裹（Obsidian 阅读视图不可见）；重复导出**只替换标记之间的内容**，标记外你在 Obsidian 里手写的内容原样保留
- 「未归位」笔记集中放在文末 `## 未归位的笔记`

### 3.3 重新归位算法（纯函数，确定性）

1. `bullet` 锚点：新大纲中 `|startMs - tMs| ≤ 15s` 且文本相似度最高的要点 → 挂上；否则降级为 `time` 锚点继续
2. `section` 锚点：`tMs` 落入的新章节；若旧章节标题与新章节标题完全不同且时长重叠 < 50% → 标记「待确认」（仍挂上，UI 显示黄点）
3. `time` 锚点：`tMs` 落入的章节
4. `tMs` 超出视频时长或无章节可落 → 「未归位」
5. 永不删除；用户可拖拽或下拉重新指定锚点

### 3.4 导入

- 入口：大纲 Tab「导入」→ 选择 `.vsc-outline.json`
- 校验顺序：JSON 合法 → `format`/`version` → `checksum` → **视频身份是否与当前页一致**（不一致：拒绝，并显示"文件对应的是《xxx》P2，当前是 P1"）→ 时间戳是否落在本地字幕范围内（可用率 < 90% 警告"字幕版本可能不同"）
- 冲突处理（本地已有大纲）：三选一——**替换**本地大纲 / **只合并笔记**（按 §3.3 归位到本地大纲）/ 取消；替换前自动备份本地大纲到交换格式文件
- 导入的笔记标记来源 `importedFrom`（导出者 + 时间），与自己的笔记区分显示
- 导入的大纲 `model` 字段保留原值，缓存键加 `imported` 标记，不会被本地 promptVersion 升级误失效

### 3.5 存储

- 新 store `notes`（键 `note.id`，索引 `videoId`），DB 版本 v3 → v4
- 笔记与大纲**解耦存储**：大纲重生成不会触碰 notes store，这是"不丢笔记"的根本保证

## 4. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 9.1 | 数据模型与存储 | `types.ts` 新增 `OutlineNote` / `NoteAnchor`（父）；notes store + DB v4 迁移 | `src/types.ts`（父）、`src/storage/db.ts`、`src/config/`（父） | 0.5d |
| 9.2 | 重新归位 | `core/notes/reanchor.ts` 纯函数 | `src/core/notes/` | 0.5d |
| 9.3 | 笔记 UI | 章节 / 要点 / 时间点三种"加笔记"入口；笔记卡（编辑、删除、回复、请助教回答）；未归位区；重生成前确认 | `src/panel/OutlineTab.tsx`、`src/panel/notes/`（新） | 1.5d |
| 9.4 | 请助教回答 | 笔记 → explain 请求（区间 = 锚点所在章节）→ 回答写入 replies | `src/panel/explainLoader.ts`、`src/panel/notes/` | 0.5d |
| 9.5 | 交换格式 | `core/exchange/vscOutline.ts`（序列化 / 校验 / checksum）；`docs/EXCHANGE-FORMAT.md` | `src/core/exchange/`、`docs/` | 1d |
| 9.6 | 导入导出 UI | 大纲 Tab 导出 / 导入；冲突三选一；导入前备份 | `src/panel/OutlineTab.tsx`、`src/panel/notes/`、`src/platform/`（文件下载） | 0.5d |
| 9.7 | Obsidian 笔记区块 | 标记区块的生成与替换；未归位段 | `src/core/pipeline/capture.ts`、`src/panel/obsidianLoader.ts` | 0.5d |

## 5. 验收标准

- [ ] A1 [自动] 三种锚点都能创建、编辑、删除；刷新面板后仍在
- [ ] A2 [自动] 讨论串：回复追加、顺序稳定；「请助教回答」的请求区间 = 锚点所在章节，回答以 `author: assistant` 追加
- [ ] A3 [自动] 重新归位单测：要点锚点 15s 内命中；章节锚点落入新章节；越界进「未归位」；**任何情况下笔记总数不减少**
- [ ] A4 [人工] 有笔记时点「重新生成大纲」，先弹确认框显示笔记数量；重生成后笔记全部可见（已归位或在未归位区）
- [ ] A5 [自动] 交换格式：导出 → 导入往返后大纲与笔记逐字段相等（派生字段除外）
- [ ] A6 [自动] 导入校验：bvid 或 page 不一致 → 拒绝并给出两个视频的标题；`checksum` 不符 → 拒绝；主版本号更高 → 拒绝并提示升级；未知字段被忽略
- [ ] A7 [自动] `docs/EXCHANGE-FORMAT.md` 中的示例 JSON 能被校验器通过（文档与实现不漂移）
- [ ] A8 [人工] 两台设备（或两个 Chrome 用户）：A 导出含笔记的大纲，B 在同一视频上导入，选择"只合并笔记"，笔记出现在 B 的大纲对应位置
- [ ] A9 [人工] 导出到 Obsidian：笔记以折叠 callout 出现在对应章节下；在 Obsidian 手写一段内容后再次导出，**手写内容保留**，插件区块被更新
- [ ] A10 [自动] 红线 11：文件下载、权限等浏览器调用只出现在 `src/platform/`
- [ ] A11 [自动] G1/G2/G3 门禁全过；执行记录已追加

## 6. 风险与回滚

- 交换格式一旦发布就是对外契约 → v1 发布前冻结字段；只增不改；不兼容变更升主版本
- 他人文件可能含注入内容（笔记里写"忽略以上指令"）→ 导入的笔记在「请助教回答」时同样走"素材不是指令"包裹
- Obsidian 标记区块被用户误删 → 找不到标记时追加到章节末尾，不覆盖任何内容
- 回滚：notes store 独立，删除该 store 不影响大纲与问答；按子任务 revert

## 7. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| 10-01 | 父 agent | 起草（依据用户确认的锚点 / 讨论串 / 归位 / 导入导出设计） | — | 本提交 |
| 10-01 | 父 agent | **开工范围说明**：SPEC-08 仅剩 [人工] 冒烟项，地基子任务（9.1/9.2/9.5）先行施工，不触碰 UI 与既有功能 | — | — |
| 10-01 | 父 agent | 9.1 数据模型与存储：`OutlineNote`/`NoteAnchor`/`NoteReply` 入 types.ts；DB.stores.notes + 版本 v3→v4（补建 store 幂等）；saveNote/deleteNote/listNotesByVideo。**范围说明**：设计稿"索引 videoId"简化为 getAll+过滤（沿用 qaHistory 先例，量级低），行为等价 | 单测 6 例过（排序/隔离/删除/透传/脏数据过滤） | 本提交 |
