/**
 * 增量合并与全局校正（TECH-DESIGN §5.1 步骤 6/7）：
 * - IncrementalMerger：按块顺序处理，每块候选只与"已确认章节尾部"尝试合并
 *   （标题相似 + 时间相邻 → 追加要点/术语），非尾部章节不再变动；
 * - finalizeOutline：按 startMs 排序、剔除重叠、补齐覆盖、计算 endMs/cueRange、重编 id；
 * - validateOutline：覆盖校验（startMs 严格递增且 ∈ Cue.startMs 集合，红线 2）。
 */
import type { Cue } from '../../types';
import type { SnappedSection } from './snap';
import type { OutlineSection } from './types';

export interface MergeOptions {
  /** 标题相似度阈值（字符重合率），默认 0.5 */
  titleThreshold?: number;
  /** 时间相邻窗口（毫秒），默认 60_000 */
  adjacentMs?: number;
}

/** 标题字符重合率：字符集合的 Jaccard 相似度 */
export function titleSimilarity(a: string, b: string): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

/** 增量合并器：块内候选先按 startMs 排序，再逐条与尾部尝试合并 */
export class IncrementalMerger {
  private readonly sections: SnappedSection[] = [];
  private readonly titleThreshold: number;
  private readonly adjacentMs: number;

  constructor(opts: MergeOptions = {}) {
    this.titleThreshold = opts.titleThreshold ?? 0.5;
    this.adjacentMs = opts.adjacentMs ?? 60_000;
  }

  addChunk(cands: SnappedSection[]): void {
    const sorted = [...cands].sort((a, b) => a.startMs - b.startMs);
    for (const c of sorted) {
      const tail = this.sections[this.sections.length - 1];
      if (
        tail &&
        titleSimilarity(tail.title, c.title) >= this.titleThreshold &&
        Math.abs(c.startMs - tail.startMs) <= this.adjacentMs
      ) {
        // 合并进尾部：标题/起始时间不变（已确认部分不跳动），追加要点与术语
        tail.bullets = dedupeStrings([...tail.bullets, ...c.bullets]);
        tail.terms = dedupeStrings([...tail.terms, ...c.terms]);
      } else {
        this.sections.push({ ...c, bullets: [...c.bullets], terms: [...c.terms] });
      }
    }
  }

  /** 已确认章节（返回副本，避免外部改动内部状态） */
  getSections(): SnappedSection[] {
    return this.sections.map((s) => ({ ...s, bullets: [...s.bullets], terms: [...s.terms] }));
  }
}

/**
 * 全局校正：排序 → 剔除重叠（同 startMs 只保留先确认者）→ 首章回补到第一条 Cue（补齐覆盖）
 * → endMs 链（下一章 startMs - 1，末章 = 末条 Cue.endMs）→ cueRange → 重编 id → 覆盖校验。
 */
export function finalizeOutline(sections: SnappedSection[], cues: Cue[]): OutlineSection[] {
  if (sections.length === 0 || cues.length === 0) return [];
  const sortedCues = [...cues].sort((a, b) => a.startMs - b.startMs);

  const sorted = [...sections].sort((a, b) => a.startMs - b.startMs);
  const uniq: SnappedSection[] = [];
  for (const s of sorted) {
    if (uniq.length > 0 && uniq[uniq.length - 1].startMs === s.startMs) continue;
    uniq.push(s);
  }
  // 补齐覆盖：首章回补到第一条 Cue，保证章节覆盖全片开头
  if (uniq[0].startMs > sortedCues[0].startMs) {
    uniq[0] = { ...uniq[0], startMs: sortedCues[0].startMs };
  }

  const out: OutlineSection[] = [];
  for (let i = 0; i < uniq.length; i++) {
    const sec = uniq[i];
    const nextStart = i + 1 < uniq.length ? uniq[i + 1].startMs : null;
    const endMs =
      nextStart === null ? sortedCues[sortedCues.length - 1].endMs : nextStart - 1;

    // startMs ∈ Cue.startMs 集合，findIndex 必命中
    const startIdx = sortedCues.findIndex((c) => c.startMs >= sec.startMs);
    let endIdx = sortedCues.length - 1;
    if (nextStart !== null) {
      endIdx = startIdx;
      while (endIdx + 1 < sortedCues.length && sortedCues[endIdx + 1].startMs < nextStart) {
        endIdx += 1;
      }
    }

    out.push({
      id: `sec_${String(i + 1).padStart(4, '0')}`,
      title: sec.title,
      startMs: sec.startMs,
      endMs,
      summary: sec.summary,
      bullets: sec.bullets,
      terms: sec.terms,
      cueRange: [startIdx, endIdx],
    });
  }

  validateOutline(out, sortedCues);
  return out;
}

/** 覆盖校验：不满足内部不变量时 throw（构造逻辑保证不应触发，触发即 bug） */
export function validateOutline(sections: OutlineSection[], cues: Cue[]): void {
  if (sections.length === 0) return;
  const cueStarts = new Set(cues.map((c) => c.startMs));
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!cueStarts.has(s.startMs)) {
      throw new Error(`章节 ${s.id} startMs=${s.startMs} 不落在任何 Cue.startMs 上（红线 2）`);
    }
    if (i > 0 && s.startMs <= sections[i - 1].startMs) {
      throw new Error(`章节 ${s.id} startMs 未严格递增`);
    }
    if (s.endMs < s.startMs) throw new Error(`章节 ${s.id} endMs < startMs`);
    if (s.cueRange[0] > s.cueRange[1]) throw new Error(`章节 ${s.id} cueRange 为空区间`);
  }
  if (sections[0].startMs > cues[0].startMs) throw new Error('首章未覆盖视频开头');
  if (sections[sections.length - 1].endMs < cues[cues.length - 1].endMs) {
    throw new Error('末章未覆盖视频结尾');
  }
}
