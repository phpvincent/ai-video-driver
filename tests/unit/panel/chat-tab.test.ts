/**
 * 问答 Tab 单测（SPEC-05）：区间选择器 / 打字机分片 / 时间戳吸附 / mm:ss 解析 /
 * renderToString 冒烟（模型未配置引导）+ SubtitleTab 划词提取纯函数。
 * 环境为 node 且未安装 @testing-library/react：纯逻辑直接断言，
 * 渲染用 react-dom/server 的 renderToString（不含 effect）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatTab, chunkTypewriter, parseMmSs, resolveRange, snapTimestamps } from '../../../src/panel/ChatTab';
import { extractSelectionText } from '../../../src/panel/SubtitleTab';
import type { Cue, QaRecord, Section } from '../../../src/types';

const mkSection = (id: string, startMs: number, endMs: number): Section => ({
  id,
  title: `章节${id}`,
  startMs,
  endMs,
  summary: '摘要',
  bullets: [{ text: '要点', startMs }],
  terms: [],
  importance: 3,
  density: 'mid',
  cueRange: [0, 5],
});

const sections = [mkSection('s1', 0, 120_000), mkSection('s2', 120_000, 240_000)];

const cue = (index: number, startMs: number, endMs: number, text: string): Cue => ({
  index,
  startMs,
  endMs,
  text,
});

describe('resolveRange（区间选择器解析）', () => {
  it('around：播放位置 ±30s', () => {
    expect(resolveRange('around', 100_000, sections)).toEqual([70_000, 130_000]);
  });

  it('around：不足 30s 时起点 clamp 到 0', () => {
    expect(resolveRange('around', 10_000, sections)).toEqual([0, 40_000]);
  });

  it('chapter：命中 positionMs 所在整章', () => {
    expect(resolveRange('chapter', 130_000, sections)).toEqual([120_000, 240_000]);
  });

  it('chapter 查不到章节时回落 ±30s', () => {
    expect(resolveRange('chapter', 100_000, [])).toEqual([70_000, 130_000]);
  });

  it('custom：合法自定义区间原样返回', () => {
    expect(resolveRange('custom', 100_000, sections, [30_000, 90_000])).toEqual([30_000, 90_000]);
  });

  it('custom 非法（起点>终点）回落 ±30s', () => {
    expect(resolveRange('custom', 100_000, sections, [90_000, 30_000])).toEqual([70_000, 130_000]);
  });
});

describe('parseMmSs', () => {
  it('"05:30" → 330000ms', () => {
    expect(parseMmSs('05:30')).toBe(330_000);
  });

  it('容忍空格；"0:5" 合法', () => {
    expect(parseMmSs(' 0:5 ')).toBe(5_000);
  });

  it('非法输入返回 null（秒 ≥60 / 缺冒号 / 字母）', () => {
    expect(parseMmSs('00:60')).toBeNull();
    expect(parseMmSs('12345')).toBeNull();
    expect(parseMmSs('ab:cd')).toBeNull();
  });
});

describe('chunkTypewriter（打字机分片）', () => {
  it('每片 1-3 字，join 还原原文', () => {
    const text = '注意力机制让模型学会对齐上下文';
    const chunks = chunkTypewriter(text);
    expect(chunks.join('')).toBe(text);
    for (const c of chunks) {
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c.length).toBeLessThanOrEqual(3);
    }
  });

  it('空字符串返回空数组', () => {
    expect(chunkTypewriter('')).toEqual([]);
  });
});

describe('snapTimestamps（A3：渲染前吸附到 Cue，越界丢弃）', () => {
  const cues = [
    cue(0, 0, 4000, 'a'),
    cue(1, 36_000, 40_000, 'b'),
    cue(2, 100_000, 104_000, 'c'),
  ];

  it('秒 → 最近 Cue 开始时间', () => {
    expect(snapTimestamps([36], cues)).toEqual([36_000]);
    expect(snapTimestamps([38], cues)).toEqual([36_000]);
  });

  it('越界值丢弃（早于首句 / 晚于末句），无 Cue 返回空', () => {
    expect(snapTimestamps([-10, 130], cues)).toEqual([]);
    expect(snapTimestamps([50], [])).toEqual([]);
  });

  it('去重并升序', () => {
    expect(snapTimestamps([100, 36, 38], cues)).toEqual([36_000, 100_000]);
  });
});

describe('ChatTab renderToString 冒烟', () => {
  it('无视频：idle 占位', () => {
    const html = renderToString(createElement(ChatTab, { videoId: null }));
    expect(html).toContain('打开 B 站视频');
  });

  it('模型未配置：去设置引导（含按钮）', () => {
    const html = renderToString(
      createElement(ChatTab, {
        videoId: 'BV1X_p1',
        modelReady: false,
        onOpenSettings: () => {},
      }),
    );
    expect(html).toContain('模型未配置');
    expect(html).toContain('去设置');
  });

  it('就绪态：渲染区间选择器与输入区', () => {
    const record: QaRecord = {
      id: 'r',
      videoId: 'BV1X_p1',
      interactionType: 'free',
      sectionId: null,
      timestampMs: 0,
      rangeMs: null,
      question: 'q',
      answer: 'a',
      payload: {},
      createdAt: '',
    };
    const html = renderToString(
      createElement(ChatTab, {
        videoId: 'BV1X_p1',
        sections,
        cues: [cue(0, 0, 1000, '首句')],
        positionMs: 130_000,
        modelReady: true,
        explain: async () => ({ record }),
      }),
    );
    expect(html).toContain('播放位置±30s');
    expect(html).toContain('当前整章');
    expect(html).toContain('自定义');
    expect(html).toContain('当前区间');
    expect(html).toContain('输入问题');
  });
});

describe('SubtitleTab extractSelectionText（划词提取纯函数）', () => {
  it('trim 两侧空白', () => {
    expect(extractSelectionText('  注意力机制 \n')).toBe('注意力机制');
  });

  it('纯空白返回 null', () => {
    expect(extractSelectionText('   \n\t ')).toBeNull();
    expect(extractSelectionText('')).toBeNull();
  });

  it('限长 40 字：超出截断', () => {
    expect(extractSelectionText('a'.repeat(50))).toBe('a'.repeat(40));
  });
});
