/**
 * 导入笔记映射单测（SPEC-09 9.6 / 验收 A8 的数据部分）。
 * 覆盖：归位到本地章节、importedFrom 标记、id 防碰撞（不覆盖已有笔记）。
 */
import { describe, expect, it } from 'vitest';
import { mapImportedNotes } from '../../../src/panel/notes/notesLoader';
import type { VscOutlineFile } from '../../../src/core/exchange/vscOutline';
import type { Section } from '../../../src/types';

const DURATION = 600_000;

const file: VscOutlineFile = {
  format: 'vsc-outline',
  version: '1.0',
  exportedAt: '2026-10-01T11:00:00.000Z',
  exporter: { app: 'video-study-copilot', appVersion: '0.1.0' },
  video: {
    platform: 'bilibili',
    bvid: 'BV1X',
    page: 1,
    cid: 1,
    title: '图形推理速通',
    durationMs: DURATION,
    url: 'https://www.bilibili.com/video/BV1X?p=1',
  },
  outline: {
    promptVersion: '0.2.1',
    model: 'qwen-vl-plus',
    sections: [
      {
        id: 'sec_0001',
        title: '图形推理的观察方法',
        startMs: 0,
        endMs: 312_000,
        summary: '先观察再推理。',
        bullets: [
          { id: 'sec_0001-b1', text: '先观察再推理', startMs: 45_000 },
        ],
        terms: ['观察法'],
        importance: 4,
      },
    ],
  },
  notes: [
    {
      id: 'n_peer1',
      anchor: { kind: 'bullet', sectionId: 'sec_0001', bulletId: 'sec_0001-b1', tMs: 45_000 },
      body: '同行的笔记：先看整体形状',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      replies: [],
    },
    {
      id: 'n_peer2',
      anchor: { kind: 'time', sectionId: null, tMs: 400_000 },
      body: '同行的未归位笔记',
      createdAt: '2026-10-01T10:01:00.000Z',
      updatedAt: '2026-10-01T10:01:00.000Z',
      replies: [
        { id: 'r1', author: 'assistant', body: '助教回答', createdAt: '2026-10-01T10:02:00.000Z' },
      ],
    },
  ],
  checksum: 'sha256:' + '0'.repeat(64),
};

const localSections: Section[] = [
  {
    id: 'lsec_1',
    title: '观察方法（本地重生成版）',
    startMs: 0,
    endMs: 200_000,
    summary: '',
    bullets: [{ text: '先观察再推理（更新）', startMs: 46_000 }],
    terms: [],
    importance: 3,
    density: 'mid',
    cueRange: [0, 0],
  },
  {
    id: 'lsec_2',
    title: '其他',
    startMs: 200_000,
    endMs: DURATION,
    summary: '',
    bullets: [],
    terms: [],
    importance: 3,
    density: 'mid',
    cueRange: [0, 0],
  },
];

describe('mapImportedNotes（A8 数据部分）', () => {
  it('bullet 锚点按 tMs+文本相似度归位到本地章节', () => {
    const mapped = mapImportedNotes(file, localSections, DURATION, new Set());
    const peer1 = mapped.find((n) => n.id === 'n_peer1')!;
    expect(peer1.anchor.sectionId).toBe('lsec_1');
    expect(peer1.anchor.kind).toBe('bullet');
    expect(peer1.anchor.bulletId).toBe('lsec_1-b1');
  });

  it('全部标记 importedFrom（导出方 + 时间）', () => {
    const mapped = mapImportedNotes(file, localSections, DURATION, new Set());
    for (const n of mapped) {
      expect(n.importedFrom).toEqual({ exporter: 'video-study-copilot', exportedAt: '2026-10-01T11:00:00.000Z' });
      expect(n.videoId).toBe('BV1X_p1');
    }
  });

  it('id 防碰撞：与本地已有 id 冲突时加序号后缀，不覆盖', () => {
    const mapped = mapImportedNotes(file, localSections, DURATION, new Set(['n_peer1']));
    expect(mapped.some((n) => n.id === 'n_peer1')).toBe(false);
    expect(mapped.some((n) => n.id === 'n_peer1~2')).toBe(true);
    // 未冲突的保持原 id
    expect(mapped.some((n) => n.id === 'n_peer2')).toBe(true);
  });

  it('回复串完整透传（author=assistant）', () => {
    const mapped = mapImportedNotes(file, localSections, DURATION, new Set());
    const peer2 = mapped.find((n) => n.id === 'n_peer2')!;
    expect(peer2.replies).toHaveLength(1);
    expect(peer2.replies[0].author).toBe('assistant');
  });

  it('落不上的（tMs 越界）保持未归位，不丢弃', () => {
    const outOfRange: VscOutlineFile = {
      ...file,
      notes: [
        {
          id: 'n_out',
          anchor: { kind: 'time', sectionId: null, tMs: DURATION + 10_000 },
          body: '越界',
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:00:00.000Z',
          replies: [],
        },
      ],
    };
    const mapped = mapImportedNotes(outOfRange, localSections, DURATION, new Set());
    expect(mapped).toHaveLength(1);
    expect(mapped[0].anchor.sectionId).toBeNull();
  });
});
