/**
 * 概念知识图 pipeline 单测（SPEC-04 四次迭代：阶段流）。
 * 覆盖：parseConceptStages（合法/非法 JSON、阶段数与结构越界、超长、缺字段）、
 * buildConceptMap（阶段流结构、预告章节过滤、主锚、模型顺序保留、label 截断、
 * 重试、两次失败）、findOverviewSectionIndices、buildConceptAnchors、
 * buildTermIndexMap（stages 形状、多章聚合、排序、importance、空输入）、shortenLabel。
 */
import { describe, expect, it } from 'vitest';
import {
  buildConceptAnchors,
  buildConceptMap,
  buildConceptMapUserPrompt,
  buildStagesFromRaw,
  buildTermIndexMap,
  describeMapImages,
  findOverviewSectionIndices,
  normalizeConceptStages,
  parseConceptStages,
  shortenLabel,
  resolveFlows,
} from '../../../src/core/pipeline/conceptMap';
import type { ConceptModelFn, PipelineImage } from '../../../src/core/pipeline/types';
import type { ConceptStage, Section } from '../../../src/types';

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

/** 合法的三阶段模型输出（覆盖跨章合并锚点；6 个概念保证前两章命中比例 <50%，不触发预告过滤） */
const validJson = JSON.stringify({
  stages: [
    {
      label: '背景回顾',
      concepts: [
        { label: '上下文窗口', importance: 5, anchorSections: [1, 2], details: ['决定单次可见文本量'] },
        { label: 'Token', importance: 4, anchorSections: [1, 3], details: [] },
      ],
    },
    {
      label: '核心机制',
      concepts: [
        { label: '注意力机制', importance: 5, anchorSections: [2, 3], details: ['并行计算相关性'] },
        { label: '向量表示', importance: 3, anchorSections: [2], details: [] },
      ],
    },
    {
      label: '总结展望',
      concepts: [
        { label: '模型选型', importance: 2, anchorSections: [3, 99], details: [] },
        { label: '局限性', importance: 2, anchorSections: [3], details: [] },
      ],
    },
  ],
});

describe('parseConceptStages', () => {
  it('合法 JSON 解析为 ConceptStagesRaw', () => {
    const raw = parseConceptStages(validJson);
    expect(raw.stages).toHaveLength(3);
    expect(raw.stages[0].label).toBe('背景回顾');
    expect(raw.stages[0].concepts[0].label).toBe('上下文窗口');
    expect(raw.stages[0].concepts[0].anchorSections).toEqual([1, 2]);
  });

  it('非法 JSON throw（错误信息含"不是合法 JSON"）', () => {
    expect(() => parseConceptStages('这不是JSON')).toThrow('不是合法 JSON');
  });

  it('阶段数越界：2 个仍被拒；6 个被归一化截到 5（能救则救，0.7.1）', () => {
    const two = JSON.parse(validJson) as { stages: unknown[] };
    expect(() => parseConceptStages(JSON.stringify({ stages: two.stages.slice(0, 2) }))).toThrow();
    const six = { stages: Array.from({ length: 6 }, (_, i) => ({ label: `阶段${i}`, concepts: [{ label: `概念${i}a`, importance: 3, anchorSections: [1], details: [] }, { label: `概念${i}b`, importance: 3, anchorSections: [1], details: [] }] })) };
    const raw = parseConceptStages(JSON.stringify(six));
    expect(raw.stages).toHaveLength(5); // 保序取前 5
    expect(raw.stages[0].label).toBe('阶段0');
  });

  it('阶段 label 超 20 字被拒（阶段名体现推进逻辑的上限）', () => {
    const parsed = JSON.parse(validJson) as { stages: Array<{ label: string }> };
    parsed.stages[0].label = '一'.repeat(21);
    expect(() => parseConceptStages(JSON.stringify(parsed))).toThrow('Schema 校验');
    parsed.stages[0].label = '一'.repeat(20);
    expect(() => parseConceptStages(JSON.stringify(parsed))).not.toThrow();
  });

  it('每阶段概念数越界：1 个仍被拒；7 个被归一化截到 6（0.7.1）', () => {
    const one = JSON.parse(validJson) as { stages: Array<{ concepts: unknown[] }> };
    const backup = one.stages[0].concepts;
    one.stages[0].concepts = [backup[0]];
    expect(() => parseConceptStages(JSON.stringify(one))).toThrow();
    one.stages[0].concepts = [
      ...backup,
      ...Array.from({ length: 5 }, (_, i) => ({ label: `补充概念${i}`, importance: 3, anchorSections: [1], details: [] })),
    ];
    const raw = parseConceptStages(JSON.stringify(one));
    expect(raw.stages[0].concepts).toHaveLength(6); // 保序取前 6
  });

  it('概念 label 13~16 字（模型常见输出）通过 zod，不再硬拒', () => {
    const long = JSON.parse(validJson) as { stages: Array<{ concepts: Array<{ label: string }> }> };
    long.stages[0].concepts[0].label = '一二三四五六七八九十一二三四五'; // 15 字
    expect(() => parseConceptStages(JSON.stringify(long))).not.toThrow();
    const raw = parseConceptStages(JSON.stringify(long));
    // zod 收原始值，截断由构阶段流代码负责（shortenLabel）
    expect(raw.stages[0].concepts[0].label).toBe('一二三四五六七八九十一二三四五');
  });

  it('概念 label 超 zod 硬上限（31 字 > labelHardMax 30）仍被拒（防注入式超长）', () => {
    const long = JSON.parse(validJson) as { stages: Array<{ concepts: Array<{ label: string }> }> };
    long.stages[0].concepts[0].label = '一二三四五六七八九十'.repeat(3) + '一'; // 31 字
    expect(() => parseConceptStages(JSON.stringify(long))).toThrow('Schema 校验');
  });

  it('detail 超 zod 硬上限（41 字 > detailHardMax 40）被拒；30 字通过', () => {
    const parsed = JSON.parse(validJson) as {
      stages: Array<{ concepts: Array<{ details: string[] }> }>,
    };
    parsed.stages[0].concepts[0].details = ['x'.repeat(41)];
    expect(() => parseConceptStages(JSON.stringify(parsed))).toThrow('Schema 校验');
    parsed.stages[0].concepts[0].details = ['y'.repeat(30)];
    expect(() => parseConceptStages(JSON.stringify(parsed))).not.toThrow();
  });

  it('缺字段（concept 缺 importance）被 zod 拒', () => {
    const broken = JSON.parse(validJson) as { stages: Array<{ concepts: Array<Record<string, unknown>> }> };
    delete broken.stages[0].concepts[0].importance;
    expect(() => parseConceptStages(JSON.stringify(broken))).toThrow('Schema 校验');
  });

  it('线上失败形态复现（0.7.0 实测）：合法对象后混入弧串/数字/数组，归一化后可救回', () => {
    // 形态：stages.1~.4/.6 为字符串、.5 为数字、.7 为数组，且 >5 个元素
    const raw = JSON.parse(validJson) as { stages: unknown[] };
    const junk = [
      raw.stages[0],
      '概念课：动机/现象 → 概念定义 → 原理机制 → 示例 → 易错点/边界',
      '操作/教程课：目标 → 前置准备 → 步骤链 → 验证 → 常见坑',
      '原理推导课：问题 → 已知前提 → 推导链 → 结论 → 适用范围',
      '项目实战课：需求 → 架构/设计 → 实现要点 → 运行验证 → 踩坑总结',
      5,
      '综述/导览课：为何重要 → 概念框架 → 主题 1~n → 对比/争议 → 方向',
      ['主题1', '主题2', '主题3'],
      raw.stages[1],
      raw.stages[2],
    ];
    // 修复前该形态硬拒；现在垃圾元素被丢弃、合法对象保留（3 个 ≥ stagesMin）
    const parsed = parseConceptStages(JSON.stringify({ stages: junk }));
    expect(parsed.stages).toHaveLength(3);
    expect(parsed.stages[0].label).toBe('背景回顾');
    expect(parsed.stages[2].label).toBe('总结展望');
  });

  it('垃圾元素丢弃后不足 3 个阶段时仍如实报错（交给重试链路）', () => {
    const raw = JSON.parse(validJson) as { stages: unknown[] };
    const mostlyJunk = [raw.stages[0], '弧串', 5, ['主题']];
    expect(() => parseConceptStages(JSON.stringify({ stages: mostlyJunk }))).toThrow('Schema 校验');
  });
});

describe('normalizeConceptStages（形状归一化，确定性纯函数，0.7.1）', () => {
  it('全合法输入恒等返回（幂等）', () => {
    const value = JSON.parse(validJson);
    expect(normalizeConceptStages(value)).toEqual(value);
  });

  it('非对象根 / stages 非数组：原样返回不加工', () => {
    expect(normalizeConceptStages(null)).toBe(null);
    expect(normalizeConceptStages('x')).toBe('x');
    expect(normalizeConceptStages({ stages: 'oops' })).toEqual({ stages: 'oops' });
  });

  it('stages 混入非对象元素：只保留对象（含 null / 数组元素的丢弃）', () => {
    const value = { stages: [{ label: 'a', concepts: [] }, null, ['数组'], '字符串', 3] };
    expect(normalizeConceptStages(value)).toEqual({ stages: [{ label: 'a', concepts: [] }] });
  });

  it('concepts 混入非对象元素被丢弃；details 混入非字符串被丢弃', () => {
    const value = {
      stages: [
        {
          label: 'a',
          concepts: [
            { label: 'c1', details: ['ok', 5, null, ['x']] },
            'junk',
            { label: 'c2', details: [] },
          ],
        },
      ],
    };
    expect(normalizeConceptStages(value)).toEqual({
      stages: [{ label: 'a', concepts: [{ label: 'c1', details: ['ok'] }, { label: 'c2', details: [] }] }],
    });
  });

  it('超限截断：stages > 5 截到 5，concepts > 6 截到 6（保序取前 N）', () => {
    const mkConcept = (i: number) => ({ label: `概念${i}`, importance: 3, anchorSections: [1], details: [] });
    const value = {
      stages: Array.from({ length: 7 }, (_, i) => ({
        label: `阶段${i}`,
        concepts: Array.from({ length: 8 }, (_, j) => mkConcept(j)),
      })),
    };
    const out = normalizeConceptStages(value) as { stages: Array<{ concepts: unknown[] }> };
    expect(out.stages).toHaveLength(5);
    expect(out.stages.every((s) => s.concepts.length === 6)).toBe(true);
  });
});

describe('findOverviewSectionIndices（预告章节识别，确定性）', () => {
  it('前两章命中 ≥50% 概念 → 标记为预告章；后续章节命中再多也不标记', () => {
    // 5 章 + 4 个概念；第 1 章文本（terms）覆盖全部 4 个概念（100% ≥ 50%）
    const raw = parseConceptStages(JSON.stringify({
      stages: [
        { label: '阶段一', concepts: [
          { label: '概念甲', importance: 3, anchorSections: [1], details: [] },
          { label: '概念乙', importance: 3, anchorSections: [1], details: [] },
        ]},
        { label: '阶段二', concepts: [
          { label: '概念丙', importance: 3, anchorSections: [2], details: [] },
          { label: '概念丁', importance: 3, anchorSections: [2], details: [] },
        ]},
        { label: '阶段三', concepts: [
          { label: '概念甲', importance: 3, anchorSections: [3], details: [] },
          { label: '概念乙', importance: 3, anchorSections: [3], details: [] },
        ]},
      ],
    }));
    const secs = [
      section('s1', 0, '开场预告', { terms: ['概念甲', '概念乙', '概念丙', '概念丁'] }),
      section('s2', 60_000, '第二章', { terms: [] }),
      section('s3', 120_000, '第三章', { terms: [] }),
      section('s4', 180_000, '第四章', { terms: [] }),
      section('s5', 240_000, '第五章', { terms: [] }),
    ];
    const overview = findOverviewSectionIndices(raw, secs);
    expect(overview.has(0)).toBe(true);
    expect(overview.size).toBe(1);
  });

  it('命中比例 <50% 不标记（预告识别不误伤正常章节）', () => {
    const raw = parseConceptStages(validJson); // 4 个概念
    // 第 1 章只命中 1/4（上下文窗口 via terms）
    const secs = [
      section('s1', 0, '环境准备', { terms: ['上下文窗口'] }),
      ...sections.slice(1),
    ];
    const overview = findOverviewSectionIndices(raw, secs);
    expect(overview.size).toBe(0);
  });
});

describe('buildConceptAnchors（锚点构造：预告过滤 + 主锚，确定性）', () => {
  const secs = [
    section('s1', 0, '第一章'),
    section('s2', 60_000, '第二章'),
    section('s3', 120_000, '第三章'),
    section('s4', 180_000, '第四章'),
    section('s5', 240_000, '第五章'),
  ];

  it('主锚 = score 最高章节，排 anchors[0]；其余按时间升序', () => {
    const mixed = [
      section('s2', 60_000, '低分章', { score: 3 }),
      section('s3', 120_000, '高分章', { score: 8 }),
      section('s4', 180_000, '中分章', { score: 5 }),
    ];
    const anchors = buildConceptAnchors([1, 2, 3], mixed, new Set());
    expect(anchors[0]).toEqual({ tMs: 120_000, sectionId: 's3' }); // score 8 的主锚
    expect(anchors).toHaveLength(3);
    expect(anchors[1]).toEqual({ tMs: 60_000, sectionId: 's2' }); // 次锚按时间升序
    expect(anchors[2]).toEqual({ tMs: 180_000, sectionId: 's4' });
  });

  it('score 缺省视为最低：无分数章节不抢主锚（有分数者在先）', () => {
    const mixed = [
      section('s1', 0, '无分章'),
      section('s2', 60_000, '有分章', { score: 1 }),
    ];
    const anchors = buildConceptAnchors([1, 2], mixed, new Set());
    expect(anchors[0]).toEqual({ tMs: 60_000, sectionId: 's2' });
  });

  it('预告章节不贡献锚点；越界 / 非法编号丢弃；全被过滤则无锚', () => {
    const anchors = buildConceptAnchors([1, 2, 99, 3], secs, new Set([0]));
    // 编号 1（预告章）被过滤，99 越界丢弃
    expect(anchors).toEqual([
      { tMs: 60_000, sectionId: 's2' },
      { tMs: 120_000, sectionId: 's3' },
    ]);
    expect(buildConceptAnchors([1, 2], secs, new Set([0, 1]))).toEqual([]);
  });
});

describe('buildConceptMap', () => {
  const getSystemPrompt = () => 'concept-map-test-system-prompt';
  /** 记录每次调用 prompt 的 stub modelFn（默认返回合法 JSON） */
  const stubModelFn = (replies: string[]): {
    fn: ConceptModelFn;
    calls: Array<{ systemPrompt: string; userPrompt: string; images?: PipelineImage[] }>;
  } => {
    const calls: Array<{ systemPrompt: string; userPrompt: string; images?: PipelineImage[] }> = [];
    let i = 0;
    const fn: ConceptModelFn = async (req) => {
      calls.push({ systemPrompt: req.systemPrompt, userPrompt: req.userPrompt, images: req.images });
      const content = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return { content };
    };
    return { fn, calls };
  };

  it('stub modelFn → 阶段流结构正确（st_01/cm_0001 id、阶段与概念保留模型顺序）', async () => {
    const { fn } = stubModelFn([validJson]);
    const { stages, degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    expect(degraded).toBe(false);
    expect(stages.map((s) => s.id)).toEqual(['st_01', 'st_02', 'st_03']);
    expect(stages.map((s) => s.label)).toEqual(['背景回顾', '核心机制', '总结展望']);
    expect(stages[0].concepts[0].id).toBe('cm_0001');
    expect(stages[0].concepts[0].label).toBe('上下文窗口');
    expect(stages[0].concepts[0].details).toEqual(['决定单次可见文本量']);
    // 概念顺序 = 模型输出顺序（讲解顺序，不重排）
    expect(stages[0].concepts.map((c) => c.label)).toEqual(['上下文窗口', 'Token']);
    // id 全局连续重编（st_01 阶段下 cm_0001/cm_0002，st_03 阶段从 cm_0005 起）
    expect(stages[2].concepts[0].id).toBe('cm_0005');
  });

  it('anchors 映射到对应章节 startMs 与 sectionId（跨章合并、越界编号丢弃）', async () => {
    const { fn } = stubModelFn([validJson]);
    const { stages } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    const concept = stages[0].concepts[0]; // 上下文窗口：章节 1、2
    expect(concept.anchors).toEqual([
      { tMs: 0, sectionId: 'sec_0001' },
      { tMs: 60_000, sectionId: 'sec_0002' },
    ]);
    expect(concept.primaryAnchorTMs).toBe(0);
    // 越界编号被丢弃（模型幻觉防御）
    expect(stages[2].concepts[0].anchors).toEqual([{ tMs: 180_000, sectionId: 'sec_0003' }]);
  });

  it('四次迭代：预告章节过滤——第一章命中 ≥50% 概念时其 startMs 不出现在任何 anchor', async () => {
    // 5 章 + 4 概念；第 1 章（预告）覆盖全部概念，模型把第 1 章记入大量 anchorSections
    const raw = {
      stages: [
        { label: '背景回顾', concepts: [
          { label: '推理引擎', importance: 5, anchorSections: [1, 3], details: [] },
          { label: '行动模块', importance: 5, anchorSections: [1, 3], details: [] },
        ]},
        { label: '核心机制', concepts: [
          { label: '观察反馈', importance: 4, anchorSections: [1, 4], details: [] },
          { label: '循环执行', importance: 4, anchorSections: [1, 4], details: [] },
        ]},
        { label: '总结', concepts: [
          { label: '推理引擎', importance: 3, anchorSections: [1, 5], details: [] },
          { label: '观察反馈', importance: 3, anchorSections: [1, 5], details: [] },
        ]},
      ],
    };
    const fiveSections = [
      section('sec_0001', 0, '全片预告', {
        summary: '本视频将介绍推理引擎、行动模块、观察反馈与循环执行',
        terms: ['推理引擎', '行动模块', '观察反馈', '循环执行'],
      }),
      section('sec_0002', 60_000, '理论回顾'),
      section('sec_0003', 120_000, '核心机制', { score: 70 }),
      section('sec_0004', 180_000, '代码实现'),
      section('sec_0005', 240_000, '总结'),
    ];
    const { fn } = stubModelFn([JSON.stringify(raw)]);
    const { stages } = await buildConceptMap({
      sections: fiveSections,
      videoTitle: 'Agent 入门',
      modelFn: fn,
      getSystemPrompt,
    });
    for (const stage of stages) {
      for (const c of stage.concepts) {
        expect(c.anchors).not.toContainEqual({ tMs: 0, sectionId: 'sec_0001' });
        expect(c.anchors.length).toBeGreaterThan(0);
      }
    }
    // 第 3 章锚点正常保留（未被误伤）
    expect(stages[0].concepts[0].anchors).toContainEqual({ tMs: 120_000, sectionId: 'sec_0003' });
  });

  it('四次迭代：主锚 = score 最高章节——概念在 score 3 与 score 8 两章出现', async () => {
    const raw = {
      stages: [
        { label: '阶段一', concepts: [
          { label: '概念甲', importance: 3, anchorSections: [1], details: [] },
          { label: '概念乙', importance: 3, anchorSections: [1], details: [] },
        ]},
        { label: '阶段二', concepts: [
          { label: '概念丙', importance: 3, anchorSections: [1], details: [] },
          { label: '目标概念', importance: 5, anchorSections: [3, 5], details: [] },
        ]},
        { label: '阶段三', concepts: [
          { label: '概念丁', importance: 3, anchorSections: [1], details: [] },
          { label: '概念戊', importance: 3, anchorSections: [1], details: [] },
        ]},
      ],
    };
    const sixSections = [
      section('sec_0001', 0, '第一章'),
      section('sec_0002', 60_000, '第二章'),
      section('sec_0003', 120_000, '低分章', { score: 3 }),
      section('sec_0004', 180_000, '第四章'),
      section('sec_0005', 240_000, '高分章', { score: 8 }),
      section('sec_0006', 300_000, '第六章'),
    ];
    const { fn } = stubModelFn([JSON.stringify(raw)]);
    const { stages } = await buildConceptMap({
      sections: sixSections,
      videoTitle: '测试',
      modelFn: fn,
      getSystemPrompt,
    });
    const concept = stages[1].concepts[1];
    expect(concept.anchors).toHaveLength(2);
    expect(concept.primaryAnchorTMs).toBe(240_000); // score 8 章的 startMs
    expect(concept.anchors[0]).toEqual({ tMs: 240_000, sectionId: 'sec_0005' });
    expect(concept.anchors[1]).toEqual({ tMs: 120_000, sectionId: 'sec_0003' }); // 次锚按时间升序
  });

  it('概念 label 超长截断为 12；details 截断为 20（代码强制，防降级根因回归）', async () => {
    const parsed = JSON.parse(validJson) as {
      stages: Array<{ concepts: Array<{ label: string; details: string[] }> }>,
    };
    parsed.stages[0].concepts[0].label = '一二三四五六七八九十一二三四五六'; // 16 字
    parsed.stages[0].concepts[0].details = ['z'.repeat(30)]; // 30 字（< hardMax 40）
    const { fn } = stubModelFn([JSON.stringify(parsed)]);
    const { stages, degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    expect(degraded).toBe(false);
    const concept = stages[0].concepts[0];
    // 代码截断：label → 12（11 字 + 省略号），detail → 20（19 字 + 省略号）
    expect(Array.from(concept.label)).toHaveLength(12);
    expect(concept.label).toBe('一二三四五六七八九十一…');
    expect(Array.from(concept.details[0])).toHaveLength(20);
    expect(concept.details[0].endsWith('…')).toBe(true);
  });

  it('重试后成功：第一次非法 JSON，第二次合法，重试 prompt 附带错误信息', async () => {
    const { fn, calls } = stubModelFn(['oops{', validJson]);
    const { stages, degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
    });
    expect(degraded).toBe(false);
    expect(stages).toHaveLength(3);
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
    expect(prompt).toContain('知识流程');
  });
});

describe('概念图的图像输入（全片关键帧）', () => {
  const getSystemPrompt = () => 'concept-map-test-system-prompt';
  const frames: PipelineImage[] = [
    { dataBase64: 'QUFB', timeMs: 750_000 },
    { dataBase64: 'QkJC', timeMs: 1_830_000 },
  ];

  it('describeMapImages：空 / undefined → ""', () => {
    expect(describeMapImages([])).toBe('');
    expect(describeMapImages()).toBe('');
    expect(describeMapImages(null)).toBe('');
  });

  it('describeMapImages：含帧数与时间点，多帧按序拼接且只占一行', () => {
    const line = describeMapImages(frames);
    expect(line).toContain('以下附带 2 张课程画面');
    expect(line.indexOf('12:30')).toBeLessThan(line.indexOf('30:30'));
    expect(line.split('\n')).toHaveLength(1);
  });

  it('describeMapImages：无 timeMs → 按序号标注', () => {
    expect(describeMapImages([{ dataBase64: 'QUFB' }])).toContain('第 1 张');
  });

  it('buildConceptMap 传 images：modelFn 收到帧，prompt 追加说明行', async () => {
    const calls: Array<{ userPrompt: string; images?: PipelineImage[] }> = [];
    const fn: ConceptModelFn = async (req) => {
      calls.push({ userPrompt: req.userPrompt, images: req.images });
      return { content: validJson };
    };
    const { degraded } = await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
      images: frames,
    });
    expect(degraded).toBe(false);
    expect(calls[0]?.images).toHaveLength(2);
    expect(calls[0]?.images?.[0]?.dataBase64).toBe('QUFB');
    expect(calls[0]?.userPrompt).toContain('以下附带 2 张课程画面');
    expect(calls[0]?.userPrompt).toContain('12:30');
  });

  it('buildConceptMap 不传 images：req.images 为 undefined，prompt 无画面说明（旧行为不回归）', async () => {
    const calls: Array<{ userPrompt: string; images?: PipelineImage[] }> = [];
    const fn: ConceptModelFn = async (req) => {
      calls.push({ userPrompt: req.userPrompt, images: req.images });
      return { content: validJson };
    };
    await buildConceptMap({ sections, videoTitle: '大模型入门', modelFn: fn, getSystemPrompt });
    expect(calls[0]?.images).toBeUndefined();
    expect(calls[0]?.userPrompt).not.toContain('课程画面');
  });

  it('buildConceptMap 重试时仍带图（两次调用都带帧）', async () => {
    const calls: Array<{ userPrompt: string; images?: PipelineImage[] }> = [];
    let n = 0;
    const fn: ConceptModelFn = async (req) => {
      calls.push({ userPrompt: req.userPrompt, images: req.images });
      n += 1;
      return { content: n === 1 ? 'oops{' : validJson };
    };
    await buildConceptMap({
      sections,
      videoTitle: '大模型入门',
      modelFn: fn,
      getSystemPrompt,
      images: frames,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.images).toHaveLength(2);
    expect(calls[1]?.userPrompt).toContain('以下附带 2 张课程画面');
  });
});

describe('buildStagesFromRaw（构阶段流纯函数）', () => {
  it('无锚概念（anchorSections 全被过滤/越界）primaryAnchorTMs = -1', () => {
    const raw = parseConceptStages(validJson);
    const stages = buildStagesFromRaw(raw, sections.slice(0, 0)); // 空章节 → 全部越界
    // 空章节下所有编号越界，概念无锚
    for (const stage of stages) {
      for (const c of stage.concepts) {
        expect(c.anchors).toEqual([]);
        expect(c.primaryAnchorTMs).toBe(-1);
      }
    }
  });
});

describe('buildTermIndexMap（降级，stages 形状）', () => {
  it('多章术语聚合：单阶段"核心术语"，术语跨章合并为单概念（主锚 = 首个）', () => {
    const { stages, degraded } = buildTermIndexMap(sections);
    expect(degraded).toBe(true);
    expect(stages).toHaveLength(1);
    expect(stages[0].id).toBe('st_01');
    expect(stages[0].label).toBe('核心术语');
    const labels = stages[0].concepts.map((c) => c.label);
    expect(labels).toContain('上下文窗口');
    const ctx = stages[0].concepts.find((c) => c.label === '上下文窗口')!;
    expect(ctx.anchors).toEqual([
      { tMs: 0, sectionId: 'sec_0001' },
      { tMs: 60_000, sectionId: 'sec_0002' },
    ]);
    expect(ctx.primaryAnchorTMs).toBe(0);
    expect(ctx.details).toEqual([]);
    expect(ctx.id).toMatch(/^cm_\d{4}$/);
  });

  it('按出现章节数降序排序（并列时按首次出现顺序，确定性）', () => {
    const ordered = [
      section('s1', 0, '第一章', { terms: ['甲', '乙', '丙'] }),
      section('s2', 60_000, '第二章', { terms: ['甲', '乙'] }),
      section('s3', 120_000, '第三章', { terms: ['甲'] }),
    ];
    const { stages } = buildTermIndexMap(ordered);
    const labels = stages[0].concepts.map((c) => c.label);
    // 甲出现 3 章、乙 2 章、丙 1 章
    expect(labels).toEqual(['甲', '乙', '丙']);
  });

  it('importance = min(5, 出现章节数)', () => {
    const manySections = Array.from({ length: 7 }, (_, i) =>
      section(`sec_${i + 1}`, i * 60_000, `章节${i}`, { terms: ['跨章术语'] }),
    );
    const { stages } = buildTermIndexMap(manySections);
    const term = stages[0].concepts[0];
    expect(term.importance).toBe(5);
    const two = buildTermIndexMap(sections).stages[0].concepts[0];
    expect(two.importance).toBe(2);
  });

  it('空 sections：stages 为空数组（degraded: true）', () => {
    const { stages, degraded } = buildTermIndexMap([]);
    expect(degraded).toBe(true);
    expect(stages).toEqual([]);
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


describe('resolveFlows 端点归一化（冒烟 3b 三轮：模型抄了清单编号前缀）', () => {
  const stages: ConceptStage[] = [
    {
      id: 'st_01',
      label: '题型识别与基础理论',
      concepts: [
        { id: 'cm_0001', label: '立体视图判定', importance: 5, anchors: [], primaryAnchorTMs: -1, details: [] },
        { id: 'cm_0002', label: '实线含义', importance: 4, anchors: [], primaryAnchorTMs: -1, details: [] },
        { id: 'cm_0003', label: '虚线含义', importance: 4, anchors: [], primaryAnchorTMs: -1, details: [] },
      ],
    },
    {
      id: 'st_02',
      label: '真题实战演练',
      concepts: [
        { id: 'cm_0004', label: '正面平视图判断', importance: 4, anchors: [], primaryAnchorTMs: -1, details: [] },
      ],
    },
  ];

  it('回归：qwen3.5-flash 实际输出——from/to 带 "S1-2 " 编号前缀也能解析', () => {
    const raw = {
      flows: [
        { from: 'S1-2 实线含义', to: 'S3-1 正面平视图判断', label: '应用' },
        { from: 'S1-3 虚线含义', to: 'S3-1 正面平视图判断', label: '应用' },
      ],
    };
    const out = resolveFlows(raw.flows, stages);
    expect(out).toBeDefined();
    expect(out).toHaveLength(2);
    expect(out![0]).toMatchObject({ fromId: 'cm_0002', toId: 'cm_0004', label: '应用' });
    expect(out![1]).toMatchObject({ fromId: 'cm_0003', toId: 'cm_0004' });
  });

  it('常见编号/项目符号前缀都被剥掉；裸 label 不受影响', () => {
    const cases = [
      ['1. 实线含义', 'cm_0002'],
      ['1、实线含义', 'cm_0002'],
      ['1) 实线含义', 'cm_0002'],
      ['- 实线含义', 'cm_0002'],
      ['实线含义', 'cm_0002'],
    ] as const;
    for (const [from, id] of cases) {
      const out = resolveFlows([{ from, to: '虚线含义' }], stages);
      expect(out?.[0]?.fromId).toBe(id);
    }
  });

  it('剥前缀后仍不匹配（编造概念）→ 照旧丢弃', () => {
    expect(resolveFlows([{ from: 'S9-9 不存在的概念', to: '实线含义' }], stages)).toBeUndefined();
  });
});
