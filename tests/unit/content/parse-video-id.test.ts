import { describe, expect, it } from 'vitest';
import { parseVideoId, toVideoId } from '../../../src/content/bilibili';

describe('parseVideoId', () => {
  it('标准 URL 无 p 参数默认 page 1', () => {
    expect(parseVideoId('https://www.bilibili.com/video/BV1YG7G6eEPR')).toEqual({
      bvid: 'BV1YG7G6eEPR',
      page: 1,
    });
  });

  it('?p=3 解析为 page 3', () => {
    expect(parseVideoId('https://www.bilibili.com/video/BV1YG7G6eEPR/?p=3')).toEqual({
      bvid: 'BV1YG7G6eEPR',
      page: 3,
    });
  });

  it('query 乱序时仍取 p 参数（p=11）', () => {
    expect(
      parseVideoId(
        'https://www.bilibili.com/video/BV1YG7G6eEPR/?spm_id_from=333.337.search-card.all.click&vd_source=abc&p=11',
      ),
    ).toEqual({ bvid: 'BV1YG7G6eEPR', page: 11 });
  });

  it('无尾斜杠 + ?p=2 解析为 page 2', () => {
    expect(parseVideoId('https://www.bilibili.com/video/BV1YG7G6eEPR?p=2')).toEqual({
      bvid: 'BV1YG7G6eEPR',
      page: 2,
    });
  });

  it('尾斜杠无 p 参数默认 page 1', () => {
    expect(parseVideoId('https://www.bilibili.com/video/BV1YG7G6eEPR/')).toEqual({
      bvid: 'BV1YG7G6eEPR',
      page: 1,
    });
  });

  it('非视频页或非 B 站域名返回 null', () => {
    expect(parseVideoId('https://www.bilibili.com/')).toBeNull();
    expect(parseVideoId('https://example.com/video/BV1YG7G6eEPR')).toBeNull();
  });

  it('非法 p 参数回退默认 page 1', () => {
    expect(parseVideoId('https://www.bilibili.com/video/BV1YG7G6eEPR?p=abc')).toEqual({
      bvid: 'BV1YG7G6eEPR',
      page: 1,
    });
    expect(parseVideoId('https://www.bilibili.com/video/BV1YG7G6eEPR?p=0')).toEqual({
      bvid: 'BV1YG7G6eEPR',
      page: 1,
    });
  });
});

describe('toVideoId', () => {
  it('bvid + page 拼接为 {bvid}_p{page}', () => {
    expect(toVideoId('BV1YG7G6eEPR', 3)).toBe('BV1YG7G6eEPR_p3');
  });

  it('page 1 同样带 _p1 后缀', () => {
    expect(toVideoId('BV1YG7G6eEPR', 1)).toBe('BV1YG7G6eEPR_p1');
  });
});
