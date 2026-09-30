/**
 * 概念知识图 pipeline（SPEC-04 四次迭代：知识流程图，阶段流）。
 *
 * 输入为已生成的章节大纲（Section[]，时间结构），输出为阶段流知识结构
 * （stages: [{label, concepts:[{label, importance, anchors, details}]}]）：
 * - buildConceptMap：单次结构化模型调用 + zod 校验（红线 1：确定性单调用，
 *   非 agent loop）+ 失败附错误重试 1 次，两次失败 throw 由调用方降级；
 * - 预告章节过滤（确定性，P8 洞察）：前两章中章节文本命中全部概念 ≥50%
 *   → 视为预告章，其 startMs 不进入任何 anchor（修复 00:01 开场锚点 bug）；
 * - 主锚：anchors 中 score 最高的章节排首位（primaryAnchorTMs），其余按
 *   startMs 升序；阶段顺序 = 模型输出推进顺序，阶段内概念保留模型顺序；
 * - buildTermIndexMap：零模型确定性降级（术语按出现章节聚合，stages 形状）；
 * - 概念时间锚 = 出现章节的 startMs（大纲管线吸附产物，红线 2）。
 * 纯函数 + 注入式模型调用（ConceptModelFn），无 chrome.* 依赖。
 */
import { CONCEPT_MAP } from '../../config';
import type { ConceptAnchor, ConceptItem, ConceptStage, Section } from '../../types';
import type {
  ConceptModelFn,
  ConceptRaw,
  ConceptStagesRaw,
} from './types';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema 与解析（红线 4 同款：JSON.parse + zod，失败 throw 由重试捕获）
// ---------------------------------------------------------------------------

/** 模型输出整体 Schema：{stages:[{label, concepts:[...]}]}
 * （沿用二次迭代策略：label/detail 用硬上限（30/40）防注入式超长；超
 *  labelMax 的常见输出（13~16 字）不再硬拒，由构树代码 shortenLabel 截断） */
export const ConceptStagesSchema = z.object({
  stages: z
    .array(
      z.object({
        label: z.string().min(1).max(CONCEPT_MAP.stageLabelMax),
        concepts: z
          .array(
            z.object({
              label: z.string().min(1).max(CONCEPT_MAP.labelHardMax),
              importance: z.number().int().min(1).max(5),
              anchorSections: z.array(z.number().int().nonnegative()),
              details: z
                .array(z.string().min(1).max(CONCEPT_MAP.detailHardMax))
                .max(CONCEPT_MAP.detailsMax),
            }),
          )
          .min(CONCEPT_MAP.conceptsPerStageMin)
          .max(CONCEPT_MAP.conceptsPerStageMax),
      }),
    )
    .min(CONCEPT_MAP.stagesMin)
    .max(CONCEPT_MAP.stagesMax),
});

/**
 * 解析并校验模型输出：JSON.parse + ConceptStagesSchema。
 * 解析/校验失败 throw，由 buildConceptMap 的重试逻辑捕获。
 */
export function parseConceptStages(content: string): ConceptStagesRaw {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(`模型输出不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = ConceptStagesSchema.safeParse(raw);
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

/** 章节得分（score 缺省视为 -1：任何有分数的章节主锚优先级更高） */
function sectionScore(s: Section): number {
  return s.score != null ? s.score : -1;
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
  lines.push('请将上述章节重组为知识流程（阶段 → 概念），输出严格 JSON。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 预告章节识别与锚点构造（确定性，红线 1）
// ---------------------------------------------------------------------------

/**
 * 预告章节识别（确定性，导出供单测）：对每个章节（仅前
 * CONCEPT_MAP.overviewSectionMaxIndex 个）统计其 title+summary+terms 归一化
 * 拼接命中的概念 label 数，命中比例 ≥ overviewHitRatio（50%）→ 预告章。
 * 返回被标记章节的下标集合（0-based）；其 startMs 不进入任何 anchor。
 */
export function findOverviewSectionIndices(
  raw: ConceptStagesRaw,
  sections: Section[],
): ReadonlySet<number> {
  const labels = new Set<string>();
  for (const stage of raw.stages) {
    for (const c of stage.concepts) {
      const label = c.label.trim().toLowerCase();
      if (label) labels.add(label);
    }
  }
  const overview = new Set<number>();
  if (labels.size === 0) return overview;
  sections.forEach((sec, idx) => {
    if (idx >= CONCEPT_MAP.overviewSectionMaxIndex) return;
    const text = `${sec.title} ${sec.summary} ${sec.terms.join(' ')}`
      .trim()
      .toLowerCase();
    if (!text) return;
    let hits = 0;
    for (const label of labels) {
      if (text.includes(label)) hits += 1;
    }
    if (hits / labels.size >= CONCEPT_MAP.overviewHitRatio) {
      overview.add(idx);
    }
  });
  return overview;
}

/**
 * anchorSections（1-based 章节编号）→ 时间锚（纯函数，确定性）：
 * - 越界 / 非整数编号丢弃（模型幻觉防御）；预告章节排除（不贡献锚点）；
 * - 主锚 = 剩余章节中 score 最高者（并列取时间最早，确定性），排 anchors[0]；
 * - 其余锚按 startMs 升序跟随；无有效锚返回空数组。
 */
export function buildConceptAnchors(
  anchorSections: number[],
  sections: Section[],
  overview: ReadonlySet<number>,
): ConceptAnchor[] {
  const seen = new Set<string>();
  const valid: Section[] = [];
  for (const n of new Set(anchorSections)) {
    if (!Number.isInteger(n) || n < 1 || n > sections.length) continue;
    if (overview.has(n - 1)) continue;
    const sec = sections[n - 1];
    if (!seen.has(sec.id)) {
      seen.add(sec.id);
      valid.push(sec);
    }
  }
  valid.sort((a, b) => a.startMs - b.startMs);
  if (valid.length === 0) return [];
  let primary = valid[0];
  for (const sec of valid) {
    if (sectionScore(sec) > sectionScore(primary)) primary = sec;
  }
  const rest = valid.filter((s) => s !== primary);
  return [primary, ...rest].map((s) => ({ tMs: s.startMs, sectionId: s.id }));
}

// ---------------------------------------------------------------------------
// 构阶段流（zod 校验后的 raw → ConceptStage[]）
// ---------------------------------------------------------------------------

/**
 * 原始输出 → 阶段流（纯函数）：
 * - 阶段顺序 = 模型输出顺序（讲解推进顺序）；阶段内概念保留模型顺序
 *   （模型顺序即讲解顺序，不重排）；
 * - 阶段 / 概念 id 重编（st_01 / cm_0001）；
 * - anchors：预告章节过滤 + 主锚（score 最高）排首位；
 * - 所有 label 代码强制截断（阶段 ≤20、概念 ≤12、细节 ≤20）。
 */
export function buildStagesFromRaw(
  raw: ConceptStagesRaw,
  sections: Section[],
): ConceptStage[] {
  const overview = findOverviewSectionIndices(raw, sections);
  let cmSeq = 0;
  return raw.stages.map((stage, si) => {
    const concepts: ConceptItem[] = stage.concepts.map((c: ConceptRaw) => {
      const anchors = buildConceptAnchors(c.anchorSections, sections, overview);
      cmSeq += 1;
      return {
        id: `cm_${String(cmSeq).padStart(4, '0')}`,
        label: shortenLabel(c.label, CONCEPT_MAP.labelMax),
        importance: clampImportance(c.importance),
        anchors,
        primaryAnchorTMs: anchors.length > 0 ? anchors[0].tMs : -1,
        details: c.details.map((d) => shortenLabel(d, CONCEPT_MAP.detailLabelMax)),
      };
    });
    return {
      id: `st_${String(si + 1).padStart(2, '0')}`,
      label: shortenLabel(stage.label, CONCEPT_MAP.stageLabelMax),
      concepts,
    };
  });
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
  stages: ConceptStage[];
  degraded: false;
}

/**
 * 概念图生成主入口：单次结构化模型调用 → zod 校验 → 构阶段流。
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
      const raw = parseConceptStages(res.content);
      return {
        stages: buildStagesFromRaw(raw, args.sections),
        degraded: false,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`概念图生成失败（重试 ${maxRetries} 次后仍失败）：${lastError}`);
}

/** 术语关联图降级结果（stages 形状，与模型路径同构） */
export interface TermIndexResult {
  stages: ConceptStage[];
  degraded: true;
}

/**
 * 确定性降级（零模型，红线 1）：全片术语去重（大小写不敏感）后
 * 按出现章节数降序取前 N，单阶段「核心术语」，每术语一个概念
 * （importance = min(5, 出现章节数)，anchors = 出现章节起点，主锚 = 首个），
 * 无 details。排序并列时按首次出现顺序（确定性）。
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

  const concepts: ConceptItem[] = top.map((entry, i) => {
    const anchors: ConceptAnchor[] = entry.sections
      .map((s) => ({ tMs: s.startMs, sectionId: s.id }))
      .sort((a, b) => a.tMs - b.tMs);
    return {
      id: `cm_${String(i + 1).padStart(4, '0')}`,
      label: shortenLabel(entry.label, CONCEPT_MAP.labelMax),
      importance: Math.min(5, entry.sections.length),
      anchors,
      primaryAnchorTMs: anchors.length > 0 ? anchors[0].tMs : -1,
      details: [],
    };
  });

  const stages: ConceptStage[] =
    concepts.length > 0
      ? [
          {
            id: 'st_01',
            label: CONCEPT_MAP.fallbackStageLabel,
            concepts,
          },
        ]
      : [];
  return { stages, degraded: true };
}

export type { ConceptRaw, ConceptStagesRaw, ConceptStageRaw } from './types';
