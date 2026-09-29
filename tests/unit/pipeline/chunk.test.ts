import { describe, expect, it } from 'vitest';
import { chunkCues } from '../../../src/core/pipeline/chunk';
import type { Cue } from '../../../src/types';

/** 生成权重（text.length + 1）恰为 weight 的 Cue */
const mkCue = (i: number, weight = 100, startMs = i * 10_000): Cue => ({
  index: i,
  startMs,
  endMs: startMs + 5_000,
  text: `c${i}:`.padEnd(weight - 1, 'x'),
});

const weightOf = (chunk: Cue[]): number =>
  chunk.reduce((n, c) => n + c.text.length + 1, 0);

describe('chunkCues（A1 切片）', () => {
  it('空 cues 返回空数组', () => {
    expect(chunkCues([])).toEqual([]);
  });

  it('单条 Cue → 单块且完整', () => {
    const cues = [mkCue(0, 50)];
    const chunks = chunkCues(cues);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(cues);
  });

  it('累计恰好 1800 字 → 恰好一块，边界精确', () => {
    const cues = Array.from({ length: 18 }, (_, i) => mkCue(i)); // 18 × 100 = 1800
    const chunks = chunkCues(cues);
    expect(chunks).toHaveLength(1);
    expect(weightOf(chunks[0])).toBe(1800);
    expect(chunks[0]).toHaveLength(18);
  });

  it('超过 1800 字 → 两块，第二块首条 Cue 与第一块末尾重叠且重叠 ≥ 200 字', () => {
    const cues = Array.from({ length: 20 }, (_, i) => mkCue(i));
    const chunks = chunkCues(cues);
    expect(chunks).toHaveLength(2);
    // 第一块精确累计到 1800（cues[0..17]）
    expect(chunks[0].map((c) => c.index)).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(weightOf(chunks[0])).toBe(1800);
    // 第二块从 cues[16] 开始：与第一块 [16,17] 两条 Cue 重叠（200 字）
    expect(chunks[1][0].index).toBe(16);
    const overlapWeight = weightOf(chunks[1].filter((c) => c.index <= 17));
    expect(overlapWeight).toBeGreaterThanOrEqual(200);
  });

  it('切点始终落在 Cue 边界：每块都是原数组的连续切片，且全覆盖无遗漏', () => {
    // 确定性伪随机权重（40..239）
    const cues = Array.from({ length: 50 }, (_, i) => mkCue(i, 40 + ((i * 37) % 200)));
    const chunks = chunkCues(cues);
    expect(chunks.length).toBeGreaterThan(1);

    const covered = new Set<number>();
    let prevLast = -1;
    for (const chunk of chunks) {
      const idx = chunk.map((c) => c.index);
      // 连续且递增（完整 Cue，未被切断）
      for (let k = 1; k < idx.length; k++) expect(idx[k]).toBe(idx[k - 1] + 1);
      idx.forEach((n) => covered.add(n));
      // 每块至少推进到上一块末尾之后（无空转块）
      expect(idx[idx.length - 1]).toBeGreaterThan(prevLast);
      prevLast = idx[idx.length - 1];
    }
    // 全覆盖：0..49
    expect(covered.size).toBe(50);
    expect(prevLast).toBe(49);
    // 相邻块重叠 ≥ 200 字（起点 > 0 时回取必然满足）
    for (let i = 1; i < chunks.length; i++) {
      const first = chunks[i][0].index;
      const last = chunks[i - 1][chunks[i - 1].length - 1].index;
      expect(first).toBeLessThanOrEqual(last);
      const overlap = weightOf(chunks[i].filter((c) => c.index <= last));
      if (first > 0) expect(overlap).toBeGreaterThanOrEqual(200);
    }
  });

  it('单条 Cue 自身超 targetChars → 独立成块且不切断', () => {
    const mega = mkCue(0, 2001); // > 1800
    const chunks = chunkCues([mega]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
    expect(chunks[0][0]).toBe(mega); // 整条保留
  });

  it('超长 Cue 后仍有内容 → 超长 Cue 不被切断，后续 Cue 全覆盖', () => {
    const mega = mkCue(0, 2000);
    const tail = mkCue(1, 50);
    const chunks = chunkCues([mega, tail]);
    expect(chunks).toHaveLength(2);
    // 两块中的超长 Cue 都是整条（未被切断）
    for (const chunk of chunks) {
      const inChunk = chunk.filter((c) => c.index === 0);
      expect(inChunk).toEqual([mega]);
    }
    // 后续 Cue 被覆盖
    expect(chunks[1].map((c) => c.index)).toContain(1);
  });
});
