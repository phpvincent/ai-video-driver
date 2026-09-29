/**
 * 导图 Tab 单元测试（SPEC-04：渲染 + 跳播 + 播放跟随）。
 * 环境为 node 且无 DOM：纯函数（buildMindmapMarkdown / parseNodeTimestamp /
 * findActiveSectionIndex）直接断言；组件渲染只覆盖"空大纲引导"分支
 * （markmap 为 effect 内动态 import，renderToString 不触发 effect，
 * 也不会把 markmap-lib / markmap-view 拉入 node 测试环境）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MINDMAP_EMPTY_ACTION_TEXT,
  MINDMAP_EMPTY_TEXT,
  MINDMAP_ROOT_TEXT,
  MindmapEmptyGuide,
  MindmapTab,
  buildMindmapMarkdown,
  findActiveSectionIndex,
  parseNodeTimestamp,
  sectionHeadingText,
} from '../../../src/panel/MindmapTab';
import type { Section } from '../../../src/types';

const section = (
  id: string,
  startMs: number,
  endMs: number,
  title: string,
  extra: Partial<Section> = {},
): Section => ({
  id,
  title,
  startMs,
  endMs,
  summary: `${title}的摘要`,
  bullets: [
    { text: `${title}要点一`, startMs },
    { text: `${title}要点二`, startMs: endMs - 1 },
  ],
  terms: [],
  importance: 3,
  cueRange: [0, 1],
  density: 'mid',
  ...extra,
});

const sections = [
  section('sec_0001', 0, 60_000, '开场与环境准备', { score: 85 }),
  section('sec_0002', 60_000, 180_000, '核心概念讲解', { score: 60, density: 'high' }),
  section('sec_0003', 180_000, 300_000, '实战演示'),
];

describe('buildMindmapMarkdown', () => {
  it('空 sections 只有根节点 `# 大纲`', () => {
    expect(buildMindmapMarkdown([])).toBe(`# ${MINDMAP_ROOT_TEXT}`);
  });

  it('正常 sections：含 `## {mm:ss} {title}（{score}分）` 行（章节顺序保持）', () => {
    const md = buildMindmapMarkdown(sections);
    const lines = md.split('\n');
    expect(lines[0]).toBe('# 大纲');
    expect(lines).toContain('## 00:00 开场与环境准备（85分）');
    expect(lines).toContain('## 01:00 核心概念讲解（60分）【高密】');
    expect(lines).toContain('## 03:00 实战演示');
    // 顺序：三行章节标题依次出现
    const i1 = lines.indexOf('## 00:00 开场与环境准备（85分）');
    const i2 = lines.indexOf('## 01:00 核心概念讲解（60分）【高密】');
    const i3 = lines.indexOf('## 03:00 实战演示');
    expect(i1).toBeGreaterThan(0);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  it('bullet 渲染为三级行 `### {mm:ss} {text}`（跳播锚 = 吸附后 startMs）', () => {
    const lines = buildMindmapMarkdown(sections).split('\n');
    expect(lines).toContain('### 00:00 开场与环境准备要点一');
    expect(lines).toContain('### 00:59 开场与环境准备要点二');
  });

  it('score 缺省时无 `（x分）` 后缀（不得出现 undefined）', () => {
    const md = buildMindmapMarkdown(sections);
    expect(md).not.toContain('undefined');
    expect(md.split('\n')).toContain('## 03:00 实战演示');
    // 精确：无 score 的章节行不带分后缀
    expect(md).not.toContain('（undefined分）');
  });

  it('高密度章节带【高密】标记，中/低密度不带', () => {
    const md = buildMindmapMarkdown(sections);
    expect(md).toContain('核心概念讲解（60分）【高密】');
    expect(md).not.toContain('开场与环境准备（85分）【高密】');
    expect(md).not.toContain('实战演示【高密】');
  });

  it('空 bullets 章节只有标题行，不产生空要点', () => {
    const empty = [section('sec_a', 0, 1000, '空章节', { bullets: [] })];
    const md = buildMindmapMarkdown(empty);
    expect(md.split('\n')).toEqual(['# 大纲', '## 00:00 空章节']);
  });

  it('sectionHeadingText：score 缺省回退无分后缀（防 `(undefined分)` bug）', () => {
    expect(sectionHeadingText(sections[0])).toBe('00:00 开场与环境准备（85分）');
    expect(sectionHeadingText(sections[2])).toBe('03:00 实战演示');
  });
});

describe('parseNodeTimestamp', () => {
  it('`00:12 xxx` → 12000', () => {
    expect(parseNodeTimestamp('00:12 开场与环境准备（85分）')).toBe(12_000);
  });

  it('累计分钟 `61:11 xxx` → 3671000（超过 59 分的分钟）', () => {
    expect(parseNodeTimestamp('61:11 后半程章节')).toBe(3_671_000);
  });

  it('无数字时间戳返回 null（根节点 / 纯文本）', () => {
    expect(parseNodeTimestamp('大纲')).toBeNull();
    expect(parseNodeTimestamp('xx:yy 章节标题')).toBeNull();
    expect(parseNodeTimestamp('（85分）随机文本')).toBeNull();
  });

  it('`00:00` → 0（0 是合法值，不是 falsy bug）', () => {
    expect(parseNodeTimestamp('00:00 开场')).toBe(0);
    expect(parseNodeTimestamp('00:00 开场')).not.toBeNull();
  });

  it('时间戳不在开头或秒位不合法返回 null', () => {
    expect(parseNodeTimestamp('标题 00:12')).toBeNull();
    expect(parseNodeTimestamp('00:123 要点')).toBeNull();
    expect(parseNodeTimestamp('00:99 要点')).toBeNull();
  });
});

describe('findActiveSectionIndex', () => {
  it('首章命中（positionMs = 0）', () => {
    expect(findActiveSectionIndex(sections, 0)).toBe(0);
  });

  it('中间章命中', () => {
    expect(findActiveSectionIndex(sections, 120_000)).toBe(1);
  });

  it('末章命中，且超过末章 endMs 仍停留末章（间隙取最后 startMs<=pos）', () => {
    expect(findActiveSectionIndex(sections, 200_000)).toBe(2);
    expect(findActiveSectionIndex(sections, 999_999)).toBe(2);
    expect(findActiveSectionIndex(sections, 300_000)).toBe(2);
  });

  it('跨章跳跃直接落到目标章', () => {
    expect(findActiveSectionIndex(sections, 61_000)).toBe(1);
    expect(findActiveSectionIndex(sections, 240_000)).toBe(2);
  });

  it('空数组返回 -1；positionMs 早于首章返回 -1', () => {
    expect(findActiveSectionIndex([], 1000)).toBe(-1);
    const lateStart = [section('sec_late', 5_000, 10_000, '晚开始')];
    expect(findActiveSectionIndex(lateStart, 4_999)).toBe(-1);
    expect(findActiveSectionIndex(lateStart, 5_000)).toBe(0);
  });
});

describe('MindmapTab 渲染冒烟（renderToString，仅空大纲分支）', () => {
  const noop = () => {};

  it('空大纲显示引导文案，未传 onGoOutline 时无按钮', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections: [],
        positionMs: 0,
        onRequestSeek: noop,
      }),
    );
    expect(html).toContain(MINDMAP_EMPTY_TEXT);
    expect(html).not.toContain(MINDMAP_EMPTY_ACTION_TEXT);
    expect(html).not.toContain('<svg');
  });

  it('传 onGoOutline 时渲染引导按钮', () => {
    const html = renderToString(
      createElement(MindmapEmptyGuide, { onGoOutline: noop }),
    );
    expect(html).toContain(MINDMAP_EMPTY_TEXT);
    expect(html).toContain(MINDMAP_EMPTY_ACTION_TEXT);
    expect(html).toContain('<button');
  });
});
