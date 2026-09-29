/**
 * 问答组装层（SPEC-05 父 agent 接线）：explain pipeline + 真实 prompt
 * （prompts/index 单一事实源，红线 6）+ qaHistory 落库（buildQaRecord 盖章）。
 * ChatTab 的 explain props 由本模块实现。
 */
import { chatCompletion } from '../core/harness/modelClient';
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
import type { Cue, ModelConfig, QaRecord, Section } from '../types';
import type { ExplainRequest, ExplainResponse } from './ChatTab';

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

async function fetchModelConfig(): Promise<ModelConfig | null> {
  const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
  const stored = (response ?? {}) as { model?: ModelConfig };
  return stored.model ?? null;
}

/** ChatTab explain props 的实现（App 接线传入） */
export async function explain(args: ExplainRequest): Promise<ExplainResponse> {
  const model = await fetchModelConfig();
  if (!model?.apiKey) throw new Error('模型未配置：请先在设置页配置模型');

  const videoId = currentVideoIdRef.value;
  if (!videoId) throw new Error('未检测到视频');

  const [subRec, outlineRec] = await Promise.all([
    getSubtitle(db, videoId).catch(() => null),
    getOutline(db, videoId, PROMPT_VERSIONS.outline, model.model).catch(() => null),
  ]);
  const cues: Cue[] = subRec?.cues ?? [];
  const sections: Section[] = outlineRec?.sections ?? [];

  const input: ExplainInput = {
    sections,
    cues,
    rangeMs: args.rangeMs,
    positionMs: args.positionMs,
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
    return { term, record };
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
  return { answer, record };
}
