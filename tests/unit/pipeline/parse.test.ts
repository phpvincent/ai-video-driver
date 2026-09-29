import { describe, expect, it } from 'vitest';
import { parseModelOutline } from '../../../src/core/pipeline/outline';

const CAND = {
  title: '环境搭建与初始配置',
  startSec: 12,
  summary: '介绍开发环境准备与工具安装',
  bullets: [{ text: '安装基础工具', startSec: 12 }],
  terms: ['node'],
  importance: 3,
};

describe('parseModelOutline（A3 Schema 校验，红线 4）', () => {
  it('合法 JSON 且符合 Schema → 返回候选数组', () => {
    const out = parseModelOutline(
      JSON.stringify({ sections: [CAND, { ...CAND, title: '变量与类型系统', startSec: 60 }] }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(CAND);
    expect(out[1].startSec).toBe(60);
  });

  it('非法 JSON → throw', () => {
    expect(() => parseModelOutline('这不是 JSON')).toThrow(/JSON/);
  });

  it('title 过短（< 4 字）→ throw', () => {
    expect(() => parseModelOutline(JSON.stringify({ sections: [{ ...CAND, title: 'ab' }] }))).toThrow(
      /Schema/,
    );
  });

  it('bullets 6 条（max 5）→ throw', () => {
    expect(() =>
      parseModelOutline(
        JSON.stringify({
          sections: [
            { ...CAND, bullets: [1, 2, 3, 4, 5, 6].map((i) => ({ text: `${i}`, startSec: i })) },
          ],
        }),
      ),
    ).toThrow(/Schema/);
  });

  it('bullets 为纯字符串数组（旧格式）→ throw（3c 起必须为 {text, startSec} 对象）', () => {
    expect(() =>
      parseModelOutline(JSON.stringify({ sections: [{ ...CAND, bullets: ['安装基础工具'] }] })),
    ).toThrow(/Schema/);
  });

  it('bullets 项缺 startSec 或 text 为空 → throw', () => {
    expect(() =>
      parseModelOutline(
        JSON.stringify({ sections: [{ ...CAND, bullets: [{ text: '要点' }] }] }),
      ),
    ).toThrow(/Schema/);
    expect(() =>
      parseModelOutline(
        JSON.stringify({ sections: [{ ...CAND, bullets: [{ text: '', startSec: 0 }] }] }),
      ),
    ).toThrow(/Schema/);
  });

  it('importance 缺失 / 超出 1-5 → throw（3c 起必填）', () => {
    expect(() => {
      const { importance: _ignored, ...noImp } = CAND;
      parseModelOutline(JSON.stringify({ sections: [noImp] }));
    }).toThrow(/Schema/);
    expect(() =>
      parseModelOutline(JSON.stringify({ sections: [{ ...CAND, importance: 0 }] })),
    ).toThrow(/Schema/);
    expect(() =>
      parseModelOutline(JSON.stringify({ sections: [{ ...CAND, importance: 6 }] })),
    ).toThrow(/Schema/);
  });

  it('importance 非整数 → throw', () => {
    expect(() =>
      parseModelOutline(JSON.stringify({ sections: [{ ...CAND, importance: 3.5 }] })),
    ).toThrow(/Schema/);
  });

  it('startSec 为负数 / 非整数 → throw', () => {
    expect(() => parseModelOutline(JSON.stringify({ sections: [{ ...CAND, startSec: -1 }] }))).toThrow(
      /Schema/,
    );
    expect(() => parseModelOutline(JSON.stringify({ sections: [{ ...CAND, startSec: 1.5 }] }))).toThrow(
      /Schema/,
    );
  });

  it('缺少 sections 字段 → throw', () => {
    expect(() => parseModelOutline(JSON.stringify({ chapters: [] }))).toThrow(/Schema/);
  });
});
