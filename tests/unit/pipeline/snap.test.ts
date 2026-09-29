import { describe, expect, it } from 'vitest';
import { snapCandidates, snapBullets } from '../../../src/core/pipeline/snap';
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
  bullets: [{ text: '要点', startSec: 0 }],
  terms: [],
  importance: 3,
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

  it('吸附后保留候选的其余字段原样传递（bullets 已吸附、importance 透传）', () => {
    const cand: SectionCandidate = {
      title: '环境搭建与初始配置',
      startSec: 22,
      summary: '摘要内容',
      bullets: [
        { text: '要点一', startSec: 25 },
        { text: '要点二', startSec: 41 },
      ],
      terms: ['node', 'npm'],
      importance: 4,
    };
    const { kept } = snapCandidates([cand], mkCues());
    expect(kept[0].startMs).toBe(20_000);
    expect(kept[0].title).toBe(cand.title);
    expect(kept[0].terms).toEqual(cand.terms);
    expect(kept[0].importance).toBe(4);
    // bullets：25s → cue1(20s) 吸附；41s → cue2(40s) 吸附
    expect(kept[0].bullets).toEqual([
      { text: '要点一', startMs: 20_000 },
      { text: '要点二', startMs: 40_000 },
    ]);
  });
});

describe('bullets 时间吸附（SPEC-03 3c：bullets 逐条吸附）', () => {
  it('偏差 ≤5s → 精确吸附最近 Cue.startMs（无 approximate 标记）', () => {
    const out = snapBullets(
      [
        { text: '要点甲', startSec: 3 }, // cue0(0s) 偏 3s
        { text: '要点乙', startSec: 38 }, // cue2(40s) 偏 2s
      ],
      0,
      [0, 20_000, 40_000, 60_000, 80_000],
      5_000,
    );
    expect(out).toEqual([
      { text: '要点甲', startMs: 0 },
      { text: '要点乙', startMs: 40_000 },
    ]);
  });

  it('偏差 >5s → 回落为章节吸附后的 startMs 并标 approximate: true', () => {
    const out = snapBullets(
      [
        { text: '正常要点', startSec: 22 }, // cue1(20s)
        { text: '幻觉要点', startSec: 33 }, // 距 cue1(20s)/cue2(40s) 均 13s > 5s
      ],
      20_000,
      [0, 20_000, 40_000],
      5_000,
    );
    expect(out[0]).toEqual({ text: '正常要点', startMs: 20_000 });
    expect(out[1]).toEqual({ text: '幻觉要点', startMs: 20_000, approximate: true });
  });

  it('snapCandidates 集成：章节与 bullets 各自独立吸附，回落用章节吸附后的 startMs', () => {
    const cand: SectionCandidate = {
      title: '章节标题测试',
      startSec: 3, // 章节 → cue0(0s)
      summary: '摘要',
      bullets: [
        { text: '精确要点', startSec: 21 }, // → cue1(20s)
        { text: '回落要点', startSec: 34 }, // 距 20s/40s 均 >5s → 回落章节吸附后 0s
      ],
      terms: [],
      importance: 2,
    };
    const { kept, dropped } = snapCandidates([cand], mkCues());
    expect(dropped).toBe(0);
    expect(kept[0].startMs).toBe(0);
    expect(kept[0].bullets).toEqual([
      { text: '精确要点', startMs: 20_000 },
      { text: '回落要点', startMs: 0, approximate: true },
    ]);
  });

  it('偏差恰为 5s 的 bullet → 精确吸附（边界不超过阈值）', () => {
    const out = snapBullets([{ text: '边界要点', startSec: 45 }], 40_000, [0, 40_000], 5_000);
    expect(out).toEqual([{ text: '边界要点', startMs: 40_000 }]);
  });
});
