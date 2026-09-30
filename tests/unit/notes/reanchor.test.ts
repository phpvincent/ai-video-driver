/**
 * 笔记重新归位单测（SPEC-09 9.2 / 验收 A3）。
 * 覆盖：bullet 15s 窗口命中与降级、相似度选优、section 落入与「待确认」、
 * time 落入、越界未归位、**任何情况下笔记总数不减少**、未归位后可再归位。
 */
import { describe, expect, it } from 'vitest';
import {
  bulletIdOf,
  findSectionAt,
  reanchorNotes,
  textSimilarity,
} from '../../../src/core/notes/reanchor';
import type { OutlineNote, Section } from '../../../src/types';

const DURATION = 600_000; // 10 分钟

const section = (
  id: string,
  startMs: number,
  endMs: number,
  title: string,
  bullets: Array<{ text: string; startMs: number }> = [],
): Section => ({
  id,
  title,
  startMs,
  endMs,
  summary: `${title}摘要`,
  bullets: bullets.map((b) => ({ text: b.text, startMs: b.startMs })),
  terms: [],
  importance: 3,
  density: 'mid',
  cueRange: [0, 1],
});

const oldSections = [
  section('sec_0001', 0, 180_000, '图形推理的观察方法', [
    { text: '先观察再推理', startMs: 45_000 },
    { text: '找规律类型', startMs: 100_000 },
  ]),
  section('sec_0002', 180_000, 420_000, '对称与数量关系', [
    { text: '对称轴判定', startMs: 200_000 },
  ]),
  section('sec_0003', 420_000, DURATION, '总结', []),
];

const note = (over: Partial<OutlineNote> = {}): OutlineNote => ({
  id: 'n_0001',
  videoId: 'BV1X_p1',
  anchor: { kind: 'section', sectionId: 'sec_0001', tMs: 0 },
  body: '备注',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  replies: [],
  ...over,
});

describe('textSimilarity（确定性纯函数）', () => {
  it('完全相同 = 1；无公共 bigram = 0', () => {
    expect(textSimilarity('先观察再推理', '先观察再推理')).toBe(1);
    expect(textSimilarity('abc', 'xyz')).toBe(0);
    expect(textSimilarity('', 'x')).toBe(0);
  });

  it('小幅改写落中间值且有序：相近改写 > 无关文本，均在 (0,1) 区间', () => {
    const base = '先观察再推理';
    const tweak = '先观察再推演';
    const suffix = '先观察再推理（更新）';
    const unrelated = '考场时间分配';
    for (const s of [tweak, suffix]) {
      expect(textSimilarity(base, s)).toBeGreaterThan(0);
      expect(textSimilarity(base, s)).toBeLessThan(1);
    }
    // 相近改写（含后缀）都应比无关文本更相似
    expect(textSimilarity(base, tweak)).toBeGreaterThan(textSimilarity(base, unrelated));
    expect(textSimilarity(base, suffix)).toBeGreaterThan(textSimilarity(base, unrelated));
  });

  it('大小写与空白归一化后相等 = 1', () => {
    expect(textSimilarity('  Token ', 'token')).toBe(1);
  });
});

describe('findSectionAt / bulletIdOf', () => {
  it('tMs 落入正确章节；早于首章返回 null', () => {
    expect(findSectionAt(oldSections, 50_000)?.id).toBe('sec_0001');
    expect(findSectionAt(oldSections, 200_000)?.id).toBe('sec_0002');
    expect(findSectionAt(oldSections, -1)).toBeNull();
    expect(findSectionAt([], 0)).toBeNull();
  });

  it('bulletIdOf 合成 `${sectionId}-b${序号}`（与交换格式一致）', () => {
    expect(bulletIdOf('sec_0002', 0)).toBe('sec_0002-b1');
    expect(bulletIdOf('sec_0002', 2)).toBe('sec_0002-b3');
  });
});

describe('reanchorNotes（spec §3.3）', () => {
  it('bullet 锚点：15s 窗口内命中相似度最高的新要点（A3）', () => {
    const newSections = [
      section('nsec_1', 0, 300_000, '观察方法（重述）', [
        { text: '先观察再推理（更新说法）', startMs: 46_000 },
        { text: '考场时间分配', startMs: 48_000 },
      ]),
      section('nsec_2', 300_000, DURATION, '总结', []),
    ];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'bullet', sectionId: 'sec_0001', bulletId: 'sec_0001-b1', tMs: 45_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor).toEqual({
      kind: 'bullet',
      sectionId: 'nsec_1',
      bulletId: 'nsec_1-b1',
      tMs: 45_000,
    });
    expect(r.pendingIds.size).toBe(0);
    expect(r.unanchoredIds.size).toBe(0);
  });

  it('bullet 锚点：窗口内两个候选，选文本更相似的那个', () => {
    const newSections = [
      section('nsec_1', 0, DURATION, '混合', [
        { text: '考场时间分配', startMs: 44_000 },
        { text: '先观察再推理', startMs: 47_000 },
      ]),
    ];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'bullet', sectionId: 'sec_0001', bulletId: 'sec_0001-b1', tMs: 45_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor.bulletId).toBe('nsec_1-b2');
  });

  it('bullet 锚点：窗口外（>15s）降级为 time 锚点，挂到 tMs 落入的章节（A3）', () => {
    const newSections = [
      section('nsec_1', 0, 200_000, '观察方法', [{ text: '先观察再推理', startMs: 90_000 }]), // 距 45s 为 45s
      section('nsec_2', 200_000, DURATION, '总结', []),
    ];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'bullet', sectionId: 'sec_0001', bulletId: 'sec_0001-b1', tMs: 45_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor).toEqual({ kind: 'time', sectionId: 'nsec_1', bulletId: null, tMs: 45_000 });
  });

  it('bullet 锚点：旧要点文本解析不了（旧章节已消失）→ 直接降级 time', () => {
    const newSections = [section('nsec_1', 0, DURATION, '全新大纲', [])];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'bullet', sectionId: 'gone', bulletId: 'gone-b1', tMs: 100_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor.kind).toBe('time');
    expect(r.notes[0].anchor.sectionId).toBe('nsec_1');
  });

  it('section 锚点：标题延续 → 直接挂上新章节，无待确认', () => {
    const newSections = [
      section('nsec_1', 0, 190_000, '图形推理的观察方法', []),
      section('nsec_2', 190_000, DURATION, '其他', []),
    ];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'section', sectionId: 'sec_0001', tMs: 60_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor.sectionId).toBe('nsec_1');
    expect(r.pendingIds.size).toBe(0);
  });

  it('section 锚点：标题完全不同且时长重叠 <50% → 挂上但标记待确认（黄点）（A3）', () => {
    // 旧 sec_0002=[180s,420s]；新章节 [0,250s] 标题完全不同：重叠 70s/250s=28% <50%
    const newSections = [
      section('nsec_1', 0, 250_000, '速算技巧', []),
      section('nsec_2', 250_000, DURATION, '其他', []),
    ];
    const r = reanchorNotes(
      [note({ id: 'n_s2', anchor: { kind: 'section', sectionId: 'sec_0002', tMs: 200_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor.sectionId).toBe('nsec_1');
    expect(r.pendingIds.has('n_s2')).toBe(true);
  });

  it('section 锚点：标题不同但重叠 ≥50% → 不标记待确认', () => {
    // 旧 sec_0002=[180s,420s]；新 [100s,430s]：重叠 240s/240s=100%
    const newSections = [
      section('nsec_1', 0, 100_000, '导语', []),
      section('nsec_2', 100_000, 430_000, '对称与数量关系（续）', []),
      section('nsec_3', 430_000, DURATION, '其他', []),
    ];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'section', sectionId: 'sec_0002', tMs: 200_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor.sectionId).toBe('nsec_2');
    expect(r.pendingIds.size).toBe(0);
  });

  it('time 锚点：落入 tMs 所在章节', () => {
    const newSections = [
      section('nsec_1', 0, 100_000, 'A', []),
      section('nsec_2', 100_000, DURATION, 'B', []),
    ];
    const r = reanchorNotes(
      [note({ anchor: { kind: 'time', sectionId: 'sec_0003', tMs: 150_000 } })],
      oldSections,
      newSections,
      DURATION,
    );
    expect(r.notes[0].anchor.sectionId).toBe('nsec_2');
  });

  it('tMs 超出视频时长 → 未归位；笔记仍在结果中，总数不减少（A3）', () => {
    const notes = [
      note({ id: 'n_ok', anchor: { kind: 'time', sectionId: 'sec_0001', tMs: 100_000 } }),
      note({ id: 'n_out', anchor: { kind: 'time', sectionId: 'sec_0001', tMs: DURATION + 5_000 } }),
      note({ id: 'n_neg', anchor: { kind: 'time', sectionId: 'sec_0001', tMs: -1 } }),
    ];
    const r = reanchorNotes(notes, oldSections, oldSections, DURATION);
    expect(r.notes).toHaveLength(3); // 永不删除
    expect(r.unanchoredIds.has('n_out')).toBe(true);
    expect(r.unanchoredIds.has('n_neg')).toBe(true);
    expect(r.unanchoredIds.has('n_ok')).toBe(false);
    expect(r.notes.find((n) => n.id === 'n_out')!.anchor.sectionId).toBeNull();
    expect(r.notes.find((n) => n.id === 'n_out')!.anchor.tMs).toBe(DURATION + 5_000); // tMs 保留
  });

  it('空新大纲（极端边界）→ 全部未归位，仍不丢', () => {
    const r = reanchorNotes(
      [note({ id: 'a' }), note({ id: 'b', anchor: { kind: 'time', sectionId: null, tMs: 5_000 } })],
      oldSections,
      [],
      DURATION,
    );
    expect(r.notes).toHaveLength(2);
    expect(r.unanchoredIds.size).toBe(2);
  });

  it('未归位笔记在新大纲可用后可再次归位（tMs 是唯一依据）', () => {
    const unanchored = note({
      anchor: { kind: 'time', sectionId: null, tMs: 200_000 },
    });
    const healed = [
      section('nsec_1', 0, 300_000, '对称与数量关系', []),
      section('nsec_2', 300_000, DURATION, '总结', []),
    ];
    const r = reanchorNotes([unanchored], oldSections, healed, DURATION);
    expect(r.notes[0].anchor.sectionId).toBe('nsec_1');
    expect(r.unanchoredIds.size).toBe(0);
  });

  it('replies / importedFrom / body 完整透传（归位不改笔记内容）', () => {
    const withThread = note({
      replies: [{ id: 'r_1', author: 'assistant', body: '回答', createdAt: '2026-10-01T00:00:01.000Z' }],
      importedFrom: { exporter: 'peer@vsc', exportedAt: '2026-10-01T00:00:00.000Z' },
      body: '正文不变',
    });
    const r = reanchorNotes([withThread], oldSections, oldSections, DURATION);
    expect(r.notes[0].body).toBe('正文不变');
    expect(r.notes[0].replies).toHaveLength(1);
    expect(r.notes[0].importedFrom?.exporter).toBe('peer@vsc');
  });
});
