# SPEC-02 · 字幕采集瀑布与字幕 Tab

- 状态：待开工
- 依赖：SPEC-01
- 对应里程碑：M2
- 验收 tag：`spec-02-accepted`

## 1. 目标与范围

**做**：
- `core/subtitle/normalize.ts`：Cue 规范化——合并 < 800ms 相邻段、去纯语气词段、去连续重复行（rolling caption，逻辑参照 ai-knowlage `_normalize_subtitle_text`，**保留时间戳**）
- `core/subtitle/parsers.ts`：B 站字幕 JSON、SRT、VTT、纯文本四种解析器，全部输出 Cue[]；纯文本按字数速率估算时间并标记 `approximate: true`
- `providers/wbi.ts`：nav → mixin key（按日缓存）→ 参数签名
- `providers/bilibili.ts`：view 取分 P cid → wbi/v2 取字幕列表 → 选轨（UP 主优先于 AI，中文优先）→ 拉取字幕 JSON
- `providers/errors.ts`：按 TECH-DESIGN §7.1 错误分类表判定 status，`need_login_subtitle` 优先于 `no_subtitle`
- `providers/manual-paste.ts` + 字幕 Tab 内的粘贴入口
- `providers/waterfall.ts`：按序执行、返回 FetchResult、不抛异常
- `storage/db.ts`：IndexedDB 封装，本期实现 `subtitles` store
- **字幕 Tab**：全文字幕列表、当前句跟随播放高亮并自动滚动、点击句子跳播、来源与降级原因提示（如"未登录 B 站，登录后可获取字幕"）
- **fixtures**：录制测试课程接口响应，清洗后存入 `tests/fixtures/recorded/`

**不做**：模型调用与大纲（SPEC-03）；划词浮层（SPEC-05）；ASR（v0.2）。

## 2. 前置条件

- SPEC-01 已验收
- 用户在 Chrome 中已登录 B 站
- 测试视频集：`tests/fixtures/bv-cases.md`

## 3. 执行方案

| # | 子任务 | 交付物 | 允许修改的路径 | 预估 |
|---|---|---|---|---|
| 2.1 | 规范化与解析器 | normalize.ts、parsers.ts 及单测 | `src/core/subtitle/`、`tests/unit/subtitle/` | 0.5d |
| 2.2 | B 站一级通道 | wbi.ts、bilibili.ts、errors.ts 及单测 | `src/providers/`（除 manual-paste）、`tests/unit/providers/` | 1d |
| 2.3 | 瀑布、手动粘贴与缓存 | waterfall.ts、manual-paste.ts、storage/db.ts | `src/providers/`、`src/storage/`、对应单测 | 0.5d |
| 2.4 | 字幕 Tab | SubtitleTab.tsx、跟随高亮、跳播、降级提示、粘贴入口 | `src/panel/SubtitleTab.tsx`、`src/panel/components/` | 1d |
| 2.5 | 登录态探测与录制 | 覆盖率统计、fixtures 录制与清洗脚本、回放测试 | `tests/fixtures/`、`scripts/record-fixtures.mjs`、`tests/replay/` | 0.5d |

## 4. 验收标准

- [ ] A1 [自动] 规范化单测：< 800ms 合并、语气词剔除、rolling caption 去重，且每条输出 Cue 均含 startMs/endMs（红线 5）
- [ ] A2 [自动] 解析器单测：B 站 JSON / SRT / VTT / 纯文本各 ≥ 3 例；纯文本估算时间的 Cue 均带 `approximate: true`
- [ ] A3 [自动] wbi 签名单测：给定固定 img/sub key 与 wts，`w_rid` 与已知正确值一致
- [ ] A4 [自动] 错误分类单测：覆盖 §7.1 表中五种条件；"空列表 + need_login_subtitle=true"必须判为 `need_login`
- [ ] A5 [自动] 回放测试：用 recorded fixtures 离线跑完整瀑布，登录态响应 → `ok`，未登录响应 → `need_login` 并降级到手动粘贴，全程无未捕获异常（红线 8）
- [ ] A6 [人工] **登录态覆盖率预检**：在已登录 Chrome 中打开测试课程 P2~P11，记录每集字幕轨类型并回填 `bv-cases.md` §2.2。命中率 < 60% 时升级为决策事件（云 ASR 是否提前），由用户拍板后才可继续 SPEC-03
- [ ] A7 [人工] 多 P：P2 → P3 → P11 依次切换，字幕 Tab 内容随分 P 更换，IndexedDB 中三条记录互不覆盖
- [ ] A8 [人工] 缓存：P2 第二次打开时 DevTools Network 无 B 站字幕相关请求，字幕立即显示
- [ ] A9 [半自动] 字幕 Tab：粘贴一段 SRT 后正确显示并可点击；粘贴纯文本后显示"时间为估算"
- [ ] A10 [人工] 播放跟随：当前句高亮与语音基本同步，点击任意句子跳播误差 ≤ 2s
- [ ] A11 [自动] 缺口补齐：若 §2.2 显示本课程缺少"UP 主字幕 / 仅 AI 字幕 / 无字幕"任一类，已在 `bv-cases.md` 补入对应视频并完成录制
- [ ] A12 [自动] G1/G2/G3 门禁全过；执行记录已追加；打 tag `spec-02-accepted`

## 5. 风险与回滚

- wbi 算法随 B 站前端更新失效 → 独立文件 + 签名单测 + 回放回归，错误分类归为 `api_changed`
- 录制文件泄露敏感信息 → 清洗脚本剔除 cookie、SESSDATA、w_rid、wts；未清洗文件只存 `tests/fixtures/raw/`（git 忽略）
- 命令行探测 B 站需绕过本机代理（`--noproxy '*'`），扩展运行不受影响
- 回滚：provider 与 core/subtitle 独立，回退对应 commit 不影响骨架

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 | commit |
|---|---|---|---|---|
| 2026-09-30 | 父 agent | 开工前匿名探测：wbi 签名有效；测试课程 P1~P11 均返回空字幕列表且 need_login_subtitle=true | 确认错误分类需优先判定登录要求；登录态覆盖率待 A6 | — |
