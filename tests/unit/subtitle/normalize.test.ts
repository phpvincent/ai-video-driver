import { describe, expect, it } from 'vitest';
import type { Cue } from '../../../src/types';
import { normalizeCues } from '../../../src/core/subtitle/normalize';

const cue = (index: number, startMs: number, endMs: number, text: string): Cue => ({
  index,
  startMs,
  endMs,
  text,
});

describe('normalizeCues', () => {
  it('丢弃无效项：空文本 / startMs<0 / endMs<=startMs', () => {
    const result = normalizeCues([
      cue(0, 0, 1000, '正常'),
      cue(1, 0, 1000, '   '),
      cue(2, -50, 1000, '负起点'),
      cue(3, 1000, 1000, '零时长'),
      cue(4, 2000, 1500, '时间倒置'),
      cue(5, 3000, 4000, '再来一条'),
    ]);
    expect(result).toEqual([
      { index: 0, startMs: 0, endMs: 1000, text: '正常' },
      { index: 1, startMs: 3000, endMs: 4000, text: '再来一条' },
    ]);
  });

  it('时长 <800ms 且间隙 <500ms 的相邻段合并（text 拼接、endMs 取后者）', () => {
    const result = normalizeCues([cue(0, 0, 600, '今天'), cue(1, 800, 2000, '讲数组')]);
    expect(result).toEqual([{ index: 0, startMs: 0, endMs: 2000, text: '今天讲数组' }]);
  });

  it('边界：间隙 499ms 合并', () => {
    const result = normalizeCues([cue(0, 0, 700, '甲'), cue(1, 1199, 2199, '乙')]);
    expect(result).toEqual([{ index: 0, startMs: 0, endMs: 2199, text: '甲乙' }]);
  });

  it('边界：间隙 501ms 不合并', () => {
    const result = normalizeCues([cue(0, 0, 700, '甲'), cue(1, 1201, 2201, '乙')]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('甲');
    expect(result[1].text).toBe('乙');
  });

  it('链式合并：合并结果仍过短且相邻则继续吸收', () => {
    const result = normalizeCues([
      cue(0, 0, 300, '一'),
      cue(1, 400, 700, '二'),
      cue(2, 800, 1100, '三'),
    ]);
    expect(result).toEqual([{ index: 0, startMs: 0, endMs: 1100, text: '一二三' }]);
  });

  it('时长 >=800ms 的段不参与合并', () => {
    const result = normalizeCues([cue(0, 0, 800, '够长'), cue(1, 900, 1900, '下一条')]);
    expect(result).toHaveLength(2);
  });

  it('纯语气词段丢弃：嗯嗯啊', () => {
    expect(normalizeCues([cue(0, 0, 2000, '嗯嗯啊')])).toEqual([]);
  });

  it('纯语气词段丢弃：词表组合（呃就是然后那个）', () => {
    expect(normalizeCues([cue(0, 0, 2000, '呃，就是然后那个')])).toEqual([]);
  });

  it('含实义词的语气句保留：嗯这个概念', () => {
    const result = normalizeCues([cue(0, 0, 2000, '嗯这个概念')]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('嗯这个概念');
  });

  it('rolling caption 去重：与前一条 text 完全相同的连续段被丢弃', () => {
    const result = normalizeCues([
      cue(0, 0, 1000, '大家好'),
      cue(1, 1000, 2000, '大家好'),
      cue(2, 2000, 3000, '今天讲滚动字幕'),
      cue(3, 3000, 4000, '今天讲滚动字幕'),
      cue(4, 4000, 5000, '再见'),
    ]);
    expect(result).toEqual([
      { index: 0, startMs: 0, endMs: 1000, text: '大家好' },
      { index: 1, startMs: 2000, endMs: 3000, text: '今天讲滚动字幕' },
      { index: 2, startMs: 4000, endMs: 5000, text: '再见' },
    ]);
  });

  it('index 重排为 0..n-1（输入 index 乱序）', () => {
    const result = normalizeCues([
      cue(9, 0, 1000, '第一条'),
      cue(4, 2000, 3000, '第二条'),
      cue(7, 4000, 5000, '第三条'),
    ]);
    expect(result.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('空输入返回 []', () => {
    expect(normalizeCues([])).toEqual([]);
  });

  it('全部被过滤返回 []', () => {
    expect(normalizeCues([cue(0, 0, 2000, '嗯啊'), cue(1, 3000, 5000, '然后那个')])).toEqual([]);
  });

  it('合并时 approximate 标记传播（任一来源为估算则结果为估算）', () => {
    const result = normalizeCues([
      { index: 0, startMs: 0, endMs: 600, text: '估算段', approximate: true },
      cue(1, 700, 2000, '真实段'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].approximate).toBe(true);
  });
});
