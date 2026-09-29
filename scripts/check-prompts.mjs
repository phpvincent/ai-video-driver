#!/usr/bin/env node
/**
 * SKILL.md → prompt 一致性检查（SPEC-01 子任务 1.3）。
 *
 * 扫描 .agents/skills 下各 skill 目录的 SKILL.md（目录不存在 → 直接 PASS）：
 * - 正文中引用的 src/prompts/*.md 路径必须存在；
 * - 「禁止」开头的关键约束短句必须出现在所引用的 prompt 文件中（本期简单实现）。
 *
 * 导出的 extractPromptRefs / checkSkill 为纯函数；命令行直接执行时才访问文件系统。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROMPT_REF_RE = /src\/prompts\/[\w.-]+\.md/g;
/** 本期简单实现：提取「禁止」开头的短句作为关键约束（行/句号/分号处截断） */
const CONSTRAINT_RE = /禁止[^\n。；;]{1,50}/g;

/** @param {string} content @returns {string[]} 去重后的 src/prompts/*.md 引用 */
export function extractPromptRefs(content) {
  return [...new Set(content.match(PROMPT_REF_RE) ?? [])];
}

/** @param {string} content @returns {string[]} 去重后的「禁止」短句 */
export function extractConstraints(content) {
  return [...new Set(content.match(CONSTRAINT_RE) ?? [])];
}

/**
 * 检查单个 SKILL.md。
 * @param {string} skillPath 展示用相对路径
 * @param {string} content SKILL.md 正文
 * @param {(ref: string) => string | null} loadPrompt 返回 prompt 文件内容；文件不存在返回 null
 * @returns {Array<{path: string, kind: string, detail: string}>}
 */
export function checkSkill(skillPath, content, loadPrompt) {
  const violations = [];
  const refs = extractPromptRefs(content);
  for (const ref of refs) {
    if (loadPrompt(ref) == null) {
      violations.push({ path: skillPath, kind: '引用的 prompt 文件不存在', detail: ref });
    }
  }
  if (refs.length > 0) {
    const prompts = refs.map((r) => loadPrompt(r)).filter((c) => typeof c === 'string');
    for (const constraint of extractConstraints(content)) {
      if (!prompts.some((p) => p.includes(constraint))) {
        violations.push({ path: skillPath, kind: '关键约束未出现在引用的 prompt 文件中', detail: constraint });
      }
    }
  }
  return violations;
}

// ---------- 命令行入口（仅直接执行时运行） ----------

function repoRoot() {
  return path.resolve(fileURLToPath(import.meta.url), '..', '..');
}

function report(name, violations) {
  if (violations.length === 0) {
    console.log(`PASS  ${name}`);
    return true;
  }
  console.log(`FAIL  ${name}`);
  for (const v of violations) console.log(`  ${v.path}: [${v.kind}] ${v.detail}`);
  return false;
}

export function main() {
  const root = repoRoot();
  const skillsDir = path.join(root, '.agents', 'skills');
  if (!fs.existsSync(skillsDir)) {
    console.log('PASS  prompts 检查（.agents/skills/ 不存在，无操作）');
    process.exit(0);
  }
  const violations = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const content = fs.readFileSync(skillMd, 'utf8');
    const rel = path.relative(root, skillMd).split(path.sep).join('/');
    violations.push(
      ...checkSkill(rel, content, (ref) => {
        const abs = path.join(root, ref);
        return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      }),
    );
  }
  const ok = report('prompts 检查（SKILL.md → src/prompts/*.md）', violations);
  process.exit(ok ? 0 : 1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
