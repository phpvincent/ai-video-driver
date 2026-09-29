import { describe, expect, it } from 'vitest';
import {
  enforceMinDuration,
  finalizeOutline,
  IncrementalMerger,
  titleSimilarity,
  validateOutline,
} from '../../../src/core/pipeline/merge';
import type { SnappedSection } from '../../../src/core/pipeline/snap';
import type { OutlineSection } from '../../../src/core/pipeline/types';
import type { SectionBullet } from '../../../src/types';
import { OUTLINE } from '../../../src/config';
import type { Cue } from '../../../src/types';

const bl = (text: string, startMs = 0): SectionBullet => ({ text, startMs });

const sn = (
  title: string,
  startMs: number,
  bullets: SectionBullet[] = [bl('要点', startMs)],
  terms: string[] = [],
  importance = 3,
): SnappedSection => ({
  title,
  startMs,
  summary: '摘要',
  bullets,
  terms,
  importance,
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
  it('标题相似 + 时间相邻 → 合并进尾部，追加要点/术语（bullets 按 text 去重）', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('变量与类型系统', 0, [bl('变量声明', 0)], ['变量'])]);
    merger.addChunk([
      sn('变量与类型系统详解', 2_000, [bl('作用域规则', 2_000), bl('变量声明', 1_000)], ['变量', '作用域']),
    ]);
    const sections = merger.getSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('变量与类型系统');
    expect(sections[0].startMs).toBe(0);
    expect(sections[0].bullets).toEqual([bl('变量声明', 0), bl('作用域规则', 2_000)]);
    expect(sections[0].terms).toEqual(['变量', '作用域']); // 去重
  });

  it('合并保留尾部 importance（已确认部分不跳动）', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('变量与类型系统', 0, [bl('变量声明')], [], 2)]);
    merger.addChunk([sn('变量与类型系统详解', 2_000, [bl('作用域规则')], [], 5)]);
    expect(merger.getSections()[0].importance).toBe(2);
  });

  it('已确认的非尾部章节不被修改：相似候选只与尾部尝试合并', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('课程介绍', 0, [bl('介绍')]), sn('循环与流程控制', 60_000, [bl('循环')])]);
    // 与首章（非尾部）标题相似且时间相邻 → 不会并入首章，而是追加为新章节
    merger.addChunk([sn('课程介绍概览', 3_000, [bl('概览')])]);
    const sections = merger.getSections();
    expect(sections).toHaveLength(3);
    expect(sections[0].bullets).toEqual([bl('介绍', 0)]); // 首章不变
    expect(sections[2].title).toBe('课程介绍概览');
  });

  it('标题相似但时间不相邻 → 不合并', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('环境搭建', 0, [bl('要点一')])]);
    merger.addChunk([sn('环境搭建指南', 120_000, [bl('要点二')])]); // 相差 120s > 60s
    const sections = merger.getSections();
    expect(sections).toHaveLength(2);
    expect(sections[0].bullets).toEqual([bl('要点一', 0)]);
  });

  it('块内候选先按时间排序再合并', () => {
    const merger = new IncrementalMerger();
    merger.addChunk([sn('后章', 60_000), sn('前章', 0)]);
    const sections = merger.getSections();
    expect(sections.map((s) => s.startMs)).toEqual([0, 60_000]);
  });
});

describe('enforceMinDuration（最短章节强制，SPEC-03 3c）', () => {
  const MIN = OUTLINE.minSectionDurationMs; // 90_000

  it('时长 < 90s 的章节并入相邻较长章节（标题/要点/术语合并，bullets 追加）', () => {
    // 时长：A=100s，B=30s（不达标），C=270s，D=100s；B 的前邻 A(100s) < 后邻 C(270s) → 并入 C
    const out = enforceMinDuration(
      [
        sn('第一章节标题', 0, [bl('甲')], ['a'], 3),
        sn('第二章节标题', 100_000, [bl('乙')], ['b'], 3),
        sn('第三章节标题', 130_000, [bl('丙')], ['c'], 4),
        sn('第四章节标题', 400_000, [bl('丁')], ['d'], 3),
      ],
      MIN,
      500_000,
    );
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.title)).toEqual(['第一章节标题', '第三章节标题', '第四章节标题']);
    // C 采用被并章节 B 的起点；bullets 追加（B 在前）；terms 合并；保留 C 的 importance
    expect(out[1].startMs).toBe(100_000);
    expect(out[1].bullets).toEqual([bl('乙'), bl('丙')]);
    expect(out[1].terms).toEqual(['b', 'c']);
    expect(out[1].importance).toBe(4);
  });

  it('并入前邻：前邻保持原起点，bullets 追加在后', () => {
    // 时长：A=200s，B=40s（不达标，末章）→ 只能并入前邻 A
    const out = enforceMinDuration(
      [sn('前邻章节标题', 0, [bl('甲')], ['a'], 3), sn('末尾短章标题', 200_000, [bl('乙')], ['b'], 3)],
      MIN,
      240_000,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('前邻章节标题');
    expect(out[0].startMs).toBe(0);
    expect(out[0].bullets).toEqual([bl('甲'), bl('乙')]);
    expect(out[0].terms).toEqual(['a', 'b']);
  });

  it('迭代处理：合并结果仍不达标时继续并入，直至全部达标', () => {
    // 四章各 50s：先并最先出现的短章（首章并入后邻）→ 100s/50s/50s → 再并 → 150s/50s → 最后并成一章
    const out = enforceMinDuration(
      [
        sn('第一章节标题', 0, [bl('一')]),
        sn('第二章节标题', 50_000, [bl('二')]),
        sn('第三章节标题', 100_000, [bl('三')]),
        sn('第四章节标题', 150_000, [bl('四')]),
      ],
      MIN,
      200_000,
    );
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBe(0);
    expect(out.map((s) => s.bullets)).toEqual([[bl('一'), bl('二'), bl('三'), bl('四')]]);
  });

  it('只剩一章 → 原样返回不合并', () => {
    const input = [sn('唯一章节标题', 0, [bl('独')])];
    const out = enforceMinDuration(input, MIN, 10_000);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('唯一章节标题');
  });

  it('时长恰为 90s（不小于阈值）→ 不合并', () => {
    const out = enforceMinDuration(
      [sn('第一章节标题', 0), sn('第二章节标题', 90_000)],
      MIN,
      180_000,
    );
    expect(out).toHaveLength(2);
  });

  it('纯函数：不修改入参数组', () => {
    const input = [sn('第一章节标题', 0, [bl('甲')]), sn('第二章节标题', 50_000, [bl('乙')])];
    const snapshot = JSON.stringify(input);
    enforceMinDuration(input, MIN, 100_000);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('finalizeOutline（A4 全局校正）', () => {
  // 注意：这些用例聚焦排序/去重/endMs 链等原语义，传 minSectionDurationMs=0 关闭最短章节强制；
  // 默认 90s 的端到端效果见下个 describe。
  it('排序 + 剔除同 startMs 重叠 + endMs 链 + id 重编', () => {
    // 乱序输入 + 重复 startMs
    const out = finalizeOutline(
      [sn('第二章', 40_000), sn('第一章', 0), sn('第一章重复', 0)],
      mkCues(),
      0,
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
    const out = finalizeOutline([sn('第二章', 20_000)], mkCues(), 0);
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBe(0); // === cues[0].startMs
    expect(out[0].endMs).toBe(75_000);
  });

  it('cueRange 覆盖正确且相邻章节不重叠', () => {
    const out = finalizeOutline([sn('第一章', 0), sn('第二章', 40_000)], mkCues(), 0);
    expect(out[0].cueRange).toEqual([0, 3]); // 0s..30s 四条 Cue
    expect(out[1].cueRange).toEqual([4, 7]); // 40s..70s 四条 Cue
  });

  it('空输入 → 空输出', () => {
    expect(finalizeOutline([], mkCues())).toEqual([]);
  });

  it('产物携带 importance / score / density（attachDensity 填充）', () => {
    const out = finalizeOutline(
      [sn('第一章标题', 0, [bl('甲')], ['a'], 5), sn('第二章标题', 40_000, [bl('乙')], ['b'], 1)],
      mkCues(),
      0,
    );
    expect(out.map((s) => s.importance)).toEqual([5, 1]);
    for (const s of out) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(['low', 'mid', 'high']).toContain(s.density);
    }
  });
});

describe('finalizeOutline 默认最短章节强制（90s 端到端）', () => {
  it('不足 90s 的相邻章节在 finalize 中被并入，产物仍通过覆盖校验', () => {
    // 两章各 ~40s：末章 B(35s) 最短，只能并入前邻 A → 合并为一章，保留 A 的标题
    const out = finalizeOutline([sn('第一章标题', 0), sn('第二章标题', 40_000)], mkCues());
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBe(0);
    expect(out[0].endMs).toBe(75_000);
    expect(out[0].cueRange).toEqual([0, 7]);
    expect(out[0].title).toBe('第一章标题');
  });

  it('均达标（≥90s 间隔）→ 章节保留', () => {
    const cues = Array.from({ length: 40 }, (_, i) => ({
      index: i,
      startMs: i * 60_000,
      endMs: i * 60_000 + 5_000,
      text: `line-${i}`,
    }));
    const out = finalizeOutline([sn('第一章标题', 0), sn('第二章标题', 180_000)], cues);
    expect(out).toHaveLength(2);
    expect(out[1].startMs).toBe(180_000);
  });
});

describe('validateOutline（覆盖校验）', () => {
  const base = (startMs: number): OutlineSection => ({
    id: 'sec_0001',
    title: '标题',
    startMs,
    endMs: 75_000,
    summary: '摘要',
    bullets: [bl('要点')],
    terms: [],
    importance: 3,
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
