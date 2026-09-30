/**
 * 问答组装层（SPEC-05 父 agent 接线）：explain pipeline + 真实 prompt
 * （prompts/index 单一事实源，红线 6）+ qaHistory 落库（buildQaRecord 盖章）。
 * ChatTab 的 explain props 由本模块实现。
 */
import { findSectionAt } from '../core/context/compiler';
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

  const input: ExplainInput = {
    sections,
    cues,
    rangeMs: args.rangeMs,
    positionMs: args.positionMs,
    knowledgeContext: knowledge.context,
  };

  const modelFn: ExplainModelFn = ({ systemPrompt, userPrompt }) =>
    chatCompletion({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature.qa,
      maxTokens: model.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormatJson: true,
    }).then((res) => ({ content: res.content }));

  if (args.term) {
    const term = await explainTerm({
      term: args.term,
      input,
      modelFn,
      getSystemPrompt: getTermExplainerSystemPrompt,
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
    return { term, record, hits: knowledge.hits };
  }

  const answer = await answerSegment({
    question: args.question,
    input,
    modelFn,
    getSystemPrompt: getSegmentQaSystemPrompt,
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
  return { answer, record, hits: knowledge.hits };
}
