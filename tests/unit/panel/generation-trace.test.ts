import { describe, expect, it } from 'vitest';
import {
  generationBannerText,
  getGenerationSource,
  setGenerationSource,
} from '../../../src/panel/generationTrace';

describe('generationTrace 生成来源追踪', () => {
  it('model 来源 → 横幅显示模型名', () => {
    setGenerationSource('outline', { kind: 'model', model: 'qwen-vl-plus' });
    expect(generationBannerText(getGenerationSource('outline'))).toContain('qwen-vl-plus');
  });

  it('fallback 来源 → 横幅说明默认规则与原因', () => {
    setGenerationSource('mindmap', { kind: 'fallback', reason: '模型调用失败' });
    const text = generationBannerText(getGenerationSource('mindmap'));
    expect(text).toContain('默认规则');
    expect(text).toContain('模型调用失败');
  });

  it('未生成 → null（不渲染横幅）', () => {
    expect(generationBannerText(getGenerationSource('qa'))).toBeNull();
  });
});
