/**
 * OpenAI 兼容模型客户端（SPEC-03 3.1，契约见 TECH-DESIGN §7.4）。
 * 只做单次请求与解析：重试 / 熔断 / 超时由调用方（pipeline）负责——
 * 本模块对异常一律 throw，红线 8 约束的是面向用户的结果，内部分层允许抛。
 *
 * baseUrl 为运行时值（来自 ModelConfig），代码中不含任何接口 URL / 密钥字面量。
 */
/** 附带的图像（关键帧）；dataBase64 不含 data: 前缀，mime 缺省 image/jpeg */
export interface ChatImage {
  dataBase64: string;
  mime?: string;
}

/** OpenAI 兼容多模态 content 分片 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessageContent = string | ChatContentPart[];

export interface ChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }>;
  /** true 时请求体带 response_format: {type:'json_object'} */
  responseFormatJson?: boolean;
  /**
   * 随本次请求附带的图像（教学画面关键帧）。非空时 user 消息的 content 变为
   * OpenAI 兼容的多模态数组（text + image_url data URI）。
   *
   * 注意：需模型本身支持图像输入（如 deepseek-chat 不支持视觉，需在设置中换成
   * 多模态模型）；不支持视觉的模型收到数组 content 会报错，由调用方/设置页提示用户。
   */
  images?: ChatImage[];
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

/**
 * 认证类错误的诊断提示：401/403 绝大多数是「Key 与端点不匹配」或「Key 复制带了空白」，
 * 直接告诉用户排查方向，避免只看到一个状态码。
 */
function authHint(status: number): string {
  if (status === 401 || status === 403) {
    return ' — 请检查：①API Key 是否完整且未带空格；②Key 所属平台是否与接口地址匹配（如百炼官方 Key 不能打到 maas 网关，反之亦然）';
  }
  return '';
}

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
 * 构造 user 消息的 content：无图时保持纯字符串（旧行为完全一致）；
 * 有图时返回 [text, ...image_url] 数组（OpenAI 兼容多模态格式）。
 * 纯函数，供单测直接断言。
 */
export function buildUserContent(userPrompt: string, images?: ChatImage[]): ChatMessageContent {
  if (!images || images.length === 0) return userPrompt;
  return [
    { type: 'text', text: userPrompt },
    ...images.map((image) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${image.mime ?? 'image/jpeg'};base64,${image.dataBase64}` },
    })),
  ];
}

/** 把 images 合并进 user 消息（仅当 images 非空，保持无图路径零改动） */
function applyImages(
  messages: ChatRequest['messages'],
  images?: ChatImage[],
): ChatRequest['messages'] {
  if (!images || images.length === 0) return messages;
  return messages.map((m) =>
    m.role === 'user' && typeof m.content === 'string'
      ? { role: m.role, content: buildUserContent(m.content, images) }
      : m,
  );
}

/**
 * 单次 chat completion 调用。非 2xx / 响应非 JSON / 结构缺 choices 时 throw。
 * usage 缺失时 tokens 记 0，不视为错误（部分网关不回 usage）。
 */
export async function chatCompletion(req: ChatRequest, fetchFn: FetchLike = fetch): Promise<ChatResponse> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: applyImages(req.messages, req.images),
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
    throw new Error(`model http ${res.status}: ${summarize(text)}${authHint(res.status)}`);
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
