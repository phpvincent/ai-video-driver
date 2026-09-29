/**
 * 时间吸附（TECH-DESIGN §5.1 步骤 5，红线 2）：
 * 候选章节 startSec*1000 吸附到最近的 Cue.startMs；
 * 偏差 > snapMaxDriftMs 视为幻觉，丢弃该候选章节并计数。
 */
import { OUTLINE } from '../../config';
import type { Cue } from '../../types';
import type { SectionCandidate } from './types';

/** 吸附后的候选章节（startSec 已替换为吸附后的 startMs） */
export interface SnappedSection {
  title: string;
  startMs: number;
  summary: string;
  bullets: string[];
  terms: string[];
}

export interface SnapResult {
  kept: SnappedSection[];
  /** 因偏差超阈值被丢弃的候选数（幻觉路径） */
  dropped: number;
}

export function snapCandidates(
  candidates: SectionCandidate[],
  cues: Cue[],
  maxDriftMs: number = OUTLINE.snapMaxDriftMs,
): SnapResult {
  // Cue 理论上按时间升序；排序副本保证纯函数在乱序输入下行为确定（红线 1）
  const starts = cues.map((c) => c.startMs).sort((a, b) => a - b);
  const kept: SnappedSection[] = [];
  let dropped = 0;

  for (const cand of candidates) {
    const target = cand.startSec * 1000;
    let best = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const s of starts) {
      const diff = Math.abs(target - s);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    if (best < 0 || bestDiff > maxDriftMs) {
      dropped += 1; // 红线 2：距任何 Cue.startMs 都超阈值 → 幻觉，丢弃
      continue;
    }
    kept.push({
      title: cand.title,
      startMs: best,
      summary: cand.summary,
      bullets: cand.bullets,
      terms: cand.terms,
    });
  }
  return { kept, dropped };
}
