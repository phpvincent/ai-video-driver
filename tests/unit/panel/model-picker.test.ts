/**
 * ModelPicker 单测（按模块选模型）：
 * buildPickerOptions 纯函数（默认项 + 方案项 + hasKey 标记）+
 * renderToString 冒烟（不触发 effect，chrome 未 mock 也能渲染）。
 * 端点与模型标识一律从 src/config 的 MODEL_PRESETS 读取（红线 9）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODEL_PRESETS } from '../../../src/config';
import { ModelPicker, PICKER_MISSING_KEY_HINT, buildPickerOptions } from '../../../src/panel/ModelPicker';
import type { ModelConfig, Settings } from '../../../src/types';

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

describe('buildPickerOptions', () => {
  it('首项为默认：value 空串 + label 含默认模型名 + hasKey=true', () => {
    const options = buildPickerOptions({ model: textConfig() });
    // 逐字段断言（vision 为后续新增字段，首项默认模型未声明多模态时为 false）
    expect(options[0].value).toBe('');
    expect(options[0].label).toBe(`默认（${MODEL_PRESETS.deepseek.model}）`);
    expect(options[0].hasKey).toBe(true);
    expect(options[0].vision).toBe(false);
  });

  it('默认模型未配置 → 「默认（未配置）」且 hasKey=false', () => {
    const options = buildPickerOptions({ model: undefined });
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('默认（未配置）');
    expect(options[0].hasKey).toBe(false);
  });

  it('方案项：value 与 label 为方案名，hasKey 按 Key 标记', () => {
    const vision = { ...textConfig(), name: 'Qwen 视觉' };
    const keyless = { ...textConfig({ apiKey: '' }), name: '无 Key 方案' };
    const options = buildPickerOptions({ model: textConfig(), modelProfiles: [vision, keyless] });
    expect(options.map((o) => o.value)).toEqual(['', 'Qwen 视觉', '无 Key 方案']);
    expect(options[1].hasKey).toBe(true);
    expect(options[2].hasKey).toBe(false);
  });

  it('无 name 的方案不出现；同名方案先出现者优先', () => {
    const settings: Settings = {
      model: textConfig(),
      modelProfiles: [
        { ...textConfig(), name: '同名', maxTokens: 111 },
        { ...textConfig(), name: '同名', maxTokens: 222 },
        textConfig(),
      ],
    };
    const options = buildPickerOptions(settings);
    expect(options).toHaveLength(2);
    expect(options[1].value).toBe('同名');
    // label 不暴露模型细节（只显示方案名；能力/端点详情在设置页方案列表展示）
    expect(options[1].label).toBe('同名');
  });

  it('moduleModel 的选择不影响选项构造（选项只由 model/modelProfiles 决定）', () => {
    const profile = { ...textConfig(), name: 'A' };
    const withSelection = buildPickerOptions({
      model: textConfig(),
      modelProfiles: [profile],
      moduleModel: { qa: 'A' },
    });
    const withoutSelection = buildPickerOptions({
      model: textConfig(),
      modelProfiles: [profile],
    });
    expect(withSelection).toEqual(withoutSelection);
  });
});

describe('ModelPicker renderToString 冒烟', () => {
  it('初始渲染：一行「模型：」+ 下拉（无 chrome 环境不抛错）', () => {
    const html = renderToString(createElement(ModelPicker, { module: 'qa' }));
    expect(html).toContain('模型：');
    expect(html).toContain('model-picker-select');
  });

  it('缺 Key 提示文案常量导出（供 UI 与测试共用）', () => {
    expect(PICKER_MISSING_KEY_HINT).toBe('该方案缺少 Key，将回退默认');
  });
  it('buildPickerOptions：多模态方案标签带「· 多模态」且 vision=true', () => {
    const settings = {
      model: { ...DEFAULT_MODEL },
      modelProfiles: [
        { name: 'Qwen 视觉', apiKey: 'k', supportsVision: true },
        { name: 'DeepSeek 文本', apiKey: 'k', supportsVision: false },
      ],
    } as never;
    const opts = buildPickerOptions(settings);
    const qwen = opts.find((o) => o.value === 'Qwen 视觉');
    const ds = opts.find((o) => o.value === 'DeepSeek 文本');
    expect(qwen?.vision).toBe(true);
    expect(qwen?.label).toContain('多模态');
    expect(ds?.vision).toBe(false);
    expect(ds?.label).not.toContain('多模态');
  });
});
