/**
 * 导图 Tab（SPEC-04）：
 * Section[] 组装为三级 Markdown（根/章节/要点）→ markmap 渲染（可缩放折叠）；
 * 节点点击跳播（svg 事件委托 + 纯函数 parseNodeTimestamp 提取开头 mm:ss）；
 * 播放跟随（纯函数 findActiveSectionIndex 二分找当前章 → 文本匹配节点加 .mm-active 高亮，
 * 高亮目标变化且节点滚出可视区时才 scrollIntoView，防抖动）。
 *
 * markmap-lib / markmap-view 通过 effect 内动态 import 引入：
 * 一是 node 测试环境（无 DOM）import 本模块不会拉入 markmap（空大纲分支可 renderToString），
 * 二是侧边栏打开但未生成大纲时不加载渲染引擎。
 *
 * 红线 2 消费侧：跳播只用吸附后的 section.startMs / bullet.startMs
 * （buildMindmapMarkdown 组装时即用吸附值，parseNodeTimestamp 提取的即该时间戳）。
 * 组件完全 props 驱动，App.tsx 接线由父 agent 完成。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Markmap } from 'markmap-view';
import type { Section } from '../types';
import { formatTimestamp } from './SubtitleTab';
import './mindmap.css';

export interface MindmapTabProps {
  /** 大纲章节（空数组 = 未生成，显示引导） */
  sections?: Section[];
  /** 当前播放位置（毫秒） */
  positionMs?: number;
  /** 节点点击跳播（App 传：发 MSG.SEEK） */
  onRequestSeek?: (targetMs: number) => void;
  /** 无大纲时引导去大纲 Tab 生成（可选） */
  onGoOutline?: () => void;
}

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

/**
 * 组件完全 props 驱动（App.tsx 接线由父 agent 完成）。
 * props 可选并带默认值仅为兼容 App.tsx 当前的占位调用 `<MindmapTab />`（禁改），
 * 接线后所有行为均由传入 props 决定，默认值不生效。
 */
export function MindmapTab(props: MindmapTabProps) {
  const { sections = [], positionMs = 0, onRequestSeek, onGoOutline } = props;

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
  }, [activeIndex, renderedMarkdown]);

  if (sections.length === 0) {
    return <MindmapEmptyGuide onGoOutline={onGoOutline} />;
  }

  return (
    <div className="mindmap-tab">
      <div className="mindmap-container" ref={containerRef}>
        <svg className="markmap" ref={svgRef} />
      </div>
    </div>
  );
}
