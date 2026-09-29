#!/usr/bin/env node
/**
 * 红线 9 / 10 静态检查（SPEC-01 子任务 1.3）。
 *
 * R9  禁止硬编码：src/（.ts/.tsx）与 scripts/（.mjs）不得出现受管控端点、
 *     疑似密钥、apiKey 字面量赋值（src/config/ 与本脚本自身除外）。
 * R10 content script 禁入 API key 与模型调用：src/content/ 非注释代码行不得
 *     出现模型配置/密钥相关标识，也不得 import config（types/messages 契约允许）。
 *
 * 导出的 scanR9 / scanR10 为纯函数（vitest 直接 import，用内存样例驱动）；
 * 命令行直接执行时扫描真实仓库，并以子进程方式汇总执行 check-prompts.mjs。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * 受管控端点域名片段（提取自 src/config/index.ts 的 BILI_ENDPOINTS / DEFAULT_MODEL / OBSIDIAN）。
 * 宪法红线 9：本脚本只允许写域名片段，不得写完整 URL。
 */
const MANAGED_ENDPOINT_FRAGMENTS = [
  'api.bilibili.com', // BILI_ENDPOINTS.*
  'api.deepseek.com', // DEFAULT_MODEL.baseUrl
  '127.0.0.1:27124', // OBSIDIAN.baseUrl（host:port 片段）
];

const KEY_LIKE_RE = /sk-[A-Za-z0-9]{16,}/;
const KEY_ASSIGN_RE = /apiKey\s*[=:]\s*['"][^'"]+['"]/;

const R10_FORBIDDEN_RE = /ModelConfig|apiKey|baseUrl|deepseek|harness/i;
// 禁止 content import 完整 config（含模型端点与默认值）；唯一例外：./config/shared（纯通用阈值，父 agent 维护）
const R10_CONFIG_IMPORT_RE = /from\s+['"].*\/config(\/index)?['"]/;

const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs)$/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** R9 扫描范围：src/ 下 .ts/.tsx、scripts/ 下 .mjs；排除 src/config/** 与本脚本自身（其合法携带域名片段常量） */
function inR9Scope(relPath) {
  const p = toPosix(relPath);
  if (p.startsWith('src/config/')) return false;
  if (p.endsWith('check-redlines.mjs')) return false;
  if (p.startsWith('src/') && /\.(ts|tsx)$/.test(p)) return true;
  if (p.startsWith('scripts/') && /\.mjs$/.test(p)) return true;
  return false;
}

/** R10 扫描范围：src/content/ 下代码文件 */
function inR10Scope(relPath) {
  return toPosix(relPath).startsWith('src/content/') && CODE_EXT_RE.test(relPath);
}

/**
 * 规则 R9：禁止硬编码受管控端点与密钥。
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{rule: string, path: string, line: number, kind: string, content: string}>}
 */
export function scanR9(files) {
  const violations = [];
  for (const { path: filePath, content } of files) {
    if (!inR9Scope(filePath)) continue;
    content.split('\n').forEach((line, i) => {
      if (MANAGED_ENDPOINT_FRAGMENTS.some((f) => line.includes(f))) {
        violations.push({ rule: 'R9', path: filePath, line: i + 1, kind: '受管控端点硬编码', content: line.trim() });
      }
      if (KEY_LIKE_RE.test(line)) {
        violations.push({ rule: 'R9', path: filePath, line: i + 1, kind: '疑似密钥（sk-…）', content: line.trim() });
      }
      if (KEY_ASSIGN_RE.test(line)) {
        violations.push({ rule: 'R9', path: filePath, line: i + 1, kind: 'apiKey 字面量赋值', content: line.trim() });
      }
    });
  }
  return violations;
}

/** 行首去除空白后以 //、/*、* 开头视为注释行（R10 跳过） */
function isComment(line) {
  const s = line.trim();
  return s.startsWith('//') || s.startsWith('/*') || s.startsWith('*');
}

/**
 * 规则 R10：API key 与模型调用禁入 content script（src/content/**）。
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{rule: string, path: string, line: number, kind: string, content: string}>}
 */
export function scanR10(files) {
  const violations = [];
  for (const { path: filePath, content } of files) {
    if (!inR10Scope(filePath)) continue;
    content.split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      const code = line.trim();
      if (!code) return;
      if (R10_FORBIDDEN_RE.test(code)) {
        violations.push({ rule: 'R10', path: filePath, line: i + 1, kind: 'content 出现模型配置/密钥相关标识', content: code });
      } else if (R10_CONFIG_IMPORT_RE.test(code)) {
        violations.push({ rule: 'R10', path: filePath, line: i + 1, kind: 'content import 了 config', content: code });
      }
    });
  }
  return violations;
}

// ---------- 命令行入口（仅直接执行时运行） ----------

function repoRoot() {
  return path.resolve(fileURLToPath(import.meta.url), '..', '..');
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function readFiles(root, dir) {
  return walkFiles(path.join(root, dir)).map((abs) => ({
    path: toPosix(path.relative(root, abs)),
    content: fs.readFileSync(abs, 'utf8'),
  }));
}

function report(name, violations) {
  if (violations.length === 0) {
    console.log(`PASS  ${name}`);
    return true;
  }
  console.log(`FAIL  ${name}`);
  for (const v of violations) console.log(`  ${v.path}:${v.line}: [${v.kind}] ${v.content}`);
  return false;
}

export function main() {
  const root = repoRoot();
  const r9Ok = report('R9 禁止硬编码（受管控端点/密钥）', scanR9(readFiles(root, 'src').concat(readFiles(root, 'scripts'))));
  const r10Ok = report('R10 content 禁入 API key 与模型调用', scanR10(readFiles(root, 'src/content')));

  let promptsOk = true;
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'check-prompts.mjs')], {
      stdio: 'inherit',
      cwd: root,
    });
  } catch {
    promptsOk = false;
    console.log('FAIL  check-prompts 子进程退出非零');
  }
  if (promptsOk) console.log('PASS  check-prompts（子进程）');

  console.log('redlines 1-8: pending (tests come with SPEC-02/03)');
  process.exit(r9Ok && r10Ok && promptsOk ? 0 : 1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
