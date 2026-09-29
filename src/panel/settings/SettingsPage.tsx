/**
 * 设置页（SPEC-03 3.1 激活）：
 * - 挂载读 GET_SETTINGS，无值用 src/config DEFAULT_MODEL 填默认
 * - 保存：校验后经 SET_SETTINGS 持久化 ModelConfig
 * - 测试连接：用当前表单值直接调 chatCompletion（ping, maxTokens 1），期间按钮禁用
 * - apiKey 仅存于表单状态与 storage，任何提示/日志不输出其值
 * Obsidian 区为占位（SPEC-06）。
 */
import { useEffect, useState } from 'react';
import { chatCompletion } from '../../core/harness/modelClient';
import { DEFAULT_MODEL, OBSIDIAN } from '../../config';
import { MSG } from '../../messages';
import type { ModelConfig } from '../../types';

interface ModelFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperatureOutline: string;
  temperatureQa: string;
  maxTokens: string;
}

/** 表单不暴露 outlineTokenBudget：保留已存值，否则用默认 */
const INITIAL_MODEL_FORM: ModelFormState = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperatureOutline: String(DEFAULT_MODEL.temperature.outline),
  temperatureQa: String(DEFAULT_MODEL.temperature.qa),
  maxTokens: String(DEFAULT_MODEL.maxTokens),
};

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

/** chrome.runtime.sendMessage 的安全包装：上下文失效时静默返回 null */
function sendRuntimeMessage(message: unknown): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    return Promise.resolve(null);
  }
}

/** 表单校验：baseUrl / model / apiKey 非空，temperature 0-2，maxTokens ≥ 1 */
function validateForm(form: ModelFormState): string | null {
  if (!form.baseUrl.trim()) return '接口地址不能为空';
  if (!form.model.trim()) return '模型不能为空';
  if (!form.apiKey.trim()) return 'API Key 不能为空';
  const tOutline = Number(form.temperatureOutline);
  if (!Number.isFinite(tOutline) || tOutline < 0 || tOutline > 2) {
    return 'temperature（大纲）需在 0-2 之间';
  }
  const tQa = Number(form.temperatureQa);
  if (!Number.isFinite(tQa) || tQa < 0 || tQa > 2) {
    return 'temperature（问答）需在 0-2 之间';
  }
  const maxTokens = Number(form.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1) return 'maxTokens 需为 ≥ 1 的整数';
  return null;
}

function formToModelConfig(form: ModelFormState, outlineTokenBudget: number): ModelConfig {
  return {
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim(),
    model: form.model.trim(),
    temperature: { outline: Number(form.temperatureOutline), qa: Number(form.temperatureQa) },
    maxTokens: Number(form.maxTokens),
    outlineTokenBudget,
  };
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<ModelFormState>(INITIAL_MODEL_FORM);
  /** 预算上限不在表单中，读设置时保留已存值 */
  const [outlineTokenBudget, setOutlineTokenBudget] = useState<number>(DEFAULT_MODEL.outlineTokenBudget);
  const [saveFeedback, setSaveFeedback] = useState<Feedback>(null);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendRuntimeMessage({ type: MSG.GET_SETTINGS })
      .then((response: unknown) => {
        if (cancelled) return;
        const stored = (response ?? {}) as { model?: Partial<ModelConfig> };
        const merged = { ...DEFAULT_MODEL, ...(stored.model ?? {}) } as Partial<ModelConfig>;
        setForm({
          baseUrl: merged.baseUrl ?? '',
          apiKey: merged.apiKey ?? '',
          model: merged.model ?? '',
          temperatureOutline: String(merged.temperature?.outline ?? DEFAULT_MODEL.temperature.outline),
          temperatureQa: String(merged.temperature?.qa ?? DEFAULT_MODEL.temperature.qa),
          maxTokens: String(merged.maxTokens ?? DEFAULT_MODEL.maxTokens),
        });
        if (typeof merged.outlineTokenBudget === 'number' && merged.outlineTokenBudget > 0) {
          setOutlineTokenBudget(merged.outlineTokenBudget);
        }
      })
      .catch(() => {
        // background 未就绪时保持默认表单
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (field: keyof ModelFormState) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setSaveFeedback(null);
  };

  const handleSave = () => {
    const error = validateForm(form);
    if (error) {
      setSaveFeedback({ kind: 'error', text: error });
      return;
    }
    const model = formToModelConfig(form, outlineTokenBudget);
    sendRuntimeMessage({ type: MSG.SET_SETTINGS, payload: { model } })
      .then((response: unknown) => {
        if ((response as { ok?: boolean } | null)?.ok === true) {
          setSaveFeedback({ kind: 'ok', text: '已保存' });
        } else {
          setSaveFeedback({ kind: 'error', text: '保存失败：background 未确认' });
        }
      })
      .catch(() => {
        setSaveFeedback({ kind: 'error', text: '保存失败：无法连接 background' });
      });
  };

  const handleTestConnection = () => {
    const error = validateForm(form);
    if (error) {
      setTestFeedback({ kind: 'error', text: error });
      return;
    }
    setTesting(true);
    setTestFeedback(null);
    const model = formToModelConfig(form, outlineTokenBudget);
    chatCompletion({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature.outline,
      maxTokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
      .then(() => {
        setTestFeedback({ kind: 'ok', text: `连接成功（模型 ${model.model}）` });
      })
      .catch((err: unknown) => {
        // 错误摘要理论不含 key，此处再做一层脱敏兜底
        const raw = err instanceof Error ? err.message : String(err);
        setTestFeedback({ kind: 'error', text: raw.split(model.apiKey).join('***') });
      })
      .finally(() => {
        setTesting(false);
      });
  };

  return (
    <div className="settings">
      <header className="settings-header">
        <h3>设置</h3>
        <button type="button" className="btn" onClick={onClose}>
          返回
        </button>
      </header>

      <section className="settings-section">
        <h4>模型配置</h4>
        <label className="field">
          <span>接口地址</span>
          <input
            type="text"
            placeholder="https://…"
            value={form.baseUrl}
            onChange={update('baseUrl')}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            placeholder="粘贴 API Key"
            value={form.apiKey}
            onChange={update('apiKey')}
          />
        </label>
        <label className="field">
          <span>模型</span>
          <input
            type="text"
            placeholder="模型标识"
            value={form.model}
            onChange={update('model')}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>temperature（大纲）</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperatureOutline}
              onChange={update('temperatureOutline')}
            />
          </label>
          <label className="field">
            <span>temperature（问答）</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperatureQa}
              onChange={update('temperatureQa')}
            />
          </label>
        </div>
        <label className="field">
          <span>maxTokens</span>
          <input
            type="number"
            min="1"
            value={form.maxTokens}
            onChange={update('maxTokens')}
          />
        </label>
        <div className="field-row">
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
          <button type="button" className="btn" onClick={handleTestConnection} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
        {saveFeedback && (
          <p className={saveFeedback.kind === 'ok' ? 'settings-hint' : 'settings-hint settings-error'}>
            {saveFeedback.text}
          </p>
        )}
        {testFeedback && (
          <p className={testFeedback.kind === 'ok' ? 'settings-hint' : 'settings-hint settings-error'}>
            {testFeedback.text}
          </p>
        )}
      </section>

      <section className="settings-section">
        <h4>Obsidian 配置</h4>
        <p className="settings-hint">待 SPEC-06 实现：Local REST API 地址 / 密钥 / 笔记根目录</p>
        <label className="field">
          <span>接口地址</span>
          <input type="text" defaultValue={OBSIDIAN.baseUrl} disabled />
        </label>
        <label className="field">
          <span>API Key</span>
          <input type="password" placeholder="待配置" disabled />
        </label>
        <label className="field">
          <span>笔记根目录</span>
          <input type="text" placeholder="待配置" disabled />
        </label>
      </section>
    </div>
  );
}
