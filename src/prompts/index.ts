/**
 * prompt 单一事实源 loader（SPEC-03 子任务 3.4，TECH-DESIGN §3.4，红线 6）。
 *
 * 运行时 prompt 正文只存在于 src/prompts/*.md（本目录），构建时经 vite `?raw`
 * 内联为字符串；头注释携带 promptVersion / kind，改动正文必须递增版本
 * （驱动大纲缓存失效）。解析失败在模块加载期即 throw——属构建期问题，应尽早暴露。
 */
import outlinePromptMd from './outline.md?raw';
import outlineRegenerateMd from './outline-regenerate.md?raw';

export interface PromptHeader {
  promptVersion: string;
  kind: string;
}

/** 头注释格式：`<!-- promptVersion: x.y.z -->` 与 `<!-- kind: name -->` */
const PROMPT_VERSION_RE = /<!--\s*promptVersion:\s*([\w.-]+)\s*-->/;
const KIND_RE = /<!--\s*kind:\s*([\w-]+)\s*-->/;

/** 解析 prompt 文件头注释（promptVersion / kind）；缺失或非法即 throw */
export function parsePromptHeader(raw: string): PromptHeader {
  const version = raw.match(PROMPT_VERSION_RE);
  const kind = raw.match(KIND_RE);
  if (!version || !kind) {
    throw new Error(
      'prompt 文件头注释不完整：需含 <!-- promptVersion: ... --> 与 <!-- kind: ... --> 两行注释',
    );
  }
  return { promptVersion: version[1], kind: kind[1] };
}

/** 去掉文件头部的 HTML 注释块，返回 prompt 正文 */
export function stripPromptHeaderComments(raw: string): string {
  return raw.replace(/^(?:\s*<!--[\s\S]*?-->\s*)+/, '').trim();
}

const OUTLINE_HEADER = parsePromptHeader(outlinePromptMd);
const OUTLINE_REGENERATE_HEADER = parsePromptHeader(outlineRegenerateMd);

/** 各 prompt 当前版本（来自文件头注释，单一事实源） */
export const PROMPT_VERSIONS = {
  outline: OUTLINE_HEADER.promptVersion,
  outlineRegenerate: OUTLINE_REGENERATE_HEADER.promptVersion,
} as const;

/** 大纲生成 system prompt 正文（单一事实源：src/prompts/outline.md） */
export function getOutlineSystemPrompt(): string {
  return stripPromptHeaderComments(outlinePromptMd);
}

/** 单章重生成 system prompt 正文（单一事实源：src/prompts/outline-regenerate.md） */
export function getOutlineRegenerateSystemPrompt(): string {
  return stripPromptHeaderComments(outlineRegenerateMd);
}
