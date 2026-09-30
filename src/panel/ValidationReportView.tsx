/**
 * 验证期报告视图（SPEC-07 子任务 7.1）。
 *
 * - 未加载：显示「生成验证期报告」按钮，onLoad 由父 agent 接线（读本地 usage + qaHistory）
 * - 已加载：指标表（指标/数值/判定徽标）+ 整体结论 + 主观回顾录入 + 复制/下载 Markdown
 * - 主观回顾三选一（明显少 / 差不多 / 更多）只在本地 state 累加，
 *   仅影响本视图展示与报告文本，不写库（入库留给父 agent）。
 *
 * 判定阈值与结论文案全部来自 core/metrics/report（SPEC-07 §4）。
 */
import { useState } from 'react';
import type { QaRecord } from '../types';
import type { UsageRecord } from '../core/metrics/usage';
import {
  METRIC_KEYS,
  buildValidationReport,
  computeStats,
  formatMetricValue,
  formatPercent,
  formatVerdictLabel,
  judge,
  overallConclusion,
  type MetricVerdict,
  type SubjectiveInput,
  type ValidationStats,
  type Verdict,
} from '../core/metrics/report';
import './validation.css';

export { formatPercent, formatVerdictLabel };

export interface ValidationReportData {
  usage: UsageRecord[];
  qa: QaRecord[];
}

export interface ValidationReportViewProps {
  /** 父 agent 接线：拉取本地使用记录与问答历史 */
  onLoad?: () => Promise<ValidationReportData>;
}

/** 主观回顾录入项：明显少 / 差不多 / 更多 */
const SUBJECTIVE_OPTIONS: Array<{ key: keyof SubjectiveTally; label: string }> = [
  { key: 'improved', label: '明显少' },
  { key: 'same', label: '差不多' },
  { key: 'more', label: '更多' },
];

interface SubjectiveTally {
  improved: number;
  same: number;
  more: number;
}

const EMPTY_TALLY: SubjectiveTally = { improved: 0, same: 0, more: 0 };

/** 判定徽标配色：继续绿 / 调整黄 / 放弃红（浅色主题） */
export function verdictClass(v: Verdict): string {
  return `vr-badge vr-${v}`;
}

function toSubjectiveInput(tally: SubjectiveTally): SubjectiveInput | undefined {
  const total = tally.improved + tally.same + tally.more;
  return total > 0 ? { improved: tally.improved, total } : undefined;
}

/** 指标表（纯展示，便于单测直接渲染） */
export function ValidationReportTable({
  verdicts,
}: {
  verdicts: MetricVerdict[];
}): JSX.Element | null {
  if (verdicts.length === 0) return null;
  return (
    <table className="vr-table">
      <thead>
        <tr>
          <th>指标</th>
          <th>数值</th>
          <th>判定</th>
          <th>阈值</th>
        </tr>
      </thead>
      <tbody>
        {verdicts.map((v) => (
          <tr key={v.key}>
            <td>{v.key}</td>
            <td className="vr-value">{formatMetricValue(v)}</td>
            <td>
              <span className={verdictClass(v.verdict)}>{formatVerdictLabel(v.verdict)}</span>
            </td>
            <td className="vr-threshold">{v.thresholdText}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 统计概览（视频数 / 字幕命中率 / 跳转均值 / 提问均值） */
export function ValidationStatsSummary({ stats }: { stats: ValidationStats }): JSX.Element {
  return (
    <ul className="vr-summary">
      <li>
        <span>视频数</span>
        <b>{stats.videoCount}</b>
      </li>
      <li>
        <span>{METRIC_KEYS.subtitleHitRate}</span>
        <b>{formatPercent(stats.subtitleHitRate)}</b>
      </li>
      <li>
        <span>平均跳转/视频</span>
        <b>{Math.round(stats.seeksPerVideo * 100) / 100}</b>
      </li>
      <li>
        <span>平均提问/视频</span>
        <b>{Math.round(stats.qaPerVideo * 100) / 100}</b>
      </li>
    </ul>
  );
}

export function ValidationReportView({ onLoad }: ValidationReportViewProps) {
  const [data, setData] = useState<ValidationReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<SubjectiveTally>(EMPTY_TALLY);
  const [hint, setHint] = useState<string | null>(null);

  const handleLoad = () => {
    if (!onLoad) return;
    setLoading(true);
    setError(null);
    setHint(null);
    onLoad()
      .then((d) => setData({ usage: d?.usage ?? [], qa: d?.qa ?? [] }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  const report = (): string => {
    if (!data) return '';
    const stats = computeStats(data);
    const subjective = toSubjectiveInput(tally);
    const verdicts = judge(stats, { subjective });
    return buildValidationReport({
      stats,
      verdicts,
      conclusion: formatVerdictLabel(overallConclusion(verdicts)),
      generatedAt: new Date().toISOString(),
      subjective,
    });
  };

  const handleCopy = () => {
    const text = report();
    try {
      void navigator.clipboard.writeText(text).then(
        () => setHint('已复制到剪贴板'),
        () => setHint('复制失败，请改用下载'),
      );
    } catch {
      setHint('复制失败，请改用下载');
    }
  };

  const bump = (key: keyof SubjectiveTally) =>
    setTally((prev) => ({ ...prev, [key]: prev[key] + 1 }) as SubjectiveTally);

  const handleDownload = () => {
    const text = report();
    try {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mvp-validation-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      setHint('已下载 Markdown 报告');
    } catch {
      setHint('下载失败');
    }
  };

  if (!data) {
    return (
      <div className="vr">
        <p className="vr-hint">
          统计本机使用数据（大纲/导图跳转、划词与区间提问、字幕命中），生成可存入 Obsidian 的 Markdown 报告。
        </p>
        <button type="button" className="btn btn-primary" onClick={handleLoad} disabled={loading || !onLoad}>
          {loading ? '生成中…' : '生成验证期报告'}
        </button>
        {!onLoad && <p className="vr-hint">未接入数据加载（onLoad 未传入）</p>}
        {error && <p className="vr-hint vr-error">{error}</p>}
      </div>
    );
  }

  const stats = computeStats(data);
  const subjective = toSubjectiveInput(tally);
  const verdicts = judge(stats, { subjective });
  const conclusion = overallConclusion(verdicts);
  const total = tally.improved + tally.same + tally.more;

  return (
    <div className="vr">
      <header className="vr-header">
        <h4>验证期报告</h4>
        <button type="button" className="btn" onClick={handleLoad} disabled={loading}>
          {loading ? '重新生成中…' : '重新生成'}
        </button>
      </header>

      <ValidationStatsSummary stats={stats} />
      <ValidationReportTable verdicts={verdicts} />

      <section className="vr-section">
        <h5>整体结论</h5>
        <p className={verdictClass(conclusion)}>{formatVerdictLabel(conclusion)}</p>
      </section>

      <section className="vr-section">
        <h5>回顾问卷（可跳过）</h5>
        <p className="vr-hint">这次看视频中，切出去搜索的次数比以往：{total > 0 ? `已回收 ${total} 份` : '尚未录入'}</p>
        <div className="vr-row">
          {SUBJECTIVE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              className="btn"
              onClick={() => bump(o.key)}
            >
              {o.label}（{tally[o.key]}）
            </button>
          ))}
        </div>
        {total > 0 && <p className="vr-hint">"明显少"占比 {formatPercent(tally.improved / total)}</p>}
      </section>

      <div className="vr-row">
        <button type="button" className="btn btn-primary" onClick={handleCopy}>
          复制报告
        </button>
        <button type="button" className="btn" onClick={handleDownload}>
          下载报告（Markdown）
        </button>
      </div>
      {hint && <p className="vr-hint">{hint}</p>}
      {error && <p className="vr-hint vr-error">{error}</p>}
    </div>
  );
}
