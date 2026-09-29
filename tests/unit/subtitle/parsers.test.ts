import { describe, expect, it } from 'vitest';
import type { Cue } from '../../../src/types';
import {
  detectAndParse,
  parseBiliSubtitle,
  parsePlainText,
  parseSrt,
  parseVtt,
} from '../../../src/core/subtitle/parsers';

/** 红线 5：除估算外，解析输出每条 Cue 的 startMs/endMs 均为有限非负数 */
function expectRealTimestamps(cues: Cue[]): void {
  expect(cues.length).toBeGreaterThan(0);
  for (const cue of cues) {
    expect(Number.isFinite(cue.startMs)).toBe(true);
    expect(Number.isFinite(cue.endMs)).toBe(true);
    expect(cue.startMs).toBeGreaterThanOrEqual(0);
    expect(cue.endMs).toBeGreaterThan(0);
    expect(cue.endMs).toBeGreaterThanOrEqual(cue.startMs);
  }
}

describe('parseBiliSubtitle', () => {
  it('正常解析含小数秒的 body，文本 trim、index 顺序 0 起', () => {
    const json = {
      body: [
        { from: 1.5, to: 3.25, content: ' 大家好 ' },
        { from: 3.5, to: 5, content: '今天讲数组' },
      ],
    };
    expect(parseBiliSubtitle(json)).toEqual([
      { index: 0, startMs: 1500, endMs: 3250, text: '大家好' },
      { index: 1, startMs: 3500, endMs: 5000, text: '今天讲数组' },
    ]);
  });

  it('毫秒取整正确：1.2345s → 1235ms，3.5675s → 3568ms', () => {
    const cues = parseBiliSubtitle({
      body: [{ from: 1.2345, to: 3.5675, content: '取整' }],
    });
    expect(cues[0].startMs).toBe(1235);
    expect(cues[0].endMs).toBe(3568);
  });

  it('缺 body 返回 []', () => {
    expect(parseBiliSubtitle({})).toEqual([]);
    expect(parseBiliSubtitle({ meta: 'no body' })).toEqual([]);
  });

  it('body 非数组返回 []', () => {
    expect(parseBiliSubtitle({ body: 'nope' })).toEqual([]);
    expect(parseBiliSubtitle({ body: { 0: 'also no' } })).toEqual([]);
  });

  it('非对象输入返回 []', () => {
    expect(parseBiliSubtitle(null)).toEqual([]);
    expect(parseBiliSubtitle('string')).toEqual([]);
    expect(parseBiliSubtitle(42)).toEqual([]);
  });

  it('单条缺 content 或 from/to 非有限数时跳过该条', () => {
    const cues = parseBiliSubtitle({
      body: [
        { from: 0, to: 1, content: '第一条' },
        { from: 1, to: 2 }, // 缺 content
        { from: 'x', to: 3, content: '起点非数字' },
        { from: 2, to: NaN, content: '终点 NaN' },
        { from: 3, to: Infinity, content: '终点 Infinity' },
        { from: 4, to: 5, content: '第二条' },
      ],
    });
    expect(cues).toHaveLength(2);
    expect(cues.map((c) => c.text)).toEqual(['第一条', '第二条']);
    expect(cues[1].index).toBe(1);
  });

  it('空文本跳过', () => {
    const cues = parseBiliSubtitle({
      body: [
        { from: 0, to: 1, content: '   ' },
        { from: 1, to: 2, content: '' },
        { from: 2, to: 3, content: '保留' },
      ],
    });
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('保留');
    expect(cues[0].index).toBe(0);
  });

  it('红线 5：输出每条 Cue 均有有限非负时间戳', () => {
    expectRealTimestamps(
      parseBiliSubtitle({
        body: [
          { from: 0.1, to: 2.4, content: '甲' },
          { from: 2.5, to: 4.9, content: '乙' },
        ],
      }),
    );
  });
});

describe('parseSrt', () => {
  const standard = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    '大家好',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    '今天讲第一课',
    '',
  ].join('\n');

  it('标准块：序号 + 时间行 + 正文', () => {
    expect(parseSrt(standard)).toEqual([
      { index: 0, startMs: 1000, endMs: 3500, text: '大家好' },
      { index: 1, startMs: 4000, endMs: 6000, text: '今天讲第一课' },
    ]);
  });

  it('无序号行也能解析', () => {
    const text = ['00:00:01,000 --> 00:00:02,000', '直接开始'].join('\n');
    const cues = parseSrt(text);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 2000, text: '直接开始' });
  });

  it('毫秒分隔符也接受 `.`', () => {
    const text = ['1', '00:00:01.200 --> 00:00:02.800', '点分隔'].join('\n');
    const cues = parseSrt(text);
    expect(cues[0].startMs).toBe(1200);
    expect(cues[0].endMs).toBe(2800);
  });

  it('多行正文用换行拼接', () => {
    const text = ['1', '00:00:01,000 --> 00:00:04,000', '第一行', '第二行'].join('\n');
    expect(parseSrt(text)[0].text).toBe('第一行\n第二行');
  });

  it('乱输入返回 []', () => {
    expect(parseSrt('这不是字幕文件\n随便什么内容')).toEqual([]);
    expect(parseSrt('')).toEqual([]);
  });

  it('红线 5：输出每条 Cue 均有有限非负时间戳', () => {
    expectRealTimestamps(parseSrt(standard));
  });
});

describe('parseVtt', () => {
  const sample = [
    'WEBVTT',
    '',
    'NOTE 这是一条注释',
    '注释第二行',
    '',
    'STYLE',
    '::cue {',
    '  color: red',
    '}',
    '',
    'intro-cue',
    '00:00:01.000 --> 00:00:03.000',
    '<c>大家好</c>欢迎学习<00:00:02.000>课程',
    '',
    '01:05.000 --> 01:07.500 align:start',
    '第二段内容',
    '',
  ].join('\n');

  it('带 WEBVTT 头：跳过头/NOTE/STYLE 块，解析 cue（含 cue id 行）', () => {
    const cues = parseVtt(sample);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ index: 0, startMs: 1000, endMs: 3000, text: '大家好欢迎学习课程' });
    expect(cues[1]).toMatchObject({ index: 1, startMs: 65000, endMs: 67500, text: '第二段内容' });
  });

  it('NOTE 块跳过', () => {
    const text = [
      'WEBVTT',
      '',
      'NOTE 注意这里',
      '',
      '00:00:01.000 --> 00:00:02.000',
      '正文',
      '',
    ].join('\n');
    const cues = parseVtt(text);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('正文');
  });

  it('`<c>` 等行内标签清除', () => {
    const text = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.000',
      '<c.yellow>高亮文本</c>后续<v 老师>讲解</v>',
      '',
    ].join('\n');
    expect(parseVtt(text)[0].text).toBe('高亮文本后续讲解');
  });

  it('接受无小时格式 MM:SS.mmm', () => {
    const text = ['WEBVTT', '', '05:30.250 --> 06:00.750', '无小时', ''].join('\n');
    const cues = parseVtt(text);
    expect(cues[0].startMs).toBe(330250);
    expect(cues[0].endMs).toBe(360750);
  });

  it('乱输入返回 []', () => {
    expect(parseVtt('没有头也没有时间轴')).toEqual([]);
    expect(parseVtt('WEBVTT\n\n完全没有时间轴的正文')).toEqual([]);
  });

  it('红线 5：输出每条 Cue 均有有限非负时间戳', () => {
    expectRealTimestamps(parseVtt(sample));
  });
});

describe('parsePlainText', () => {
  it('多段按累计字数估算：默认速率 4 字/秒', () => {
    const cues = parsePlainText('这是第一句。这是第二句。这是第三句');
    expect(cues).toEqual([
      { index: 0, startMs: 0, endMs: 1250, text: '这是第一句', approximate: true },
      { index: 1, startMs: 1250, endMs: 2500, text: '这是第二句', approximate: true },
      { index: 2, startMs: 2500, endMs: 3750, text: '这是第三句', approximate: true },
    ]);
  });

  it('换行与句号混合分段', () => {
    const cues = parsePlainText('第一行句子。\n第二行句子\n第三段。');
    expect(cues.map((c) => c.text)).toEqual(['第一行句子', '第二行句子', '第三段']);
    expect(cues.map((c) => c.startMs)).toEqual([0, 1250, 2500]);
  });

  it('每条 Cue 均带 approximate: true（红线 5：估算时间必须显式声明）', () => {
    const cues = parsePlainText('一段话\n二段话\n三段话');
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.approximate).toBe(true);
      expect(Number.isFinite(cue.startMs)).toBe(true);
      expect(Number.isFinite(cue.endMs)).toBe(true);
    }
  });

  it('速率可通过 opts 覆盖', () => {
    const cues = parsePlainText('五个字的段\n四字', { charsPerSecond: 10 });
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 500 });
    expect(cues[1]).toMatchObject({ startMs: 500, endMs: 700 });
  });

  it('空白输入返回 []', () => {
    expect(parsePlainText('')).toEqual([]);
    expect(parsePlainText('   \n  \t ')).toEqual([]);
  });

  it('时间连续性：第 n 条 startMs = 第 n-1 条 endMs', () => {
    const cues = parsePlainText('一句\n二句\n三句\n四句');
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBe(cues[i - 1].endMs);
    }
  });
});

describe('detectAndParse', () => {
  it('WEBVTT 头 → 走 VTT 解析（无小时时间可正确解析）', () => {
    const text = 'WEBVTT\n\n01:05.000 --> 01:07.000\n内容';
    const cues = detectAndParse(text);
    expect(cues).toHaveLength(1);
    expect(cues[0].startMs).toBe(65000);
    expect(cues[0].text).toBe('内容');
  });

  it('含 ` --> ` 且无 WEBVTT 头 → 走 SRT 解析', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\n你好';
    const cues = detectAndParse(text);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 2000, text: '你好' });
    expect(cues[0].approximate).toBeUndefined();
  });

  it('其他 → 按纯文本估算（approximate: true）', () => {
    const cues = detectAndParse('第一句话。第二句话');
    expect(cues).toHaveLength(2);
    for (const cue of cues) {
      expect(cue.approximate).toBe(true);
    }
  });
});
