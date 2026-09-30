/**
 * 导图 Tab（SPEC-04 范围变更二次迭代：概念图改为 HTML 知识卡片流）：
 * - 概念图（默认视图）：props.conceptMap（缓存/生成）或本地术语关联图降级；
 *   纯 HTML/CSS 卡片流（窄边栏媒介适配，SVG/d3-flextree 已移除）：
 *   概念域卡（域名 + 概念数徽标）→ 概念行（名称粗体点击跳播第一个锚点、
 *   重要度文字徽标〔核心/重要/常用/了解，替换圆点〕、时间 chips [mm:ss]
 *   可点跳播、细节折叠 grid 0fr/1fr 过渡）；
 * - 降级横幅（degraded=true）：黄底"模型生成失败，当前为术语关联图（降级）"
 *   + 重试按钮（调 props.generateConceptMap），消除静默降级；
 * - 概念跟随：matchConcepts 精确匹配（概念 label 归一化后 ∈ 当前章节 terms，
 *  且该 section 覆盖 positionMs；不命中不亮，修复 substring 过松亮起多个）
 *   → .concept-active 高亮（过渡动画）+ 滚出可视区时平滑滚动；
 * - 章节时间轴（次要视图）：markmap 实现整体保留为 ChronoView。
 * 组件完全 props 驱动。降级判定双手段并存（types.ts 不得加字段）：
 * props.degraded（App 生成 catch 路径设置）+ 根 label/model 约定（isTermIndexData）。
 * markmap 仅由 ChronoView 的 effect 内动态 import（概念视图不加载引擎）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Markmap } from 'markmap-view';
import type { ConceptMapData, ConceptNode, Section } from '../types';
import { TERM_INDEX_ROOT_LABEL, buildTermIndexMap } from '../core/pipeline/conceptMap';
import { formatTimestamp } from './SubtitleTab';
import './mindmap.css';

export interface MindmapTabProps {
  /** 大纲章节（空数组 = 未生成，显示引导） */
  sections?: Section[];
  /** 视频标题（概念图虚拟根 label 与生成入参） */
  videoTitle?: string;
  /** 当前播放位置（毫秒） */
  positionMs?: number;
  /** 节点点击跳播（App 传：发 MSG.SEEK） */
  onRequestSeek?: (ms: number) => void;
  /** 模型是否就绪（未配置时概念图生成按钮转为设置引导） */
  modelReady?: boolean;
  /** 打开设置页（模型未配置引导） */
  onOpenSettings?: () => void;
  /** 生成概念图（注入 mindmapLoader.generateConceptMap 的包装；未接线时组件降级为本地术语图） */
  generateConceptMap?: (sections: Section[], videoTitle: string) => Promise<void>;
  /** 缓存命中的概念图（App 注入） */
  conceptMap?: ConceptMapData | null;
  /** 生成中（骨架动画） */
  generating?: boolean;
  /** conceptMap 为降级术语关联图（App 生成 catch 路径设置；与根 label 约定双手段并存） */
  degraded?: boolean;
  /** 无大纲时引导去大纲 Tab 生成（可选） */
  onGoOutline?: () => void;
}

// ---------------------------------------------------------------------------
// ChronoView（章节时间轴，原 markmap 实现，代码整体保留）
// ---------------------------------------------------------------------------

/** 根节点文案（父 agent 接线时可扩展为视频标题，本期固定） */
export const MINDMAP_ROOT_TEXT = '大纲';

/** 空大纲引导文案 */
export const MINDMAP_EMPTY_TEXT = '请先生成大纲';

/** 空大纲引导按钮文案 */
export const MINDMAP_EMPTY_ACTION_TEXT = '去生成大纲';

/**
 * 章节节点标题（markdown `## ` 后的内容）：
 * `{mm:ss} {title}（{score}分）`；score 缺省时无分后缀（避免 `(undefined分)`）；
 * 高密度章节追加【高密】醒目标记（SPEC-04 §1）。
 */
export function sectionHeadingText(section: Section): string {
  const scoreSuffix = section.score != null ? `（${section.score}分）` : '';
  const densitySuffix = section.density === 'high' ? '【高密】' : '';
  return `${formatTimestamp(section.startMs)} ${section.title}${scoreSuffix}${densitySuffix}`;
}

/**
 * 章节节点的稳定匹配前缀（`{mm:ss} {title}`）：
 * 播放跟随高亮时用它对 markmap 节点做文本匹配（不含 score/密度后缀，
 * 避免 html 渲染差异导致匹配失败）。
 */
export function sectionHeadingPrefix(section: Section): string {
  return `${formatTimestamp(section.startMs)} ${section.title}`;
}

/**
 * 组装导图 Markdown（纯函数）：
 * `# 大纲` → 每章 `## {mm:ss} {title}（{score}分）` → 每要点 `### {mm:ss} {text}`。
 * 时间戳即跳播锚点（组装用吸附后 startMs，红线 2）。
 */
export function buildMindmapMarkdown(sections: Section[]): string {
  const lines: string[] = [`# ${MINDMAP_ROOT_TEXT}`];
  for (const section of sections) {
    lines.push(`## ${sectionHeadingText(section)}`);
    for (const bullet of section.bullets) {
      lines.push(`### ${formatTimestamp(bullet.startMs)} ${bullet.text}`);
    }
  }
  return lines.join('\n');
}

/** 开头 `mm:ss` 提取（分钟可为累计值如 61:11；秒必须 00-59；0 是合法值） */
const NODE_TIMESTAMP_RE = /^\s*(\d+):([0-5]\d)(?!\d)/;

/**
 * 从 markmap 节点文本提取开头时间戳 → 毫秒；无时间戳返回 null。
 * 纯函数（节点 DOM 的 textContent 作为输入），供事件委托与单测复用。
 */
export function parseNodeTimestamp(text: string): number | null {
  const m = NODE_TIMESTAMP_RE.exec(text);
  if (!m) return null;
  const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 当前章节下标查找（二分，sections 按 startMs 严格递增）：
 * 命中 startMs<=pos<endMs 的章；间隙取最后 startMs<=pos 者（超过末章 endMs 仍停留末章）；
 * 空数组或 pos 早于首章返回 -1。
 */
export function findActiveSectionIndex(sections: Section[], positionMs: number): number {
  if (sections.length === 0) return -1;
  let lo = 0;
  let hi = sections.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid].startMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** 概念跟随的归一化（trim + 小写，两侧同规则才能精确相等） */
const normalizeTerm = (s: string): string => s.trim().toLowerCase();

/**
 * 概念跟随命中（纯函数，导出供单测；二次迭代改精确匹配）：
 * 当前章节（二分，覆盖 positionMs）的 terms 与概念 label 双侧归一化后
 * **精确相等**才命中（修复 substring 包含匹配过松导致"亮起好多个"）；
 * 章节标题不再参与匹配。返回命中的概念 label 列表（去重，遍历顺序稳定）。
 */
export function matchConcepts(
  sections: Section[],
  positionMs: number,
  root: ConceptNode,
): string[] {
  const idx = findActiveSectionIndex(sections, positionMs);
  if (idx < 0) return [];
  const termSet = new Set(sections[idx].terms.map(normalizeTerm));
  const out: string[] = [];
  const walk = (n: ConceptNode) => {
    if (
      n.kind === 'concept' &&
      termSet.has(normalizeTerm(n.label)) &&
      !out.includes(n.label)
    ) {
      out.push(n.label);
    }
    for (const child of n.children) walk(child);
  };
  walk(root);
  return out;
}

/** 锚点时间格式：`mm:ss`（endMs 给出时 `mm:ss-mm:ss` 区间） */
export function formatRange(startMs: number, endMs?: number): string {
  return endMs != null && Number.isFinite(endMs)
    ? `${formatTimestamp(startMs)}-${formatTimestamp(endMs)}`
    : formatTimestamp(startMs);
}

/**
 * 重要度文字徽标（二次迭代：替换无语义圆点）：
 * >=5 核心 / >=4 重要 / >=3 常用 / 其他 了解。
 */
export function importanceBadge(importance: number): string {
  if (importance >= 5) return '核心';
  if (importance >= 4) return '重要';
  if (importance >= 3) return '常用';
  return '了解';
}

/**
 * 降级数据判定（ConceptMapData 无 degraded 字段的约定手段，导出供单测）：
 * termIndexFallback 产物 model='term-index' 且根 label='术语关联图'。
 */
export function isTermIndexData(data: ConceptMapData): boolean {
  return data.model === 'term-index' || data.root.label === TERM_INDEX_ROOT_LABEL;
}

/** 空大纲引导（独立导出：不依赖 markmap/DOM，renderToString 可测） */
export function MindmapEmptyGuide({ onGoOutline }: { onGoOutline?: () => void }) {
  return (
    <div className="tab-placeholder mindmap-empty">
      <p>{MINDMAP_EMPTY_TEXT}</p>
      {onGoOutline && (
        <button type="button" className="btn btn-primary" onClick={onGoOutline}>
          {MINDMAP_EMPTY_ACTION_TEXT}
        </button>
      )}
    </div>
  );
}

/** 章节时间轴视图（原 markmap 实现，SPEC-04 验收后保留为次要视图） */
export function ChronoView({
  sections,
  positionMs = 0,
  onRequestSeek,
}: {
  sections: Section[];
  positionMs?: number;
  onRequestSeek?: (ms: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);
  /** markmap 实例绑定的 svg（sections 空→非空切换后 svg 重建，旧实例需销毁重建） */
  const mmSvgRef = useRef<SVGSVGElement | null>(null);
  /** 最新 ref：onRequestSeek 由父组件每次渲染重建时不影响已绑定的事件委托 */
  const onRequestSeekRef = useRef(onRequestSeek);
  onRequestSeekRef.current = onRequestSeek;
  /** 最近一次滚动/高亮过的 activeIndex，防止每次 positionMs 更新都触发动作抖动 */
  const lastActiveRef = useRef(-1);

  const markdown = useMemo(() => buildMindmapMarkdown(sections), [sections]);
  const activeIndex = findActiveSectionIndex(sections, positionMs);
  /** 实际完成 markmap setData 的 markdown（跟随高亮需等树渲染完成后再查 DOM） */
  const [renderedMarkdown, setRenderedMarkdown] = useState('');

  // 组件卸载：销毁 markmap 实例（释放 d3 zoom 监听）
  useEffect(
    () => () => {
      mmRef.current?.destroy();
      mmRef.current = null;
      mmSvgRef.current = null;
    },
    [],
  );

  // 大纲变化 → 重新 transform + setData + fit（markmap 动态 import，见文件头注释）
  useEffect(() => {
    if (sections.length === 0) return;
    let cancelled = false;
    (async () => {
      const [lib, view] = await Promise.all([import('markmap-lib'), import('markmap-view')]);
      if (cancelled) return;
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const { root } = new lib.Transformer().transform(markdown);
      // sections 空→非空切换后 svg 已重建，旧实例指向已卸载节点，需销毁重建
      if (mmRef.current && mmSvgRef.current !== svgEl) {
        mmRef.current.destroy();
        mmRef.current = null;
        mmSvgRef.current = null;
      }
      let mm = mmRef.current;
      if (!mm) {
        mm = view.Markmap.create(
          svgEl,
          {
            initialExpandLevel: -1,
            maxWidth: 220,
            spacingVertical: 10,
            spacingHorizontal: 96,
            duration: 0,
          },
          root,
        );
        mmRef.current = mm;
        mmSvgRef.current = svgEl;
        mm.fit();
      } else {
        mm.setData(root);
        mm.fit();
      }
      setRenderedMarkdown(markdown);
    })().catch(() => {
      // markmap 渲染失败静默（保持空视图，不阻塞其他 Tab）
    });
    return () => {
      cancelled = true;
    };
  }, [markdown, sections.length]);

  // 节点点击跳播：svg 容器事件委托（markmap 节点为 g，文本在 text / foreignObject 中，
  // 统一取 g.textContent；折叠圆点 circle 走 markmap 默认行为不跳播）
  useEffect(() => {
    if (sections.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('circle')) return;
      const g = target.closest('g');
      if (!g) return;
      const ts = parseNodeTimestamp(g.textContent ?? '');
      if (ts !== null) onRequestSeekRef.current?.(ts);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [sections.length]);

  // 播放跟随：高亮当前章节节点（文本匹配章节标题前缀）+ 滚出可视区时聚焦
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const nodes = Array.from(svg.querySelectorAll('g'));
    if (activeIndex < 0) {
      for (const g of nodes) {
        g.classList.remove('mm-active');
      }
      lastActiveRef.current = -1;
      return;
    }
    const prefix = sectionHeadingPrefix(sections[activeIndex]);
    const matches = nodes.filter((g) => (g.textContent ?? '').includes(prefix));
    for (const g of nodes) {
      g.classList.toggle('mm-active', matches.includes(g));
    }
    const target: Element | null = matches[0] ?? null;
    const changed = lastActiveRef.current !== activeIndex;
    lastActiveRef.current = activeIndex;
    // 高亮目标变化才判断是否需要滚动（避免每次 positionMs 更新都滚动抖动）
    const container = containerRef.current;
    if (changed && target && container) {
      const rect = target.getBoundingClientRect();
      const view = container.getBoundingClientRect();
      if (rect.bottom < view.top || rect.top > view.bottom) {
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex, renderedMarkdown, sections]);

  if (sections.length === 0) {
    return <MindmapEmptyGuide />;
  }

  return (
    <div className="mindmap-container" ref={containerRef}>
      <svg className="markmap" ref={svgRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 概念图视图（HTML 知识卡片流，二次迭代：SVG/d3-flextree 已移除）
// ---------------------------------------------------------------------------

/** 概念图标签与引导文案（导出供单测断言） */
export const CONCEPT_VIEW_LABEL = '概念图';
export const CHRONO_VIEW_LABEL = '时间轴';
export const CONCEPT_GENERATE_TEXT = '生成知识图';
export const CONCEPT_GENERATING_TEXT = '正在生成概念知识图…';
export const CONCEPT_MODEL_HINT = '需先配置模型才能生成概念知识图';
export const CONCEPT_OPEN_SETTINGS_TEXT = '去设置';
/** 降级横幅文案（模型生成失败 → 术语关联图，显式告知不再静默） */
export const CONCEPT_DEGRADED_TEXT = '模型生成失败，当前为术语关联图（降级）';
/** 未接线模型路径的本地降级横幅文案 */
export const CONCEPT_FALLBACK_HINT = '模型生成未接线，已降级为本地术语关联图';
/** 降级横幅重试按钮文案 */
export const CONCEPT_RETRY_TEXT = '重试';
/** 细节折叠切换文案（▸ 收起态 / ▾ 展开态） */
export const CONCEPT_DETAILS_TOGGLE_TEXT = '细节 ▸';
export const CONCEPT_DETAILS_TOGGLE_OPEN_TEXT = '细节 ▾';

/** 概念图视图（HTML 卡片流；root 由调用方决定来源：缓存、App 降级或本地降级） */
function ConceptView({
  root,
  sections,
  positionMs,
  onRequestSeek,
  degraded,
  degradedText,
  onRetry,
}: {
  root: ConceptNode;
  sections: Section[];
  positionMs: number;
  onRequestSeek?: (ms: number) => void;
  /** 降级横幅开关（仅 degraded=true 时渲染，黄底） */
  degraded?: boolean;
  degradedText?: string;
  onRetry?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** 展开细节区的概念 id（默认全部收起） */
  const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(() => new Set());
  /** 首次挂载新图时重置折叠态 */
  const rootKeyRef = useRef('');
  const rootKey = `${root.id}:${root.children.map((c) => c.id).join(',')}`;
  if (rootKeyRef.current !== rootKey) {
    rootKeyRef.current = rootKey;
    if (openDetails.size > 0) setOpenDetails(new Set());
  }

  // 概念跟随：命中 label 集合（精确匹配，归一化后比较）
  const activeLabels = useMemo(
    () => new Set(matchConcepts(sections, positionMs, root).map((l) => l.toLowerCase())),
    [sections, positionMs, root],
  );
  const lastActiveKeyRef = useRef('');

  // 高亮变化且概念行滚出可视区时平滑滚动聚焦
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeLabels.size === 0) return;
    const key = [...activeLabels].sort().join('|');
    if (key === lastActiveKeyRef.current) return;
    lastActiveKeyRef.current = key;
    const target = container.querySelector('.cm-concept.concept-active');
    if (target) {
      const rect = target.getBoundingClientRect();
      const view = container.getBoundingClientRect();
      if (rect.bottom < view.top || rect.top > view.bottom) {
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [activeLabels]);

  const toggleDetails = (id: string) => {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const domains = root.children.filter((n) => n.kind === 'domain');

  return (
    <div className="cm-container" ref={containerRef}>
      {degraded && (
        <div className="cm-degraded-banner" role="status">
          <span className="cm-degraded-text">{degradedText ?? CONCEPT_DEGRADED_TEXT}</span>
          {onRetry && (
            <button type="button" className="cm-retry-btn" onClick={onRetry}>
              {CONCEPT_RETRY_TEXT}
            </button>
          )}
        </div>
      )}
      {domains.map((domain) => (
        <section className="cm-card" key={domain.id}>
          <header className="cm-card-header">
            <span className="cm-card-title">{domain.label}</span>
            <span className="cm-card-count">{`${domain.children.length} 概念`}</span>
          </header>
          <div className="cm-card-body">
            {domain.children
              .filter((n) => n.kind === 'concept')
              .map((concept) => {
                const active = activeLabels.has(normalizeTerm(concept.label));
                const open = openDetails.has(concept.id);
                return (
                  <div key={concept.id} className={`cm-concept${active ? ' concept-active' : ''}`}>
                    <div className="cm-concept-main">
                      <button
                        type="button"
                        className="cm-concept-label"
                        disabled={concept.anchors.length === 0}
                        title={
                          concept.anchors.length > 0
                            ? `跳播到 ${formatRange(concept.anchors[0].tMs)}`
                            : undefined
                        }
                        onClick={() => {
                          if (concept.anchors.length > 0) {
                            onRequestSeek?.(concept.anchors[0].tMs);
                          }
                        }}
                      >
                        {concept.label}
                      </button>
                      <span
                        className="cm-importance-badge"
                        data-importance={concept.importance}
                      >
                        {importanceBadge(concept.importance)}
                      </span>
                    </div>
                    {concept.anchors.length > 0 && (
                      <div className="cm-chips">
                        {concept.anchors.map((a, i) => (
                          <button
                            key={`${concept.id}-a${i}`}
                            type="button"
                            className="cm-chip"
                            title={`跳播到 ${formatRange(a.tMs)}`}
                            onClick={() => onRequestSeek?.(a.tMs)}
                          >
                            {`[${formatTimestamp(a.tMs)}]`}
                          </button>
                        ))}
                      </div>
                    )}
                    {concept.children.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="cm-details-toggle"
                          aria-expanded={open}
                          onClick={() => toggleDetails(concept.id)}
                        >
                          {open ? CONCEPT_DETAILS_TOGGLE_OPEN_TEXT : CONCEPT_DETAILS_TOGGLE_TEXT}
                        </button>
                        {/* 细节折叠：常驻渲染 + grid 0fr/1fr 过渡（参考 outline-regen-collapse） */}
                        <div className={`cm-details-collapse${open ? ' open' : ''}`}>
                          <ul className="cm-details">
                            {concept.children.map((d) => (
                              <li key={d.id}>{d.label}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 生成中骨架动画 */
function ConceptSkeleton() {
  return (
    <div className="cm-skeleton" aria-label="概念图生成中">
      <div className="cm-skeleton-bar" />
      <div className="cm-skeleton-row">
        <div className="cm-skeleton-bar" />
        <div className="cm-skeleton-bar" />
      </div>
      <div className="cm-skeleton-row">
        <div className="cm-skeleton-bar" />
        <div className="cm-skeleton-bar" />
        <div className="cm-skeleton-bar" />
      </div>
      <p className="cm-skeleton-text">正在生成概念知识图…</p>
    </div>
  );
}

/**
 * 组件完全 props 驱动（App.tsx 接线由父 agent 完成）。
 * 现有 props（sections/positionMs/onRequestSeek/onGoOutline）保持可选 + 默认值，
 * 新增 props（videoTitle/modelReady/onOpenSettings/generateConceptMap/conceptMap/generating/degraded）
 * 全可选：未接线时概念图视图自动降级为本地术语关联图（零模型）。
 */
export function MindmapTab(props: MindmapTabProps) {
  const {
    sections = [],
    videoTitle = '',
    positionMs = 0,
    onRequestSeek,
    modelReady = false,
    onOpenSettings,
    generateConceptMap,
    conceptMap = null,
    generating = false,
    degraded = false,
    onGoOutline,
  } = props;

  const [view, setView] = useState<'concept' | 'chrono'>('concept');

  // 未接线模型路径时：本地术语关联图（零模型确定性降级，红线 1）
  const fallbackMap = useMemo(() => {
    if (conceptMap || generateConceptMap) return null;
    if (sections.length === 0) return null;
    return buildTermIndexMap(sections);
  }, [conceptMap, generateConceptMap, sections]);

  const handleGenerate = () => {
    if (!generateConceptMap || sections.length === 0) return;
    void generateConceptMap(sections, videoTitle).catch(() => {
      /* 生成失败由父组件状态呈现；组件不重复处理 */
    });
  };

  // 降级判定双手段并存：props.degraded（App 生成 catch 路径设置）优先，
  // 根 label 约定 / model='term-index' 兜底（types.ts 的 ConceptMapData 无字段）
  const mapDegraded = degraded || (conceptMap != null && isTermIndexData(conceptMap));

  const showEmptyGuide = view === 'concept' && sections.length === 0 && !conceptMap;

  return (
    <div className="mindmap-tab">
      <div className="mm-view-switch" role="tablist">
        <button
          type="button"
          className={`mm-view-btn${view === 'concept' ? ' active' : ''}`}
          onClick={() => setView('concept')}
        >
          {CONCEPT_VIEW_LABEL}
        </button>
        <button
          type="button"
          className={`mm-view-btn${view === 'chrono' ? ' active' : ''}`}
          onClick={() => setView('chrono')}
        >
          {CHRONO_VIEW_LABEL}
        </button>
      </div>

      {showEmptyGuide && <MindmapEmptyGuide onGoOutline={onGoOutline} />}

      {view === 'concept' && !showEmptyGuide && (
        <div className="mm-view-body">
          {conceptMap ? (
            <ConceptView
              root={conceptMap.root}
              sections={sections}
              positionMs={positionMs}
              onRequestSeek={onRequestSeek}
              degraded={mapDegraded}
              degradedText={CONCEPT_DEGRADED_TEXT}
              onRetry={generateConceptMap ? handleGenerate : undefined}
            />
          ) : generating ? (
            <ConceptSkeleton />
          ) : generateConceptMap ? (
            modelReady ? (
              <div className="tab-placeholder cm-gate">
                <p>基于大纲重组为知识结构（概念域 → 概念 → 细节）</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGenerate}
                >
                  {CONCEPT_GENERATE_TEXT}
                </button>
              </div>
            ) : (
              <div className="tab-placeholder cm-gate">
                <p>{CONCEPT_MODEL_HINT}</p>
                {onOpenSettings && (
                  <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
                    {CONCEPT_OPEN_SETTINGS_TEXT}
                  </button>
                )}
              </div>
            )
          ) : fallbackMap ? (
            <ConceptView
              root={fallbackMap.root}
              sections={sections}
              positionMs={positionMs}
              onRequestSeek={onRequestSeek}
              degraded
              degradedText={CONCEPT_FALLBACK_HINT}
            />
          ) : (
            <MindmapEmptyGuide onGoOutline={onGoOutline} />
          )}
        </div>
      )}

      {view === 'chrono' && (
        <div className="mm-view-body">
          <ChronoView sections={sections} positionMs={positionMs} onRequestSeek={onRequestSeek} />
        </div>
      )}
    </div>
  );
}
