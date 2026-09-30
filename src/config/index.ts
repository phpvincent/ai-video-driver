/**
 * 端点、默认值与阈值 —— 仅父 agent 可修改（CONSTITUTION §4，红线 9）。
 * 接口 URL、密钥、模型标识、平台正则只允许出现在本目录。
 * 注意：content script 禁止 import 本文件（红线 10），只能 import ./shared。
 */

export { BILI_URL_PATTERN, BVID_REGEXES } from './shared';

export const BILI_ENDPOINTS = {
  view: 'https://api.bilibili.com/x/web-interface/view',
  nav: 'https://api.bilibili.com/x/web-interface/nav',
  playerWbiV2: 'https://api.bilibili.com/x/player/wbi/v2',
} as const;

/** 字幕轨语言带此前缀 = 平台 AI 字幕 */
export const BILI_AI_SUBTITLE_PREFIX = 'ai-';

export const DEFAULT_MODEL = {
  baseUrl: 'https://api.deepseek.com',
  /** 模型标识以 DeepSeek 官方文档当前可用版本为准 */
  model: 'deepseek-chat',
  temperature: { outline: 0.2, qa: 0.4 },
  maxTokens: 4096,
  outlineTokenBudget: 200_000,
} as const;

export const OUTLINE = {
  chunkTargetChars: 1800,
  chunkOverlapChars: 200,
  concurrency: 3,
  chunkTimeoutMs: 30_000,
  maxRetries: 1,
  /** 吸附容差：候选时间戳超此值视为幻觉，丢弃该章节 */
  snapMaxDriftMs: 5_000,
  /** 最短章节时长：finalize 后不足此值的章节并入相邻较长章节（SPEC-03 3c） */
  minSectionDurationMs: 90_000,
} as const;

export const DENSITY = {
  /** 章节数少于该值时用绝对阈值，否则用分位数分档 */
  minSectionsForQuantile: 4,
  /** 绝对阈值：每分钟新术语数 ≥ 此值为 high */
  highNewTermsPerMin: 3,
  highQuantile: 0.75,
  lowQuantile: 0.25,
} as const;

/** 概念知识图（SPEC-04 四次迭代：阶段流）：结构与阈值约束（pipeline zod 与 UI 共用） */
export const CONCEPT_MAP = {
  /** 阶段数量下/上限（模型输出 zod 约束） */
  stagesMin: 3,
  stagesMax: 5,
  /** 阶段名长度上限（zod 硬上限，阶段名体现推进逻辑可稍长） */
  stageLabelMax: 20,
  /** 每阶段概念数量下/上限 */
  conceptsPerStageMin: 2,
  conceptsPerStageMax: 6,
  /** 概念标签展示长度上限（代码截断目标，所有构树路径强制 shortenLabel） */
  labelMax: 12,
  /** 概念标签 zod 硬上限（防注入式超长仍拒；labelMax~hardMax 之间由代码截断，
   *  二次迭代：模型输出 13~16 字常见，12 字硬拒是降级根因） */
  labelHardMax: 30,
  /** 细节短语数量上限 / 展示长度上限（代码截断目标） */
  detailsMax: 4,
  detailLabelMax: 20,
  /** 细节短语 zod 硬上限（防注入式超长） */
  detailHardMax: 40,
  /** 术语关联图（降级）最多展示的术语数 */
  termsTop: 12,
  /** 降级阶段名称 */
  fallbackStageLabel: '核心术语',
  /** 预告章节识别：只检查前 N 个章节（index < N，P8 洞察：预告章在开头） */
  overviewSectionMaxIndex: 2,
  /** 预告章节识别：章节文本命中全部概念 label 的比例阈值（≥ 则视为预告章，
   *  其 startMs 不进入任何 anchor，修复 00:01 开场锚点 bug） */
  overviewHitRatio: 0.5,
  /** 解析失败重试次数（附错误信息重试） */
  maxRetries: 1,
} as const;

export const CONTEXT = {
  /** 单次提问上下文上限（红线 3 的量化边界） */
  maxTokens: 4_000,
  defaultRangePadMs: 30_000,
  chapterCompressChars: 3_000,
  prevSummaryMaxTokens: 150,
  /** 公开资料检索结果注入上下文的字符上限（红线 3：与字幕/知识库共享同一预算，不膨胀） */
  webContextMaxChars: 1_000,
} as const;

/** 可选联网检索默认参数（endpoint / apiKey 为用户自填的运行时值，不在此处） */
export const WEB_SEARCH = {
  defaultEngine: 'tavily',
  defaultMaxResults: 5,
  requestTimeoutMs: 8_000,
} as const;

/**
 * 未配置联网检索时的兜底搜索页前缀（红线 9：代码里唯一的 URL 来源，
 * 任何搜索链接只能由本常量 + encodeURIComponent(query) 拼出）。
 */
export const WEB_SEARCH_FALLBACK_URL = 'https://duckduckgo.com/?q=';

export const SUBTITLE = {
  mergeShorterThanMs: 800,
  /** 手动粘贴纯文本的时间估算速率 */
  manualCharsPerSecond: 4,
  requestTimeoutMs: 15_000,
} as const;

export { PLAYBACK } from './shared';

export const OBSIDIAN = {
  baseUrl: 'http://127.0.0.1:27123', // Local REST API 的 HTTP 模式端口（HTTPS 模式为 27124）
  requestTimeoutMs: 8_000,
} as const;

export const DB = {
  name: 'vsc-cache',
  stores: {
    subtitles: 'subtitles',
    outlines: 'outlines',
    qaHistory: 'qaHistory',
    terms: 'terms',
    traces: 'traces',
    /** SPEC-07 追加：使用统计（键 videoId，值 UsageRecord，纯本地、不上报）。
     *  注意：已有 v1 库需升版本才会建该 store（版本常量在 storage/db.ts 的 open 调用处，留给父 agent 统一处理）。 */
    usage: 'usage',
  },
  traceKeep: 50,
} as const;
