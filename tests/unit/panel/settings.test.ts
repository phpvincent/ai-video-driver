/**
 * 设置页纯逻辑单测（单一模型配置 + 预设槽位 + 多模态能力门控 + 抽帧开关）。
 * 断言中的端点与模型标识一律从 src/config 的 MODEL_PRESETS 读取，禁止 URL 字面量（红线 9）。
 *
 * 重点覆盖本次重构要解决的问题：
 * - 每个预设各存各的 API Key，切换不互踩；
 * - 旧数据（endpointKeys / modelProfiles / visionModel）迁移后 Key 不丢；
 * - 「已保存」显示取当前预设槽位，不再恒读单一 model。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODEL_PRESETS } from '../../../src/config';
import {
  activePreset,
  canEnableVision,
  describeModelStrategy,
  hostOf,
  isModelConfigured,
  maskKey,
  mergeSettings,
  migrateLegacyModelSettings,
  normalizeModelConfig,
  presetConfigOf,
  presetKeys,
  presetShortLabel,
  presetVisionDefault,
  resolveModel,
  slotConfigOf,
  slotHasKey,
  validateModelForm,
  visionActiveFor,
  writeSlot,
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

function qwenConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    baseUrl: MODEL_PRESETS.qwen.baseUrl,
    apiKey: 'k-q',
    model: MODEL_PRESETS.qwen.model,
    temperature: { outline: DEFAULT_MODEL.temperature.outline, qa: DEFAULT_MODEL.temperature.qa },
    maxTokens: DEFAULT_MODEL.maxTokens,
    outlineTokenBudget: DEFAULT_MODEL.outlineTokenBudget,
    supportsVision: true,
    ...overrides,
  };
}

/** 单模型 settings 基线：已声明支持图像输入、抽帧开启、三模块全开 */
function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    model: { ...textConfig(), supportsVision: true },
    visionEnabled: true,
    visionModules: { outline: true, mindmap: true, qa: true },
    ...overrides,
  };
}

describe('预设与槽位（每个模型各存各的 Key）', () => {
  it('presetKeys 顺序与 MODEL_PRESETS 一致', () => {
    expect(presetKeys()).toEqual(['deepseek', 'qwen']);
  });

  it('presetConfigOf：端点与模型标识来自 config，Key 恒为空', () => {
    for (const key of presetKeys()) {
      const cfg = presetConfigOf(key);
      expect(cfg.baseUrl).toBe(MODEL_PRESETS[key].baseUrl);
      expect(cfg.model).toBe(MODEL_PRESETS[key].model);
      expect(cfg.apiKey).toBe('');
    }
  });

  it('空设置时槽位回落预设骨架（Key 未设置）', () => {
    expect(slotConfigOf({}, 'deepseek').apiKey).toBe('');
    expect(slotHasKey({}, 'deepseek')).toBe(false);
  });

  it('writeSlot 只写目标槽位，不动另一个槽位', () => {
    let s: Settings = {};
    s = writeSlot(s, 'deepseek', textConfig({ apiKey: 'sk-ds' }));
    s = writeSlot(s, 'qwen', qwenConfig({ apiKey: 'sk-qw' }));
    expect(slotConfigOf(s, 'deepseek').apiKey).toBe('sk-ds');
    expect(slotConfigOf(s, 'qwen').apiKey).toBe('sk-qw');
    // 再写一次 deepseek，qwen 不受影响
    s = writeSlot(s, 'deepseek', textConfig({ apiKey: 'sk-ds-2' }));
    expect(slotConfigOf(s, 'deepseek').apiKey).toBe('sk-ds-2');
    expect(slotConfigOf(s, 'qwen').apiKey).toBe('sk-qw');
  });

  it('slotHasKey：两个预设独立判定（修复 Key 互踩）', () => {
    const s = writeSlot({}, 'deepseek', textConfig({ apiKey: 'sk-ds' }));
    expect(slotHasKey(s, 'deepseek')).toBe(true);
    expect(slotHasKey(s, 'qwen')).toBe(false);
  });

  it('activePreset：按 baseUrl 反推（尾斜杠容错；自定义端点 → null）', () => {
    expect(activePreset(MODEL_PRESETS.deepseek.baseUrl)).toBe('deepseek');
    expect(activePreset(`${MODEL_PRESETS.qwen.baseUrl}/`)).toBe('qwen');
    expect(activePreset('https://my-gateway.example/v1')).toBeNull();
    expect(activePreset('')).toBeNull();
  });
});

describe('migrateLegacyModelSettings（旧数据迁移，Key 不丢）', () => {
  it('endpointKeys 中的 Key 按端点迁入对应槽位', () => {
    const legacy: Settings = {
      model: textConfig({ apiKey: 'sk-ds' }),
      endpointKeys: {
        [MODEL_PRESETS.deepseek.baseUrl]: 'sk-ds',
        [MODEL_PRESETS.qwen.baseUrl]: 'sk-qw',
      },
    };
    const next = migrateLegacyModelSettings(legacy);
    expect(slotConfigOf(next, 'deepseek').apiKey).toBe('sk-ds');
    expect(slotConfigOf(next, 'qwen').apiKey).toBe('sk-qw');
    expect(next.endpointKeys).toBeUndefined();
  });

  it('modelProfiles 里同端点且有 Key 的项迁入槽位', () => {
    const legacy: Settings = {
      model: textConfig({ apiKey: '' }),
      modelProfiles: [
        { ...qwenConfig({ apiKey: 'sk-qw' }), name: 'Qwen 视觉' },
        { ...textConfig({ apiKey: '' }), name: '空 Key 方案' },
      ],
    };
    const next = migrateLegacyModelSettings(legacy);
    expect(slotConfigOf(next, 'qwen').apiKey).toBe('sk-qw');
    expect(next.modelProfiles).toBeUndefined();
  });

  it('model 自身的 Key 补进其所属槽位', () => {
    const next = migrateLegacyModelSettings({ model: qwenConfig({ apiKey: 'sk-qw' }) });
    expect(slotConfigOf(next, 'qwen').apiKey).toBe('sk-qw');
  });

  it('无 model 但有 visionModel → 提升为 model（旧版本兼容）', () => {
    const next = migrateLegacyModelSettings({ visionModel: qwenConfig({ apiKey: 'sk-qw' }) });
    expect(resolveModel(next)?.baseUrl).toBe(MODEL_PRESETS.qwen.baseUrl);
    expect(next.visionModel).toBeUndefined();
  });

  it('modelSupportsVision → model.supportsVision', () => {
    const next = migrateLegacyModelSettings({
      model: textConfig(),
      modelSupportsVision: true,
    });
    expect(next.model?.supportsVision).toBe(true);
  });

  it('迁移幂等：重复执行结果一致', () => {
    const legacy: Settings = {
      model: textConfig({ apiKey: 'sk-ds' }),
      endpointKeys: { [MODEL_PRESETS.deepseek.baseUrl]: 'sk-ds' },
    };
    const once = migrateLegacyModelSettings(legacy);
    const twice = migrateLegacyModelSettings(once);
    expect(twice.modelSlots).toEqual(once.modelSlots);
    expect(twice.model?.apiKey).toBe(once.model?.apiKey);
  });
});

describe('resolveModel（三模块共用一套）', () => {
  it('返回 settings.model；未配置返回 null', () => {
    expect(resolveModel(baseSettings())?.model).toBe(MODEL_PRESETS.deepseek.model);
    expect(resolveModel({})).toBeNull();
  });

  it('不再区分模块：outline / mindmap / qa 得到同一个模型', () => {
    const s = baseSettings();
    const m = resolveModel(s);
    expect(m?.apiKey).toBe('k-1');
  });
});

describe('validateModelForm（表单校验）', () => {
  it('合法配置 → 空错误对象', () => {
    expect(validateModelForm(textConfig())).toEqual({});
  });

  it('缺 baseUrl / apiKey / model → 对应字段报错', () => {
    expect(validateModelForm(textConfig({ baseUrl: '' })).baseUrl).toBeTruthy();
    expect(validateModelForm(textConfig({ apiKey: '' })).apiKey).toBeTruthy();
    expect(validateModelForm(textConfig({ model: '' })).model).toBeTruthy();
  });

  it('非 http(s) 地址 / temperature 越界 / maxTokens 非法 → 报错', () => {
    expect(validateModelForm(textConfig({ baseUrl: 'ftp://x' })).baseUrl).toBeTruthy();
    expect(
      validateModelForm(textConfig({ temperature: { outline: 3, qa: 0.4 } })).temperature,
    ).toBeTruthy();
    expect(validateModelForm(textConfig({ maxTokens: 0 })).maxTokens).toBeTruthy();
  });

  it('normalizeModelConfig 去首尾空白与尾斜杠（401 的常见成因）', () => {
    const out = normalizeModelConfig(
      textConfig({ baseUrl: `${MODEL_PRESETS.deepseek.baseUrl}/`, apiKey: ' sk-x ' }),
    );
    expect(out.baseUrl).toBe(MODEL_PRESETS.deepseek.baseUrl);
    expect(out.apiKey).toBe('sk-x');
  });
});

describe('maskKey（脱敏展示）', () => {
  it('未设置 / 极短 / 常规长度', () => {
    expect(maskKey('')).toBe('未设置');
    expect(maskKey(undefined)).toBe('未设置');
    expect(maskKey('abc')).toBe('••••••••');
    expect(maskKey('sk-1234ABCD')).toBe('••••ABCD');
  });
});

describe('visionActiveFor（抽帧门控）', () => {
  it('全局关闭 → 全模块不抽帧', () => {
    const s = baseSettings({ visionEnabled: false });
    expect(visionActiveFor({ settings: s, module: 'outline' })).toBe(false);
  });

  it('模型未声明多模态 → 不抽帧', () => {
    const s = baseSettings({ model: textConfig() });
    expect(visionActiveFor({ settings: s, module: 'qa' })).toBe(false);
    expect(canEnableVision(s)).toBe(false);
  });

  it('全局开 + 模型多模态 + 模块开关 → 抽帧', () => {
    const s = baseSettings({ model: qwenConfig() });
    expect(canEnableVision(s)).toBe(true);
    expect(visionActiveFor({ settings: s, module: 'mindmap' })).toBe(true);
  });

  it('模块开关关闭 → 该模块不抽帧（其他模块不受影响）', () => {
    const s = baseSettings({ model: qwenConfig(), visionModules: { qa: false } });
    expect(visionActiveFor({ settings: s, module: 'qa' })).toBe(false);
    expect(visionActiveFor({ settings: s, module: 'outline' })).toBe(true);
  });
});

describe('describeModelStrategy（单模型口径）', () => {
  it('未配置 → 明确提示功能不可用', () => {
    const lines = describeModelStrategy({});
    expect(lines[0]).toContain('未配置');
  });

  it('已配置：一行当前模型 + 两个预设各自的 Key 状态', () => {
    const s = writeSlot(
      writeSlot(baseSettings({ model: qwenConfig() }), 'deepseek', textConfig({ apiKey: '' })),
      'qwen',
      qwenConfig({ apiKey: 'sk-qw-1234' }),
    );
    const lines = describeModelStrategy(s);
    expect(lines[0]).toContain('共用');
    expect(lines.some((l) => l.startsWith('DeepSeek：API Key '))).toBe(true);
    expect(lines.some((l) => l.includes('••••1234'))).toBe(true);
  });
});

describe('其他纯函数', () => {
  it('isModelConfigured：三要素齐全才算已配置', () => {
    expect(isModelConfigured(textConfig())).toBe(true);
    expect(isModelConfigured(textConfig({ apiKey: '' }))).toBe(false);
    expect(isModelConfigured(null)).toBe(false);
  });

  it('presetVisionDefault：Qwen 建议多模态，DeepSeek 否', () => {
    expect(presetVisionDefault('deepseek')).toBe(false);
    expect(presetVisionDefault('qwen')).toBe(true);
  });

  it('presetShortLabel', () => {
    expect(presetShortLabel('deepseek')).toBe('DeepSeek');
    expect(presetShortLabel('qwen')).toBe('Qwen');
  });

  it('hostOf：只暴露主机名（红线 9）', () => {
    expect(hostOf(MODEL_PRESETS.qwen.baseUrl)).toBe(new URL(MODEL_PRESETS.qwen.baseUrl).hostname);
    expect(hostOf('')).toBe('无效地址');
    expect(hostOf('not a url')).toBe('无效地址');
  });

  it('mergeSettings：补丁覆盖目标键，其余保留', () => {
    const merged = mergeSettings({ model: textConfig(), visionEnabled: true }, { visionEnabled: false });
    expect(merged.visionEnabled).toBe(false);
    expect(merged.model?.apiKey).toBe('k-1');
  });
});
