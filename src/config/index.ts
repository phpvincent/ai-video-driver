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

/** 概念知识图（SPEC-04 范围变更）：结构与阈值约束（pipeline zod 与 UI 共用） */
export const CONCEPT_MAP = {
  /** 概念域数量下/上限（模型输出 zod 约束） */
  domainsMin: 3,
  domainsMax: 6,
  /** 每域概念数量上限 */
  conceptsPerDomainMax: 5,
  /** 节点标签长度上限（含根节点以外的所有层级） */
  labelMax: 12,
  /** 根节点（视频主题短语）长度上限 */
  rootLabelMax: 16,
  /** 细节短语数量上限 / 单条长度上限 */
  detailsMax: 4,
  detailLabelMax: 20,
  /** 术语关联图（降级）最多展示的术语数 */
  termsTop: 12,
  /** 降级 domain 名称 */
  fallbackDomainLabel: '核心术语',
  /** 解析失败重试次数（附错误信息重试） */
  maxRetries: 1,
} as const;

export const CONTEXT = {
  /** 单次提问上下文上限（红线 3 的量化边界） */
  maxTokens: 4_000,
  defaultRangePadMs: 30_000,
  chapterCompressChars: 3_000,
  prevSummaryMaxTokens: 150,
} as const;

export const SUBTITLE = {
  mergeShorterThanMs: 800,
  /** 手动粘贴纯文本的时间估算速率 */
  manualCharsPerSecond: 4,
  requestTimeoutMs: 15_000,
} as const;

export { PLAYBACK } from './shared';

export const OBSIDIAN = {
  baseUrl: 'http://127.0.0.1:27124',
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
  },
  traceKeep: 50,
} as const;
