/**
 * 三入口构建（SPEC-01 子任务 1.1）：
 * - background：ES module Service Worker → dist/background.js
 * - panel：ES module + HTML，入口为仓库根 panel.html → dist/panel.html + dist/panel.js
 * - content：IIFE 单文件（content script 不能使用 ES module）→ dist/content.js
 *
 * Rollup 不支持多入口 IIFE，故 content 由 closeBundle 钩子以编程 API 二次构建，
 * `npm run build` / `npm run dev` 仍为单命令。
 * manifest.json 由子任务 1.4 负责，本期不写。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const r = (p: string) => resolve(rootDir, p);

/** content script 二次构建：IIFE 单文件；不清空 dist（保留主构建产物） */
async function buildContentScript(): Promise<void> {
  await build({
    configFile: false,
    root: rootDir,
    logLevel: 'warn',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      target: 'esnext',
      minify: false,
      rollupOptions: {
        input: { content: r('src/content/bilibili.ts') },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
        },
      },
    },
  });
}

/** 主构建（background + panel）收尾后触发 content 的 IIFE 构建 */
function contentScriptPlugin(): Plugin {
  return {
    name: 'vsc:content-script-iife',
    apply: 'build',
    closeBundle() {
      return buildContentScript();
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), contentScriptPlugin()],
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: false,
    rollupOptions: {
      input: {
        background: r('src/background/index.ts'),
        panel: r('panel.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
