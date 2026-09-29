import { describe, expect, it } from 'vitest';
import { runOutline } from '../../../src/core/pipeline/outline';
import type { OutlineModelFn, SectionCandidate } from '../../../src/core/pipeline/types';
import { OUTLINE } from '../../../src/config';
import type { Cue } from '../../../src/types';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const mkCue = (i: number, startMs: number): Cue => ({
  index: i,
  startMs,
  endMs: startMs + 5_000,
  text: `c${i}:`.padEnd(99, 'x'), // 权重 100
});

/** 20 条 Cue × 权重 100，10s 间隔 → 两块：chunk0 = cues[0..17]（0~170s），chunk1 = cues[16..19]（160~190s） */
const twoChunkCues = (): Cue[] => Array.from({ length: 20 }, (_, i) => mkCue(i, i * 10_000));

/** 5 条 Cue × 权重 100 → 单块 */
const oneChunkCues = (gapMs = 20_000): Cue[] =>
  Array.from({ length: 5 }, (_, i) => mkCue(i, i * gapMs));

const CAND = (
  title: string,
  startSec: number,
  bullets: string[] = ['要点'],
  terms: string[] = [],
  importance = 3,
): SectionCandidate => ({
  title,
  startSec,
  summary: '本章摘要',
  bullets: bullets.map((text) => ({ text, startSec })),
  terms,
  importance,
});

const json = (sections: SectionCandidate[]): string => JSON.stringify({ sections });

/** 按 userPrompt 中的 Cue 标记分发（c0: 只在 chunk0；c19: 只在 chunk1） */
const byChunk = (
  fn: (chunkNo: number) => Promise<{ content: string }>,
): OutlineModelFn => async (req) => fn(req.userPrompt.includes('c0:') ? 0 : 1);

describe('runOutline（A1/A2/A3/A4/A6 编排）', () => {
  // 注：除"最短章节强制"专项用例外，以下用例传 minSectionDurationMs=0 关闭
  // 90s 最短章节强制，聚焦各自原有语义（吸附/合并/校验/熔断等）。
  it('正常两块 → 两块章节均在且按时间排序，chunkState 全部 done', async () => {
    const modelFn: OutlineModelFn = byChunk(async (n) =>
      n === 0
        ? { content: json([CAND('课程介绍与环境搭建', 0), CAND('变量与类型系统', 150)]) }
        : { content: json([CAND('循环与流程控制', 160)]) },
    );
    const res = await runOutline(twoChunkCues(), modelFn, { minSectionDurationMs: 0 });

    expect(res.sections.map((s) => s.startMs)).toEqual([0, 150_000, 160_000]);
    expect(res.sections.map((s) => s.title)).toEqual(['课程介绍与环境搭建', '变量与类型系统', '循环与流程控制']);
    expect(res.chunkState).toHaveLength(2);
    expect(res.chunkState.every((s) => s.status === 'done')).toBe(true);
    expect(res.failedChunks).toBe(0);
    expect(res.droppedBySnap).toBe(0);
    expect(res.budgetHit).toBe(false);
    // chunkState 时间范围
    expect(res.chunkState[0].startMs).toBe(0);
    expect(res.chunkState[0].endMs).toBe(175_000); // cues[17].endMs
    expect(res.chunkState[1].startMs).toBe(160_000);
    expect(res.chunkState[1].endMs).toBe(195_000); // cues[19].endMs
  });

  it('endMs 链与 cueRange：下一章 startMs - 1，末章 = 末条 Cue.endMs', async () => {
    const modelFn: OutlineModelFn = byChunk(async (n) =>
      n === 0
        ? { content: json([CAND('课程介绍与环境搭建', 0), CAND('变量与类型系统', 150)]) }
        : { content: json([CAND('循环与流程控制', 160)]) },
    );
    const res = await runOutline(twoChunkCues(), modelFn, { minSectionDurationMs: 0 });
    const [s1, s2, s3] = res.sections;
    expect(s1.endMs).toBe(149_999);
    expect(s2.endMs).toBe(159_999);
    expect(s3.endMs).toBe(195_000); // 末条 Cue.endMs
    expect(s1.cueRange).toEqual([0, 14]);
    expect(s2.cueRange).toEqual([15, 15]);
    expect(s3.cueRange).toEqual([16, 19]);
    expect(s1.id).toBe('sec_0001');
    expect(s3.id).toBe('sec_0003');
  });

  it('吸附：候选偏移 ±3s → startMs 严格等于真实 Cue.startMs（红线 2）', async () => {
    // 20s 间隔：cue0=0s, cue2=40s；候选 3s / 37s；32s 为幻觉（标题互不相似，避免增量合并干扰）
    const modelFn: OutlineModelFn = async () => ({
      content: json([CAND('课程导论', 3), CAND('类型讲解', 37), CAND('幻觉演示', 32)]),
    });
    const res = await runOutline(oneChunkCues(), modelFn, { minSectionDurationMs: 0 });
    expect(res.sections).toHaveLength(2);
    expect(res.sections[0].startMs).toBe(0); // 严格相等，非约等于
    expect(res.sections[1].startMs).toBe(40_000);
  });

  it('吸附：偏移 > 5s → 该章节被丢弃且 droppedBySnap 计数（红线 2 幻觉路径）', async () => {
    const modelFn: OutlineModelFn = async () => ({
      content: json([CAND('章节标题甲', 0), CAND('幻觉章节', 46)]), // 距最近 Cue 6s
    });
    const res = await runOutline(oneChunkCues(), modelFn);
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].title).toBe('章节标题甲');
    expect(res.droppedBySnap).toBe(1);
  });

  it('红线 2 专项：输出所有 Section.startMs ∈ cues 的 startMs 集合', async () => {
    const cues = twoChunkCues();
    const modelFn: OutlineModelFn = byChunk(async (n) =>
      n === 0
        ? { content: json([CAND('课程介绍与环境搭建', 0), CAND('变量与类型系统', 150)]) }
        : { content: json([CAND('循环与流程控制', 163), CAND('函数封装实践', 181)]) },
    );
    const res = await runOutline(cues, modelFn, { minSectionDurationMs: 0 });
    expect(res.sections.length).toBeGreaterThanOrEqual(3);
    const cueStarts = new Set(cues.map((c) => c.startMs));
    for (const s of res.sections) expect(cueStarts.has(s.startMs)).toBe(true);
  });

  it('Schema 失败 → 附错误信息重试 1 次后成功', async () => {
    let calls = 0;
    const modelFn: OutlineModelFn = async () => {
      calls += 1;
      if (calls === 1) return { content: '不是 JSON' };
      return { content: json([CAND('环境搭建与初始配置', 0)]) };
    };
    const res = await runOutline(oneChunkCues(), modelFn);
    expect(calls).toBe(2);
    expect(res.chunkState[0].status).toBe('done');
    expect(res.chunkState[0].retries).toBe(1);
    expect(res.sections).toHaveLength(1);
    expect(res.failedChunks).toBe(0);
  });

  it('两次 Schema 失败 → 该块 failed，不阻断其他块（红线 4）', async () => {
    const chunk1Calls: string[] = [];
    const modelFn: OutlineModelFn = byChunk(async (n) => {
      if (n === 0) return { content: json([CAND('课程介绍与环境搭建', 0)]) };
      chunk1Calls.push('bad');
      return { content: '依然不是 JSON' };
    });
    const res = await runOutline(twoChunkCues(), modelFn);
    expect(chunk1Calls).toHaveLength(2); // 重试 1 次后放弃
    expect(res.chunkState[1].status).toBe('failed');
    expect(res.chunkState[1].error).toBeTruthy();
    expect(res.failedChunks).toBe(1);
    expect(res.chunkState[0].status).toBe('done');
    expect(res.sections.map((s) => s.title)).toEqual(['课程介绍与环境搭建']); // 其他块正常产出
  });

  it('modelFn 抛错 → 重试后仍失败 → 该块 failed 不阻断', async () => {
    const modelFn: OutlineModelFn = byChunk(async (n) => {
      if (n === 0) return { content: json([CAND('课程介绍与环境搭建', 0)]) };
      throw new Error('网络炸了');
    });
    const res = await runOutline(twoChunkCues(), modelFn);
    expect(res.chunkState[1].status).toBe('failed');
    expect(res.chunkState[1].error).toContain('网络炸了');
    expect(res.failedChunks).toBe(1);
    expect(res.sections).toHaveLength(1);
  });

  it('单块超时 → 视为失败可重试，两次超时后 failed', async () => {
    const modelFn: OutlineModelFn = async () => {
      await sleep(60);
      return { content: json([CAND('环境搭建与初始配置', 0)]) };
    };
    const res = await runOutline(oneChunkCues(), modelFn, { chunkTimeoutMs: 20 });
    expect(res.chunkState[0].status).toBe('failed');
    expect(res.chunkState[0].error).toContain('超时');
    expect(res.sections).toEqual([]);
    expect(res.failedChunks).toBe(1);
  });

  it('并发度：最大同时在飞数 = OUTLINE.concurrency（3），不超过', async () => {
    const cues = Array.from({ length: 80 }, (_, i) => mkCue(i, i * 10_000)); // → 5 块
    let inflight = 0;
    let maxInflight = 0;
    const modelFn: OutlineModelFn = async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await sleep(15);
      inflight -= 1;
      return { content: json([]) };
    };
    const res = await runOutline(cues, modelFn);
    expect(maxInflight).toBe(OUTLINE.concurrency);
    expect(maxInflight).toBeLessThanOrEqual(OUTLINE.concurrency);
    expect(res.chunkState).toHaveLength(5);
    expect(res.chunkState.every((s) => s.status === 'done')).toBe(true);
  });

  it('预算熔断：极小预算 → budgetHit=true 且部分块 skipped，已完成块保留（A6）', async () => {
    // 注入固定 200 字符 prompt（保留块标识）→ 每块估算 100 token；预算 100 只够第一块
    const modelFn: OutlineModelFn = byChunk(async (n) =>
      n === 0 ? { content: json([CAND('课程介绍与环境搭建', 0)]) } : { content: json([]) },
    );
    const res = await runOutline(twoChunkCues(), modelFn, {
      tokenBudget: 100,
      buildPrompts: (chunk) => ({
        systemPrompt: 's'.repeat(60),
        userPrompt: `${chunk[0].index === 0 ? 'c0' : 'c19'}:` + 'u'.repeat(137), // 共 140 字符
      }),
    });
    expect(res.budgetHit).toBe(true);
    expect(res.chunkState[0].status).toBe('done');
    expect(res.chunkState[0].skipped).toBeUndefined();
    expect(res.chunkState[1].skipped).toBe(true);
    expect(res.chunkState[1].status).toBe('pending'); // 未启动
    expect(res.failedChunks).toBe(0);
    expect(res.sections.map((s) => s.title)).toEqual(['课程介绍与环境搭建']);
  });

  it('空 cues → sections 为空且不调用 modelFn', async () => {
    let calls = 0;
    const modelFn: OutlineModelFn = async () => {
      calls += 1;
      return { content: json([]) };
    };
    const res = await runOutline([], modelFn);
    expect(calls).toBe(0);
    expect(res.sections).toEqual([]);
    expect(res.chunkState).toEqual([]);
    expect(res.droppedBySnap).toBe(0);
    expect(res.budgetHit).toBe(false);
  });

  it('增量合并：两块产出标题相似 + 时间相邻的候选 → 合并为一个 Section', async () => {
    const modelFn: OutlineModelFn = byChunk(async (n) =>
      n === 0
        ? {
            content: json([
              CAND('课程介绍', 0, ['课程总览'], ['入门']),
              CAND('变量与类型系统', 150, ['变量声明'], ['变量']),
            ]),
          }
        : { content: json([CAND('变量与类型系统详解', 160, ['作用域规则'], ['变量', '作用域'])]) },
    );
    const res = await runOutline(twoChunkCues(), modelFn, { minSectionDurationMs: 0 });
    expect(res.sections).toHaveLength(2); // 160s 候题并入 150s 尾部
    expect(res.sections[1].startMs).toBe(150_000);
    expect(res.sections[1].title).toBe('变量与类型系统');
    expect(res.sections[1].bullets).toEqual([
      { text: '变量声明', startMs: 150_000 },
      { text: '作用域规则', startMs: 160_000 },
    ]);
    expect(res.sections[1].terms).toEqual(['变量', '作用域']);
  });

  it('确定性：后完成的块不改变结果（按块下标顺序合并，红线 1）', async () => {
    const expected = {
      sections: [
        { startMs: 0, title: '课程介绍与环境搭建' },
        { startMs: 150_000, title: '变量与类型系统' },
        { startMs: 160_000, title: '循环与流程控制' },
      ],
    };
    const build = (slowSecond: boolean): OutlineModelFn => async (req) => {
      const chunkNo = req.userPrompt.includes('c0:') ? 0 : 1;
      if (chunkNo === 1 && slowSecond) await sleep(25);
      return {
        content:
          chunkNo === 0
            ? json([CAND('课程介绍与环境搭建', 0), CAND('变量与类型系统', 150)])
            : json([CAND('循环与流程控制', 160)]),
      };
    };
    const res = await runOutline(twoChunkCues(), build(false), { minSectionDurationMs: 0 });
    const resDelayed = await runOutline(twoChunkCues(), build(true), { minSectionDurationMs: 0 });
    expect(resDelayed.sections.map((s) => ({ startMs: s.startMs, title: s.title }))).toEqual(
      expected.sections,
    );
    expect(resDelayed.sections).toEqual(res.sections);
  });

  it('最短章节强制（默认 90s）：过短章节并入相邻较长者，产物仍通过覆盖校验', async () => {
    // oneChunkCues：5 条 Cue 20s 间隔（0..80s，末尾 85s）；两章各 ~45s → 全部不达标 → 并成一章
    const modelFn: OutlineModelFn = async () => ({
      content: json([CAND('第一章节标题甲', 0, ['甲要点']), CAND('第二章节标题乙', 45, ['乙要点'])]),
    });
    const res = await runOutline(oneChunkCues(), modelFn); // 不关 minSectionDurationMs
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0].startMs).toBe(0);
    expect(res.sections[0].endMs).toBe(85_000);
    // 后章（40s，末章按 85s 计）更短 → 并入前邻，保留前邻标题，bullets 合并
    expect(res.sections[0].title).toBe('第一章节标题甲');
    expect(res.sections[0].bullets).toEqual([
      { text: '甲要点', startMs: 0 },
      { text: '乙要点', startMs: 40_000 }, // 45s 候选 bullet 吸附到最近 Cue（40s）
    ]);
    // 产物携带 importance 与 score
    expect(res.sections[0].importance).toBe(3);
    expect(res.sections[0].score).toBe(50); // 单章退化 → 中位
    expect(res.sections[0].density).toBe('mid');
  });
});
