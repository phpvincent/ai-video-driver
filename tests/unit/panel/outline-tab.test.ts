/**
 * 大纲 Tab 单元测试（SPEC-03 3.4 + 3c 范围变更）。
 * 环境为 node 且未安装 @testing-library/react：
 * 纯逻辑直接断言；渲染用 react-dom/server 的 renderToString（不含 effect，
 * 挂载自动加载等 effect 驱动逻辑不在本文件覆盖范围）。
 */
import {
  createElement } from 'react';
import {
  renderToString } from 'react-dom/server';
import {
  describe, expect, it } from 'vitest';
import {
  densityFromScore } from '../../../src/core/pipeline/density';
import {
  describeOutlineFailure,
  OUTLINE_MODEL_NOT_READY_TEXT,
  OUTLINE_PHASE_TEXT,
  OUTLINE_REGEN_PLACEHOLDER,
  OutlineSectionList,
  OUTLINE_FAILURE_NO_DETAIL,
  OutlineTab,
  badgeLabel,
  densityLabel,
  findActiveSection,
  formatRange,
} from '../../../src/panel/OutlineTab';
import { applyRegenerated } from '../../../src/panel/outlineLoader';
import type { Section } from '../../../src/types';

const section = (
  id: string,
  startMs: number,
  endMs: number,
  title: string,
  extra: Partial<Section> = {},
): Section => ({
  id,
  title,
  startMs,
  endMs,
  summary: `${title}的摘要`,
  bullets: [
    { text: `${title}要点一`, startMs },
    { text: `${title}要点二`, startMs: endMs - 1 },
  ],
  terms: ['术语A'],
  importance: 3,
  cueRange: [0, 1],
  density: 'mid',
  ...extra,
});

const sections = [
  section('sec_0001', 0, 60_000, '开场与环境准备'),
  section('sec_0002', 60_000, 180_000, '核心概念讲解'),
  section('sec_0003', 180_000, 300_000, '实战演示'),
];

/** OutlineTab 注入函数的兜底实现（renderToString 不触发 effect，不应被调用） */
const rejectLoader = () => Promise.reject(new Error('不应被调用'));

describe('findActiveSection', () => {
  it('命中首章（positionMs = 0）', () => {
    expect(findActiveSection(sections, 0)?.id).toBe('sec_0001');
  });

  it('命中中间章', () => {
    expect(findActiveSection(sections, 120_000)?.id).toBe('sec_0002');
  });

  it('命中末章，且超过末章 endMs 仍停留末章', () => {
    expect(findActiveSection(sections, 200_000)?.id).toBe('sec_0003');
    expect(findActiveSection(sections, 999_999)?.id).toBe('sec_0003');
  });

  it('间隙取最后 startMs<=positionMs 的章（endMs 为开区间边界）', () => {
    // 末章 endMs=300_000 为开区间边界：恰好等于时按"最后 startMs<=pos"仍属末章
    expect(findActiveSection(sections, 300_000)?.id).toBe('sec_0003');
  });

  it('空数组返回 null', () => {
    expect(findActiveSection([], 1000)).toBeNull();
  });

  it('positionMs 早于首章 startMs 返回 null', () => {
    expect(findActiveSection(sections, -1)).toBeNull();
  });
});

describe('formatRange（章节时间范围 mm:ss - mm:ss）', () => {
  it('常规范围：01:05 - 02:00', () => {
    expect(formatRange(65_000, 120_000)).toBe('01:05 - 02:00');
  });

  it('零起点：00:00 - 00:59', () => {
    expect(formatRange(0, 59_999)).toBe('00:00 - 00:59');
  });

  it('章节头渲染等宽范围时间戳', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 65_000, 120_000, '格式化验证章')],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('>01:05 - 02:00</span>');
  });

  it('0ms 起点渲染为 00:00 - 01:00', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 0, 60_000, '零点验证章')],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('>00:00 - 01:00</span>');
  });
});

describe('分数徽标（score 优先，缺失回退 density 文字）', () => {
  it('score 87 → "87 分"', () => {
    expect(badgeLabel({ ...section('s', 0, 1000, '标题'), score: 87 })).toBe('87 分');
  });

  it('score 缺失 → 回退 densityLabel(density)', () => {
    const s = section('s', 0, 1000, '标题', { density: 'high' });
    expect(s.score).toBeUndefined();
    expect(badgeLabel(s)).toBe('高密');
  });

  it('渲染：score 87 + density high → "87 分" 且保留 high 颜色类', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 0, 60_000, '高分区', { score: 87, density: 'high' })],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('>87 分</span>');
    expect(html).toContain('outline-density high');
  });

  it('渲染：无 score 时显示旧 density 徽标', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 0, 60_000, '回退章', { density: 'high' })],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('>高密</span>');
  });
});

describe('bullets 渲染（带吸附后时间戳，可点跳播）', () => {
  it('带 startMs 的要点显示 [mm:ss]', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [section('sec_0001', 65_000, 120_000, '要点时间章')],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('[01:05]</button>');
    expect(html).toContain('要点时间章要点一');
  });

  it('approximate 要点时间戳后带 ~ 号且加 approx 类', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [
          section('sec_0001', 65_000, 120_000, '近似章', {
            bullets: [{ text: '近似要点', startMs: 65_000, approximate: true }],
          }),
        ],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('[01:05~]</button>');
    expect(html).toContain('outline-bullet-time approx');
  });
});

describe('单章重生成 UI 状态', () => {
  it('每章渲染 ↻ 按钮（title 提示）', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections,
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('重新生成本章');
    expect(html).toContain('↻');
  });

  it('regeneratingId 章节显示生成中 + regenerating 类，且 ↻ 按钮禁用', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections,
        activeId: null,
        onSeek: () => {},
        regeneratingId: 'sec_0002',
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('outline-section active regenerating');
    // 打磨后：重生成卡片复用选中高亮（active）并平滑滚动聚焦
    expect(html).toContain('本章重新生成中…');
    expect(html).toContain('<button type="button" class="outline-regen-btn" disabled=""');
  });

  it('regenError 章节显示错误信息与重试按钮', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections,
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: { sectionId: 'sec_0003', text: '模型调用超时' },
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('模型调用超时');
    expect(html).toContain('重试');
    // 错误只显示在目标章节上，其他章不受影响
    expect(html).toContain('outline-regen-error');
  });

  it('内联反馈输入框 placeholder 引导方向性反馈', () => {
    expect(OUTLINE_REGEN_PLACEHOLDER).toContain('可选');
    expect(OUTLINE_REGEN_PLACEHOLDER).toContain('方向');
  });
});

describe('applyRegenerated（单章替换 + 全片重算，outlineLoader）', () => {
  /** 三章等长（各 1 分钟），术语/重要性可区分，便于断言 min-max 归一变化 */
  const base = [
    section('sec_0001', 0, 60_000, '术语密集章', {
      terms: ['t1', 't2', 't3'],
      importance: 5,
    }),
    section('sec_0002', 60_000, 120_000, '无术语章', { terms: [], importance: 1 }),
    section('sec_0003', 120_000, 180_000, '普通章', { terms: ['t4'], importance: 3 }),
  ];

  it('同 id 替换：长度不变、新内容生效、其他章保留', () => {
    const newSec = section('sec_0002', 60_000, 120_000, '重生成的新章', {
      terms: ['t5', 't6'],
      importance: 4,
    });
    const out = applyRegenerated(base, newSec);
    expect(out).toHaveLength(3);
    expect(out[1].id).toBe('sec_0002');
    expect(out[1].title).toBe('重生成的新章');
    expect(out[0].title).toBe('术语密集章');
    expect(out[2].title).toBe('普通章');
  });

  it('rescore 后 score/density 重算：低分章换新内容后分数上升并重分档', () => {
    // 替换前 sec_0002（无术语、importance 1）经全片归一为最低分 → low
    const before = applyRegenerated(base, base[1]);
    expect(before[1].score).toBe(0);
    expect(before[1].density).toBe('low');

    const newSec = section('sec_0002', 60_000, 120_000, '重生成的新章', {
      terms: ['t5', 't6'],
      importance: 4,
    });
    const out = applyRegenerated(base, newSec);
    // 新内容带来新术语与更高 importance：分数显著上升并落入 mid 档
    expect(out[1].score).toBeGreaterThan(30);
    expect(out[1].density).toBe('mid');
    // 全片重算保持 score 与分档一致
    for (const s of out) {
      expect(s.density).toBe(densityFromScore(s.score as number));
    }
  });

  it('替换后原章节的占位 score（regenerateSection 返回 0）被重算覆盖', () => {
    const newSec = section('sec_0001', 0, 60_000, '重生成章', {
      terms: ['t1', 't2', 't3'],
      importance: 5,
      score: 0,
      density: 'mid',
    });
    const out = applyRegenerated(base, newSec);
    expect(out[0].score).not.toBe(0);
    expect(out[0].score).toBe(100);
    expect(out[0].density).toBe('high');
  });
});

describe('状态文案映射', () => {
  it('idle / loading / degraded / empty 均有文案，ready 为空串', () => {
    expect(OUTLINE_PHASE_TEXT.idle).toContain('生成');
    expect(OUTLINE_PHASE_TEXT.loading).toContain('大纲生成中');
    expect(OUTLINE_PHASE_TEXT.degraded).toContain('失败');
    expect(OUTLINE_PHASE_TEXT.empty).toContain('字幕');
    expect(OUTLINE_PHASE_TEXT.ready).toBe('');
  });

  it('模型未配置文案', () => {
    expect(OUTLINE_MODEL_NOT_READY_TEXT).toContain('设置页');
  });
});

describe('densityLabel（score 缺失时的回退文案）', () => {
  it('undefined → "-" 占位', () => {
    expect(densityLabel(undefined)).toBe('-');
  });

  it('high / mid / low 映射', () => {
    expect(densityLabel('high')).toBe('高密');
    expect(densityLabel('mid')).toBe('中密');
    expect(densityLabel('low')).toBe('低密');
  });
});

describe('renderToString 冒烟', () => {
  it('ready 主体渲染章节标题、要点、术语与密度徽标', () => {
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections,
        activeId: 'sec_0002',
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('核心概念讲解');
    expect(html).toContain('核心概念讲解要点一');
    expect(html).toContain('核心概念讲解要点二');
    expect(html).toContain('术语A');
    // 测试 helper 默认无 score → 回退 density 徽标（mid → 中密）
    expect(html).toContain('>中密</span>');
    expect(html).toContain('outline-section active');
  });

  it('带 density 的 section 渲染徽标', () => {
    const withDensity = section('sec_0001', 0, 60_000, '高密度章', { density: 'high' });
    const html = renderToString(
      createElement(OutlineSectionList, {
        sections: [withDensity],
        activeId: null,
        onSeek: () => {},
        regeneratingId: null,
        regenError: null,
        onSubmitRegen: () => {},
      }),
    );
    expect(html).toContain('高密');
  });

  it('无 videoId 时渲染 idle 占位', () => {
    const html = renderToString(
      createElement(OutlineTab, {
        videoId: null,
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadOutlineCached: rejectLoader,
        generateOutline: rejectLoader,
        regenerateOne: rejectLoader,
        modelReady: true,
      }),
    );
    expect(html).toContain('打开 B 站视频');
  });

  it('modelReady=false 时提示配置模型（不调 loader）', () => {
    const html = renderToString(
      createElement(OutlineTab, {
        videoId: 'bv1xx_p1',
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadOutlineCached: rejectLoader,
        generateOutline: rejectLoader,
        regenerateOne: rejectLoader,
        modelReady: false,
        onOpenSettings: () => {},
      }),
    );
    expect(html).toContain(OUTLINE_MODEL_NOT_READY_TEXT);
    expect(html).toContain('去设置');
  });

  it('有 videoId 且 modelReady 时渲染生成入口（renderToString 不触发自动加载 effect）', () => {
    const html = renderToString(
      createElement(OutlineTab, {
        videoId: 'bv1xx_p1',
        meta: null,
        positionMs: 0,
        onRequestSeek: () => {},
        loadOutlineCached: rejectLoader,
        generateOutline: rejectLoader,
        regenerateOne: rejectLoader,
        modelReady: true,
      }),
    );
    expect(html).toContain('生成大纲');
  });
});

describe('describeOutlineFailure 失败原因可读', () => {
  it('分块未过校验 → 说明失败块数与可尝试动作', () => {
    const r = {
      sections: [],
      chunkState: [{ index: 0, status: 'failed', startMs: 0, endMs: 1000, error: 'zod: bullets 缺失' }],
      droppedBySnap: 0,
      budgetHit: false,
      failedChunks: 1,
    } as never;
    const text = describeOutlineFailure(r);
    expect(text).toContain('1/1');
    expect(text).toContain('未通过格式校验');
    expect(text).toContain('zod: bullets 缺失');
  });

  it('预算熔断时额外提示', () => {
    const r = {
      sections: [],
      chunkState: [{ index: 0, status: 'failed', startMs: 0, endMs: 1000 }],
      droppedBySnap: 0,
      budgetHit: true,
      failedChunks: 1,
    } as never;
    expect(describeOutlineFailure(r)).toContain('预算熔断');
  });

  it('无分块信息 → 通用文案', () => {
    const r = { sections: [], chunkState: [], droppedBySnap: 0, budgetHit: false, failedChunks: 0 } as never;
    // 无分块信息时也必须有可读原因，不能只说"请重试"
    expect(describeOutlineFailure(r)).toBe(OUTLINE_FAILURE_NO_DETAIL);
  });
});
