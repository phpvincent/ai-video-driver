/**
 * 字幕序列化器单元测试（SPEC-04 范围变更三次迭代：字幕下载）。
 * 覆盖 toSrt / toPlainText / formatMmSs（纯函数；浏览器下载壳不测）。
 */
import { describe, expect, it } from 'vitest';
import type { Cue } from '../../../src/types';
import { formatMmSs, toPlainText, toSrt } from '../../../src/core/subtitle/serialize';

const cue = (index: number, startMs: number, endMs: number, text: string): Cue => ({
  index,
  startMs,
  endMs,
  text,
});

describe('toSrt', () => {
  it('首条：序号行 + `HH:MM:SS,mmm --> HH:MM:SS,mmm` + 文本行', () => {
    const srt = toSrt([cue(0, 1_000, 3_500, '你好世界')]);
    expect(srt).toBe('1\n00:00:01,000 --> 00:00:03,500\n你好世界');
  });

  it('末条：毫秒补齐三位（3500ms → 00:00:03,500）', () => {
    const cues = [cue(0, 0, 1_000, '第一句'), cue(1, 2_000, 3_500, '最后一句')];
    const blocks = toSrt(cues).split('\n\n');
    expect(blocks[1]).toBe('2\n00:00:02,000 --> 00:00:03,500\n最后一句');
  });

  it('跨小时：3671000ms → 01:01:11,000', () => {
    const srt = toSrt([cue(0, 3_671_000, 3_673_000, '跨小时句')]);
    expect(srt).toContain('01:01:11,000 --> 01:01:13,000');
  });

  it('空 cues → 空串', () => {
    expect(toSrt([])).toBe('');
  });

  it('多 Cue 块之间以空行分隔（时间戳完整来自 Cue from/to，红线 5）', () => {
    const cues = [
      cue(0, 0, 1_000, 'A'),
      cue(1, 1_000, 2_000, 'B'),
      cue(2, 2_000, 3_000, 'C'),
    ];
    const srt = toSrt(cues);
    const blocks = srt.split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe('1\n00:00:00,000 --> 00:00:01,000\nA');
    expect(blocks[2]).toBe('3\n00:00:02,000 --> 00:00:03,000\nC');
    // 序号从 1 连续递增
    expect(blocks.map((b) => b.split('\n')[0])).toEqual(['1', '2', '3']);
  });

  it('approximate 时间照常输出（SRT 无 approximate 概念，不丢时间戳）', () => {
    const srt = toSrt([{ ...cue(0, 500, 1_500, '估算句'), approximate: true }]);
    expect(srt).toBe('1\n00:00:00,500 --> 00:00:01,500\n估算句');
  });
});

describe('toPlainText', () => {
  it('行格式 `[mm:ss] text`', () => {
    const text = toPlainText([cue(0, 5_000, 6_000, '这是第二句'), cue(1, 61_000, 62_000, 'later')]);
    expect(text.split('\n')).toEqual(['[00:05] 这是第二句', '[01:01] later']);
  });

  it('空输入 → 空串', () => {
    expect(toPlainText([])).toBe('');
  });
});

describe('formatMmSs', () => {
  it('0 → 00:00（0 是合法值）', () => {
    expect(formatMmSs(0)).toBe('00:00');
  });

  it('3671000 → 61:11（分钟累计，不进位到小时）', () => {
    expect(formatMmSs(3_671_000)).toBe('61:11');
  });
});
