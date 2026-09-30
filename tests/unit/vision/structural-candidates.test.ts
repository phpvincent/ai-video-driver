import { describe, expect, it } from 'vitest';
import {
  buildStructuralCandidates,
  captionFrame,
  ensureChapterCoverage,
  formatCandidates,
  pickCandidatesByPriority,
} from '../../../src/core/vision/structuralCandidates';
import { buildFramePlanPrompts, FramePlanSchema, validateFramePlan } from '../../../src/core/vision/llmFramePlan';
import { dhashFromGray, grayFromRgba, hammingDistance } from '../../../src/core/vision/dhash';
import { dedupeFrames } from '../../../src/core/vision/framePlanner';
import { buildUserContent } from '../../../src/core/harness/modelClient';
import { framesForChunk } from '../../../src/panel/outlineLoader';
import type { Cue, Section } from '../../../src/types';

/** 10 分钟课：每 10 秒一句字幕 */
const cues: Cue[] = Array.from({ length: 60 }, (_, i) => ({
  index: i,
  startMs: i * 10_000,
  endMs: i * 10_000 + 9_000,
  text: `第${i}句`,
}));

function section(id: string, title: string, startMs: number, endMs: number, bullets: number[] = []): Section {
  return {
    id,
    title,
    startMs,
    endMs,
    summary: '',
    bullets: bullets.map((b, k) => ({ text: `${title}要点${k + 1}`, startMs: b })),
    terms: [],
    importance: 3,
    score: 50,
    density: 'medium',
  } as unknown as Section;
}

const sections: Section[] = [
  section('s1', '工具箱基础', 0, 200_000, [60_000, 120_000]),
  section('s2', '事件机制', 200_000, 400_000, [260_000, 330_000]),
  section('s3', '代码实践', 400_000, 600_000, [470_000]),
];

describe('buildStructuralCandidates：章节开头 / 知识点 / 章节结尾', () => {
  const cands = buildStructuralCandidates(sections, cues, { minGapMs: 15_000 });

  it('每章都有开头与结尾候选，知识点落在 bullet 时刻', () => {
    for (let si = 0; si < sections.length; si++) {
      expect(cands.some((c) => c.sectionIndex === si && c.kind === 'chapter-start')).toBe(true);
      expect(cands.some((c) => c.sectionIndex === si && c.kind === 'chapter-end')).toBe(true);
    }
    expect(cands.filter((c) => c.kind === 'point').map((c) => c.tMs)).toEqual([60_000, 120_000, 260_000, 330_000, 470_000]);
  });

  it('开头避开转场（向内偏移）、结尾在章节内；时刻恒为真实字幕起点', () => {
    const s2start = cands.find((c) => c.sectionIndex === 1 && c.kind === 'chapter-start')!;
    expect(s2start.tMs).toBeGreaterThan(200_000);
    const s1end = cands.find((c) => c.sectionIndex === 0 && c.kind === 'chapter-end')!;
    expect(s1end.tMs).toBeLessThan(200_000);
    const starts = new Set(cues.map((c) => c.startMs));
    expect(cands.every((c) => starts.has(c.tMs))).toBe(true);
  });

  it('每个候选附带那一刻的字幕，编号连续且按时间升序', () => {
    expect(cands.every((c) => c.text.length > 0)).toBe(true);
    expect(cands.map((c) => c.id)).toEqual(cands.map((_, i) => `C${i + 1}`));
    expect([...cands].sort((a, b) => a.tMs - b.tMs)).toEqual(cands);
  });

  it('无章节 → 按时段切分', () => {
    const w = buildStructuralCandidates([], cues, { minGapMs: 15_000, windowMs: 60_000 });
    expect(w.length).toBe(10);
    expect(w.every((c) => c.kind === 'window')).toBe(true);
  });

  it('超过上限：章节开头全部保留', () => {
    const limited = buildStructuralCandidates(sections, cues, { minGapMs: 15_000, maxCandidates: 5 });
    expect(limited.length).toBeLessThanOrEqual(5);
    expect(limited.filter((c) => c.kind === 'chapter-start')).toHaveLength(3);
  });

  it('formatCandidates 输出编号、时间、位置与字幕', () => {
    const text = formatCandidates(cands, sections);
    expect(text).toContain('C1 [');
    expect(text).toContain('「工具箱基础」');
    expect(text).toContain('知识点「事件机制要点1」');
    expect(text).toContain('章节结尾');
  });
});

describe('兜底选帧与章节覆盖护栏', () => {
  const cands = buildStructuralCandidates(sections, cues, { minGapMs: 15_000 });

  it('pickCandidatesByPriority：先首尾再知识点，预算为 6 时每章首尾各一帧', () => {
    const picked = pickCandidatesByPriority(cands, 6);
    expect(picked).toHaveLength(6);
    for (const s of sections) {
      expect(picked.filter((t) => t >= s.startMs && t < s.endMs)).toHaveLength(2);
    }
  });

  it('ensureChapterCoverage：模型漏掉整章时补该章开头', () => {
    const onlyFirst = [60_000, 120_000];
    const out = ensureChapterCoverage(onlyFirst, sections, cands, { max: 10, minGapMs: 15_000 });
    expect(out.some((t) => t >= 200_000 && t < 400_000)).toBe(true);
    expect(out.some((t) => t >= 400_000)).toBe(true);
  });

  it('不超过上限', () => {
    const out = ensureChapterCoverage([60_000], sections, cands, { max: 2, minGapMs: 15_000 });
    expect(out).toHaveLength(2);
  });
});

describe('候选制规划：模型按编号挑选', () => {
  const cands = buildStructuralCandidates(sections, cues, { minGapMs: 15_000 });
  const req = { sections, cues, durationMs: 600_000, budget: 16, minGapMs: 15_000, candidates: cands };

  it('id 命中候选 → 直接使用候选时刻；大小写不敏感；tSec 仍兼容', () => {
    const c3 = cands[2]!;
    const c5 = cands[4]!;
    const out = validateFramePlan(
      JSON.stringify({ targets: [{ id: c3.id }, { id: c5.id.toLowerCase() }, { tSec: 551 }] }),
      req,
    );
    expect(out.targets).toEqual([c3.tMs, c5.tMs, 550_000].sort((a, b) => a - b));
  });

  it('未知 id 被丢弃，不影响其他帧', () => {
    const out = validateFramePlan(JSON.stringify({ targets: [{ id: 'C999' }, { id: cands[0]!.id }] }), req);
    expect(out.targets).toEqual([cands[0]!.tMs]);
  });

  it('回归：Schema 允许超过 12 帧（旧上限 12 < 预算 16 时整份规划被拒）', () => {
    const many = { targets: cands.slice(0, 16).map((c) => ({ id: c.id })) };
    expect(FramePlanSchema.safeParse(many).success).toBe(true);
    expect(validateFramePlan(JSON.stringify(many), req).targets.length).toBe(Math.min(16, cands.length));
  });

  it('prompt 含候选区块，且不再给零散字幕摘录', () => {
    const { userPrompt, systemPrompt } = buildFramePlanPrompts(req);
    expect(userPrompt).toContain('【候选时刻】');
    expect(userPrompt).not.toContain('【字幕摘录');
    expect(systemPrompt).toContain('按编号');
  });
});

describe('帧-字幕配对', () => {
  it('captionFrame：画面序号 + 时间 + 章节 + 位置 + 此刻字幕', () => {
    const cap = captionFrame(260_000, 2, 12, sections, cues);
    expect(cap).toContain('画面 3/12');
    expect(cap).toContain('04:20');
    expect(cap).toContain('第 2 章「事件机制」');
    expect(cap).toContain('知识点');
    expect(cap).toContain('此刻字幕：第26句');
  });

  it('章节开头 / 结尾识别', () => {
    expect(captionFrame(210_000, 0, 1, sections, cues)).toContain('章节开头');
    expect(captionFrame(390_000, 0, 1, sections, cues)).toContain('章节结尾');
  });

  it('buildUserContent：说明紧贴在对应图片之前（交错排布）', () => {
    const parts = buildUserContent('主提示', [
      { dataBase64: 'AAA', caption: '说明1' },
      { dataBase64: 'BBB', caption: '说明2' },
    ]);
    expect(Array.isArray(parts)).toBe(true);
    const seq = (parts as Array<{ type: string; text?: string }>).map((p) => (p.type === 'text' ? p.text : 'IMG'));
    expect(seq).toEqual(['主提示', '说明1', 'IMG', '说明2', 'IMG']);
  });

  it('无 caption 时退化为旧格式（文本 + 图）', () => {
    const parts = buildUserContent('主提示', [{ dataBase64: 'AAA' }]) as Array<{ type: string }>;
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
  });

  it('大纲：帧按时间归属到分块（不再按下标错配）', () => {
    const frames = [
      { dataBase64: 'a', mime: 'image/jpeg', timeMs: 20_000 },
      { dataBase64: 'b', mime: 'image/jpeg', timeMs: 30_000 },
      { dataBase64: 'c', mime: 'image/jpeg', timeMs: 450_000 },
    ];
    const chunk0 = cues.slice(0, 20); // 0~199s
    const chunk1 = cues.slice(20, 40); // 200~399s
    const chunk2 = cues.slice(40); // 400s~
    expect(framesForChunk(frames, chunk0, 0, cues).map((f) => f.dataBase64)).toEqual(['a', 'b']);
    expect(framesForChunk(frames, chunk1, 1, cues)).toEqual([]);
    const c2 = framesForChunk(frames, chunk2, 2, cues);
    expect(c2.map((f) => f.dataBase64)).toEqual(['c']);
    expect(c2[0]!.caption).toContain('此刻字幕');
  });
});

describe('dHash 感知去重', () => {
  const gradient = Array.from({ length: 72 }, (_, i) => (i % 9) * 20); // 每行左暗右亮
  const reversed = Array.from({ length: 72 }, (_, i) => (8 - (i % 9)) * 20);

  it('dhashFromGray：64 bit → 16 位十六进制；非法输入 → 空串', () => {
    expect(dhashFromGray(gradient)).toBe('0000000000000000');
    expect(dhashFromGray(reversed)).toBe('ffffffffffffffff');
    expect(dhashFromGray([1, 2, 3])).toBe('');
  });

  it('轻微噪声（JPEG 压缩级别）不改变哈希；汉明距离计算正确', () => {
    const noisy = gradient.map((v, i) => v + (i % 3 === 0 ? 2 : -2));
    expect(hammingDistance(dhashFromGray(gradient), dhashFromGray(noisy))).toBeLessThanOrEqual(5);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('', 'ff')).toBe(Number.POSITIVE_INFINITY);
  });

  it('grayFromRgba：BT.601 亮度', () => {
    expect(grayFromRgba([255, 255, 255, 255, 0, 0, 0, 255]).map(Math.round)).toEqual([255, 0]);
  });

  it('dedupeFrames：相同画面即使相隔很久也去重；不同画面即使紧挨着也保留', () => {
    const a = { targetMs: 0, actualMs: 10_000, dataBase64: 'x'.repeat(100), dhash: '0000000000000000' };
    const sameLater = { targetMs: 0, actualMs: 300_000, dataBase64: 'y'.repeat(180), dhash: '0000000000000003' };
    const differentNear = { targetMs: 0, actualMs: 12_000, dataBase64: 'z'.repeat(100), dhash: 'ffffffffffffffff' };
    const out = dedupeFrames([a, sameLater, differentNear], { minGapMs: 15_000, dhashMaxDistance: 5 });
    expect(out.map((f) => f.actualMs)).toEqual([10_000, 12_000]);
  });
});
