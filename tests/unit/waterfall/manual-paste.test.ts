import { describe, expect, it } from 'vitest';
import { manualPaste } from '../../../src/providers/manual-paste';

const SRT_SAMPLE = [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  '大家好欢迎来到课程',
  '',
  '2',
  '00:00:05,000 --> 00:00:07,000',
  '今天讲解第二课',
].join('\n');

describe('manualPaste（手动粘贴通道）', () => {
  it('SRT 样例 → manual_pasted + source manual，保留真实时间戳（无 approximate）', () => {
    const r = manualPaste(SRT_SAMPLE);
    expect(r.status).toBe('manual_pasted');
    expect(r.source).toBe('manual');
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0]).toMatchObject({ index: 0, startMs: 1000, endMs: 3500, text: '大家好欢迎来到课程' });
    expect(r.cues[1]).toMatchObject({ index: 1, startMs: 5000, endMs: 7000, text: '今天讲解第二课' });
    for (const cue of r.cues) expect(cue.approximate).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it('SRT rolling caption：连续重复行去重，幸存条时间戳不变', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      '滚动字幕重复行',
      '',
      '2',
      '00:00:03,100 --> 00:00:05,000',
      '滚动字幕重复行',
      '',
      '3',
      '00:00:05,100 --> 00:00:07,000',
      '新内容出现',
    ].join('\n');
    const r = manualPaste(srt);
    expect(r.status).toBe('manual_pasted');
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: '滚动字幕重复行' });
    expect(r.cues[1]).toMatchObject({ index: 1, startMs: 5100, endMs: 7000, text: '新内容出现' });
  });

  it('VTT 样例 → 正常解析', () => {
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:03.000', 'vtt 格式字幕内容'].join('\n');
    const r = manualPaste(vtt);
    expect(r.status).toBe('manual_pasted');
    expect(r.source).toBe('manual');
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: 'vtt 格式字幕内容' });
  });

  it('纯文本 → 按 4 字/秒估算，全部 approximate 且段间连续', () => {
    // 两个 8 字句：每句 8 / 4 = 2000ms
    const r = manualPaste('第一句话有五个字。第二句也有五个字');
    expect(r.status).toBe('manual_pasted');
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0].startMs).toBe(0);
    expect(r.cues[0].endMs).toBe(2000);
    expect(r.cues[1].startMs).toBe(2000);
    expect(r.cues[1].endMs).toBe(4000);
    for (const cue of r.cues) expect(cue.approximate).toBe(true);
  });

  it('纯语气词 → 规范化后全被过滤 → no_subtitle', () => {
    const r = manualPaste('嗯。啊。');
    expect(r).toEqual({ cues: [], status: 'no_subtitle', error: '无法解析粘贴内容' });
  });

  it('空串 → no_subtitle', () => {
    expect(manualPaste('')).toEqual({ cues: [], status: 'no_subtitle', error: '无法解析粘贴内容' });
  });

  it('纯空白 → no_subtitle', () => {
    expect(manualPaste('  \n\t  ')).toEqual({ cues: [], status: 'no_subtitle', error: '无法解析粘贴内容' });
  });
});
