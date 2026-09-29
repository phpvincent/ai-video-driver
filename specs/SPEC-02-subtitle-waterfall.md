# SPEC-02 · 字幕采集瀑布

- 状态：待开工
- 依赖：SPEC-01
- 对应里程碑：M2
- 执行者：（派发时填写）

## 1. 目标与范围

**做**：
- `providers/waterfall.ts`：瀑布编排器，按序尝试各级，返回统一 `FetchResult { cues, status }`，失败不抛异常
- `providers/bilibili.ts`：一级通道——view 接口取 cid → wbi 签名调 player 接口 → subtitle_url → 拉取 JSON → Cue[]
- `providers/errors.ts`：错误指纹分类（no_subtitle / need_login / api_changed / network），参考 ai-knowlage ytdlp_extractor 的指纹法
- `providers/manual-paste.ts`：二级通道——侧栏粘贴文本/SRT，解析为 Cue[]（SRT/VTT 解析 + 时间戳保留）
- Cue 规范化：合并 <800ms 相邻段、去纯语气词段、rolling caption 连续重复行去重（移植 ai-knowlage `_normalize_subtitle_text` 逻辑，**但保留时间戳**）
- IndexedDB 缓存：按 videoId 存 cues + status + modelVersion，命中零网络请求
- wbi 签名实现：mixin key 算法，参考 BiliNote

**不做**：模型调用、大纲生成（SPEC-03）；云 ASR / 本地 whisper（v0.2）。

## 2. 前置条件

- SPEC-01 已验收
- B 站账号已登录（AI 字幕需登录态，扩展背景请求自动带 cookie）

## 3. 执行方案（可拆为 4 个子任务派发）

| # | 子任务 | 交付物 | 预估 |
|---|---|---|---|
| 2.1 | Cue 类型 + 规范化 | types.ts Cue/Section、normalize 单测（含 rolling caption 用例） | 0.5d |
| 2.2 | B 站一级通道 | wbi 签名、cid/字幕拉取、错误分类；用真实视频联调 | 1d |
| 2.3 | 手动粘贴二级通道 | SRT/VTT/纯文本三格式解析器 + panel 粘贴 UI | 0.5d |
| 2.4 | 瀑布编排 + 缓存 | waterfall.ts、IndexedDB 封装、缓存命中策略 | 0.5d |

## 4. 验收标准（父 agent 逐条执行）

- [ ] A1 单测：归一化规则全覆盖——<800ms 合并、语气词剔除、rolling caption 去重、时间戳不丢失（红线 5）
- [ ] A2 单测：SRT/VTT/纯文本解析器各 ≥3 用例（含边界：缺时间戳的纯文本按 5s 均分）
- [ ] A3 联调：选 3 个真实 B 站视频（有官方字幕 / 仅 AI 字幕 / 无字幕），分别返回 status=ok / ok / no_subtitle，**无字幕时瀑布降级到手动粘贴 UI，全程无未捕获异常**（红线 8）
- [ ] A3b **多 P 课程**：videoId 必须为 `{bvid}_p{page}`（cid 按 page 获取）。用多 P 教程视频验证：切 P 后字幕/大纲随新 page 重建，缓存互不污染
- [ ] A3c **字幕覆盖率预检**（MVP 模式验证的关键数据）：从用户实际学习清单挑 10 个目标视频跑一级通道，统计命中率写入执行记录。**若 <60%，升级为决策事件**：云 ASR（EVOLUTION-ROADMAP §3 第一项）是否提前，父 agent 评估后记迭代日志
- [ ] A4 缓存：同一视频第二次打开，DevTools Network 面板零 B 站请求，字幕秒出；缓存记录含 modelVersion（红线 7）
- [ ] A5 need_login 场景模拟（清 cookie 或未登录窗口）：status 正确透传到 UI 提示
- [ ] A6 G1/G2/G3 门禁全过；执行记录已追加

## 4b. 回归测试集（fixtures）

建立 `tests/fixtures/bv-cases.md`：固定 5 个 BV 号（官方字幕/AI 字幕/无字幕/多 P/长视频各一），SPEC-02/03 联调验收一律用此清单，接口变更时同一清单回归，禁止临时随手找视频。

## 5. 风险与回滚

- 风险：wbi 算法随 B 站前端更新失效 → 签名模块独立成文件，附回归测试视频固定 BV 号清单
- 风险：subtitle_url 域名不在 host_permissions → 已含 hdslb.com，验收时确认
- 回滚：provider 层独立，revert 不影响 SPEC-01 骨架

## 6. 执行记录（append-only）

| 日期 | 执行者 | 变更摘要 | 自测结果 |
|---|---|---|---|
| — | — | — | — |
