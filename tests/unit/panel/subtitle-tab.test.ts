/**
 * 字幕 Tab 单元测试（SPEC-02 2.4）。
 * 环境为 node 且未安装 @testing-library/react：
 * 纯逻辑直接断言；渲染用 react-dom/server 的 renderToString（不含 effect）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Cue } from '../../../src/types';
import {
  SubtitleList,
  SubtitleTab,
  degradedText,
  findActiveCue,
  formatTimestamp,
  sourceLabel,
} from '../../../src/panel/SubtitleTab';

const cue = (index: number, startMs: number, endMs: number, text: string, approximate = false): Cue => ({
  index,
  startMs,
  endMs,
  text,
  ...(approximate ? { approximate: true } : {}),
});

describe('findActiveCue', () => {
  const cues = [cue(0, 0, 1000, '首'), cue(1, 1500, 2500, '中'), cue(2, 3000, 4000, '末')];

  it('命中中间条', () => {
    expect(findActiveCue(cues, 2000)?.text).toBe('中');
  });

  it('命中首条（positionMs = 0）', () => {
    expect(findActiveCue(cues, 0)?.text).toBe('首');
  });

  it('命中末条，且超过末条 endMs 仍停留末条', () => {
    expect(findActiveCue(cues, 3500)?.text).toBe('末');
    expect(findActiveCue(cues, 999_999)?.text).toBe('末');
  });

  it('间隙取 startMs<=positionMs 的最后一条', () => {
    // 1000~1500 为间隙，应停留首条
    expect(findActiveCue(cues, 1200)?.text).toBe('首');
  });

  it('空数组返回 null', () => {
    expect(findActiveCue([], 1000)).toBeNull();
  });

  it('positionMs 早于首条 startMs 返回 null', () => {
    expect(findActiveCue(cues, -1)).toBeNull();
  });
});

describe('formatTimestamp（mm:ss，分钟累计不进位）', () => {
  it('0 → 00:00', () => {
    expect(formatTimestamp(0)).toBe('00:00');
  });

  it('65s → 01:05', () => {
    expect(formatTimestamp(65_000)).toBe('01:05');
  });

  it('3671s → 61:11（超一小时不进位）', () => {
    expect(formatTimestamp(3_671_000)).toBe('61:11');
  });
});

describe('degradedText', () => {
  it('need_login', () => {
    expect(degradedText('need_login')).toBe('获取字幕需要登录 B 站，请登录后点击重试');
  });

  it('no_subtitle', () => {
    expect(degradedText('no_subtitle')).toBe('本视频没有可用字幕');
  });

  it('api_changed', () => {
    expect(degradedText('api_changed')).toContain('B 站接口变更');
  });

  it('network', () => {
    expect(degradedText('network')).toContain('网络异常');
  });
});

describe('sourceLabel', () => {
  it('bili_uploader → UP 主字幕', () => {
    expect(sourceLabel('bili_uploader')).toBe('UP 主字幕');
  });

  it('bili_ai → AI 字幕', () => {
    expect(sourceLabel('bili_ai')).toBe('AI 字幕');
  });

  it('manual → 手动粘贴', () => {
    expect(sourceLabel('manual')).toBe('手动粘贴');
  });
});

describe('renderToString 冒烟', () => {
  it('ready 主体（SubtitleList）渲染 cue 文本行、等宽时间戳与高亮行', () => {
    const html = renderToString(
      createElement(SubtitleList, {
        cues: [cue(0, 0, 2000, '第一句台词'), cue(1, 3000, 5000, '第二句台词')],
        activeIndex: 1,
        onSeek: () => {},
      }),
    );
    expect(html).toContain('第一句台词');
    expect(html).toContain('第二句台词');
    // renderToString 在相邻文本节点间插入 <!-- --> 分隔符
    expect(html).toContain('[<!-- -->00:03<!-- -->]');
    expect(html).toContain('subtitle-row active');
  });

  it('approximate Cue 出现"字幕时间为估算"提示条', () => {
    const html = renderToString(
      createElement(SubtitleList, {
        cues: [cue(0, 0, 1000, '估算时间句', true)],
        activeIndex: -1,
        onSeek: () => {},
      }),
    );
    expect(html).toContain('字幕时间为估算');
  });

  it('SubtitleTab 无 videoId 时渲染 idle 占位', () => {
    const html = renderToString(
      createElement(SubtitleTab, {
        videoId: null,
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadSubtitles: (): Promise<{ cues: never[]; status: 'no_subtitle' }> =>
          Promise.resolve({ cues: [], status: 'no_subtitle' }),
      }),
    );
    expect(html).toContain('打开 B 站视频');
  });
});
