/**
 * 概念图接线层（SPEC-04 四次迭代：阶段流）：
 * 缓存（outlines store，键 `concept::{videoId}::{promptVersion}::{model}`，
 * 红线 7 定向失效——promptVersion 升 0.2.0 自动失效旧域树缓存）+ 生成
 * （buildConceptMap，system prompt 用 src/prompts/concept-map.md 单一事实源，
 * 红线 6）+ 本地术语降级包装。
 * 红线 2 消费侧：锚点只来自章节 startMs（大纲管线吸附产物）。
 */
import { chatCompletion } from '../core/harness/modelClient';
import {
  buildConceptMap,
  buildTermIndexMap,
} from '../core/pipeline/conceptMap';
import type { ConceptModelFn } from '../core/pipeline/types';
import { DB } from '../config';
import { MSG } from '../messages';
import { getConceptMapSystemPrompt, PROMPT_VERSIONS } from '../prompts';
import { VISION } from '../config';
import { requestFrames, toPipelineImage } from './framesClient';
import { visionActiveFor } from './settings/modelForm';
import type { Settings } from '../types';
import { createSubtitleDb } from '../storage/db';
import type { ConceptMapData, ModelConfig, Section } from '../types';

/** 模块级单例 DB（惰性 open 由 db 层内部保证幂等） */
const db = createSubtitleDb();

/** 概念图缓存键：与大纲键（videoId::pv::model）用 `concept::` 前缀隔离，防碰撞 */
export function conceptMapCacheKey(videoId: string, promptVersion: string, model: string): string {
  return `concept::${videoId}::${promptVersion}::${model}`;
}

/**
 * 读概念图缓存（outlines store 同库共存），未命中返回 null。
 * DB 异常不向上抛（缓存降级，红线 8 精神）。
 */
export async function getConceptMapCached(
  videoId: string,
  model: ModelConfig,
): Promise<ConceptMapData | null> {
  try {
    await db.open();
    const rec = await db.get<ConceptMapData>(
      DB.stores.outlines,
      conceptMapCacheKey(videoId, PROMPT_VERSIONS.conceptMap, model.model),
    );
    return rec ?? null;
  } catch {
    return null;
  }
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
async function fetchSettings(): Promise<Settings> {
  const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
  const stored = (response ?? {}) as Settings;
  return stored && typeof stored === 'object' ? stored : {};
}

async function fetchModelConfig(): Promise<ModelConfig | null> {
  const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
  const stored = (response ?? {}) as { model?: ModelConfig };
  return stored.model ?? null;
}

/**
 * 生成概念图（模型路径）：读设置 → buildConceptMap（确定性单调用，红线 1）
 * → 落缓存。模型未配置或两次解析失败 throw（调用方降级到术语关联图）。
 */
export async function generateConceptMap(
  videoId: string,
  sections: Section[],
  videoTitle: string,
): Promise<ConceptMapData> {
  const model = await fetchModelConfig();
  if (!model?.apiKey) {
    throw new Error('模型未配置：请先在设置页配置模型');
  }
  if (sections.length === 0) {
    throw new Error('无章节可用：请先生成大纲');
  }

  // 抽帧（可选）：按章节锚点均匀取 VISION.mindmapFrames 帧
  const settings = (await fetchSettings()) as Settings;
  const useVision = visionActiveFor({ settings, module: 'mindmap' });
  const visionModel = settings.visionModel ?? null;
  let images: ReturnType<typeof toPipelineImage>[] = [];
  if (useVision) {
    const anchors = sections.map((s) => s.startMs);
    const step = Math.max(1, Math.ceil(anchors.length / VISION.mindmapFrames));
    const targets = anchors.filter((_, i) => i % step === 0).slice(0, VISION.mindmapFrames);
    images = (await requestFrames({ videoId, targetsMs: targets })).map(toPipelineImage);
  }

  const modelFn: ConceptModelFn = ({ systemPrompt, userPrompt, images: imgs }) => {
    const withImages = imgs && imgs.length > 0;
    const cfg = withImages && visionModel?.apiKey ? visionModel : model;
    return chatCompletion({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: cfg.temperature.qa,
      maxTokens: cfg.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormatJson: true,
      images: imgs?.map((i) => ({ dataBase64: i.dataBase64, mime: i.mime ?? 'image/jpeg' })),
    }).then((res) => ({ content: res.content }));
  };

  const { stages } = await buildConceptMap({
    sections,
    videoTitle,
    modelFn,
    // 红线 6：system prompt 单一事实源
    getSystemPrompt: getConceptMapSystemPrompt,
    images,
  });

  const data: ConceptMapData = {
    videoId,
    promptVersion: PROMPT_VERSIONS.conceptMap,
    model: model.model,
    stages,
    generatedAt: new Date().toISOString(),
  };

  // 结果落缓存（写失败不阻断返回）
  try {
    await db.open();
    await db.put(DB.stores.outlines, conceptMapCacheKey(videoId, data.promptVersion, data.model), data);
  } catch {
    /* 缓存写失败忽略 */
  }
  return data;
}

/**
 * 本地术语关联图（零模型确定性降级，红线 1）：
 * 供组件在未接线模型路径时直接计算（stages 形状，与模型路径同构）。
 * 降级标记约定（types.ts 的 ConceptMapData 无 degraded 字段）：
 * model='term-index'，MindmapTab 以 isTermIndexData 识别并渲染降级横幅。
 */
export function termIndexFallback(sections: Section[]): ConceptMapData {
  const { stages } = buildTermIndexMap(sections);
  return {
    videoId: '',
    promptVersion: PROMPT_VERSIONS.conceptMap,
    model: 'term-index',
    stages,
    generatedAt: '',
  };
}
