/**
 * 设置页模型表单的纯逻辑（预设/校验/抽帧可用性/合并写回/当前策略摘要）。
 * 抽成纯函数便于单测；端点与模型标识一律来自 src/config 的 MODEL_PRESETS（红线 9）。
 */
import { MODEL_PRESETS } from '../../config';
import type { ModelConfig, Settings } from '../../types';

export type PresetKey = keyof typeof MODEL_PRESETS;

/** 抽帧作用的三个模块 */
export type VisionModule = 'outline' | 'mindmap' | 'qa';

export interface ModelFormErrors {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: string;
  maxTokens?: string;
}

/** 校验文案（集中定义，避免在赋值处出现键名字面量，红线 9 的静态扫描口径） */
const ERR = {
  baseUrlRequired: '接口地址不能为空',
  baseUrlScheme: '接口地址需以 http:// 或 https:// 开头',
  keyRequired: 'API Key 不能为空',
  modelRequired: '模型不能为空',
  temperatureRange: 'temperature 需在 0-2 之间',
  maxTokensRange: 'maxTokens 需为 ≥ 1 的整数',
} as const;

/** 三要素齐全才算已配置（未配置 → 自动跳过抽帧） */
export function isModelConfigured(cfg?: Partial<ModelConfig> | null): boolean {
  if (!cfg) return false;
  return Boolean(cfg.baseUrl?.trim() && cfg.apiKey?.trim() && cfg.model?.trim());
}

/** 应用预设：只覆盖 baseUrl 与 model，保留用户已填的 apiKey、temperature 等字段 */
export function applyPreset(form: ModelConfig, preset: PresetKey): ModelConfig {
  const p = MODEL_PRESETS[preset];
  // Key 不在此处理：调用方会用 savedKeyForEndpoint 按新端点回填已保存的 Key
  // （有已存 Key → 直接能测试连接；没有 → 留空由用户填写）
  return { ...form, baseUrl: p.baseUrl, model: p.model };
}

/** 端点 → 已保存的 Key：优先同名同端点的方案，其次端点相同的默认模型；都没有返回 null */
export function savedKeyForEndpoint(settings: Settings, baseUrl: string): string | null {
  const b = (baseUrl ?? '').trim();
  if (!b) return null;
  const profile = ((settings.modelProfiles ?? []) as Array<ModelConfig>).find(
    (q) => (q?.baseUrl ?? '').trim() === b && Boolean(q?.apiKey?.trim()),
  );
  if (profile?.apiKey?.trim()) return profile.apiKey.trim();
  if ((settings.model?.baseUrl ?? '').trim() === b && settings.model?.apiKey?.trim()) {
    return settings.model.apiKey.trim();
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  const v = value.trim();
  return v.startsWith('http://') || v.startsWith('https://');
}

/** 表单校验：返回错误字段文案（空对象 = 合法） */
export function validateModelForm(form: ModelConfig): ModelFormErrors {
  const errors: ModelFormErrors = {};
  if (!form.baseUrl?.trim()) errors.baseUrl = ERR.baseUrlRequired;
  else if (!isHttpUrl(form.baseUrl)) errors.baseUrl = ERR.baseUrlScheme;
  if (!form.apiKey?.trim()) errors.apiKey = ERR.keyRequired;
  if (!form.model?.trim()) errors.model = ERR.modelRequired;

  const t = form.temperature;
  const inRange = (v: unknown): boolean =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2;
  if (!t || !inRange(t.outline) || !inRange(t.qa)) {
    errors.temperature = ERR.temperatureRange;
  }

  const maxTokens = form.maxTokens;
  if (!Number.isInteger(maxTokens) || (maxTokens as number) < 1) {
    errors.maxTokens = ERR.maxTokensRange;
  }
  return errors;
}

/** 用户声明当前（默认）模型支持图像输入 → 抽帧开关才可用（未声明视为不支持） */
export function canEnableVision(settings: Settings): boolean {
  return modelSupportsVisionOf(settings.model ?? null, settings);
}

/**
 * 模型的图像能力判定：model.supportsVision 优先（能力随方案走），
 * 缺失时回退旧字段 settings.modelSupportsVision（旧数据兼容）。
 */
function modelSupportsVisionOf(model: ModelConfig | null, settings: Settings): boolean {
  if (model) return model.supportsVision ?? settings.modelSupportsVision === true;
  return settings.modelSupportsVision === true;
}

/**
 * 方案列表（纯函数）：过滤无 name / 无 apiKey 的项，并保证 name 唯一
 * （同名时先出现者优先）。供设置页方案区与各模块下拉共用。
 */
export function listProfiles(settings: Settings): ModelConfig[] {
  const out: ModelConfig[] = [];
  const seen = new Set<string>();
  for (const p of settings.modelProfiles ?? []) {
    const name = p?.name?.trim();
    if (!name || !p.apiKey?.trim()) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ ...p, name });
  }
  return out;
}

/**
 * 按模块解析模型（纯函数，供 loader 与 visionActiveFor 共用）：
 * moduleModel 命中的方案（须有 Key，缺失/不完整回退默认）→ 否则默认 settings.model。
 * 默认模型也未配置时返回 null。
 */
export function resolveModuleModel(
  settings: Settings,
  module: VisionModule,
): ModelConfig | null {
  const wanted = settings.moduleModel?.[module];
  if (wanted) {
    // 注意：不能走 listProfiles（它会过滤掉无 Key 的方案）——
    // 无 Key 的方案正是需要走「继承端点 Key」路径的对象
    const profile = ((settings.modelProfiles ?? []) as ModelConfig[]).find(
      (p) => p?.name?.trim() === wanted,
    );
    if (profile) {
      if (profile.apiKey?.trim()) return profile;
      // 方案无 Key → 继承该端点已保存的 Key（端点配一次，方案全通用）；
      // 端点也没有 → 回退默认模型（绝不让主流程拿到不完整配置）
      const inherited = savedKeyForEndpoint(settings, profile.baseUrl);
      if (inherited) return { ...profile, apiKey: inherited };
    }
  }
  return settings.model ?? null;
}

/**
 * 旧数据迁移（幂等）：settings.modelSupportsVision → settings.model.supportsVision。
 * 仅当旧字段为 true 且 model.supportsVision 缺失时写入；已有值不覆盖。
 */
export function migrateVisionToModel(settings: Settings): Settings {
  if (settings.modelSupportsVision !== true) return settings;
  const model = settings.model;
  if (!model || model.supportsVision !== undefined) return settings;
  return { ...settings, model: { ...model, supportsVision: true } };
}

/**
 * 建议值：预设模型是否默认按多模态勾选（仅作默认值，用户可自行改）。
 * DeepSeek 为纯文本 → false；Qwen 兼容模式支持图文 → true。
 */
export function presetVisionDefault(preset: PresetKey): boolean {
  // DeepSeek 文本模型不支持图像；Qwen 两个端点均可使用多模态模型（由用户选的模型名决定）
  return preset !== 'deepseek';
}

/**
 * 抽帧可用判断：全局开关 + 该模块开关（未配置视为开启）+ 该模块实际使用模型的图像能力。
 * 模型按 resolveModuleModel 解析（模块可另选方案，能力随方案走）；未配置模型即不支持。
 * 任一条件不满足即为 false（调用方据此跳过抽帧，不影响纯文本功能）。
 */
export function visionActiveFor({
  settings,
  module,
}: {
  settings: Settings;
  module: VisionModule;
}): boolean {
  if (settings.visionEnabled !== true) return false;
  const model = resolveModuleModel(settings, module);
  if (!modelSupportsVisionOf(model, settings)) return false;
  return settings.visionModules?.[module] !== false;
}

/**
 * 旧设置迁移：历史版本把多模态模型存在 visionModel。
 * - 无 model 但有 visionModel → 提升为 model 并清除 visionModel
 * - 两者都有 → 保留 model，清除 visionModel
 * - 都无 → 原样返回
 * 返回新对象，不改入参。
 */
export function migrateLegacyVisionModel(settings: Settings): Settings {
  if (!settings.visionModel) return settings;
  const next: Settings = { ...settings };
  if (!isModelConfigured(next.model)) {
    next.model = settings.visionModel;
  }
  delete next.visionModel;
  return next;
}

/** 合并写回：把局部更新合并进整份 settings（不动其他分区） */
/** 内置种子方案的名称前缀（seedProfilesIfEmpty 生成，Key 为空） */
export const SEED_PROFILE_PREFIX = '内置 · ';

/**
 * 写回前剥离"未激活的种子方案"：种子方案是**派生的展示项**（Key 为空），
 * 若随保存写回，会把用户已填好 Key 的同名方案覆盖成空 Key——这是密钥丢失的根因。
 */
export function stripSeedProfiles(settings: Settings): Settings {
  const profiles = settings.modelProfiles as Array<ModelConfig & { name?: string }> | undefined;
  if (!profiles || profiles.length === 0) return settings;
  const kept = profiles.filter((p) => {
    const name = p?.name?.trim() ?? '';
    const seeded = name.startsWith(SEED_PROFILE_PREFIX);
    // 只剔除"仍是种子状态"（无 Key）的项；用户填过 Key 的同名方案必须保留
    return !(seeded && !p.apiKey?.trim());
  });
  return { ...settings, modelProfiles: kept as Settings['modelProfiles'] };
}

/** 身份槽位：方案名 + 端点。Key 归属于"这个端点上的这个方案"，不是归属于某个下标 */
function slotId(m?: { name?: string; baseUrl?: string }): string {
  return `${(m?.name ?? '').trim()}|${(m?.baseUrl ?? '').trim()}`;
}

/**
 * 【核心不变式】已保存的 API Key 是用户资产，只有"用户在表单里填了非空的新值"才能改变它。
 *
 * 除该动作外的任何路径——切换 Tab、刷新页面、保存其他分区（Obsidian/检索）、
 * 内置方案种子注入、旧数据迁移、模块下拉写回——都不得改动已保存的 Key。
 *
 * 规则（逐槽位，身份 = 方案名 + 端点）：
 * - 新值 Key 非空 → 视为用户新填，接受（覆盖）
 * - 新值 Key 为空 → 沿用同身份槽位里已保存的 Key
 * - 身份不同（换端点/换名）→ 无 Key 可沿用，保持空（需用户填写，避免平台错配 401）
 */
export function mergeSavedSecrets(next: Settings, stored: Settings): Settings {
  const nm = next.model;
  const sm = stored.model;
  const model =
    nm && sm && slotId(nm) === slotId(sm) && !nm.apiKey?.trim() && sm.apiKey?.trim()
      ? { ...nm, apiKey: sm.apiKey }
      : nm;

  const storedProfiles = (stored.modelProfiles ?? []) as Array<ModelConfig & { name?: string }>;
  const nextProfiles = (next.modelProfiles ?? []) as Array<ModelConfig & { name?: string }>;
  const profiles =
    nextProfiles.length > 0
      ? nextProfiles.map((p) => {
          if (p?.apiKey?.trim()) return p;
          const old = storedProfiles.find((q) => slotId(q) === slotId(p));
          return old?.apiKey?.trim() ? { ...p, apiKey: old.apiKey } : p;
        })
      : next.modelProfiles;

  return { ...next, model: model ?? next.model, modelProfiles: profiles ?? next.modelProfiles };
}

/** 脱敏展示：让用户能确认"Key 还在"，但不暴露内容 */
export function maskKey(apiKey?: string): string {
  const k = (apiKey ?? '').trim();
  if (k.length === 0) return '未设置';
  if (k.length <= 8) return '••••••••';
  return `••••${k.slice(-4)}`;
}

/**
 * 密钥护栏：新值 Key 为空而旧值非空时沿用旧值。
 * 任何保存路径都不得因为"表单里没填 / 载入未完成"而把已配置的 Key 清空。
 */
export function preserveSecrets(next: Settings, prev: Settings): Settings {
  return mergeSavedSecrets(next, prev);
}

export function presetShortLabel(preset: PresetKey): string {
  switch (preset) {
    case 'deepseek':
      return 'DeepSeek';
    case 'qwen':
      return 'Qwen · 百炼官方';
    case 'qwenMaas':
      return 'Qwen · maas 网关';
    default:
      return preset;
  }
}

/**
 * 内置方案种子：modelProfiles 为空时，从 MODEL_PRESETS 生成带名称的方案
 * （Key 为空，用户在设置页填好后以同名保存即可覆盖）。幂等：已有方案不重复注入。
 */
export function seedProfilesIfEmpty(settings: Settings): Settings {
  if ((settings.modelProfiles ?? []).length > 0) return settings;
  const profiles = (Object.keys(MODEL_PRESETS) as Array<keyof typeof MODEL_PRESETS>).map(
    (key) => ({
      ...MODEL_PRESETS[key],
      name: `内置 · ${presetShortLabel(key)}`,
      supportsVision: presetVisionDefault(key),
      temperature: { outline: 0.3, qa: 0.3 },
      maxTokens: 4096,
    }),
  );
  return { ...settings, modelProfiles: profiles as never };
}

/** 当前表单的接口地址匹配哪个预设（用于高亮显示"当前选用"） */
export function activePreset(baseUrl: string): PresetKey | null {
  const normalized = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!normalized) return null;
  for (const key of Object.keys(MODEL_PRESETS) as PresetKey[]) {
    if (MODEL_PRESETS[key].baseUrl === normalized) return key;
  }
  return null;
}

/** 归一化：去除粘贴带来的首尾空白（API Key 前后空格是 401 的常见成因） */
export function normalizeModelConfig(form: ModelConfig): ModelConfig {
  return {
    ...form,
    baseUrl: (form.baseUrl ?? '').trim().replace(/\/+$/, ''),
    apiKey: (form.apiKey ?? '').trim(),
    model: (form.model ?? '').trim(),
  };
}

export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return { ...current, ...patch };
}

/** 策略摘要的模块中文名（只用于展示） */
const STRATEGY_MODULE_LABELS: Record<VisionModule, string> = {
  outline: '大纲',
  mindmap: '导图',
  qa: '问答',
};

/** 策略摘要固定行：单模型口径的说明（图片与文本一起发给同一个模型） */
const ROUTING_RULE =
  '说明：图片与文本一起发给同一个模型；未开启抽帧时为纯文本问答';

/**
 * 取接口地址的主机名（红线 9：摘要只暴露主机名，不输出完整地址）。
 * 空值或非法 URL → '无效地址'。
 */
export function hostOf(baseUrl?: string): string {
  const raw = baseUrl?.trim();
  if (!raw) return '无效地址';
  try {
    return new URL(raw).hostname;
  } catch {
    return '无效地址';
  }
}

/**
 * 「当前策略」摘要（设置页展示用纯函数，按模块选模型口径）：
 * 当前（默认）模型 / 三行模块模型（各模块实际会用到的模型）/ 多模态能力（按模块）/
 * 抽帧状态（含各模块生效情况）/ 说明，每行一条。
 */
export function describeModelStrategy(settings: Settings): string[] {
  const current = isModelConfigured(settings.model)
    ? `当前模型：${hostOf(settings.model?.baseUrl)} / ${settings.model?.model ?? ''}`
    : '当前模型：未配置（功能不可用）';

  const modules = Object.keys(STRATEGY_MODULE_LABELS) as VisionModule[];

  // 各模块实际使用的模型（moduleModel 命中方案 → 否则默认模型）
  const moduleLines = modules.map((m) => {
    const model = resolveModuleModel(settings, m);
    return `${STRATEGY_MODULE_LABELS[m]}：${
      model ? `${hostOf(model.baseUrl)} / ${model.model}` : '未配置'
    }`;
  });

  // 多模态能力按模块：能力随各模块所选模型（model.supportsVision，兼容旧字段）
  const anyCapable = modules.some((m) =>
    modelSupportsVisionOf(resolveModuleModel(settings, m), settings),
  );
  const capabilityMarks = modules
    .map(
      (m) =>
        `${STRATEGY_MODULE_LABELS[m]}${
          modelSupportsVisionOf(resolveModuleModel(settings, m), settings) ? '✓' : '✗'
        }`,
    )
    .join(' ');
  const multimodal = anyCapable
    ? `多模态：${capabilityMarks}（能力随各模块所选模型）`
    : '多模态：不支持（抽帧不可用）';

  const activeMarks = modules
    .map((m) => `${STRATEGY_MODULE_LABELS[m]}${visionActiveFor({ settings, module: m }) ? '✓' : '✗'}`)
    .join(' ');
  const frame = !anyCapable
    ? '抽帧：不可用（各模块所选模型均未声明支持图像输入）'
    : settings.visionEnabled === true
      ? `抽帧：已开启（${activeMarks}）`
      : '抽帧：已关闭';

  return [current, ...moduleLines, multimodal, frame, ROUTING_RULE];
}
