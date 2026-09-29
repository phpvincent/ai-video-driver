/**
 * 大纲 Tab 单元测试（SPEC-03 3.4）。
 * 环境为 node 且未安装 @testing-library/react：
 * 纯逻辑直接断言；渲染用 react-dom/server 的 renderToString（不含 effect）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OutlineSection } from '../../../src/core/pipeline/outline';
import {
  OUTLINE_MODEL_NOT_READY_TEXT,
  OUTLINE_PHASE_TEXT,
  OutlineSectionList,
  OutlineTab,
  densityLabel,
  findActiveSection,
} from '../../../src/panel/OutlineTab';

const section = (
  id: string,
  startMs: number,
  endMs: number,
  title: string,
  extra: Partial<OutlineSection> = {},
): OutlineSection => ({
  id,
  title,
  startMs,
  endMs,
  summary: `${title}的摘要`,
  bullets: [
    { text: `${title}要点一`, startMs },
    { text: `${title}要点二`, startMs: endMs - 1 },
  ],
  terms: ['术语A'],
  importance: 3,
  cueRange: [0, 1],
  ...extra,
});

const sections = [
  section('sec_0001', 0, 60_000, '开场与环境准备'),
  section('sec_0002', 60_000, 180_000, '核心概念讲解'),
  section('sec_0003', 180_000, 300_000, '实战演示'),
];

describe('findActiveSection', () => {
  it('命中首章（positionMs = 0）', () => {
    expect(findActiveSection(sections, 0)?.id).toBe('sec_0001');
  });

  it('命中中间章', () => {
    expect(findActiveSection(sections, 120_000)?.id).toBe('sec_0002');
  });

  it('命中末章，且超过末章 endMs 仍停留末章', () => {
    expect(findActiveSection(sections, 200_000)?.id).toBe('sec_0003');
    expect(findActiveSection(sections, 999_999)?.id).toBe('sec_0003');
  });

  it('间隙取最后 startMs<=positionMs 的章（endMs 为开区间边界）', () => {
    // 末章 endMs=300_000 为开区间边界：恰好等于时按"最后 startMs<=pos"仍属末章
    expect(findActiveSection(sections, 300_000)?.id).toBe('sec_0003');
  });

  it('空数组返回 null', () => {
    expect(findActiveSection([], 1000)).toBeNull();
  });

  it('positionMs 早于首章 startMs 返回 null', () => {
    expect(findActiveSection(sections, -1)).toBeNull();
  });
});

describe('mm:ss 格式化复用（SubtitleTab.formatTimestamp）', () => {
  it('章节头渲染等宽 mm:ss 时间戳', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 65_000, 120_000, '格式化验证章')],
        activeId: null,
        onSeek: () => {},
      }),
    );
    // span 内单个表达式，无相邻文本节点分隔符
    expect(html).toContain('>01:05</span>');
  });

  it('0ms 渲染为 00:00', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 0, 60_000, '零点验证章')],
        activeId: null,
        onSeek: () => {},
      }),
    );
    expect(html).toContain('>00:00</span>');
  });
});

describe('状态文案映射', () => {
  it('idle / loading / degraded / empty 均有文案，ready 为空串', () => {
    expect(OUTLINE_PHASE_TEXT.idle).toContain('生成');
    expect(OUTLINE_PHASE_TEXT.loading).toContain('大纲生成中');
    expect(OUTLINE_PHASE_TEXT.degraded).toContain('失败');
    expect(OUTLINE_PHASE_TEXT.empty).toContain('字幕');
    expect(OUTLINE_PHASE_TEXT.ready).toBe('');
  });

  it('模型未配置文案', () => {
    expect(OUTLINE_MODEL_NOT_READY_TEXT).toContain('设置页');
  });
});

describe('densityLabel（3.5 接线前的占位）', () => {
  it('undefined → "-" 占位', () => {
    expect(densityLabel(undefined)).toBe('-');
  });

  it('high / mid / low 映射', () => {
    expect(densityLabel('high')).toBe('高密');
    expect(densityLabel('mid')).toBe('中密');
    expect(densityLabel('low')).toBe('低密');
  });
});

describe('renderToString 冒烟', () => {
  it('ready 主体渲染章节标题、要点、术语与 density 占位', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections,
        activeId: 'sec_0002',
        onSeek: () => {},
      }),
    );
    expect(html).toContain('核心概念讲解');
    expect(html).toContain('核心概念讲解要点一');
    expect(html).toContain('核心概念讲解要点二');
    expect(html).toContain('术语A');
    // density 占位：OutlineSection 无 density 字段时显示 '-'
    expect(html).toContain('>-</span>');
    expect(html).toContain('outline-section active');
  });

  it('带 density 的 section 渲染徽标（3.5 接上后自动生效）', () => {
    const withDensity = {
      ...section('sec_0001', 0, 60_000, '高密度章'),
      density: 'high',
    } as OutlineSection;
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [withDensity],
        activeId: null,
        onSeek: () => {},
      }),
    );
    expect(html).toContain('高密');
  });

  it('无 videoId 时渲染 idle 占位', () => {
    const html = renderToString(
      createElement(OutlineTab, {
        videoId: null,
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadOutline: () => Promise.reject(new Error('不应被调用')),
        modelReady: true,
      }),
    );
    expect(html).toContain('打开 B 站视频');
  });

  it('modelReady=false 时提示配置模型（不调 loadOutline）', () => {
    const html = renderToString(
      createElement(OutlineTab, {
        videoId: 'bv1xx_p1',
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadOutline: () => Promise.reject(new Error('不应被调用')),
        modelReady: false,
        onOpenSettings: () => {},
      }),
    );
    expect(html).toContain(OUTLINE_MODEL_NOT_READY_TEXT);
    expect(html).toContain('去设置');
  });

  it('有 videoId 且 modelReady 时渲染生成入口', () => {
    const html = renderToString(
      createElement(OutlineTab, {
        videoId: 'bv1xx_p1',
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadOutline: () => Promise.reject(new Error('初始渲染不触发')),
        modelReady: true,
      }),
    );
    expect(html).toContain('生成大纲');
  });
});
