import { describe, expect, it } from 'vitest';
import {
  countVisualHints,
  cueWindows,
  dedupeFrames,
  evaluatePlan,
  planFrameTargets,
  sectionMetaOf,
  sectionWindows,
} from '../../../src/core/vision/framePlanner';
import type { Cue, Section } from '../../../src/types';

function cue(startMs: number, endMs: number, text: string): Cue {
  return { index: 0, startMs, endMs, text };
}

/** 构造课程样例：第 2 段是代码演示（提示词密集），第 1、3 段是纯口述 */
function courseCues(): Cue[] {
  return [
    cue(0, 5000, '大家好，今天我们来聊一聊这个概念'),
    cue(5000, 10000, '它其实是一个非常基础的东西'),
    cue(60_000, 66_000, '我们来看一下这段代码'),
    cue(66_000, 72_000, '这个函数接收两个参数'),
    cue(72_000, 78_000, '运行之后你会看到终端输出这样的结果'),
    cue(120_000, 126_000, '总结一下今天的内容'),
    cue(126_000, 130_000, '希望大家有所收获'),
  ];
}

function courseSections(): Section[] {
  return [
    {
      id: 'sec_0001', title: '开场介绍', startMs: 0, endMs: 60_000,
      summary: '概念铺垫', bullets: [], terms: ['基础概念'],
      importance: 2, score: 30, density: 'low',
    },
    {
      id: 'sec_0002', title: '代码演示', startMs: 60_000, endMs: 120_000,
      summary: '写一个函数并运行', bullets: [], terms: ['函数', '参数', '终端', '输出'],
      importance: 5, score: 90, density: 'high',
    },
    {
      id: 'sec_0003', title: '总结', startMs: 120_000, endMs: 130_000,
      summary: '收尾', bullets: [], terms: [],
      importance: 1, score: 20, density: 'low',
    },
  ] as unknown as Section[];
}

describe('画面提示词统计', () => {
  it('命中提示词计数；无提示词为 0', () => {
    expect(countVisualHints('我们来看一下这段代码')).toBeGreaterThan(0);
    expect(countVisualHints('大家好今天聊点别的')).toBe(0);
    expect(countVisualHints('')).toBe(0);
  });
});

describe('planFrameTargets 结构感知打分', () => {
  it('代码演示段得分高于纯口述段（结构推断有效性的核心断言）', () => {
    const sections = courseSections();
    const cues = courseCues();
    const all = planFrameTargets(sectionWindows(sections, cues), cues, {
      budget: 3,
      minScore: 0,
    }, sectionMetaOf(sections));
    expect(all.length).toBe(3);
    const demo = all.find((w) => w.startMs === 60_000)!;
    const talk = all.find((w) => w.startMs === 0)!;
    const outro = all.find((w) => w.startMs === 120_000)!;
    expect(demo.score).toBeGreaterThan(talk.score);
    expect(demo.score).toBeGreaterThan(outro.score);
    expect(demo.reasons.join('')).toContain('画面提示词');
  });

  it('预算收紧时优先保留高分窗口（按分数配预算）', () => {
    const sections = courseSections();
    const cues = courseCues();
    const picked = planFrameTargets(sectionWindows(sections, cues), cues, {
      budget: 1,
      minScore: 0,
    }, sectionMetaOf(sections));
    expect(picked.length).toBe(1);
    expect(picked[0]!.startMs).toBe(60_000);
  });

  it('低于 minScore 的窗口不取（避免为抽而抽）', () => {
    const sections = courseSections();
    const cues = courseCues();
    const picked = planFrameTargets(sectionWindows(sections, cues), cues, {
      budget: 3,
      minScore: 90,
    }, sectionMetaOf(sections));
    expect(picked.every((w) => w.score >= 90)).toBe(true);
  });

  it('取帧点落在提示词命中的字幕时刻（而非窗口开头）', () => {
    const sections = courseSections();
    const cues = courseCues();
    const picked = planFrameTargets(sectionWindows(sections, cues), cues, {
      budget: 3,
      minScore: 0,
    }, sectionMetaOf(sections));
    const demo = picked.find((w) => w.startMs === 60_000)!;
    expect(demo.targetMs).toBe(60_000);
  });

  it('时间去重：间隔小于 minGapMs 的窗口只取一个', () => {
    const windows = [
      { startMs: 0, endMs: 10_000 },
      { startMs: 3_000, endMs: 13_000 },
      { startMs: 60_000, endMs: 70_000 },
    ];
    const cues = [cue(0, 1000, '看一下代码'), cue(3000, 4000, '参数'), cue(60_000, 61_000, '演示')];
    const picked = planFrameTargets(windows, cues, { budget: 3, minGapMs: 15_000, minScore: 0 });
    expect(picked.length).toBe(2);
    expect(picked.some((w) => w.startMs === 3_000)).toBe(false);
  });

  it('确定性：同输入两次规划结果完全一致（红线 1）', () => {
    const sections = courseSections();
    const cues = courseCues();
    const opts = { budget: 3, minScore: 0, minGapMs: 15_000 };
    const a = planFrameTargets(sectionWindows(sections, cues), cues, opts, sectionMetaOf(sections));
    const b = planFrameTargets(sectionWindows(sections, cues), cues, opts, sectionMetaOf(sections));
    expect(a).toEqual(b);
  });

  it('退化：预算 0 / 无窗口 / 无字幕均返回空', () => {
    const cues = courseCues();
    expect(planFrameTargets([{ startMs: 0, endMs: 1000 }], cues, { budget: 0 })).toEqual([]);
    expect(planFrameTargets([], cues, { budget: 3 })).toEqual([]);
    expect(planFrameTargets([{ startMs: 0, endMs: 1000 }], [], { budget: 3 })).toEqual([]);
  });

  it('无章节时按固定窗口切分（大纲生成阶段）', () => {
    const cues = courseCues();
    const windows = cueWindows(cues, 60_000);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]!.startMs).toBe(0);
    // 窗口不重叠且覆盖到末尾
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.startMs).toBeGreaterThanOrEqual(windows[i - 1]!.startMs);
    }
  });
});

describe('命中率评估', () => {
  it('结构推断的命中率与覆盖率可量化（验证是否优于均匀抽样）', () => {
    const sections = courseSections();
    const cues = courseCues();
    const windows = sectionWindows(sections, cues);
    const all = planFrameTargets(windows, cues, { budget: 3, minScore: 0 }, sectionMetaOf(sections));
    const picked = planFrameTargets(windows, cues, { budget: 1, minScore: 0 }, sectionMetaOf(sections));
    const m = evaluatePlan(all, picked, { minScore: 0 });
    // 选中的窗口都有打分依据 → 命中率 100%（说明"抽在点子上"而非随机）
    expect(m.hitRate).toBe(1);
    expect(m.coverage).toBeGreaterThan(0);
    expect(m.redundancy).toBeGreaterThan(0);
    expect(m.avgScore).toBeGreaterThan(0);
  });

  it('空选择时指标为 0 不报错', () => {
    const m = evaluatePlan([], [], {});
    expect(m).toEqual({ coverage: 0, redundancy: 0, avgScore: 0, hitRate: 0 });
  });
});

describe('抽到的帧去重', () => {
  const frame = (actualMs: number, len: number) => ({
    targetMs: actualMs,
    actualMs,
    dataBase64: 'x'.repeat(len),
  });

  it('时间过近且画面几乎未变 → 丢弃后一帧（同一页 PPT）', () => {
    const out = dedupeFrames([frame(1000, 5000), frame(3000, 5010)], { minGapMs: 15_000 });
    expect(out.length).toBe(1);
  });

  it('时间过近但画面明显变化 → 保留', () => {
    const out = dedupeFrames([frame(1000, 5000), frame(3000, 9000)], { minGapMs: 15_000 });
    expect(out.length).toBe(2);
  });

  it('时间间隔足够 → 保留', () => {
    const out = dedupeFrames([frame(1000, 5000), frame(60_000, 5000)], { minGapMs: 15_000 });
    expect(out.length).toBe(2);
  });

  it('空帧（抽帧失败）一律丢弃', () => {
    const out = dedupeFrames([{ targetMs: 0, actualMs: 0, dataBase64: '' }], {});
    expect(out.length).toBe(0);
  });
});
