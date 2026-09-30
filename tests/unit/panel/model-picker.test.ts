/**
 * ModelPicker 单测（与设置页模型配置同源）：
 * buildPickerOptions 纯函数（固定两个内置预设 + hasKey/vision 标记）+
 * currentPresetOf（按 baseUrl 反推当前预设）+ renderToString 冒烟
 * （不触发 effect，chrome 未 mock 也能渲染）。
 * 端点与模型标识一律从 src/config 的 MODEL_PRESETS 读取（红线 9）。
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODEL_PRESETS } from '../../../src/config';
import {
  ModelPicker,
  PICKER_MISSING_KEY_HINT,
  buildPickerOptions,
  currentPresetOf,
} from '../../../src/panel/ModelPicker';
import type { ModelConfig, Settings } from '../../../src/types';

function cfg(baseUrl: string, apiKey: string, model: string): ModelConfig {
  return {
    baseUrl,
    apiKey,
    model,
    temperature: { outline: DEFAULT_MODEL.temperature.outline, qa: DEFAULT_MODEL.temperature.qa },
    maxTokens: DEFAULT_MODEL.maxTokens,
    outlineTokenBudget: DEFAULT_MODEL.outlineTokenBudget,
  };
}

/** 构造带槽位的 settings（两个预设各一份） */
function slotsOf(deepseekKey: string, qwenKey: string): Settings {
  return {
    model: cfg(MODEL_PRESETS.deepseek.baseUrl, deepseekKey, MODEL_PRESETS.deepseek.model),
    modelSlots: {
      deepseek: cfg(MODEL_PRESETS.deepseek.baseUrl, deepseekKey, MODEL_PRESETS.deepseek.model),
      qwen: cfg(MODEL_PRESETS.qwen.baseUrl, qwenKey, MODEL_PRESETS.qwen.model),
    },
  };
}

describe('buildPickerOptions', () => {
  it('固定两个内置预设，顺序与 MODEL_PRESETS 一致', () => {
    const options = buildPickerOptions({});
    expect(options.map((o) => o.value)).toEqual(['deepseek', 'qwen']);
    expect(options.map((o) => o.label)).toEqual(['DeepSeek', 'Qwen · 多模态']);
  });

  it('hasKey 取各预设槽位自己的 Key（互不干扰）', () => {
    const options = buildPickerOptions(slotsOf('sk-ds', ''));
    expect(options[0].hasKey).toBe(true);
    expect(options[1].hasKey).toBe(false);
  });

  it('两个预设都配了 Key → 都可用（修复"配了 A 平台 B 的 Key 就没了"）', () => {
    const options = buildPickerOptions(slotsOf('sk-ds', 'sk-qw'));
    expect(options.every((o) => o.hasKey)).toBe(true);
  });

  it('多模态预设 vision=true 且 label 带后缀；文本预设不带', () => {
    const options = buildPickerOptions(slotsOf('k', 'k'));
    const qwen = options.find((o) => o.value === 'qwen');
    const ds = options.find((o) => o.value === 'deepseek');
    expect(qwen?.vision).toBe(true);
    expect(qwen?.label).toContain('多模态');
    expect(ds?.vision).toBe(false);
    expect(ds?.label).not.toContain('多模态');
  });

  it('自定义端点不影响选项（选项只由 MODEL_PRESETS 决定）', () => {
    const withCustom = buildPickerOptions({
      ...slotsOf('k', 'k'),
      model: cfg('https://my-gateway.example/v1', 'k', 'my-model'),
    });
    expect(withCustom.map((o) => o.value)).toEqual(['deepseek', 'qwen']);
  });
});

describe('currentPresetOf', () => {
  it('按 baseUrl 反推当前预设', () => {
    expect(currentPresetOf(slotsOf('k', ''))).toBe('deepseek');
    expect(
      currentPresetOf({
        model: cfg(MODEL_PRESETS.qwen.baseUrl, 'k', MODEL_PRESETS.qwen.model),
        modelSlots: slotsOf('k', 'k').modelSlots,
      }),
    ).toBe('qwen');
  });

  it('自定义端点 / 未配置 → null', () => {
    expect(currentPresetOf({ model: cfg('https://my-gateway.example/v1', 'k', 'm') })).toBeNull();
    expect(currentPresetOf({})).toBeNull();
  });
});

describe('ModelPicker renderToString 冒烟', () => {
  it('初始渲染：一行「模型：」+ 下拉（无 chrome 环境不抛错）', () => {
    const html = renderToString(createElement(ModelPicker, {}));
    expect(html).toContain('模型：');
    expect(html).toContain('model-picker-select');
  });

  it('缺 Key 提示文案常量导出（供 UI 与测试共用）', () => {
    expect(PICKER_MISSING_KEY_HINT).toBe('未配置 API Key');
  });
});
