/**
 * 设置页纯逻辑单测（多模型配置 + 抽帧开关）。
 * 断言中的端点与模型标识一律从 src/config 的 MODEL_PRESETS 读取，禁止 URL 字面量（红线 9）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODEL_PRESETS, OBSIDIAN } from '../../../src/config';
import {
  applyPreset,
  isModelConfigured,
  mergeSettings,
  validateModelForm,
  visionActiveFor,
} from '../../../src/panel/settings/modelForm';
import type { ModelConfig, Settings } from '../../../src/types';

/** 基线配置（端点与模型标识取自 MODEL_PRESETS.deepseek，不写字面量） */
function textConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    baseUrl: MODEL_PRESETS.deepseek.baseUrl,
    apiKey: 'k-1',
    model: MODEL_PRESETS.deepseek.model,
    temperature: { outline: DEFAULT_MODEL.temperature.outline, qa: DEFAULT_MODEL.temperature.qa },
    maxTokens: DEFAULT_MODEL.maxTokens,
    outlineTokenBudget: DEFAULT_MODEL.outlineTokenBudget,
    ...overrides,
  };
}

/** 已配置视觉模型的 settings 基线 */
function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    model: textConfig(),
    visionModel: {
      ...textConfig(),
      baseUrl: MODEL_PRESETS.qwen.baseUrl,
      model: MODEL_PRESETS.qwen.model,
    },
    visionEnabled: true,
    visionModules: { outline: true, mindmap: true, qa: true },
    ...overrides,
  };
}

describe('applyPreset', () => {
  it('deepseek 预设覆盖 baseUrl 与 model', () => {
    const next = applyPreset(
      textConfig({ baseUrl: MODEL_PRESETS.qwen.baseUrl, model: MODEL_PRESETS.qwen.model }),
      'deepseek',
    );
    expect(next.baseUrl).toBe(MODEL_PRESETS.deepseek.baseUrl);
    expect(next.model).toBe(MODEL_PRESETS.deepseek.model);
  });

  it('qwen 预设覆盖 baseUrl 与 model', () => {
    const next = applyPreset(textConfig(), 'qwen');
    expect(next.baseUrl).toBe(MODEL_PRESETS.qwen.baseUrl);
    expect(next.model).toBe(MODEL_PRESETS.qwen.model);
  });

  it('保留用户已填的 apiKey', () => {
    expect(applyPreset(textConfig({ apiKey: 'keep-me' }), 'qwen').apiKey).toBe('keep-me');
  });

  it('保留 temperature / maxTokens / outlineTokenBudget', () => {
    const next = applyPreset(
      textConfig({
        temperature: { outline: 1.1, qa: 1.9 },
        maxTokens: 1234,
        outlineTokenBudget: 999,
      }),
      'qwen',
    );
    expect(next.temperature).toEqual({ outline: 1.1, qa: 1.9 });
    expect(next.maxTokens).toBe(1234);
    expect(next.outlineTokenBudget).toBe(999);
  });
});

describe('validateModelForm', () => {
  it('合法配置返回空错误对象', () => {
    expect(validateModelForm(textConfig())).toEqual({});
  });

  it('baseUrl 为空报错', () => {
    expect(validateModelForm(textConfig({ baseUrl: '  ' })).baseUrl).toBeTruthy();
  });

  it('baseUrl 非 http(s) 开头报错（相对路径与 ftp 协议）', () => {
    const notHttp = MODEL_PRESETS.deepseek.baseUrl.replace('https://', '');
    const ftp = MODEL_PRESETS.deepseek.baseUrl.replace('https://', 'ftp://');
    expect(validateModelForm(textConfig({ baseUrl: notHttp })).baseUrl).toBeTruthy();
    expect(validateModelForm(textConfig({ baseUrl: ftp })).baseUrl).toBeTruthy();
  });

  it('apiKey 为空报错', () => {
    expect(validateModelForm(textConfig({ apiKey: '' })).apiKey).toBeTruthy();
  });

  it('model 为空报错', () => {
    expect(validateModelForm(textConfig({ model: '' })).model).toBeTruthy();
  });

  it('temperature 越界报错（含 qa）', () => {
    expect(
      validateModelForm(textConfig({ temperature: { outline: 2.5, qa: 0.4 } })).temperature,
    ).toBeTruthy();
    expect(
      validateModelForm(textConfig({ temperature: { outline: 0.2, qa: -0.1 } })).temperature,
    ).toBeTruthy();
  });

  it('temperature 边界 0 与 2 合法', () => {
    expect(validateModelForm(textConfig({ temperature: { outline: 0, qa: 2 } })).temperature).toBeUndefined();
    expect(validateModelForm(textConfig({ temperature: { outline: 2, qa: 0 } })).temperature).toBeUndefined();
  });

  it('maxTokens 边界：1 合法，0 非法', () => {
    expect(validateModelForm(textConfig({ maxTokens: 1 })).maxTokens).toBeUndefined();
    expect(validateModelForm(textConfig({ maxTokens: 0 })).maxTokens).toBeTruthy();
  });
});

describe('isModelConfigured', () => {
  it('三要素齐全才算已配置', () => {
    expect(isModelConfigured(textConfig())).toBe(true);
    expect(isModelConfigured({ ...textConfig(), apiKey: '' })).toBe(false);
    expect(isModelConfigured(undefined)).toBe(false);
  });
});

describe('visionActiveFor', () => {
  it('全局开关关闭 → false', () => {
    expect(visionActiveFor({ settings: baseSettings({ visionEnabled: false }), module: 'outline' })).toBe(false);
  });

  it('全局开关未配置（默认关）→ false', () => {
    expect(visionActiveFor({ settings: baseSettings({ visionEnabled: undefined }), module: 'qa' })).toBe(false);
  });

  it('未配置视觉模型 → false', () => {
    expect(
      visionActiveFor({ settings: baseSettings({ visionModel: undefined }), module: 'mindmap' }),
    ).toBe(false);
  });

  it('视觉模型缺 apiKey → false', () => {
    const vm = { ...textConfig(), apiKey: '' };
    expect(visionActiveFor({ settings: baseSettings({ visionModel: vm }), module: 'qa' })).toBe(false);
  });

  it('模块开关未配置 → 视为开启', () => {
    expect(
      visionActiveFor({ settings: baseSettings({ visionModules: undefined }), module: 'outline' }),
    ).toBe(true);
  });

  it('模块开关显式 false → false', () => {
    expect(
      visionActiveFor({
        settings: baseSettings({ visionModules: { outline: false, mindmap: true, qa: true } }),
        module: 'outline',
      }),
    ).toBe(false);
  });

  it('三个模块分别验证（全局开 + 全开）', () => {
    const settings = baseSettings();
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(true);
  });

  it('只关闭问答时大纲与导图仍为 true', () => {
    const settings = baseSettings({ visionModules: { outline: true, mindmap: true, qa: false } });
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(true);
  });
});

describe('mergeSettings', () => {
  it('只更新目标分区，其他分区不变', () => {
    const current: Settings = {
      model: textConfig(),
      obsidian: { baseUrl: OBSIDIAN.baseUrl, apiKey: 'o', rootDir: 'r' },
      knowledgeSearch: true,
    };
    const next = mergeSettings(current, { visionEnabled: true });
    expect(next.visionEnabled).toBe(true);
    expect(next.model).toBe(current.model);
    expect(next.obsidian).toBe(current.obsidian);
    expect(next.knowledgeSearch).toBe(true);
  });

  it('不改动入参（返回新对象）', () => {
    const current: Settings = { visionEnabled: false };
    const next = mergeSettings(current, { visionEnabled: true });
    expect(current.visionEnabled).toBe(false);
    expect(next).not.toBe(current);
  });

  it('多次合并累积：model → visionModel → 开关', () => {
    let s: Settings = {};
    s = mergeSettings(s, { model: textConfig() });
    s = mergeSettings(s, { visionModel: textConfig({ model: MODEL_PRESETS.qwen.model }) });
    s = mergeSettings(s, { visionEnabled: true, visionModules: { outline: false } });
    expect(s.model?.model).toBe(MODEL_PRESETS.deepseek.model);
    expect(s.visionModel?.model).toBe(MODEL_PRESETS.qwen.model);
    expect(s.visionEnabled).toBe(true);
    expect(visionActiveFor({ settings: s, module: 'outline' })).toBe(false);
    expect(visionActiveFor({ settings: s, module: 'qa' })).toBe(true);
  });
});
