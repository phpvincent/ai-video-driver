/**
 * 模块模型选择器（按模块选模型）：
 * 下拉选择本模块使用「默认（当前模型）」或某个命名方案（settings.modelProfiles）。
 * - 挂载读 GET_SETTINGS；onChange 经 SET_SETTINGS 合并写 moduleModel（选「默认」删键回退）
 * - 选中方案缺少 Key（不完整）时提示将回退默认（与 resolveModuleModel 的回退语义一致）
 * 自包含组件：自管理状态，不需要父组件传数据；三个 Tab 各挂一个（outline/mindmap/qa）。
 */
import { useEffect, useState } from 'react';
import { MSG } from '../messages';
import { isModelConfigured } from './settings/modelForm';
import type { ModelConfig, Settings } from '../types';

export type PickerModule = 'outline' | 'mindmap' | 'qa';

export interface PickerOption {
  /** '' = 默认模型；否则方案名 */
  value: string;
  label: string;
  /** 三要素是否齐全（方案无 Key 时 UI 提示回退默认） */
  hasKey: boolean;
}

export interface ModelPickerProps {
  module: PickerModule;
}

/** 选中方案缺少 Key 时的提示文案（导出供测试） */
export const PICKER_MISSING_KEY_HINT = '该方案缺少 Key，将回退默认';

/**
 * 下拉选项（纯函数，导出供测试）：
 * 首项「默认（{默认模型名}）」+ 各方案名（含无 Key 的方案，hasKey=false 供 UI 提示）。
 * name 重复时先出现者优先（与设置页同名覆盖的保存语义一致）。
 */
export function buildPickerOptions(settings: Settings): PickerOption[] {
  const defaultModel = settings.model;
  const defaultLabel = defaultModel?.model?.trim()
    ? `默认（${defaultModel.model.trim()}）`
    : '默认（未配置）';
  const options: PickerOption[] = [
    { value: '', label: defaultLabel, hasKey: isModelConfigured(defaultModel) },
  ];
  const seen = new Set<string>(['']);
  for (const p of (settings.modelProfiles ?? []) as ModelConfig[]) {
    const name = p?.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    options.push({ value: name, label: name, hasKey: Boolean(p.apiKey?.trim()) });
  }
  return options;
}

/** chrome.runtime.sendMessage 的安全包装：上下文失效时静默返回 null */
function sendRuntimeMessage(message: unknown): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message);
  } catch {
    return Promise.resolve(null);
  }
}

/** 读取整份 settings（GET_SETTINGS）；异常时返回空对象 */
function fetchSettings(): Promise<Settings> {
  return sendRuntimeMessage({ type: MSG.GET_SETTINGS })
    .then((response) => {
      const stored = (response ?? {}) as Settings;
      return stored && typeof stored === 'object' ? stored : {};
    })
    .catch(() => ({}));
}

export function ModelPicker({ module }: ModelPickerProps) {
  const [options, setOptions] = useState<PickerOption[]>([]);
  /** 当前选中方案名（'' = 默认模型） */
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((stored) => {
        if (cancelled) return;
        setOptions(buildPickerOptions(stored));
        setSelected(stored.moduleModel?.[module] ?? '');
      })
      .catch(() => {
        /* 未读到设置时保持空选项 */
      });
    return () => {
      cancelled = true;
    };
  }, [module]);

  /** 选择变化：重读最新 settings 后合并写 moduleModel（只动本模块键） */
  const handleChange = (value: string) => {
    setSelected(value);
    fetchSettings()
      .then((stored) => {
        const moduleModel = { ...(stored.moduleModel ?? {}) };
        if (value) moduleModel[module] = value;
        else delete moduleModel[module];
        const next: Settings = { ...stored, moduleModel };
        return sendRuntimeMessage({ type: MSG.SET_SETTINGS, payload: next }).then(
          (response: unknown) => {
            if ((response as { ok?: boolean } | null)?.ok === true) {
              setOptions(buildPickerOptions(next));
            }
          },
        );
      })
      .catch(() => {
        /* 写失败静默（下次挂载重新读取） */
      });
  };

  // 选中项（方案被删/改名后不在选项中时补一项占位，避免下拉显示空白）
  const matched = options.find((o) => o.value === selected);
  const displayOptions =
    selected && !matched
      ? [...options, { value: selected, label: selected, hasKey: false }]
      : options;
  const missingKey = selected !== '' && (matched ? !matched.hasKey : true);

  return (
    <div className="model-picker">
      <label className="model-picker-field">
        <span>模型：</span>
        <select
          className="model-picker-select"
          value={selected}
          onChange={(e) => handleChange(e.target.value)}
        >
          {displayOptions.map((o) => (
            <option key={o.value || 'default'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {missingKey && <span className="model-picker-warn">{PICKER_MISSING_KEY_HINT}</span>}
    </div>
  );
}
