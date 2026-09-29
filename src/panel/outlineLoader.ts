/**
 * 大纲 pipeline 接线层（SPEC-03 3.4 + 父 agent 收尾接线）：
 * harness chatCompletion + pipeline runOutline + 正式 prompt（src/prompts/outline.md
 * 单一事实源，红线 6）+ 字幕缓存读取 + 大纲缓存（outlines store，键
 * [videoId, promptVersion, model]，红线 7 定向失效）+ 进度钩子透传。
 * 红线 2 消费侧：UI 跳播只用吸附后的 section.startMs。
 */
import { chatCompletion } from '../core/harness/modelClient';
import {
  buildOutlinePrompts,
  runOutline,
  type OutlineModelFn,
  type OutlineResult,
} from '../core/pipeline/outline';
import type { SnappedSection } from '../core/pipeline/snap';
import { MSG } from '../messages';
import { getOutlineSystemPrompt, PROMPT_VERSIONS } from '../prompts';
import { createSubtitleDb, getOutline, getSubtitle, saveOutline } from '../storage/db';
import type { ModelConfig } from '../types';

/** 模块级单例 DB（惰性 open 由 db 层内部保证幂等） */
const db = createSubtitleDb();

export interface LoadOutlineOptions {
  /** 跳过大纲缓存强制重生成 */
  forceRefresh?: boolean;
  /** 进度回调（流式渲染）：confirmed 为未 finalize 的章节快照（已吸附，无 density/id） */
  onProgress?: (confirmed: SnappedSection[], doneChunks: number, totalChunks: number) => void;
}

/**
 * panel 侧完整入口：读设置拿模型配置 → 大纲缓存命中直接返回（红线 7 键含
 * promptVersion+model）→ 未命中读字幕缓存跑 pipeline → 结果落缓存（含 chunkState 断点）。
 * 模型未配置 throw（OutlineTab 状态机呈现）；DB 异常不阻断生成（缓存降级）。
 */
export async function loadOutlineForVideo(
  videoId: string,
  opts: LoadOutlineOptions = {},
): Promise<OutlineResult> {
  const model = await fetchModelConfig();
  if (!model?.apiKey) {
    throw new Error('模型未配置：请先在设置页配置模型');
  }
  const promptVersion = PROMPT_VERSIONS.outline;

  if (!opts.forceRefresh) {
    try {
      const cached = await getOutline(db, videoId, promptVersion, model.model);
      if (cached && cached.sections.length > 0) {
        return {
          sections: cached.sections,
          chunkState: cached.chunkState,
          droppedBySnap: 0,
          budgetHit: false,
          failedChunks: 0,
        };
      }
    } catch {
      /* 缓存读失败降级为重新生成（红线 8 精神） */
    }
  }

  const rec = await getSubtitle(db, videoId);
  const cues = rec?.cues ?? [];
  if (cues.length === 0) {
    return { sections: [], chunkState: [], droppedBySnap: 0, budgetHit: false, failedChunks: 0 };
  }

  const modelFn: OutlineModelFn = ({ systemPrompt, userPrompt }) =>
    chatCompletion({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature.outline,
      maxTokens: model.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormatJson: true,
    }).then((res) => ({ content: res.content }));

  const result = await runOutline(cues, modelFn, {
    tokenBudget: model.outlineTokenBudget,
    // 红线 6：system prompt 用正式单一事实源，user 复用 pipeline 的字幕包裹格式
    // （重试时 pipeline 会在 userPrompt 上附加错误信息，system 不变）。
    buildPrompts: (chunk) => ({
      systemPrompt: getOutlineSystemPrompt(),
      userPrompt: buildOutlinePrompts(chunk).userPrompt,
    }),
    onProgress: opts.onProgress,
  });

  // 结果落缓存（含 chunkState 断点供续跑；写失败不阻断返回）
  if (result.sections.length > 0) {
    try {
      await saveOutline(db, {
        videoId,
        promptVersion,
        model: model.model,
        sections: result.sections,
        chunkState: result.chunkState,
        tokenUsage: {
          input: result.chunkState.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
          output: result.chunkState.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
        },
        createdAt: '',
      });
    } catch {
      /* 缓存写失败忽略 */
    }
  }
  return result;
}

/** chrome.runtime.sendMessage 的安全包装：上下文失效时返回 null */
function sendRuntimeMessage(message: unknown): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    return Promise.resolve(null);
  }
}

/** 读设置中的 ModelConfig；未配置返回 null */
async function fetchModelConfig(): Promise<ModelConfig | null> {
  const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
  const stored = (response ?? {}) as { model?: ModelConfig };
  return stored.model ?? null;
}
