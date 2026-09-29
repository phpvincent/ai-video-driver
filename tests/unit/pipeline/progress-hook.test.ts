/**
 * runOutline 进度钩子单测（父 agent 收尾接线补充）。
 * 断言：每个有产出的块确认后触发一次回调；done 单调递增至 total；
 * confirmed 为该时刻已合并章节快照；回调抛错不阻断 pipeline。
 */
import { describe, expect, it } from 'vitest';
import type { Cue } from '../../../src/types';
import { runOutline, type OutlineModelFn } from '../../../src/core/pipeline/outline';

function makeCues(n: number, textLen = 40): Cue[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    startMs: i * 4000,
    endMs: i * 4000 + 3800,
    text: `${'字'.repeat(textLen)}第${i}句`,
  }));
}

const okModel: OutlineModelFn = async () => ({
  content: JSON.stringify({
    sections: [
      {
        title: `章节标题占位${Math.random().toFixed(0)}`,
        startSec: 0,
        summary: '摘要',
        bullets: [{ text: '要点', startSec: 0 }],
        terms: ['术语A'],
        importance: 3,
      },
    ],
  }),
});

describe('runOutline onProgress', () => {
  it('每个有产出的块触发一次，done 单调递增，confirmed 快照非空', async () => {
    const cues = makeCues(120); // 足够切成多块
    const events: Array<{ done: number; total: number; confirmedLen: number }> = [];
    const result = await runOutline(cues, okModel, {
      onProgress: (confirmed, done, total) => {
        events.push({ done, total, confirmedLen: confirmed.length });
      },
    });
    expect(result.chunkState.filter((s) => s.status === 'done').length).toBeGreaterThan(1);
    expect(events.length).toBe(result.chunkState.filter((s) => s.status === 'done').length);
    expect(events[0].done).toBe(1);
    expect(events[events.length - 1].done).toBe(events[events.length - 1].total);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].done).toBe(events[i - 1].done + 1);
    }
    // 首次回调就应有已确认章节
    expect(events[0].confirmedLen).toBeGreaterThan(0);
  });

  it('回调抛错不阻断 pipeline（进度提示非关键路径）', async () => {
    const cues = makeCues(120);
    const result = await runOutline(cues, okModel, {
      onProgress: () => {
        throw new Error('callback boom');
      },
    });
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.failedChunks).toBe(0);
  });

  it('空 cues 不触发回调', async () => {
    let called = 0;
    const result = await runOutline([], okModel, {
      onProgress: () => {
        called += 1;
      },
    });
    expect(result.sections).toHaveLength(0);
    expect(called).toBe(0);
  });
});
