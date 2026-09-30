/**
 * 导图 Tab 单元测试（SPEC-04 二次迭代：HTML 知识卡片流）。
 * 环境为 node 且无 DOM：纯函数（buildMindmapMarkdown / parseNodeTimestamp /
 * findActiveSectionIndex / matchConcepts〔精确匹配〕/ importanceBadge /
 * isTermIndexData / formatRange / shortenLabel）直接断言；
 * 组件渲染只覆盖无 effect 分支（markmap / 滚动聚焦均为 effect 内动态行为，
 * renderToString 不触发；概念卡片流为纯 HTML，渲染期可跑）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shortenLabel } from '../../../src/core/pipeline/conceptMap';
import type { ConceptMapData, ConceptNode, Section } from '../../../src/types';
import {
  CHRONO_VIEW_LABEL,
  CONCEPT_DEGRADED_TEXT,
  CONCEPT_DETAILS_TOGGLE_TEXT,
  CONCEPT_FALLBACK_HINT,
  CONCEPT_MODEL_HINT,
  CONCEPT_RETRY_TEXT,
  CONCEPT_VIEW_LABEL,
  MINDMAP_EMPTY_ACTION_TEXT,
  MINDMAP_EMPTY_TEXT,
  MINDMAP_ROOT_TEXT,
  MindmapEmptyGuide,
  MindmapTab,
  buildMindmapMarkdown,
  findActiveSectionIndex,
  formatDomainIndex,
  formatRange,
  importanceBadge,
  isTermIndexData,
  matchConcepts,
  orderDomainsByEarliestAnchor,
  parseNodeTimestamp,
  sectionHeadingText,
} from '../../../src/panel/MindmapTab';

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
  section('sec_0001', 0, 60_000, '开场与环境准备', { score: 85, terms: ['上下文窗口', 'Token'] }),
  section('sec_0002', 60_000, 180_000, '核心概念讲解', { score: 60, density: 'high', terms: ['注意力机制', '上下文窗口'] }),
  section('sec_0003', 180_000, 300_000, '实战演示', { terms: ['注意力机制'] }),
];

/** 概念图测试树：根 → 域（基础概念）→ 概念（上下文窗口〔带细节〕/ Token） */
const conceptRoot = (): ConceptNode => ({
  id: 'cm_root',
  label: '大模型入门',
  kind: 'domain',
  importance: 5,
  anchors: [],
  children: [
    {
      id: 'cm_0001',
      label: '基础概念',
      kind: 'domain',
      importance: 5,
      anchors: [],
      children: [
        {
          id: 'cm_0002',
          label: '上下文窗口',
          kind: 'concept',
          importance: 5,
          anchors: [
            { tMs: 0, sectionId: 'sec_0001' },
            { tMs: 60_000, sectionId: 'sec_0002' },
          ],
          children: [
            {
              id: 'cm_0004',
              label: '决定单次可见文本量',
              kind: 'detail',
              importance: 5,
              anchors: [],
              children: [],
            },
          ],
        },
        {
          id: 'cm_0003',
          label: 'Token',
          kind: 'concept',
          importance: 4,
          anchors: [{ tMs: 0, sectionId: 'sec_0001' }],
          children: [],
        },
      ],
    },
  ],
});

/** 缓存注入用的 ConceptMapData 包装 */
const mapData = (root: ConceptNode, model = 'test-model'): ConceptMapData => ({
  videoId: 'bv1x_p1',
  promptVersion: '0.1.0',
  model,
  root,
  generatedAt: '2026-09-30T00:00:00.000Z',
});

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

describe('matchConcepts（概念跟随命中，二次迭代：精确匹配）', () => {
  it('当前章节 terms 与概念 label 归一化后相等才命中', () => {
    expect(matchConcepts(sections, 0, conceptRoot())).toEqual(['上下文窗口', 'Token']);
  });

  it('跨章合并：第一章只命中该章出现的概念', () => {
    expect(matchConcepts(sections, 60_000, conceptRoot())).toEqual(['上下文窗口']);
    expect(matchConcepts(sections, 200_000, conceptRoot())).toEqual([]);
  });

  it('大小写不敏感：术语与 label 大小写不同仍精确命中', () => {
    const root: ConceptNode = {
      ...conceptRoot(),
      children: [
        {
          ...conceptRoot().children[0],
          children: [
            { id: 'cm_x', label: 'Context Window', kind: 'concept', importance: 3, anchors: [], children: [] },
          ],
        },
      ],
    };
    const secs = [section('s1', 0, 1000, '开场', { terms: ['CONTEXT window'] })];
    expect(matchConcepts(secs, 0, root)).toEqual(['Context Window']);
  });

  it('精确匹配（正向）：term="token" 命中 label="token"', () => {
    const root: ConceptNode = {
      ...conceptRoot(),
      children: [
        {
          ...conceptRoot().children[0],
          children: [
            { id: 'cm_x', label: 'token', kind: 'concept', importance: 3, anchors: [], children: [] },
          ],
        },
      ],
    };
    const secs = [section('s1', 0, 1000, '开场', { terms: ['token'] })];
    expect(matchConcepts(secs, 0, root)).toEqual(['token']);
  });

  it('精确匹配（反向，必须）：term="token" 不命中 label="token 长度"（substring 过松已修复）', () => {
    const root: ConceptNode = {
      ...conceptRoot(),
      children: [
        {
          ...conceptRoot().children[0],
          children: [
            { id: 'cm_x', label: 'token 长度', kind: 'concept', importance: 3, anchors: [], children: [] },
          ],
        },
      ],
    };
    const secs = [section('s1', 0, 1000, '开场', { terms: ['token'] })];
    expect(matchConcepts(secs, 0, root)).toEqual([]);
  });

  it('精确匹配（反向）：term 比概念 label 长也不命中（如 term="上下文窗口详解" ≠ label="上下文窗口"）', () => {
    const secs = [section('s1', 0, 1000, '任意标题', { terms: ['上下文窗口详解'] })];
    expect(matchConcepts(secs, 0, conceptRoot())).toEqual([]);
  });

  it('精确匹配（反向）：章节标题含概念 label 但 terms 不含 → 不命中（标题不再参与）', () => {
    const secs = [section('s1', 0, 1000, '上下文窗口详解')];
    expect(matchConcepts(secs, 0, conceptRoot())).toEqual([]);
  });

  it('label 两侧空白不参与比较（trim 归一化）', () => {
    const root: ConceptNode = {
      ...conceptRoot(),
      children: [
        {
          ...conceptRoot().children[0],
          children: [
            { id: 'cm_x', label: '  Token  ', kind: 'concept', importance: 3, anchors: [], children: [] },
          ],
        },
      ],
    };
    const secs = [section('s1', 0, 1000, '开场', { terms: ['Token'] })];
    expect(matchConcepts(secs, 0, root)).toEqual(['  Token  ']);
  });

  it('positionMs 早于首章或空 sections 返回空数组', () => {
    expect(matchConcepts([], 0, conceptRoot())).toEqual([]);
    const late = [section('s1', 5_000, 10_000, '晚开始')];
    expect(matchConcepts(late, 4_999, conceptRoot())).toEqual([]);
  });
});

describe('importanceBadge（重要度文字徽标，替换圆点）', () => {
  it('5 → 核心；4 → 重要', () => {
    expect(importanceBadge(5)).toBe('核心');
    expect(importanceBadge(4)).toBe('重要');
  });

  it('3 → 常用；2/1 → 了解（其他）', () => {
    expect(importanceBadge(3)).toBe('常用');
    expect(importanceBadge(2)).toBe('了解');
    expect(importanceBadge(1)).toBe('了解');
  });
});

describe('isTermIndexData（降级数据判定约定）', () => {
  it('model="term-index" 或根 label="术语关联图" 判为降级', () => {
    expect(isTermIndexData(mapData(conceptRoot(), 'term-index'))).toBe(true);
    const termRoot: ConceptNode = { ...conceptRoot(), label: '术语关联图' };
    expect(isTermIndexData(mapData(termRoot))).toBe(true);
  });

  it('模型生成的正常图不误判', () => {
    expect(isTermIndexData(mapData(conceptRoot()))).toBe(false);
  });
});

describe('formatRange', () => {
  it('单时间点 → mm:ss', () => {
    expect(formatRange(0)).toBe('00:00');
    expect(formatRange(125_000)).toBe('02:05');
  });

  it('区间 → mm:ss-mm:ss', () => {
    expect(formatRange(0, 60_000)).toBe('00:00-01:00');
  });
});

// ---------------------------------------------------------------------------
// 三次迭代：知识路径（流程感）
// ---------------------------------------------------------------------------

/** 多域测试树：进阶主题（最早锚 60s）/ 基础概念（最早锚 0s，含无锚域的后续域）/ 附录域（无锚） */
const multiDomainRoot = (): ConceptNode => ({
  id: 'cm_root',
  label: '大模型入门',
  kind: 'domain',
  importance: 5,
  anchors: [],
  children: [
    {
      id: 'd_adv',
      label: '进阶主题',
      kind: 'domain',
      importance: 4,
      anchors: [],
      children: [
        {
          id: 'c_attn',
          label: '注意力机制',
          kind: 'concept',
          importance: 5,
          anchors: [{ tMs: 60_000, sectionId: 'sec_0002' }],
          children: [],
        },
      ],
    },
    {
      id: 'd_base',
      label: '基础概念',
      kind: 'domain',
      importance: 5,
      anchors: [],
      children: [
        {
          id: 'c_ctx',
          label: '上下文窗口',
          kind: 'concept',
          importance: 5,
          anchors: [
            { tMs: 0, sectionId: 'sec_0001' },
            { tMs: 120_000, sectionId: 'sec_0002' },
          ],
          children: [],
        },
        {
          id: 'c_tok',
          label: 'Token',
          kind: 'concept',
          importance: 4,
          anchors: [{ tMs: 30_000, sectionId: 'sec_0001' }],
          children: [],
        },
      ],
    },
    {
      id: 'd_none',
      label: '附录域',
      kind: 'domain',
      importance: 2,
      anchors: [],
      children: [
        { id: 'c_x', label: '无锚概念', kind: 'concept', importance: 2, anchors: [], children: [] },
      ],
    },
  ],
});

describe('orderDomainsByEarliestAnchor（三次迭代：域按最早锚排序）', () => {
  it('按各域内所有概念 anchors 的最早 tMs 升序排序，无锚域垫后', () => {
    const ordered = orderDomainsByEarliestAnchor(multiDomainRoot());
    expect(ordered.map((d) => d.label)).toEqual(['基础概念', '进阶主题', '附录域']);
  });

  it('概念多锚时取域内最早（d_base 最早锚 = 上下文窗口的 0，而非 Token 的 30s）', () => {
    const ordered = orderDomainsByEarliestAnchor(multiDomainRoot());
    expect(ordered[0].id).toBe('d_base');
  });

  it('无锚域排最后并保持原相对顺序（稳定排序）', () => {
    const noAnchor = (id: string, label: string): ConceptNode => ({
      id,
      label,
      kind: 'domain',
      importance: 2,
      anchors: [],
      children: [],
    });
    const anchored: ConceptNode = {
      id: 'd_late',
      label: '晚出现',
      kind: 'domain',
      importance: 3,
      anchors: [],
      children: [
        { id: 'c_l', label: '晚概念', kind: 'concept', importance: 3, anchors: [{ tMs: 500_000, sectionId: 's' }], children: [] },
      ],
    };
    const root: ConceptNode = {
      id: 'cm_root',
      label: '根',
      kind: 'domain',
      importance: 3,
      anchors: [],
      children: [noAnchor('d_a', '甲'), anchored, noAnchor('d_b', '乙'), noAnchor('d_c', '丙')],
    };
    expect(orderDomainsByEarliestAnchor(root).map((d) => d.id)).toEqual([
      'd_late',
      'd_a',
      'd_b',
      'd_c',
    ]);
  });

  it('只取 kind=domain 的 children（根的虚拟属性不参与）', () => {
    const ordered = orderDomainsByEarliestAnchor(multiDomainRoot());
    expect(ordered.every((d) => d.kind === 'domain')).toBe(true);
    expect(ordered).toHaveLength(3);
  });
});

describe('formatDomainIndex（域序号徽标）', () => {
  it("0 → '01'；9 → '10'；10 → '11'（两位数字符串）", () => {
    expect(formatDomainIndex(0)).toBe('01');
    expect(formatDomainIndex(9)).toBe('10');
    expect(formatDomainIndex(10)).toBe('11');
  });
});

describe('知识路径渲染（renderToString：序号徽标 / 连接线 / rail / 当前域）', () => {
  const noop = () => {};

  it('多域卡片按排序渲染序号徽标 01/02/03，域间连接线 kp-connector 为 N-1 个（首卡无）', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        conceptMap: mapData(multiDomainRoot()),
      }),
    );
    expect(html).toContain('cm-domain-index');
    expect(html).toContain('>01<');
    expect(html).toContain('>02<');
    expect(html).toContain('>03<');
    // 3 张卡 → 2 条连接线（首卡上方无）
    expect((html.match(/kp-connector/g) ?? []).length).toBe(2);
  });

  it('rail：有锚概念行渲染 cm-rail-dot，title 为第一个锚点时间（语义圆点，hover 显示）', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        conceptMap: mapData(multiDomainRoot()),
      }),
    );
    expect(html).toContain('cm-rail-dot');
    // 上下文窗口（第一个锚点 tMs=0）与 Token（tMs=30s）与 注意力机制（tMs=60s）
    expect(html).toContain('首次出现 00:00');
    expect(html).toContain('首次出现 00:30');
    expect(html).toContain('首次出现 01:00');
    // 无锚概念不渲染语义圆点的 title
    expect(html).not.toContain('首次出现 undefined');
  });

  it('当前域高亮：positionMs 命中的概念所在域卡带 domain-current', () => {
    const secs = [section('s1', 60_000, 120_000, '进阶章', { terms: ['注意力机制'] })];
    const html = renderToString(
      createElement(MindmapTab, {
        sections: secs,
        positionMs: 60_000,
        onRequestSeek: noop,
        conceptMap: mapData(multiDomainRoot()),
      }),
    );
    expect((html.match(/domain-current/g) ?? []).length).toBe(1);
    // 高亮卡 = 注意力机制所在的"进阶主题"卡
    const idx = html.indexOf('cm-card domain-current');
    expect(idx).toBeGreaterThan(-1);
    expect(html.slice(idx).indexOf('进阶主题')).toBeLessThan(html.slice(idx).indexOf('</header>'));
  });

  it('无概念命中时无 domain-current（不命中不亮）', () => {
    const secs = [section('s1', 60_000, 120_000, '无关章', { terms: ['完全无关的术语'] })];
    const html = renderToString(
      createElement(MindmapTab, {
        sections: secs,
        positionMs: 60_000,
        onRequestSeek: noop,
        conceptMap: mapData(multiDomainRoot()),
      }),
    );
    expect(html).not.toContain('domain-current');
  });
});

describe('MindmapTab 渲染冒烟（renderToString，仅无 effect 分支）', () => {
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
    expect(html).toContain(CONCEPT_VIEW_LABEL);
    expect(html).toContain(CHRONO_VIEW_LABEL);
  });

  it('传 onGoOutline 时渲染引导按钮', () => {
    const html = renderToString(
      createElement(MindmapEmptyGuide, { onGoOutline: noop }),
    );
    expect(html).toContain(MINDMAP_EMPTY_TEXT);
    expect(html).toContain(MINDMAP_EMPTY_ACTION_TEXT);
    expect(html).toContain('<button');
  });

  it('无 generateConceptMap 接线且有 sections：降级渲染本地术语关联图（卡片流 + 降级横幅，无 SVG）', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
      }),
    );
    // 二次迭代：卡片流为纯 HTML，概念视图不含 SVG
    expect(html).not.toContain('<svg');
    // 降级横幅（未接线文案，无重试按钮）
    expect(html).toContain('cm-degraded-banner');
    expect(html).toContain(CONCEPT_FALLBACK_HINT);
    expect(html).not.toContain(CONCEPT_RETRY_TEXT);
    // 概念卡：域名 + 概念名 + 概念数徽标（卡片流默认展开显示概念）
    expect(html).toContain('核心术语');
    expect(html).toContain('上下文窗口');
    expect(html).toContain('3 概念');
  });

  it('有 generateConceptMap 且未就绪：显示模型配置引导', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        generateConceptMap: async () => {},
        modelReady: false,
      }),
    );
    expect(html).toContain(CONCEPT_MODEL_HINT);
    expect(html).not.toContain('<svg');
  });

  it('缓存命中（conceptMap 注入）：渲染概念卡（域名 + 概念名 + 徽标），无降级横幅', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        conceptMap: mapData(conceptRoot()),
      }),
    );
    // 概念卡渲染域名与概念名（卡片流默认全部可见）
    expect(html).toContain('基础概念');
    expect(html).toContain('上下文窗口');
    expect(html).toContain('Token');
    expect(html).toContain('2 概念');
    // 正常图无降级横幅
    expect(html).not.toContain('cm-degraded-banner');
    expect(html).not.toContain(CONCEPT_DEGRADED_TEXT);
    // 重要度文字徽标（替换圆点）：5 → 核心、4 → 重要
    expect(html).toContain('核心');
    expect(html).toContain('重要');
    expect(html).not.toContain('<svg');
  });

  it('降级图（model=term-index 约定）：显示降级横幅 + 重试按钮（调 generateConceptMap）', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        generateConceptMap: async () => {},
        modelReady: true,
        conceptMap: mapData(conceptRoot(), 'term-index'),
      }),
    );
    expect(html).toContain('cm-degraded-banner');
    expect(html).toContain(CONCEPT_DEGRADED_TEXT);
    expect(html).toContain('cm-retry-btn');
    expect(html).toContain(CONCEPT_RETRY_TEXT);
  });

  it('props.degraded=true（App 生成 catch 路径设置）：即使数据无约定标记也显示降级横幅', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        generateConceptMap: async () => {},
        modelReady: true,
        conceptMap: mapData(conceptRoot()),
        degraded: true,
      }),
    );
    expect(html).toContain('cm-degraded-banner');
    expect(html).toContain(CONCEPT_DEGRADED_TEXT);
  });

  it('details 折叠区默认收起：有"细节 ▸"切换且无 open 类（grid 0fr/1fr 过渡）', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        conceptMap: mapData(conceptRoot()),
      }),
    );
    expect(html).toContain(CONCEPT_DETAILS_TOGGLE_TEXT);
    expect(html).toContain('cm-details-collapse');
    expect(html).not.toContain('cm-details-collapse open');
  });

  it('时间 chips：概念锚点渲染 [mm:ss] 小按钮', () => {
    const html = renderToString(
      createElement(MindmapTab, {
        sections,
        positionMs: 0,
        onRequestSeek: noop,
        conceptMap: mapData(conceptRoot()),
      }),
    );
    expect(html).toContain('cm-chip');
    expect(html).toContain('[00:00]');
    expect(html).toContain('[01:00]');
  });

  it('shortenLabel 复用（panel 与 pipeline 共用同一实现）', () => {
    expect(shortenLabel('一二三四五六七八九十一二三')).toBe('一二三四五六七八九十一…');
    expect(shortenLabel('上下文窗口')).toBe('上下文窗口');
  });
});
