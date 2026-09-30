/**
 * 知识捕获管道（SPEC-06 子任务 6.2/6.3，TECH-DESIGN §4.7 / §6.4 / §7.2）。
 *
 * 全部为纯函数（无 chrome.* / 无网络 / 无模型调用），便于单测与确定性：
 * - frontmatter 严格按 TECH-DESIGN §4.7 由代码组装，**不由模型生成**；
 * - 正文含跳播链接（§7.2：`?p={page}&t={秒}`）；
 * - 术语去重为确定性相似度（最长公共子序列比例），阈值 0.8；
 *   模型评分推迟（见 SPEC-06 执行记录：A5 的">0.8 提示"本期走确定性实现）。
 */
import type { Section, VideoMeta } from '../../types';
import { formatMmSs } from '../context/compiler';

/** 笔记类型（frontmatter 的 type 字段） */
export type NoteType = 'video-note' | 'term-card';

/** 术语卡正文所需字段（对应 explain 的 TermPayload，此处只声明消费到的部分） */
export interface TermPayloadLike {
  inVideoMeaning: string;
  generalDefinition: string;
  analogy: string;
  relatedTerms: string[];
}

/** 笔记在 vault 中的分类目录 */
export const NOTE_DIR = {
  video: '视频笔记',
  term: '术语',
} as const;

/** frontmatter 固定字段：来源与标签（TECH-DESIGN §4.7） */
export const FRONTMATTER_SOURCE = 'bilibili';
export const FRONTMATTER_TAGS = ['ai', '视频笔记'];

/** 去重阈值：相似度 ≥ 此值视为同一术语（TECH-DESIGN §6.4 的 >0.8 口径取 ≥0.8） */
export const DUPLICATE_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// 通用小工具（导出供单测）
// ---------------------------------------------------------------------------

/**
 * YAML 标量转义：含 `: ` / `#` / 引号 / 方括号等 YAML 敏感字符时加双引号，
 * 布尔与数字字面量同样加引号（否则 Obsidian 属性面板会把它们解析成非字符串）。
 */
export function yamlValue(value: string): string {
  if (value.length === 0) return '""';
  if (/^[\s]|[\s]$/.test(value)) return JSON.stringify(value);
  if (/[:#[\]{}&*!|>'"%@`]/.test(value)) return JSON.stringify(value);
  if (/^(?:true|false|null|yes|no|on|off)$/i.test(value)) return JSON.stringify(value);
  if (/^[-+]?\d+(?:\.\d+)?$/.test(value)) return JSON.stringify(value);
  if (/[\n\r\t]/.test(value)) return JSON.stringify(value);
  return value;
}

/** 文件名非法字符（`/\?:*"><|` 与控制字符）替换为 `_`；中文与空格保留 */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : '_';
}

/** vault 路径拼接：忽略空段，逐段去掉首尾斜杠与空白 */
export function joinVaultPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/^\/+|\/+$/g, '').trim())
    .filter((s) => s.length > 0)
    .join('/');
}

/** 日期 → `YYYY-MM-DD`（frontmatter created；本地时区，与用户认知一致） */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 视频页 URL 带分 P 参数（已有 `?` 时用 `&`） */
export function videoPageUrl(meta: VideoMeta): string {
  const base = meta.url;
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}p=${meta.page}`;
}

/**
 * 跳播链接（TECH-DESIGN §7.2）：`{url}?p={page}&t={秒}`，秒 = floor(ms/1000)。
 * ms 非法或为负时按 0 处理。
 */
export function playbackUrl(meta: VideoMeta, tMs: number): string {
  const sec = Number.isFinite(tMs) && tMs > 0 ? Math.floor(tMs / 1000) : 0;
  const base = videoPageUrl(meta);
  if (!base) return '';
  return `${base}&t=${sec}`;
}

/** markdown 链接：`[mm:ss](url)`；url 为空时只返回文本（无链接可跳时不造死链） */
export function timestampLink(meta: VideoMeta, tMs: number): string {
  const label = formatMmSs(tMs);
  const url = playbackUrl(meta, tMs);
  return url ? `[${label}](${url})` : label;
}

// ---------------------------------------------------------------------------
// frontmatter（TECH-DESIGN §4.7）
// ---------------------------------------------------------------------------

/**
 * 组装 frontmatter（含首尾 `---` 分隔线）。字段：
 * title / source / url（带 ?p=）/ video_id / duration（秒）/ created / tags / type。
 * `now` 可注入以固定日期（默认当前时间，保证单测可确定性断言）。
 */
export function buildFrontmatter(meta: VideoMeta, type: NoteType, now: Date = new Date()): string {
  const lines = [
    `title: ${yamlValue(meta.title)}`,
    `source: ${FRONTMATTER_SOURCE}`,
    `url: ${yamlValue(videoPageUrl(meta))}`,
    `video_id: ${yamlValue(meta.videoId)}`,
    `duration: ${Math.max(0, Math.floor((Number.isFinite(meta.durationMs) ? meta.durationMs : 0) / 1000))}`,
    `created: ${formatDate(now)}`,
    `tags: [${FRONTMATTER_TAGS.join(', ')}]`,
    `type: ${type}`,
  ];
  return ['---', ...lines, '---'].join('\n');
}

/** 正文 + frontmatter 拼接（笔记最终落盘内容） */
function withFrontmatter(meta: VideoMeta, type: NoteType, body: string, now?: Date): string {
  const fm = now ? buildFrontmatter(meta, type, now) : buildFrontmatter(meta, type);
  return `${fm}\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// 视频笔记
// ---------------------------------------------------------------------------

/**
 * 视频笔记：H1 标题 + 来源链接 + 每章（时间范围 + 标题 + 分数 + 摘要 + 可跳播要点 + 术语行）。
 * vaultPath = `${rootDir}/视频笔记/{title}.md`。
 */
export function buildVideoNoteMarkdown(
  meta: VideoMeta,
  sections: Section[],
  rootDir = '',
  now?: Date,
): { vaultPath: string; markdown: string } {
  const vaultPath = joinVaultPath(rootDir, NOTE_DIR.video, `${sanitizeFileName(meta.title)}.md`);
  const head = [
    `# ${meta.title}`,
    '',
    `来源：[B 站](${videoPageUrl(meta)}) · 时长 ${formatMmSs(meta.durationMs)} · video_id \`${meta.videoId}\``,
    '',
  ];
  const body = sections.map((s) => {
    const score = s.score != null ? `${s.score} 分` : '-';
    const lines = [`## ${formatMmSs(s.startMs)}-${formatMmSs(s.endMs)} ${s.title}（${score}）`, '', s.summary, ''];
    for (const bullet of s.bullets) {
      lines.push(`- ${timestampLink(meta, bullet.startMs)} ${bullet.text}`);
    }
    if (s.terms.length > 0) {
      lines.push('', `术语：${s.terms.join(' · ')}`);
    }
    return lines.join('\n');
  });
  const markdown = withFrontmatter(meta, 'video-note', [...head, ...body].join('\n'), now);
  return { vaultPath, markdown };
}

// ---------------------------------------------------------------------------
// 术语卡
// ---------------------------------------------------------------------------

/**
 * 术语卡：H1 术语 + 视频语境含义 / 通用定义 / 类比 / 相关术语 / 出处跳播链接。
 * vaultPath = `${rootDir}/术语/{term}.md`。
 */
export function buildTermCardMarkdown(args: {
  term: string;
  payload: TermPayloadLike;
  meta: VideoMeta;
  /** 该术语在视频中的出现位置（毫秒；缺省 0） */
  timestampMs?: number;
  rootDir?: string;
  now?: Date;
}): { vaultPath: string; markdown: string } {
  const { term, payload, meta } = args;
  const tMs = args.timestampMs ?? 0;
  const vaultPath = joinVaultPath(args.rootDir ?? '', NOTE_DIR.term, `${sanitizeFileName(term)}.md`);
  const parts = [
    `# ${term}`,
    '',
    '## 视频语境',
    payload.inVideoMeaning,
    '',
    '## 通用定义',
    payload.generalDefinition,
    '',
    '## 类比',
    payload.analogy,
  ];
  if (payload.relatedTerms.length > 0) {
    parts.push('', `## 相关术语`, payload.relatedTerms.map((t) => `- ${t}`).join('\n'));
  }
  parts.push('', `在《${meta.title}》中出现于 ${timestampLink(meta, tMs)}`);
  const markdown = withFrontmatter(meta, 'term-card', parts.join('\n'), args.now);
  return { vaultPath, markdown };
}

// ---------------------------------------------------------------------------
// 去重（确定性）
// ---------------------------------------------------------------------------

/** 最长公共子序列长度（动态规划，术语长度量级极小，直出即可） */
function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** 归一化：trim + 小写（大小写与首尾空白不视为差异） */
function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

/** 相似度：归一化后的 LCS 比例 `2*LCS/(lenA+lenB)`（完全相等为 1） */
export function termSimilarity(a: string, b: string): number {
  const na = normalizeTerm(a);
  const nb = normalizeTerm(b);
  if (na.length === 0 && nb.length === 0) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  return (2 * lcsLength(na, nb)) / (na.length + nb.length);
}

/**
 * 在已有术语表中查找重复项：相似度 ≥ 0.8 返回该术语（原样返回，非归一化形式）
 * 与相似度；否则 `{ duplicate: null, similarity }`（similarity 为最高相似度）。
 */
export function findDuplicateTerm(
  newTerm: string,
  existing: Array<{ term: string }>,
): { duplicate: string | null; similarity: number } {
  let best = 0;
  let bestTerm: string | null = null;
  for (const item of existing) {
    const sim = termSimilarity(newTerm, item.term);
    if (sim > best) {
      best = sim;
      bestTerm = item.term;
    }
  }
  if (bestTerm !== null && best >= DUPLICATE_THRESHOLD) {
    return { duplicate: bestTerm, similarity: Number(best.toFixed(4)) };
  }
  return { duplicate: null, similarity: Number(best.toFixed(4)) };
}
