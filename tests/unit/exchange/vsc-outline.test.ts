/**
 * vsc-outline 交换格式单测（SPEC-09 9.5 / 验收 A5 / A6 / A7）。
 * - A5：导出 → 导入往返后大纲与笔记逐字段相等（派生字段除外）
 * - A6：bvid/page 不一致拒绝并给两个标题；checksum 不符拒绝；主版本更高拒绝
 *       并提示升级；未知字段被忽略
 * - A7：docs/EXCHANGE-FORMAT.md 的示例 JSON 能被校验器通过（文档与实现不漂移）
 */
import { describe, expect, it } from 'vitest';
import docMd from '../../../docs/EXCHANGE-FORMAT.md?raw';
import {
  buildOutlineExport,
  computeChecksum,
  outlineExportFileName,
  parseOutlineImport,
  stableStringify,
  type VscOutlineFile,
} from '../../../src/core/exchange/vscOutline';
import type { OutlineNote, Section, VideoMeta } from '../../../src/types';

const meta: VideoMeta = {
  videoId: 'BV15yxMeKELY_p1',
  bvid: 'BV15yxMeKELY',
  page: 1,
  cid: 123_456,
  title: '图形推理速通',
  durationMs: 600_000,
  url: 'https://www.bilibili.com/video/BV15yxMeKELY?p=1',
};

const sections: Section[] = [
  {
    id: 'sec_0001',
    title: '图形推理的观察方法',
    startMs: 0,
    endMs: 312_000,
    summary: '先观察整体特征再推理规律。',
    bullets: [
      { text: '先观察再推理', startMs: 45_000 },
      { text: '找规律类型', startMs: 100_000, approximate: true },
    ],
    terms: ['观察法'],
    importance: 4,
    score: 87,
    density: 'high',
    cueRange: [0, 99],
  },
  {
    id: 'sec_0002',
    title: '对称与数量关系',
    startMs: 312_000,
    endMs: 600_000,
    summary: '对称轴与元素数量。',
    bullets: [{ text: '对称轴判定', startMs: 320_000 }],
    terms: ['对称轴'],
    importance: 3,
    density: 'mid',
    cueRange: [100, 200],
  },
];

const notes: OutlineNote[] = [
  {
    id: 'n_0001',
    videoId: meta.videoId,
    anchor: { kind: 'bullet', sectionId: 'sec_0001', bulletId: 'sec_0001-b1', tMs: 45_000 },
    body: '先观察再推理，考场上容易跳过观察这步',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    replies: [
      {
        id: 'r_0001',
        author: 'assistant',
        body: '观察顺序：先整体形状，再元素数量与位置。',
        createdAt: '2026-10-01T12:00:05.000Z',
      },
    ],
  },
  {
    id: 'n_0002',
    videoId: meta.videoId,
    anchor: { kind: 'time', sectionId: null, tMs: 500_000 },
    body: '未归位笔记也不丢',
    createdAt: '2026-10-01T12:01:00.000Z',
    updatedAt: '2026-10-01T12:01:00.000Z',
    replies: [],
    importedFrom: { exporter: 'peer@vsc', exportedAt: '2026-10-01T11:00:00.000Z' },
  },
];

const build = () =>
  buildOutlineExport({
    meta,
    promptVersion: '0.2.1',
    model: 'qwen-vl-plus',
    sections,
    notes,
    appVersion: '0.1.0',
    now: () => new Date('2026-10-01T12:00:00.000Z'),
  });

describe('stableStringify（确定性）', () => {
  it('键序无关：不同书写顺序的等价对象得到相同字符串', () => {
    expect(stableStringify({ a: 1, b: { d: 4, c: 3 } })).toBe(
      stableStringify({ b: { c: 3, d: 4 }, a: 1 }),
    );
  });

  it('数组保序、原始值正常序列化', () => {
    expect(stableStringify({ b: [2, 1], a: 'x', n: null })).toBe('{"a":"x","b":[2,1],"n":null}');
  });
});

describe('buildOutlineExport', () => {
  it('派生字段不导出：score/density/cueRange/approximate 均不出现', async () => {
    const file = await build();
    expect(file.outline.sections[0]).not.toHaveProperty('score');
    expect(file.outline.sections[0]).not.toHaveProperty('density');
    expect(file.outline.sections[0]).not.toHaveProperty('cueRange');
    expect(file.outline.sections[0].bullets[1]).not.toHaveProperty('approximate');
  });

  it('要点合成 id：`${sectionId}-b${序号}`', async () => {
    const file = await build();
    expect(file.outline.sections[0].bullets.map((b) => b.id)).toEqual([
      'sec_0001-b1',
      'sec_0001-b2',
    ]);
  });

  it('checksum 可复算（导出 → 去掉 checksum 再算一致）', async () => {
    const file = await build();
    const { checksum, ...rest } = file;
    expect(await computeChecksum(rest)).toBe(checksum);
    expect(checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('文件名：标题安全化 + bvid/page 后缀', () => {
    expect(outlineExportFileName('图形推理:速通?', 'BV1X', 2)).toBe(
      '图形推理_速通.BV1X_p2.vsc-outline.json',
    );
    expect(outlineExportFileName('', 'BV1X', 1)).toBe('outline.BV1X_p1.vsc-outline.json');
  });
});

describe('parseOutlineImport（校验顺序与拒绝路径，A6）', () => {
  it('A5 往返：导出 → 导入，大纲与笔记逐字段相等（派生字段除外）', async () => {
    const file = await build();
    const result = await parseOutlineImport(JSON.stringify(file), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.outline.sections).toEqual(file.outline.sections);
    expect(result.file.notes).toEqual(file.notes);
    expect(result.file.video).toEqual(file.video);
    expect(result.warnings).toEqual([]);
  });

  it('非法 JSON → 拒绝（stage=json）', async () => {
    const r = await parseOutlineImport('这不是JSON', { bvid: meta.bvid, page: 1, title: meta.title });
    expect(r).toMatchObject({ ok: false, stage: 'json' });
  });

  it('format 不是 vsc-outline → 拒绝（stage=format）', async () => {
    const r = await parseOutlineImport('{"format":"other","version":"1.0"}', {
      bvid: meta.bvid,
      page: 1,
      title: meta.title,
    });
    expect(r).toMatchObject({ ok: false, stage: 'format' });
  });

  it('主版本更高 → 拒绝并提示升级（stage=version）', async () => {
    const file = await build();
    const mutated: VscOutlineFile = { ...file, version: '2.0' };
    const r = await parseOutlineImport(JSON.stringify(mutated), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    });
    expect(r).toMatchObject({ ok: false, stage: 'version' });
    if (r.ok) return;
    expect(r.message).toContain('升级');
  });

  it('checksum 不符（内容被篡改）→ 拒绝（stage=checksum）', async () => {
    const file = await build();
    const mutated = { ...file, outline: { ...file.outline, model: 'other-model' } };
    const r = await parseOutlineImport(JSON.stringify(mutated), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    });
    expect(r).toMatchObject({ ok: false, stage: 'checksum' });
  });

  it('bvid 不一致 → 拒绝并给出两个视频的标题（stage=video-mismatch）', async () => {
    const file = await build();
    const r = await parseOutlineImport(JSON.stringify(file), {
      bvid: 'BV1OTHER',
      page: 1,
      title: '本地视频标题',
    });
    expect(r).toMatchObject({ ok: false, stage: 'video-mismatch' });
    if (r.ok) return;
    expect(r.message).toContain('图形推理速通');
    expect(r.message).toContain('本地视频标题');
  });

  it('page 不一致 → 拒绝（同一 bvid 不同分 P）', async () => {
    const file = await build();
    const r = await parseOutlineImport(JSON.stringify(file), {
      bvid: meta.bvid,
      page: 2,
      title: meta.title,
    });
    expect(r).toMatchObject({ ok: false, stage: 'video-mismatch' });
  });

  it('未知字段被忽略（向前兼容）：加两个未来字段仍导入成功', async () => {
    const file = await build();
    const mutated = {
      ...file,
      futureField: { anything: true },
      outline: { ...file.outline, futureSectionsField: 1 },
    };
    // 未来字段属于文件内容，参与 checksum（导出方按全文计算）；
    // 导入端忽略未知字段但同样按全文复算哈希——两侧一致
    mutated.checksum = await computeChecksum(mutated);
    const r = await parseOutlineImport(JSON.stringify(mutated), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    });
    expect(r.ok).toBe(true);
  });

  it('结构缺字段（sections 空）→ 拒绝（stage=structure）', async () => {
    const file = await build();
    const mutated = { ...file, outline: { ...file.outline, sections: [] } };
    mutated.checksum = await computeChecksum(mutated);
    const r = await parseOutlineImport(JSON.stringify(mutated), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    });
    expect(r).toMatchObject({ ok: false, stage: 'structure' });
  });

  it('时间戳覆盖率 <90% → 警告但不拒绝', async () => {
    const file = await build();
    const r = await parseOutlineImport(JSON.stringify(file), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    }, { cueRangeMs: [0, 100_000] }); // 本地字幕只覆盖前 100s，大量时间戳在外
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join('\n')).toContain('字幕版本可能不同');
  });

  it('覆盖率充足（≥90%）→ 无警告', async () => {
    const file = await build();
    const r = await parseOutlineImport(JSON.stringify(file), {
      bvid: meta.bvid,
      page: meta.page,
      title: meta.title,
    }, { cueRangeMs: [0, 600_000] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  });
});

describe('文档与实现不漂移（A7）', () => {
  it('docs/EXCHANGE-FORMAT.md 的示例 JSON 能被校验器通过', async () => {
    const m = /```json\n([\s\S]*?)```/.exec(docMd);
    expect(m).not.toBeNull();
    const example = JSON.parse(m![1]!.replace(/^> .*$/gm, '')) as Record<string, unknown>;
    // 文档中 checksum 为占位值：按本文规则补真实哈希后应能通过
    const { checksum: _c, ...rest } = example;
    example.checksum = await computeChecksum(rest as Omit<VscOutlineFile, 'checksum'>);
    const r = await parseOutlineImport(JSON.stringify(example), {
      bvid: 'BV15yxMeKELY',
      page: 1,
      title: '本地任意标题',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.outline.sections[0].bullets[0].id).toBe('sec_0001-b1');
    expect(r.file.notes[0].replies[0].author).toBe('assistant');
  });
});
