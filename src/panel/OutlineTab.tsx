/**
 * 大纲 Tab（SPEC-03 子任务 3.4 + 3c 范围变更）：
 * 挂载自动加载缓存（Tab 切回秒显）/ 全局生成与重新生成 / 章节列表
 * （mm:ss-mm:ss 范围 + 可点跳播的要点时间戳 + 分数徽标）/ 单章内联反馈重生成 /
 * 播放跟随高亮滚动 / 模型未配置跳设置 / 失败重试。
 * 数据经 props 注入（loadOutlineCached / generateOutline / regenerateOne），
 * 组装见 outlineLoader（subtitleLoader 模式）。
 *
 * 红线 2 消费侧：跳播只用吸附后的 section.startMs 与 bullet.startMs。
 * TODO(进度)：runOutline 无块级进度钩子，loading 态暂无块级进度与流式渲染
 * （generateOutline 已透传 onProgress，接 UI 渲染需 pipeline 确认快照结构）。
 */
import { useEffect, useRef, useState } from 'react';
import type { OutlineResult } from '../core/pipeline/outline';
import type { Density, Section, VideoMeta } from '../types';
import { formatTimestamp } from './SubtitleTab';
import { getInflightOutline } from './outlineLoader';
import { ModelPicker } from './ModelPicker';

export interface OutlineTabProps {
  videoId: string | null;
  /** 来自 App 现有 videoInfo（与 SubtitleTab 同风格） */
  meta: VideoMeta | null;
  positionMs: number;
  /** App 传：发 MSG.SEEK */
  onRequestSeek: (targetMs: number) => void;
  /** 只读缓存（挂载自动加载；未命中 throw 'NO_CACHE' → 回到生成按钮态） */
  loadOutlineCached: (videoId: string) => Promise<OutlineResult>;
  /** 全量生成（forceRefresh；生成 / 全局"重新生成"按钮） */
  generateOutline: (videoId: string, opts?: { onProgress?: () => void }) => Promise<OutlineResult>;
  /** 单章重生成（SPEC-03 3c） */
  regenerateOne: (videoId: string, section: Section, feedback?: string) => Promise<OutlineResult>;
  /** 大纲章节变化时通知 App（导图/问答消费；可选） */
  onSectionsChanged?: (sections: Section[]) => void;
  /** App 传：settings 已配置 apiKey */
  modelReady: boolean;
  /** 跳设置页（modelReady=false 时显示入口按钮） */
  onOpenSettings?: () => void;
  /** 存库入口（父 agent 接线 obsidianLoader.saveVideoNoteToObsidian）：未注入时按钮隐藏 */
  onSaveVideoNote?: () => Promise<string>;
}

type Phase = 'idle' | 'loading' | 'ready' | 'degraded' | 'empty';

/** 各状态主文案（ready 无文案，正文即章节列表） */
export const OUTLINE_PHASE_TEXT: Record<Phase, string> = {
  idle: '基于字幕生成章节大纲，点击开始',
  loading: '大纲生成中…',
  ready: '',
  degraded: '大纲生成失败，请重试',
  empty: '暂无可展示内容：请先到字幕 Tab 确认已加载字幕，再回到本页生成大纲',
};

/** 模型未配置提示文案 */
export const OUTLINE_MODEL_NOT_READY_TEXT = '请先在设置页配置模型';

/**
 * 当前章节查找（二分，sections 按 startMs 严格递增）：
 * 命中 startMs<=pos<endMs 的章；间隙取最后 startMs<=pos 的章；
 * pos 早于首章或空数组返回 null。
 */
export function findActiveSection(
  sections: Section[],
  positionMs: number,
): Section | null {
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

/** density 徽标文案（score 缺失时的回退显示） */
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

/** 章节时间范围展示：`mm:ss - mm:ss`（formatTimestamp 复用，等宽字体） */
export function formatRange(startMs: number, endMs: number): string {
  return `${formatTimestamp(startMs)} - ${formatTimestamp(endMs)}`;
}

/**
 * 徽标文案（SPEC-03 3c）：score 存在 → `{score} 分`；
 * 缺失回退旧 density 文字（兼容无 score 的旧缓存/旧数据）。
 */
export function badgeLabel(section: Section): string {
  return section.score != null ? `${section.score} 分` : densityLabel(section.density);
}

/** 单章重生成内联反馈输入框 placeholder */
export const OUTLINE_REGEN_PLACEHOLDER =
  "可选：想往哪个方向重新生成？如'更聚焦代码演示'";

/** 章节卡片：时间范围 + 分数徽标 + 可点跳播的要点时间戳 + 单章重生成入口 */
function SectionCard({
  section,
  active,
  onSeek,
  regenerating,
  errorText,
  onSubmitRegen,
}: {
  section: Section;
  active: boolean;
  onSeek: (targetMs: number) => void;
  /** 本章正在重新生成（按钮禁用 + 骨架闪烁） */
  regenerating: boolean;
  /** 本章重新生成的失败信息（null 表示无） */
  errorText: string | null;
  /** 确认单章重生成（feedback 可空） */
  onSubmitRegen: (section: Section, feedback?: string) => void;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  /** 最近一次提交的反馈（失败重试时复用） */
  const lastFeedbackRef = useRef<string | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** 重生成开始：平滑滚动并保持本章为视觉焦点（选中效果切换到该模块） */
  useEffect(() => {
    if (regenerating) {
      cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [regenerating]);

  const submit = (fb: string | undefined) => {
    lastFeedbackRef.current = fb;
    onSubmitRegen(section, fb);
  };

  return (
    <div
      ref={cardRef}
      data-section-id={section.id}
      className={
        'outline-section' +
        (active || regenerating ? ' active' : '') +
        (regenerating ? ' regenerating' : '')
      }
    >
      <div className="outline-section-head" onClick={() => onSeek(section.startMs)}>
        <span className="outline-time">{formatRange(section.startMs, section.endMs)}</span>
        <span className="outline-title">{section.title}</span>
        <span className={`outline-density ${section.density ?? 'none'}`}>
          {badgeLabel(section)}
        </span>
        <button
          type="button"
          className="outline-regen-btn"
          disabled={regenerating}
          title="重新生成本章"
          onClick={(e) => {
            e.stopPropagation();
            setFeedbackOpen((v) => !v);
          }}
        >
          ↻
        </button>
      </div>
      <p className="outline-summary">{section.summary}</p>
      <ul className="outline-bullets">
        {section.bullets.map((bullet, i) => (
          <li key={i} className="outline-bullet">
            {/* 红线 2：跳播用吸附后的 bullet.startMs；approximate 弱化精度提示 */}
            <button
              type="button"
              className={`outline-bullet-time${bullet.approximate ? ' approx' : ''}`}
              title={bullet.approximate ? '时间近似' : '跳转到此处'}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(bullet.startMs);
              }}
            >
              {`[${formatTimestamp(bullet.startMs)}${bullet.approximate ? '~' : ''}]`}
            </button>
            <span className="outline-bullet-text">{bullet.text}</span>
          </li>
        ))}
      </ul>
      {section.terms.length > 0 && (
        <div className="outline-terms">{section.terms.join(' · ')}</div>
      )}
      {/* 反馈表单常驻渲染，grid 0fr/1fr 过渡实现丝滑展开收起（避免条件渲染的硬切） */}
      <div className={'outline-regen-collapse' + (feedbackOpen && !regenerating ? ' open' : '')}>
        <div className="outline-regen-form">
          <textarea
            className="outline-regen-input"
            rows={2}
            value={feedback}
            placeholder={OUTLINE_REGEN_PLACEHOLDER}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => submit(feedback.trim() || undefined)}
          >
            重新生成本章
          </button>
        </div>
      </div>
      {/* 重生成提示同样走 collapse 过渡 */}
      <div className={'outline-regen-collapse' + (regenerating ? ' open' : '')}>
        <div className="outline-regen-loading">本章重新生成中…</div>
      </div>
      {errorText && !regenerating && (
        <div className="outline-regen-error">
          <span className="outline-regen-error-text">{errorText}</span>
          <button
            type="button"
            className="btn"
            onClick={() => submit(lastFeedbackRef.current)}
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}

/** ready 态主体：章节列表 + 跟随高亮滚动 + 单章重生成状态分发 */
export function OutlineSectionList({
  sections,
  activeId,
  onSeek,
  regeneratingId,
  regenError,
  onSubmitRegen,
}: {
  sections: Section[];
  /** 当前高亮章节 id；null 表示无 */
  activeId: string | null;
  onSeek: (targetMs: number) => void;
  /** 正在单独重生成的章节 id；null 表示无 */
  regeneratingId: string | null;
  /** 单章重生成失败信息；null 表示无 */
  regenError: { sectionId: string; text: string } | null;
  /** 单章重生成确认（SectionCard 内联表单触发） */
  onSubmitRegen: (section: Section, feedback?: string) => void;
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
        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            active={section.id === activeId}
            onSeek={onSeek}
            regenerating={section.id === regeneratingId}
            errorText={regenError?.sectionId === section.id ? regenError.text : null}
            onSubmitRegen={onSubmitRegen}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 结果阶段判定（导出供测试）：
 * - 有分块失败 → degraded（真实原因是模型输出未通过校验，不是缺少字幕）
 * - 有章节 → ready；无章节且无失败 → empty（需先加载字幕再生成）
 */
/**
 * 失败原因可读化（导出供测试）：degraded 态不能只说"请重试"——
 * 要告诉用户是哪一步失败（模型输出未过校验 / 预算熔断 / 无章节），以及能做什么。
 */
export function describeOutlineFailure(r: OutlineResult): string {
  const total = r.chunkState?.length ?? 0;
  const failed = r.failedChunks ?? 0;
  const firstError = (r.chunkState ?? []).find((c) => c.error)?.error;
  if (total > 0 && failed > 0) {
    const hint = r.budgetHit ? '；本次触发了 token 预算熔断' : '';
    const detail = firstError ? `（首个错误：${firstError.slice(0, 80)}）` : '';
    return (
      `大纲生成失败：${failed}/${total} 个分块的模型输出未通过格式校验${hint}${detail}。` +
      '可尝试：更换更稳定的模型、关闭"结合画面（抽帧）"后重试，或在设置中调高 maxTokens。'
    );
  }
  if (total > 0) {
    return '大纲生成失败：模型未返回可解析的章节；可尝试更换模型或关闭抽帧后重试。';
  }
  return OUTLINE_FAILURE_NO_DETAIL;
}

/**
 * 兜底文案：任何失败都必须给出可读原因——
 * 错误对象没带 message 时（接口异常/超时/反序列化失败常见），明确告诉用户去哪里看详情。
 */
export const OUTLINE_FAILURE_NO_DETAIL =
  '大纲生成失败（未提供错误详情）：请打开 DevTools 控制台查看以 [vsc] 开头的日志。' +
  '常见原因：模型输出不符合格式、接口鉴权失败、网络/代理拦截，或生成超时（120 秒）。';

export function pickPhase(r: OutlineResult): Phase {
  if (r.sections.length > 0) return 'ready';
  if (r.failedChunks > 0 || (r.chunkState?.length ?? 0) > 0) return 'degraded';
  return 'empty';
}

/** 带超时的 Promise 包装：避免 DB 卡住或请求悬挂导致"一直生成中" */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function OutlineTab(props: OutlineTabProps) {
  const {
    videoId,
    positionMs,
    onRequestSeek,
    loadOutlineCached,
    generateOutline,
    regenerateOne,
  onSectionsChanged,
    modelReady,
    onOpenSettings,
  } = props;
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<OutlineResult | null>(null);

  /** 大纲结果变化 → 通知 App（导图与问答 Tab 消费 sections） */
  useEffect(() => {
    if (result?.sections) onSectionsChanged?.(result.sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  /** loadOutline 抛错摘要（degraded 兜底文案之外的具体原因） */
  const [errorText, setErrorText] = useState('');
  /** 单章重生成：进行中的章节 id / 失败信息 */
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<{ sectionId: string; text: string } | null>(null);
  /** 存库（存入 Obsidian）：进行中标记与行内结果文本（红线 8：失败不崩面板） */
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  /** 请求序号：videoId 切换 / 重新生成后，旧请求结果作废 */
  const reqIdRef = useRef(0);
  /** 已尝试自动加载的 videoId（同一挂载周期只试一次；手动生成后不被覆盖） */
  const autoTriedRef = useRef<string | null>(null);

  // 最新 ref：父组件每次渲染重建注入函数时不影响已发起的请求
  const loadCachedRef = useRef(loadOutlineCached);
  const generateRef = useRef(generateOutline);
  const regenRef = useRef(regenerateOne);
  loadCachedRef.current = loadOutlineCached;
  generateRef.current = generateOutline;
  regenRef.current = regenerateOne;

  // videoId / modelReady 变化：重置状态；有视频且模型就绪时自动尝试缓存
  // （Tab 切走再回来秒显已生成的大纲；未命中 NO_CACHE → 回到生成按钮态）
  useEffect(() => {
    reqIdRef.current += 1;
    setPhase('idle');
    setResult(null);
    setErrorText('');
    setRegeneratingId(null);
    setRegenError(null);
    if (!videoId || !modelReady || autoTriedRef.current === videoId) return;
    autoTriedRef.current = videoId;
    const reqId = reqIdRef.current;
    setPhase('loading');
    withTimeout(loadCachedRef.current(videoId), 8_000, '读取大纲缓存')
      .then((r) => {
        if (reqId !== reqIdRef.current) return;
        setResult(r);
        setPhase(pickPhase(r));
        if (pickPhase(r) === 'degraded') setErrorText(describeOutlineFailure(r));
      })
      .catch(() => {
        if (reqId !== reqIdRef.current) return;
        // NO_CACHE / 读缓存异常 / 超时：先看是否有进行中的生成可续等
        const pending = getInflightOutline(videoId);
        if (pending) {
          withTimeout(pending, 120_000, '生成大纲')
            .then((r) => {
              if (reqId !== reqIdRef.current) return;
              setResult(r);
              setPhase(pickPhase(r));
              if (pickPhase(r) === 'degraded') setErrorText(describeOutlineFailure(r));
            })
            .catch(() => {
              if (reqId !== reqIdRef.current) return;
              setPhase('idle');
            });
          return;
        }
        setPhase('idle');
      });
  }, [videoId, modelReady]);

  const handleGenerate = () => {
    if (!videoId) return;
    const reqId = ++reqIdRef.current;
    setPhase('loading');
    setResult(null);
    setErrorText('');
    setRegenError(null);
    withTimeout(generateRef.current(videoId), 120_000, '生成大纲')
      .then((r) => {
        if (reqId !== reqIdRef.current) return;
        setResult(r);
        setPhase(pickPhase(r));
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        // 失败一律留痕：界面没有详情时，控制台是唯一的诊断入口
        console.error('[vsc] outline generate failed', err);
        const text =
          err instanceof Error
            ? err.message.trim()
            : typeof err === 'string'
              ? err.trim()
              : '';
        setErrorText(text.length > 0 ? text : OUTLINE_FAILURE_NO_DETAIL);
        setPhase('degraded');
      });
  };

  /** 单章重生成：期间该章显示生成中；完成用返回的章节列表替换；失败显示可重试 */
  const handleRegenerateSection = (section: Section, feedback?: string) => {
    if (!videoId) return;
    const reqId = reqIdRef.current;
    setRegenError(null);
    setRegeneratingId(section.id);
    regenRef
      .current(videoId, section, feedback)
      .then((r) => {
        if (reqId !== reqIdRef.current) {
          // 全局重新生成/视频切换已使本请求过期，仅复位单章状态
          setRegeneratingId(null);
          return;
        }
        setRegeneratingId(null);
        setResult(r);
        if (r.sections.length > 0) setPhase('ready');
      })
      .catch((err: unknown) => {
        setRegeneratingId(null);
        if (reqId !== reqIdRef.current) return;
        setRegenError({
          sectionId: section.id,
          text: err instanceof Error ? err.message : String(err),
        });
      });
  };

  /** 一键存入 Obsidian：成功显示返回的笔记路径，失败显示错误摘要 */
  const handleSaveVideoNote = () => {
    const save = props.onSaveVideoNote;
    if (!save) return;
    setSaving(true);
    setSaveResult(null);
    save()
      .then((path) => setSaveResult({ ok: true, text: path ? `已存入：${path}` : '已存入 Obsidian' }))
      .catch((err: unknown) =>
        setSaveResult({ ok: false, text: err instanceof Error ? err.message : String(err) }),
      )
      .finally(() => setSaving(false));
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
        <p className="outline-degraded-text">
          {errorText && errorText.trim().length > 0 ? errorText : OUTLINE_FAILURE_NO_DETAIL}
        </p>
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

  // ready：章节列表 + 头部统计与全局重新生成入口（单章重生成进行中禁用全局按钮）
  const sections = result?.sections ?? [];
  const active = findActiveSection(sections, positionMs);
  return (
    <div className="outline-tab">
      <div className="outline-header">
        <span className="outline-count">共 {sections.length} 章</span>
        <ModelPicker module="outline" />
        {props.onSaveVideoNote && (
          <button
            type="button"
            className="btn"
            onClick={handleSaveVideoNote}
            disabled={saving}
          >
            {saving ? '存入中…' : '存入 Obsidian'}
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={handleGenerate}
          disabled={regeneratingId !== null}
        >
          重新生成
        </button>
      </div>
      {saveResult && (
        <p className={saveResult.ok ? 'outline-save-hint' : 'outline-save-hint outline-save-error'}>
          {saveResult.text}
        </p>
      )}
      <OutlineSectionList
        sections={sections}
        activeId={active ? active.id : null}
        onSeek={onRequestSeek}
        regeneratingId={regeneratingId}
        regenError={regenError}
        onSubmitRegen={handleRegenerateSection}
      />
    </div>
  );
}
