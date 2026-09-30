/**
 * 可选联网检索单测（问答增强第 3 条）：请求构造 / 响应解析 / 失败降级 /
 * 预算裁剪与素材块组装。
 *
 * 红线 9：测试同样零 URL 字面量——endpoint 由 src/config 常量派生
 * （new URL(WEB_SEARCH_FALLBACK_URL).origin），apiKey 只作运行时注入值。
 */
import { describe, expect, it, vi } from 'vitest';
import { WEB_SEARCH, WEB_SEARCH_FALLBACK_URL } from '../../../src/config';
import {
  WEB_BEGIN_MARK,
  buildSearchRequest,
  buildWebContext,
  formatSnippetLine,
  searchWeb,
  trimSnippets,
  type SearchFetch,
  type WebSearchConfig,
  type WebSnippet,
} from '../../../src/core/knowledge/webSearch';

/** 测试用 endpoint：由 config 常量派生，测试文件内不写 URL 字面量 */
const ENDPOINT = `${new URL(WEB_SEARCH_FALLBACK_URL).origin}/search`;

const cfg = (over: Partial<WebSearchConfig> = {}): WebSearchConfig => ({
  endpoint: ENDPOINT,
  apiKey: 'runtime-key',
  ...over,
});

/** 假 Response：ok + json 可注入异常 */
function fakeResponse(ok: boolean, json: unknown, throwOnJson = false): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => {
      if (throwOnJson) throw new Error('bad json');
      return json;
    },
  } as unknown as Response;
}

const snippet = (title: string, url: string, text: string): WebSnippet => ({
  title,
  url,
  snippet: text,
});

describe('buildSearchRequest（引擎差异封装）', () => {
  it('默认 tavily：POST + body {query, max_results} + endpoint 原样来自配置', () => {
    const { url, init } = buildSearchRequest(cfg(), '注意力机制 是什么', 3);
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      query: '注意力机制 是什么',
      max_results: 3,
    });
  });

  it('tavily：apiKey 走 Authorization Bearer（来自配置，非字面量）', () => {
    const { init } = buildSearchRequest(cfg(), 'q', 5);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer runtime-key');
    expect(headers['content-type']).toBe('application/json');
  });

  it('serper：body {q, num} + X-API-KEY 头', () => {
    const { init } = buildSearchRequest(cfg({ engine: 'serper' }), 'q', 4);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-KEY']).toBe('runtime-key');
    expect(JSON.parse(String(init.body))).toEqual({ q: 'q', num: 4 });
  });

  it('未知 engine 回落 tavily 形状', () => {
    const { init } = buildSearchRequest(cfg({ engine: '自建代理' }), 'q', 2);
    expect(JSON.parse(String(init.body))).toEqual({ query: 'q', max_results: 2 });
  });

  it('maxResults 非法（0 / 负数 / NaN）回落默认条数', () => {
    for (const bad of [0, -3, Number.NaN]) {
      const { init } = buildSearchRequest(cfg(), 'q', bad);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.max_results ?? body.num).toBe(WEB_SEARCH.defaultMaxResults);
    }
  });

  it('endpoint 为空时 url 为空串（调用方据此跳过检索）', () => {
    expect(buildSearchRequest(cfg({ endpoint: '' }), 'q', 3).url).toBe('');
  });
});

describe('searchWeb（解析与降级）', () => {
  it('解析 {results:[{title,url,content}]} 形状', async () => {
    const fetchFn: SearchFetch = vi.fn(async () =>
      fakeResponse(true, {
        results: [
          { title: 'T1', url: 'u1', content: 'c1' },
          { title: 'T2', url: 'u2', content: 'c2' },
        ],
      }),
    ) as unknown as SearchFetch;
    const out = await searchWeb(cfg(), fetchFn, 'q');
    expect(out).toEqual([
      { title: 'T1', url: 'u1', snippet: 'c1' },
      { title: 'T2', url: 'u2', snippet: 'c2' },
    ]);
  });

  it('解析 {organic:[{title,link,snippet}]} 形状（link/snippet 别名）', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, { organic: [{ title: 'T1', link: 'u1', snippet: 's1' }] })) as SearchFetch;
    expect(await searchWeb(cfg({ engine: 'serper' }), fetchFn, 'q')).toEqual([
      { title: 'T1', url: 'u1', snippet: 's1' },
    ]);
  });

  it('非 2xx → 空数组，不 throw', async () => {
    const fetchFn = (async () => fakeResponse(false, { results: [] })) as SearchFetch;
    await expect(searchWeb(cfg(), fetchFn, 'q')).resolves.toEqual([]);
  });

  it('json 解析失败 → 空数组，不 throw', async () => {
    const fetchFn = (async () => fakeResponse(true, {}, true)) as SearchFetch;
    await expect(searchWeb(cfg(), fetchFn, 'q')).resolves.toEqual([]);
  });

  it('网络异常（fetch reject）→ 空数组，不 throw', async () => {
    const fetchFn = (async () => {
      throw new Error('network down');
    }) as SearchFetch;
    await expect(searchWeb(cfg(), fetchFn, 'q')).resolves.toEqual([]);
  });

  it('结果为空数组 / 无结果字段 → 空数组', async () => {
    const fetchFn = (async () => fakeResponse(true, { results: [] })) as SearchFetch;
    expect(await searchWeb(cfg(), fetchFn, 'q')).toEqual([]);
    const fetchFn2 = (async () => fakeResponse(true, { foo: 'bar' })) as SearchFetch;
    expect(await searchWeb(cfg(), fetchFn2, 'q')).toEqual([]);
  });

  it('缺 title 或 url 的条目丢弃；snippet 缺失视为空串', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, {
        results: [
          { title: '', url: 'u0', content: 'x' },
          { title: 'T1', url: '', content: 'x' },
          { title: 'T2', url: 'u2' },
          'not-an-object',
        ],
      })) as SearchFetch;
    expect(await searchWeb(cfg(), fetchFn, 'q')).toEqual([
      { title: 'T2', url: 'u2', snippet: '' },
    ]);
  });

  it('maxResults 限制返回条数', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      title: `T${i}`,
      url: `u${i}`,
      content: 'c',
    }));
    const fetchFn = (async () => fakeResponse(true, { results: many })) as SearchFetch;
    expect(await searchWeb(cfg(), fetchFn, 'q', { maxResults: 2 })).toHaveLength(2);
  });

  it('endpoint 未配置 → 空数组且不发起请求', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(true, { results: [] })) as unknown as SearchFetch;
    expect(await searchWeb(cfg({ endpoint: '' }), fetchFn, 'q')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('trimSnippets（预算裁剪，不切断内容）', () => {
  const list = [
    snippet('标题一', 'u1', '摘要一'),
    snippet('标题二', 'u2', '摘要二'),
    snippet('标题三', 'u3', '摘要三'),
  ];

  it('预算充足时全留', () => {
    expect(trimSnippets(list, 10_000)).toHaveLength(3);
  });

  it('装不下的整条丢弃（丢最后一条，不切断文本）', () => {
    const budget = formatSnippetLine(list[0]).length + formatSnippetLine(list[1]).length;
    expect(trimSnippets(list, budget)).toEqual(list.slice(0, 2));
    expect(trimSnippets(list, budget - 1)).toEqual(list.slice(0, 1));
  });

  it('maxChars ≤ 0 / 空输入 → 空数组', () => {
    expect(trimSnippets(list, 0)).toEqual([]);
    expect(trimSnippets([], 100)).toEqual([]);
  });
});

describe('buildWebContext（素材块组装）', () => {
  it('空输入 → 空串', () => {
    expect(buildWebContext([])).toBe('');
  });

  it('非空：起始标记 + 每条「- 标题（url）：摘要」', () => {
    const out = buildWebContext([snippet('T1', 'u1', 's1')]);
    expect(out.startsWith(WEB_BEGIN_MARK)).toBe(true);
    expect(out).toContain('- T1（u1）：s1');
  });

  it('超预算时丢弃装不下的条目（红线 3：不膨胀上下文）', () => {
    const list = [snippet('T1', 'u1', 's1'), snippet('T2', 'u2', 's2')];
    const out = buildWebContext(list, formatSnippetLine(list[0]).length);
    expect(out).toContain('- T1（u1）：s1');
    expect(out).not.toContain('T2');
  });

  it('单条即超预算 → 空串（不产生半条内容）', () => {
    expect(buildWebContext([snippet('T1', 'u1', 's1')], 1)).toBe('');
  });
});
