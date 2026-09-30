/**
 * zod 环境初始化单测（MV3 CSP：禁止 eval / new Function）。
 *
 * zodEnv 必须在 zod 的任何 schema 实例化之前求值，因此本文件**首行** import 它，
 * 其后再 import 真正创建 schema 的模块，以此复现扩展的加载时序。
 */
import '../../../src/core/zodEnv';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { OutlineChunkSchema } from '../../../src/core/pipeline/types';
import { ConceptStagesSchema } from '../../../src/core/pipeline/conceptMap';
import { PersonaSchema } from '../../../src/core/pipeline/persona';

/** Cached 的私有字段：getter 未被消费说明该缓存尚未求值 */
function cacheNotEvaluated(cached: unknown): boolean {
  return (cached as { _getter?: unknown })._getter !== undefined;
}

describe('zodEnv（关闭 JIT，避免 CSP eval 探测）', () => {
  it('全局配置 jitless = true', () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });

  it('实例化对象 schema 不会触发 allowsEval 探测（探测即 new Function）', () => {
    // 上面三个 schema 在 import 期已实例化；若 jitless 生效，探测不该发生
    expect(cacheNotEvaluated(z.core.util.allowsEval)).toBe(true);
  });

  it('schema 校验仍然可用（关闭 JIT 不影响功能）', () => {
    const ok = OutlineChunkSchema.safeParse({
      sections: [
        {
          title: '章节一标题',
          startSec: 0,
          summary: '摘要',
          bullets: [{ text: '要点', startSec: 3 }],
          terms: ['术语'],
          importance: 4,
        },
      ],
    });
    expect(ok.success).toBe(true);

    const bad = OutlineChunkSchema.safeParse({ sections: [{ title: '短' }] });
    expect(bad.success).toBe(false);

    // 阶段 3~5 个、每阶段概念 2~6 个（与 CONCEPT_MAP 阈值一致）
    const stage = (n: number) => ({
      label: `阶段${n}`,
      concepts: [
        { label: `概念${n}A`, importance: 3, anchorSections: [n], details: [] },
        { label: `概念${n}B`, importance: 2, anchorSections: [n], details: [] },
      ],
    });
    const stages = ConceptStagesSchema.safeParse({ stages: [stage(1), stage(2), stage(3)] });
    expect(stages.success).toBe(true);

    const persona = PersonaSchema.safeParse({ role: 'AI 讲师', expertise: ['a', 'b'], style: 'x' });
    expect(persona.success).toBe(true);
  });
});
