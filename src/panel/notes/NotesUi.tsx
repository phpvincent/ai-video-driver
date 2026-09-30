/**
 * 大纲笔记 UI（SPEC-09 9.3/9.4）：笔记卡（编辑/删除/回复/请助教回答）、
 * 未归位区、导入来源徽标、待确认黄点。数据经 useNotes hook 注入，
 * 组件本身无 DB / 模型依赖（renderToString 可测）。
 */
import { useState } from 'react';
import type { NoteAnchor, OutlineNote, Section } from '../../types';
import type { NotesState } from './notesLoader';
import { formatTimestamp } from '../SubtitleTab';
import './notes.css';

/** 讨论串作者徽标 */
function authorBadge(author: OutlineNote['replies'][number]['author']): string {
  return author === 'assistant' ? '助教' : '我';
}

/** 单条笔记卡：正文（可编辑）+ 讨论串 + 回复框 + 请助教回答 + 删除 */
export function NoteThread({
  note,
  pending,
  busy,
  onUpdateBody,
  onRemove,
  onReply,
  onAskAssistant,
  onSeek,
}: {
  note: OutlineNote;
  /** 待确认（重生成归位后标题变化可疑）→ 黄点 */
  pending?: boolean;
  /** 「请助教回答」进行中 */
  busy?: boolean;
  onUpdateBody: (body: string) => void;
  onRemove: () => void;
  onReply: (body: string) => void;
  onAskAssistant: () => void;
  onSeek?: (ms: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const saveEdit = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdateBody(draft.trim());
    setEditing(false);
  };

  return (
    <div className={`vnote${pending ? ' vnote-pending' : ''}`}>
      <div className="vnote-head">
        {pending && (
          <span className="vnote-pending-dot" title="重生成后章节变化可疑，请确认归位是否正确">
            ●
          </span>
        )}
        <button
          type="button"
          className="vnote-time"
          title={`跳到 ${formatTimestamp(note.anchor.tMs)}`}
          onClick={() => onSeek?.(note.anchor.tMs)}
        >
          [{formatTimestamp(note.anchor.tMs)}]
        </button>
        <span className="vnote-kind">{anchorKindLabel(note.anchor.kind)}</span>
        {note.importedFrom && (
          <span className="vnote-imported" title={`来自 ${note.importedFrom.exporter} 的导出`}>
            导入
          </span>
        )}
        <span className="vnote-actions">
          <button
            type="button"
            className="vnote-act"
            title="编辑笔记"
            onClick={() => {
              setDraft(note.body);
              setEditing((v) => !v);
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="vnote-act vnote-act-danger"
            title="删除笔记"
            onClick={() => {
              if (window.confirm('删除这条笔记？（含讨论串，不可恢复）')) onRemove();
            }}
          >
            ✕
          </button>
        </span>
      </div>
      {editing ? (
        <div className="vnote-edit">
          <textarea
            className="vnote-textarea"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="vnote-edit-btns">
            <button type="button" className="btn" onClick={saveEdit}>
              保存
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="vnote-body">{note.body}</p>
      )}
      {note.replies.length > 0 && (
        <ul className="vnote-replies">
          {note.replies.map((r) => (
            <li key={r.id} className={`vnote-reply${r.author === 'assistant' ? ' is-assistant' : ''}`}>
              <span className="vnote-reply-author">{authorBadge(r.author)}：</span>
              <span className="vnote-reply-body">{r.body}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="vnote-foot">
        <button
          type="button"
          className="vnote-foot-btn"
          onClick={() => setReplyOpen((v) => !v)}
        >
          回复
        </button>
        <button
          type="button"
          className="vnote-foot-btn vnote-ask"
          disabled={busy}
          title="把笔记转成问答（区间 = 锚点所在章节），回答追加为助教回复"
          onClick={onAskAssistant}
        >
          {busy ? '助教回答中…' : '请助教回答'}
        </button>
      </div>
      <div className={'vnote-reply-collapse' + (replyOpen ? ' open' : '')}>
        <div className="vnote-reply-form">
          <textarea
            className="vnote-textarea"
            rows={2}
            value={replyText}
            placeholder="回复这条笔记…"
            onChange={(e) => setReplyText(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (replyText.trim()) {
                onReply(replyText.trim());
                setReplyText('');
                setReplyOpen(false);
              }
            }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

/** 锚点粒度文案 */
export function anchorKindLabel(kind: NoteAnchor['kind']): string {
  return kind === 'section' ? '整章' : kind === 'bullet' ? '要点' : '时间点';
}

/** 新建笔记编辑器（三种锚点入口共用） */
export function NoteEditor({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="vnote vnote-new">
      <textarea
        className="vnote-textarea"
        rows={3}
        autoFocus
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="vnote-edit-btns">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (text.trim()) onSubmit(text.trim());
          }}
        >
          保存笔记
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 某章节的笔记区块（OutlineTab 的 SectionCard 尾部渲染） */
export function SectionNotes({
  section,
  notes,
  pendingIds,
  busyId,
  state,
  onSeek,
}: {
  section: Section;
  notes: OutlineNote[];
  pendingIds: ReadonlySet<string> | null;
  busyId: string | null;
  state: NotesState;
  onSeek?: (ms: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="vnote-section">
      <div className="vnote-section-head">
        <span className="vnote-section-count">{notes.length > 0 ? `${notes.length} 条笔记` : ''}</span>
        <button type="button" className="vnote-add-btn" onClick={() => setAdding((v) => !v)}>
          + 笔记
        </button>
      </div>
      {adding && (
        <NoteEditor
          placeholder={`对「${section.title}」这一章的笔记…`}
          onSubmit={(body) => {
            void state.addNote({ kind: 'section', sectionId: section.id, tMs: section.startMs }, body);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {notes.map((n) => (
        <NoteThread
          key={n.id}
          note={n}
          pending={pendingIds?.has(n.id) ?? false}
          busy={busyId === n.id}
          onUpdateBody={(body) => void state.updateBody(n, body)}
          onRemove={() => void state.remove(n)}
          onReply={(body) => void state.reply(n, body)}
          onAskAssistant={() => void state.askAssistant(n)}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}

/** 未归位笔记区（重生成后对不上的笔记集中展示，不丢弃） */
export function UnanchoredNotes({
  notes,
  busyId,
  state,
  onSeek,
}: {
  notes: OutlineNote[];
  busyId: string | null;
  state: NotesState;
  onSeek?: (ms: number) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="vnote-unanchored">
      <p className="vnote-unanchored-title">未归位的笔记（{notes.length}）</p>
      <p className="vnote-unanchored-hint">
        这些笔记的时间点在当前大纲中找不到落点；重新生成大纲后会再次尝试归位，笔记永不删除。
      </p>
      {notes.map((n) => (
        <NoteThread
          key={n.id}
          note={n}
          busy={busyId === n.id}
          onUpdateBody={(body) => void state.updateBody(n, body)}
          onRemove={() => void state.remove(n)}
          onReply={(body) => void state.reply(n, body)}
          onAskAssistant={() => void state.askAssistant(n)}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}
