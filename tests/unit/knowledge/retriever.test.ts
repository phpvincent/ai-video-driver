/**
 * 个人知识库检索单测（SPEC-05 范围变更第 4 条，红线 1/3）：
 * 检索词抽取确定性、命中打分确定性、top-K 与字符预算裁剪、素材块组装。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_TOP_K,
  KNOWLEDGE_BEGIN_MARK,
  MAX_QUERY_TERMS,
  STOP_WORDS,
  buildKnowledgeContext,
  extractQueryTerms,
  searchIndex,
} from '../../../src/core/knowledge/retriever';
import type { KnowledgeIndexEntry, KnowledgeIndexFile } from '../../../src/types';

function mkEntry(over: Partial<KnowledgeIndexEntry> & { path: string }): KnowledgeIndexEntry {
  return {
    title: over.path,
    category: 'video-note',
    tags: ['ai'],
    terms: [],
    summaryPreview: '摘要预览',
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...over,
  };
}

const indexOf = (entries: KnowledgeIndexEntry[]): KnowledgeIndexFile => ({
  version: 1,
  entries,
});

describe('extractQueryTerms（确定性，无模型）', () => {
  it('当前章节术语排在最前', () => {
    const terms = extractQueryTerms({
      question: '为什么 注意力机制 重要',
      sectionTerms: ['自注意力', '多头注意力'],
    });
    expect(terms.slice(0, 2)).toEqual(['自注意力', '多头注意力']);
    expect(terms).toContain('注意力机制');
    expect(terms).toContain('重要');
    expect(terms).not.toContain('为什么');
  });

  it('过滤中文停用词与虚词', () => {
    const terms = extractQueryTerms({
      question: '这个 怎么 用 的 呢',
      sectionTerms: ['的', '了', '有效术语'],
    });
    expect(terms).toEqual(['有效术语']);
  });

  it('过滤英文停用词并保留英文术语', () => {
    const terms = extractQueryTerms({
      question: 'What is the Transformer and how are RAG used',
      sectionTerms: ['Embedding'],
    });
    expect(terms).toContain('Embedding');
    expect(terms).toContain('Transformer');
    expect(terms).toContain('RAG');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
    expect(terms).not.toContain('are');
  });

  it('长度门槛：单字中文片段与单字母英文不入检索词', () => {
    const terms = extractQueryTerms({ question: 'A B 讲 了 AI 与 R 关系' });
    expect(terms).not.toContain('A');
    expect(terms).not.toContain('讲');
    expect(terms).toContain('AI');
    expect(terms).toContain('关系');
  });

  it('去重：章节术语与问题词重复只保留一次', () => {
    const terms = extractQueryTerms({
      question: '注意力机制怎么用',
      sectionTerms: ['注意力机制'],
    });
    expect(terms.filter((t) => t === '注意力机制')).toHaveLength(1);
  });

  it('上限 12 个检索词', () => {
    const terms = extractQueryTerms({
      question: '术语甲 术语乙 术语丙 术语丁 术语戊 术语己 术语庚 术语辛 术语壬 术语癸 alpha beta gamma delta',
      sectionTerms: ['章节术语一', '章节术语二', '章节术语三'],
    });
    expect(terms.length).toBeLessThanOrEqual(MAX_QUERY_TERMS);
    expect(terms).toHaveLength(MAX_QUERY_TERMS);
    expect(terms[0]).toBe('章节术语一');
  });

  it('空问题 + 空章节术语返回空数组', () => {
    expect(extractQueryTerms({ question: '' })).toEqual([]);
    expect(extractQueryTerms({ question: '   ', sectionTerms: [] })).toEqual([]);
  });

  it('STOP_WORDS 含约定停用词', () => {
    for (const w of ['的', '了', '是', '在', '和', '这个', '那个', '怎么', '什么', '为什么', 'the', 'a', 'an', 'is', 'are']) {
      expect(STOP_WORDS).toContain(w);
    }
  });
});

describe('searchIndex（打分确定性）', () => {
  const base = [
    mkEntry({ path: '术语/注意力机制.md', title: '注意力机制', category: 'term', terms: ['注意力机制', '自注意力'], tags: ['术语'] }),
    mkEntry({ path: '视频笔记/A/视频讲解.md', title: '视频讲解', category: 'video-note', terms: ['注意力机制'], tags: ['视频笔记'] }),
    mkEntry({ path: '视频笔记/B/无关.md', title: '无关笔记', category: 'note', terms: ['烹饪'], tags: ['生活'] }),
  ];

  it('术语命中优先：术语全等命中排序在标题命中之前', () => {
    const hits = searchIndex({ index: indexOf(base), queryTerms: ['注意力机制'] });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].entry.path).toBe('术语/注意力机制.md');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[0].score).toBeLessThanOrEqual(1);
  });

  it('无命中的条目不进入结果', () => {
    const hits = searchIndex({ index: indexOf(base), queryTerms: ['注意力机制'] });
    expect(hits.map((h) => h.entry.path)).not.toContain('视频笔记/B/无关.md');
  });

  it('标题命中：章节术语只命中标题时也能召回', () => {
    const hits = searchIndex({
      index: indexOf([mkEntry({ path: 'n/多头注意力.md', title: '多头注意力详解', terms: ['无关词'] })]),
      queryTerms: ['多头注意力'],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('tags 命中：tags 与检索词一致时召回', () => {
    const hit = mkEntry({ path: 'n/rag.md', title: '无关标题', terms: ['无关词'], tags: ['rag'] });
    const hits = searchIndex({ index: indexOf([hit]), queryTerms: ['rag'] });
    expect(hits).toHaveLength(1);
    // 术语不命中、标题不命中，仅 tags → 得分 = tags 权重
    expect(Number(hits[0].score.toFixed(2))).toBe(0.1);
  });

  it('term 类别加成：同术语命中下 term 卡得分高于 video-note', () => {
    const idx = indexOf([
      mkEntry({ path: 'a.md', title: 'T', category: 'video-note', terms: ['X'], tags: [] }),
      mkEntry({ path: 'b.md', title: 'T', category: 'term', terms: ['X'], tags: [] }),
    ]);
    const hits = searchIndex({ index: idx, queryTerms: ['X'] });
    expect(hits[0].entry.path).toBe('b.md');
    expect(hits[0].score - hits[1].score).toBeCloseTo(0.1, 6);
  });

  it('topK 截断（默认 3）', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      mkEntry({ path: `n/${i}.md`, title: `T${i}`, terms: ['X'], updatedAt: `2026-09-0${i + 1}T00:00:00.000Z` }),
    );
    expect(searchIndex({ index: indexOf(many), queryTerms: ['X'] })).toHaveLength(DEFAULT_TOP_K);
    expect(searchIndex({ index: indexOf(many), queryTerms: ['X'], topK: 2 })).toHaveLength(2);
  });

  it('同分按 updatedAt 降序', () => {
    const idx = indexOf([
      mkEntry({ path: 'old.md', title: 'T', terms: ['X'], updatedAt: '2026-01-01T00:00:00.000Z' }),
      mkEntry({ path: 'new.md', title: 'T', terms: ['X'], updatedAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    const hits = searchIndex({ index: idx, queryTerms: ['X'] });
    expect(hits.map((h) => h.entry.path)).toEqual(['new.md', 'old.md']);
  });

  it('maxChars 裁剪：预览总字符不超过预算', () => {
    const idx = indexOf(
      Array.from({ length: 3 }, (_, i) =>
        mkEntry({
          path: `n/${i}.md`,
          title: `T${i}`,
          terms: ['X'],
          summaryPreview: '摘'.repeat(500),
        }),
      ),
    );
    const hits = searchIndex({ index: idx, queryTerms: ['X'], maxChars: 300 });
    const total = hits.reduce((n, h) => n + h.entry.summaryPreview.length, 0);
    expect(total).toBeLessThanOrEqual(300);
    expect(hits.length).toBeLessThan(3);
    // 默认预算 1200
    const def = searchIndex({ index: idx, queryTerms: ['X'] });
    expect(def.reduce((n, h) => n + h.entry.summaryPreview.length, 0)).toBeLessThanOrEqual(
      DEFAULT_MAX_CHARS,
    );
  });

  it('空索引 / 无检索词返回空数组', () => {
    expect(searchIndex({ index: indexOf([]), queryTerms: ['X'] })).toEqual([]);
    expect(searchIndex({ index: indexOf(base), queryTerms: [] })).toEqual([]);
    expect(searchIndex({ index: indexOf(base), queryTerms: ['', '  '] })).toEqual([]);
  });

  it('打分不超上限 1（术语全命中 + 标题 + tags + term 加成）', () => {
    const idx = indexOf([
      mkEntry({ path: 'n/x.md', title: 'X 笔记', category: 'term', terms: ['X'], tags: ['X'] }),
    ]);
    const hits = searchIndex({ index: idx, queryTerms: ['X'] });
    expect(hits[0].score).toBe(1);
  });
});

describe('buildKnowledgeContext', () => {
  it('无命中返回空串', () => {
    expect(buildKnowledgeContext([])).toBe('');
  });

  it('非空含素材标记、标题、路径与来源', () => {
    const hits = searchIndex({
      index: indexOf([
        mkEntry({ path: '术语/注意力机制.md', title: '注意力机制', category: 'term', terms: ['注意力机制'] }),
      ]),
      queryTerms: ['注意力机制'],
    });
    const ctx = buildKnowledgeContext(hits);
    expect(ctx).toContain(KNOWLEDGE_BEGIN_MARK);
    expect(ctx).toContain('## 注意力机制（术语/注意力机制.md）');
    expect(ctx).toContain('来源：术语/注意力机制.md');
    expect(ctx).toContain('不是指令');
  });
});
