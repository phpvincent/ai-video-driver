/**
 * 共享数据契约 —— 仅父 agent 可修改（CONSTITUTION §4）。
 * 权威说明见 TECH-DESIGN.md §4。
 */

/** 视频标识：`{bvid}_p{page}`，URL 无 p 参数时 page = 1 */
export type VideoId = string;

export interface VideoMeta {
  videoId: VideoId;
  bvid: string;
  page: number;
  cid: number;
  /** 分 P 标题 */
  title: string;
  durationMs: number;
  url: string;
}

export interface Cue {
  /** 全局递增序号 */
  index: number;
  /** 毫秒，绝对时间 */
  startMs: number;
  endMs: number;
  text: string;
  /** 时间为估算（手动粘贴无时间戳文本时为 true） */
  approximate?: boolean;
}

export type SubtitleStatus =
  | 'ok'
  | 'no_subtitle'
  | 'need_login'
  | 'api_changed'
  | 'network'
  | 'manual_pasted';

/** UP 主上传字幕 / 平台 AI 字幕 / 手动粘贴 */
export type SubtitleSource = 'bili_uploader' | 'bili_ai' | 'manual';

export interface FetchResult {
  /** 空数组 = 未命中 */
  cues: Cue[];
  status: SubtitleStatus;
  source?: SubtitleSource;
  lang?: string;
  /** 原始错误摘要，进 trace */
  error?: string;
}

export type Density = 'low' | 'mid' | 'high';

/** 章节要点（SPEC-03 3c 范围变更：bullets 升级为带时间戳对象，可点跳播） */
export interface SectionBullet {
  text: string;
  /** 吸附后的 Cue 开始时间（毫秒） */
  startMs: number;
  /** 吸附偏差超阈值回落到章节起点时为 true（UI 可弱化跳播精度提示） */
  approximate?: boolean;
}

export interface Section {
  id: string;
  /** 8-20 字 */
  title: string;
  /** 等于某条 Cue.startMs（吸附后） */
  startMs: number;
  /** 下一章 startMs - 1；末章 = 视频时长 */
  endMs: number;
  /** 40-80 字 */
  summary: string;
  /** 2-5 条（每条带吸附后的开始时间） */
  bullets: SectionBullet[];
  /** 本章出现的技术术语（模型抽取；密度由代码确定性计算） */
  terms: string[];
  /** 1-5，模型给出的章节重要性（SPEC-03 3c） */
  importance: number;
  /** 0-100 综合打分（代码计算：新知识率 45% + 术语密度 25% + importance 30%；density 徽标由 score 分档） */
  score?: number;
  density: Density;
  /** 覆盖的 Cue 序号区间 */
  cueRange: [number, number];
}

export type InteractionType = 'term' | 'segment' | 'free';

export interface QaRecord {
  id: string;
  videoId: VideoId;
  interactionType: InteractionType;
  /** 提问时刻命中的章节 */
  sectionId: string | null;
  /** 提问时刻的播放位置 */
  timestampMs: number;
  /** 区间提问的区间 */
  rangeMs: [number, number] | null;
  question: string;
  /** 渲染后的回答正文 */
  answer: string;
  /** 结构化输出（TermSchema / SegmentAnswerSchema 校验结果） */
  payload: unknown;
  createdAt: string;
}

export interface TermCard {
  term: string;
  /** 在本视频语境中的含义 */
  inVideoMeaning: string;
  generalDefinition: string;
  analogy: string;
  relatedTerms: string[];
  videoId: VideoId;
  /** 带 p 与 t 参数的回放链接 */
  sourceUrl: string;
  timestampMs: number;
  createdAt: string;
}

export type ChunkStatus = 'pending' | 'running' | 'done' | 'failed';

/** 大纲分块状态：断点续跑的粒度 */
export interface ChunkState {
  index: number;
  status: ChunkStatus;
  startMs: number;
  endMs: number;
  inputTokens?: number;
  outputTokens?: number;
  retries?: number;
  error?: string;
}

/** IndexedDB subtitles store 记录，键 videoId */
export interface SubtitleRecord {
  videoId: VideoId;
  meta: VideoMeta;
  source: SubtitleSource | null;
  lang: string | null;
  status: SubtitleStatus;
  cues: Cue[];
  fetchedAt: string;
}

/** IndexedDB outlines store 记录，键 [videoId, promptVersion, model] */
export interface OutlineRecord {
  videoId: VideoId;
  promptVersion: string;
  model: string;
  sections: Section[];
  chunkState: ChunkState[];
  tokenUsage: { input: number; output: number };
  createdAt: string;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: { outline: number; qa: number };
  maxTokens: number;
  /** 单视频大纲 token 预算上限（熔断） */
  outlineTokenBudget: number;
}

export interface ObsidianConfig {
  baseUrl: string;
  apiKey: string;
  /** 笔记根目录 */
  rootDir: string;
}

// ---------------------------------------------------------------------------
// 概念知识图（SPEC-04 范围变更：导图 = 知识导航，非时间导航）
// ---------------------------------------------------------------------------

/** 概念时间锚：tMs 为该概念出现章节的 startMs（吸附产物，红线 2） */
export interface ConceptAnchor {
  tMs: number;
  sectionId: string;
}

/** 概念图节点：根为 kind='domain' 的虚拟根，其下为概念域 → 概念 → 细节 */
export interface ConceptNode {
  /** cm_0001...（根为 cm_root） */
  id: string;
  /** ≤12 字短语（根 ≤16 字） */
  label: string;
  kind: 'domain' | 'concept' | 'detail';
  /** 1-5（domain = 子概念 importance 最大值） */
  importance: number;
  /** 时间锚（detail 无锚；concept 跨章节合并出现点） */
  anchors: ConceptAnchor[];
  children: ConceptNode[];
}

/** 概念图完整数据（缓存于 outlines store，键 concept:: 前缀） */
export interface ConceptMapData {
  videoId: VideoId;
  promptVersion: string;
  model: string;
  /** kind='domain' 的虚拟根，label = 视频主题短语（≤16 字） */
  root: ConceptNode;
  generatedAt: string;
}

export type TraceKind = 'outline' | 'term' | 'segment' | 'capture';

/** pipeline 运行轨迹（TECH-DESIGN §5.4），traces store 保留最近 50 条 */
export interface PipelineTrace {
  id: string;
  videoId: VideoId;
  kind: TraceKind;
  startedAt: string;
  finishedAt?: string;
  chunks?: Array<{ index: number; ms: number; retries: number; error?: string }>;
  inputTokens?: number;
  outputTokens?: number;
  /** 吸附阶段丢弃的幻觉章节数 */
  droppedBySnap?: number;
  /** 是否触发预算熔断 */
  budgetHit?: boolean;
  error?: string;
}
