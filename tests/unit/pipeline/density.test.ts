import { describe, expect, it } from 'vitest';
import { attachDensity, computeDensity } from '../../../src/core/pipeline/density';
import type { Section } from '../../../src/types';

/** 构造无 density 的章节（分钟数 = (endMs-startMs)/60000，下限 0.1） */
const sec = (startMs: number, endMs: number, terms: string[]): Omit<Section, 'density'> => ({
  id: 'sec_0001',
  title: '标题',
  startMs,
  endMs,
  summary: '摘要',
  bullets: ['要点'],
  terms,
  cueRange: [0, 7],
});

/** 1 分钟章节（毫秒） */
const MIN = 60_000;

describe('computeDensity：术语统计', () => {
  it('第 2 章重复第 1 章的术语不计为 new（"此前"= 第 0..i-1 章）', () => {
    // ch0: 3 新术语 1 分钟 → rate=3 → high；ch1: 3 个术语全部重复 → new=0 → low
    const d = computeDensity([
      sec(0, MIN, ['a', 'b', 'c']),
      sec(MIN, 2 * MIN, ['a', 'b', 'c']),
    ]);
    expect(d).toEqual(['high', 'low']);
  });

  it('部分重复：仅未出现过的术语计入 new', () => {
    // ch0: 3 新术语 → high；ch1 new=2（d/e）rate=2 → mid（若 5 个全计 new 则 rate=5 → high）
    const d = computeDensity([
      sec(0, MIN, ['a', 'b', 'c']),
      sec(MIN, 2 * MIN, ['a', 'b', 'c', 'd', 'e']),
    ]);
    expect(d).toEqual(['high', 'mid']);
  });

  it('大小写不敏感：Agent 与 agent 视为同术语', () => {
    const d = computeDensity([
      sec(0, MIN, ['Agent', 'x', 'y']),
      sec(MIN, 2 * MIN, ['agent', 'z']),
    ]);
    // ch0 rate=3 → high；ch1 new=1（仅 z）→ mid
    expect(d).toEqual(['high', 'mid']);
  });

  it('trim 不敏感：首尾空白不构成新术语', () => {
    const d = computeDensity([
      sec(0, MIN, ['  Agent  ']),
      sec(MIN, 2 * MIN, ['Agent']),
    ]);
    // ch0 rate=1 → mid；ch1 new=0 → low
    expect(d).toEqual(['mid', 'low']);
  });

  it('章内自身重复不计为 new（["a","a"] 算 1 个）', () => {
    // 0.5 分钟 1 新术语 → rate=2 → mid；若误算 2 个 → rate=4 → high
    const d = computeDensity([sec(0, 30_000, ['a', 'a']), sec(30_000, 2 * MIN, ['b'])]);
    expect(d[0]).toBe('mid');
  });
});

describe('computeDensity：rate 计算', () => {
  it('30 秒章 2 个新术语 → rate = 2/0.5 = 4/分钟 → high（绝对阈值 ≥3）', () => {
    const d = computeDensity([sec(0, 30_000, ['a', 'b']), sec(30_000, 2 * MIN, ['c'])]);
    expect(d[0]).toBe('high');
  });

  it('短章保护：5 秒章按 0.1 分钟计（1 新术语 → rate=10 → high，而非除零异常）', () => {
    const d = computeDensity([sec(0, 5_000, ['a']), sec(5_000, 2 * MIN, ['b'])]);
    expect(d[0]).toBe('high');
  });

  it('短章保护：0 秒章（endMs==startMs）0 术语 → rate=0（clamp 防 0/0=NaN）→ low', () => {
    // 若无 clamp，0/0=NaN，NaN 与任何阈值比较均为 false，绝对阈值路径会落入 mid 而非 low
    const d = computeDensity([sec(0, 0, []), sec(0, MIN, ['a', 'b', 'c'])]);
    expect(d[0]).toBe('low');
    expect(d[1]).toBe('high');
  });
});

describe('computeDensity：分档', () => {
  it('分位数档（≥4 章）：5 章 rate=[0,1,2,3,4] → P25=1、P75=3（R-7 线性插值）', () => {
    // 构造：每章 1 分钟，新术语数 0/1/2/3/4 → rate 0/1/2/3/4
    // sorted=[0,1,2,3,4]：P25 pos=(5-1)*0.25=1 → 1；P75 pos=4*0.75=3 → 3
    // 期望：0,1 ≤ P25 → low；2 → mid；3,4 ≥ P75 → high
    const sections = [
      sec(0, MIN, []),
      sec(MIN, 2 * MIN, ['t1']),
      sec(2 * MIN, 3 * MIN, ['t2', 't3']),
      sec(3 * MIN, 4 * MIN, ['t4', 't5', 't6']),
      sec(4 * MIN, 5 * MIN, ['t7', 't8', 't9', 't10']),
    ];
    expect(computeDensity(sections)).toEqual(['low', 'low', 'mid', 'high', 'high']);
  });

  it('绝对阈值档（<4 章）：rate ≥ 3 → high', () => {
    const d = computeDensity([sec(0, MIN, ['a', 'b', 'c']), sec(MIN, 2 * MIN, ['d'])]);
    expect(d[0]).toBe('high');
  });

  it('绝对阈值档（<4 章）：1 ≤ rate < 3 → mid', () => {
    const d = computeDensity([sec(0, MIN, ['a']), sec(MIN, 2 * MIN, ['b'])]);
    expect(d[0]).toBe('mid');
  });

  it('绝对阈值档（<4 章）：rate < 1 → low（2 分钟 1 新术语 → 0.5）', () => {
    const d = computeDensity([sec(0, 2 * MIN, ['a']), sec(2 * MIN, 4 * MIN, ['b'])]);
    expect(d[0]).toBe('low');
  });
});

describe('computeDensity：退化情形', () => {
  it('空数组 → []', () => {
    expect(computeDensity([])).toEqual([]);
  });

  it('单章 → ["mid"]（单章无对比意义，即使有术语）', () => {
    expect(computeDensity([sec(0, MIN, ['a', 'b', 'c'])])).toEqual(['mid']);
  });

  it('单章且无术语 → 仍为 ["mid"]（单章规则优先于全零规则）', () => {
    expect(computeDensity([sec(0, MIN, [])])).toEqual(['mid']);
  });

  it('全部 rate=0（4 章，无术语）→ 全 low（分位数路径 P75=P25=0 需短路）', () => {
    const sections = [
      sec(0, MIN, []),
      sec(MIN, 2 * MIN, []),
      sec(2 * MIN, 3 * MIN, []),
      sec(3 * MIN, 4 * MIN, []),
    ];
    expect(computeDensity(sections)).toEqual(['low', 'low', 'low', 'low']);
  });
});

describe('attachDensity', () => {
  it('输出与输入等长、density 字段齐全、原字段不变（title/terms 浅比较）', () => {
    const input = [
      sec(0, MIN, ['a', 'b', 'c']),
      sec(MIN, 2 * MIN, ['a']),
      sec(2 * MIN, 3 * MIN, []),
    ];
    const out = attachDensity(input);
    expect(out).toHaveLength(3);
    out.forEach((s, i) => {
      expect(['low', 'mid', 'high']).toContain(s.density);
      expect(s.title).toBe(input[i].title);
      expect(s.terms).toEqual(input[i].terms);
      expect(s.startMs).toBe(input[i].startMs);
      expect(s.endMs).toBe(input[i].endMs);
      expect(s.bullets).toEqual(input[i].bullets);
      expect(s.summary).toBe(input[i].summary);
      expect(s.cueRange).toEqual(input[i].cueRange);
    });
    expect(out.map((s) => s.density)).toEqual(['high', 'low', 'low']);
  });

  it('不修改输入数组（纯函数，无副作用）', () => {
    const input = [sec(0, MIN, ['a']), sec(MIN, 2 * MIN, ['b'])];
    const snapshot = JSON.stringify(input);
    attachDensity(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('computeDensity：确定性（红线 1）', () => {
  it('同输入两次调用结果全等', () => {
    const sections = [
      sec(0, MIN, ['Agent', '上下文']),
      sec(MIN, 2 * MIN, ['agent', 'RAG']),
      sec(2 * MIN, 3 * MIN, ['RAG', '微调']),
      sec(3 * MIN, 4 * MIN, ['量化']),
      sec(4 * MIN, 5 * MIN, []),
    ];
    const a = computeDensity(sections);
    const b = computeDensity(sections);
    expect(a).toEqual(b);
    const sa = attachDensity(sections);
    const sb = attachDensity(sections);
    expect(sa).toEqual(sb);
  });
});
