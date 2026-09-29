/**
 * 预读大纲 pipeline 总编排（TECH-DESIGN §5.1，SPEC-03 子任务 3.2+3.3）：
 * 切片 → 并发模型调用（工作池、超时、重试、预算熔断）→ Schema 校验（红线 4）
 * → 时间吸附（红线 2）→ 增量合并 → 全局校正。
 * 纯函数 + 注入式模型调用（OutlineModelFn），无 chrome.* 依赖；
 * 密度计算（density）属子任务 3.5，本模块不产出。
 */
import { OUTLINE } from '../../config';
import type { Cue, Section } from '../../types';
import { chunkCues } from './chunk';
import { finalizeOutline, IncrementalMerger } from './merge';
import { buildOutlinePrompts } from './prompts';
import { snapCandidates } from './snap';
import {
  OutlineChunkSchema,
  type OutlineChunkState,
  type OutlineModelFn,
  type OutlineResult,
  type OutlineSection,
  type RunOutlineOptions,
  type SectionCandidate,
} from './types';

export { chunkCues, type ChunkOptions } from './chunk';
export { buildOutlinePrompts, buildOutlineRegeneratePrompts, formatTimecode } from './prompts';
export { snapCandidates, snapBullets, nearestCueStartMs, type SnappedSection, type SnapResult } from './snap';
export {
  enforceMinDuration,
  finalizeOutline,
  IncrementalMerger,
  titleSimilarity,
  validateOutline,
  type MergeOptions,
} from './merge';
export { regenerateSection, rescoreOutline, type RegenerateOptions } from './regenerate';
export {
  OutlineChunkSchema,
  SectionCandidateSchema,
  type OutlineChunkState,
  type OutlineModelFn,
  type OutlineResult,
  type OutlineSection,
  type RunOutlineOptions,
  type SectionCandidate,
} from './types';

/**
 * 解析并校验单块模型输出（红线 4）：JSON.parse + OutlineChunkSchema（Zod）。
 * 解析/校验失败 throw，由 runOutline 的重试逻辑捕获。
 */
export function parseModelOutline(content: string): SectionCandidate[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`模型输出不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = OutlineChunkSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`模型输出未通过 Schema 校验：${issues}`);
  }
  return parsed.data.sections;
}

/** 单块超时；超时后底层请求结果被忽略（其 token 已在估算口径内） */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 模型调用超时（${ms}ms）`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function runOutline(
  cues: Cue[],
  modelFn: OutlineModelFn,
  opts: RunOutlineOptions = {},
): Promise<OutlineResult> {
  const chunks = chunkCues(cues, {
    targetChars: opts.targetChars,
    overlapChars: opts.overlapChars,
  });
  if (chunks.length === 0) {
    return { sections: [], chunkState: [], droppedBySnap: 0, budgetHit: false, failedChunks: 0 };
  }

  const concurrency = opts.concurrency ?? OUTLINE.concurrency;
  const chunkTimeoutMs = opts.chunkTimeoutMs ?? OUTLINE.chunkTimeoutMs;
  const maxRetries = opts.maxRetries ?? OUTLINE.maxRetries;
  const snapMaxDriftMs = opts.snapMaxDriftMs ?? OUTLINE.snapMaxDriftMs;
  const buildPrompts = opts.buildPrompts ?? buildOutlinePrompts;
  // token 统计为粗估：按 prompt 字符数 / 2 折算（不引入真实计量接口，红线 9）
  const budget = opts.tokenBudget ?? Number.POSITIVE_INFINITY;
  const estTokens = (s: string): number => Math.ceil(s.length / 2);

  const chunkState: OutlineChunkState[] = chunks.map((chunk, i) => ({
    index: i,
    status: 'pending',
    startMs: chunk[0].startMs,
    endMs: chunk[chunk.length - 1].endMs,
  }));
  const candidatesByChunk: Array<SectionCandidate[] | null> = chunks.map(() => null);

  let usedTokens = 0;
  let budgetHit = false;
  let nextIdx = 0;

  const processChunk = async (i: number): Promise<void> => {
    const chunk = chunks[i];
    const st = chunkState[i];
    const prompts = buildPrompts(chunk);

    // 预算熔断：块启动前检查，超预算则不启动，标记 skipped（已完成块不受影响）
    const firstEst = estTokens(prompts.systemPrompt + prompts.userPrompt);
    if (usedTokens + firstEst > budget) {
      budgetHit = true;
      st.skipped = true;
      return;
    }
    usedTokens += firstEst;
    st.status = 'running';
    st.inputTokens = firstEst;

    let lastError = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 失败附错误信息重试（红线 4 的"重试"落在本层）
      const userPrompt =
        attempt === 0
          ? prompts.userPrompt
          : `${prompts.userPrompt}\n\n[重试] 上一次输出未通过校验：${lastError}\n请重新输出严格符合要求的 JSON，不要包含任何其他文字。`;
      if (attempt > 0) {
        const est = estTokens(prompts.systemPrompt + userPrompt);
        usedTokens += est;
        st.inputTokens = (st.inputTokens ?? 0) + est;
        st.retries = attempt;
      }
      try {
        const res = await withTimeout(
          modelFn({ systemPrompt: prompts.systemPrompt, userPrompt }),
          chunkTimeoutMs,
          `分块 ${i}`,
        );
        const candidates = parseModelOutline(res.content);
        st.status = 'done';
        st.outputTokens = estTokens(res.content);
        candidatesByChunk[i] = candidates;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    st.status = 'failed';
    st.retries = maxRetries;
    st.error = lastError;
  };

  // 简单工作池：N 个 worker 从队列取块，无额外依赖
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = nextIdx;
      nextIdx += 1;
      if (i >= chunks.length) return;
      await processChunk(i);
    }
  };
  const workerCount = Math.max(1, Math.min(concurrency, chunks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // 吸附 + 增量合并：按块下标顺序处理（与完成顺序无关，保证确定性，红线 1）
  const merger = new IncrementalMerger({
    titleThreshold: opts.mergeTitleThreshold,
    adjacentMs: opts.mergeAdjacentMs,
  });
  let droppedBySnap = 0;
  let doneChunks = 0;
  for (let i = 0; i < chunks.length; i++) {
    const candidates = candidatesByChunk[i];
    if (!candidates) continue;
    const { kept, dropped } = snapCandidates(candidates, cues, snapMaxDriftMs);
    droppedBySnap += dropped;
    merger.addChunk(kept);
    doneChunks += 1;
    // 进度钩子：每确认一个块的章节后回调（UI 流式渲染用；异常不阻断 pipeline）
    if (opts.onProgress) {
      try {
        opts.onProgress(merger.getSections(), doneChunks, chunks.length);
      } catch {
        /* 回调异常忽略：进度提示非关键路径 */
      }
    }
  }

  const sections: Section[] = finalizeOutline(
    merger.getSections(),
    cues,
    opts.minSectionDurationMs,
  );
  const failedChunks = chunkState.filter((s) => s.status === 'failed').length;
  return { sections, chunkState, droppedBySnap, budgetHit, failedChunks };
}
