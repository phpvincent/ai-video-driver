import { describe, expect, it, vi } from 'vitest';
import { ensureHostPermission, hasHostPermission, originOfBaseUrl } from '../../../src/platform';

/** 注入 chrome.permissions 的最小假实现 */
function fakePermissions(impl: { contains?: boolean; request?: boolean | Error }) {
  const perms = {
    contains: vi.fn().mockResolvedValue(impl.contains ?? false),
    request: impl.request instanceof Error
      ? vi.fn().mockRejectedValue(impl.request)
      : vi.fn().mockResolvedValue(impl.request ?? false),
  };
  (globalThis as { chrome?: unknown }).chrome = { permissions: perms };
  return perms;
}

function clearChrome(): void {
  delete (globalThis as { chrome?: unknown }).chrome;
}

describe('originOfBaseUrl（红线 9：不触碰具体端点）', () => {
  it('从 baseUrl 提取协议+域名+端口', () => {
    expect(originOfBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com');
    expect(originOfBaseUrl('http://127.0.0.1:27123/x')).toBe('http://127.0.0.1:27123');
    expect(originOfBaseUrl('  https://a.b.com  ')).toBe('https://a.b.com');
  });
  it('非法输入返回 null', () => {
    expect(originOfBaseUrl('')).toBeNull();
    expect(originOfBaseUrl('not a url')).toBeNull();
    expect(originOfBaseUrl('ftp://example.com')).toBeNull();
  });
});

describe('ensureHostPermission（SPEC-08 8.3 / A4）', () => {
  it('已含权限 → granted，不再弹申请', async () => {
    const perms = fakePermissions({ contains: true });
    expect(await ensureHostPermission('https://api.example.com')).toBe('granted');
    expect(perms.request).not.toHaveBeenCalled();
    clearChrome();
  });

  it('未含权限 → 发起申请，用户同意 → granted', async () => {
    const perms = fakePermissions({ contains: false, request: true });
    expect(await ensureHostPermission('https://api.example.com')).toBe('granted');
    expect(perms.request).toHaveBeenCalledWith({ origins: ['https://api.example.com'] });
    clearChrome();
  });

  it('用户拒绝 → denied', async () => {
    fakePermissions({ contains: false, request: false });
    expect(await ensureHostPermission('https://api.example.com')).toBe('denied');
    clearChrome();
  });

  it('申请抛错（非用户手势上下文等）→ denied，不向上抛', async () => {
    fakePermissions({ contains: false, request: new Error('no user gesture') });
    await expect(ensureHostPermission('https://api.example.com')).resolves.toBe('denied');
    clearChrome();
  });

  it('permissions API 不存在 → unsupported（降级为旧行为，不白屏）', async () => {
    clearChrome();
    expect(await ensureHostPermission('https://api.example.com')).toBe('unsupported');
    expect(await hasHostPermission('https://api.example.com')).toBeNull();
  });

  it('非法 origin → invalid', async () => {
    expect(await ensureHostPermission('example.com')).toBe('invalid');
  });
});
