/**
 * 费用估算单测（SPEC-10 10.8 / 验收 B5）。
 */
import { describe, expect, it } from 'vitest';
import {
  estimateCostCny,
  formatCny,
  priceOf,
  summarizeCost,
} from '../../../src/core/metrics/cost';

describe('priceOf（价格表前缀匹配）', () => {
  it('预设模型命中（前缀，忽略大小写）', () => {
    expect(priceOf('deepseek-chat')).toEqual({ inputPerM: 2, outputPerM: 8 });
    expect(priceOf('DeepSeek-Chat')).toEqual({ inputPerM: 2, outputPerM: 8 });
    expect(priceOf('qwen-vl-plus')).toEqual({ inputPerM: 0.8, outputPerM: 2 });
    expect(priceOf('qwen-vl-plus-latest')).toEqual({ inputPerM: 0.8, outputPerM: 2 });
  });

  it('自定义/未知模型返回 null；空字符串 null', () => {
    expect(priceOf('my-own-model')).toBeNull();
    expect(priceOf('')).toBeNull();
  });
});

describe('estimateCostCny（token × 单价）', () => {
  it('1M 输入 + 1M 输出 = 两个单价之和', () => {
    expect(estimateCostCny('deepseek-chat', 1_000_000, 1_000_000)).toBeCloseTo(10, 6);
    expect(estimateCostCny('qwen-plus', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
  });

  it('按 token 比例线性；无价格 null', () => {
    expect(estimateCostCny('deepseek-chat', 500_000, 0)).toBeCloseTo(1, 6);
    expect(estimateCostCny('unknown-model', 500_000, 0)).toBeNull();
  });
});

describe('summarizeCost（按模型聚合，B5）', () => {
  it('同模型 token 累加；合计 = 各模型之和', () => {
    const s = summarizeCost([
      { model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 },
      { model: 'deepseek-chat', inputTokens: 0, outputTokens: 1_000_000 },
      { model: 'qwen-plus', inputTokens: 1_000_000, outputTokens: 1_000_000 },
    ]);
    expect(s.rows).toHaveLength(2);
    const ds = s.rows.find((r) => r.model === 'deepseek-chat')!;
    expect(ds.input).toBe(1_000_000);
    expect(ds.output).toBe(1_000_000);
    expect(ds.costCny).toBeCloseTo(10, 6);
    expect(s.totalCny).toBeCloseTo(12.8, 6);
    expect(s.unknownTokens).toBe(0);
  });

  it('含无价格模型：totalCny=null + unknownTokens 计入', () => {
    const s = summarizeCost([
      { model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 },
      { model: 'my-model', inputTokens: 200_000, outputTokens: 100_000 },
    ]);
    expect(s.totalCny).toBeNull();
    expect(s.unknownTokens).toBe(300_000);
  });

  it('空日志：无行、合计 0', () => {
    const s = summarizeCost([]);
    expect(s.rows).toEqual([]);
    expect(s.totalCny).toBe(0);
  });
});

describe('formatCny', () => {
  it('两位小数；小于一分显示 <0.01', () => {
    expect(formatCny(0.034)).toBe('0.03');
    expect(formatCny(1.5)).toBe('1.50');
    expect(formatCny(0.004)).toBe('<0.01');
  });
});
