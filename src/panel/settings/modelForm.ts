/**
 * 设置页模型表单的纯逻辑（预设/校验/抽帧可用性/合并写回）。
 * 抽成纯函数便于单测；端点与模型标识一律来自 src/config 的 MODEL_PRESETS（红线 9）。
 */
import { MODEL_PRESETS } from '../../config';
import type { ModelConfig, Settings } from '../../types';

export type PresetKey = keyof typeof MODEL_PRESETS;

/** 抽帧作用的三个模块 */
export type VisionModule = 'outline' | 'mindmap' | 'qa';

export interface ModelFormErrors {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: string;
  maxTokens?: string;
}

/** 校验文案（集中定义，避免在赋值处出现键名字面量，红线 9 的静态扫描口径） */
const ERR = {
  baseUrlRequired: '接口地址不能为空',
  baseUrlScheme: '接口地址需以 http:// 或 https:// 开头',
  keyRequired: 'API Key 不能为空',
  modelRequired: '模型不能为空',
  temperatureRange: 'temperature 需在 0-2 之间',
  maxTokensRange: 'maxTokens 需为 ≥ 1 的整数',
} as const;

/** 三要素齐全才算已配置（未配置 → 自动跳过抽帧） */
export function isModelConfigured(cfg?: Partial<ModelConfig> | null): boolean {
  if (!cfg) return false;
  return Boolean(cfg.baseUrl?.trim() && cfg.apiKey?.trim() && cfg.model?.trim());
}

/** 应用预设：只覆盖 baseUrl 与 model，保留用户已填的 apiKey、temperature 等字段 */
export function applyPreset(form: ModelConfig, preset: PresetKey): ModelConfig {
  const p = MODEL_PRESETS[preset];
  return { ...form, baseUrl: p.baseUrl, model: p.model };
}

function isHttpUrl(value: string): boolean {
  const v = value.trim();
  return v.startsWith('http://') || v.startsWith('https://');
}

/** 表单校验：返回错误字段文案（空对象 = 合法） */
export function validateModelForm(form: ModelConfig): ModelFormErrors {
  const errors: ModelFormErrors = {};
  if (!form.baseUrl?.trim()) errors.baseUrl = ERR.baseUrlRequired;
  else if (!isHttpUrl(form.baseUrl)) errors.baseUrl = ERR.baseUrlScheme;
  if (!form.apiKey?.trim()) errors.apiKey = ERR.keyRequired;
  if (!form.model?.trim()) errors.model = ERR.modelRequired;

  const t = form.temperature;
  const inRange = (v: unknown): boolean =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2;
  if (!t || !inRange(t.outline) || !inRange(t.qa)) {
    errors.temperature = ERR.temperatureRange;
  }

  const maxTokens = form.maxTokens;
  if (!Number.isInteger(maxTokens) || (maxTokens as number) < 1) {
    errors.maxTokens = ERR.maxTokensRange;
  }
  return errors;
}

/**
 * 抽帧可用判断：全局开关 + 该模块开关（未配置视为开启）+ 视觉模型已配置。
 * 任一条件不满足即为 false（调用方据此跳过抽帧，不影响文本功能）。
 */
export function visionActiveFor({
  settings,
  module,
}: {
  settings: Settings;
  module: VisionModule;
}): boolean {
  if (settings.visionEnabled !== true) return false;
  if (!isModelConfigured(settings.visionModel)) return false;
  return settings.visionModules?.[module] !== false;
}

/** 合并写回：把局部更新合并进整份 settings（不动其他分区） */
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return { ...current, ...patch };
}
