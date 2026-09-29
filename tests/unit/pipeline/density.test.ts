import { describe, expect, it } from 'vitest';
import {
  attachDensity,
  computeScores,
  densityFromScore,
} from '../../../src/core/pipeline/density';
import type { Section, SectionBullet } from '../../../src/types';

/** 构造无 density 的章节（分钟数 = (endMs-startMs)/60000，下限 0.1） */
const sec = (
  startMs: number,
  endMs: number,
  terms: string[],
  importance = 3,
): Omit<Section, 'density'> => ({
  id: 'sec_0001',
  title: '标题',
  startMs,
  endMs,
  summary: '摘要',
  bullets: [{ text: '要点', startMs } as SectionBullet],
  terms,
  importance,
  cueRange: [0, 7],
});

/** 1 分钟章节（毫秒） */
const MIN = 60_000;

describe('computeScores：术语统计（新知识率分量）', () => {
  it('第 2 章重复第 1 章的术语不计为 new（跨章去重压低其分数）', () => {
    // ch0: 3 新术语（newRate=3）；ch1: 全重复（newRate=0）→ ch0 分数高于 ch1
    const s = computeScores([sec(0, MIN, ['a', 'b', 'c']), sec(MIN, 2 * MIN, ['a', 'b', 'c'])]);
    expect(s).toHaveLength(2);
    expect(s[0]).toBeGreaterThan(s[1]);
  });

  it('大小写不敏感：Agent 与 agent 视为同术语', () => {
    const s = computeScores([
      sec(0, MIN, ['Agent', 'x', 'y']),
      sec(MIN, 2 * MIN, ['agent', 'z']),
    ]);
    expect(s[0]).toBeGreaterThan(s[1]);
  });

  it('trim 不敏感：首尾空白不构成新术语', () => {
    // ch0: 1 新术语（'Agent'）→ newRate=1；ch1 的 'Agent' 视为重复 → newRate=0
    // termRate 零跨度 → 各 0.5；importance 全 3 → 各 0.5 → [round(72.5)=73, round(27.5)=28]
    const s = computeScores([sec(0, MIN, ['  Agent  ']), sec(MIN, 2 * MIN, ['Agent'])]);
    expect(s).toEqual([73, 28]);
  });

  it('章内自身重复不放大 termRate（["a","a"] 按 1 个计）', () => {
    // ch0: 0.5 分钟 1 术语 → termRate=2；ch1: 1 分钟 1 术语 → termRate=1
    const s = computeScores([sec(0, 30_000, ['a', 'a']), sec(30_000, 2 * MIN, ['b'])]);
    expect(s[0]).toBeGreaterThan(s[1]);
  });
});

describe('computeScores：权重与归一', () => {
  it('importance 权重（30%）生效：术语条件相同（各 3 个新术语）时高 importance 分数更高', () => {
    // 两章 newRate/termRate 零跨度 → 各 0.5；imp5 → 0.225+0.125+0.3=0.65；imp1 → 0.35
    const s = computeScores([
      sec(0, MIN, ['a', 'b', 'c'], 5),
      sec(MIN, 2 * MIN, ['d', 'e', 'f'], 1),
    ]);
    expect(s).toEqual([65, 35]);
  });

  it('重要性梯度：importance 1→5 映射到 0.0→1.0 分量', () => {
    // 无术语、importance 不同（有区分信号）：
    // imp1 → round(100*(0.45*0.5+0.25*0.5+0)) = 35；imp5 → 65
    const s = computeScores([sec(0, MIN, [], 1), sec(MIN, 2 * MIN, [], 5)]);
    expect(s).toEqual([35, 65]);
  });

  it('零跨度分量取 0.5：newTermRate 全片相同时不产生区分', () => {
    // 两章各 3 个新术语、各 1 分钟 → newRate/termRate 零跨度 → 各 0.5
    // imp3 → 0.225+0.125+0.15=0.5 → 50；imp5 → 0.225+0.125+0.3=0.65 → 65
    const s = computeScores([
      sec(0, MIN, ['a', 'b', 'c'], 3),
      sec(MIN, 2 * MIN, ['d', 'e', 'f'], 5),
    ]);
    expect(s).toEqual([50, 65]);
  });

  it('分数在 0-100 边界内（极端重要性 + 极端术语密度）', () => {
    const sections = [
      sec(0, 0.1 * MIN, ['a', 'b', 'c', 'd', 'e'], 5), // 短章多术语
      sec(0.1 * MIN, 5 * MIN, [], 1), // 长章无术语
    ];
    const s = computeScores(sections);
    for (const v of s) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(s[0]).toBe(100); // 全分量最大
    expect(s[1]).toBe(0); // 全分量最小
  });

  it('新知识率权重（45%）高于术语密度（25%）：纯新术语章节分数更高', () => {
    // ch0: 5 个全为新术语；ch1: 5 个术语但全部与 ch0 重复（termRate 零跨度 → 各 0.5）
    // ch0: 0.45*1+0.25*0.5+0.3*0.5=0.725 → 73；ch1: 0.275 → 28
    const s = computeScores([
      sec(0, MIN, ['a', 'b', 'c', 'd', 'e'], 3),
      sec(MIN, 2 * MIN, ['a', 'b', 'c', 'd', 'e'], 3),
    ]);
    expect(s).toEqual([73, 28]);
  });
});

describe('computeScores：退化情形', () => {
  it('空数组 → []', () => {
    expect(computeScores([])).toEqual([]);
  });

  it('单章 → [50]（中位，即使有术语且 importance 高）', () => {
    expect(computeScores([sec(0, MIN, ['a', 'b', 'c'], 5)])).toEqual([50]);
  });

  it('全部无术语且 importance 全同 → 全 50（全零退化，无区分信号）', () => {
    const sections = [
      sec(0, MIN, [], 3),
      sec(MIN, 2 * MIN, [], 3),
      sec(2 * MIN, 3 * MIN, [], 3),
      sec(3 * MIN, 4 * MIN, [], 3),
    ];
    expect(computeScores(sections)).toEqual([50, 50, 50, 50]);
  });
});

describe('densityFromScore（分数分档）', () => {
  it('score ≥ 70 → high', () => {
    expect(densityFromScore(70)).toBe('high');
    expect(densityFromScore(100)).toBe('high');
  });

  it('score ≤ 30 → low', () => {
    expect(densityFromScore(30)).toBe('low');
    expect(densityFromScore(0)).toBe('low');
  });

  it('31-69 → mid', () => {
    expect(densityFromScore(31)).toBe('mid');
    expect(densityFromScore(50)).toBe('mid');
    expect(densityFromScore(69)).toBe('mid');
  });
});

describe('attachDensity（score + density 一并填充）', () => {
  it('输出与输入等长、score/density 齐全、原字段不变', () => {
    const input = [
      sec(0, MIN, ['a', 'b', 'c', 'd', 'e'], 5),
      sec(MIN, 2 * MIN, ['a', 'b', 'c', 'd', 'e'], 3),
    ];
    const out = attachDensity(input);
    expect(out).toHaveLength(2);
    out.forEach((s, i) => {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.density).toBe(densityFromScore(s.score ?? 0));
      expect(s.title).toBe(input[i].title);
      expect(s.terms).toEqual(input[i].terms);
      expect(s.importance).toBe(input[i].importance);
      expect(s.bullets).toEqual(input[i].bullets);
    });
  });

  it('不修改输入数组（纯函数，无副作用）', () => {
    const input = [sec(0, MIN, ['a']), sec(MIN, 2 * MIN, ['b'])];
    const snapshot = JSON.stringify(input);
    attachDensity(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('computeScores：确定性（红线 1）', () => {
  it('同输入两次调用结果全等', () => {
    const sections = [
      sec(0, MIN, ['Agent', '上下文'], 4),
      sec(MIN, 2 * MIN, ['agent', 'RAG'], 2),
      sec(2 * MIN, 3 * MIN, ['RAG', '微调'], 5),
      sec(3 * MIN, 4 * MIN, ['量化'], 1),
      sec(4 * MIN, 5 * MIN, [], 3),
    ];
    expect(computeScores(sections)).toEqual(computeScores(sections));
    expect(attachDensity(sections)).toEqual(attachDensity(sections));
  });
});
