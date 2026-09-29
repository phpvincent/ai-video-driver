/**
 * 问答 Tab（SPEC-05）：对话流 + 打字机渲染 + 常驻区间选择器 + 划词术语入口。
 *
 * props 驱动（App 接线）：模型调用经 explain 注入（loader 组装 compiler + pipeline +
 * qaHistory，父 agent 负责），本文件不 import providers / db / chrome.*。
 * props 全部可选：兼容 App.tsx 当前 <ChatTab /> 占位渲染，接线时传齐。
 * AI 回答采用"响应到达即开始打字机渲染"（~15ms/字，A5 口径：真实流式与 Zod
 * 校验冲突，列 v0.1.x）。explain 失败 throw 时以错误气泡呈现，不崩面板（红线 8）。
 */
import { useEffect, useRef, useState } from 'react';
import { CONTEXT } from '../config';
import { findSectionAt, formatMmSs } from '../core/context/compiler';
import type { SegmentAnswerPayload, TermPayload } from '../core/pipeline/explain';
import { nearestCueStartMs } from '../core/pipeline/snap';
import type { Cue, QaRecord, Section } from '../types';
import './chat.css';

/** 划词/提问请求（父 agent 接线 loader 时组装 compiler + pipeline） */
export interface ExplainRequest {
  term?: string;
  question: string;
  /** null = 自由提问（播放位置 ±30s，由 compiler 默认） */
  rangeMs: [number, number] | null;
  positionMs: number;
}

export interface ExplainResponse {
  term?: TermPayload;
  answer?: SegmentAnswerPayload;
  record: QaRecord;
}

export interface ChatTabProps {
  videoId?: string | null;
  sections?: Section[];
  cues?: Cue[];
  positionMs?: number;
  onRequestSeek?: (ms: number) => void;
  /** 提问自动暂停 */
  onPause?: () => void;
  modelReady?: boolean;
  onOpenSettings?: () => void;
  /** 注入（父 agent 接线）：loader 函数 */
  explain?: (args: ExplainRequest) => Promise<ExplainResponse>;
  /** 划词入口（SubtitleTab 触发）：收到后自动发起术语解释并 consumed() */
  pendingTerm?: { term: string; consumed: () => void };
}

// ---------------------------------------------------------------------------
// 纯函数（导出供单测）
// ---------------------------------------------------------------------------

export type RangeMode = 'around' | 'chapter' | 'custom';

/**
 * 区间选择器解析：around = 播放位置 ±30s；chapter = positionMs 命中整章；
 * custom = 调用方解析好的区间。查不到章节 / 自定义非法时回落 around。
 */
export function resolveRange(
  mode: RangeMode,
  positionMs: number,
  sections: Section[],
  customRange?: [number, number],
): [number, number] {
  if (mode === 'chapter') {
    const sec = findSectionAt(sections, positionMs);
    if (sec) return [sec.startMs, sec.endMs];
  }
  if (mode === 'custom' && customRange && customRange[0] <= customRange[1]) {
    return customRange;
  }
  const pad = CONTEXT.defaultRangePadMs;
  return [Math.max(0, positionMs - pad), positionMs + pad];
}

/** "mm:ss" → 毫秒；非法返回 null */
export function parseMmSs(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):(\d{1,2})$/);
  if (!m) return null;
  const ss = Number(m[2]);
  if (ss > 59) return null;
  return (Number(m[1]) * 60 + ss) * 1000;
}

/** 打字机分片：每片 1-3 字（确定性循环），join 后还原原文 */
export function chunkTypewriter(text: string): string[] {
  const chunks: string[] = [];
  const sizes = [1, 2, 3];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const n = Math.min(sizes[k % sizes.length], text.length - i);
    chunks.push(text.slice(i, i + n));
    i += n;
    k += 1;
  }
  return chunks;
}

/**
 * referencedTimestamps（秒）吸附到最近 Cue 开始时间（A3：渲染前吸附，越界丢弃）。
 * 越界 = 早于首句前 5s 或晚于末句结束后 5s；吸附结果去重并升序。
 */
export function snapTimestamps(seconds: number[], cues: Cue[]): number[] {
  if (cues.length === 0 || seconds.length === 0) return [];
  const starts = cues.map((c) => c.startMs);
  const first = cues[0].startMs;
  const last = cues[cues.length - 1].endMs;
  const out: number[] = [];
  for (const sec of seconds) {
    const target = sec * 1000;
    if (!Number.isFinite(target) || target < first - 5_000 || target > last + 5_000) continue;
    const nearest = nearestCueStartMs(starts, target);
    if (nearest !== null && !out.includes(nearest)) out.push(nearest);
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 组件内消息模型
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  /** user：原文；assistant：当前已渲染文本（打字机推进） */
  text: string;
  /** assistant 目标全文 */
  fullText?: string;
  /** 打字机分片与游标 */
  chunks?: string[];
  chunkIdx?: number;
  typing?: boolean;
  kind?: 'term' | 'segment' | 'error';
  term?: TermPayload;
  answer?: SegmentAnswerPayload;
}

function formatTermText(term: TermPayload): string {
  return [
    `【视频语境】${term.inVideoMeaning}`,
    `【通用定义】${term.generalDefinition}`,
    `【类比】${term.analogy}`,
  ].join('\n\n');
}

export function ChatTab(props: ChatTabProps) {
  const videoId = props.videoId ?? null;
  const sections = props.sections ?? [];
  const cues = props.cues ?? [];
  const positionMs = props.positionMs ?? 0;
  const modelReady = props.modelReady ?? false;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>('around');
  const [customStartText, setCustomStartText] = useState('00:00');
  const [customEndText, setCustomEndText] = useState('01:00');

  const nextIdRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** busy 的最新引用（pendingTerm effect 里避免过期闭包） */
  const busyRef = useRef(false);
  busyRef.current = busy;

  const nextId = (): number => {
    nextIdRef.current += 1;
    return nextIdRef.current;
  };

  /** 追加消息；此前若有打字机进行中的消息则瞬间补完 */
  const pushMessage = (m: ChatMessage): void => {
    setMessages((prev) => [
      ...prev.map((x) =>
        x.typing
          ? { ...x, chunkIdx: x.chunks?.length ?? 0, text: x.fullText ?? x.text, typing: false }
          : x,
      ),
      m,
    ]);
  };

  const customRange = (): [number, number] | undefined => {
    const s = parseMmSs(customStartText);
    const e = parseMmSs(customEndText);
    return s !== null && e !== null ? [s, e] : undefined;
  };

  /** 请求用区间：around 传 null（compiler 默认 ±30s），其余显式 */
  const requestRange = (): [number, number] | null =>
    rangeMode === 'around' ? null : resolveRange(rangeMode, positionMs, sections, customRange());

  const ask = async (req: ExplainRequest): Promise<void> => {
    if (!props.explain || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    props.onPause?.();
    pushMessage({ id: nextId(), role: 'user', text: req.term ? `解释「${req.term}」` : req.question });
    try {
      const res = await props.explain(req);
      if (res.term) {
        const full = formatTermText(res.term);
        pushMessage({
          id: nextId(),
          role: 'assistant',
          kind: 'term',
          text: '',
          fullText: full,
          chunks: chunkTypewriter(full),
          chunkIdx: 0,
          typing: full.length > 0,
          term: res.term,
        });
      } else if (res.answer) {
        const full = res.answer.answer;
        pushMessage({
          id: nextId(),
          role: 'assistant',
          kind: 'segment',
          text: '',
          fullText: full,
          chunks: chunkTypewriter(full),
          chunkIdx: 0,
          typing: full.length > 0,
          answer: res.answer,
        });
      } else {
        const full = res.record?.answer ?? '（空回答）';
        pushMessage({
          id: nextId(),
          role: 'assistant',
          kind: 'segment',
          text: '',
          fullText: full,
          chunks: chunkTypewriter(full),
          chunkIdx: 0,
          typing: full.length > 0,
        });
      }
    } catch (err) {
      // 红线 8：失败以错误气泡呈现，不崩面板
      pushMessage({
        id: nextId(),
        role: 'assistant',
        kind: 'error',
        text: `回答失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const askRef = useRef(ask);
  askRef.current = ask;

  // 划词入口：SubtitleTab 触发 pendingTerm → 自动发起术语解释并 consumed()
  useEffect(() => {
    const pt = props.pendingTerm;
    if (pt?.term) {
      void askRef.current({
        term: pt.term,
        question: `解释术语「${pt.term}」`,
        rangeMs: requestRange(),
        positionMs,
      });
      pt.consumed();
    }
  }, [props.pendingTerm]);

  // 打字机：每 30ms 推进 1 片（1-3 字，均值 ~15ms/字）；卸载 / 重渲染时清理定时器
  useEffect(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!messages.some((m) => m.typing)) return;
    timerRef.current = setInterval(() => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.typing) return m;
          const chunks = m.chunks ?? [];
          const nextIdx = Math.min(chunks.length, (m.chunkIdx ?? 0) + 1);
          return {
            ...m,
            chunkIdx: nextIdx,
            text: chunks.slice(0, nextIdx).join(''),
            typing: nextIdx < chunks.length,
          };
        }),
      );
    }, 30);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [messages]);

  if (!videoId) {
    return (
      <div className="tab-placeholder">
        <p>打开 B 站视频后即可提问</p>
      </div>
    );
  }

  if (!modelReady) {
    return (
      <div className="tab-placeholder">
        <h3>问答</h3>
        <p>模型未配置，请先在设置页配置模型</p>
        {props.onOpenSettings && (
          <button type="button" className="btn" onClick={props.onOpenSettings}>
            去设置
          </button>
        )}
      </div>
    );
  }

  const displayRange = resolveRange(rangeMode, positionMs, sections, customRange());

  const handleSend = (): void => {
    const q = input.trim();
    if (!q || busy || !props.explain) return;
    setInput('');
    void ask({ question: q, rangeMs: requestRange(), positionMs });
  };

  return (
    <div className="chat-tab">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">针对区间提问，或在字幕 Tab 划词解释术语</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.role === 'user' ? (
              <div className="chat-bubble user">{m.text}</div>
            ) : m.kind === 'error' ? (
              <div className="chat-error">{m.text}</div>
            ) : (
              <div className="chat-bubble ai">
                {m.answer && m.answer.coveredByVideo === false && !m.typing && (
                  <div className="chat-covered-bar">视频中未涉及，以下为公开知识补充</div>
                )}
                <div className="chat-answer-text">
                  {m.text}
                  {m.typing && <span className="chat-caret">▍</span>}
                </div>
                {!m.typing && m.answer && (
                  <>
                    {m.answer.keyPoints.length > 0 && (
                      <ul className="chat-keypoints">
                        {m.answer.keyPoints.map((k, i) => (
                          <li key={i}>{k}</li>
                        ))}
                      </ul>
                    )}
                    {snapTimestamps(m.answer.referencedTimestamps, cues).length > 0 && (
                      <div className="chat-timestamps">
                        {snapTimestamps(m.answer.referencedTimestamps, cues).map((ms) => (
                          <button
                            key={ms}
                            type="button"
                            className="chat-ts"
                            onClick={() => props.onRequestSeek?.(ms)}
                          >
                            [{formatMmSs(ms)}]
                          </button>
                        ))}
                      </div>
                    )}
                    {m.answer.followUpQuestions.length > 0 && (
                      <div className="chat-followups">
                        {m.answer.followUpQuestions.map((q, i) => (
                          <button
                            key={i}
                            type="button"
                            className="chat-followup"
                            onClick={() =>
                              void askRef.current({ question: q, rangeMs: requestRange(), positionMs })
                            }
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {!m.typing && m.term && (
                  <div className="chat-term-extra">
                    {m.term.relatedTerms.length > 0 && (
                      <div className="chat-related">
                        {m.term.relatedTerms.map((t) => (
                          <span key={t} className="chat-related-chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.term.needsWeb && <span className="chat-needs-web">需要联网核实</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="chat-loading">思考中…</div>}
      </div>

      <div className="chat-range-bar">
        <label className="chat-range-option">
          <input
            type="radio"
            name="chat-range-mode"
            checked={rangeMode === 'around'}
            onChange={() => setRangeMode('around')}
          />
          播放位置±30s
        </label>
        <label className="chat-range-option">
          <input
            type="radio"
            name="chat-range-mode"
            checked={rangeMode === 'chapter'}
            onChange={() => setRangeMode('chapter')}
          />
          当前整章
        </label>
        <label className="chat-range-option">
          <input
            type="radio"
            name="chat-range-mode"
            checked={rangeMode === 'custom'}
            onChange={() => setRangeMode('custom')}
          />
          自定义
        </label>
        {rangeMode === 'custom' && (
          <span className="chat-range-custom">
            <input
              className="chat-range-input"
              value={customStartText}
              placeholder="mm:ss"
              onChange={(e) => setCustomStartText(e.target.value)}
            />
            <span>–</span>
            <input
              className="chat-range-input"
              value={customEndText}
              placeholder="mm:ss"
              onChange={(e) => setCustomEndText(e.target.value)}
            />
          </span>
        )}
        <span className="chat-range-current">
          当前区间 {formatMmSs(displayRange[0])}-{formatMmSs(displayRange[1])}
        </span>
      </div>

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          rows={2}
          placeholder="输入问题…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary chat-send"
          disabled={busy || !input.trim() || !props.explain}
          onClick={handleSend}
        >
          发送
        </button>
        {!props.explain && <span className="chat-pending">待接线</span>}
      </div>
    </div>
  );
}
