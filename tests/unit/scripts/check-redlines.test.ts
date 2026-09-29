// @ts-expect-error scripts/*.mjs 为无类型声明的 Node ESM 脚本，tsc 无对应 .d.mts
import { scanR9, scanR10 } from '../../../scripts/check-redlines.mjs';
import { describe, expect, it } from 'vitest';

/** 内存样例驱动，不依赖真实仓库文件 */
const sample = (path: string, content: string) => ({ path, content });

describe('scanR9（红线 9：禁止硬编码）', () => {
  it('src 代码出现受管控端点 URL → 违规（文件:行号）', () => {
    const v = scanR9([sample('src/core/fetch.ts', "const url = 'https://api.bilibili.com/x/foo';\n")]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('R9');
    expect(v[0].path).toBe('src/core/fetch.ts');
    expect(v[0].line).toBe(1);
  });

  it('scripts 代码出现模型端点 / Obsidian 本地端点 → 违规', () => {
    const v = scanR9([
      sample('scripts/foo.mjs', "fetch('https://api.deepseek.com/chat');\n"),
      sample('src/export/obsidian.ts', "const base = 'http://127.0.0.1:27124';\n"),
    ]);
    expect(v).toHaveLength(2);
  });

  it('apiKey = "sk-…" 字面量 → 违规（疑似密钥 + 字面量赋值）', () => {
    const v = scanR9([sample('src/core/model.ts', 'const apiKey = "sk-abc123def456ghi789";\n')]);
    expect(v.length).toBe(2);
    expect(v.some((x: { kind: string }) => x.kind.includes('疑似密钥'))).toBe(true);
    expect(v.some((x: { kind: string }) => x.kind.includes('字面量赋值'))).toBe(true);
  });

  it('类型声明 apiKey: string; → 不违规', () => {
    const v = scanR9([sample('src/types.ts', 'export interface ModelConfig {\n  apiKey: string;\n}\n')]);
    expect(v).toHaveLength(0);
  });

  it('src/config/index.ts 内容 → 不违规（路径排除）', () => {
    const v = scanR9([
      sample('src/config/index.ts', "export const view = 'https://api.bilibili.com/x/web-interface/view';\n"),
    ]);
    expect(v).toHaveLength(0);
  });

  it('check-redlines.mjs 自身携带域名片段常量 → 不违规', () => {
    const v = scanR9([sample('scripts/check-redlines.mjs', "const F = ['api.bilibili.com'];\n")]);
    expect(v).toHaveLength(0);
  });

  it('范围外扩展名（.md/.json）不扫描', () => {
    const v = scanR9([sample('src/core/notes.md', 'https://api.bilibili.com/x\n')]);
    expect(v).toHaveLength(0);
  });
});

describe('scanR10（红线 10：API key 与模型调用禁入 content）', () => {
  it("import { ModelConfig } → 违规", () => {
    const v = scanR10([sample('src/content/bilibili.ts', "import { ModelConfig } from '../types';\n")]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('R10');
    expect(v[0].line).toBe(1);
  });

  it('注释行含 apiKey → 不违规', () => {
    const v = scanR10([sample('src/content/bilibili.ts', '// 禁止 apiKey（注释）\n')]);
    expect(v).toHaveLength(0);
  });

  it('块注释行（* 开头）→ 不违规', () => {
    const v = scanR10([sample('src/content/player.ts', ' * 红线 10：本文件禁止 import 模型配置 / API key\n')]);
    expect(v).toHaveLength(0);
  });

  it("import type 契约类型 → 不违规", () => {
    const v = scanR10([sample('src/content/bilibili.ts', "import type { VideoId } from '../types';\n")]);
    expect(v).toHaveLength(0);
  });

  it("import config → 违规", () => {
    const v = scanR10([sample('src/content/bilibili.ts', "import { DEFAULT_MODEL } from '../config';\n")]);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain('config');
  });

  it("import config/shared（通用阈值层）→ 不违规", () => {
    const v = scanR10([sample('src/content/bilibili.ts', "import { PLAYBACK } from '../config/shared';\n")]);
    expect(v).toHaveLength(0);
  });

  it('src/content/ 之外（如 panel）不受 R10 约束', () => {
    const v = scanR10([sample('src/panel/settings.tsx', "import { ModelConfig } from '../types';\n")]);
    expect(v).toHaveLength(0);
  });
});
