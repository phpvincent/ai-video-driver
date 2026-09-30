/**
 * 设置页纯逻辑单测（单模型配置 + 多模态能力门控 + 抽帧开关）。
 * 断言中的端点与模型标识一律从 src/config 的 MODEL_PRESETS 读取，禁止 URL 字面量（红线 9）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODEL_PRESETS, OBSIDIAN } from '../../../src/config';
import {
  applyPreset,
  canEnableVision,
  describeModelStrategy,
  hostOf,
  isModelConfigured,
  mergeSettings,
  migrateLegacyVisionModel,
  presetVisionDefault,
  validateModelForm,
  visionActiveFor,
  normalizeModelConfig,
  presetShortLabel,
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

/** 旧版本的多模态模型配置（用于迁移用例） */
function legacyVisionConfig(): ModelConfig {
  return { ...textConfig(), baseUrl: MODEL_PRESETS.qwen.baseUrl, model: MODEL_PRESETS.qwen.model };
}

/** 单模型 settings 基线：已声明支持图像输入、抽帧开启、三模块全开 */
function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    model: textConfig(),
    modelSupportsVision: true,
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

describe('presetVisionDefault', () => {
  it('deepseek → false（纯文本）', () => {
    expect(presetVisionDefault('deepseek')).toBe(false);
  });

  it('qwen → true（兼容模式支持图文）', () => {
    expect(presetVisionDefault('qwen')).toBe(true);
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

describe('canEnableVision', () => {
  it('声明支持图像输入 → true', () => {
    expect(canEnableVision(baseSettings({ modelSupportsVision: true }))).toBe(true);
  });

  it('未声明 / 显式 false / 字段缺失 → false', () => {
    expect(canEnableVision(baseSettings({ modelSupportsVision: false }))).toBe(false);
    expect(canEnableVision(baseSettings({ modelSupportsVision: undefined }))).toBe(false);
    expect(canEnableVision({})).toBe(false);
  });
});

describe('visionActiveFor', () => {
  it('未声明支持图像输入 → false（三模块均不可用）', () => {
    const settings = baseSettings({ modelSupportsVision: false });
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(false);
  });

  it('不再看 visionModel：仅有旧视觉模型也不生效', () => {
    const settings: Settings = {
      model: textConfig(),
      visionModel: legacyVisionConfig(),
      visionEnabled: true,
    };
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(false);
  });

  it('声明支持 + 全局开 + 模块未配置 → true（三模块各一例）', () => {
    const settings = baseSettings({ visionModules: undefined });
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(true);
  });

  it('模块显式 false → false（三模块各一例）', () => {
    expect(
      visionActiveFor({
        settings: baseSettings({ visionModules: { outline: false, mindmap: true, qa: true } }),
        module: 'outline',
      }),
    ).toBe(false);
    expect(
      visionActiveFor({
        settings: baseSettings({ visionModules: { outline: true, mindmap: false, qa: true } }),
        module: 'mindmap',
      }),
    ).toBe(false);
    expect(
      visionActiveFor({
        settings: baseSettings({ visionModules: { outline: true, mindmap: true, qa: false } }),
        module: 'qa',
      }),
    ).toBe(false);
  });

  it('全局关闭 → false（三模块各一例）', () => {
    const settings = baseSettings({ visionEnabled: false });
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(false);
  });

  it('全局开关未配置（默认关）→ false', () => {
    expect(
      visionActiveFor({ settings: baseSettings({ visionEnabled: undefined }), module: 'qa' }),
    ).toBe(false);
  });

  it('只关闭问答时大纲与导图仍为 true', () => {
    const settings = baseSettings({ visionModules: { outline: true, mindmap: true, qa: false } });
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(true);
  });
});

describe('migrateLegacyVisionModel', () => {
  it('无 model 有 visionModel → 提升为 model 并清除 visionModel', () => {
    const next = migrateLegacyVisionModel({ visionModel: legacyVisionConfig() });
    expect(next.model?.model).toBe(MODEL_PRESETS.qwen.model);
    expect(next.visionModel).toBeUndefined();
  });

  it('两者都有 → 保留 model，清除 visionModel', () => {
    const next = migrateLegacyVisionModel({ model: textConfig(), visionModel: legacyVisionConfig() });
    expect(next.model?.model).toBe(MODEL_PRESETS.deepseek.model);
    expect(next.visionModel).toBeUndefined();
  });

  it('都无 → 原样返回（不改字段）', () => {
    const current: Settings = { visionEnabled: true, knowledgeSearch: true };
    const next = migrateLegacyVisionModel(current);
    expect(next).toEqual(current);
    expect(next.model).toBeUndefined();
  });
});

describe('hostOf', () => {
  it('正常 URL 取主机名（不输出完整地址，红线 9）', () => {
    expect(hostOf(MODEL_PRESETS.qwen.baseUrl)).toBe(new URL(MODEL_PRESETS.qwen.baseUrl).hostname);
    expect(hostOf(MODEL_PRESETS.deepseek.baseUrl)).toBe(
      new URL(MODEL_PRESETS.deepseek.baseUrl).hostname,
    );
  });

  it('非法字符串 → 无效地址', () => {
    expect(hostOf('not-a-url')).toBe('无效地址');
    expect(hostOf('   ')).toBe('无效地址');
  });

  it('空值 → 无效地址', () => {
    expect(hostOf('')).toBe('无效地址');
    expect(hostOf(undefined)).toBe('无效地址');
  });
});

describe('describeModelStrategy', () => {
  const joined = (settings: Settings): string => describeModelStrategy(settings).join('\n');

  it('四行：当前模型 / 多模态 / 抽帧 / 说明', () => {
    const lines = describeModelStrategy(baseSettings());
    expect(lines).toHaveLength(4);
    expect(lines[0].startsWith('当前模型：')).toBe(true);
    expect(lines[1].startsWith('多模态：')).toBe(true);
    expect(lines[2].startsWith('抽帧：')).toBe(true);
    expect(lines[3].startsWith('说明：')).toBe(true);
  });

  it('单模型已配置：显示主机名 / 模型', () => {
    const lines = describeModelStrategy(baseSettings());
    expect(lines[0]).toContain(new URL(MODEL_PRESETS.deepseek.baseUrl).hostname);
    expect(lines[0]).toContain(MODEL_PRESETS.deepseek.model);
  });

  it('未配置模型 → 未配置（功能不可用）', () => {
    expect(joined(baseSettings({ model: undefined }))).toContain('当前模型：未配置（功能不可用）');
    expect(joined({})).toContain('当前模型：未配置（功能不可用）');
  });

  it('声明支持图像输入 → 多模态：支持', () => {
    expect(joined(baseSettings({ modelSupportsVision: true }))).toContain('多模态：支持');
  });

  it('未声明支持图像输入 → 多模态：不支持（抽帧不可用）', () => {
    const text = joined(baseSettings({ modelSupportsVision: false }));
    expect(text).toContain('多模态：不支持（抽帧不可用）');
    expect(text).toContain('抽帧：不可用（当前模型未声明支持图像输入）');
  });

  it('抽帧开启且三模块全开 → 大纲✓ 导图✓ 问答✓', () => {
    expect(joined(baseSettings())).toContain('抽帧：已开启（大纲✓ 导图✓ 问答✓）');
  });

  it('抽帧开启但模块部分关闭 → 对应模块标 ✗', () => {
    expect(joined(baseSettings({ visionModules: { outline: true, mindmap: false, qa: false } }))).toContain(
      '抽帧：已开启（大纲✓ 导图✗ 问答✗）',
    );
  });

  it('抽帧关闭 → 抽帧：已关闭', () => {
    expect(joined(baseSettings({ visionEnabled: false }))).toContain('抽帧：已关闭');
  });

  it('说明行：图片与文本一起发给同一个模型', () => {
    const line = describeModelStrategy(baseSettings())[3];
    expect(line).toContain('图片与文本一起发给同一个模型');
    expect(line).toContain('未开启抽帧时为纯文本问答');
  });

  it('不输出完整接口地址（只暴露主机名，红线 9）', () => {
    const text = joined(baseSettings());
    expect(text).not.toContain(MODEL_PRESETS.deepseek.baseUrl);
    expect(text).not.toContain('https://');
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

  it('多次合并累积：model → modelSupportsVision → 开关', () => {
    let s: Settings = {};
    s = mergeSettings(s, { model: textConfig() });
    s = mergeSettings(s, { modelSupportsVision: true });
    s = mergeSettings(s, { visionEnabled: true, visionModules: { outline: false } });
    expect(s.model?.model).toBe(MODEL_PRESETS.deepseek.model);
    expect(s.modelSupportsVision).toBe(true);
    expect(s.visionEnabled).toBe(true);
    expect(visionActiveFor({ settings: s, module: 'outline' })).toBe(false);
    expect(visionActiveFor({ settings: s, module: 'qa' })).toBe(true);
  });

  it('合并后迁移旧 visionModel：抽帧按 modelSupportsVision 判定', () => {
    let s: Settings = { visionModel: legacyVisionConfig() };
    s = mergeSettings(s, { visionEnabled: true });
    s = migrateLegacyVisionModel(s);
    expect(s.model?.model).toBe(MODEL_PRESETS.qwen.model);
    expect(visionActiveFor({ settings: s, module: 'qa' })).toBe(false);
    expect(visionActiveFor({ settings: mergeSettings(s, { modelSupportsVision: true }), module: 'qa' })).toBe(true);
  });
  it('normalizeModelConfig：去除首尾空白与 baseUrl 尾斜杠（401 常见成因）', () => {
    const raw = { ...DEFAULT_MODEL, baseUrl: '  https://example.com/  ', apiKey: '  test-key  ', model: ' m1 ' };
    const n = normalizeModelConfig(raw as never);
    expect(n.apiKey).toBe('test-key');
    expect(n.model).toBe('m1');
    expect(n.baseUrl).toBe('https://example.com');
  });

  it('presetShortLabel：三个预设各自可区分', () => {
    expect(presetShortLabel('deepseek')).toBe('DeepSeek');
    expect(presetShortLabel('qwen')).toContain('百炼');
    expect(presetShortLabel('qwenMaas')).toContain('maas');
    expect(presetShortLabel('qwen')).not.toBe(presetShortLabel('qwenMaas'));
  });

  it('presetVisionDefault：DeepSeek 不支持图像，Qwen 两端点默认支持', () => {
    expect(presetVisionDefault('deepseek')).toBe(false);
    expect(presetVisionDefault('qwen')).toBe(true);
    expect(presetVisionDefault('qwenMaas')).toBe(true);
  });
});
