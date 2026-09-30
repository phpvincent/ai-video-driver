/**
 * 概念知识图 pipeline 单测（SPEC-04 范围变更）。
 * 覆盖：parseConceptTree（合法/非法 JSON、结构越界与超长、缺字段）、
 * buildConceptMap（树结构、锚点映射、label 截断、重试、两次失败）、
 * buildTermIndexMap（多章聚合、排序、importance、空输入）、shortenLabel。
 */
import { describe, expect, it } from 'vitest';
import {
  buildConceptMap,
  buildConceptMapUserPrompt,
  buildTermIndexMap,
  parseConceptTree,
  shortenLabel,
} from '../../../src/core/pipeline/conceptMap';
import type { ConceptModelFn } from '../../../src/core/pipeline/types';
import type { Section } from '../../../src/types';

const section = (
  id: string,
  startMs: number,
  title: string,
  extra: Partial<Section> = {},
): Section => ({
  id,
  title,
  startMs,
  endMs: startMs + 60_000,
  summary: `${title}的摘要`,
  bullets: [{ text: `${title}要点`, startMs }],
  terms: [],
  importance: 3,
  cueRange: [0, 1],
  density: 'mid',
  ...extra,
});

const sections = [
  section('sec_0001', 0, '环境准备', { terms: ['上下文窗口', 'Token'] }),
  section('sec_0002', 60_000, '核心原理', { terms: ['上下文窗口', '注意力机制'], importance: 5 }),
  section('sec_0003', 180_000, '实战演示', { terms: ['注意力机制', 'Token'] }),
];

/** 合法的两域模型输出（覆盖跨章合并锚点） */
const validJson = JSON.stringify({
  domains: [
    {
      label: '基础概念',
      concepts: [
        { label: '上下文窗口', importance: 5, anchorSections: [1, 2], details: ['决定单次可见文本量'] },
        { label: 'Token', importance: 4, anchorSections: [1, 3], details: [] },
      ],
    },
    {
      label: '进阶机制',
      concepts: [
        { label: '注意力机制', importance: 5, anchorSections: [2, 3], details: ['并行计算相关性'] },
      ],
    },
    {
      label: '其他补充',
      concepts: [
        { label: '模型选型', importance: 2, anchorSections: [3, 99], details: [] },
      ],
    },
  ],
});

describe('parseConceptTree', () => {
  it('合法 JSON 解析为 ConceptTreeRaw', () => {
    const raw = parseConceptTree(validJson);
    expect(raw.domains).toHaveLength(3);
    expect(raw.domains[0].concepts[0].label).toBe('上下文窗口');
    expect(raw.domains[0].concepts[0].anchorSections).toEqual([1, 2]);
  });

  it('非法 JSON throw（错误信息含"不是合法 JSON"）', () => {
    expect(() => parseConceptTree('这不是JSON')).toThrow('不是合法 JSON');
  });

  it('domain 数量越界（2 个 / 7 个）均被 zod 拒', () => {
    const two = JSON.parse(validJson) as { domains: unknown[] };
    expect(() => parseConceptTree(JSON.stringify({ domains: two.domains.slice(0, 2) }))).toThrow();
    const seven = { domains: Array.from({ length: 7 }, (_, i) => ({ label: `域${i}`, concepts: [{ label: `概念${i}`, importance: 3, anchorSections: [1], details: [] }] })) };
    expect(() => parseConceptTree(JSON.stringify(seven))).toThrow('Schema 校验');
  });

  it('label 13~16 字（二次迭代：模型常见输出）通过 zod，不再硬拒', () => {
    const long = JSON.parse(validJson) as { domains: Array<{ concepts: Array<{ label: string }> }> };
    long.domains[0].concepts[0].label = '一二三四五六七八九十一二三四五'; // 15 字
    expect(() => parseConceptTree(JSON.stringify(long))).not.toThrow();
    const raw = parseConceptTree(JSON.stringify(long));
    // zod 收原始值，截断由构树代码负责（shortenLabel）
    expect(raw.domains[0].concepts[0].label).toBe('一二三四五六七八九十一二三四五');
  });

  it('label 超 zod 硬上限（31 字 > labelHardMax 30）仍被拒（防注入式超长）', () => {
    const long = JSON.parse(validJson) as { domains: Array<{ concepts: Array<{ label: string }> }> };
    long.domains[0].concepts[0].label = '一二三四五六七八九十'.repeat(3) + '一'; // 31 字
    expect(() => parseConceptTree(JSON.stringify(long))).toThrow('Schema 校验');
  });

  it('detail 超 zod 硬上限（41 字 > detailHardMax 40）被拒；30 字通过', () => {
    const parsed = JSON.parse(validJson) as {
      domains: Array<{ concepts: Array<{ details: string[] }> }>,
    };
    parsed.domains[0].concepts[0].details = ['x'.repeat(41)];
    expect(() => parseConceptTree(JSON.stringify(parsed))).toThrow('Schema 校验');
    parsed.domains[0].concepts[0].details = ['y'.repeat(30)];
    expect(() => parseConceptTree(JSON.stringify(parsed))).not.toThrow();
  });

  it('缺字段（concept 缺 importance）被 zod 拒', () => {
    const broken = JSON.parse(validJson) as { domains: Array<{ concepts: Array<Record<string, unknown>> }> };
    delete broken.domains[0].concepts[0].importance;
    expect(() => parseConceptTree(JSON.stringify(broken))).toThrow('Schema 校验');
  });
});

describe('buildConceptMap', () => {
  const getSystemPrompt = () => 'concept-map-test-system-prompt';
  /** 记录每次调用 prompt 的 stub modelFn（默认返回合法 JSON） */
  const stubModelFn = (replies: string[]): { fn: ConceptModelFn; calls: Array<{ systemPrompt: string; userPrompt: string }> } => {
    const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    let i = 0;
    const fn: ConceptModelFn = async (req) => {
      calls.push({ systemPrompt: req.systemPrompt, userPrompt: req.userPrompt });
      const content = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return { content };
    };
    return { fn, calls };
  };

  it('stub modelFn → 树结构正确（虚拟根 → domain → concept → detail，id 前缀 cm_）', async () => {
    const { fn } = stubModelFn([validJson]);
    const { root, degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    expect(degraded).toBe(false);
    expect(root.kind).toBe('domain');
    expect(root.label).toBe('大模型入门');
    expect(root.children).toHaveLength(3);
    expect(root.children[0].kind).toBe('domain');
    expect(root.children[0].label).toBe('基础概念');
    const concept = root.children[0].children[0];
    expect(concept.kind).toBe('concept');
    expect(concept.label).toBe('上下文窗口');
    expect(concept.children).toHaveLength(1);
    expect(concept.children[0].kind).toBe('detail');
    expect(concept.id).toMatch(/^cm_\d{4}$/);
    // domain importance = 子概念最大值
    expect(root.children[0].importance).toBe(5);
  });

  it('anchors 映射到对应章节 startMs 与 sectionId（跨章合并）', async () => {
    const { fn } = stubModelFn([validJson]);
    const { root } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    const concept = root.children[0].children[0]; // 上下文窗口：章节 1、2
    expect(concept.anchors).toEqual([
      { tMs: 0, sectionId: 'sec_0001' },
      { tMs: 60_000, sectionId: 'sec_0002' },
    ]);
    // 越界编号被丢弃（模型幻觉防御）
    expect(root.children[2].children[0].anchors).toEqual([{ tMs: 180_000, sectionId: 'sec_0003' }]);
  });

  it('label 超长截断：根 label（videoTitle）截到 ≤16 字并加省略号', async () => {
    const { fn } = stubModelFn([validJson]);
    const longTitle = '这是一个特别特别特别特别特别特别长的视频标题';
    const { root } = await buildConceptMap({
      sections,
      videoTitle: longTitle,
      modelFn: fn,
      getSystemPrompt,
    });
    expect(Array.from(root.label)).toHaveLength(16);
    expect(root.label.endsWith('…')).toBe(true);
  });

  it('二次迭代：16 字概念 label 通过 zod 且构树强制截断为 12（降级根因修复）', async () => {
    const parsed = JSON.parse(validJson) as {
      domains: Array<{ concepts: Array<{ label: string; details: string[] }> }>,
    };
    parsed.domains[0].concepts[0].label = '一二三四五六七八九十一二三四五六'; // 16 字
    parsed.domains[0].concepts[0].details = ['z'.repeat(30)]; // detail 30 字（< hardMax 40）
    const { fn } = stubModelFn([JSON.stringify(parsed)]);
    const { root, degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    expect(degraded).toBe(false);
    const concept = root.children[0].children[0];
    // 代码截断：label → 12（11 字 + 省略号），detail → 20（19 字 + 省略号）
    expect(Array.from(concept.label)).toHaveLength(12);
    expect(concept.label).toBe('一二三四五六七八九十一…');
    expect(Array.from(concept.children[0].label)).toHaveLength(20);
    expect(concept.children[0].label.endsWith('…')).toBe(true);
  });

  it('重试后成功：第一次非法 JSON，第二次合法，重试 prompt 附带错误信息', async () => {
    const { fn, calls } = stubModelFn(['oops{', validJson]);
    const { root, degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    expect(degraded).toBe(false);
    expect(root.children).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[1].userPrompt).toContain('[重试]');
    expect(calls[1].userPrompt).toContain('不是合法 JSON');
    expect(calls[0].systemPrompt).toBe('concept-map-test-system-prompt');
  });

  it('两次失败 throw（默认 maxRetries=1）', async () => {
    const { fn, calls } = stubModelFn(['oops{', 'still{bad']);
    await expect(
      buildConceptMap({
        sections,
        videoTitle: '大模型入门',
        modelFn: fn,
        getSystemPrompt,
      }),
    ).rejects.toThrow('概念图生成失败');
    expect(calls).toHaveLength(2);
  });

  it('user prompt 组装：章节编号 | 标题 | 分数 | 重要性 | 摘要 | 术语', () => {
    const withScore = [
      section('sec_0001', 0, '环境准备', { terms: ['上下文窗口', 'Token'], score: 85 }),
      ...sections.slice(1),
    ];
    const prompt = buildConceptMapUserPrompt(withScore, '大模型入门');
    expect(prompt).toContain('视频标题：大模型入门');
    expect(prompt).toContain('[1] 环境准备 | 85分 | 重要性3');
    expect(prompt).toContain('[2] 核心原理 | 无分数 | 重要性5');
    expect(prompt).toContain('术语：上下文窗口、Token');
  });
});

describe('buildTermIndexMap', () => {
  it('多章术语聚合：同一术语跨章合并为单 concept，anchors = 出现章节', () => {
    const { root, degraded } = buildTermIndexMap(sections);
    expect(degraded).toBe(true);
    expect(root.kind).toBe('domain');
    expect(root.children).toHaveLength(1);
    const domain = root.children[0];
    expect(domain.label).toBe('核心术语');
    const labels = domain.children.map((c) => c.label);
    expect(labels).toContain('上下文窗口');
    const ctx = domain.children.find((c) => c.label === '上下文窗口')!;
    expect(ctx.anchors).toEqual([
      { tMs: 0, sectionId: 'sec_0001' },
      { tMs: 60_000, sectionId: 'sec_0002' },
    ]);
    expect(ctx.children).toEqual([]);
  });

  it('按出现章节数降序排序（并列时按首次出现顺序，确定性）', () => {
    const ordered = [
      section('s1', 0, '第一章', { terms: ['甲', '乙', '丙'] }),
      section('s2', 60_000, '第二章', { terms: ['甲', '乙'] }),
      section('s3', 120_000, '第三章', { terms: ['甲'] }),
    ];
    const { root } = buildTermIndexMap(ordered);
    const labels = root.children[0].children.map((c) => c.label);
    // 甲出现 3 章、乙 2 章、丙 1 章
    expect(labels).toEqual(['甲', '乙', '丙']);
  });

  it('importance = min(5, 出现章节数)', () => {
    const manySections = Array.from({ length: 7 }, (_, i) =>
      section(`sec_${i + 1}`, i * 60_000, `章节${i}`, { terms: ['跨章术语'] }),
    );
    const { root } = buildTermIndexMap(manySections);
    const term = root.children[0].children[0];
    expect(term.importance).toBe(5);
    const two = buildTermIndexMap(sections).root.children[0].children[0];
    expect(two.importance).toBe(2);
  });

  it('空 sections：根无子节点（degraded: true）', () => {
    const { root, degraded } = buildTermIndexMap([]);
    expect(degraded).toBe(true);
    expect(root.children).toEqual([]);
    expect(root.kind).toBe('domain');
  });
});

describe('shortenLabel', () => {
  it('长度 ≤12 原样返回（含 trim）', () => {
    expect(shortenLabel('上下文窗口')).toBe('上下文窗口');
    expect(shortenLabel('Context')).toBe('Context');
    expect(shortenLabel('  上下文窗口  ')).toBe('上下文窗口');
    expect(shortenLabel('一二三四五六七八九十')).toBe('一二三四五六七八九十');
  });

  it('超长截断加省略号（总长 ≤12，含省略号）', () => {
    const out = shortenLabel('一二三四五六七八九十一二三四五');
    expect(Array.from(out)).toHaveLength(12);
    expect(out).toBe('一二三四五六七八九十一…');
    expect(shortenLabel('a very long label here')).toBe('a very long…');
  });

  it('中文等宽：按码点计数，不按 UTF-16 单元', () => {
    // 12 个汉字（24 个 UTF-16 单元）不截断
    const cjk12 = '一二三四五六七八九十一二';
    expect(shortenLabel(cjk12)).toBe(cjk12);
    // 13 个汉字截为 11 字 + 省略号
    expect(shortenLabel('一二三四五六七八九十一二三')).toBe('一二三四五六七八九十一…');
  });
});
