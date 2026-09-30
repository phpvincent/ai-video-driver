/**
 * Obsidian 存库接线层（SPEC-06，父 agent 在 App.tsx 接线）。
 *
 * 组装 sink（src/sinks/obsidian.ts，注入式 fetch）+ 捕获管道（capture 纯函数）+
 * 双索引（`_meta/index.json` 机器检索 / `_索引.md` 人类 MOC）+ 术语卡本地缓存
 * （IndexedDB terms store，键 [term, videoId]）。
 *
 * 一律用户点按钮触发（无自动落盘，SPEC-06「不做自动写入」）；失败 throw 由
 * UI 行内展示（红线 8：不崩面板）。配置读写经 MSG.GET_SETTINGS / SET_SETTINGS，
 * settings.obsidian 与 model 分区独立，保存只合并 obsidian 段。
 */
import { DB } from '../config';
import {
  applyNotesToMarkdown,
  buildIndexMarkdown,
  buildTermCardMarkdown,
  buildVideoNoteMarkdown,
  emptyIndexFile,
  findDuplicateTerm,
  INDEX_JSON_NAME,
  INDEX_MD_NAME,
  joinVaultPath,
  playbackUrl,
  termNotePath,
  upsertIndexEntry,
  vaultPathsFor,
} from '../core/pipeline/capture';
import { getNote, putNote, testConnection, type ObsidianFetch } from '../sinks/obsidian';
import { createSubtitleDb, listNotesByVideo } from '../storage/db';
import type {
  KnowledgeIndexEntry,
  KnowledgeIndexFile,
  ObsidianConfig,
  Section,
  TermCard,
  VideoMeta,
} from '../types';
import { MSG } from '../messages';
import type { TermPayloadLike } from '../core/pipeline/capture';

/** 模块级单例 DB（惰性 open 由 db 层内部保证幂等） */
const db = createSubtitleDb();

/** 默认请求实现：侧边栏上下文直接用全局 fetch */
const defaultFetch: ObsidianFetch = (url, init) => fetch(url, init);

/** chrome.runtime.sendMessage 的安全包装：上下文失效时返回 null */
function sendRuntimeMessage(message: unknown): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    return Promise.resolve(null);
  }
}

/** 读完整 settings（background 返回整个 settings 对象） */
async function readSettings(): Promise<Record<string, unknown>> {
  const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
  const stored = (response ?? {}) as Record<string, unknown>;
  return stored && typeof stored === 'object' ? stored : {};
}

/** 索引文件路径（`{rootDir}/_meta/index.json`） */
export function indexPath(rootDir: string): string {
  return joinVaultPath(rootDir, INDEX_JSON_NAME);
}

/** 人类可读索引路径（`{rootDir}/_索引.md`） */
export function indexMarkdownPath(rootDir: string): string {
  return joinVaultPath(rootDir, INDEX_MD_NAME);
}

/**
 * 读机器索引：getNote 读 `{rootDir}/_meta/index.json`；
 * 404 / 网络异常 / JSON 解析失败一律回落空索引（索引缺失不阻断存库）。
 */
export async function readIndex(
  cfg: ObsidianConfig,
  fetchFn: ObsidianFetch = defaultFetch,
): Promise<KnowledgeIndexFile> {
  try {
    const raw = await getNote(cfg, fetchFn, indexPath(cfg.rootDir));
    const parsed = JSON.parse(raw) as KnowledgeIndexFile;
    if (!parsed || !Array.isArray(parsed.entries)) return emptyIndexFile();
    return { version: 1, entries: parsed.entries };
  } catch {
    return emptyIndexFile();
  }
}

/**
 * 写双索引：JSON（机器检索）+ `_索引.md`（人类 MOC）。
 * 索引写失败不阻断主流程——调用方自行决定是否向上传播（存库主笔记已成功）。
 */
export async function writeIndex(
  cfg: ObsidianConfig,
  fetchFn: ObsidianFetch,
  file: KnowledgeIndexFile,
): Promise<void> {
  const json = JSON.stringify({ version: 1, entries: file.entries }, null, 2);
  await putNote(cfg, fetchFn, indexPath(cfg.rootDir), json);
  await putNote(cfg, fetchFn, indexMarkdownPath(cfg.rootDir), buildIndexMarkdown(file));
}

/** 读 Obsidian 配置；未配置（三段全空）返回 null */
export async function getObsidianConfig(): Promise<ObsidianConfig | null> {
  const settings = await readSettings();
  const stored = settings.obsidian as Partial<ObsidianConfig> | undefined;
  if (!stored || typeof stored !== 'object') return null;
  const cfg: ObsidianConfig = {
    baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : '',
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    rootDir: typeof stored.rootDir === 'string' ? stored.rootDir : '',
  };
  if (!cfg.baseUrl && !cfg.apiKey && !cfg.rootDir) return null;
  return cfg;
}

/** 保存 Obsidian 配置：与 settings 现有分区合并写（不动 model 段） */
export async function saveObsidianConfig(cfg: ObsidianConfig): Promise<void> {
  const settings = await readSettings();
  await sendRuntimeMessage({ type: MSG.SET_SETTINGS, payload: { ...settings, obsidian: cfg } });
}

/** 连通性自检：成功返回根目录条目（供设置页显示条目数）；失败 throw（文案含操作指引） */
export async function testObsidianConnection(
  cfg: ObsidianConfig,
  fetchFn: ObsidianFetch = defaultFetch,
): Promise<{ ok: true; rootEntries: string[] }> {
  return await testConnection(cfg, fetchFn);
}

/** 读配置并校验必填（未配置时 throw 可操作文案） */
async function requireConfig(): Promise<ObsidianConfig> {
  const cfg = await getObsidianConfig();
  if (!cfg || !cfg.baseUrl || !cfg.apiKey) {
    throw new Error('未配置 Obsidian：请先在设置页填写接口地址、API Key 与笔记根目录');
  }
  return cfg;
}

/** 视频笔记存库：落盘 + 双索引更新，返回笔记路径
 *
 * SPEC-09 9.7：目标笔记文件已存在时走**标记合并路径**——只增删/替换
 * `%% vsc:notes:start … %%` 区块，标记外（含用户手写）原样保留（A9）；
 * 文件不存在时按原行为全量生成，并把笔记区块直接内联。
 */
export async function saveVideoNoteToObsidian(args: {
  videoId: string;
  meta: VideoMeta;
  sections: Section[];
  fetchFn?: ObsidianFetch;
}): Promise<{ path: string }> {
  const cfg = await requireConfig();
  const fetchFn = args.fetchFn ?? defaultFetch;
  const { videoNote } = vaultPathsFor(args.meta, cfg.rootDir);
  const note = buildVideoNoteMarkdown({
    meta: args.meta,
    sections: args.sections,
    sourceVideoId: args.videoId,
  });

  // 大纲笔记（SPEC-09 9.7）：自动携带该视频全部笔记
  const notes = await listNotesByVideo(db, args.videoId).catch(() => []);

  let markdown = note.markdown;
  try {
    const existing = await getNote(cfg, fetchFn, videoNote);
    if (existing.trim().length > 0) {
      // 已有文件：只动笔记区块，手写内容保留（A9）
      markdown = applyNotesToMarkdown(existing, args.meta, args.sections, notes);
    } else {
      markdown = applyNotesToMarkdown(note.markdown, args.meta, args.sections, notes);
    }
  } catch {
    // 读取失败（404 / 网络）→ 全量生成并内联笔记区块
    markdown = applyNotesToMarkdown(note.markdown, args.meta, args.sections, notes);
  }

  await putNote(cfg, fetchFn, videoNote, markdown);

  const file = await readIndex(cfg, fetchFn);
  const entry: KnowledgeIndexEntry = {
    path: videoNote,
    title: args.meta.title,
    category: 'video-note',
    tags: ['ai', '视频笔记'],
    terms: note.terms,
    summaryPreview: note.summaryPreview,
    videoId: args.videoId,
    updatedAt: new Date().toISOString(),
  };
  await writeIndex(cfg, fetchFn, upsertIndexEntry(file, entry));
  return { path: videoNote };
}

/** 术语卡存库：先确定性去重（阈值 0.8），命中 throw 由 UI 提示合并 */
export async function saveTermCardToObsidian(args: {
  term: string;
  payload: TermPayloadLike;
  meta: VideoMeta;
  existingTerms: Array<{ term: string }>;
  /** 该术语在视频中的出现位置（毫秒；缺省 0） */
  timestampMs?: number;
  fetchFn?: ObsidianFetch;
}): Promise<{ path: string; duplicate: string | null }> {
  const dup = findDuplicateTerm(args.term, args.existingTerms);
  if (dup.duplicate !== null) {
    throw new Error(`已存在相似术语「${dup.duplicate}」（相似度 ${dup.similarity}），是否合并？`);
  }

  const cfg = await requireConfig();
  const fetchFn = args.fetchFn ?? defaultFetch;
  const tMs = args.timestampMs ?? 0;
  const { termDir } = vaultPathsFor(args.meta, cfg.rootDir);
  const path = termNotePath(args.term, termDir);
  const note = buildTermCardMarkdown({
    term: args.term,
    payload: args.payload,
    meta: args.meta,
    timestampMs: tMs,
  });

  await putNote(cfg, fetchFn, path, note.markdown);

  const file = await readIndex(cfg, fetchFn);
  const entry: KnowledgeIndexEntry = {
    path,
    title: args.term,
    category: 'term',
    tags: ['ai', '术语'],
    terms: [args.term, ...(args.payload.relatedTerms ?? [])],
    summaryPreview: note.summaryPreview,
    videoId: args.meta.videoId,
    updatedAt: new Date().toISOString(),
  };
  await writeIndex(cfg, fetchFn, upsertIndexEntry(file, entry));

  // 术语卡同时入本地缓存（键 [term, videoId]）；写失败不阻断存库结果
  try {
    const card: TermCard = {
      term: args.term,
      inVideoMeaning: args.payload.inVideoMeaning,
      generalDefinition: args.payload.generalDefinition,
      analogy: args.payload.analogy,
      relatedTerms: args.payload.relatedTerms ?? [],
      videoId: args.meta.videoId,
      sourceUrl: playbackUrl(args.meta, tMs),
      timestampMs: tMs,
      createdAt: new Date().toISOString(),
    };
    await db.put(DB.stores.terms, [args.term, args.meta.videoId], card);
  } catch {
    /* 本地缓存写失败忽略 */
  }

  return { path, duplicate: null };
}
