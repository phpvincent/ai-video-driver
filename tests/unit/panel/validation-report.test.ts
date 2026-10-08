/**
 * 验证期报告视图单测（SPEC-07 子任务 7.1）。
 * 环境为 node 且未安装 @testing-library/react：渲染用 react-dom/server 的
 * renderToString（不触发 effect，故只覆盖未加载态与纯函数/纯展示子组件）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ValidationReportTable,
  ValidationStatsSummary,
  ValidationReportView,
  formatPercent,
  formatVerdictLabel,
} from '../../../src/panel/ValidationReportView';
import { computeStats, judge } from '../../../src/core/metrics/report';
import { createEmptyUsage } from '../../../src/core/metrics/usage';

describe('ValidationReportView 未加载态', () => {
  it('渲染「生成验证期报告」按钮', () => {
    const html = renderToString(createElement(ValidationReportView, {}));
    expect(html).toContain('加载数据并生成报告');
  });

  it('未传 onLoad 时按钮禁用并给出提示', () => {
    const html = renderToString(createElement(ValidationReportView, {}));
    expect(html).toContain('disabled');
    expect(html).toContain('未接入数据加载');
  });

  it('传入 onLoad 时按钮可用（effect 不执行，不触发加载）', () => {
    const html = renderToString(
      createElement(ValidationReportView, {
        onLoad: () => Promise.reject(new Error('不应被调用')),
      }),
    );
    expect(html).toContain('加载数据并生成报告');
    expect(html).not.toContain('未接入数据加载');
  });
});

describe('ValidationReportTable', () => {
  const stats = computeStats({
    usage: [
      { ...createEmptyUsage('BV1_p1', () => 0), seeks: 4, subtitleLoaded: true },
      { ...createEmptyUsage('BV2_p1', () => 0), seeks: 2, subtitleLoaded: false },
    ],
    qa: [],
  });
  const verdicts = judge(stats);

  it('渲染指标名与阈值说明', () => {
    const html = renderToString(createElement(ValidationReportTable, { verdicts }));
    expect(html).toContain('完成学习的视频数');
    expect(html).toContain('字幕一级通道命中率');
    expect(html).toContain('≥ 10 继续 / 5~9 调整 / &lt; 5 放弃');
  });

  it('判定徽标带配色 class（继续/放弃）', () => {
    const html = renderToString(createElement(ValidationReportTable, { verdicts }));
    expect(html).toContain('vr-continue');
    expect(html).toContain('vr-abandon');
    expect(html).toContain('继续');
    expect(html).toContain('放弃');
  });

  it('空判定列表不渲染表格', () => {
    expect(renderToString(createElement(ValidationReportTable, { verdicts: [] }))).toBe('');
  });
});

describe('ValidationStatsSummary', () => {
  it('渲染视频数与字幕命中率（百分比）', () => {
    const stats = computeStats({
      usage: [
        { ...createEmptyUsage('BV1_p1', () => 0), subtitleLoaded: true },
        { ...createEmptyUsage('BV2_p1', () => 0), subtitleLoaded: false },
        { ...createEmptyUsage('BV3_p1', () => 0), subtitleLoaded: true },
        { ...createEmptyUsage('BV4_p1', () => 0), subtitleLoaded: true },
      ],
      qa: [],
    });
    const html = renderToString(createElement(ValidationStatsSummary, { stats }));
    expect(html).toContain('4');
    expect(html).toContain('75%');
  });
});

describe('导出纯函数', () => {
  it('formatVerdictLabel', () => {
    expect(formatVerdictLabel('continue')).toBe('继续');
    expect(formatVerdictLabel('adjust')).toBe('调整');
    expect(formatVerdictLabel('abandon')).toBe('放弃');
  });

  it('formatPercent', () => {
    expect(formatPercent(0.8)).toBe('80%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.333)).toBe('33.3%');
  });
});
