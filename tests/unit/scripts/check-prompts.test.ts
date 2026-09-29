// @ts-expect-error scripts/*.mjs 为无类型声明的 Node ESM 脚本，tsc 无对应 .d.mts
import { checkSkill, extractPromptRefs } from '../../../scripts/check-prompts.mjs';
import { describe, expect, it } from 'vitest';

describe('extractPromptRefs', () => {
  it('提取并去重 src/prompts/*.md 引用', () => {
    const md = '见 src/prompts/outline.md 与 src/prompts/outline.md、src/prompts/qa.md';
    expect(extractPromptRefs(md)).toEqual(['src/prompts/outline.md', 'src/prompts/qa.md']);
  });

  it('无引用时返回空数组', () => {
    expect(extractPromptRefs('没有任何引用')).toEqual([]);
  });
});

describe('checkSkill', () => {
  it('引用的 prompt 文件不存在 → 违规', () => {
    const v = checkSkill('.agents/skills/a/SKILL.md', '使用 src/prompts/outline.md', () => null);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain('不存在');
    expect(v[0].detail).toBe('src/prompts/outline.md');
  });

  it('「禁止」约束出现在引用的 prompt 中 → 通过', () => {
    const prompts = new Map([['src/prompts/outline.md', '## 规则\n禁止编造时间戳。\n']]);
    const load = (ref: string) => prompts.get(ref) ?? null;
    const v = checkSkill('.agents/skills/a/SKILL.md', '调用 src/prompts/outline.md，禁止编造时间戳。', load);
    expect(v).toHaveLength(0);
  });

  it('「禁止」约束未出现在 prompt 中 → 违规', () => {
    const prompts = new Map([['src/prompts/outline.md', '# Outline\n无相关规则']]);
    const load = (ref: string) => prompts.get(ref) ?? null;
    const v = checkSkill('.agents/skills/a/SKILL.md', '调用 src/prompts/outline.md，禁止编造时间戳。', load);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain('关键约束');
  });

  it('无 prompt 引用时跳过约束检查', () => {
    const v = checkSkill('.agents/skills/a/SKILL.md', '禁止一切编造行为。', () => null);
    expect(v).toHaveLength(0);
  });
});
