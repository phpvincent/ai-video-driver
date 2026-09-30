/**
 * LLM 交互日志单测：截断 / 脱敏 / 请求预览 / 环形缓冲 / 订阅 / 清空。
 * 重点断言：**API Key 绝不进日志**（脱敏生效）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LLM_LOG_KEEP,
  REDACTED,
  REQUEST_PREVIEW_MAX,
  RESPONSE_PREVIEW_MAX,
  buildRequestPreview,
  clearLlmLogs,
  emitLlmLog,
  getLlmLogs,
  hostOfUrl,
  newLogId,
  redactSecrets,
  buildThumbnails,
  describeFrames,
  subscribeLlmLog,
  truncateText,
  THUMB_MAX,
  THUMB_MAX_BYTES,
  type LlmLogEntry,
} from '../../../src/core/metrics/llmLog';
import type { ChatRequest } from '../../../src/core/harness/modelClient';

const SECRET = 'sk-very-secret-key-1234';

function entry(over: Partial<LlmLogEntry> = {}): LlmLogEntry {
  return {
    id: newLogId(),
    at: new Date().toISOString(),
    label: 'qa',
    ok: true,
    model: 'm1',
    endpointHost: 'api.example.com',
    durationMs: 12,
    inputChars: 10,
    outputChars: 20,
    requestPreview: 'req',
    responsePreview: 'res',
    ...over,
  };
}

describe('truncateText', () => {
  it('未超限时原样返回', () => {
    expect(truncateText('abc', 10)).toBe('abc');
  });

  it('超限时截断并标注原长', () => {
    const out = truncateText('x'.repeat(100), 10);
    expect(out.startsWith('x'.repeat(10))).toBe(true);
    expect(out).toContain('100');
  });

  it('max ≤ 0 / 非字符串 → 空串', () => {
    expect(truncateText('abc', 0)).toBe('');
    expect(truncateText(undefined as unknown as string, 10)).toBe('');
  });
});

describe('redactSecrets', () => {
  it('替换出现的密钥', () => {
    expect(redactSecrets(`Bearer ${SECRET}`, [SECRET])).toBe(`Bearer ${REDACTED}`);
  });

  it('多处出现全部替换', () => {
    const out = redactSecrets(`${SECRET} and ${SECRET}`, [SECRET]);
    expect(out).toBe(`${REDACTED} and ${REDACTED}`);
    expect(out).not.toContain(SECRET);
  });

  it('过短的值不参与替换（避免误伤正文）', () => {
    expect(redactSecrets('abc abcd', ['abc'])).toBe('abc abcd');
  });

  it('空密钥列表 / 空文本安全', () => {
    expect(redactSecrets('text', [])).toBe('text');
    expect(redactSecrets('', [SECRET])).toBe('');
  });
});

describe('hostOfUrl', () => {
  it('取主机名；非法 → 无效地址', () => {
    expect(hostOfUrl('https://api.example.com/v1')).toBe('api.example.com');
    expect(hostOfUrl('')).toBe('无效地址');
    expect(hostOfUrl('not a url')).toBe('无效地址');
  });
});

describe('buildRequestPreview', () => {
  const base: ChatRequest = {
    baseUrl: 'https://api.example.com',
    apiKey: SECRET,
    model: 'm1',
    temperature: 0.2,
    maxTokens: 4096,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ],
    responseFormatJson: true,
  };

  it('包含模型参数与消息正文', () => {
    const out = buildRequestPreview(base);
    expect(out).toContain('"model": "m1"');
    expect(out).toContain('hello');
    expect(out).toContain('sys');
  });

  it('**不含** apiKey（请求头与密钥都不进日志）', () => {
    expect(buildRequestPreview(base)).not.toContain(SECRET);
  });

  it('多模态图像只留前缀，不落 base64', () => {
    const req: ChatRequest = {
      ...base,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '看这张' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${'A'.repeat(500)}` } },
          ],
        },
      ],
    };
    const out = buildRequestPreview(req);
    expect(out).not.toContain('A'.repeat(500));
    expect(out).toContain('[image');
  });
});

describe('日志缓冲与订阅', () => {
  beforeEach(() => {
    clearLlmLogs();
  });

  it('新日志在前（新→旧）', () => {
    emitLlmLog(entry({ at: '2026-09-30T10:00:00.000Z' }));
    emitLlmLog(entry({ at: '2026-09-30T11:00:00.000Z' }));
    const logs = getLlmLogs();
    expect(logs[0].at).toBe('2026-09-30T11:00:00.000Z');
  });

  it('订阅者收到新条目；清空时收到 null', () => {
    const seen: Array<LlmLogEntry | null> = [];
    const off = subscribeLlmLog((e) => seen.push(e));
    emitLlmLog(entry());
    clearLlmLogs();
    off();
    emitLlmLog(entry());
    expect(seen).toHaveLength(2);
    expect(seen[0]?.ok).toBe(true);
    expect(seen[1]).toBeNull();
  });

  it('超出 LLM_LOG_KEEP 从最旧一条开始丢弃', () => {
    for (let i = 0; i < LLM_LOG_KEEP + 5; i++) emitLlmLog(entry({ id: `id-${i}` }));
    const logs = getLlmLogs();
    expect(logs).toHaveLength(LLM_LOG_KEEP);
    // 最新的保留，最旧的被丢
    expect(logs[0].id).toBe(`id-${LLM_LOG_KEEP + 4}`);
    expect(logs.some((e) => e.id === 'id-0')).toBe(false);
  });

  it('失败条目带 error；预览长度受上限约束', () => {
    const err = entry({
      ok: false,
      error: 'model http 401: unauthorized',
      responsePreview: truncateText('y'.repeat(9999), RESPONSE_PREVIEW_MAX),
      requestPreview: truncateText('z'.repeat(9999), REQUEST_PREVIEW_MAX),
    });
    emitLlmLog(err);
    const log = getLlmLogs()[0];
    expect(log.ok).toBe(false);
    expect(log.error).toContain('401');
    expect(log.requestPreview.length).toBeLessThanOrEqual(REQUEST_PREVIEW_MAX + 30);
    expect(log.responsePreview.length).toBeLessThanOrEqual(RESPONSE_PREVIEW_MAX + 30);
  });

  it('清空后为空', () => {
    emitLlmLog(entry());
    clearLlmLogs();
    expect(getLlmLogs()).toEqual([]);
  });
});

describe('console 镜像', () => {
  beforeEach(() => {
    clearLlmLogs();
    vi.restoreAllMocks();
  });

  it('失败走 console.error，成功走 console.debug（前缀 [vsc][llm]）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dbgSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    emitLlmLog(entry({ ok: false, error: 'boom' }));
    emitLlmLog(entry({ ok: true }));
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain('[vsc][llm]');
    expect(String(errSpy.mock.calls[0][0])).toContain('FAIL');
    expect(dbgSpy).toHaveBeenCalledTimes(1);
  });
});

describe('帧信息（排查"抽帧太少"）', () => {
  beforeEach(() => {
    clearLlmLogs();
  });

  it('describeFrames：时间点与字节数（base64 长度 ×3/4）', () => {
    const frames = describeFrames([
      { dataBase64: 'A'.repeat(400), timeMs: 12_000 },
      { dataBase64: 'B'.repeat(800), timeMs: 220_000 },
      { dataBase64: 'C'.repeat(100) },
    ]);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({ tMs: 12_000, bytes: 300 });
    expect(frames[1].tMs).toBe(220_000);
    expect(frames[2].tMs).toBe(-1);
  });

  it('空 / undefined → 空数组', () => {
    expect(describeFrames(undefined)).toEqual([]);
    expect(describeFrames([])).toEqual([]);
  });

  it('buildThumbnails 默认关闭（不占存储）', () => {
    const imgs = [{ dataBase64: 'A'.repeat(1000) }];
    expect(buildThumbnails(imgs, false)).toEqual([]);
  });

  it('与帧一一对位：超限原图留空串占位，不再错位', () => {
    const small = { dataBase64: 'A'.repeat(1000) };
    const big = { dataBase64: 'B'.repeat(THUMB_MAX_BYTES + 100) };
    const out = buildThumbnails([small, big, small], true);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^data:image\/jpeg;base64,A/);
    expect(out[1]).toBe('');
    expect(out[2]).toMatch(/^data:image\/jpeg;base64,A/);
  });

  it('优先使用 160px 小图 thumbBase64（896px 原图超限也能看到缩略图）', () => {
    const big = { dataBase64: 'B'.repeat(THUMB_MAX_BYTES + 100), thumbBase64: 'T'.repeat(500) };
    expect(buildThumbnails([big], true)).toEqual([`data:image/jpeg;base64,${'T'.repeat(500)}`]);
  });

  it('最多 THUMB_MAX 张；全部取不到 → 空数组', () => {
    const small = { dataBase64: 'A'.repeat(10) };
    expect(buildThumbnails(Array.from({ length: THUMB_MAX + 5 }, () => small), true)).toHaveLength(THUMB_MAX);
    expect(buildThumbnails([{ dataBase64: 'B'.repeat(THUMB_MAX_BYTES + 1) }], true)).toEqual([]);
  });

  it('describeFrames 记录每帧的配对字幕（便于核对图文是否对上）', () => {
    const [f] = describeFrames([{ dataBase64: 'A', timeMs: 5_000, caption: '【画面 1/1 · 00:05】此刻字幕：你好' }]);
    expect(f.caption).toContain('此刻字幕');
  });
});
