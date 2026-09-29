import { describe, expect, it } from 'vitest';
import { snapCandidates } from '../../../src/core/pipeline/snap';
import type { SectionCandidate } from '../../../src/core/pipeline/types';
import type { Cue } from '../../../src/types';

/** 20s 间隔的 Cue：0s, 20s, 40s, 60s, 80s */
const mkCues = (): Cue[] =>
  Array.from({ length: 5 }, (_, i) => ({
    index: i,
    startMs: i * 20_000,
    endMs: i * 20_000 + 5_000,
    text: `line-${i}`,
  }));

const CAND = (startSec: number): SectionCandidate => ({
  title: '章节标题测试',
  startSec,
  summary: '摘要',
  bullets: ['要点'],
  terms: [],
});

describe('snapCandidates（A2 时间吸附，红线 2）', () => {
  it('偏移 +3s → startMs 严格等于最近 Cue.startMs', () => {
    const { kept, dropped } = snapCandidates([CAND(3)], mkCues()); // cue0 = 0s
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(1);
    expect(kept[0].startMs).toBe(0);
  });

  it('偏移 -3s → startMs 严格等于最近 Cue.startMs', () => {
    const { kept, dropped } = snapCandidates([CAND(37)], mkCues()); // cue2 = 40s
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(1);
    expect(kept[0].startMs).toBe(40_000);
  });

  it('偏差恰为 5s（不超过）→ 保留并吸附', () => {
    const { kept, dropped } = snapCandidates([CAND(45)], mkCues()); // 距 40s 恰 5s
    expect(dropped).toBe(0);
    expect(kept[0].startMs).toBe(40_000);
  });

  it('偏差 > 5s → 丢弃该候选并计数（幻觉路径）', () => {
    const { kept, dropped } = snapCandidates([CAND(46)], mkCues()); // 距最近 Cue 6s
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('混合候选：保留与丢弃并存，计数正确', () => {
    const { kept, dropped } = snapCandidates([CAND(3), CAND(46), CAND(57)], mkCues());
    // 3s → cue0(0s)；46s → 距 40s 6s 幻觉丢弃；57s → cue3(60s) 吸附
    expect(kept.map((k) => k.startMs)).toEqual([0, 60_000]);
    expect(dropped).toBe(1);
  });

  it('吸附后保留候选的其余字段原样传递', () => {
    const cand: SectionCandidate = {
      title: '环境搭建与初始配置',
      startSec: 22,
      summary: '摘要内容',
      bullets: ['要点一', '要点二'],
      terms: ['node', 'npm'],
    };
    const { kept } = snapCandidates([cand], mkCues());
    expect(kept[0].startMs).toBe(20_000);
    expect(kept[0].title).toBe(cand.title);
    expect(kept[0].bullets).toEqual(cand.bullets);
    expect(kept[0].terms).toEqual(cand.terms);
  });
});
