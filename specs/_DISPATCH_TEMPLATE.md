# 子 agent 派发包模板

> 父 agent 每次派发必须按本模板生成完整文本。子 agent 看不到主对话，派发包必须自足。

---

## 1. 任务定位

- 项目：video-study-copilot（Chrome MV3 扩展，B 站视频学习副驾）
- 仓库根目录：`<绝对路径>`
- Spec：`specs/SPEC-XX-*.md`，子任务 `X.Y`
- 本次目标（一句话）：

## 2. 背景摘录

从 TECH-DESIGN.md 原文摘录与本任务直接相关的章节（数据类型、接口契约、算法规则）。**摘录原文，不转述。**

## 3. 文件边界

- **允许修改**：逐个列出文件或目录
- **只读参考**：`src/types.ts`、`src/messages.ts`、`src/config/`（共享契约，需要变更时在回报中提出，不得自行修改）
- **禁止触碰**：治理文档（CONSTITUTION / TECH-DESIGN / ITERATION-LOG / EVOLUTION-ROADMAP / specs/）以及上面未列出的所有文件

## 4. 技术红线

粘贴 CONSTITUTION §6 红线表全文。

## 5. 完成定义（DoD）

- [ ] 功能代码完成
- [ ] 对应单测完成且 `npm test` 全绿
- [ ] `npm run build` 零错误
- [ ] `npm run check:redlines` 通过
- [ ] 在 spec 执行记录追加一行（日期 / 执行者 / 摘要 / 自测结果 / commit）
- [ ] 本地 commit：`<type>(spec-XX): <摘要>`（不 push，由父 agent 验收后推送）

## 6. 回报格式

```
## 改动文件
- path — 新增 / 修改，一句话说明

## 自测
- 命令：…
- 输出摘要：…（贴关键行，不贴全文）

## 与 spec 的偏差
- 无 / 逐条说明原因

## 需要父 agent 处理
- 共享契约变更需求 / 阻塞项 / 需要用户提供的输入
```
