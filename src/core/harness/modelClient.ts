/**
 * OpenAI 兼容模型客户端（SPEC-03 3.1，契约见 TECH-DESIGN §7.4）。
 * 只做单次请求与解析：重试 / 熔断 / 超时由调用方（pipeline）负责——
 * 本模块对异常一律 throw，红线 8 约束的是面向用户的结果，内部分层允许抛。
 *
 * baseUrl 为运行时值（来自 ModelConfig），代码中不含任何接口 URL / 密钥字面量。
 */
export interface ChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** true 时请求体带 response_format: {type:'json_object'} */
  responseFormatJson?: boolean;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/** 可注入的 fetch（单测 / 调用方定制），默认全局 fetch */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 错误摘要最大长度：防超长 body 污染 trace 与 UI */
const ERROR_SUMMARY_MAX_CHARS = 200;

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > ERROR_SUMMARY_MAX_CHARS
    ? `${compact.slice(0, ERROR_SUMMARY_MAX_CHARS)}…`
    : compact;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toTokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 单次 chat completion 调用。非 2xx / 响应非 JSON / 结构缺 choices 时 throw。
 * usage 缺失时 tokens 记 0，不视为错误（部分网关不回 usage）。
 */
export async function chatCompletion(req: ChatRequest, fetchFn: FetchLike = fetch): Promise<ChatResponse> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
  };
  if (req.responseFormatJson) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`model http ${res.status}: ${summarize(text)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`model response is not json: ${summarize(text)}`);
  }

  const root = asRecord(parsed);
  const choices = root?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('model response missing choices');
  }
  const message = asRecord(asRecord(choices[0])?.message);
  const content = message?.content;
  if (typeof content !== 'string') {
    throw new Error('model response missing choices[0].message.content');
  }

  const usage = asRecord(root?.usage);
  return {
    content,
    inputTokens: toTokens(usage?.prompt_tokens),
    outputTokens: toTokens(usage?.completion_tokens),
  };
}
