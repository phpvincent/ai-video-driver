/**
 * 截断 JSON 修复单测。
 * 用例 1 直接取自线上真实失败报文（概念图输出缺最外层 `}`）——回归守卫。
 */
import { describe, expect, it } from 'vitest';
import {
  parseJsonLoose,
  repairTruncatedJson,
  withRepairHint,
} from '../../../src/core/pipeline/jsonRepair';

/** 线上真实失败报文：stages 完整，但根对象缺 `}`（用户在日志里看到的那条） */
const REAL_TRUNCATED = `{
  "stages": [
    {
      "label": "工具箱基础构建",
      "concepts": [
        {
          "label": "工具箱",
          "importance": 5,
          "anchorSections": [1, 2],
          "details": ["导入与初始化", "自定义与封装"]
        }
      ]
    },
    {
      "label": "核心机制详解",
      "concepts": [
        {
          "label": "函数描述",
          "importance": 4,
          "anchorSections": [2],
          "details": ["参数说明", "返回值格式"]
        }
      ]
    },
    {
      "label": "代码实践与应用",
      "concepts": [
        {
          "label": "工具调用",
          "importance": 4,
          "anchorSections": [3],
          "details": ["加法工具示例"]
        }
      ]
    }
  ]`;

describe('repairTruncatedJson', () => {
  it('线上真实用例：缺最外层 } → 补齐后可解析，内容不丢', () => {
    const fixed = repairTruncatedJson(REAL_TRUNCATED);
    expect(fixed).not.toBeNull();
    const parsed = JSON.parse(fixed as string) as { stages: unknown[] };
    expect(parsed.stages).toHaveLength(3);
  });

  it('完整 JSON 原样返回（不走修复路径）', () => {
    const ok = '{"a":1}';
    expect(repairTruncatedJson(ok)).toBe(ok);
    expect(parseJsonLoose(ok)?.repaired).toBe(false);
  });

  it('数组最后一个元素写了一半 → 回退丢弃该元素并补全', () => {
    const raw = '{"stages":[{"label":"A"},{"label":"B"},{"label":"C","concepts":[{"la';
    const fixed = repairTruncatedJson(raw);
    expect(fixed).not.toBeNull();
    const parsed = JSON.parse(fixed as string) as { stages: Array<{ label: string }> };
    // 写了一半的第三个元素被丢弃，保留前两个
    expect(parsed.stages.map((s) => s.label)).toEqual(['A', 'B']);
  });

  it('尾部悬挂逗号也能修复', () => {
    const fixed = repairTruncatedJson('{"stages":[{"label":"A"}],');
    expect(fixed).not.toBeNull();
    expect(Array.isArray((JSON.parse(fixed as string) as { stages: unknown[] }).stages)).toBe(true);
  });

  it('字符串未闭合且无处可回退 → 返回 null（不臆造内容）', () => {
    expect(repairTruncatedJson('{"a":"未闭合')).toBeNull();
    expect(repairTruncatedJson('')).toBeNull();
    expect(repairTruncatedJson(undefined as unknown as string)).toBeNull();
  });

  it('完全不是 JSON → null', () => {
    expect(repairTruncatedJson('我只是一个普通回答')).toBeNull();
  });
});

describe('parseJsonLoose', () => {
  it('repaired 标记：修复路径为 true，正常路径为 false', () => {
    expect(parseJsonLoose(REAL_TRUNCATED)?.repaired).toBe(true);
    expect(parseJsonLoose('{"a":1}')?.repaired).toBe(false);
  });

  it('无法修复时返回 null（由调用方决定报错文案）', () => {
    expect(parseJsonLoose('not json at all')).toBeNull();
    expect(parseJsonLoose('')).toBeNull();
  });

  it('修复后的值交给 Zod 仍能正常校验', () => {
    const loose = parseJsonLoose(REAL_TRUNCATED);
    expect(loose?.value).toBeTruthy();
    const stages = (loose?.value as { stages: unknown[] }).stages;
    expect(stages).toHaveLength(3);
  });
});

describe('withRepairHint', () => {
  it('仅在确实尝试过修复时追加说明', () => {
    expect(withRepairHint('模型输出未通过 Schema 校验：x', true)).toContain('已尝试修复被截断的输出');
    expect(withRepairHint('模型输出未通过 Schema 校验：x', false)).toBe('模型输出未通过 Schema 校验：x');
  });
});
