import { describe, expect, it } from 'vitest';
import {
  runSubtitleWaterfall,
  type WaterfallDeps,
  type WaterfallRequest,
} from '../../../src/providers/waterfall';
import type { Cue, FetchResult, SubtitleRecord, VideoMeta } from '../../../src/types';

const meta: VideoMeta = {
  videoId: 'BV1TEST_p2',
  bvid: 'BV1TEST',
  page: 2,
  cid: 42,
  title: 'P2 测试分P',
  durationMs: 60_000,
  url: 'about:blank',
};

/** 通过 normalizeCues 后保持不变的合法 cues（时长 ≥800ms、间隙 ≥500ms、无语气词、无重复行） */
const okCues: Cue[] = [
  { index: 0, startMs: 0, endMs: 2000, text: '网络获取的第一句' },
  { index: 1, startMs: 3000, endMs: 5000, text: '网络获取的第二句' },
];

const okFetch: FetchResult = { cues: okCues, status: 'ok', source: 'bili_uploader', lang: 'zh-CN' };

function cachedRecord(overrides?: Partial<SubtitleRecord>): SubtitleRecord {
  return {
    videoId: meta.videoId,
    meta,
    source: 'bili_uploader',
    lang: 'zh-CN',
    status: 'ok',
    cues: okCues,
    fetchedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  '大家好欢迎来到课程',
  '',
  '2',
  '00:00:05,000 --> 00:00:07,000',
  '今天讲解第二课',
].join('\n');

interface Harness {
  deps: WaterfallDeps;
  counts: { fetch: number; get: number; save: number };
  saved: SubtitleRecord[];
  fetchOpts: Array<{ bvid: string; page: number }>;
  cache: Map<string, SubtitleRecord>;
  setFetch: (f: (opts: { bvid: string; page: number }) => Promise<FetchResult>) => void;
  setGet: (f: (videoId: string) => Promise<SubtitleRecord | null>) => void;
  setSave: (f: (rec: SubtitleRecord) => Promise<void>) => void;
}

/** 可替换行为的 mock 依赖：默认 get/save 走内存 Map（模拟真实缓存） */
function makeHarness(): Harness {
  const cache = new Map<string, SubtitleRecord>();
  const counts = { fetch: 0, get: 0, save: 0 };
  const saved: SubtitleRecord[] = [];
  const fetchOpts: Array<{ bvid: string; page: number }> = [];

  let fetchImpl: (opts: { bvid: string; page: number }) => Promise<FetchResult> = async () => ({
    cues: [],
    status: 'no_subtitle',
    error: 'fetch not configured',
  });
  let getImpl: (videoId: string) => Promise<SubtitleRecord | null> = async (videoId) =>
    cache.get(videoId) ?? null;
  let saveImpl: (rec: SubtitleRecord) => Promise<void> = async (rec) => {
    saved.push(rec);
    cache.set(rec.videoId, rec);
  };

  const deps: WaterfallDeps = {
    fetchBili: (opts) => {
      counts.fetch++;
      fetchOpts.push(opts);
      return fetchImpl(opts);
    },
    getSubtitle: (videoId) => {
      counts.get++;
      return getImpl(videoId);
    },
    saveSubtitle: (rec) => {
      counts.save++;
      return saveImpl(rec);
    },
  };

  return {
    deps,
    counts,
    saved,
    fetchOpts,
    cache,
    setFetch: (f) => {
      fetchImpl = f;
    },
    setGet: (f) => {
      getImpl = f;
    },
    setSave: (f) => {
      saveImpl = f;
    },
  };
}

function req(overrides?: Partial<WaterfallRequest>): WaterfallRequest {
  return { videoId: meta.videoId, bvid: meta.bvid, page: meta.page, meta, ...overrides };
}

describe('runSubtitleWaterfall（瀑布编排，红线 8：全链路不抛异常）', () => {
  it('① 缓存命中 → 零网络（fetchBili 计数 = 0），cues/status/source/lang 透出', async () => {
    const h = makeHarness();
    h.cache.set(meta.videoId, cachedRecord());
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(h.counts.fetch).toBe(0);
    expect(r.status).toBe('ok');
    expect(r.cues).toEqual(okCues);
    expect(r.source).toBe('bili_uploader');
    expect(r.lang).toBe('zh-CN');
  });

  it('② 缓存未命中 → 走网络并落缓存；第二次调用零网络、不重复落缓存', async () => {
    const h = makeHarness();
    h.setFetch(async () => ({ ...okFetch }));
    const r1 = await runSubtitleWaterfall(req(), h.deps);
    expect(h.counts.fetch).toBe(1);
    expect(h.counts.save).toBe(1);
    expect(r1.status).toBe('ok');
    expect(r1.cues).toEqual(okCues);
    expect(h.saved[0]).toMatchObject({ videoId: meta.videoId, meta, status: 'ok', source: 'bili_uploader', lang: 'zh-CN' });
    expect(h.fetchOpts[0]).toEqual({ bvid: meta.bvid, page: meta.page });

    const r2 = await runSubtitleWaterfall(req(), h.deps);
    expect(h.counts.fetch).toBe(1); // 第二次零网络
    expect(h.counts.save).toBe(1);
    expect(r2.cues).toEqual(okCues);
    expect(r2.source).toBe('bili_uploader');
  });

  it('③ forceRefresh → 跳过缓存直接走网络', async () => {
    const h = makeHarness();
    h.cache.set(meta.videoId, cachedRecord());
    h.setFetch(async () => ({ ...okFetch }));
    const r = await runSubtitleWaterfall(req({ forceRefresh: true }), h.deps);
    expect(h.counts.fetch).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('④ B 站返回 need_login → status/error 透传且不落缓存（再次调用仍走网络）', async () => {
    const h = makeHarness();
    h.setFetch(async () => ({ cues: [], status: 'need_login', error: 'login required' }));
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(r.status).toBe('need_login');
    expect(r.error).toBe('login required');
    expect(r.cues).toEqual([]);
    expect(h.counts.save).toBe(0);
    expect(h.cache.size).toBe(0);

    await runSubtitleWaterfall(req(), h.deps);
    expect(h.counts.fetch).toBe(2); // 未落缓存 → 第二次仍走网络
  });

  it('⑤ manualText → 直接手动通道：零网络零缓存读，落 manual_pasted 记录', async () => {
    const h = makeHarness();
    const r = await runSubtitleWaterfall(req({ manualText: SRT }), h.deps);
    expect(r.status).toBe('manual_pasted');
    expect(r.source).toBe('manual');
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0]).toMatchObject({ startMs: 1000, endMs: 3500 });
    expect(h.counts.fetch).toBe(0);
    expect(h.counts.get).toBe(0);
    expect(h.counts.save).toBe(1);
    expect(h.saved[0]).toMatchObject({ videoId: meta.videoId, status: 'manual_pasted', source: 'manual' });
  });

  it('⑥ manual_pasted 缓存记录命中 → 照常返回，零网络', async () => {
    const h = makeHarness();
    h.cache.set(
      meta.videoId,
      cachedRecord({ status: 'manual_pasted', source: 'manual', lang: null }),
    );
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(r.status).toBe('manual_pasted');
    expect(r.source).toBe('manual');
    expect(r.lang).toBeUndefined();
    expect(r.cues).toEqual(okCues);
    expect(h.counts.fetch).toBe(0);
  });

  it('⑦ fetchBili 抛异常 → 返回 network FetchResult，不上抛、不落缓存', async () => {
    const h = makeHarness();
    h.setFetch(async () => {
      throw new Error('connection reset');
    });
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(r.status).toBe('network');
    expect(r.cues).toEqual([]);
    expect(r.error).toContain('connection reset');
    expect(h.counts.save).toBe(0);
  });

  it('⑧ getSubtitle 抛异常（DB 损坏）→ 仍走网络并正常落缓存', async () => {
    const h = makeHarness();
    h.setGet(async () => {
      throw new Error('db corrupted');
    });
    h.setFetch(async () => ({ ...okFetch }));
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(r.status).toBe('ok');
    expect(r.cues).toEqual(okCues);
    expect(h.counts.fetch).toBe(1);
    expect(h.counts.save).toBe(1);
  });

  it('⑨ saveSubtitle 抛异常 → 结果正常返回（缓存写失败不影响本次结果）', async () => {
    const h = makeHarness();
    h.setSave(async () => {
      throw new Error('disk full');
    });
    h.setFetch(async () => ({ ...okFetch }));
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(r.status).toBe('ok');
    expect(r.cues).toEqual(okCues);
    expect(h.counts.save).toBe(1); // 尝试过写
  });

  it('⑩ manualText 乱输入 → no_subtitle，不落缓存、不访问网络', async () => {
    const h = makeHarness();
    const r = await runSubtitleWaterfall(req({ manualText: '嗯。啊。' }), h.deps);
    expect(r.status).toBe('no_subtitle');
    expect(r.cues).toEqual([]);
    expect(h.counts.fetch).toBe(0);
    expect(h.counts.save).toBe(0);
  });

  it('⑪ manualText 为空串 → 视为无手动输入，照常走缓存', async () => {
    const h = makeHarness();
    h.cache.set(meta.videoId, cachedRecord());
    const r = await runSubtitleWaterfall(req({ manualText: '' }), h.deps);
    expect(r.status).toBe('ok');
    expect(h.counts.get).toBe(1);
    expect(h.counts.fetch).toBe(0);
  });

  it('⑫ manualText 优先于缓存：缓存已有记录时仍直接进手动通道', async () => {
    const h = makeHarness();
    h.cache.set(meta.videoId, cachedRecord());
    const r = await runSubtitleWaterfall(req({ manualText: SRT }), h.deps);
    expect(r.status).toBe('manual_pasted');
    expect(r.source).toBe('manual');
    expect(h.counts.get).toBe(0);
    expect(h.counts.fetch).toBe(0);
    expect(h.counts.save).toBe(1);
  });

  it('⑬ 网络结果在瀑布内再过 normalizeCues：短碎段合并后才落缓存', async () => {
    const h = makeHarness();
    const rawCues: Cue[] = [
      { index: 0, startMs: 0, endMs: 500, text: '碎片一' },
      { index: 1, startMs: 600, endMs: 1100, text: '碎片二' },
    ];
    h.setFetch(async () => ({ cues: rawCues, status: 'ok', source: 'bili_ai', lang: 'ai-zh' }));
    const r = await runSubtitleWaterfall(req(), h.deps);
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0]).toMatchObject({ index: 0, startMs: 0, endMs: 1100, text: '碎片一碎片二' });
    expect(h.saved[0].cues).toHaveLength(1); // 落缓存的是规范化后的 cues
  });
});
