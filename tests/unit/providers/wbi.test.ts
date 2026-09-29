import { describe, expect, it } from 'vitest';
import {
  MIXIN_KEY_ENC_TAB,
  getMixinKey,
  signWbiParams,
  md5,
} from '../../../src/providers/wbi';

// ---------------------------------------------------------------------------
// md5（RFC 1321 测试向量——必须过，防实现错误）
// ---------------------------------------------------------------------------

describe('md5', () => {
  it('空串 → d41d8cd98f00b204e9800998ecf8427e', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('"abc" → 900150983cd24fb0d6963f7d28e17f72', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('"message digest" → f96b697d7cb7938d525a2f31aaf161d0', () => {
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  it('"abcdefghijklmnopqrstuvwxyz" → c3fcd3d76192e4007dfb496cca67e13b', () => {
    expect(md5('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });
});

// ---------------------------------------------------------------------------
// getMixinKey
// ---------------------------------------------------------------------------

describe('getMixinKey', () => {
  const imgKey = 'df2da2b6df2da2b6df2da2b6df2da2b6';
  const subKey = 'df2da2b6df2da2b6df2da2b6df2da2b6';

  it('固定样例：imgKey=subKey=df2da2b6… → 按表重排的已知值', () => {
    // 手工推导：raw = "df2da2b6"×8，mixinKey[i] = raw[MIXIN_KEY_ENC_TAB[i]]，i<32
    expect(getMixinKey(imgKey, subKey)).toBe('b6222d6d62262d2ddd2fff2d2ab6abf2');
  });

  it('输出长度 32 且确定性（同输入同输出）', () => {
    const a = getMixinKey(imgKey, subKey);
    const b = getMixinKey(imgKey, subKey);
    expect(a).toHaveLength(32);
    expect(a).toBe(b);
  });

  it('输出每个字符都来自原串', () => {
    const raw = imgKey + subKey;
    const key = getMixinKey(imgKey, subKey);
    for (const ch of key) {
      expect(raw).toContain(ch);
    }
  });
});

// ---------------------------------------------------------------------------
// MIXIN_KEY_ENC_TAB
// ---------------------------------------------------------------------------

describe('MIXIN_KEY_ENC_TAB', () => {
  it('长度 64', () => {
    expect(MIXIN_KEY_ENC_TAB).toHaveLength(64);
  });

  it('无重复（每项取值 0~63 恰好一次）', () => {
    expect(new Set(MIXIN_KEY_ENC_TAB).size).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// signWbiParams
// ---------------------------------------------------------------------------

describe('signWbiParams', () => {
  const mixinKey = 'b6222d6d62262d2ddd2fff2d2ab6abf2';

  it('输出包含 wts，末尾为 32 位 hex 的 w_rid', () => {
    const q = signWbiParams({ bvid: 'BV1xx411c7mD', cid: 12345 }, mixinKey, 1700000000);
    expect(q).toContain('wts=1700000000');
    const wRid = q.slice(q.lastIndexOf('w_rid=') + 'w_rid='.length);
    expect(wRid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('参数按 key 字典序排序（wts 参与排序）', () => {
    const q = signWbiParams({ z: 1, a: 2 }, mixinKey, 1700000000);
    const iA = q.indexOf('a=2&');
    const iWts = q.indexOf('wts=1700000000&');
    const iZ = q.indexOf('z=1&');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iWts).toBeGreaterThan(iA);
    expect(iZ).toBeGreaterThan(iWts);
  });

  it('value 中 !\'()* 被过滤', () => {
    const q = signWbiParams({ bvid: "BV!'(1)*" }, mixinKey, 1700000000);
    expect(q).toContain('bvid=BV1');
    expect(q).not.toMatch(/[!'()*]/);
  });

  it('拼接逻辑：query = sorted urlencode + w_rid = md5(query + mixinKey)', () => {
    const q = signWbiParams({ foo: 'bar' }, 'x', 123);
    expect(q).toBe(`foo=bar&wts=123&w_rid=${md5('foo=bar&wts=123x')}`);
  });
});
