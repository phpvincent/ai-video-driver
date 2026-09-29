import { describe, expect, it } from 'vitest';
import {
  finalizeOutline,
  IncrementalMerger,
  titleSimilarity,
  validateOutline,
} from '../../../src/core/pipeline/merge';
import type { SnappedSection } from '../../../src/core/pipeline/snap';
import type { OutlineSection } from '../../../src/core/pipeline/types';
import type { Cue } from '../../../src/types';

const sn = (title: string, startMs: number, bullets: string[] = ['要点'], terms: string[] = []): SnappedSection => ({
  title,
  startMs,
  summary: '摘要',
  bullets,
  terms,
});

/** 10s 间隔的 Cue：0s..70s */
const mkCues = (n = 8): Cue[] =>
  Array.from({ length: n }, (_, i) => ({
    index: i,
    startMs: i * 10_000,
    endMs: i * 10_000 + 5_000,
    text: `line-${i}`,
  }));

describe('titleSimilarity', () => {
  it('相同标题 → 1', () => {
    expect(titleSimilarity('环境搭建', '环境搭建')).toBe(1);
  });

  it('无公共字符 → 0', () => {
    expect(titleSimilarity('环境搭建', '流程控制')).toBe(0);
  });

  it('部分重合按字符集 Jaccard 计算', () => {
    // {变量与类型系统} vs {变量与类型系统详解}：交 7 / 并 9
    expect(titleSimilarity('变量与类型系统', '变量与类型系统详解')).toBeCloseTo(7 / 9, 10);
  });
});

describe('IncrementalMerger（A4 增量合并）', () => {
  it('标题相似 + 时间相邻 → 合并进尾部，追加要点/术语', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('变量与类型系统', 0, ['变量声明'], ['变量'])]);
    merger.addChunk([sn('变量与类型系统详解', 2_000, ['作用域规则'], ['变量', '作用域'])]);
    const sections = merger.getSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('变量与类型系统');
    expect(sections[0].startMs).toBe(0);
    expect(sections[0].bullets).toEqual(['变量声明', '作用域规则']);
    expect(sections[0].terms).toEqual(['变量', '作用域']); // 去重
  });

  it('已确认的非尾部章节不被修改：相似候选只与尾部尝试合并', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('课程介绍', 0, ['介绍']), sn('循环与流程控制', 60_000, ['循环'])]);
    // 与首章（非尾部）标题相似且时间相邻 → 不会并入首章，而是追加为新章节
    merger.addChunk([sn('课程介绍概览', 3_000, ['概览'])]);
    const sections = merger.getSections();
    expect(sections).toHaveLength(3);
    expect(sections[0].bullets).toEqual(['介绍']); // 首章不变
    expect(sections[2].title).toBe('课程介绍概览');
  });

  it('标题相似但时间不相邻 → 不合并', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('环境搭建', 0, ['要点一'])]);
    merger.addChunk([sn('环境搭建指南', 120_000, ['要点二'])]); // 相差 120s > 60s
    const sections = merger.getSections();
    expect(sections).toHaveLength(2);
    expect(sections[0].bullets).toEqual(['要点一']);
  });

  it('块内候选先按时间排序再合并', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('后章', 60_000), sn('前章', 0)]);
    const sections = merger.getSections();
    expect(sections.map((s) => s.startMs)).toEqual([0, 60_000]);
  });
});

describe('finalizeOutline（A4 全局校正）', () => {
  it('排序 + 剔除同 startMs 重叠 + endMs 链 + id 重编', () => {
    // 乱序输入 + 重复 startMs
    const out = finalizeOutline(
      [sn('第二章', 40_000), sn('第一章', 0), sn('第一章重复', 0)],
      mkCues(),
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('sec_0001');
    expect(out[1].id).toBe('sec_0002');
    expect(out[0].startMs).toBe(0);
    expect(out[0].endMs).toBe(39_999); // 下一章 startMs - 1
    expect(out[1].endMs).toBe(75_000); // 末章 = 末条 Cue.endMs
    expect(out[0].title).toBe('第一章'); // 同起点保留先确认者
  });

  it('首章晚于第一条 Cue → 回补到 cues[0].startMs（补齐覆盖）', () => {
    const out = finalizeOutline([sn('第二章', 20_000)], mkCues());
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBe(0); // === cues[0].startMs
    expect(out[0].endMs).toBe(75_000);
  });

  it('cueRange 覆盖正确且相邻章节不重叠', () => {
    const out = finalizeOutline([sn('第一章', 0), sn('第二章', 40_000)], mkCues());
    expect(out[0].cueRange).toEqual([0, 3]); // 0s..30s 四条 Cue
    expect(out[1].cueRange).toEqual([4, 7]); // 40s..70s 四条 Cue
  });

  it('空输入 → 空输出', () => {
    expect(finalizeOutline([], mkCues())).toEqual([]);
  });
});

describe('validateOutline（覆盖校验）', () => {
  const base = (startMs: number): OutlineSection => ({
    id: 'sec_0001',
    title: '标题',
    startMs,
    endMs: 75_000,
    summary: '摘要',
    bullets: ['要点'],
    terms: [],
    cueRange: [0, 7],
  });

  it('合法输入通过', () => {
    expect(() => validateOutline([base(0)], mkCues())).not.toThrow();
  });

  it('startMs 不落在 Cue.startMs 上 → throw（红线 2）', () => {
    expect(() => validateOutline([base(5_000)], mkCues())).toThrow(/红线 2/);
  });

  it('startMs 未严格递增 → throw', () => {
    const a = base(0);
    const b = { ...base(30_000), id: 'sec_0002', endMs: 75_000 };
    expect(() => validateOutline([b, a], mkCues())).toThrow(/严格递增/);
  });
});
