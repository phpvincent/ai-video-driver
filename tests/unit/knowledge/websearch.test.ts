/**
 * 内置公开资料检索单测（DuckDuckGo Instant Answer，免 Key 免配置）：
 * 请求构造 / 响应解析 / 失败降级 / 预算裁剪与素材块组装。
 *
 * 红线 9：测试同样零 URL 字面量——端点由 src/config 的 WEB_SEARCH.endpoint 派生。
 */
import { describe, expect, it, vi } from 'vitest';
import { WEB_SEARCH } from '../../../src/config';
import {
  WEB_BEGIN_MARK,
  buildSearchUrl,
  buildWebContext,
  formatSnippetLine,
  searchWeb,
  trimSnippets,
  type SearchFetch,
  type WebSnippet,
} from '../../../src/core/knowledge/webSearch';

/** 测试用端点：由 config 常量派生，测试文件内不写 URL 字面量 */
const ENDPOINT = WEB_SEARCH.endpoint;

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

describe('buildSearchUrl（免鉴权请求构造）', () => {
  it('端点来自 config 常量，带 format=json 等参数', () => {
    const url = buildSearchUrl('注意力机制');
    expect(url.startsWith(ENDPOINT)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('注意力机制');
    expect(parsed.searchParams.get('format')).toBe('json');
    expect(parsed.searchParams.get('no_html')).toBe('1');
    expect(parsed.searchParams.get('skip_disambig')).toBe('1');
  });

  it('查询串做 URL 编码（中文与空格）', () => {
    const url = buildSearchUrl('a b&c');
    expect(url).not.toContain(' ');
    expect(url).not.toContain('&c&');
  });
});

describe('searchWeb（解析与降级）', () => {
  it('解析 Abstract（Heading + AbstractText + AbstractURL）', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, {
        Heading: 'Transformer',
        AbstractText: '一种基于注意力的网络结构',
        AbstractURL: 'https://example.com/transformer',
      })) as SearchFetch;
    const out = await searchWeb('Transformer', fetchFn);
    expect(out[0]).toEqual({
      title: 'Transformer',
      url: 'https://example.com/transformer',
      snippet: '一种基于注意力的网络结构',
    });
  });

  it('Abstract 缺失时用 RelatedTopics 叶子条目补齐', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, {
        AbstractText: '',
        RelatedTopics: [
          { FirstURL: 'https://example.com/a', Text: '标题A - 摘要A' },
          { FirstURL: 'https://example.com/b', Text: '标题B - 摘要B' },
        ],
      })) as SearchFetch;
    const out = await searchWeb('q', fetchFn);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: '标题A', url: 'https://example.com/a', snippet: '摘要A' });
  });

  it('RelatedTopics 的嵌套分组（Topics）被摊平', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, {
        RelatedTopics: [
          {
            Name: '分组',
            Topics: [
              { FirstURL: 'https://example.com/x', Text: 'X - 摘要X' },
              { FirstURL: 'https://example.com/y', Text: 'Y - 摘要Y' },
            ],
          },
        ],
      })) as SearchFetch;
    const out = await searchWeb('q', fetchFn);
    expect(out.map((s) => s.url)).toEqual([
      'https://example.com/x',
      'https://example.com/y',
    ]);
  });

  it('同 url 去重（只留首条）', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, {
        RelatedTopics: [
          { FirstURL: 'https://example.com/a', Text: 'A - 1' },
          { FirstURL: 'https://example.com/a', Text: 'A - 2' },
        ],
      })) as SearchFetch;
    expect(await searchWeb('q', fetchFn)).toHaveLength(1);
  });

  it('非 2xx / json 失败 / 网络异常 → 空数组，不 throw', async () => {
    const notOk = (async () => fakeResponse(false, {})) as SearchFetch;
    await expect(searchWeb('q', notOk)).resolves.toEqual([]);
    const badJson = (async () => fakeResponse(true, {}, true)) as SearchFetch;
    await expect(searchWeb('q', badJson)).resolves.toEqual([]);
    const rejected = (async () => {
      throw new Error('network down');
    }) as SearchFetch;
    await expect(searchWeb('q', rejected)).resolves.toEqual([]);
  });

  it('空查询 / 无结果字段 → 空数组', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(true, { foo: 'bar' })) as unknown as SearchFetch;
    expect(await searchWeb('', fetchFn)).toEqual([]);
    expect(await searchWeb('   ', fetchFn)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    const empty = (async () => fakeResponse(true, {})) as SearchFetch;
    expect(await searchWeb('q', empty)).toEqual([]);
  });

  it('缺 FirstURL 或 Text 的条目丢弃', async () => {
    const fetchFn = (async () =>
      fakeResponse(true, {
        RelatedTopics: [
          { FirstURL: '', Text: 'x' },
          { FirstURL: 'https://example.com/a', Text: '' },
          { FirstURL: 'https://example.com/b', Text: 'B - 摘要B' },
          'not-an-object',
        ],
      })) as SearchFetch;
    expect(await searchWeb('q', fetchFn)).toHaveLength(1);
  });

  it('maxResults 限制返回条数', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      FirstURL: `https://example.com/${i}`,
      Text: `T${i} - c`,
    }));
    const fetchFn = (async () => fakeResponse(true, { RelatedTopics: many })) as SearchFetch;
    expect(await searchWeb('q', fetchFn, { maxResults: 2 })).toHaveLength(2);
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
