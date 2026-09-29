import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue } from '../../../src/types';
import {
  fetchBiliSubtitles,
  _resetMixinKeyCacheForTests,
  type FetchLike,
} from '../../../src/providers/bilibili';

/** 固定时间：2026-09-30T06:00:00Z（所有用例都在同一 UTC 日内，另设跨天用例） */
const NOW = Date.UTC(2026, 8, 30, 6, 0, 0);
const now = () => NOW;

const cues: Cue[] = [
  { index: 0, startMs: 0, endMs: 1500, text: '你好' },
  { index: 1, startMs: 1500, endMs: 3200, text: '世界' },
];
const parseCuesStub = vi.fn(() => cues);

/** 正常链路的四类响应 */
const okRoutes = (subtitles: unknown[], needLogin = false): Record<string, () => unknown> => ({
  '/x/web-interface/view': () => ({
    code: 0,
    data: { pages: [{ page: 1, cid: 111, duration: 600, part: 'P1' }] },
  }),
  '/x/web-interface/nav': () => ({
    code: 0,
    data: {
      wbi_img: {
        img_url: 'https://i0.hdslb.com/bfs/wbi/df2da2b6df2da2b6df2da2b6df2da2b6.png',
        sub_url: 'https://i0.hdslb.com/bfs/wbi/df2da2b6df2da2b6df2da2b6df2da2b6.png',
      },
    },
  }),
  '/x/player/wbi/v2': () => ({
    code: 0,
    data: { subtitle: { subtitles, need_login_subtitle: needLogin } },
  }),
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 按 URL pathname 分发的 mock fetch，记录全部调用 */
function makeFetch(routes: Record<string, () => unknown>): { fetchFn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    calls.push(url);
    const pathname = new URL(url).pathname;
    const handler = routes[pathname];
    if (handler === undefined) return new Response('no route', { status: 404 });
    const result = handler();
    return result instanceof Response ? result : jsonResponse(result);
  };
  return { fetchFn, calls };
}

const navCount = (calls: string[]): number => calls.filter((u) => u.includes('/nav')).length;

beforeEach(() => {
  _resetMixinKeyCacheForTests();
  parseCuesStub.mockClear();
});

describe('fetchBiliSubtitles', () => {
  it('正常链路：view→nav→player→字幕 JSON，返回 ok + cues（AI 轨）', async () => {
    const { fetchFn, calls } = makeFetch({
      ...okRoutes([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/demo.json' }]),
      '/bfs/ai_subtitle/prod/demo.json': () => ({ body: [{ from: 0, to: 1.5, content: '你好' }] }),
    });

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('ok');
    expect(result.cues).toEqual(cues);
    expect(result.source).toBe('bili_ai');
    expect(result.lang).toBe('ai-zh');
    expect(parseCuesStub).toHaveBeenCalledWith({ body: [{ from: 0, to: 1.5, content: '你好' }] });

    // playerWbiV2 请求带 wbi 签名参数
    const playerUrl = calls.find((u) => u.includes('/x/player/wbi/v2'));
    expect(playerUrl).toBeDefined();
    const q = new URL(playerUrl!).searchParams;
    expect(q.get('bvid')).toBe('BV1xx411c7mD');
    expect(q.get('cid')).toBe('111');
    expect(q.get('wts')).toBe(String(Math.floor(NOW / 1000)));
    expect(q.get('w_rid')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('选轨：UP 主字幕（非 ai- 前缀）优先于 AI 字幕', async () => {
    const { fetchFn, calls } = makeFetch({
      ...okRoutes([
        { lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/ai.json' },
        { lan: 'zh-CN', subtitle_url: '//i0.hdslb.com/bfs/up/up.json' },
      ]),
      '/bfs/ai_subtitle/prod/ai.json': () => ({ body: [{ from: 0, to: 1, content: 'ai' }] }),
      '/bfs/up/up.json': () => ({ body: [{ from: 0, to: 1, content: 'up' }] }),
    });

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('ok');
    expect(result.source).toBe('bili_uploader');
    expect(result.lang).toBe('zh-CN');
    // 最后一次请求的是 UP 主字幕 JSON
    expect(calls[calls.length - 1]).toContain('/bfs/up/up.json');
  });

  it('选轨：同级非 AI 轨中中文（zh 开头）优先', async () => {
    const { fetchFn, calls } = makeFetch({
      ...okRoutes([
        { lan: 'en', subtitle_url: '//i0.hdslb.com/bfs/up/en.json' },
        { lan: 'zh-CN', subtitle_url: '//i0.hdslb.com/bfs/up/zh.json' },
      ]),
      '/bfs/up/en.json': () => ({ body: [{ from: 0, to: 1, content: 'en' }] }),
      '/bfs/up/zh.json': () => ({ body: [{ from: 0, to: 1, content: 'zh' }] }),
    });

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.lang).toBe('zh-CN');
    expect(calls[calls.length - 1]).toContain('/bfs/up/zh.json');
  });

  it('need_login：subtitles 空且 need_login_subtitle=true → need_login（而非 no_subtitle）', async () => {
    const { fetchFn } = makeFetch(okRoutes([], true));

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('need_login');
    expect(result.cues).toEqual([]);
  });

  it('view 返回 code≠0 → api_changed', async () => {
    const { fetchFn } = makeFetch({
      '/x/web-interface/view': () => ({ code: -400, message: '请求错误' }),
    });

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('api_changed');
  });

  it('mixinKey 按日缓存：同日第二次调用不再请求 nav', async () => {
    const routes = {
      ...okRoutes([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/demo.json' }]),
      '/bfs/ai_subtitle/prod/demo.json': () => ({ body: [{ from: 0, to: 1, content: '你好' }] }),
    };
    const { fetchFn, calls } = makeFetch(routes);
    const opts = { bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub } as const;

    await fetchBiliSubtitles(opts);
    expect(navCount(calls)).toBe(1);

    await fetchBiliSubtitles(opts);
    expect(navCount(calls)).toBe(1);
  });

  it('mixinKey 跨天失效：日期变化后重新请求 nav', async () => {
    let t = NOW;
    const mutableNow = () => t;
    const routes = {
      ...okRoutes([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/demo.json' }]),
      '/bfs/ai_subtitle/prod/demo.json': () => ({ body: [{ from: 0, to: 1, content: '你好' }] }),
    };
    const { fetchFn, calls } = makeFetch(routes);
    const opts = { bvid: 'BV1xx411c7mD', page: 1, fetchFn, now: mutableNow, parseCues: parseCuesStub };

    await fetchBiliSubtitles(opts);
    expect(navCount(calls)).toBe(1);

    t = NOW + 24 * 60 * 60 * 1000; // 次日，缓存失效
    await fetchBiliSubtitles(opts);
    expect(navCount(calls)).toBe(2);
  });

  it('fetch 抛错 → network', async () => {
    const fetchFn: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('network');
    expect(result.error).toContain('Failed to fetch');
  });

  it('响应非 JSON → api_changed，且 resolve 而不 throw（红线 8）', async () => {
    const { fetchFn } = makeFetch({
      '/x/web-interface/view': () => new Response('<html>gateway error page</html>'),
    });

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('api_changed');
    expect(result.cues).toEqual([]);
  });

  it('page 不在 pages[] 中 → api_changed（page not found）', async () => {
    const { fetchFn } = makeFetch(okRoutes([{ lan: 'ai-zh', subtitle_url: '//x' }]));

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 2, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('api_changed');
    expect(result.error).toContain('page not found');
  });

  it('字幕轨均无 subtitle_url → no_subtitle', async () => {
    const { fetchFn } = makeFetch(okRoutes([{ lan: 'ai-zh' }, { lan: 'zh-CN' }]));

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: parseCuesStub });

    expect(result.status).toBe('no_subtitle');
  });

  it('字幕 body 为空（parseCues 返回 []）→ api_changed', async () => {
    const { fetchFn } = makeFetch({
      ...okRoutes([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/demo.json' }]),
      '/bfs/ai_subtitle/prod/demo.json': () => ({ body: [] }),
    });
    const emptyStub = vi.fn(() => [] as Cue[]);

    const result = await fetchBiliSubtitles({ bvid: 'BV1xx411c7mD', page: 1, fetchFn, now, parseCues: emptyStub });

    expect(result.status).toBe('api_changed');
    expect(result.error).toContain('empty');
  });
});
