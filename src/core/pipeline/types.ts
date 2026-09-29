/**
 * 预读大纲 pipeline 内部类型与 Schema（SPEC-03 子任务 3.2+3.3）。
 * 密度计算（density）属子任务 3.5，本模块不产出。
 */
import { z } from 'zod';
import type { ChunkState, Cue, Section } from '../../types';
import type { SnappedSection } from './snap';

/** 候选章节（模型单块输出，TECH-DESIGN §6.1） */
export const SectionCandidateSchema = z.object({
  title: z.string().min(4).max(40),
  startSec: z.number().int().nonnegative(),
  summary: z.string().max(120),
  bullets: z.array(z.string()).min(1).max(5),
  terms: z.array(z.string()).max(15),
});
export type SectionCandidate = z.infer<typeof SectionCandidateSchema>;

/** 单块模型输出整体（TECH-DESIGN §6.1） */
export const OutlineChunkSchema = z.object({
  sections: z.array(SectionCandidateSchema),
});

/**
 * 模型调用注入接口：content 应为 JSON 字符串 {sections: [...]}。
 * 后续接线时由调用方适配到 core/harness/modelClient，本模块不直接依赖 harness。
 */
export type OutlineModelFn = (req: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ content: string }>;

/** finalize 后的章节：density 由子任务 3.5 填充 */
export type OutlineSection = Omit<Section, 'density'>;

/** 分块状态：在共享 ChunkState 上扩展预算熔断跳过标记 */
export interface OutlineChunkState extends ChunkState {
  /** 预算熔断时未启动的块（status 保持 pending，续跑时可重新执行） */
  skipped?: boolean;
}

export interface OutlineResult {
  /** finalize + attachDensity 后的完整章节（3.5 起 Section 含 density） */
  sections: Section[];
  chunkState: OutlineChunkState[];
  /** 吸附阶段因偏差超阈值丢弃的候选章节数（红线 2：幻觉路径） */
  droppedBySnap: number;
  /** 是否触发预算熔断 */
  budgetHit: boolean;
  failedChunks: number;
}

export interface RunOutlineOptions {
  /** prompt 构造器（默认基线实现见 prompts.ts） */
  buildPrompts?: (chunk: Cue[]) => { systemPrompt: string; userPrompt: string };
  /** 单视频大纲 token 预算（粗估：prompt 字符数 / 2）；不传则不设限 */
  tokenBudget?: number;
  concurrency?: number;
  chunkTimeoutMs?: number;
  maxRetries?: number;
  snapMaxDriftMs?: number;
  /** 增量合并：标题相似度阈值（字符重合率），默认 0.5 */
  mergeTitleThreshold?: number;
  /** 增量合并：时间相邻窗口（毫秒），默认 60_000 */
  mergeAdjacentMs?: number;
  targetChars?: number;
  overlapChars?: number;
  /**
   * 进度钩子：每确认完一个块的章节后回调（增量合并阶段，按块下标顺序）。
   * confirmed 为当前已合并章节快照（已吸附到真实 Cue 边界，但未 finalize，
   * 无 density/endMs 终值与 id）；回调异常被吞掉（进度提示非关键路径）。
   */
  onProgress?: (
    confirmed: SnappedSection[],
    doneChunks: number,
    totalChunks: number,
  ) => void;
}
