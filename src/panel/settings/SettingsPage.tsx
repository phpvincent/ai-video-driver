/**
 * 设置页（SPEC-03 3.1 激活）：
 * - 挂载读 GET_SETTINGS，无值用 src/config DEFAULT_MODEL 填默认
 * - 保存：校验后经 SET_SETTINGS 持久化 ModelConfig
 * - 测试连接：用当前表单值直接调 chatCompletion（ping, maxTokens 1），期间按钮禁用
 * - apiKey 仅存于表单状态与 storage，任何提示/日志不输出其值
 * Obsidian 区（SPEC-06）：接口地址 / API Key / 笔记根目录三字段，保存经
 * SET_SETTINGS 只合并 obsidian 段（不动 model），测试连接显示根目录条目数；
 * apiKey 用 password 输入，任何提示不输出明文。
 * 公开资料检索区（问答增强，仅追加）：endpoint / API Key / 开关；未配置时明确提示
 * 模型将依赖自身知识并标注未核实（检索执行在 src/core/knowledge/webSearch.ts）。
 */
import { useEffect, useState } from 'react';
import { chatCompletion } from '../../core/harness/modelClient';
import { DEFAULT_MODEL, OBSIDIAN } from '../../config';
import { MSG } from '../../messages';
import { testObsidianConnection } from '../obsidianLoader';
import type { WebSearchConfig } from '../../core/knowledge/webSearch';
import type { ModelConfig, ObsidianConfig } from '../../types';

/** 落盘的公开资料检索配置（开关与连接参数同段保存） */
interface WebSearchSettings extends WebSearchConfig {
  enabled: boolean;
}

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

interface ObsidianFormState {
  baseUrl: string;
  apiKey: string;
  rootDir: string;
}

/** 未配置时的回填默认：只带接口地址默认值（OBSIDIAN.baseUrl，红线 9 的唯一来源） */
const INITIAL_OBSIDIAN_FORM: ObsidianFormState = {
  baseUrl: OBSIDIAN.baseUrl,
  apiKey: '',
  rootDir: '',
};

/** 未配置时的初始表单：endpoint 留空（红线 9：地址只能由用户填写，代码不预置） */
const INITIAL_WEB_SEARCH_FORM: WebSearchSettings = {
  endpoint: '',
  apiKey: '',
  enabled: false,
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

export function SettingsPage({
  onClose,
  onOpenValidationReport,
}: {
  onClose: () => void;
  /** SPEC-07：验证期报告入口（父 agent 接线；未传则隐藏该区） */
  onOpenValidationReport?: () => void;
}) {
  const [form, setForm] = useState<ModelFormState>(INITIAL_MODEL_FORM);
  /** 预算上限不在表单中，读设置时保留已存值 */
  const [outlineTokenBudget, setOutlineTokenBudget] = useState<number>(DEFAULT_MODEL.outlineTokenBudget);
  const [saveFeedback, setSaveFeedback] = useState<Feedback>(null);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);
  const [testing, setTesting] = useState(false);
  /** Obsidian 区表单与提示（与模型区状态独立） */
  const [obsidian, setObsidian] = useState<ObsidianFormState>(INITIAL_OBSIDIAN_FORM);
  /** 问答时检索个人知识库（默认开启，与 Obsidian 配置一起保存） */
  const [knowledgeSearch, setKnowledgeSearch] = useState<boolean>(true);
  const [obsidianFeedback, setObsidianFeedback] = useState<Feedback>(null);
  const [obsidianTesting, setObsidianTesting] = useState(false);
  const [obsidianSaving, setObsidianSaving] = useState(false);
  /** 公开资料检索区（问答增强，仅追加；与以上各区状态独立） */
  const [webSearch, setWebSearch] = useState<WebSearchSettings>(INITIAL_WEB_SEARCH_FORM);
  const [webSearchFeedback, setWebSearchFeedback] = useState<Feedback>(null);
  const [webSearchSaving, setWebSearchSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendRuntimeMessage({ type: MSG.GET_SETTINGS })
      .then((response: unknown) => {
        if (cancelled) return;
        const stored = (response ?? {}) as {
          model?: Partial<ModelConfig>;
          obsidian?: Partial<ObsidianConfig>;
          knowledgeSearch?: boolean;
          webSearch?: Partial<WebSearchSettings>;
        };
        const merged = { ...DEFAULT_MODEL, ...(stored.model ?? {}) } as Partial<ModelConfig>;
        const obs = (stored.obsidian ?? {}) as Partial<ObsidianConfig>;
        setObsidian({
          baseUrl: obs.baseUrl || OBSIDIAN.baseUrl,
          apiKey: obs.apiKey ?? '',
          rootDir: obs.rootDir ?? '',
        });
        // 未存过该项时视为开启（默认开启）
        setKnowledgeSearch(stored.knowledgeSearch !== false);
        const web = (stored.webSearch ?? {}) as Partial<WebSearchSettings>;
        setWebSearch({
          endpoint: web.endpoint ?? '',
          apiKey: web.apiKey ?? '',
          engine: web.engine,
          enabled: web.enabled === true,
        });
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

  /** Obsidian 表单字段更新（清空该区提示，避免与旧结果混淆） */
  const updateObsidian = (field: keyof ObsidianFormState) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setObsidian((prev) => ({ ...prev, [field]: e.target.value }));
    setObsidianFeedback(null);
  };

  /** Obsidian 配置校验：三段必填 */
  const validateObsidian = (form: ObsidianFormState): string | null => {
    if (!form.baseUrl.trim()) return 'Obsidian 接口地址不能为空';
    if (!form.apiKey.trim()) return 'Obsidian API Key 不能为空';
    if (!form.rootDir.trim()) return '笔记根目录不能为空';
    return null;
  };

  /** 保存 Obsidian 配置（只合并 obsidian 段，不动 model） */
  const handleSaveObsidian = () => {
    const error = validateObsidian(obsidian);
    if (error) {
      setObsidianFeedback({ kind: 'error', text: error });
      return;
    }
    setObsidianSaving(true);
    setObsidianFeedback(null);
    const cfg: ObsidianConfig = {
      baseUrl: obsidian.baseUrl.trim(),
      apiKey: obsidian.apiKey.trim(),
      rootDir: obsidian.rootDir.trim(),
    };
    // 与 Obsidian 配置一起保存 knowledgeSearch 开关（整份 settings 合并写，不动其他分区）
    sendRuntimeMessage({ type: MSG.GET_SETTINGS })
      .then((stored: unknown) =>
        sendRuntimeMessage({
          type: MSG.SET_SETTINGS,
          payload: { ...((stored ?? {}) as Record<string, unknown>), obsidian: cfg, knowledgeSearch },
        }),
      )
      .then(() => setObsidianFeedback({ kind: 'ok', text: '已保存' }))
      .catch((err: unknown) =>
        setObsidianFeedback({
          kind: 'error',
          text: `保存失败：${err instanceof Error ? err.message : String(err)}`,
        }),
      )
      .finally(() => setObsidianSaving(false));
  };

  /**
   * Obsidian 连通性自检：成功显示根目录条目数，失败显示错误摘要
   * （摘要一律不含 apiKey：sink 层只在 header 携带，错误文案只带状态码）。
   */
  const handleTestObsidian = () => {
    const error = validateObsidian(obsidian);
    if (error) {
      setObsidianFeedback({ kind: 'error', text: error });
      return;
    }
    setObsidianTesting(true);
    setObsidianFeedback(null);
    const cfg: ObsidianConfig = {
      baseUrl: obsidian.baseUrl.trim(),
      apiKey: obsidian.apiKey.trim(),
      rootDir: obsidian.rootDir.trim(),
    };
    testObsidianConnection(cfg)
      .then((res) => {
        setObsidianFeedback({
          kind: 'ok',
          text: `连接成功（根目录 ${res.rootEntries.length} 项）`,
        });
      })
      .catch((err: unknown) => {
        // 兜底脱敏：任何提示均不输出 apiKey 明文
        const raw = err instanceof Error ? err.message : String(err);
        setObsidianFeedback({ kind: 'error', text: raw.split(cfg.apiKey).join('***') });
      })
      .finally(() => setObsidianTesting(false));
  };

  /** 公开资料检索字段更新（清空该区提示） */
  const updateWebSearch = (field: keyof WebSearchSettings) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setWebSearch((prev) => ({ ...prev, [field]: e.target.value }));
    setWebSearchFeedback(null);
  };

  /** 保存公开资料检索配置（只合并 webSearch 段，不动 model / obsidian） */
  const handleSaveWebSearch = () => {
    if (webSearch.enabled && !webSearch.endpoint.trim()) {
      setWebSearchFeedback({ kind: 'error', text: '开启检索时需要填写检索服务地址' });
      return;
    }
    setWebSearchSaving(true);
    setWebSearchFeedback(null);
    const cfg: WebSearchSettings = {
      endpoint: webSearch.endpoint.trim(),
      apiKey: webSearch.apiKey.trim(),
      engine: webSearch.engine,
      enabled: webSearch.enabled,
    };
    sendRuntimeMessage({ type: MSG.GET_SETTINGS })
      .then((stored: unknown) =>
        sendRuntimeMessage({
          type: MSG.SET_SETTINGS,
          payload: { ...((stored ?? {}) as Record<string, unknown>), webSearch: cfg },
        }),
      )
      .then(() => setWebSearchFeedback({ kind: 'ok', text: '已保存' }))
      .catch((err: unknown) =>
        setWebSearchFeedback({
          kind: 'error',
          text: `保存失败：${err instanceof Error ? err.message : String(err)}`,
        }),
      )
      .finally(() => setWebSearchSaving(false));
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
        <p className="settings-hint">
          Local REST API（HTTP 模式）地址 / 密钥 / 笔记根目录；笔记落在「根目录/视频笔记/」与「根目录/术语/」
        </p>
        <label className="field">
          <span>接口地址</span>
          <input
            type="text"
            placeholder={OBSIDIAN.baseUrl}
            value={obsidian.baseUrl}
            onChange={updateObsidian('baseUrl')}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            placeholder="粘贴 Local REST API 的 API Key"
            value={obsidian.apiKey}
            onChange={updateObsidian('apiKey')}
          />
        </label>
        <label className="field">
          <span>笔记根目录</span>
          <input
            type="text"
            placeholder="如：视频学习副驾"
            value={obsidian.rootDir}
            onChange={updateObsidian('rootDir')}
          />
        </label>
        <label
          className="field"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <input
            type="checkbox"
            checked={knowledgeSearch}
            onChange={(e) => {
              setKnowledgeSearch(e.target.checked);
              setObsidianFeedback(null);
            }}
          />
          <span>问答时检索个人知识库（默认开启）</span>
        </label>
        <div className="field-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveObsidian}
            disabled={obsidianSaving}
          >
            {obsidianSaving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleTestObsidian}
            disabled={obsidianTesting}
          >
            {obsidianTesting ? '测试中…' : '测试连接'}
          </button>
        </div>
        {obsidianFeedback && (
          <p
            className={
              obsidianFeedback.kind === 'ok' ? 'settings-hint' : 'settings-hint settings-error'
            }
          >
            {obsidianFeedback.text}
          </p>
        )}
      </section>

      {/* 公开资料检索（问答增强，仅追加）：未配置时明确提示依赖模型自身知识 */}
      <section className="settings-section">
        <h4>公开资料检索（可选）</h4>
        <p className="settings-hint">
          填写自建或第三方检索服务（Tavily / Serper 等）后，回答课程外的事实时会附带公开资料来源；未配置联网检索；涉及课程外事实时模型将依赖自身知识并标注未核实
        </p>
        <label className="field">
          <span>检索服务地址</span>
          <input
            type="text"
            placeholder="由你自行填写的检索服务地址"
            value={webSearch.endpoint}
            onChange={updateWebSearch('endpoint')}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            placeholder="粘贴检索服务的 API Key"
            value={webSearch.apiKey}
            onChange={updateWebSearch('apiKey')}
          />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={webSearch.enabled}
            onChange={(e) => {
              setWebSearch((prev) => ({ ...prev, enabled: e.target.checked }));
              setWebSearchFeedback(null);
            }}
          />
          <span>问答时使用公开资料检索（默认关闭）</span>
        </label>
        <div className="field-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveWebSearch}
            disabled={webSearchSaving}
          >
            {webSearchSaving ? '保存中…' : '保存'}
          </button>
        </div>
        {webSearchFeedback && (
          <p
            className={
              webSearchFeedback.kind === 'ok' ? 'settings-hint' : 'settings-hint settings-error'
            }
          >
            {webSearchFeedback.text}
          </p>
        )}
      </section>

      {/* SPEC-07：验证期报告入口（仅追加，未接线时整区隐藏） */}
      {onOpenValidationReport && (
        <section className="settings-section">
          <h4>验证期报告</h4>
          <p className="settings-hint">
            统计本机使用数据（大纲/导图跳转、划词与区间提问、字幕命中），生成 Markdown 报告，可存入 Obsidian
          </p>
          <div className="field-row">
            <button type="button" className="btn" onClick={onOpenValidationReport}>
              打开验证期报告
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
