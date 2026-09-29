/**
 * 大纲 pipeline 接线层（SPEC-03 子任务 3.4，组装模式参考 subtitleLoader）：
 * harness chatCompletion + pipeline runOutline + 正式 prompt（src/prompts/outline.md
 * 单一事实源，红线 6）+ 字幕缓存读取（storage）。
 *
 * 本任务不落大纲缓存：OutlineRecord（键 [videoId, promptVersion, model]）写入
 * 待子任务 3.5 之后接线（TODO）。红线 2 消费侧：UI 跳播只用吸附后的 section.startMs。
 */
import { chatCompletion } from '../core/harness/modelClient';
import {
  buildOutlinePrompts,
  runOutline,
  type OutlineModelFn,
  type OutlineResult,
} from '../core/pipeline/outline';
import { MSG } from '../messages';
import { getOutlineSystemPrompt } from '../prompts';
import { createSubtitleDb, getSubtitle } from '../storage/db';
import type { Cue, ModelConfig } from '../types';

/** 模块级单例 DB（惰性 open 由 db 层内部保证幂等） */
const db = createSubtitleDb();

/**
 * 组装真实模型依赖并跑 outline pipeline。
 * cues 为空时直接返回空结果，不调模型（Tab 显示"先在字幕 Tab 获取字幕"）。
 */
export async function loadOutline(
  videoId: string,
  cues: Cue[],
  model: ModelConfig,
): Promise<OutlineResult> {
  // TODO(缓存)：videoId 将作为 OutlineRecord 主键之一（[videoId, promptVersion, model] 落 outlines store，3.5 之后接线）
  if (cues.length === 0) {
    return { sections: [], chunkState: [], droppedBySnap: 0, budgetHit: false, failedChunks: 0 };
  }

  // TODO(进度)：runOutline 暂无块级进度钩子，UI 只能整体 loading；
  // 流式渲染（已完成块 n/总数 + 已确认章节）需 pipeline 暴露 onProgress 后接入。
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

  return runOutline(cues, modelFn, {
    tokenBudget: model.outlineTokenBudget,
    // 红线 6：system prompt 用正式单一事实源，user 复用 pipeline 的字幕包裹格式
    // （重试时 pipeline 会在 userPrompt 上附加错误信息，system 不变）。
    buildPrompts: (chunk) => ({
      systemPrompt: getOutlineSystemPrompt(),
      userPrompt: buildOutlinePrompts(chunk).userPrompt,
    }),
  });
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

/**
 * panel 侧完整入口：读设置拿模型配置、读字幕缓存拿 cues，再跑 loadOutline。
 * 模型未配置 / 字幕不存在均由返回结果或 throw 交给 OutlineTab 状态机呈现。
 */
export async function loadOutlineForVideo(videoId: string): Promise<OutlineResult> {
  const model = await fetchModelConfig();
  if (!model?.apiKey) {
    throw new Error('模型未配置：请先在设置页配置模型');
  }
  const rec = await getSubtitle(db, videoId);
  return loadOutline(videoId, rec?.cues ?? [], model);
}
