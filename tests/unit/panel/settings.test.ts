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
  listProfiles,
  mergeSettings,
  migrateLegacyVisionModel,
  migrateVisionToModel,
  presetVisionDefault,
  resolveModuleModel,
  validateModelForm,
  visionActiveFor,
  normalizeModelConfig,
  presetShortLabel,
  activePreset,
  seedProfilesIfEmpty,
  stripSeedProfiles,
  preserveSecrets,
  mergeSavedSecrets,
  maskKey,
  savedKeyForEndpoint,
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

  it('applyPreset：只换端点与模型名（Key 由 savedKeyForEndpoint 按端点回填，本函数不处理）', () => {
    const form = { ...DEFAULT_MODEL, baseUrl: 'https://old.example/v1', apiKey: 'keep-me' } as never;
    const out = applyPreset(form as never, 'deepseek');
    expect(out.baseUrl).toBe(MODEL_PRESETS.deepseek.baseUrl);
    expect(out.model).toBe(MODEL_PRESETS.deepseek.model);
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

  // ---- 按模块选模型的新语义：能力随各模块所选方案走 ----

  it('方案声明支持图像输入且问答选它 → 问答 true / 未选的大纲 false（按模块差异化）', () => {
    const profile = { ...textConfig(), name: 'Qwen 视觉', supportsVision: true };
    const settings = baseSettings({
      modelSupportsVision: false,
      modelProfiles: [profile],
      moduleModel: { qa: 'Qwen 视觉' },
    });
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(true);
    expect(visionActiveFor({ settings, module: 'outline' })).toBe(false);
    expect(visionActiveFor({ settings, module: 'mindmap' })).toBe(false);
  });

  it('默认模型不支持但问答选了支持的方案 → 问答 true（关键用例：按模块差异化）', () => {
    const profile = {
      ...textConfig(),
      name: '视觉方案',
      baseUrl: MODEL_PRESETS.qwen.baseUrl,
      model: MODEL_PRESETS.qwen.model,
      supportsVision: true,
    };
    const settings = baseSettings({
      modelSupportsVision: false,
      modelProfiles: [profile],
      moduleModel: { qa: '视觉方案' },
    });
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(true);
  });

  it('旧字段兼容：model.supportsVision 缺失时回退 modelSupportsVision', () => {
    // baseSettings 未在 model 上声明 supportsVision，仅旧字段 modelSupportsVision: true
    const settings = baseSettings({ visionModules: undefined });
    expect(settings.model?.supportsVision).toBeUndefined();
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(true);
  });

  it('模块选中无 Key 的方案 → 回退默认模型的能力（不生效）', () => {
    const keyless = { ...textConfig(), name: '无 Key 方案', apiKey: '' };
    const settings = baseSettings({
      modelSupportsVision: true,
      modelProfiles: [keyless],
      moduleModel: { qa: '无 Key 方案' },
    });
    // 方案被过滤 → 问答用默认模型（支持）→ true；同时验证解析回退
    expect(resolveModuleModel(settings, 'qa')?.model).toBe(MODEL_PRESETS.deepseek.model);
    expect(visionActiveFor({ settings, module: 'qa' })).toBe(true);
  });
});

describe('resolveModuleModel', () => {
  it('无 moduleModel → 默认模型', () => {
    const settings = baseSettings();
    expect(resolveModuleModel(settings, 'outline')).toBe(settings.model);
    expect(resolveModuleModel(settings, 'mindmap')).toBe(settings.model);
    expect(resolveModuleModel(settings, 'qa')).toBe(settings.model);
  });

  it('命中方案名 → 返回该方案', () => {
    const profile = {
      ...textConfig(),
      name: 'Qwen 视觉',
      baseUrl: MODEL_PRESETS.qwen.baseUrl,
      model: MODEL_PRESETS.qwen.model,
    };
    const settings = baseSettings({ modelProfiles: [profile], moduleModel: { outline: 'Qwen 视觉' } });
    expect(resolveModuleModel(settings, 'outline')?.model).toBe(MODEL_PRESETS.qwen.model);
    // 未选方案的模块仍走默认
    expect(resolveModuleModel(settings, 'qa')?.model).toBe(MODEL_PRESETS.deepseek.model);
  });

  it('引用不存在的方案名 → 回退默认模型', () => {
    const settings = baseSettings({ moduleModel: { qa: '不存在的方案' } });
    expect(resolveModuleModel(settings, 'qa')).toBe(settings.model);
  });

  it('默认模型缺失 → null', () => {
    const settings = baseSettings({ model: undefined, moduleModel: { qa: '不存在' } });
    expect(resolveModuleModel(settings, 'qa')).toBeNull();
    expect(resolveModuleModel({}, 'outline')).toBeNull();
  });
});

describe('listProfiles', () => {
  it('过滤无 name / 无 apiKey 的方案', () => {
    const settings = baseSettings({
      modelProfiles: [
        { ...textConfig(), name: 'ok' },
        { ...textConfig(), apiKey: '' , name: '无 Key' },
        { ...textConfig() },
      ],
    });
    const names = listProfiles(settings).map((p) => p.name);
    expect(names).toEqual(['ok']);
  });

  it('name 唯一：同名时先出现者优先', () => {
    const first = { ...textConfig(), name: '同名', maxTokens: 111 };
    const second = { ...textConfig(), name: '同名', maxTokens: 222 };
    const settings = baseSettings({ modelProfiles: [first, second] });
    const profiles = listProfiles(settings);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].maxTokens).toBe(111);
  });
});

describe('migrateVisionToModel', () => {
  it('旧 modelSupportsVision=true 且 model.supportsVision 缺失 → 写入 model.supportsVision', () => {
    const settings = baseSettings({ modelSupportsVision: true });
    expect(settings.model?.supportsVision).toBeUndefined();
    const next = migrateVisionToModel(settings);
    expect(next.model?.supportsVision).toBe(true);
  });

  it('已有 supportsVision 不覆盖（false 也保留）', () => {
    const settings = baseSettings({
      modelSupportsVision: true,
      model: { ...textConfig(), supportsVision: false },
    });
    const next = migrateVisionToModel(settings);
    expect(next.model?.supportsVision).toBe(false);
  });

  it('幂等：跑两次结果相同', () => {
    const settings = baseSettings({ modelSupportsVision: true });
    const once = migrateVisionToModel(settings);
    const twice = migrateVisionToModel(once);
    expect(twice).toEqual(once);
  });

  it('旧字段非 true / model 缺失 → 原样返回', () => {
    const noLegacy = baseSettings({ modelSupportsVision: false });
    expect(migrateVisionToModel(noLegacy)).toBe(noLegacy);
    const noModel: Settings = { modelSupportsVision: true };
    expect(migrateVisionToModel(noModel)).toBe(noModel);
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

  // 语义变化（按模块选模型）：摘要新增三行模块模型（大纲/导图/问答），共七行
  it('七行：当前模型 / 大纲 / 导图 / 问答 / 多模态 / 抽帧 / 说明', () => {
    const lines = describeModelStrategy(baseSettings());
    expect(lines).toHaveLength(7);
    expect(lines[0].startsWith('当前模型：')).toBe(true);
    expect(lines[1].startsWith('大纲：')).toBe(true);
    expect(lines[2].startsWith('导图：')).toBe(true);
    expect(lines[3].startsWith('问答：')).toBe(true);
    expect(lines[4].startsWith('多模态：')).toBe(true);
    expect(lines[5].startsWith('抽帧：')).toBe(true);
    expect(lines[6].startsWith('说明：')).toBe(true);
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

  // 语义变化（能力随模块所选模型走）：多模态行按模块打标
  it('声明支持图像输入 → 多模态按模块打标（三模块均 ✓）', () => {
    expect(joined(baseSettings({ modelSupportsVision: true }))).toContain(
      '多模态：大纲✓ 导图✓ 问答✓',
    );
  });

  it('未声明支持图像输入 → 多模态：不支持（抽帧不可用）', () => {
    const text = joined(baseSettings({ modelSupportsVision: false }));
    expect(text).toContain('多模态：不支持（抽帧不可用）');
    // 语义变化（按模块选模型）：不可用文案改为"各模块所选模型均未声明…"
    expect(text).toContain('抽帧：不可用（各模块所选模型均未声明支持图像输入）');
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
    const line = describeModelStrategy(baseSettings())[6];
    expect(line).toContain('图片与文本一起发给同一个模型');
    expect(line).toContain('未开启抽帧时为纯文本问答');
  });

  it('不输出完整接口地址（只暴露主机名，红线 9）', () => {
    const text = joined(baseSettings());
    expect(text).not.toContain(MODEL_PRESETS.deepseek.baseUrl);
    expect(text).not.toContain('https://');
  });

  it('三行模块模型显示各模块实际会用的模型（未另选 → 默认模型）', () => {
    const lines = describeModelStrategy(baseSettings());
    const host = new URL(MODEL_PRESETS.deepseek.baseUrl).hostname;
    expect(lines[1]).toBe(`大纲：${host} / ${MODEL_PRESETS.deepseek.model}`);
    expect(lines[2]).toBe(`导图：${host} / ${MODEL_PRESETS.deepseek.model}`);
    expect(lines[3]).toBe(`问答：${host} / ${MODEL_PRESETS.deepseek.model}`);
  });

  it('模块另选方案 → 对应行显示该方案的主机名 / 模型', () => {
    const profile = {
      ...textConfig(),
      name: 'Qwen 视觉',
      baseUrl: MODEL_PRESETS.qwen.baseUrl,
      model: MODEL_PRESETS.qwen.model,
    };
    const lines = describeModelStrategy(
      baseSettings({ modelProfiles: [profile], moduleModel: { qa: 'Qwen 视觉' } }),
    );
    const qwenHost = new URL(MODEL_PRESETS.qwen.baseUrl).hostname;
    const deepseekHost = new URL(MODEL_PRESETS.deepseek.baseUrl).hostname;
    expect(lines[1]).toBe(`大纲：${deepseekHost} / ${MODEL_PRESETS.deepseek.model}`);
    expect(lines[3]).toBe(`问答：${qwenHost} / ${MODEL_PRESETS.qwen.model}`);
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
  it('activePreset：按 baseUrl 识别当前预设（含尾斜杠归一）', () => {
    expect(activePreset(MODEL_PRESETS.deepseek.baseUrl)).toBe('deepseek');
    expect(activePreset(MODEL_PRESETS.qwenMaas.baseUrl + '/')).toBe('qwenMaas');
    expect(activePreset('https://example.com/v1')).toBeNull();
    expect(activePreset('')).toBeNull();
  });
  it('seedProfilesIfEmpty：空方案时注入三个内置方案（多模态标记正确）', () => {
    const seeded = seedProfilesIfEmpty({});
    const profiles = seeded.modelProfiles as never[];
    expect(profiles.length).toBe(3);
    const names = profiles.map((x) => (x as { name: string }).name);
    expect(names.some((n) => n.includes('DeepSeek'))).toBe(true);
    expect(names.filter((n) => n.includes('Qwen')).length).toBe(2);
    // DeepSeek 不支持图像；Qwen 方案支持
    const ds = profiles.find((x) => (x as { name: string }).name.includes('DeepSeek')) as unknown as { supportsVision?: boolean };
    const qw = profiles.find((x) => (x as { name: string }).name.includes('maas')) as unknown as { supportsVision?: boolean };
    expect(ds.supportsVision).toBe(false);
    expect(qw.supportsVision).toBe(true);
    // 已有方案时不覆盖（幂等）
    const existing = { modelProfiles: [{ name: '我的方案', apiKey: 'k' }] };
    expect((seedProfilesIfEmpty(existing as never).modelProfiles as never[]).length).toBe(1);
  });
  it('stripSeedProfiles：剔除未激活的种子方案，保留已填 Key 的同名方案', () => {
    const settings = {
      modelProfiles: [
        { name: '内置 · Qwen · maas 网关', apiKey: '' },
        { name: '内置 · DeepSeek', apiKey: '' },
        { name: '内置 · Qwen · maas 网关', apiKey: 'sk-real' },
        { name: '我的方案', apiKey: '' },
      ],
    } as never;
    const out = stripSeedProfiles(settings).modelProfiles as Array<{ name: string; apiKey?: string }>;
    // 空 Key 的种子项被剔除；用户填过 Key 的与自定义方案保留
    expect(out.map((p) => p.name)).toEqual(['内置 · Qwen · maas 网关', '我的方案']);
    expect(out[0]?.apiKey).toBe('sk-real');
  });

  it('preserveSecrets：同端点下新值 Key 为空时沿用旧值（密钥不得被静默清空）', () => {
    const prev = { model: { ...DEFAULT_MODEL, apiKey: 'sk-old' } } as never;
    const next = { model: { ...DEFAULT_MODEL, apiKey: '' } } as never;
    expect(preserveSecrets(next, prev).model?.apiKey).toBe('sk-old');
    // 方案级别同样生效
    const prev2 = { modelProfiles: [{ name: 'A', apiKey: 'sk-a', baseUrl: 'https://x', model: 'm' }] } as never;
    const next2 = { modelProfiles: [{ name: 'A', apiKey: '', baseUrl: 'https://x', model: 'm' }] } as never;
    expect((preserveSecrets(next2, prev2).modelProfiles as Array<{ apiKey: string }>)[0]?.apiKey).toBe('sk-a');
  });

  it('preserveSecrets：端点变了绝不沿用旧 Key（401 根因——A 平台钥匙不能开 B 平台的门）', () => {
    const prev = { model: { ...DEFAULT_MODEL, baseUrl: 'https://maas.example/v1', apiKey: 'sk-maas' } } as never;
    const next = { model: { ...DEFAULT_MODEL, baseUrl: 'https://dashscope.example/v1', apiKey: '' } } as never;
    expect(preserveSecrets(next, prev).model?.apiKey).toBe('');
    // 方案同理
    const prev2 = { modelProfiles: [{ name: 'A', apiKey: 'sk-maas', baseUrl: 'https://maas.example/v1', model: 'm' }] } as never;
    const next2 = { modelProfiles: [{ name: 'A', apiKey: '', baseUrl: 'https://dashscope.example/v1', model: 'm' }] } as never;
    expect((preserveSecrets(next2, prev2).modelProfiles as Array<{ apiKey?: string }>)[0]?.apiKey ?? '').toBe('');
  });

  it('resolveModuleModel：选中的方案缺 Key → 回退默认模型（不返回不完整配置）', () => {
    const settings = {
      model: { ...DEFAULT_MODEL, apiKey: 'sk-default' },
      modelProfiles: [{ name: '缺Key方案', apiKey: '', baseUrl: 'https://x', model: 'm' }],
      moduleModel: { qa: '缺Key方案' },
    } as never;
    expect(resolveModuleModel(settings, 'qa')?.apiKey).toBe('sk-default');
  });

  it('applyPreset：同端点保留 Key；换端点保留表单 Key（回填由 savedKeyForEndpoint 负责）', () => {
    const form: ModelConfig = { ...DEFAULT_MODEL, baseUrl: MODEL_PRESETS.deepseek.baseUrl, apiKey: 'sk-ds', model: 'deepseek-flash' };
    expect(applyPreset(form, 'deepseek').apiKey).toBe('sk-ds');
    expect(applyPreset(form, 'qwen').apiKey).toBe('sk-ds'); // 不清空，回填逻辑负责
  });

  it('savedKeyForEndpoint：优先同端点方案，其次同端点默认模型，无则 null', () => {
    const settings = {
      model: { ...DEFAULT_MODEL, baseUrl: 'https://deepseek', apiKey: 'sk-ds' },
      modelProfiles: [
        { name: 'Q1', apiKey: 'sk-q1', baseUrl: 'https://maas', model: 'm' },
        { name: 'Q2', apiKey: '', baseUrl: 'https://maas2', model: 'm' },
      ],
    } as never;
    expect(savedKeyForEndpoint(settings, 'https://maas')).toBe('sk-q1');
    expect(savedKeyForEndpoint(settings, 'https://deepseek')).toBe('sk-ds');
    expect(savedKeyForEndpoint(settings, 'https://maas2')).toBeNull();
    expect(savedKeyForEndpoint(settings, 'https://unknown')).toBeNull();
  });

  it('preserveSecrets：新值填了 Key 时以新值为准（正常覆盖）', () => {
    const prev = { model: { ...DEFAULT_MODEL, apiKey: 'sk-old' } } as never;
    const next = { model: { ...DEFAULT_MODEL, apiKey: 'sk-new' } } as never;
    expect(preserveSecrets(next, prev).model?.apiKey).toBe('sk-new');
  });
  it('mergeSavedSecrets：只改 moduleModel（切 Tab/切模块）时 Key 原样不动', () => {
    const stored = {
      model: { ...DEFAULT_MODEL, apiKey: 'sk-keep' },
      modelProfiles: [{ name: 'Q', apiKey: 'sk-q', baseUrl: 'https://q', model: 'm' }],
    } as never;
    const next = { ...(stored as object), moduleModel: { qa: 'Q' } } as never;
    const out = mergeSavedSecrets(next, stored);
    expect(out.model?.apiKey).toBe('sk-keep');
    expect((out.modelProfiles as Array<{ apiKey: string }>)[0]?.apiKey).toBe('sk-q');
  });

  it('mergeSavedSecrets：保存其他分区（Obsidian）不带 model 时 Key 不被清空', () => {
    const stored = { model: { ...DEFAULT_MODEL, apiKey: 'sk-keep' } } as never;
    const next = {
      model: { ...DEFAULT_MODEL, apiKey: '' },
      obsidian: { baseUrl: 'https://o', apiKey: 'k', rootDir: 'r' },
    } as never;
    expect(mergeSavedSecrets(next, stored).model?.apiKey).toBe('sk-keep');
  });

  it('mergeSavedSecrets：用户填了新 Key 才覆盖（身份不变）', () => {
    const stored = { model: { ...DEFAULT_MODEL, apiKey: 'sk-old' } } as never;
    const next = { model: { ...DEFAULT_MODEL, apiKey: 'sk-new' } } as never;
    expect(mergeSavedSecrets(next, stored).model?.apiKey).toBe('sk-new');
  });

  it('maskKey：脱敏且不暴露完整内容', () => {
    expect(maskKey('')).toBe('未设置');
    expect(maskKey(undefined)).toBe('未设置');
    expect(maskKey('short')).toBe('••••••••');
    const masked = maskKey('sk-abcdefgh1234');
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).not.toContain('abcdefgh');
  });
});
