/**
 * 问答组装层（SPEC-05 父 agent 接线）：explain pipeline + 真实 prompt
 * （prompts/index 单一事实源，红线 6）+ qaHistory 落库（buildQaRecord 盖章）。
 * ChatTab 的 explain props 由本模块实现。
 */
import { findSectionAt } from '../core/context/compiler';
import { visionActiveFor } from './settings/modelForm';
import { VISION } from '../config';
import { chatCompletion } from '../core/harness/modelClient';
import {
  buildKnowledgeContext,
  extractQueryTerms,
  searchIndex,
} from '../core/knowledge/retriever';
import {
  answerSegment,
  buildQaRecord,
  explainTerm,
  type ExplainInput,
  type ExplainModelFn,
} from '../core/pipeline/explain';
import { MSG } from '../messages';
import {
  getSegmentQaSystemPrompt,
  getTermExplainerSystemPrompt,
  PROMPT_VERSIONS,
} from '../prompts';
import { createSubtitleDb, getOutline, getSubtitle, saveQaRecord } from '../storage/db';
import type { Cue, KnowledgeHit, ModelConfig, QaRecord, Section } from '../types';
import type { ExplainRequest, ExplainResponse } from './ChatTab';
import { getObsidianConfig, readIndex } from './obsidianLoader';
import { personaInstruction } from '../core/pipeline/persona';
import { getPersonaCached } from './personaLoader';
import { buildWebContext, searchWeb, trimSnippets } from '../core/knowledge/webSearch';
import { CONTEXT, WEB_SEARCH } from '../config';
import type { WebSnippet } from '../core/knowledge/webSearch';
import type { CapturedFrame } from '../messages';

const db = createSubtitleDb();

/** App 当前视频 id 的共享 ref（App 接线时设置，explain 时读取） */
export const currentVideoIdRef: { value: string | null } = { value: null };

/** chrome.runtime.sendMessage 安全包装 */
function sendRuntimeMessage(message: unknown): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    return Promise.resolve(null);
  }
}

/** 读完整 settings（model 分区 + 知识库检索开关等顶层项） */
async function fetchSettings(): Promise<Record<string, unknown>> {
  const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
  const stored = (response ?? {}) as Record<string, unknown>;
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * 个人知识库检索（SPEC-05 范围变更第 4 条）：
 * 开关闭合 + Obsidian 已配置时才检索；任何异常（未配置 / 未启动 / 索引缺失）
 * 一律静默降级为空上下文，不阻断问答（红线 8 精神）。
 */
async function loadKnowledge(args: {
  question: string;
  sections: Section[];
  positionMs: number;
  enabled: boolean;
}): Promise<{ hits: KnowledgeHit[]; context: string }> {
  if (!args.enabled) return { hits: [], context: '' };
  try {
    const obsidianConfig = await getObsidianConfig();
    if (!obsidianConfig) return { hits: [], context: '' };
    const index = await readIndex(obsidianConfig);
    const section = findSectionAt(args.sections, args.positionMs);
    const queryTerms = extractQueryTerms({
      question: args.question,
      sectionTerms: section?.terms,
      positionMs: args.positionMs,
    });
    const hits = searchIndex({ index, queryTerms });
    return { hits, context: buildKnowledgeContext(hits) };
  } catch {
    return { hits: [], context: '' };
  }
}

/** ChatTab explain props 的实现（App 接线传入） */
/**
 * 公开资料检索（可选）：仅当用户在设置里配置了检索服务并开启时才调用；
 * 未配置 / 失败一律返回空，不阻断问答。结果走与字幕、知识库同一预算。
 */
async function loadWeb(args: {
  enabled: boolean;
  query: string;
}): Promise<{ snippets: WebSnippet[]; context: string }> {
  if (!args.enabled) return { snippets: [], context: '' };
  const settings = await fetchSettings();
  const cfg = settings.webSearch as { endpoint?: string; apiKey?: string; engine?: string } | undefined;
  if (!cfg?.endpoint || !cfg?.apiKey) return { snippets: [], context: '' };
  try {
    const raw = await searchWeb(
      { endpoint: cfg.endpoint, apiKey: cfg.apiKey, engine: cfg.engine },
      ((url: string, init?: RequestInit) => fetch(url, init)) as never,
      args.query,
      { maxResults: WEB_SEARCH.defaultMaxResults },
    );
    const snippets = trimSnippets(raw, CONTEXT.webContextMaxChars);
    return { snippets, context: buildWebContext(snippets, CONTEXT.webContextMaxChars) };
  } catch {
    return { snippets: [], context: '' };
  }
}

/**
 * 关键帧抽取（视觉问答）：向 content 请求区间内若干帧。
 * 需要用户开启"结合画面回答"；content 未就绪 / videoId 不符 / 抽帧失败 → 空数组。
 */
async function loadFrames(args: {
  enabled: boolean;
  videoId: string;
  rangeMs: [number, number] | null;
  positionMs: number;
}): Promise<CapturedFrame[]> {
  if (!args.enabled) return [];
  const [start, end] = args.rangeMs ?? [args.positionMs - 30_000, args.positionMs + 30_000];
  const targets = [start, Math.round((start + end) / 2), args.positionMs]
    .filter((t) => Number.isFinite(t) && t >= 0)
    .slice(0, VISION.qaFrames);
  if (targets.length === 0) return [];
  try {
    const response = (await sendRuntimeMessage({
      type: MSG.CAPTURE_FRAMES,
      payload: { videoId: args.videoId, targetsMs: targets },
    })) as { frames?: CapturedFrame[] } | null;
    return Array.isArray(response?.frames) ? response!.frames! : [];
  } catch {
    return [];
  }
}

export async function explain(args: ExplainRequest): Promise<ExplainResponse> {
  const settings = await fetchSettings();
  const model = (settings.model as ModelConfig | undefined) ?? null;
  if (!model?.apiKey) throw new Error('模型未配置：请先在设置页配置模型');
  /** 问答时检索个人知识库（默认开启；未存过该项也视为开启） */
  const knowledgeSearch = settings.knowledgeSearch !== false;

  const videoId = currentVideoIdRef.value;
  if (!videoId) throw new Error('未检测到视频');

  const [subRec, outlineRec] = await Promise.all([
    getSubtitle(db, videoId).catch(() => null),
    getOutline(db, videoId, PROMPT_VERSIONS.outline, model.model).catch(() => null),
  ]);
  const cues: Cue[] = subRec?.cues ?? [];
  const sections: Section[] = outlineRec?.sections ?? [];

  // 知识库检索（术语解释复用当前章节 terms；区间/自由提问用问题原文）
  const knowledge = await loadKnowledge({
    question: args.term ?? args.question,
    sections,
    positionMs: args.positionMs,
    enabled: knowledgeSearch,
  });

  // 公开资料检索（可选，与字幕/知识库共享预算）
  const web = await loadWeb({
    enabled: settings.webSearchEnabled !== false && settings.webSearch !== undefined,
    query: args.term ?? args.question,
  });
  // 关键帧（可选：需多模态模型，deepseek-chat 不支持视觉）
  const frames = await loadFrames({
    enabled: visionActiveFor({ settings, module: 'qa' }),
    videoId,
    rangeMs: args.rangeMs,
    positionMs: args.positionMs,
  });

  // 动态角色（每视频一次判定并缓存；失败自动降级默认角色，不阻断问答）
  const persona = await getPersonaCached(videoId, model).catch(() => null);
  const personaHint = persona ? personaInstruction(persona) : '';

  const input: ExplainInput = {
    sections,
    cues,
    rangeMs: args.rangeMs,
    positionMs: args.positionMs,
    // 知识库与公开资料各自带独立分隔标记，合并进同一素材分区
    knowledgeContext: [knowledge.context, web.context].filter(Boolean).join('\n\n'),
    images: frames.map((f) => ({
      dataBase64: f.dataBase64,
      mime: 'image/jpeg',
      timeMs: f.actualMs,
    })),
  };

  // 单模型口径：图片与文本一起发给同一个模型
  const modelFn: ExplainModelFn = ({ systemPrompt, userPrompt, images }) => {
    // 带图的请求走视觉模型（用户可另配 Qwen 等），不带图仍走文本模型
    const cfg = model;
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
      // 多模态：图像由 explain 层透传（需模型支持，如未支持会返回错误由重试逻辑处理）
      images: images?.map((i) => ({ dataBase64: i.dataBase64, mime: i.mime })),
    }).then((res) => ({ content: res.content }));
  };

  if (args.term) {
    const term = await explainTerm({
      term: args.term,
      input,
      modelFn,
      getSystemPrompt: getTermExplainerSystemPrompt,
      personaInstruction: personaHint,
    });
    const record: QaRecord = buildQaRecord({
      videoId,
      interactionType: 'term',
      input,
      question: args.term,
      answer: `${term.inVideoMeaning}\n\n通用定义：${term.generalDefinition}\n\n类比：${term.analogy}`,
      payload: term,
    });
    await saveQaRecord(db, record).catch(() => {});
    return { term, record, hits: knowledge.hits, sources: web.snippets };
  }

  const answer = await answerSegment({
    question: args.question,
    input,
    modelFn,
    getSystemPrompt: getSegmentQaSystemPrompt,
    personaInstruction: personaHint,
  });
  const record: QaRecord = buildQaRecord({
    videoId,
    interactionType: args.rangeMs ? 'segment' : 'free',
    input,
    question: args.question,
    answer: answer.answer,
    payload: answer,
  });
  await saveQaRecord(db, record).catch(() => {});
  return { answer, record, sources: web.snippets, hits: knowledge.hits };
}
