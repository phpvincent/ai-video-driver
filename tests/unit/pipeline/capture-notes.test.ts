/**
 * 大纲笔记区块单测（SPEC-09 9.7 / 验收 A9 的算法部分）。
 * 覆盖：callout 生成（回链/回复串/导入标记）、标记区块插入与替换、
 * 手写内容保留、未归位段、无笔记时清除旧区块。
 */
import { describe, expect, it } from 'vitest';
import {
  applyNotesToMarkdown,
  buildNotesBlock,
  buildVideoNoteMarkdown,
  NOTES_MARKER_END,
  notesMarkerStart,
  noteToCalloutLines,
  UNANCHORED_MARKER_ID,
} from '../../../src/core/pipeline/capture';
import type { OutlineNote, Section, VideoMeta } from '../../../src/types';

const meta: VideoMeta = {
  videoId: 'BV1X_p1',
  bvid: 'BV1X',
  page: 1,
  cid: 1,
  title: '图形推理速通',
  durationMs: 600_000,
  url: 'https://www.bilibili.com/video/BV1X?p=1',
};

const sections: Section[] = [
  {
    id: 'sec_0001',
    title: '图形推理的观察方法',
    startMs: 0,
    endMs: 300_000,
    summary: '先观察再推理。',
    bullets: [{ text: '先观察再推理', startMs: 45_000 }],
    terms: ['观察法'],
    importance: 4,
    score: 87,
    density: 'high',
    cueRange: [0, 99],
  },
  {
    id: 'sec_0002',
    title: '对称与数量关系',
    startMs: 300_000,
    endMs: 600_000,
    summary: '对称轴与数量。',
    bullets: [{ text: '对称轴判定', startMs: 320_000 }],
    terms: [],
    importance: 3,
    density: 'mid',
    cueRange: [100, 200],
  },
];

const note = (over: Partial<OutlineNote> = {}): OutlineNote => ({
  id: 'n_0001',
  videoId: meta.videoId,
  anchor: { kind: 'section', sectionId: 'sec_0001', tMs: 45_000 },
  body: '先观察再推理，考场上容易跳过观察这步',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  replies: [],
  ...over,
});

describe('noteToCalloutLines / buildNotesBlock', () => {
  it('单条笔记：回链 + 正文；回复串 我/助教', () => {
    const lines = noteToCalloutLines(
      meta,
      note({
        replies: [
          { id: 'r1', author: 'self', body: '对称和数量怎么区分？', createdAt: '2026-10-01T00:00:01.000Z' },
          { id: 'r2', author: 'assistant', body: '先看是否有镜像轴。', createdAt: '2026-10-01T00:00:02.000Z' },
        ],
      }),
    );
    expect(lines[0]).toBe('> **[00:45](https://www.bilibili.com/video/BV1X?p=1&t=45)** 先观察再推理，考场上容易跳过观察这步');
    expect(lines[1]).toBe('> - 我：对称和数量怎么区分？');
    expect(lines[2]).toBe('> - 助教：先看是否有镜像轴。');
  });

  it('导入笔记带（导入）标记；多行正文逐行 > 前缀', () => {
    const lines = noteToCalloutLines(
      meta,
      note({
        body: '第一行\n第二行',
        importedFrom: { exporter: 'peer@vsc', exportedAt: '2026-10-01T00:00:00.000Z' },
      }),
    );
    expect(lines[0]).toContain('（导入）');
    expect(lines[1]).toBe('> 第二行');
  });

  it('区块 = marker 包裹 + 可折叠 callout 头；无笔记返回 null', () => {
    const block = buildNotesBlock(meta, 'sec_0001', [note()]);
    expect(block).not.toBeNull();
    expect(block!.startsWith(notesMarkerStart('sec_0001'))).toBe(true);
    expect(block!.endsWith(NOTES_MARKER_END)).toBe(true);
    expect(block!).toContain('> [!note]- 我的笔记（1）');
    expect(buildNotesBlock(meta, 'sec_0001', [])).toBeNull();
  });
});

describe('applyNotesToMarkdown（A9 算法：手写保留 + 区块更新）', () => {
  const fresh = buildVideoNoteMarkdown({ meta, sections, sourceVideoId: meta.videoId }).markdown;

  it('空笔记文件：区块插到章节标题后', () => {
    const out = applyNotesToMarkdown(fresh, meta, sections, [note()]);
    expect(out).toContain(notesMarkerStart('sec_0001'));
    // 区块紧跟章节标题（标题行 → 空行 → 区块）
    const headingIdx = out.split('\n').findIndex((l) => l.includes('图形推理的观察方法'));
    const lines = out.split('\n');
    expect(lines.slice(headingIdx + 1, headingIdx + 3).join('\n')).toBe(
      `\n${notesMarkerStart('sec_0001')}`,
    );
  });

  it('手写内容保留：标记外的一切行原样（A9 核心）', () => {
    const withNotes = applyNotesToMarkdown(fresh, meta, sections, [note()]);
    // 模拟用户在 Obsidian 手写一段（标记外）
    const handwritten = `${withNotes}\n\n## 我的补充\n\n这是我手写的复习心得。\n`;
    // 再次导出（笔记变化：新增一条）
    const again = applyNotesToMarkdown(handwritten, meta, sections, [
      note(),
      note({ id: 'n_0002', anchor: { kind: 'time', sectionId: 'sec_0002', tMs: 320_000 }, body: '第二条' }),
    ]);
    expect(again).toContain('这是我手写的复习心得。');
    expect(again).toContain('## 我的补充');
    expect(again).toContain('第二条');
    expect(again).toContain(notesMarkerStart('sec_0002'));
    // 旧区块被替换而非堆积：sec_0001 的 marker 只出现一次
    expect(again.split(notesMarkerStart('sec_0001')).length - 1).toBe(1);
  });

  it('区块删除：无笔记时旧区块被清除，其余不动', () => {
    const withNotes = applyNotesToMarkdown(fresh, meta, sections, [note()]);
    const cleared = applyNotesToMarkdown(withNotes, meta, sections, []);
    expect(cleared).not.toContain('vsc:notes:start');
    expect(cleared).toContain('## 00:00-05:00 图形推理的观察方法');
  });

  it('未归位与章节缺失的笔记 → 文末「未归位的笔记」', () => {
    const out = applyNotesToMarkdown(fresh, meta, sections, [
      note({ anchor: { kind: 'time', sectionId: null, tMs: 500_000 } }),
      note({ id: 'n_gone', anchor: { kind: 'section', sectionId: 'sec_deleted', tMs: 10_000 }, body: '章节已消失的笔记' }),
    ]);
    expect(out).toContain('## 未归位的笔记');
    expect(out).toContain(notesMarkerStart(UNANCHORED_MARKER_ID));
    expect(out).toContain('章节已消失的笔记');
  });

  it('笔记全部归位时无未归位段', () => {
    const out = applyNotesToMarkdown(fresh, meta, sections, [note()]);
    expect(out).not.toContain('## 未归位的笔记');
  });
});
