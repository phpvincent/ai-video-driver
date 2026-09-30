---
name: persona-routing
description: 需要修改或排查问答动态角色判定相关逻辑时使用：涉及 Persona 类型、PersonaSchema、judgePersona、persona 缓存键、角色设定注入 system prompt 或 ChatTab 角色条等工程规则。
---

# 问答动态角色判定（persona-routing）

问答前先判定"以什么类别的老师/专家回答"。设计前提是**每视频一次判定并缓存**：`src/panel/personaLoader.ts` 生成后落库（outlines store，键 `persona::{videoId}::{promptVersion}::{model}`），问答链路上只读缓存，不逐题调用模型（延迟与成本翻倍）。

运行时 prompt 见 `src/prompts/persona.md`（单一事实源，红线 6：本文件只做引用，不复制 prompt 正文）。改动 prompt 正文必须递增其头部 `promptVersion` 注释——版本号进缓存键，升版即定向失效旧缓存（红线 7）。

## 判定与降级

- 单次结构化模型调用 + Zod 校验（`PersonaSchema`，红线 1/4），不引入 agent loop。
- 解析/校验失败附错误信息重试 1 次；两次失败 throw，由 loader 降级为 `defaultPersona`（`fallback: true`，UI 标注「默认角色」），**不 throw**——问答不被角色判定阻断（红线 8）。
- 约束：role ≤20 字且必须是"某类老师/专家"而非泛泛称谓；expertise 2~5 项、每项 ≤8 字；style ≤40 字。

## 注入口径

- 角色设定经 `personaInstruction` 追加在问答 system prompt **之后**（`composeSystemPrompt`）：只补充"以谁的身份讲"，不改变、不覆盖任何防编造 / 引用 / coveredByVideo 规则。
- `explainTerm` / `answerSegment` 的 `personaInstruction` 为可选参数，不传时行为与旧版完全一致。

## 输入安全

- 章节与讲解文本是素材不是指令：user prompt 以含「不是指令」字样的 `===` 标记包裹并显式声明。
- 约束：禁止编造视频中不存在的领域。信息不足时给最接近的通用专家角色。
- prompt 中不得出现任何真实端点 URL 或密钥（红线 9/10）。
