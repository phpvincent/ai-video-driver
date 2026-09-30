/**
 * 概念知识图 pipeline（SPEC-04 范围变更：导图 = 知识导航）。
 *
 * 输入为已生成的章节大纲（Section[]，时间结构），输出为知识结构
 * （虚拟根 → 概念域 → 概念 → 细节）：
 * - buildConceptMap：单次结构化模型调用 + zod 校验（红线 1：确定性单调用，
 *   非 agent loop）+ 失败附错误重试 1 次，两次失败 throw 由调用方降级；
 * - buildTermIndexMap：零模型确定性降级（术语按出现章节聚合，红线 1）；
 * - 概念时间锚 = 出现章节的 startMs（大纲管线吸附产物，红线 2）。
 * 纯函数 + 注入式模型调用（ConceptModelFn），无 chrome.* 依赖。
 */
import { CONCEPT_MAP } from '../../config';
import type { ConceptNode, Section } from '../../types';
import type {
  ConceptDomainRaw,
  ConceptModelFn,
  ConceptRaw,
  ConceptTreeRaw,
} from './types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema 与解析（红线 4 同款：JSON.parse + zod，失败 throw 由重试捕获）
// ---------------------------------------------------------------------------

/** 模型输出整体 Schema：{domains:[{label, concepts:[...]}]} */
export const ConceptTreeSchema = z.object({
  domains: z
    .array(
      z.object({
        label: z.string().min(1).max(CONCEPT_MAP.labelMax),
        concepts: z
          .array(
            z.object({
              label: z.string().min(1).max(CONCEPT_MAP.labelMax),
              importance: z.number().int().min(1).max(5),
              anchorSections: z.array(z.number().int().nonnegative()),
              details: z
                .array(z.string().min(1).max(CONCEPT_MAP.detailLabelMax))
                .max(CONCEPT_MAP.detailsMax),
            }),
          )
          .min(1)
          .max(CONCEPT_MAP.conceptsPerDomainMax),
      }),
    )
    .min(CONCEPT_MAP.domainsMin)
    .max(CONCEPT_MAP.domainsMax),
});

/**
 * 解析并校验模型输出：JSON.parse + ConceptTreeSchema。
 * 解析/校验失败 throw，由 buildConceptMap 的重试逻辑捕获。
 */
export function parseConceptTree(content: string): ConceptTreeRaw {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`模型输出不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = ConceptTreeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`模型输出未通过 Schema 校验：${issues}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// 纯工具
// ---------------------------------------------------------------------------

/**
 * 标签截断（代码强制 ≤max 字）：超长截断并以省略号结尾（总长 ≤max）。
 * 按码点计数（中文等宽：1 个汉字算 1 字，不按 UTF-16 单元）。
 */
export function shortenLabel(s: string, max: number = CONCEPT_MAP.labelMax): string {
  const chars = Array.from(s.trim());
  if (max <= 1) return chars.slice(0, 1).join('');
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max - 1).join('')}…`;
}

/** clamp importance 到 1-5（防御模型边界值，zod 已保证正常路径） */
function clampImportance(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * 组装模型 user prompt（纯函数）：章节编号 + 标题 + 分数 + 重要性 + 摘要 + 术语。
 * 编号从 1 开始，模型输出的 anchorSections 引用这些编号。
 */
export function buildConceptMapUserPrompt(sections: Section[], videoTitle: string): string {
  const lines = [`视频标题：${videoTitle}`, '以下是该视频的章节列表（按时间顺序编号）：'];
  sections.forEach((s, i) => {
    const score = s.score != null ? `${s.score}分` : '无分数';
    const terms = s.terms.length > 0 ? s.terms.join('、') : '无';
    lines.push(
      `[${i + 1}] ${s.title} | ${score} | 重要性${s.importance} | ${s.summary} | 术语：${terms}`,
    );
  });
  lines.push('请将上述章节重组为概念知识图，输出严格 JSON。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 构树（zod 校验后的 raw → ConceptNode 树）
// ---------------------------------------------------------------------------

/**
 * 原始输出 → ConceptNode 树（纯函数）：
 * 虚拟根（label=视频主题短语 ≤16 字）→ domain → concept → detail；
 * anchorSections 编号（1-based）映射到章节 startMs（吸附产物，红线 2）；
 * domain.importance = 子概念最大值；所有 label 代码强制截断。
 */
export function buildTreeFromRaw(
  raw: ConceptTreeRaw,
  sections: Section[],
  videoTitle: string,
): ConceptNode {
  let seq = 0;
  const nextId = () => `cm_${String((seq += 1)).padStart(4, '0')}`;

  const root: ConceptNode = {
    id: 'cm_root',
    label: shortenLabel(videoTitle.trim() || '视频主题', CONCEPT_MAP.rootLabelMax),
    kind: 'domain',
    importance: 1,
    anchors: [],
    children: [],
  };

  for (const domain of raw.domains) {
    const concepts: ConceptNode[] = domain.concepts.map((c: ConceptRaw) => {
      const concept: ConceptNode = {
        id: nextId(),
        label: shortenLabel(c.label, CONCEPT_MAP.labelMax),
        kind: 'concept',
        importance: clampImportance(c.importance),
        anchors: buildAnchors(c.anchorSections, sections),
        children: c.details.map((detail) => ({
          id: nextId(),
          label: shortenLabel(detail, CONCEPT_MAP.detailLabelMax),
          kind: 'detail' as const,
          importance: clampImportance(c.importance),
          anchors: [],
          children: [],
        })),
      };
      return concept;
    });
    root.children.push({
      id: nextId(),
      label: shortenLabel(domain.label, CONCEPT_MAP.labelMax),
      kind: 'domain',
      importance: concepts.length
        ? Math.max(...concepts.map((c) => c.importance))
        : 1,
      anchors: [],
      children: concepts,
    });
  }
  return root;
}

/** anchorSections（1-based 章节编号）→ 时间锚；去重、越界编号丢弃 */
function buildAnchors(anchorSections: number[], sections: Section[]) {
  const valid = [...new Set(anchorSections)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= sections.length)
    .sort((a, b) => a - b);
  return valid.map((n) => ({
    tMs: sections[n - 1].startMs,
    sectionId: sections[n - 1].id,
  }));
}

// ---------------------------------------------------------------------------
// 模型路径（buildConceptMap）与确定性降级（buildTermIndexMap）
// ---------------------------------------------------------------------------

export interface BuildConceptMapArgs {
  sections: Section[];
  videoTitle: string;
  modelFn: ConceptModelFn;
  /** system prompt 单一事实源注入（红线 6：调用方传 getConceptMapSystemPrompt） */
  getSystemPrompt: () => string;
  /** 解析失败附错误重试次数，默认 CONCEPT_MAP.maxRetries（1） */
  maxRetries?: number;
}

/** 生成成功结果（降级图用 degraded: true 区分，见 buildTermIndexMap） */
export interface ConceptMapBuildResult {
  root: ConceptNode;
  degraded: false;
}

/**
 * 概念图生成主入口：单次结构化模型调用 → zod 校验 → 构树。
 * 失败附错误重试 1 次；两次失败 throw（由调用方降级到术语关联图）。
 */
export async function buildConceptMap(
  args: BuildConceptMapArgs,
): Promise<ConceptMapBuildResult> {
  if (args.sections.length === 0) {
    throw new Error('无章节可用：请先生成大纲');
  }
  const maxRetries = args.maxRetries ?? CONCEPT_MAP.maxRetries;
  const baseUserPrompt = buildConceptMapUserPrompt(args.sections, args.videoTitle);

  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? baseUserPrompt
        : `${baseUserPrompt}\n\n[重试] 上一次输出未通过校验：${lastError}\n请重新输出严格符合要求的 JSON，不要包含任何其他文字。`;
    try {
      const res = await args.modelFn({
        systemPrompt: args.getSystemPrompt(),
        userPrompt,
      });
      const raw = parseConceptTree(res.content);
      return {
        root: buildTreeFromRaw(raw, args.sections, args.videoTitle),
        degraded: false,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`概念图生成失败（重试 ${maxRetries} 次后仍失败）：${lastError}`);
}

/** 术语关联图降级结果 */
export interface TermIndexResult {
  root: ConceptNode;
  degraded: true;
}

/**
 * 确定性降级（零模型，红线 1）：全片术语去重（大小写不敏感）后
 * 按出现章节数降序取前 N，单 domain「核心术语」，每术语一个 concept
 * （importance = min(5, 出现章节数)，anchors = 出现章节起点），无 details。
 * 排序并列时按首次出现顺序（确定性）。
 */
export function buildTermIndexMap(sections: Section[]): TermIndexResult {
  interface TermEntry {
    label: string;
    firstIndex: number;
    sections: Section[];
  }
  const byKey = new Map<string, TermEntry>();
  sections.forEach((sec, idx) => {
    for (const term of sec.terms) {
      const label = term.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const entry = byKey.get(key);
      if (entry) {
        if (!entry.sections.includes(sec)) entry.sections.push(sec);
      } else {
        byKey.set(key, { label, firstIndex: idx, sections: [sec] });
      }
    }
  });

  const top = [...byKey.values()]
    .sort(
      (a, b) =>
        b.sections.length - a.sections.length || a.firstIndex - b.firstIndex,
    )
    .slice(0, CONCEPT_MAP.termsTop);

  const concepts: ConceptNode[] = top.map((entry, i) => ({
    id: `cm_${String(i + 2).padStart(4, '0')}`,
    label: shortenLabel(entry.label, CONCEPT_MAP.labelMax),
    kind: 'concept',
    importance: Math.min(5, entry.sections.length),
    anchors: entry.sections.map((s) => ({ tMs: s.startMs, sectionId: s.id })),
    children: [],
  }));

  const root: ConceptNode = {
    id: 'cm_root',
    label: '术语关联图',
    kind: 'domain',
    importance: concepts.length
      ? Math.max(...concepts.map((c) => c.importance))
      : 1,
    anchors: [],
    children:
      concepts.length > 0
        ? [
            {
              id: 'cm_0001',
              label: CONCEPT_MAP.fallbackDomainLabel,
              kind: 'domain' as const,
              importance: Math.max(...concepts.map((c) => c.importance)),
              anchors: [],
              children: concepts,
            },
          ]
        : [],
  };
  return { root, degraded: true };
}

export type { ConceptDomainRaw, ConceptRaw, ConceptTreeRaw } from './types';
