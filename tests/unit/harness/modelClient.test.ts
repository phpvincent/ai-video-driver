/**
 * 模型客户端单元测试（SPEC-03 3.1）。
 * 全部经注入 fetchFn 与自建 mock Response 验证，不发真实网络请求。
 * 红线 9：baseUrl 为运行时假域名，apiKey 使用 "test-key" 假值。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildUserContent,
  chatCompletion,
  type ChatRequest,
  type FetchLike,
} from '../../../src/core/harness/modelClient';

const BASE_URL = 'https://api.example.test/v1';
const FAKE_KEY = 'test-key';

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    baseUrl: BASE_URL,
    apiKey: FAKE_KEY,
    model: 'test-model',
    temperature: 0.2,
    maxTokens: 64,
    messages: [
      { role: 'system', content: 'you are a test' },
      { role: 'user', content: 'hello' },
    ],
    ...overrides,
  };
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NORMAL_BODY = {
  choices: [{ message: { role: 'assistant', content: 'world' } }],
  usage: { prompt_tokens: 11, completion_tokens: 7 },
};

/** 记录调用并返回预设 Response 的 mock fetch */
function mockFetch(response: Response | ((url: string, init?: RequestInit) => Response)): {
  fetchFn: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: FetchLike = (url, init) => {
    calls.push({ url, init });
    const res = typeof response === 'function' ? response(url, init) : response;
    return Promise.resolve(res);
  };
  return { fetchFn, calls };
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('chatCompletion', () => {
  it('正常返回：content 与 usage 正确映射', async () => {
    const { fetchFn } = mockFetch(okResponse(NORMAL_BODY));
    const res = await chatCompletion(makeRequest(), fetchFn);
    expect(res.content).toBe('world');
    expect(res.inputTokens).toBe(11);
    expect(res.outputTokens).toBe(7);
  });

  it('URL 拼接：baseUrl 尾部斜杠被规范化', async () => {
    const { fetchFn, calls } = mockFetch(okResponse(NORMAL_BODY));
    await chatCompletion(makeRequest({ baseUrl: `${BASE_URL}///` }), fetchFn);
    expect(calls[0]?.url).toBe(`${BASE_URL}/chat/completions`);
  });

  it('请求头含 Bearer + apiKey，body 为 POST JSON', async () => {
    const { fetchFn, calls } = mockFetch(okResponse(NORMAL_BODY));
    await chatCompletion(makeRequest(), fetchFn);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('请求体携带 model / messages / temperature / max_tokens', async () => {
    const { fetchFn, calls } = mockFetch(okResponse(NORMAL_BODY));
    const req = makeRequest();
    await chatCompletion(req, fetchFn);
    const body = parseBody(calls[0]?.init);
    expect(body['model']).toBe('test-model');
    expect(body['temperature']).toBe(0.2);
    expect(body['max_tokens']).toBe(64);
    expect(body['messages']).toEqual(req.messages);
  });

  it('responseFormatJson=true 时 body 含 response_format，且默认不带', async () => {
    const withJson = mockFetch(okResponse(NORMAL_BODY));
    await chatCompletion(makeRequest({ responseFormatJson: true }), withJson.fetchFn);
    expect(parseBody(withJson.calls[0]?.init)['response_format']).toEqual({ type: 'json_object' });

    const withoutJson = mockFetch(okResponse(NORMAL_BODY));
    await chatCompletion(makeRequest(), withoutJson.fetchFn);
    expect(parseBody(withoutJson.calls[0]?.init)['response_format']).toBeUndefined();
  });

  it('401 → throw 且消息含 401 与响应摘要', async () => {
    const { fetchFn } = mockFetch(
      okResponse({ error: { message: 'Invalid API key' } }, 401),
    );
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow('401');
    // 401 需带排查方向提示（Key 与端点不匹配是最常见原因）；mock 响应体只能读一次，新建一份
    const again = mockFetch(okResponse({ error: { message: 'Invalid API key' } }, 401));
    await expect(chatCompletion(makeRequest(), again.fetchFn)).rejects.toThrow(/端点|Key/);
  });

  it('thinking 字段 → body 含 thinking 参数', async () => {
    const { fetchFn, calls } = mockFetch(okResponse({ choices: [{ message: { content: 'ok' } }] }));
    await chatCompletion({ ...makeRequest(), thinking: { type: 'disabled' } }, fetchFn);
    expect(parseBody(calls[0]?.init).thinking).toEqual({ type: 'disabled' });
  });

  it('content 为空且含 reasoning_content → 提示思考耗尽 token', async () => {
    const { fetchFn } = mockFetch(
      okResponse({ choices: [{ message: { content: '', reasoning_content: 'thinking...' } }] }),
    );
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/思考过程耗尽/);
  });

  it('fetch 抛错（网络层失败）→ 提示未收到服务器响应与排查方向', async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/未收到服务器响应/);
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/网络\/代理/);
  });

  it('500 → throw 且消息含 500', async () => {
    const { fetchFn } = mockFetch(new Response('internal server error', { status: 500 }));
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow('500');
  });

  it('非 2xx 错误摘要被压缩：超长 body 截断到 200 字符', async () => {
    const longText = 'x'.repeat(5000);
    const { fetchFn } = mockFetch(new Response(longText, { status: 502 }));
    let err: unknown;
    try {
      await chatCompletion(makeRequest(), fetchFn);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('502');
    expect(message.length).toBeLessThan(300);
  });

  it('响应非 JSON → throw', async () => {
    const { fetchFn } = mockFetch(new Response('<html>gateway</html>', { status: 200 }));
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/not json/i);
  });

  it('choices 缺失 → throw', async () => {
    const { fetchFn } = mockFetch(okResponse({ usage: { prompt_tokens: 1 } }));
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/missing choices/);
  });

  it('choices 为空数组 → throw', async () => {
    const { fetchFn } = mockFetch(okResponse({ choices: [] }));
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/missing choices/);
  });

  it('message.content 非 string → throw', async () => {
    const { fetchFn } = mockFetch(okResponse({ choices: [{ message: { content: null } }] }));
    await expect(chatCompletion(makeRequest(), fetchFn)).rejects.toThrow(/content/);
  });

  it('usage 缺失 → tokens 记 0，不 throw', async () => {
    const { fetchFn } = mockFetch(okResponse({ choices: [{ message: { content: 'hi' } }] }));
    const res = await chatCompletion(makeRequest(), fetchFn);
    expect(res.content).toBe('hi');
    expect(res.inputTokens).toBe(0);
    expect(res.outputTokens).toBe(0);
  });

  it('注入 fetchFn 被调用且仅调用一次', async () => {
    const spy = vi.fn(() => Promise.resolve(okResponse(NORMAL_BODY)));
    await chatCompletion(makeRequest(), spy as unknown as FetchLike);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('images 为空 / 缺省：messages 与请求一致（旧行为不回归）', async () => {
    const withEmpty = mockFetch(okResponse(NORMAL_BODY));
    await chatCompletion(makeRequest({ images: [] }), withEmpty.fetchFn);
    const req = makeRequest();
    expect(parseBody(withEmpty.calls[0]?.init)['messages']).toEqual(req.messages);
  });

  it('多 role 消息原样透传（system/user/assistant）', async () => {
    const { fetchFn, calls } = mockFetch(okResponse(NORMAL_BODY));
    const messages = [
      { role: 'system' as const, content: 's' },
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'u2' },
    ];
    await chatCompletion(makeRequest({ messages }), fetchFn);
    expect(parseBody(calls[0]?.init)['messages']).toEqual(messages);
  });
});

/**
 * 多模态扩展（关键帧视觉问答）：user 消息 content 由字符串升级为
 * [text, ...image_url] 数组；无图时保持纯字符串。
 * 注意：需模型支持图像输入（如 deepseek-chat 不支持视觉，需在设置中换多模态模型）。
 */
describe('buildUserContent（多模态 content 构造）', () => {
  it('无图（undefined / 空数组）→ 纯字符串', () => {
    expect(buildUserContent('你好')).toBe('你好');
    expect(buildUserContent('你好', [])).toBe('你好');
  });

  it('有图 → [text, ...image_url]，顺序为文本在前', () => {
    const content = buildUserContent('问题', [{ dataBase64: 'QUFB' }, { dataBase64: 'QkJC' }]);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', text: '问题' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUFB' } });
    expect(parts[2]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QkJC' } });
  });

  it('mime 缺省 image/jpeg，自定义时按自定义拼 data URI', () => {
    const parts = buildUserContent('问题', [{ dataBase64: 'Q0ND', mime: 'image/png' }]) as Array<
      Record<string, unknown>
    >;
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,Q0ND' } });
  });
});

describe('chatCompletion 图像传递', () => {
  it('images 非空 → user content 变数组且含 data URI，system 保持字符串', async () => {
    const { fetchFn, calls } = mockFetch(okResponse(NORMAL_BODY));
    await chatCompletion(
      makeRequest({ images: [{ dataBase64: 'QUFB' }, { dataBase64: 'QkJC' }] }),
      fetchFn,
    );
    const messages = parseBody(calls[0]?.init)['messages'] as Array<{
      role: string;
      content: unknown;
    }>;
    expect(messages[0]?.content).toBe('you are a test');
    const userContent = messages[1]?.content as Array<Record<string, unknown>>;
    expect(userContent[0]).toEqual({ type: 'text', text: 'hello' });
    expect(userContent).toHaveLength(3);
    expect(
      (userContent[1]?.['image_url'] as { url: string }).url.startsWith('data:image/jpeg;base64,'),
    ).toBe(true);
  });

  it('只有 user 消息被改造（assistant 消息原样透传）', async () => {
    const { fetchFn, calls } = mockFetch(okResponse(NORMAL_BODY));
    const messages = [
      { role: 'system' as const, content: 's' },
      { role: 'user' as const, content: 'u' },
      { role: 'assistant' as const, content: 'a' },
    ];
    await chatCompletion(makeRequest({ messages, images: [{ dataBase64: 'QUFB' }] }), fetchFn);
    const sent = parseBody(calls[0]?.init)['messages'] as Array<{ role: string; content: unknown }>;
    expect(sent[0]?.content).toBe('s');
    expect(sent[2]?.content).toBe('a');
    expect(Array.isArray(sent[1]?.content)).toBe(true);
  });
});
