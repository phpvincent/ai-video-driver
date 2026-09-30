import { describe, expect, it } from 'vitest';
import {
  acceptable,
  applyPunctuateChunk,
  buildPunctuateUserPrompt,
  chunkCuesForPunctuate,
  punctuateCues,
} from '../../../src/core/subtitle/punctuate';
import { getSubtitlePunctuateSystemPrompt, PROMPT_VERSIONS } from '../../../src/prompts';
import type { Cue } from '../../../src/types';

const cue = (index: number, text: string): Cue => ({
  index,
  startMs: index * 5_000,
  endMs: index * 5_000 + 4_800,
  text,
});

const chunk = [cue(0, '首先我们看一下这段代码'), cue(1, '这里呢有一个函数'), cue(2, '它接收两个参数')];

const reply = (lines: Array<{ i: number; t: string }>): string => JSON.stringify({ lines });

describe('分块与提示构造', () => {
  it('按累计字符分块，不拆散单条；短字幕单块', () => {
    const cues = Array.from({ length: 100 }, (_, i) => cue(i, `第${i}句`));
    const chunks = chunkCuesForPunctuate(cues, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().map((c) => c.index)).toEqual(cues.map((c) => c.index));
    expect(chunkCuesForPunctuate(chunk)).toHaveLength(1);
  });

  it('用户消息逐行携带 i 与原文；system prompt 来自单一事实源', () => {
    const prompt = buildPunctuateUserPrompt(chunk);
    expect(prompt).toContain('{"i":0,"t":"首先我们看一下这段代码"}');
    expect(prompt).toContain('{"i":2,"t":"它接收两个参数"}');
    const sys = getSubtitlePunctuateSystemPrompt();
    expect(sys).toContain('禁止合并句子');
    expect(sys).toContain('每一个字都必须原样保留');
    expect(PROMPT_VERSIONS.subtitlePunctuate).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('applyPunctuateChunk（A7：数量 / 顺序 / 时间戳不可变）', () => {
  it('合法输出：只替换 text，index/startMs/endMs 原样', () => {
    const out = applyPunctuateChunk(
      reply([
        { i: 0, t: '首先，我们看一下这段代码。' },
        { i: 1, t: '这里呢，有一个函数；' },
        { i: 2, t: '它接收两个参数。' },
      ]),
      chunk,
    );
    expect(out.fallback).toBe(false);
    expect(out.cues[0]).toMatchObject({ index: 0, startMs: 0, text: '首先，我们看一下这段代码。' });
    expect(out.cues[2]).toMatchObject({ index: 2, startMs: 10_000 });
  });

  it('漏句 / 多句 / 未知 i / 重复 i → 整块保留原文', () => {
    const original = chunk.map((c) => c.text);
    for (const bad of [
      reply([{ i: 0, t: '一。' }, { i: 1, t: '二。' }]), // 漏 i=2
      reply([{ i: 0, t: '一。' }, { i: 1, t: '二。' }, { i: 2, t: '三。' }, { i: 9, t: '多。' }]), // 多句
      reply([{ i: 0, t: '一。' }, { i: 1, t: '二。' }, { i: 2, t: '三。' }, { i: 1, t: '重复。' }]), // 重复
      '不是 JSON',
      '{"lines":',
    ]) {
      const out = applyPunctuateChunk(bad, chunk);
      expect(out.fallback).toBe(true);
      expect(out.cues.map((c) => c.text)).toEqual(original);
    }
  });

  it('越权改写的单句保留原文（同音错字与加标点不受影响）', () => {
    const out = applyPunctuateChunk(
      reply([
        { i: 0, t: '首先，我们看一下这段代码。' }, // 仅加标点 → 采纳
        { i: 1, t: '这个函数实现了参数校验、类型推断和错误处理的完整逻辑。' }, // 整句改写 → 拒绝
        { i: 2, t: '它接收两个参数。' }, // 纯加标点 → 采纳
      ]),
      chunk,
    );
    expect(out.cues[0]!.text).toBe('首先，我们看一下这段代码。');
    expect(out.cues[1]!.text).toBe('这里呢有一个函数'); // 原文
    expect(out.cues[2]!.text).toBe('它接收两个参数。');
  });

  it('acceptable：纯标点差异直接通过；空串拒绝', () => {
    expect(acceptable('他说好的', '他说好的。')).toBe(true);
    expect(acceptable('罗丝', '螺丝')).toBe(true); // 同音 1 字
    expect(acceptable('abc', '')).toBe(false);
    expect(acceptable('短', '完全不同的另一句话')).toBe(false);
  });
});

describe('punctuateCues（端到端，注入 modelFn）', () => {
  it('多块顺序处理；某块失败保留原文，其余块照常生效', async () => {
    const cues = Array.from({ length: 30 }, (_, i) => cue(i, `第${i}句内容`));
    const chunks = chunkCuesForPunctuate(cues, 40);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    let call = 0;
    const out = await punctuateCues(
      cues,
      async ({ userPrompt }) => {
        call += 1;
        if (call === 1) return { content: '垃圾输出' }; // 第一块失败
        // 其余块：把每句加句号（从 userPrompt 里回读 i 与原文，模拟"只加标点"）
        const lines = [...userPrompt.matchAll(/\{"i":(\d+),"t":"(.*?)"\}/g)].map((m) => ({
          i: Number(m[1]),
          t: `${m[2]}。`,
        }));
        return { content: reply(lines) };
      },
      () => 'SYS',
      40, // 注入小块尺寸，强制多块
    );
    expect(out.chunks).toBe(chunks.length);
    expect(out.fallbackChunks).toBe(1);
    // 第一块的句子保留原文
    expect(out.cues[0]!.text).toBe('第0句内容');
    // 后续块的句子带上了句号，且时间戳全部原样
    const last = out.cues[out.cues.length - 1]!;
    expect(last.text.endsWith('。')).toBe(true);
    expect(last.startMs).toBe((out.cues.length - 1) * 5_000);
    expect(out.cues.every((c, i) => c.index === i)).toBe(true);
  });

  it('模型抛错 → 该块原文，不向上抛', async () => {
    const out = await punctuateCues(
      chunk,
      async () => {
        throw new Error('network down');
      },
      () => 'SYS',
    );
    expect(out.fallbackChunks).toBe(1);
    expect(out.cues).toEqual(chunk);
  });
});
