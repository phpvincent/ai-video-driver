/**
 * 大纲 pipeline 的图像输入单测（抽帧画面 + 字幕一起喂模型）：
 * describeChunkImages 文案（确定性、mm:ss、多帧分隔）与 runOutline 的
 * images 透传（逐块、无图回退旧行为、重试行保留图像）。
 * 模型调用全部走注入 stub，不发网络请求、不自行抓帧。
 */
import { describe, expect, it } from 'vitest';
import { describeChunkImages, runOutline } from '../../../src/core/pipeline/outline';
import type { OutlineModelFn, PipelineImage, SectionCandidate } from '../../../src/core/pipeline/types';
import type { Cue } from '../../../src/types';

const mkCue = (i: number, startMs: number): Cue => ({
  index: i,
  startMs,
  endMs: startMs + 5_000,
  text: `c${i}:`.padEnd(99, 'x'), // 权重 100
});

/** 20 条 Cue × 权重 100 → 两块（chunk0 = cues[0..17]，chunk1 = cues[16..19]） */
const twoChunkCues = (): Cue[] => Array.from({ length: 20 }, (_, i) => mkCue(i, i * 10_000));

const CAND = (title: string, startSec: number): SectionCandidate => ({
  title,
  startSec,
  summary: '本章摘要',
  bullets: [{ text: '要点', startSec }],
  terms: [],
  importance: 3,
});

const json = (sections: SectionCandidate[]): string => JSON.stringify({ sections });

const frame = (dataBase64: string, timeMs?: number): PipelineImage => ({ dataBase64, timeMs });

/** 记录每次调用的 userPrompt 与 images（按调用顺序） */
function recorder(
  reply: (n: number) => string,
): { modelFn: OutlineModelFn; calls: Array<{ userPrompt: string; images?: PipelineImage[] }> } {
  const calls: Array<{ userPrompt: string; images?: PipelineImage[] }> = [];
  let n = 0;
  const modelFn: OutlineModelFn = async (req) => {
    calls.push({ userPrompt: req.userPrompt, images: req.images });
    const content = reply(n);
    n += 1;
    return { content };
  };
  return { modelFn, calls };
}

describe('describeChunkImages（分块 prompt 的画面说明行）', () => {
  const chunk = [mkCue(0, 0), mkCue(1, 10_000)];

  it('空数组 / undefined / null → ""', () => {
    expect(describeChunkImages([], chunk)).toBe('');
    expect(describeChunkImages(undefined, chunk)).toBe('');
    expect(describeChunkImages(null, chunk)).toBe('');
  });

  it('单帧：含帧数与 mm:ss 时间点', () => {
    const line = describeChunkImages([frame('QUFB', 750_000)], chunk);
    expect(line).toContain('以下附带 1 张教学画面');
    expect(line).toContain('12:30');
    expect(line).toContain('画面中的文字、代码、界面');
  });

  it('多帧按序拼接时间点，只追加一行', () => {
    const line = describeChunkImages([frame('QUFB', 60_000), frame('QkJC', 750_000)], chunk);
    expect(line).toContain('以下附带 2 张教学画面');
    expect(line.indexOf('01:00')).toBeLessThan(line.indexOf('12:30'));
    expect(line.split('\n')).toHaveLength(1);
  });

  it('timeMs 落在分块内某条字幕区间 → 吸附到该字幕起点（10_500 → 00:10）', () => {
    const line = describeChunkImages([frame('QUFB', 10_500)], chunk);
    expect(line).toContain('00:10');
  });

  it('无 timeMs → 按序号标注（不引入随机）', () => {
    expect(describeChunkImages([frame('QUFB')], chunk)).toContain('第 1 张');
  });
});

describe('runOutline 的 imagesForChunk 透传', () => {
  it('提供 imagesForChunk：每块收到自己那一批帧（第 0 块 / 第 1 块分别断言）', async () => {
    const { modelFn, calls } = recorder(() =>
      json([CAND('课程介绍与环境搭建', 0), CAND('变量与类型系统', 150)]),
    );
    const framesByChunk = [
      [frame('Rk0w', 30_000)],
      [frame('Rk0x', 160_000), frame('Rk0y', 170_000)],
    ];
    await runOutline(twoChunkCues(), modelFn, {
      minSectionDurationMs: 0,
      imagesForChunk: (_chunk, i) => framesByChunk[i] ?? [],
    });
    expect(calls).toHaveLength(2);
    const call0 = calls.find((c) => c.images?.some((im) => im.dataBase64 === 'Rk0w'));
    expect(call0?.images).toEqual([{ dataBase64: 'Rk0w', timeMs: 30_000 }]);
    const call1 = calls.find((c) => c.images?.some((im) => im.dataBase64 === 'Rk0x'));
    expect(call1?.images).toHaveLength(2);
    expect(call1?.images?.[1]?.dataBase64).toBe('Rk0y');
    // 每块各自只拿到自己的帧
    expect(calls.every((c) => c.images && c.images.length > 0)).toBe(true);
  });

  it('userPrompt 追加画面说明行（含帧数与本段时间点）', async () => {
    const { modelFn, calls } = recorder(() => json([CAND('课程介绍与环境搭建', 0)]));
    await runOutline(twoChunkCues(), modelFn, {
      minSectionDurationMs: 0,
      imagesForChunk: () => [frame('QUFB', 30_000), frame('QkJC', 45_000)],
    });
    expect(calls[0]?.userPrompt).toContain('以下附带 2 张教学画面');
    expect(calls[0]?.userPrompt).toContain('00:30、00:45');
  });

  it('未提供 imagesForChunk：req.images 为 undefined 且 prompt 无画面说明（旧行为不回归）', async () => {
    const { modelFn, calls } = recorder(() => json([CAND('课程介绍与环境搭建', 0)]));
    const res = await runOutline(twoChunkCues(), modelFn, { minSectionDurationMs: 0 });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.images).toBeUndefined();
    expect(calls[1]?.images).toBeUndefined();
    expect(calls[0]?.userPrompt).not.toContain('教学画面');
    expect(res.failedChunks).toBe(0);
    expect(res.sections.length).toBeGreaterThan(0);
  });

  it('重试时仍带图：两次调用的 images 与说明行都在', async () => {
    const { modelFn, calls } = recorder((n) =>
      n === 0 ? 'not-json{' : json([CAND('课程介绍与环境搭建', 0)]),
    );
    await runOutline(twoChunkCues(), modelFn, {
      minSectionDurationMs: 0,
      maxRetries: 1,
      concurrency: 1,
      imagesForChunk: () => [frame('QUFB', 30_000)],
    });
    const retryCall = calls.find((c) => c.userPrompt.includes('[重试]'));
    expect(retryCall).toBeDefined();
    expect(retryCall?.images).toHaveLength(1);
    expect(retryCall?.images?.[0]?.dataBase64).toBe('QUFB');
    expect(retryCall?.userPrompt).toContain('以下附带 1 张教学画面');
  });

  it('旧签名 stub（不解构 images）仍可工作', async () => {
    const legacy = (async (req: { systemPrompt: string; userPrompt: string }) => ({
      content: json([CAND('课程介绍与环境搭建', 0)]),
    })) as unknown as OutlineModelFn;
    const res = await runOutline(twoChunkCues(), legacy, {
      minSectionDurationMs: 0,
      imagesForChunk: () => [frame('QUFB', 30_000)],
    });
    expect(res.failedChunks).toBe(0);
    expect(res.sections).toHaveLength(1);
  });
});
