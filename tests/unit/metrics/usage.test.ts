/**
 * SPEC-07 使用统计埋点单测（红线 1：确定性、不可变）。
 * 时钟一律注入固定值，断言 ISO 字符串可精确比对。
 */
import { describe, expect, it } from 'vitest';
import { applySubjective, applyUsageEvent, createEmptyUsage, type UsageRecord } from '../../../src/core/metrics/usage';

const T0 = 1_700_000_000_000;
const T1 = 1_700_003_600_000;

describe('createEmptyUsage', () => {
  it('初始化：计数归零、三个布尔位为 false', () => {
    const rec = createEmptyUsage('BV1_p1', () => T0);
    expect(rec).toEqual({
      videoId: 'BV1_p1',
      seeks: 0,
      saves: 0,
      subjective: undefined,
      subtitleLoaded: false,
      outlineGenerated: false,
      conceptMapGenerated: false,
      firstUsedAt: new Date(T0).toISOString(),
      lastUsedAt: new Date(T0).toISOString(),
    });
  });
});

describe('applyUsageEvent', () => {
  it('seek：跳转次数 +1', () => {
    const rec = applyUsageEvent(createEmptyUsage('v', () => T0), { kind: 'seek' }, () => T1);
    expect(rec.seeks).toBe(1);
    expect(rec.subtitleLoaded).toBe(false);
  });

  it('subtitle：字幕加载位置为 true', () => {
    const rec = applyUsageEvent(createEmptyUsage('v', () => T0), { kind: 'subtitle' }, () => T1);
    expect(rec.subtitleLoaded).toBe(true);
    expect(rec.seeks).toBe(0);
  });

  it('outline：大纲生成位置为 true（不影响字幕位）', () => {
    const rec = applyUsageEvent(createEmptyUsage('v', () => T0), { kind: 'outline' }, () => T1);
    expect(rec.outlineGenerated).toBe(true);
    expect(rec.conceptMapGenerated).toBe(false);
    expect(rec.subtitleLoaded).toBe(false);
  });

  it('conceptMap：概念图生成位置为 true', () => {
    const rec = applyUsageEvent(createEmptyUsage('v', () => T0), { kind: 'conceptMap' }, () => T1);
    expect(rec.conceptMapGenerated).toBe(true);
    expect(rec.outlineGenerated).toBe(false);
  });

  it('不可变：原对象不被修改', () => {
    const origin = createEmptyUsage('v', () => T0);
    const snapshot = { ...origin };
    const next = applyUsageEvent(origin, { kind: 'seek' }, () => T1);
    expect(origin).toEqual(snapshot);
    expect(next).not.toBe(origin);
  });

  it('时间：lastUsedAt 更新，firstUsedAt 保持', () => {
    const rec = applyUsageEvent(createEmptyUsage('v', () => T0), { kind: 'seek' }, () => T1);
    expect(rec.firstUsedAt).toBe(new Date(T0).toISOString());
    expect(rec.lastUsedAt).toBe(new Date(T1).toISOString());
  });

  it('多次累积：三次 seek 得 3，且与 outline 事件互不影响', () => {
    let rec = createEmptyUsage('v', () => T0);
    rec = applyUsageEvent(rec, { kind: 'seek' }, () => T1);
    rec = applyUsageEvent(rec, { kind: 'seek' }, () => T1 + 1);
    rec = applyUsageEvent(rec, { kind: 'outline' }, () => T1 + 2);
    rec = applyUsageEvent(rec, { kind: 'seek' }, () => T1 + 3);
    expect(rec.seeks).toBe(3);
    expect(rec.outlineGenerated).toBe(true);
    expect(rec.lastUsedAt).toBe(new Date(T1 + 3).toISOString());
  });

  it('确定性：同一输入两次调用结果相等', () => {
    const base = createEmptyUsage('v', () => T0);
    const a = applyUsageEvent(base, { kind: 'subtitle' }, () => T1);
    const b = applyUsageEvent(base, { kind: 'subtitle' }, () => T1);
    expect(a).toEqual(b);
  });
  it('vision 事件：累计帧数、模型规划次数与覆盖率', () => {
    let rec = createEmptyUsage('BV1', () => 0);
    rec = applyUsageEvent(rec, { kind: 'vision', vision: { frames: 4, byModel: true, coverage: 0.8 } }, () => 0);
    rec = applyUsageEvent(rec, { kind: 'vision', vision: { frames: 3, byModel: false } }, () => 0);
    expect(rec.vision?.frames).toBe(7);
    expect(rec.vision?.modelPlans).toBe(1);
    expect(rec.vision?.coverageSum).toBeCloseTo(0.8, 5);
    expect(rec.vision?.coverageCount).toBe(1);
  });
});


describe('SPEC-08 8.8：save 事件与回顾问卷入库', () => {
  it("applyUsageEvent('save') 累计存库次数；旧记录无 saves 字段可叠加", () => {
    const rec = applyUsageEvent(createEmptyUsage("V", () => T0), { kind: 'save' }, () => T0);
    expect(rec.saves).toBe(1);
    const legacy = { ...createEmptyUsage("V", () => T0) } as UsageRecord;
    delete (legacy as { saves?: number }).saves;
    expect(applyUsageEvent(legacy, { kind: 'save' }, () => T0).saves).toBe(1);
    expect(applyUsageEvent(rec, { kind: 'save' }, () => T0).saves).toBe(2);
  });

  it('applySubjective 写入答案且不改原对象；重复作答以最后一次为准', () => {
    const base = createEmptyUsage("V", () => T0);
    const a = applySubjective(base, 'fewer', () => T0);
    expect(a.subjective).toBe('fewer');
    expect(base.subjective).toBeUndefined();
    expect(applySubjective(a, 'more', () => T0).subjective).toBe('more');
  });
});
