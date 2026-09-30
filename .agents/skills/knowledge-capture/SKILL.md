---
name: knowledge-capture
description: 需要修改或排查知识沉淀相关逻辑时使用：涉及 Obsidian 笔记/术语卡的 frontmatter 契约、目录规则、跳播链接、术语去重阈值、Local REST API sink 或存库按钮接线等工程规则。
---

# 知识捕获（knowledge-capture）

把视频学习内容沉淀为 Obsidian 笔记与术语卡：sink 写入（Local REST API）+ 捕获管道（纯函数）+ 存库按钮。运行时 prompt 见 `src/prompts/knowledge-capture.md`（单一事实源，红线 6：本文件只做引用，不复制 prompt 正文）。改动 prompt 正文必须递增其头部 `promptVersion` 注释。

## 职责边界（v0.1）

- frontmatter **只由代码组装**（`src/core/pipeline/capture.ts` 的 `buildFrontmatter`），模型不得生成或改写；契约见 TECH-DESIGN §4.7（title / source / url 带 `?p=` / video_id / duration 秒 / created / tags / type）。
- 术语重复度本期为**确定性相似度**（归一化后最长公共子序列比例，阈值 0.8，见 `findDuplicateTerm`），模型评分推迟；命中时提示合并，**不得静默新建**。
- prompt 文件定位为未来模型辅助摘要生成的单一源，本期不参与落盘链路（不得在其正文中复制实现细节之外的第二份契约）。

## sink（TECH-DESIGN §7.3）

- 写入 `PUT /vault/{path}`，Bearer 鉴权，Content-Type `text/markdown`；路径**逐段** URL 编码（`/` 保留为分隔符）。
- 必须使用 HTTP 模式：HTTPS 端口为自签证书，扩展直连会失败。
- 请求经 `ObsidianFetch` 注入（`src/sinks/obsidian.ts`），模块内不直接引用全局 fetch，错误分支全部靠注入覆盖。
- 错误分类给出可操作指引：连接失败 → 确认 Obsidian 已启动且插件已开启 HTTP 模式；401/403 → 检查 API Key；404 → 检查笔记根目录；5xx → 插件侧异常。
- 端点与密钥：baseUrl 默认值只来自 `src/config`（`OBSIDIAN.baseUrl`），代码与测试中不得出现端点或密钥字面量（红线 9）。

## 目录与链接（分层目录，借鉴 ai-knowlage）

- 视频笔记 `{root}/视频笔记/{课程}/{标题}.md`（v0.1 课程目录取 bvid），术语卡扁平存放 `{root}/术语/{术语}.md`（不做子分类）。
- 跳播链接 `{url}?p={page}&t={秒}`，秒 = `floor(startMs / 1000)`（TECH-DESIGN §7.2）；时间戳只取自吸附后的真实 Cue/章节时间（红线 2），不得采信模型编造的时间。
- 文件名非法字符 `/ \ : * ? " < > |` 替换为 `_`（`sanitizeFileName`），中文与空格保留，长度截断 60。

## 双索引与摘要预览

- 每次存库同步维护两份索引：`{root}/_meta/index.json`（机器检索，KnowledgeIndexEntry）与 `{root}/_索引.md`（人类可读 MOC，Obsidian `[[双链]]` 按 category 分组）。
- 索引按 `path` 去重覆盖（`upsertIndexEntry`），顺序确定：已存在则原位替换，否则追加。
- 每条笔记生成 ≤200 字 `summaryPreview`，二次检索只喂预览（红线 3 预算）；检索打分与关键词匹配全部确定性，无额外模型调用。

## 交互与存储

- 一律用户确认后写入，无自动落盘；存库按钮为可选 props 注入（未注入时隐藏），错误与成功提示均为行内文本，不打断面板（红线 8）。
- 术语卡同时写入 IndexedDB `terms` store（键 `[term, videoId]`）。
- 禁止绕过确定性去重静默新建术语卡：命中相似术语必须由 UI 提示合并后再决定。
