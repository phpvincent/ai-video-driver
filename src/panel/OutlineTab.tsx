/**
 * 大纲 Tab（SPEC-03 子任务 3.4）：
 * 手动触发生成 / 章节列表（mm:ss 标题点击跳播 + summary + bullets + terms +
 * density 占位）/ 播放跟随高亮滚动 / 模型未配置跳设置 / 失败重试。
 * 数据经 props 注入（loadOutline），组装见 outlineLoader（subtitleLoader 模式）。
 *
 * 红线 2 消费侧：跳播只用 pipeline 吸附后的 section.startMs。
 * TODO(进度)：runOutline 无块级进度钩子，loading 态暂无块级进度与流式渲染
 * （需 pipeline 暴露 onProgress，已列入需父 agent 处理）。
 */
import { useEffect, useRef, useState } from 'react';
import type { OutlineResult, OutlineSection } from '../core/pipeline/outline';
import type { Density, VideoMeta } from '../types';
import { formatTimestamp } from './SubtitleTab';

export interface OutlineTabProps {
  videoId: string | null;
  /** 来自 App 现有 videoInfo（与 SubtitleTab 同风格） */
  meta: VideoMeta | null;
  positionMs: number;
  /** App 传：发 MSG.SEEK */
  onRequestSeek: (targetMs: number) => void;
  /** 数据源注入（App 接线 outlineLoader.loadOutlineForVideo） */
  loadOutline: (videoId: string) => Promise<OutlineResult>;
  /** App 传：settings 已配置 apiKey */
  modelReady: boolean;
  /** 跳设置页（modelReady=false 时显示入口按钮） */
  onOpenSettings?: () => void;
}

type Phase = 'idle' | 'loading' | 'ready' | 'degraded' | 'empty';

/** 各状态主文案（ready 无文案，正文即章节列表） */
export const OUTLINE_PHASE_TEXT: Record<Phase, string> = {
  idle: '基于字幕生成章节大纲，点击开始',
  loading: '大纲生成中…',
  ready: '',
  degraded: '大纲生成失败，请重试',
  empty: '还没有可用字幕，请先在字幕 Tab 获取字幕',
};

/** 模型未配置提示文案 */
export const OUTLINE_MODEL_NOT_READY_TEXT = '请先在设置页配置模型';

/**
 * 当前章节查找（二分，sections 按 startMs 严格递增）：
 * 命中 startMs<=pos<endMs 的章；间隙取最后 startMs<=pos 的章；
 * pos 早于首章或空数组返回 null。
 */
export function findActiveSection(
  sections: OutlineSection[],
  positionMs: number,
): OutlineSection | null {
  if (sections.length === 0) return null;
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
  return ans < 0 ? null : sections[ans];
}

/** density 徽标文案：OutlineSection 暂无 density 字段（3.5 接上后自动生效），无值时 '-' 占位 */
export function densityLabel(density: Density | undefined): string {
  switch (density) {
    case 'high':
      return '高密';
    case 'mid':
      return '中密';
    case 'low':
      return '低密';
    default:
      return '-';
  }
}

/** 运行时读取 section 上可能存在的 density（类型上 OutlineSection 无此字段） */
function sectionDensity(section: OutlineSection): Density | undefined {
  return (section as { density?: Density }).density;
}

/** ready 态主体：章节列表 + 跟随高亮滚动 + 点标题行跳播 */
export function OutlineSectionList({
  sections,
  activeId,
  onSeek,
}: {
  sections: OutlineSection[];
  /** 当前高亮章节 id；null 表示无 */
  activeId: string | null;
  onSeek: (targetMs: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 上一次滚动到的目标，防止每次 positionMs 更新都触发滚动抖动 */
  const lastScrolledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId || lastScrolledRef.current === activeId) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-section-id="${activeId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      lastScrolledRef.current = activeId;
    }
  }, [activeId]);

  return (
    <div className="outline-list-wrap" ref={wrapRef}>
      <div className="outline-list">
        {sections.map((section) => {
          const density = sectionDensity(section);
          return (
            <div
              key={section.id}
              data-section-id={section.id}
              className={section.id === activeId ? 'outline-section active' : 'outline-section'}
            >
              <div className="outline-section-head" onClick={() => onSeek(section.startMs)}>
                <span className="outline-time">{formatTimestamp(section.startMs)}</span>
                <span className="outline-title">{section.title}</span>
                <span className={`outline-density ${density ?? 'none'}`}>{densityLabel(density)}</span>
              </div>
              <p className="outline-summary">{section.summary}</p>
              <ul className="outline-bullets">
                {section.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
              {section.terms.length > 0 && (
                <div className="outline-terms">{section.terms.join(' · ')}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OutlineTab(props: OutlineTabProps) {
  const { videoId, positionMs, onRequestSeek, loadOutline, modelReady, onOpenSettings } = props;
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<OutlineResult | null>(null);
  /** loadOutline 抛错摘要（degraded 兜底文案之外的具体原因） */
  const [errorText, setErrorText] = useState('');
  /** 请求序号：videoId 切换 / 重新生成后，旧请求结果作废 */
  const reqIdRef = useRef(0);

  // 最新 ref：父组件每次渲染重建 loadOutline 时不影响已发起的请求
  const loadRef = useRef(loadOutline);
  loadRef.current = loadOutline;

  // videoId 变化时重置到 idle
  useEffect(() => {
    reqIdRef.current += 1;
    setPhase('idle');
    setResult(null);
    setErrorText('');
  }, [videoId]);

  const handleGenerate = () => {
    if (!videoId) return;
    const reqId = ++reqIdRef.current;
    setPhase('loading');
    setResult(null);
    setErrorText('');
    loadRef
      .current(videoId)
      .then((r) => {
        if (reqId !== reqIdRef.current) return;
        setResult(r);
        setPhase(r.sections.length > 0 ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        setErrorText(err instanceof Error ? err.message : String(err));
        setPhase('degraded');
      });
  };

  // 无视频 / 模型未配置：占位（与 SubtitleTab idle 同结构）
  if (!videoId || !modelReady) {
    return (
      <div className="tab-placeholder">
        <p>{!videoId ? '打开 B 站视频后可生成章节大纲' : OUTLINE_MODEL_NOT_READY_TEXT}</p>
        {!videoId ? null : onOpenSettings ? (
          <button type="button" className="btn" onClick={onOpenSettings}>
            去设置
          </button>
        ) : null}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="tab-placeholder">
        <p>{OUTLINE_PHASE_TEXT.loading}</p>
      </div>
    );
  }

  if (phase === 'degraded') {
    return (
      <div className="outline-degraded">
        <p className="outline-degraded-text">{errorText || OUTLINE_PHASE_TEXT.degraded}</p>
        <button type="button" className="btn" onClick={handleGenerate}>
          重试
        </button>
      </div>
    );
  }

  if (phase === 'empty') {
    return <div className="outline-empty">{OUTLINE_PHASE_TEXT.empty}</div>;
  }

  if (phase === 'idle') {
    return (
      <div className="tab-placeholder">
        <p>{OUTLINE_PHASE_TEXT.idle}</p>
        <button type="button" className="btn btn-primary" onClick={handleGenerate}>
          生成大纲
        </button>
      </div>
    );
  }

  // ready：章节列表 + 头部统计与重新生成入口
  const sections = result?.sections ?? [];
  const active = findActiveSection(sections, positionMs);
  return (
    <div className="outline-tab">
      <div className="outline-header">
        <span className="outline-count">共 {sections.length} 章</span>
        <button type="button" className="btn" onClick={handleGenerate}>
          重新生成
        </button>
      </div>
      <OutlineSectionList
        sections={sections}
        activeId={active ? active.id : null}
        onSeek={onRequestSeek}
      />
    </div>
  );
}
