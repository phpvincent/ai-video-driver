/**
 * 单章重生成管道单测（SPEC-03 3c 范围变更 2.3）。
 * 覆盖：正常路径（保留 id/endMs、吸附、占位 score/density）、cues 范围过滤、
 * feedback 透传与 userPrompt 呈现、防幻觉约束文案、重试与解析失败、吸附回退、
 * rescoreOutline 全片重算。
 */
import { describe, expect, it } from 'vitest';
import { regenerateSection, rescoreOutline } from '../../../src/core/pipeline/regenerate';
import { buildOutlineRegeneratePrompts } from '../../../src/core/pipeline/prompts';
import type { Section } from '../../../src/types';
import type { Cue } from '../../../src/types';
import type { OutlineModelFn, SectionCandidate } from '../../../src/core/pipeline/types';

/** 20s 间隔的 Cue：0s..80s（endMs +5s） */
const mkCues = (): Cue[] =>
  Array.from({ length: 5 }, (_, i) => ({
    index: i,
    startMs: i * 20_000,
    endMs: i * 20_000 + 5_000,
    text: `line-${i}`,
  }));

/** 被重生成的章节：覆盖 20s-60s（cue1..cue2） */
const mkSection = (extra: Partial<Section> = {}): Section => ({
  id: 'sec_0002',
  title: '旧的章节标题',
  startMs: 20_000,
  endMs: 60_000,
  summary: '旧摘要',
  bullets: [
    { text: '旧要点一', startMs: 20_000 },
    { text: '旧要点二', startMs: 40_000 },
  ],
  terms: ['旧术语'],
  importance: 2,
  score: 40,
  density: 'mid',
  cueRange: [1, 2],
  ...extra,
});

const CAND = (over: Partial<SectionCandidate> = {}): SectionCandidate => ({
  title: '新的章节标题内容',
  startSec: 23,
  summary: '新摘要内容',
  bullets: [
    { text: '新要点一', startSec: 21 },
    { text: '新要点二', startSec: 42 },
  ],
  terms: ['新术语'],
  importance: 4,
  ...over,
});

const json = (sections: SectionCandidate[]): string => JSON.stringify({ sections });

const okModel: OutlineModelFn = async () => ({ content: json([CAND()]) });

/** 捕获 buildRegenPrompts 收到的参数与生成的 prompts */
function captureBuilder() {
  const captured: Array<{
    section: Section;
    chunkCues: Cue[];
    feedback?: string;
  }> = [];
  const build = (args: {
    section: Section;
    chunkCues: Cue[];
    feedback?: string;
  }): { systemPrompt: string; userPrompt: string } => {
    captured.push(args);
    return {
      systemPrompt: `system:${args.section.id}`,
      userPrompt: `user:${args.feedback ?? '无反馈'}`,
    };
  };
  return { captured, build };
}

describe('regenerateSection', () => {
  it('正常：保留 id/endMs/cueRange，采用模型新字段，吸附到 Cue 边界', async () => {
    const { captured, build } = captureBuilder();
    const out = await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      modelFn: okModel,
      buildRegenPrompts: build,
    });
    expect(captured).toHaveLength(1);
    expect(out.id).toBe('sec_0002'); // 保留
    expect(out.endMs).toBe(60_000); // 保留
    expect(out.cueRange).toEqual([1, 2]); // 保留
    expect(out.title).toBe('新的章节标题内容');
    expect(out.summary).toBe('新摘要内容');
    expect(out.importance).toBe(4);
    expect(out.terms).toEqual(['新术语']);
    // 章节 23s → cue1(20s)；bullets 21s → 20s、42s → 40s（均精确吸附）
    expect(out.startMs).toBe(20_000);
    expect(out.bullets).toEqual([
      { text: '新要点一', startMs: 20_000 },
      { text: '新要点二', startMs: 40_000 },
    ]);
    // density/score 占位，由调用方 rescore
    expect(out.density).toBe('mid');
    expect(out.score).toBe(0);
  });

  it('cues 范围过滤：仅取 startMs ∈ [section.startMs, endMs) 的 Cue', async () => {
    const { captured, build } = captureBuilder();
    await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      modelFn: okModel,
      buildRegenPrompts: build,
    });
    expect(captured[0].chunkCues.map((c) => c.startMs)).toEqual([20_000, 40_000]);
    expect(captured[0].section.id).toBe('sec_0002');
  });

  it('feedback 透传到 buildRegenPrompts 并出现在 userPrompt 中', async () => {
    const { captured, build } = captureBuilder();
    const modelFn: OutlineModelFn = async (req) => {
      // userPrompt 由 buildRegenPrompts 生成（stub 将 feedback 嵌入其中）
      expect(req.userPrompt).toContain('更细一点的要点');
      return { content: json([CAND()]) };
    };
    await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      feedback: '更细一点的要点',
      modelFn,
      buildRegenPrompts: build,
    });
    expect(captured[0].feedback).toBe('更细一点的要点');
  });

  it('基线 builder：feedback 出现在 userPrompt，防幻觉文案在 systemPrompt 中', async () => {
    let seenUser = '';
    let seenSystem = '';
    const modelFn: OutlineModelFn = async (req) => {
      seenUser = req.userPrompt;
      seenSystem = req.systemPrompt;
      return { content: json([CAND()]) };
    };
    await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      feedback: '标题更准确一些',
      modelFn,
      buildRegenPrompts: buildOutlineRegeneratePrompts,
    });
    expect(seenUser).toContain('标题更准确一些');
    expect(seenUser).toContain('<<<SUBTITLE_BEGIN>>>');
    expect(seenSystem).toContain('不得采用'); // 防幻觉约束
    expect(seenSystem).toContain('用户反馈仅提供方向性引导');
  });

  it('无 feedback 时不出现反馈行（基线 builder）', async () => {
    let seenUser = '';
    const modelFn: OutlineModelFn = async (req) => {
      seenUser = req.userPrompt;
      return { content: json([CAND()]) };
    };
    await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      modelFn,
      buildRegenPrompts: buildOutlineRegeneratePrompts,
    });
    expect(seenUser).not.toContain('用户反馈');
  });

  it('首次输出非法 → 附错误重试 1 次后成功', async () => {
    let calls = 0;
    const modelFn: OutlineModelFn = async (req) => {
      calls += 1;
      if (calls === 1) {
        expect(req.userPrompt).not.toContain('[重试]');
        return { content: '不是 JSON' };
      }
      expect(req.userPrompt).toContain('[重试]');
      return { content: json([CAND()]) };
    };
    const out = await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      modelFn,
      buildRegenPrompts: buildOutlineRegeneratePrompts,
    });
    expect(calls).toBe(2);
    expect(out.title).toBe('新的章节标题内容');
  });

  it('两次解析失败 → throw（携带最后一次错误）', async () => {
    let calls = 0;
    const modelFn: OutlineModelFn = async () => {
      calls += 1;
      return { content: '依然不是 JSON' };
    };
    await expect(
      regenerateSection({
        section: mkSection(),
        cues: mkCues(),
        modelFn,
        buildRegenPrompts: buildOutlineRegeneratePrompts,
      }),
    ).rejects.toThrow(/单章重生成失败.*依然不是 JSON/);
    expect(calls).toBe(2); // 默认 maxRetries=1
  });

  it('Schema 不合法（bullets 旧格式）→ 重试后仍失败 → throw', async () => {
    const modelFn: OutlineModelFn = async () => ({
      content: JSON.stringify({
        sections: [{ ...CAND(), bullets: ['纯字符串要点'] }],
      }),
    });
    await expect(
      regenerateSection({
        section: mkSection(),
        cues: mkCues(),
        modelFn,
        buildRegenPrompts: buildOutlineRegeneratePrompts,
      }),
    ).rejects.toThrow(/Schema/);
  });

  it('吸附回退：候选 startSec 距任何 Cue >5s → 用原 section.startMs；bullet 同规则回落并标 approximate', async () => {
    // 50s 距 cue2(40s)/cue3(60s) 均 10s > 5s → 章节回落原 startMs(20s)
    const modelFn: OutlineModelFn = async () => ({
      content: json([
        CAND({
          startSec: 50,
          bullets: [
            { text: '精确要点', startSec: 41 }, // → cue2(40s)
            { text: '回落要点', startSec: 50 }, // >5s → 回落章节起点 20s
          ],
        }),
      ]),
    });
    const out = await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      modelFn,
      buildRegenPrompts: buildOutlineRegeneratePrompts,
    });
    expect(out.startMs).toBe(20_000); // 原章节起点
    expect(out.bullets).toEqual([
      { text: '精确要点', startMs: 40_000 },
      { text: '回落要点', startMs: 20_000, approximate: true },
    ]);
  });

  it('自定义 parseModelJson：直接取单对象（不经 sections 包装）', async () => {
    const modelFn: OutlineModelFn = async () => ({ content: JSON.stringify(CAND()) });
    const out = await regenerateSection({
      section: mkSection(),
      cues: mkCues(),
      modelFn,
      buildRegenPrompts: buildOutlineRegeneratePrompts,
      parseModelJson: (content) => {
        const parsed = JSON.parse(content) as SectionCandidate;
        return parsed;
      },
    });
    expect(out.title).toBe('新的章节标题内容');
  });
});

describe('rescoreOutline（全片重算）', () => {
  const sec = (id: string, terms: string[], importance: number): Section => ({
    id,
    title: `章节标题${id}`,
    startMs: 0,
    endMs: 60_000,
    summary: '摘要',
    bullets: [{ text: '要点', startMs: 0 }],
    terms,
    importance,
    density: 'mid',
    score: 0,
    cueRange: [0, 1],
  });

  it('对替换后的全片列表重算 score 与 density', () => {
    // ch0：5 个全为新术语、importance 5 → 88（high）；ch1：术语全重复、importance 1 → 13（low）
    const out = rescoreOutline([sec('a', ['a', 'b', 'c', 'd', 'e'], 5), sec('b', ['a', 'b', 'c', 'd', 'e'], 1)]);
    expect(out.map((s) => s.score)).toEqual([88, 13]);
    expect(out.map((s) => s.density)).toEqual(['high', 'low']);
    // 原字段保留
    expect(out[0].id).toBe('a');
    expect(out[0].importance).toBe(5);
  });

  it('单章退化 → score 50 / mid', () => {
    const out = rescoreOutline([sec('only', ['x'], 5)]);
    expect(out[0].score).toBe(50);
    expect(out[0].density).toBe('mid');
  });
});
