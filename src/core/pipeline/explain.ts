/**
 * 术语解释与区间问答 pipeline（SPEC-05，TECH-DESIGN §6.2/§6.3，红线 4）。
 *
 * 单次模型调用（不引入 agent loop）+ Zod Schema 校验：校验失败附错误信息重试 1 次，
 * 仍失败 throw（由问答 Tab 状态机呈现，红线 8，本模块不吞错）。
 * 模型调用经 modelFn 注入（同 OutlineModelFn 模式），无 chrome.* / 网络依赖。
 *
 * coveredByVideo=false 时 answer 由模型按 prompt 约定以"视频中未涉及，以下为
 * 公开知识补充"开头（展示侧由 ChatTab 加前缀条，pipeline 不管展示）。
 */
import { z } from 'zod';
import type { InteractionType, QaRecord } from '../../types';
import { compileContext, findSectionAt, type CompileInput, type CompiledContext } from '../context/compiler';

/** TECH-DESIGN §6.2 */
export const TermSchema = z.object({
  term: z.string(),
  inVideoMeaning: z.string(),
  generalDefinition: z.string(),
  analogy: z.string(),
  relatedTerms: z.array(z.string()).max(5),
  /** v0.1 仅作提示，不触发联网 */
  needsWeb: z.boolean(),
});
export type TermPayload = z.infer<typeof TermSchema>;

/** TECH-DESIGN §6.3 */
export const SegmentAnswerSchema = z.object({
  answer: z.string(),
  keyPoints: z.array(z.string()).max(6),
  /** 秒，渲染前吸附到最近 Cue */
  referencedTimestamps: z.array(z.number().int().nonnegative()).max(6),
  followUpQuestions: z.array(z.string()).max(3),
  coveredByVideo: z.boolean(),
  /** 引用的个人知识库笔记（路径或标题；未引用时省略，见 segment-qa.md 0.2.0） */
  knowledgeSources: z.array(z.string()).max(5).optional(),
});
export type SegmentAnswerPayload = z.infer<typeof SegmentAnswerSchema>;

/** 注入式模型调用（与 OutlineModelFn 同形） */
export type ExplainModelFn = (req: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ content: string }>;

/** explain pipeline 的上下文输入（question/term 由各入口自行组装） */
export type ExplainInput = Omit<CompileInput, 'question' | 'term'>;

// 占位 system prompt：接线层（loader）应注入 src/prompts 单一事实源的真实正文
// （getTermExplainerSystemPrompt / getSegmentQaSystemPrompt，红线 6）。
const DEFAULT_TERM_SYSTEM_PROMPT =
  '你是视频学习副驾的术语解释器。结合视频语境与公开知识解释术语，只输出严格 JSON。';
const DEFAULT_SEGMENT_SYSTEM_PROMPT =
  '你是视频学习副驾的区间问答助手。基于区间字幕证据回答问题，只输出严格 JSON。';

/** 术语解释 prompt 构造（user 复用 compiler 的素材包裹格式，system 由注入源替换） */
export function buildTermPrompts(
  term: string,
  compiled: CompiledContext,
  getSystemPrompt: () => string = () => DEFAULT_TERM_SYSTEM_PROMPT,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `${compiled.userPrompt}\n请解释术语「${term}」，区分视频语境含义与通用定义，只输出严格 JSON。`,
  };
}

/** 区间问答 prompt 构造（system 由注入源替换） */
export function buildSegmentPrompts(
  question: string,
  compiled: CompiledContext,
  getSystemPrompt: () => string = () => DEFAULT_SEGMENT_SYSTEM_PROMPT,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: getSystemPrompt(),
    userPrompt: `${compiled.userPrompt}\n请回答问题：${question}，只输出严格 JSON。`,
  };
}

/** JSON.parse + Schema 校验（红线 4）；失败 throw，由重试逻辑捕获 */
function parseJsonWithSchema<T>(content: string, schema: z.ZodType<T>, label: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`模型输出不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`模型输出未通过 ${label} 校验：${issues}`);
  }
  return parsed.data;
}

export function parseTermPayload(content: string): TermPayload {
  return parseJsonWithSchema(content, TermSchema, 'TermSchema');
}

export function parseSegmentAnswerPayload(content: string): SegmentAnswerPayload {
  return parseJsonWithSchema(content, SegmentAnswerSchema, 'SegmentAnswerSchema');
}

/**
 * 单次调用 + 校验失败附错误重试 1 次（红线 4，同 outline 的重试口径：
 * 仅解析/校验失败重试；modelFn 本身异常直接向上传播）。
 */
async function callModelWithRetry<T>(
  modelFn: ExplainModelFn,
  prompts: { systemPrompt: string; userPrompt: string },
  parse: (content: string) => T,
): Promise<T> {
  let lastError = '';
  for (let attempt = 0; attempt <= 1; attempt++) {
    const userPrompt =
      attempt === 0
        ? prompts.userPrompt
        : `${prompts.userPrompt}\n\n[重试] 上一次输出未通过校验：${lastError}\n请重新输出严格符合要求的 JSON，不要包含任何其他文字。`;
    const res = await modelFn({ systemPrompt: prompts.systemPrompt, userPrompt });
    try {
      return parse(res.content);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`模型输出两次未通过校验：${lastError}`);
}

export interface ExplainTermArgs {
  term: string;
  input: ExplainInput;
  modelFn: ExplainModelFn;
  /** system prompt 单一事实源注入（缺省为占位，接线层传 prompts/index getter） */
  getSystemPrompt?: () => string;
  rangePadMs?: number;
  maxChars?: number;
}

/** 术语解释：编译上下文 → 构造 prompt → 单次调用 + Schema 校验（含 1 次重试） */
export async function explainTerm(args: ExplainTermArgs): Promise<TermPayload> {
  const compiled = compileContext(
    { ...args.input, question: `解释术语「${args.term}」`, term: args.term },
    { rangePadMs: args.rangePadMs, maxChars: args.maxChars },
  );
  const prompts = buildTermPrompts(args.term, compiled, args.getSystemPrompt);
  return callModelWithRetry(args.modelFn, prompts, parseTermPayload);
}

export interface AnswerSegmentArgs {
  question: string;
  input: ExplainInput;
  modelFn: ExplainModelFn;
  /** system prompt 单一事实源注入（缺省为占位，接线层传 prompts/index getter） */
  getSystemPrompt?: () => string;
  rangePadMs?: number;
  maxChars?: number;
}

/** 区间问答：编译上下文 → 构造 prompt → 单次调用 + Schema 校验（含 1 次重试） */
export async function answerSegment(args: AnswerSegmentArgs): Promise<SegmentAnswerPayload> {
  const compiled = compileContext(
    { ...args.input, question: args.question },
    { rangePadMs: args.rangePadMs, maxChars: args.maxChars },
  );
  const prompts = buildSegmentPrompts(args.question, compiled, args.getSystemPrompt);
  return callModelWithRetry(args.modelFn, prompts, parseSegmentAnswerPayload);
}

/**
 * QaRecord 聚合（TECH-DESIGN §4.4）：sectionId 由 positionMs 命中章节得出，
 * createdAt / id 由本层盖章（时钟与 id 生成均可注入，供确定性单测）。
 */
export function buildQaRecord(args: {
  videoId: string;
  interactionType: InteractionType;
  input: ExplainInput;
  question: string;
  /** 渲染后的回答正文 */
  answer: string;
  /** 结构化输出（TermSchema / SegmentAnswerSchema 校验结果） */
  payload: unknown;
  now?: () => number;
  genId?: () => string;
}): QaRecord {
  const section = findSectionAt(args.input.sections, args.input.positionMs);
  const now = args.now ?? Date.now;
  const genId =
    args.genId ??
    (() =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `qa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  return {
    id: genId(),
    videoId: args.videoId,
    interactionType: args.interactionType,
    sectionId: section?.id ?? null,
    timestampMs: args.input.positionMs,
    rangeMs: args.input.rangeMs,
    question: args.question,
    answer: args.answer,
    payload: args.payload,
    createdAt: new Date(now()).toISOString(),
  };
}
