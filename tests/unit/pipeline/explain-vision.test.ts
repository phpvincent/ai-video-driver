/**
 * 视觉问答（关键帧 + 字幕一起喂模型）单测：
 * describeImages 文案、explainTerm / answerSegment 的 images 透传与 prompt 说明行。
 * 模型调用全部走注入 stub，不发网络请求。
 */
import { describe, expect, it } from 'vitest';
import {
  answerSegment,
  describeImages,
  explainTerm,
  type ExplainImage,
  type ExplainInput,
  type ExplainModelFn,
  type ExplainModelImage,
} from '../../../src/core/pipeline/explain';
import type { Cue, Section } from '../../../src/types';

const section: Section = {
  id: 'sec_0001',
  title: '章节一',
  startMs: 0,
  endMs: 120_000,
  summary: '摘要',
  bullets: [{ text: '要点', startMs: 0 }],
  terms: [],
  importance: 3,
  density: 'mid',
  cueRange: [0, 5],
};

const cues: Cue[] = [
  { index: 0, startMs: 0, endMs: 5_000, text: '开场' },
  { index: 1, startMs: 750_000, endMs: 756_000, text: '第十二分半附近的讲解' },
];

const baseInput: ExplainInput = {
  sections: [section],
  cues,
  rangeMs: [740_000, 760_000],
  positionMs: 750_000,
};

/** 记录每次调用入参的模型 stub */
function recordingModel(content: string): {
  modelFn: ExplainModelFn;
  calls: Array<{ userPrompt: string; images?: ExplainModelImage[] }>;
} {
  const calls: Array<{ userPrompt: string; images?: ExplainModelImage[] }> = [];
  const modelFn: ExplainModelFn = async (req) => {
    calls.push({ userPrompt: req.userPrompt, images: req.images });
    return { content };
  };
  return { modelFn, calls };
}

const TERM_JSON = JSON.stringify({
  term: '注意力机制',
  inVideoMeaning: '本视频中的含义',
  generalDefinition: '通用定义',
  analogy: '像聚光灯',
  relatedTerms: [],
  needsWeb: false,
});

const SEGMENT_JSON = JSON.stringify({
  answer: '这段讲了注意力机制。',
  keyPoints: ['要点一'],
  referencedTimestamps: [750],
  followUpQuestions: ['什么是多头注意力'],
  coveredByVideo: true,
});

const images: ExplainImage[] = [
  { dataBase64: 'QUFB', timeMs: 750_000 },
  { dataBase64: 'QkJC', caption: '第 13:00 的画面' },
];

describe('describeImages（提示词里的一行画面说明）', () => {
  it('空 / undefined → ""', () => {
    expect(describeImages()).toBe('');
    expect(describeImages([])).toBe('');
    expect(describeImages(null)).toBe('');
  });

  it('含帧数与时间点（无 caption 时用 timeMs 格式化）', () => {
    const line = describeImages([{ dataBase64: 'QUFB', timeMs: 750_000 }]);
    expect(line).toContain('以下附 1 张教学画面');
    expect(line).toContain('第 12:30 的画面');
  });

  it('caption 优先于 timeMs', () => {
    const line = describeImages([
      { dataBase64: 'QUFB', timeMs: 750_000, caption: '板书特写' },
    ]);
    expect(line).toContain('板书特写');
    expect(line).not.toContain('第 12:30');
  });

  it('多帧按顺序拼接，只占一行', () => {
    const line = describeImages(images);
    expect(line).toContain('以下附 2 张教学画面');
    expect(line.indexOf('第 12:30 的画面')).toBeLessThan(line.indexOf('第 13:00 的画面'));
    expect(line.split('\n')).toHaveLength(1);
  });

  it('传 cues 时时间点吸附到字幕起点（750_500 → 12:30）', () => {
    const line = describeImages([{ dataBase64: 'QUFB', timeMs: 750_500 }], cues);
    expect(line).toContain('第 12:30 的画面');
  });

  it('既无 caption 也无 timeMs → 按序号标注', () => {
    expect(describeImages([{ dataBase64: 'QUFB' }])).toContain('第 1 张');
  });
});

describe('explainTerm / answerSegment 的 images 透传', () => {
  it('explainTerm：images 传给 modelFn，prompt 追加一行画面说明', async () => {
    const { modelFn, calls } = recordingModel(TERM_JSON);
    await explainTerm({ term: '注意力机制', input: { ...baseInput, images }, modelFn });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.images).toHaveLength(2);
    expect(calls[0]?.images?.[0]?.dataBase64).toBe('QUFB');
    expect(calls[0]?.userPrompt).toContain('以下附 2 张教学画面');
    expect(calls[0]?.userPrompt).toContain('第 12:30 的画面');
  });

  it('answerSegment：同样透传 images 与说明行', async () => {
    const { modelFn, calls } = recordingModel(SEGMENT_JSON);
    await answerSegment({ question: '这段讲了什么', input: { ...baseInput, images }, modelFn });
    expect(calls[0]?.images).toHaveLength(2);
    expect(calls[0]?.userPrompt).toContain('以下附 2 张教学画面');
  });

  it('无 images：req.images 为 undefined，prompt 不含画面说明（旧行为一致）', async () => {
    const { modelFn, calls } = recordingModel(TERM_JSON);
    await explainTerm({ term: '注意力机制', input: baseInput, modelFn });
    expect(calls[0]?.images).toBeUndefined();
    expect(calls[0]?.userPrompt).not.toContain('教学画面');
  });

  it('重试时 images 一并重传（两次调用都带图）', async () => {
    const calls: Array<{ userPrompt: string; images?: ExplainModelImage[] }> = [];
    let n = 0;
    const modelFn: ExplainModelFn = async (req) => {
      calls.push({ userPrompt: req.userPrompt, images: req.images });
      n += 1;
      return { content: n === 1 ? '不是 JSON' : TERM_JSON };
    };
    await explainTerm({ term: '注意力机制', input: { ...baseInput, images }, modelFn });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.images).toHaveLength(2);
    expect(calls[1]?.userPrompt).toContain('以下附 2 张教学画面');
  });

  it('旧签名 stub（不解构 images）仍可工作：不传图也能拿到结果', async () => {
    const legacyModelFn = (async (req: { systemPrompt: string; userPrompt: string }) => ({
      content: TERM_JSON,
    })) as unknown as ExplainModelFn;
    await expect(
      explainTerm({ term: '注意力机制', input: { ...baseInput, images }, modelFn: legacyModelFn }),
    ).resolves.toMatchObject({ term: '注意力机制' });
  });
});
