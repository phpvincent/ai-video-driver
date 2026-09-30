/**
 * SPEC-07 验证期统计 / 判定 / 报告（子任务 7.1）。
 *
 * 阈值与判定规则直接照抄 SPEC-07 §4（开工前固定，验证期内不修改）：
 * - 完成学习的视频数     ≥10 继续 / 5~9 调整 / <5 放弃
 * - 字幕一级通道命中率   ≥80% 继续 / 60%~80% 调整 / <60% 放弃
 * - 平均每视频跳转次数   ≥3 继续 / 1~3 调整 / <1 放弃
 * - 平均每视频划词+区间  ≥3 继续 / 1~3 调整 / <1 放弃
 * - 回顾问卷"明显少"占比 ≥50% 继续 / 25%~50% 调整 / <25% 放弃
 *
 * 本模块全部为纯函数（红线 1）：无时钟、无随机、无 IO，输出仅由入参决定。
 */
import type { QaRecord } from '../../types';
import type { UsageRecord } from './usage';

export type Verdict = 'continue' | 'adjust' | 'abandon';

export interface ValidationStats {
  /** 有使用记录的视频数 */
  videoCount: number;
  /** 字幕成功加载的视频数 */
  subtitleHitCount: number;
  /** 0~1 */
  subtitleHitRate: number;
  outlineCount: number;
  conceptMapCount: number;
  totalSeeks: number;
  seeksPerVideo: number;
  qaTotal: number;
  qaByType: { term: number; segment: number; free: number };
  /** （划词 + 区间 + 自由）/ 视频 */
  qaPerVideo: number;
  /** 抽帧诊断：累计送出帧数 */
  visionFrames: number;
  /** 抽帧诊断：模型规划成功次数（其余为公式回退） */
  visionModelPlans: number;
  /** 抽帧诊断：平均模型自报覆盖率（0~1；无自检为 0） */
  visionCoverageAvg: number;
}

export interface MetricVerdict {
  key: string;
  value: number | string;
  verdict: Verdict;
  /** 人类可读阈值说明 */
  thresholdText: string;
}

/** 指标名常量：报告与视图共用，避免中文 key 散落（顺序 = 报告输出顺序） */
export const METRIC_KEYS = {
  videoCount: '完成学习的视频数',
  subtitleHitRate: '字幕一级通道命中率',
  seeksPerVideo: '大纲/导图跳转次数',
  qaSelective: '划词+区间提问次数',
  subjective: '回顾问卷',
} as const;

/** 无主观回顾数据时的占位值（该行不计入整体判定） */
export const NO_DATA_TEXT = '未提供';

export const VERDICT_TEXT: Record<Verdict, string> = {
  continue: '继续',
  adjust: '调整',
  abandon: '放弃',
};

/** 判定文案：视图徽标与报告共用 */
export function formatVerdictLabel(v: Verdict): string {
  return VERDICT_TEXT[v] ?? v;
}

/** 0.8 → '80%'；保留一位小数并去掉多余的 .0 */
export function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return '--';
  const pct = Math.round(n * 1000) / 10;
  return `${pct}%`;
}

/** 均值类数值：保留两位小数 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '--';
  return String(Math.round(n * 100) / 100);
}

/** 除零退化为 0（空数据时不产生 NaN/Infinity） */
function ratio(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/** 从使用记录与问答历史汇总统计（纯函数，空输入全 0 退化） */
export function computeStats(args: { usage: UsageRecord[]; qa: QaRecord[] }): ValidationStats {
  const usage = args.usage ?? [];
  const qa = args.qa ?? [];
  const videoCount = usage.length;
  const subtitleHitCount = usage.filter((u) => u.subtitleLoaded).length;
  const totalSeeks = usage.reduce((sum, u) => sum + (Number.isFinite(u.seeks) ? u.seeks : 0), 0);
  // 抽帧诊断累计（验证结构推断命中率；不参与继续/调整/放弃判定）
  const visionFrames = usage.reduce((sum, u) => sum + (u.vision?.frames ?? 0), 0);
  const visionModelPlans = usage.reduce((sum, u) => sum + (u.vision?.modelPlans ?? 0), 0);
  const visionCoverageSum = usage.reduce((sum, u) => sum + (u.vision?.coverageSum ?? 0), 0);
  const visionCoverageCount = usage.reduce((sum, u) => sum + (u.vision?.coverageCount ?? 0), 0);
  const visionCoverageAvg = visionCoverageCount > 0 ? visionCoverageSum / visionCoverageCount : 0;
  const qaByType = { term: 0, segment: 0, free: 0 };
  for (const r of qa) {
    if (r.interactionType === 'term' || r.interactionType === 'segment' || r.interactionType === 'free') {
      qaByType[r.interactionType] += 1;
    }
  }
  const qaTotal = qa.length;
  return {
    videoCount,
    subtitleHitCount,
    subtitleHitRate: ratio(subtitleHitCount, videoCount),
    outlineCount: usage.filter((u) => u.outlineGenerated).length,
    conceptMapCount: usage.filter((u) => u.conceptMapGenerated).length,
    totalSeeks,
    seeksPerVideo: ratio(totalSeeks, videoCount),
    qaTotal,
    qaByType,
    qaPerVideo: ratio(qaTotal, videoCount),
    visionFrames,
    visionModelPlans,
    visionCoverageAvg,
  };
}

/** 三档判定：≥ high 继续 / ≥ mid 调整 / 其余放弃（high 为闭区间下界） */
function band(n: number, high: number, mid: number): Verdict {
  if (!Number.isFinite(n)) return 'abandon';
  if (n >= high) return 'continue';
  if (n >= mid) return 'adjust';
  return 'abandon';
}

/** 平均每视频划词 + 区间提问次数（判定第四项；由 qaByType 派生，不额外存字段） */
export function selectiveQaPerVideo(stats: ValidationStats): number {
  return ratio(stats.qaByType.term + stats.qaByType.segment, stats.videoCount);
}

export interface SubjectiveInput {
  /** 回顾问卷选"明显少"的份数 */
  improved: number;
  /** 回收总份数 */
  total: number;
}

/**
 * 按 SPEC-07 §4 逐项判定，返回五项（顺序固定）。
 * 未传 subjective（或 total ≤ 0）时，回顾问卷项 value = '未提供' 且不计入整体判定
 * （其 verdict 取中性 'adjust'，仅供展示，overallConclusion 会整行排除）。
 */
export function judge(stats: ValidationStats, opts?: { subjective?: SubjectiveInput }): MetricVerdict[] {
  const subjective = opts?.subjective;
  const hasSubjective = typeof subjective === 'object' && subjective !== null && subjective.total > 0;
  return [
    {
      key: METRIC_KEYS.videoCount,
      value: stats.videoCount,
      verdict: band(stats.videoCount, 10, 5),
      thresholdText: '≥ 10 继续 / 5~9 调整 / < 5 放弃',
    },
    {
      key: METRIC_KEYS.subtitleHitRate,
      value: stats.subtitleHitRate,
      verdict: band(stats.subtitleHitRate, 0.8, 0.6),
      thresholdText: '≥ 80% 继续 / 60%~80% 调整 / < 60% 放弃',
    },
    {
      key: METRIC_KEYS.seeksPerVideo,
      value: stats.seeksPerVideo,
      verdict: band(stats.seeksPerVideo, 3, 1),
      thresholdText: '平均每视频 ≥ 3 继续 / 1~3 调整 / < 1 放弃',
    },
    {
      key: METRIC_KEYS.qaSelective,
      value: selectiveQaPerVideo(stats),
      verdict: band(selectiveQaPerVideo(stats), 3, 1),
      thresholdText: '平均每视频 ≥ 3 继续 / 1~3 调整 / < 1 放弃',
    },
    hasSubjective
      ? {
          key: METRIC_KEYS.subjective,
          value: ratio(subjective!.improved, subjective!.total),
          verdict: band(ratio(subjective!.improved, subjective!.total), 0.5, 0.25),
          thresholdText: '"明显少"占比 ≥ 50% 继续 / 25%~50% 调整 / < 25% 放弃',
        }
      : {
          key: METRIC_KEYS.subjective,
          value: NO_DATA_TEXT,
          verdict: 'adjust' as Verdict,
          thresholdText: '未提供主观回顾数据（本项不计入整体判定）',
        },
  ];
}

/**
 * 整体结论（SPEC-07 §4 判定规则）：
 * 1. 放弃项 ≥ 3 → abandon
 * 2. 任一放弃 → adjust
 * 3. 继续项 ≥ 3 → continue
 * 4. 其余（继续项 < 3）→ adjust
 * value === '未提供' 的行整行排除。
 */
export function overallConclusion(verdicts: MetricVerdict[]): Verdict {
  const counted = (verdicts ?? []).filter((v) => v.value !== NO_DATA_TEXT);
  const abandons = counted.filter((v) => v.verdict === 'abandon').length;
  if (abandons >= 3) return 'abandon';
  if (abandons >= 1) return 'adjust';
  const continues = counted.filter((v) => v.verdict === 'continue').length;
  return continues >= 3 ? 'continue' : 'adjust';
}

/** 指标行的展示文本：比率类转百分比，其余保留两位小数 */
export function formatMetricValue(v: MetricVerdict): string {
  if (typeof v.value === 'string') return v.value;
  if (v.key === METRIC_KEYS.subtitleHitRate || v.key === METRIC_KEYS.subjective) {
    return formatPercent(v.value);
  }
  return formatNumber(v.value);
}

export interface BuildReportArgs {
  stats: ValidationStats;
  verdicts: MetricVerdict[];
  /** 已渲染的整体结论文案（'继续' / '调整' / '放弃'） */
  conclusion: string;
  generatedAt: string;
  subjective?: SubjectiveInput;
}

/** Markdown 报告：含使用统计、逐项判定、整体结论与主观回顾，可一键复制/下载 */
export function buildValidationReport(args: BuildReportArgs): string {
  const { stats, verdicts, conclusion, generatedAt } = args;
  const subjective = args.subjective;
  const hasSubjective = typeof subjective === 'object' && subjective !== null && subjective.total > 0;
  const lines: string[] = [];
  lines.push('# MVP 验证期报告');
  lines.push('');
  lines.push(`- 生成时间：${generatedAt}`);
  lines.push('- 判定依据：SPEC-07 §4（阈值开工前固定，验证期内不修改）');
  lines.push('- 数据来源：本机 IndexedDB 使用记录与问答历史（不上传）');
  lines.push('');
  lines.push('## 使用统计');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 有使用记录的视频数 | ${stats.videoCount} |`);
  lines.push(`| 字幕命中视频数 | ${stats.subtitleHitCount} |`);
  lines.push(`| ${METRIC_KEYS.subtitleHitRate} | ${formatPercent(stats.subtitleHitRate)} |`);
  lines.push(`| 生成大纲的视频数 | ${stats.outlineCount} |`);
  lines.push(`| 生成概念图的视频数 | ${stats.conceptMapCount} |`);
  lines.push(`| 跳转总次数 | ${stats.totalSeeks} |`);
  lines.push(`| ${METRIC_KEYS.seeksPerVideo}（平均） | ${formatNumber(stats.seeksPerVideo)} |`);
  lines.push(`| 问答总次数 | ${stats.qaTotal} |`);
  lines.push(
    `| 划词 / 区间 / 自由 | ${stats.qaByType.term} / ${stats.qaByType.segment} / ${stats.qaByType.free} |`,
  );
  lines.push(`| 平均每视频提问次数 | ${formatNumber(stats.qaPerVideo)} |`);
  lines.push('');
    lines.push('');
  lines.push(
    `- 抽帧诊断：累计 ${stats.visionFrames} 帧，模型规划成功 ${stats.visionModelPlans} 次，` +
      `平均自报覆盖率 ${(stats.visionCoverageAvg * 100).toFixed(0)}%（仅观测，不参与判定）`,
  );
lines.push('## 判定');
  lines.push('');
  lines.push('| 指标 | 数值 | 判定 | 阈值 |');
  lines.push('| --- | --- | --- | --- |');
  for (const v of verdicts ?? []) {
    lines.push(`| ${v.key} | ${formatMetricValue(v)} | ${formatVerdictLabel(v.verdict)} | ${v.thresholdText} |`);
  }
  lines.push('');
  lines.push('## 主观回顾');
  lines.push('');
  if (hasSubjective) {
    const rate = ratio(subjective!.improved, subjective!.total);
    lines.push(`- "切出去搜索的次数明显少"：${subjective!.improved} / ${subjective!.total}（${formatPercent(rate)}）`);
  } else {
    lines.push(`- ${NO_DATA_TEXT}（本项不计入整体判定）`);
  }
  lines.push('');
  lines.push('## 整体结论');
  lines.push('');
  lines.push(`**${conclusion}**`);
  lines.push('');
  lines.push('> 用户可基于主观体验推翻判定，须记录理由（SPEC-07 §4）。');
  lines.push('');
  return lines.join('\n');
}
