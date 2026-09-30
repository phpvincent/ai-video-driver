/**
 * SPEC-07 统计 / 判定 / 报告单测（阈值权威来源：specs/SPEC-07-mvp-validation.md §4）。
 * 全部为纯函数断言：无时钟、无随机、无 IO。
 */
import { describe, expect, it } from 'vitest';
import {
  METRIC_KEYS,
  NO_DATA_TEXT,
  buildValidationReport,
  computeStats,
  formatPercent,
  formatVerdictLabel,
  judge,
  overallConclusion,
  selectiveQaPerVideo,
  type MetricVerdict,
} from '../../../src/core/metrics/report';
import type { UsageRecord } from '../../../src/core/metrics/usage';
import type { InteractionType, QaRecord } from '../../../src/types';

let seq = 0;

function u(videoId: string, extra: Partial<UsageRecord> = {}): UsageRecord {
  return {
    videoId,
    seeks: 0,
    subtitleLoaded: false,
    outlineGenerated: false,
    conceptMapGenerated: false,
    firstUsedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function q(videoId: string, interactionType: InteractionType): QaRecord {
  seq += 1;
  return {
    id: `qa_${seq}`,
    videoId,
    interactionType,
    sectionId: null,
    timestampMs: 0,
    rangeMs: null,
    question: '问题',
    answer: '回答',
    payload: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function videos(n: number, extra: Partial<UsageRecord> = {}): UsageRecord[] {
  return Array.from({ length: n }, (_, i) => u(`BV${i}_p1`, extra));
}

function qas(counts: { term?: number; segment?: number; free?: number }): QaRecord[] {
  const out: QaRecord[] = [];
  for (let i = 0; i < (counts.term ?? 0); i++) out.push(q('v', 'term'));
  for (let i = 0; i < (counts.segment ?? 0); i++) out.push(q('v', 'segment'));
  for (let i = 0; i < (counts.free ?? 0); i++) out.push(q('v', 'free'));
  return out;
}

/** 取某一指标的判定行 */
function row(verdicts: MetricVerdict[], key: string): MetricVerdict {
  const found = verdicts.find((v) => v.key === key);
  if (!found) throw new Error(`未找到指标行：${key}`);
  return found;
}

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------

describe('computeStats', () => {
  it('视频数与字幕命中率：10 个视频 8 个命中 → 0.8', () => {
    const usage = [...videos(8, { subtitleLoaded: true }), ...videos(2, { subtitleLoaded: false })];
    const stats = computeStats({ usage, qa: [] });
    expect(stats.videoCount).toBe(10);
    expect(stats.subtitleHitCount).toBe(8);
    expect(stats.subtitleHitRate).toBe(0.8);
  });

  it('跳转总数与均值：总 30 / 10 视频 → 3', () => {
    const stats = computeStats({ usage: videos(10, { seeks: 3 }), qa: [] });
    expect(stats.totalSeeks).toBe(30);
    expect(stats.seeksPerVideo).toBe(3);
  });

  it('大纲与概念图计数', () => {
    const usage = [
      ...videos(6, { outlineGenerated: true, conceptMapGenerated: true }),
      ...videos(3, { outlineGenerated: true }),
      ...videos(1),
    ];
    const stats = computeStats({ usage, qa: [] });
    expect(stats.outlineCount).toBe(9);
    expect(stats.conceptMapCount).toBe(6);
  });

  it('问答分类统计：划词 / 区间 / 自由 与总数、均值', () => {
    const stats = computeStats({ usage: videos(2), qa: qas({ term: 3, segment: 2, free: 5 }) });
    expect(stats.qaByType).toEqual({ term: 3, segment: 2, free: 5 });
    expect(stats.qaTotal).toBe(10);
    expect(stats.qaPerVideo).toBe(5);
    expect(selectiveQaPerVideo(stats)).toBe(2.5);
  });

  it('空数据退化：视频数 0 时所有比率为 0（无 NaN）', () => {
    const stats = computeStats({ usage: [], qa: [] });
    expect(stats.videoCount).toBe(0);
    expect(stats.subtitleHitRate).toBe(0);
    expect(stats.seeksPerVideo).toBe(0);
    expect(stats.qaPerVideo).toBe(0);
    expect(selectiveQaPerVideo(stats)).toBe(0);
    expect(Number.isNaN(stats.subtitleHitRate)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// judge —— 五项阈值边界（SPEC-07 §4）
// ---------------------------------------------------------------------------

describe('judge · 完成学习的视频数', () => {
  const of = (n: number) => row(judge(computeStats({ usage: videos(n), qa: [] })), METRIC_KEYS.videoCount);
  it('≥ 10 → 继续', () => expect(of(10).verdict).toBe('continue'));
  it('5~9 → 调整', () => expect(of(9).verdict).toBe('adjust'));
  it('< 5 → 放弃', () => expect(of(4).verdict).toBe('abandon'));
});

describe('judge · 字幕一级通道命中率', () => {
  const of = (hit: number, total: number) =>
    row(
      judge(
        computeStats({
          usage: [...videos(hit, { subtitleLoaded: true }), ...videos(total - hit)],
          qa: [],
        }),
      ),
      METRIC_KEYS.subtitleHitRate,
    );
  it('≥ 80% → 继续', () => expect(of(8, 10).verdict).toBe('continue'));
  it('60%~80% → 调整', () => expect(of(7, 10).verdict).toBe('adjust'));
  it('< 60% → 放弃', () => expect(of(5, 10).verdict).toBe('abandon'));
});

describe('judge · 大纲/导图跳转次数', () => {
  const of = (seeksPerVideo: number) =>
    row(
      judge(computeStats({ usage: videos(10, { seeks: seeksPerVideo }), qa: [] })),
      METRIC_KEYS.seeksPerVideo,
    );
  it('≥ 3 → 继续', () => expect(of(3).verdict).toBe('continue'));
  it('1~3 → 调整', () => expect(of(2).verdict).toBe('adjust'));
  it('< 1 → 放弃', () => expect(of(0).verdict).toBe('abandon'));
});

describe('judge · 划词+区间提问次数', () => {
  const of = (selective: number) => {
    const counts = { term: Math.round(selective * 10), segment: 0, free: 0 };
    return row(
      judge(computeStats({ usage: videos(10), qa: qas(counts) })),
      METRIC_KEYS.qaSelective,
    );
  };
  it('≥ 3 → 继续', () => expect(of(3).verdict).toBe('continue'));
  it('1~3 → 调整', () => expect(of(1.5).verdict).toBe('adjust'));
  it('< 1 → 放弃', () => expect(of(0.5).verdict).toBe('abandon'));
  it('自由提问不计入该项', () => {
    const stats = computeStats({ usage: videos(10), qa: qas({ free: 50 }) });
    expect(selectiveQaPerVideo(stats)).toBe(0);
    expect(row(judge(stats), METRIC_KEYS.qaSelective).verdict).toBe('abandon');
  });
});

describe('judge · 回顾问卷', () => {
  const stats = computeStats({ usage: videos(10), qa: [] });
  const of = (improved: number, total: number) =>
    row(judge(stats, { subjective: { improved, total } }), METRIC_KEYS.subjective);
  it('≥ 50% → 继续', () => expect(of(5, 10).verdict).toBe('continue'));
  it('25%~50% → 调整', () => expect(of(3, 10).verdict).toBe('adjust'));
  it('< 25% → 放弃', () => expect(of(2, 10).verdict).toBe('abandon'));
  it('未提供 → value 为「未提供」，且不拖累其余四项的判定', () => {
    const good = computeStats({
      usage: videos(10, { subtitleLoaded: true, seeks: 40 }),
      qa: qas({ term: 40 }),
    });
    const verdicts = judge(good);
    expect(row(verdicts, METRIC_KEYS.subjective).value).toBe(NO_DATA_TEXT);
    // 四项客观指标全为「继续」，主观项缺失不应把结论拉成「调整」
    expect(overallConclusion(verdicts)).toBe('continue');
  });
  it('提供时按 明显少/总数 计算占比', () => {
    const verdicts = judge(computeStats({ usage: videos(10), qa: [] }), {
      subjective: { improved: 6, total: 10 },
    });
    expect(row(verdicts, METRIC_KEYS.subjective).value).toBe(0.6);
  });
});

describe('judge · 结构', () => {
  it('固定返回五项，顺序与 SPEC-07 §4 一致', () => {
    const keys = judge(computeStats({ usage: videos(10), qa: [] })).map((v) => v.key);
    expect(keys).toEqual([
      METRIC_KEYS.videoCount,
      METRIC_KEYS.subtitleHitRate,
      METRIC_KEYS.seeksPerVideo,
      METRIC_KEYS.qaSelective,
      METRIC_KEYS.subjective,
    ]);
  });
  it('每行都带人类可读阈值说明', () => {
    for (const v of judge(computeStats({ usage: videos(1), qa: [] }))) {
      expect(v.thresholdText.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// overallConclusion
// ---------------------------------------------------------------------------

let vdSeq = 0;
function vd(verdict: MetricVerdict['verdict'], key = 'k', value: number | string = 1): MetricVerdict {
  vdSeq += 1;
  return { key: `${key}${vdSeq}`, value, verdict, thresholdText: '' };
}

describe('overallConclusion', () => {
  it('全部继续 → continue', () => {
    expect(overallConclusion(Array.from({ length: 5 }, () => vd('continue')))).toBe('continue');
  });
  it('含一个放弃 → adjust', () => {
    expect(overallConclusion([...Array.from({ length: 4 }, () => vd('continue')), vd('abandon')])).toBe(
      'adjust',
    );
  });
  it('≥ 3 个放弃 → abandon', () => {
    expect(
      overallConclusion([vd('continue'), vd('continue'), vd('abandon'), vd('abandon'), vd('abandon')]),
    ).toBe('abandon');
  });
  it('无放弃但继续项 < 3 → adjust', () => {
    expect(overallConclusion([vd('continue'), vd('continue'), vd('adjust'), vd('adjust')])).toBe('adjust');
  });
});

// ---------------------------------------------------------------------------
// buildValidationReport
// ---------------------------------------------------------------------------

describe('buildValidationReport', () => {
  const usage = [...videos(9, { subtitleLoaded: true, seeks: 4 }), ...videos(1, { seeks: 4 })];
  const stats = computeStats({ usage, qa: qas({ term: 20, segment: 10, free: 12 }) });
  const verdicts = judge(stats, { subjective: { improved: 6, total: 10 } });
  const md = buildValidationReport({
    stats,
    verdicts,
    conclusion: '继续',
    generatedAt: '2026-03-01T00:00:00.000Z',
    subjective: { improved: 6, total: 10 },
  });

  it('含全部五个指标名', () => {
    for (const key of Object.values(METRIC_KEYS)) {
      expect(md).toContain(key);
    }
  });

  it('含结论关键词与生成时间', () => {
    expect(md).toContain('整体结论');
    expect(md).toContain('**继续**');
    expect(md).toContain('2026-03-01T00:00:00.000Z');
  });

  it('Markdown 结构：标题 + 小节 + 表格分隔符', () => {
    expect(md.startsWith('# MVP 验证期报告')).toBe(true);
    expect(md).toContain('## 使用统计');
    expect(md).toContain('## 判定');
    expect(md).toContain('| 指标 | 数值 | 判定 | 阈值 |');
    expect(md).toContain('| --- | --- | --- | --- |');
  });

  it('含统计数值（命中率百分比、跳转均值、提问分类）', () => {
    expect(md).toContain('90%');
    expect(md).toContain('20 / 10 / 12');
    expect(md).toContain('| 跳转总次数 | 40 |');
  });

  it('含主观回顾占比；未提供时标注「未提供」', () => {
    expect(md).toContain('6 / 10（60%）');
    const md2 = buildValidationReport({
      stats,
      verdicts: judge(stats),
      conclusion: '调整',
      generatedAt: '2026-03-01T00:00:00.000Z',
    });
    expect(md2).toContain(NO_DATA_TEXT);
  });

  it('确定性：同参两次生成结果一致', () => {
    const args = {
      stats,
      verdicts,
      conclusion: '继续',
      generatedAt: '2026-03-01T00:00:00.000Z',
      subjective: { improved: 6, total: 10 },
    };
    expect(buildValidationReport(args)).toBe(buildValidationReport(args));
  });
});

describe('格式化', () => {
  it('formatVerdictLabel', () => {
    expect(formatVerdictLabel('continue')).toBe('继续');
    expect(formatVerdictLabel('adjust')).toBe('调整');
    expect(formatVerdictLabel('abandon')).toBe('放弃');
  });
  it('formatPercent', () => {
    expect(formatPercent(0.8)).toBe('80%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(2 / 3)).toBe('66.7%');
  });
});
