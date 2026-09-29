import { describe, expect, it } from 'vitest';
import { classifySubtitleError } from '../../../src/providers/errors';
import type { SubtitleErrorInput } from '../../../src/providers/errors';

const base: SubtitleErrorInput = {
  httpStatus: 200,
  apiCode: 0,
  hasSubtitleField: true,
  subtitleList: [{ lan: 'zh-CN' }],
};

describe('classifySubtitleError（TECH-DESIGN §7.1 顺序判定）', () => {
  it('fetch 抛错 → network', () => {
    expect(
      classifySubtitleError({ ...base, networkError: new TypeError('Failed to fetch') }),
    ).toBe('network');
  });

  it('5xx → network（请求失败/超时/5xx）', () => {
    expect(classifySubtitleError({ ...base, httpStatus: 502 })).toBe('network');
  });

  it('4xx → api_changed', () => {
    expect(classifySubtitleError({ ...base, httpStatus: 404 })).toBe('api_changed');
  });

  it('code ≠ 0 → api_changed', () => {
    expect(classifySubtitleError({ ...base, apiCode: -101 })).toBe('api_changed');
  });

  it('缺少 data.subtitle 字段 → api_changed', () => {
    expect(classifySubtitleError({ ...base, hasSubtitleField: false, subtitleList: [] })).toBe('api_changed');
  });

  it('空列表 + need_login_subtitle=true → need_login（不得判成 no_subtitle）', () => {
    const status = classifySubtitleError({
      ...base,
      subtitleList: [],
      needLoginSubtitle: true,
    });
    expect(status).toBe('need_login');
    expect(status).not.toBe('no_subtitle');
  });

  it('空列表 + need_login_subtitle=false → no_subtitle', () => {
    expect(
      classifySubtitleError({ ...base, subtitleList: [], needLoginSubtitle: false }),
    ).toBe('no_subtitle');
  });

  it('空列表 + 未提供 need_login_subtitle → no_subtitle', () => {
    expect(classifySubtitleError({ ...base, subtitleList: [] })).toBe('no_subtitle');
  });

  it('列表非空 → ok（有轨可取）', () => {
    expect(
      classifySubtitleError({ ...base, subtitleList: [{ lan: 'ai-zh', subtitle_url: '//x' }] }),
    ).toBe('ok');
  });

  it('networkError 优先于其他条件（httpStatus 同时为 5xx 也不改变结果）', () => {
    expect(
      classifySubtitleError({
        ...base,
        networkError: new TypeError('Failed to fetch'),
        httpStatus: 502,
        apiCode: -101,
        hasSubtitleField: false,
      }),
    ).toBe('network');
  });
});
