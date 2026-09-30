/**
 * 导图 Tab（SPEC-04 范围变更：概念知识图）：
 * - 概念图（默认视图）：props.conceptMap（缓存命中）或本地术语关联图降级，
 *   d3-flextree 布局（nodeSize [36,120]，根在左向右展开）+ 自绘 SVG
 *   （圆角矩形节点三级尺寸、贝塞尔连线、CSS transition 展开/收起动画）；
 *   domain 点击折叠/展开；concept 点击跳播第一个锚点，锚点小圆点可点
 *   （红线 2：锚 = 章节 startMs，大纲管线吸附产物）；
 *   概念跟随：matchConcepts（当前章节 terms/标题 ↔ 概念 label，大小写不敏感）
 *   → .cm-active 高亮 + 滚出可视区时平滑滚动；
 * - 章节时间轴（次要视图）：原 markmap 实现整体保留为 ChronoView。
 *
 * 布局用 d3-flextree（纯 JS，node 测试环境可用）；展开动画走 CSS transition
 * （transform/opacity，避免引入 d3-selection/d3-transition 命令式操作与 React 冲突）。
 * markmap 仅由 ChronoView 的 effect 内动态 import（概念视图不加载引擎）。
 * 组件完全 props 驱动，App.tsx 新增接线由父 agent 完成（新 props 全可选）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Markmap } from 'markmap-view';
import type { ConceptMapData, ConceptNode, Section } from '../types';
import { buildTermIndexMap, shortenLabel } from '../core/pipeline/conceptMap';
import { formatTimestamp } from './SubtitleTab';
import './mindmap.css';

// d3-flextree 未附带类型声明（仅用 flextree 工厂函数，绑定按 any 处理）
// @ts-expect-error no declaration file for module 'd3-flextree'
import { flextree } from 'd3-flextree';

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

/**
 * 概念跟随命中（纯函数，导出供单测）：
 * 当前章节（二分）的 terms + 标题对概念 label 做包含匹配（大小写不敏感），
 * 返回命中的概念 label 列表（去重，遍历顺序稳定）。
 */
export function matchConcepts(
  sections: Section[],
  positionMs: number,
  root: ConceptNode,
): string[] {
  const idx = findActiveSectionIndex(sections, positionMs);
  if (idx < 0) return [];
  const sec = sections[idx];
  const candidates = [sec.title, ...sec.terms].map((s) => s.toLowerCase());
  const out: string[] = [];
  const walk = (n: ConceptNode) => {
    if (n.kind === 'concept') {
      const label = n.label.toLowerCase();
      if (candidates.some((c) => c.includes(label)) && !out.includes(n.label)) {
        out.push(n.label);
      }
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
// 概念图视图（自绘 SVG + d3-flextree）
// ---------------------------------------------------------------------------

/** 深度轴步长：宽方向每层 120px；兄弟轴：每节点 36px（SPEC-04 范围变更） */
const CM_X_STEP = 120;
const CM_SIBLING = 36;
/** 兄弟节点额外间距（flextree spacing） */
const CM_SPACING = 8;

/** 布局树节点（ConceptNode 的渲染副本：flextree 会就地写入 x/y，不污染 props） */
interface LayoutNode {
  id: string;
  label: string;
  kind: ConceptNode['kind'];
  importance: number;
  anchors: ConceptNode['anchors'];
  childCount: number;
  children: LayoutNode[];
  /** flextree 就地写入：兄弟轴中心（纵向） */
  x: number;
  /** flextree 就地写入：深度轴起点（横向） */
  y: number;
}

/** 概念图 → 布局树（domain 按 expanded 折叠；根永远展开） */
function toLayoutTree(node: ConceptNode, expanded: ReadonlySet<string>): LayoutNode {
  const isOpen = node.id === 'cm_root' || expanded.has(node.id);
  const visibleChildren =
    node.kind === 'domain' ? (isOpen ? node.children : []) : node.children;
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    importance: node.importance,
    anchors: node.anchors,
    childCount: node.children.length,
    children: visibleChildren.map((c) => toLayoutTree(c, expanded)),
    x: 0,
    y: 0,
  };
}

/** 概念图渲染节点尺寸（三级：domain / concept / detail） */
const NODE_SHAPE: Record<ConceptNode['kind'], { w: number; h: number; rx: number }> = {
  domain: { w: 116, h: 34, rx: 8 },
  concept: { w: 116, h: 30, rx: 6 },
  detail: { w: 116, h: 24, rx: 4 },
};

const conceptLayout = flextree({
  nodeSize: () => [CM_SIBLING, CM_X_STEP] as [number, number],
  spacing: () => CM_SPACING,
});

/** 布局后的平铺节点（含父节点引用，用于贝塞尔连线） */
interface PlacedNode {
  node: LayoutNode;
  parent: LayoutNode | null;
}

function placeTree(root: LayoutNode): PlacedNode[] {
  conceptLayout(root); // 就地写入 x/y
  const out: PlacedNode[] = [];
  const walk = (node: LayoutNode, parent: LayoutNode | null) => {
    out.push({ node, parent });
    for (const child of node.children) walk(child, node);
  };
  walk(root, null);
  return out;
}

/** 贝塞尔连线（父右缘 → 子左缘，水平方向 C 曲线） */
function linkPath(parent: LayoutNode, child: LayoutNode): string {
  const x0 = parent.y + NODE_SHAPE[parent.kind].w;
  const y0 = parent.x;
  const x1 = child.y;
  const y1 = child.x;
  const mx = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
}

/** 概念图视图（数据 + 布局 + 交互；root 由调用方决定来源：缓存或本地降级） */
function ConceptView({
  root,
  sections,
  positionMs,
  onRequestSeek,
  fallbackHint,
}: {
  root: ConceptNode;
  sections: Section[];
  positionMs: number;
  onRequestSeek?: (ms: number) => void;
  fallbackHint?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** 展开的 domain 节点 id（默认全部折叠，只显示概念域） */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** 首次挂载新图时重置折叠态 */
  const rootIdRef = useRef<string | null>(null);
  if (rootIdRef.current !== root.id + root.children.map((c) => c.id).join(',')) {
    rootIdRef.current = root.id + root.children.map((c) => c.id).join(',');
    if (expanded.size > 0) setExpanded(new Set());
  }

  const placed = useMemo(() => placeTree(toLayoutTree(root, expanded)), [root, expanded]);

  // 概念跟随：命中 label 集合（大小写不敏感）
  const activeLabels = useMemo(
    () => new Set(matchConcepts(sections, positionMs, root).map((l) => l.toLowerCase())),
    [sections, positionMs, root],
  );
  const lastActiveKeyRef = useRef('');

  // 高亮变化且节点滚出可视区时平滑滚动聚焦
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeLabels.size === 0) return;
    const key = [...activeLabels].sort().join('|');
    if (key === lastActiveKeyRef.current) return;
    lastActiveKeyRef.current = key;
    const target = container.querySelector('.cm-node.cm-active');
    if (target) {
      const rect = target.getBoundingClientRect();
      const view = container.getBoundingClientRect();
      if (rect.bottom < view.top || rect.top > view.bottom) {
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [activeLabels]);

  // 布局包围盒 → viewBox（窄栏整体 fit 可见）
  const viewBox = useMemo(() => {
    if (placed.length === 0) return '0 0 100 100';
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { node } of placed) {
      const shape = NODE_SHAPE[node.kind];
      minX = Math.min(minX, node.y);
      maxX = Math.max(maxX, node.y + shape.w);
      minY = Math.min(minY, node.x - shape.h / 2);
      maxY = Math.max(maxY, node.x + shape.h / 2);
    }
    const pad = 16;
    return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  }, [placed]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="cm-container" ref={containerRef}>
      {fallbackHint && <div className="cm-fallback-hint">模型生成未接线，已降级为本地术语关联图</div>}
      <svg className="cm-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {placed.map(({ node, parent }) =>
          parent ? (
            <path key={`l-${node.id}`} className={`cm-link cm-link--${node.kind}`} d={linkPath(parent, node)} />
          ) : null,
        )}
        {placed.map(({ node }) => {
          const shape = NODE_SHAPE[node.kind];
          const isOpen = expanded.has(node.id);
          const active = node.kind === 'concept' && activeLabels.has(node.label.toLowerCase());
          return (
            <g
              key={node.id}
              className={[
                'cm-node',
                `cm-node--${node.kind}`,
                active ? 'cm-active' : '',
                node.kind === 'domain' && node.childCount > 0 ? 'cm-toggle' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-importance={node.importance}
              style={{ transform: `translate(${node.y}px, ${node.x}px)` }}
              onClick={() => {
                if (node.kind === 'domain') {
                  if (node.childCount > 0) toggle(node.id);
                  return;
                }
                if (node.kind === 'concept' && node.anchors.length > 0) {
                  onRequestSeek?.(node.anchors[0].tMs);
                }
              }}
            >
              <rect
                className="cm-rect"
                x={0}
                y={-shape.h / 2}
                width={shape.w}
                height={shape.h}
                rx={shape.rx}
              />
              <text
                className="cm-text"
                x={node.kind === 'domain' ? 10 : 8}
                y={0}
                dominantBaseline="central"
              >
                {node.kind === 'detail' ? shortenLabel(node.label, 20) : node.label}
              </text>
              {node.kind === 'domain' && node.childCount > 0 && (
                <text className="cm-badge" x={shape.w - 8} y={0} dominantBaseline="central">
                  {isOpen ? '−' : `+${node.childCount}`}
                </text>
              )}
              {node.kind === 'concept' &&
                node.anchors.map((a, i) => (
                  <circle
                    key={`${node.id}-a${i}`}
                    className="cm-anchor"
                    cx={10 + i * 10}
                    cy={shape.h / 2 - 5}
                    r={2.5}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestSeek?.(a.tMs);
                    }}
                  >
                    <title>{`跳播到 ${formatRange(a.tMs)}`}</title>
                  </circle>
                ))}
            </g>
          );
        })}
      </svg>
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

/** 概念图标签与引导文案（导出供单测断言） */
export const CONCEPT_VIEW_LABEL = '概念图';
export const CHRONO_VIEW_LABEL = '时间轴';
export const CONCEPT_GENERATE_TEXT = '生成知识图';
export const CONCEPT_GENERATING_TEXT = '正在生成概念知识图…';
export const CONCEPT_MODEL_HINT = '需先配置模型才能生成概念知识图';
export const CONCEPT_OPEN_SETTINGS_TEXT = '去设置';

/**
 * 组件完全 props 驱动（App.tsx 接线由父 agent 完成）。
 * 现有 props（sections/positionMs/onRequestSeek/onGoOutline）保持可选 + 默认值，
 * 新增 props（videoTitle/modelReady/onOpenSettings/generateConceptMap/conceptMap/generating）
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
              fallbackHint
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
