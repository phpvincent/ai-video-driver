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
  buildOutlineRegeneratePrompts,
  regenerateSection,
  rescoreOutline,
  runOutline,
  type OutlineModelFn,
  type OutlineResult,
} from '../core/pipeline/outline';
import type { SnappedSection } from '../core/pipeline/snap';
import { MSG } from '../messages';
import {
  getOutlineRegenerateSystemPrompt,
  getOutlineSystemPrompt,
  PROMPT_VERSIONS,
} from '../prompts';
import { createSubtitleDb, getOutline, getSubtitle, saveOutline } from '../storage/db';
import type { ModelConfig, Section } from '../types';

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

/**
 * 只读大纲缓存（挂载自动加载用，SPEC-03 3c 范围变更）：
 * 未命中 / 模型未配置 / DB 异常一律 throw 'NO_CACHE'，由 UI 回到生成按钮态。
 */
export async function loadOutlineCached(videoId: string): Promise<OutlineResult> {
  const model = await fetchModelConfig();
  if (model?.apiKey) {
    try {
      const cached = await getOutline(db, videoId, PROMPT_VERSIONS.outline, model.model);
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
      /* 缓存读失败视作无缓存 */
    }
  }
  throw new Error('NO_CACHE');
}

/** 强制重生成全片大纲（生成 / 全局"重新生成"按钮；forceRefresh 跳过大纲缓存） */
export async function generateOutline(
  videoId: string,
  opts: { onProgress?: LoadOutlineOptions['onProgress'] } = {},
): Promise<OutlineResult> {
  return loadOutlineForVideo(videoId, { forceRefresh: true, onProgress: opts.onProgress });
}

/**
 * 单章替换 + 全片重算（纯函数）：
 * 同 id 的章节替换为 newSection，随后 rescoreOutline 对全片重算 score/density
 * （min-max 归一基准随章节内容变化，必须整体重算）。
 */
export function applyRegenerated(sections: Section[], newSection: Section): Section[] {
  return rescoreOutline(sections.map((s) => (s.id === newSection.id ? newSection : s)));
}

/**
 * 单章重生成（SPEC-03 3c 范围变更 2.3 接线）：
 * 读大纲缓存取基准章节列表 → 字幕缓存取全片 cues → regenerateSection
 * （system prompt 用 outline-regenerate.md 单一事实源，红线 6）→
 * applyRegenerated 替换并全片重算 → saveOutline 更新缓存 → 返回新 OutlineResult。
 */
export async function regenerateOne(
  videoId: string,
  section: Section,
  feedback?: string,
): Promise<OutlineResult> {
  const model = await fetchModelConfig();
  if (!model?.apiKey) {
    throw new Error('模型未配置：请先在设置页配置模型');
  }
  const cached = await getOutline(db, videoId, PROMPT_VERSIONS.outline, model.model);
  if (!cached || cached.sections.length === 0) {
    throw new Error('NO_CACHE');
  }
  const rec = await getSubtitle(db, videoId);
  const cues = rec?.cues ?? [];
  if (cues.length === 0) {
    throw new Error('没有可用字幕，无法重新生成本章');
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

  // 反馈仅方向性引导：空白视为未填写
  const trimmedFeedback = feedback && feedback.trim() ? feedback.trim() : undefined;

  const newSection = await regenerateSection({
    section,
    cues,
    feedback: trimmedFeedback,
    modelFn,
    // 红线 6：system prompt 用正式单一事实源，user 复用 pipeline 的字幕包裹格式
    buildRegenPrompts: ({ section: sec, chunkCues, feedback: fb }) => ({
      systemPrompt: getOutlineRegenerateSystemPrompt(),
      userPrompt: buildOutlineRegeneratePrompts({ section: sec, chunkCues, feedback: fb }).userPrompt,
    }),
  });

  const sections = applyRegenerated(cached.sections, newSection);

  // 更新缓存（保留 promptVersion/model/chunkState/tokenUsage；写失败不阻断返回）
  try {
    await saveOutline(db, { ...cached, sections });
  } catch {
    /* 缓存写失败忽略 */
  }
  return {
    sections,
    chunkState: cached.chunkState,
    droppedBySnap: 0,
    budgetHit: false,
    failedChunks: 0,
  };
}
