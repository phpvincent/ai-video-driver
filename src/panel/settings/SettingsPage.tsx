/**
 * 设置页（SPEC-03 3.1 激活）：
 * - 挂载读 GET_SETTINGS，无值用 src/config DEFAULT_MODEL 填默认
 * - 保存：校验后经 SET_SETTINGS 持久化（各分区共用 mergeSettings 合并写，互不覆盖）
 * - 测试连接：用当前表单值直接调 chatCompletion（ping, maxTokens 1），期间按钮禁用
 * - apiKey 仅存于表单状态与 storage，任何提示/日志不输出其值
 * 单模型配置：只配置一个模型，文本与画面一起发给它；模型不支持图像输入时抽帧不可用。
 * 分区顺序：模型配置（含「支持图像输入」声明）→ 当前策略 → 抽帧开关 → Obsidian → 公开资料检索 → 验证期报告。
 * 模型区提供 DeepSeek / Qwen 预设一键填入（只覆盖 baseUrl 与 model，不清空已填 Key；
 * 端点与模型标识的唯一来源是 src/config 的 MODEL_PRESETS，红线 9）；
 * 预设同时按 presetVisionDefault 建议「支持图像输入」勾选，用户可自行改。
 * 载入时执行一次 migrateLegacyVisionModel：旧版本的「视觉模型」提升为当前模型，避免老配置丢失。
 * Obsidian 区（SPEC-06）：接口地址 / API Key / 笔记根目录三字段，保存经
 * SET_SETTINGS 只合并 obsidian 段（不动 model），测试连接显示根目录条目数；
 * apiKey 用 password 输入，任何提示不输出明文。
 * 公开资料检索区（问答增强，仅追加）：endpoint / API Key / 开关；未配置时明确提示
 * 模型将依赖自身知识并标注未核实（检索执行在 src/core/knowledge/webSearch.ts）。
 */
import { useEffect, useRef, useState } from 'react';
import { chatCompletion } from '../../core/harness/modelClient';
import { DEFAULT_MODEL, MODEL_PRESETS, OBSIDIAN, VISION } from '../../config';
import { MSG } from '../../messages';
import { testObsidianConnection } from '../obsidianLoader';
import {
  activePreset,
  applyPreset,
  describeModelStrategy,
  hostOf,
  listProfiles,
  migrateLegacyVisionModel,
  migrateVisionToModel,
  stripSeedProfiles,
  preserveSecrets,
  mergeSettings,
  normalizeModelConfig,
  presetShortLabel,
  seedProfilesIfEmpty,
  presetVisionDefault,
  validateModelForm,
  type ModelFormErrors,
  type PresetKey,
  type VisionModule,
} from './modelForm';
import type { WebSearchConfig } from '../../core/knowledge/webSearch';
import type { ModelConfig, ObsidianConfig, Settings } from '../../types';

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

/** 抽帧模块开关（未配置视为开启） */
const INITIAL_VISION_MODULES: Record<VisionModule, boolean> = {
  outline: true,
  mindmap: true,
  qa: true,
};

const VISION_MODULE_LABELS: Record<VisionModule, string> = {
  outline: '大纲',
  mindmap: '导图',
  qa: '问答',
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

/** 校验结果里取第一条错误文案（表单逐字段提示之外给一行总提示） */
function firstError(errors: ModelFormErrors | Record<string, string | undefined>): string | null {
  for (const value of Object.values(errors)) {
    if (value) return value;
  }
  return null;
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
  /** 用户声明：当前模型是否支持图像输入（决定抽帧开关是否可用） */
  const [supportsVision, setSupportsVision] = useState(false);
  /** 禁用模型思考过程（默认开启）：结构化任务更快更省，避免思考耗尽输出 token */
  const [disableThinking, setDisableThinking] = useState(true);
  /** 抽帧开关（默认关闭：额外延迟与 token 消耗，且需模型支持图像输入） */
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visionModules, setVisionModules] = useState<Record<VisionModule, boolean>>(INITIAL_VISION_MODULES);
  const [visionSwitchFeedback, setVisionSwitchFeedback] = useState<Feedback>(null);
  const [visionSwitchSaving, setVisionSwitchSaving] = useState(false);
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
  /** 模型方案区：方案名输入 / 已存方案列表 / 区内提示 */
  const [profileName, setProfileName] = useState('');
  const [profiles, setProfiles] = useState<ModelConfig[]>([]);
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  /** 最近一次读到的整份 settings：所有分区的合并写基线（避免分区互相覆盖） */
  const savedRef = useRef<Settings>({});

  useEffect(() => {
    let cancelled = false;
    sendRuntimeMessage({ type: MSG.GET_SETTINGS })
      .then((response: unknown) => {
        if (cancelled) return;
        const raw = (response ?? {}) as Settings & {
          model?: Partial<ModelConfig>;
          obsidian?: Partial<ObsidianConfig>;
          webSearch?: Partial<WebSearchSettings>;
        };
        // 旧设置迁移：无 model 但有 visionModel → 提升为 model（避免老用户配置丢失）
        // + modelSupportsVision → model.supportsVision（能力随 ModelConfig 走，各执行一次幂等迁移）
        const stored = seedProfilesIfEmpty(migrateVisionToModel(migrateLegacyVisionModel(raw)));
        savedRef.current = stored;
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
        // 多模态能力随 model.supportsVision（载入时已迁移旧 modelSupportsVision；
        // model 缺失时读旧字段做展示兜底）
        setSupportsVision(stored.model?.supportsVision ?? stored.modelSupportsVision === true);
        // 已存模型方案（过滤无 name / 无 Key 后）
        setProfiles(listProfiles(stored));
        // 禁用思考默认开启（未配置视为禁用）
        setDisableThinking(stored.disableThinking !== false);
        // 全局抽帧开关默认关闭；模块开关默认全开（未配置视为开启）
        setVisionEnabled(stored.visionEnabled === true);
        setVisionModules({
          outline: stored.visionModules?.outline !== false,
          mindmap: stored.visionModules?.mindmap !== false,
          qa: stored.visionModules?.qa !== false,
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

  /** 合并写：patch 覆盖目标分区，其余分区原样保留 */
  const savePatch = (patch: Partial<Settings>): Promise<boolean> => {
    const merged = mergeSettings(savedRef.current, patch);
    // 两道护栏：剥离未激活的种子方案 + 不得清空已有密钥
    const next = stripSeedProfiles(preserveSecrets(merged, savedRef.current));
    return sendRuntimeMessage({ type: MSG.SET_SETTINGS, payload: next })
      .then((response: unknown) => {
        if ((response as { ok?: boolean } | null)?.ok === true) {
          savedRef.current = next;
          return true;
        }
        return false;
      })
      .catch(() => false);
  };

  const update = (field: keyof ModelFormState) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setSaveFeedback(null);
  };

  /**
   * 预设一键填入：只覆盖 baseUrl 与 model，已填的 Key 与其他字段保留；
   * 同时按 presetVisionDefault 给出「支持图像输入」的建议勾选（用户可再改）。
   */
  const applyPresetToForm = (preset: PresetKey) => {
    const next = applyPreset(formToModelConfig(form, outlineTokenBudget), preset);
    setForm({
      baseUrl: next.baseUrl,
      apiKey: next.apiKey,
      model: next.model,
      temperatureOutline: String(next.temperature.outline),
      temperatureQa: String(next.temperature.qa),
      maxTokens: String(next.maxTokens),
    });
    setSupportsVision(presetVisionDefault(preset));
    // 端点变化时 Key 已被清空（不同平台 Key 体系不同），提示用户重填
    setSaveFeedback(
      applyPreset(formToModelConfig(form, outlineTokenBudget), preset).baseUrl !==
      formToModelConfig(form, outlineTokenBudget).baseUrl
        ? { kind: 'ok', text: '已切换端点：请填写该平台的 API Key 后保存' }
        : null,
    );
    setSaveFeedback(null);
  };

  /** 保存模型配置：连同「是否支持图像输入」（写入 model.supportsVision）一起合并写 */
  const handleSave = () => {
    // 归一化：去掉粘贴带来的首尾空白（Key 前后空格会直接导致 401）
    const model = normalizeModelConfig(formToModelConfig(form, outlineTokenBudget));
    const errors = validateModelForm(model);
    const error = firstError(errors);
    if (error) {
      setSaveFeedback({ kind: 'error', text: error });
      return;
    }
    savePatch({ model: { ...model, supportsVision }, disableThinking })
      .then((ok) => {
        setSaveFeedback(
          ok ? { kind: 'ok', text: '已保存' } : { kind: 'error', text: '保存失败：background 未确认' },
        );
      });
  };

  /**
   * 保存当前表单为命名方案（modelProfiles，同名覆盖）：
   * 方案携带表单全部字段（含「支持图像输入」勾选），供各模块下拉选择。
   */
  const handleSaveProfile = () => {
    const name = profileName.trim();
    if (!name) {
      setProfileFeedback({ kind: 'error', text: '方案名不能为空' });
      return;
    }
    const model = normalizeModelConfig(formToModelConfig(form, outlineTokenBudget));
    const error = firstError(validateModelForm(model));
    if (error) {
      setProfileFeedback({ kind: 'error', text: `当前表单无效：${error}` });
      return;
    }
    const profile: ModelConfig = { ...model, name, supportsVision };
    const next = [...(savedRef.current.modelProfiles ?? []).filter((p) => p.name !== name), profile];
    setProfileSaving(true);
    setProfileFeedback(null);
    savePatch({ modelProfiles: next })
      .then((ok) => {
        setProfileSaving(false);
        if (ok) {
          setProfiles(listProfiles(savedRef.current));
          setProfileName('');
          setProfileFeedback({ kind: 'ok', text: `已保存方案「${name}」` });
        } else {
          setProfileFeedback({ kind: 'error', text: '保存失败：background 未确认' });
        }
      })
      .catch(() => {
        setProfileSaving(false);
        setProfileFeedback({ kind: 'error', text: '保存失败：background 未确认' });
      });
  };

  /**
   * 删除方案：若某模块正引用它（moduleModel）→ 对应项一并清除（回退默认模型）。
   */
  const handleDeleteProfile = (name: string) => {
    const modelProfiles = (savedRef.current.modelProfiles ?? []).filter((p) => p.name !== name);
    const moduleModel = { ...(savedRef.current.moduleModel ?? {}) };
    let referenced = false;
    for (const key of ['outline', 'mindmap', 'qa'] as const) {
      if (moduleModel[key] === name) {
        delete moduleModel[key];
        referenced = true;
      }
    }
    const patch: Partial<Settings> = referenced
      ? { modelProfiles, moduleModel }
      : { modelProfiles };
    savePatch(patch)
      .then((ok) => {
        if (ok) {
          setProfiles(listProfiles(savedRef.current));
          setProfileFeedback({
            kind: 'ok',
            text: referenced ? `已删除方案「${name}」（引用它的模块已回退默认模型）` : `已删除方案「${name}」`,
          });
        } else {
          setProfileFeedback({ kind: 'error', text: '删除失败：background 未确认' });
        }
      })
      .catch(() => {
        setProfileFeedback({ kind: 'error', text: '删除失败：background 未确认' });
      });
  };

  const handleTestConnection = () => {
    const model = normalizeModelConfig(formToModelConfig(form, outlineTokenBudget));
    const error = firstError(validateModelForm(model));
    if (error) {
      setTestFeedback({ kind: 'error', text: error });
      return;
    }
    setTesting(true);
    setTestFeedback(null);
    chatCompletion({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature.outline,
      // 连通性探测给足余量：推理模型未禁思考时 1 个 token 会被思考吃光导致正文为空
      maxTokens: 16,
      // 探测无条件禁用思考：连通性测试不需要推理，也不依赖用户开关状态
      thinking: { type: 'disabled' },
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

  /** 保存抽帧开关（全局 + 三模块）；全局关闭时模块开关不生效；模型未声明多模态时不可保存 */
  const handleSaveVisionSwitch = () => {
    setVisionSwitchSaving(true);
    setVisionSwitchFeedback(null);
    savePatch({ visionEnabled, visionModules: { ...visionModules } })
      .then((ok) => {
        setVisionSwitchFeedback(
          ok ? { kind: 'ok', text: '已保存' } : { kind: 'error', text: '保存失败：background 未确认' },
        );
      })
      .finally(() => setVisionSwitchSaving(false));
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
    savePatch({ obsidian: cfg, knowledgeSearch })
      .then((ok) => {
        setObsidianFeedback(
          ok ? { kind: 'ok', text: '已保存' } : { kind: 'error', text: '保存失败：background 未确认' },
        );
      })
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
    savePatch({ webSearch: cfg })
      .then((ok) => {
        setWebSearchFeedback(
          ok ? { kind: 'ok', text: '已保存' } : { kind: 'error', text: '保存失败：background 未确认' },
        );
      })
      .finally(() => setWebSearchSaving(false));
  };

  const presetKeys = Object.keys(MODEL_PRESETS) as PresetKey[];
  /** 抽帧区是否可用：取决于「支持图像输入」勾选 */
  const visionSwitchUsable = supportsVision;
  /** 当前策略摘要：由表单当前值 + 已存方案与各模块选择合成 settings 后交给纯函数 */
  const strategyLines = describeModelStrategy({
    model: { ...formToModelConfig(form, outlineTokenBudget), supportsVision },
    modelProfiles: savedRef.current.modelProfiles,
    moduleModel: savedRef.current.moduleModel,
    visionEnabled,
    visionModules,
  });

  return (
    <div className="settings">
      <header className="settings-header">
        <h3>设置</h3>
        <button type="button" className="btn" onClick={onClose}>
          返回
        </button>
      </header>

      {/* ① 模型配置：一个模型承担大纲 / 导图 / 问答，支持图像输入时一并接收抽帧画面 */}
      <section className="settings-section">
        <h4>模型配置（大纲 / 导图 / 问答）</h4>
        <p className="settings-hint">
          只配置一个模型：纯文本请求与带画面的请求都发给它。模型名可自填，按厂商文档填写当前可用版本；
          成本与能力由你选择——便宜的多模态与更强的多模态差异较大，按需填写。
          <strong>注意：API Key 必须与接口地址所属平台一致</strong>（百炼官方 Key 与 maas 网关 Key 不通用，
          混用会返回 401）；填好后先点「测试连接」确认
        </p>
        <div className="field-row">
          {presetKeys.map((key) => (
            <button
              type="button"
              key={`model-preset-${key}`}
              onClick={() => applyPresetToForm(key)}
              title={MODEL_PRESETS[key].label}
              className={activePreset(form.baseUrl) === key ? 'btn preset-active' : 'btn'}
            >
              {presetShortLabel(key)}
            </button>
          ))}
        </div>
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
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={supportsVision}
            onChange={(e) => {
              setSupportsVision(e.target.checked);
              setSaveFeedback(null);
              setVisionSwitchFeedback(null);
            }}
          />
          <span>该模型支持图像输入（多模态，如 Qwen-VL 系列）</span>
        </label>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={disableThinking}
            onChange={(e) => setDisableThinking(e.target.checked)}
          />
          <span>禁用思考过程（推荐：大纲/导图/问答均为结构化任务，思考会消耗输出 token 甚至把正文挤空）</span>
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

      {/* ①b 模型方案：把当前表单另存为命名方案，供各模块（大纲/导图/问答）下拉选择 */}
      <section className="settings-section">
        <h4>模型方案</h4>
        <p className="settings-hint">
          把上方当前表单保存为命名方案（如「Qwen 视觉」「便宜文本」），再到大纲 / 导图 / 问答各 Tab
          顶部的下拉框为本模块选择方案；各模块不选时使用默认模型
        </p>
        <div className="field-row">
          <label className="field">
            <span>方案名</span>
            <input
              type="text"
              placeholder="如：Qwen 视觉"
              value={profileName}
              onChange={(e) => {
                setProfileName(e.target.value);
                setProfileFeedback(null);
              }}
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={handleSaveProfile}
            disabled={profileSaving}
          >
            {profileSaving ? '保存中…' : '保存当前表单为方案'}
          </button>
        </div>
        {profiles.length > 0 && (
          <ul className="settings-hint model-profile-list">
            {profiles.map((p) => (
              <li key={`model-profile-${p.name}`} className="model-profile-row">
                <span className="model-profile-name">{p.name}</span>
                <span className="model-profile-model">{`${hostOf(p.baseUrl)} / ${p.model}`}</span>
                <button
                  type="button"
                  className="btn model-profile-delete"
                  onClick={() => handleDeleteProfile(p.name ?? '')}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        {profileFeedback && (
          <p
            className={
              profileFeedback.kind === 'ok' ? 'settings-hint' : 'settings-hint settings-error'
            }
          >
            {profileFeedback.text}
          </p>
        )}
      </section>

      {/* ② 当前策略：读模型区表单当前值，随输入实时更新（只读展示，不参与保存） */}
      <section className="settings-section">
        <h4>当前策略</h4>
        <ul className="settings-hint" style={{ paddingLeft: 18, listStyle: 'disc' }}>
          {strategyLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {/* ③ 抽帧开关：模型未声明支持图像输入时整区置灰 */}
      <section className="settings-section" style={visionSwitchUsable ? undefined : { opacity: 0.6 }}>
        <h4>抽帧开关（结合视频画面理解）</h4>
        <p className="settings-hint">
          {visionSwitchUsable
            ? '抽帧会增加延迟与 token 消耗；全局关闭时所有模块一律不抽帧。'
            : '当前模型未声明支持图像输入；如需结合画面，请换用多模态模型（如 Qwen-VL 系列）并勾选上方选项。'}
          {visionSwitchUsable
            ? ` 单次请求最多 ${VISION.maxFramesPerRequest} 帧（大纲每分块 ${VISION.outlineFramesPerChunk} 帧 / 导图 ${VISION.mindmapFrames} 帧 / 问答 ${VISION.qaFrames} 帧）`
            : ''}
        </p>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={visionSwitchUsable && visionEnabled}
            disabled={!visionSwitchUsable}
            onChange={(e) => {
              setVisionEnabled(e.target.checked);
              setVisionSwitchFeedback(null);
            }}
          />
          <span>让模型结合视频画面理解（抽帧）</span>
        </label>
        {(Object.keys(VISION_MODULE_LABELS) as VisionModule[]).map((module) => (
          <label
            key={`vision-module-${module}`}
            className="field"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <input
              type="checkbox"
              checked={visionSwitchUsable && visionEnabled && visionModules[module]}
              disabled={!visionSwitchUsable || !visionEnabled}
              onChange={(e) => {
                setVisionModules((prev) => ({ ...prev, [module]: e.target.checked }));
                setVisionSwitchFeedback(null);
              }}
            />
            <span>
              {VISION_MODULE_LABELS[module]}
              {visionSwitchUsable && visionEnabled ? '' : '（随全局开关）'}
            </span>
          </label>
        ))}
        <div className="field-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveVisionSwitch}
            disabled={visionSwitchSaving || !visionSwitchUsable}
          >
            {visionSwitchSaving ? '保存中…' : '保存'}
          </button>
        </div>
        {visionSwitchFeedback && (
          <p
            className={
              visionSwitchFeedback.kind === 'ok' ? 'settings-hint' : 'settings-hint settings-error'
            }
          >
            {visionSwitchFeedback.text}
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
