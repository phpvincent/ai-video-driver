/**
 * 抽帧客户端（父 agent 接线）：panel → background → content 请求关键帧。
 *
 * 只在用户开启"结合画面"且配置了视觉模型时由 loader 调用；任何失败（content
 * 未就绪 / videoId 不符 / 抽帧异常）都降级为空数组，主流程不受影响（红线 8 精神）。
 */
import { VISION } from '../config';
import { MSG } from '../messages';
import type { CapturedFrame } from '../messages';
import { chatCompletion } from '../core/harness/modelClient';
import { getFramePlanSystemPrompt } from '../prompts';
import {
  cueWindows,
  dedupeFrames,
  planFrameTargets,
  sectionMetaOf,
  sectionWindows,
} from '../core/vision/framePlanner';
import { requestFramePlan } from '../core/vision/llmFramePlan';
import { resolveModuleModel } from './settings/modelForm';
import type { Cue, ModelConfig, Section } from '../types';

export interface FrameRequestOptions {
  videoId: string;
  /** 目标时间点（毫秒），由调用方按模块预算决定数量 */
  targetsMs: number[];
}

export interface FramePlanArgs {
  videoId: string;
  module: 'outline' | 'mindmap' | 'qa';
  cues: Cue[];
  sections: Section[];
  /** 视频总时长（毫秒） */
  durationMs: number;
  budget: number;
}

/**
 * 统一抽帧规划：**模型优先，公式回退**。
 *
 * 1. 模型可用（已配置且能返回合法时间点）→ 用它判断"抽哪几帧最能还原内容完整性"
 * 2. 模型未配置 / 调用失败 / 输出不合法 → 回退确定性公式规划（framePlanner）
 * 3. 两者都给不出结果 → 空数组（不抽帧，不浪费 token）
 *
 * 模型只负责"看什么"，最终时间点仍由代码吸附到真实字幕时刻并做间隔/预算裁剪。
 */
export async function planFrames(args: FramePlanArgs): Promise<number[]> {
  const { cues, sections, budget } = args;
  if (cues.length === 0 || budget <= 0) return [];

  const model = (await readModuleModel(args.module)) ?? null;
  const req = {
    sections,
    cues,
    durationMs: args.durationMs,
    budget,
    minGapMs: VISION.minGapMs,
  };

  // ① 模型规划（可选）
  if (model?.apiKey) {
    const modelTargets = await requestFramePlan(
      req,
      ({ systemPrompt, userPrompt }) =>
        chatCompletion({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          model: model.model,
          temperature: model.temperature.outline,
          maxTokens: Math.min(model.maxTokens, 1024),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          responseFormatJson: true,
          // 规划任务禁用思考：只要时间点，思考会吃掉输出预算
          thinking: { type: 'disabled' },
        }).then((res) => ({ content: res.content })),
      getFramePlanSystemPrompt,
    ).catch(() => null);
    if (modelTargets && modelTargets.length > 0) return modelTargets;
  }

  // ② 公式回退：有章节按章节打分，无章节按固定窗口（大纲生成阶段）
  const windows =
    sections.length > 0 ? sectionWindows(sections, cues) : cueWindows(cues, Math.max(60_000, Math.ceil(args.durationMs / 8)));
  return planFrameTargets(windows, cues, {
    budget,
    minGapMs: VISION.minGapMs,
    minScore: VISION.minScore,
  }, sections.length > 0 ? sectionMetaOf(sections) : undefined).map((w) => w.targetMs);
}

/** 读取模块模型（与 loader 同一解析口径） */
async function readModuleModel(module: 'outline' | 'mindmap' | 'qa'): Promise<ModelConfig | null> {
  try {
    const settings = (await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS })) as {
      model?: ModelConfig;
    } | null;
    return resolveModuleModel((settings ?? {}) as never, module);
  } catch {
    return null;
  }
}

/** 向 content 请求关键帧；失败返回空数组 */
export async function requestFrames(args: FrameRequestOptions): Promise<CapturedFrame[]> {
  if (args.targetsMs.length === 0) return [];
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MSG.CAPTURE_FRAMES,
      payload: { videoId: args.videoId, targetsMs: args.targetsMs },
    })) as { frames?: CapturedFrame[] } | null;
    const rawFrames = Array.isArray(response?.frames) ? (response?.frames as CapturedFrame[]) : [];
    // 结构感知抽帧第二道闸门：时间过近且画面几乎未变（同一页 PPT）的帧丢弃
    return dedupeFrames(rawFrames, { minGapMs: VISION.minGapMs });
  } catch {
    return [];
  }
}

/** 帧 → pipeline 图像入参（时间点写入 timeMs，供提示词生成"第 mm:ss 的画面"） */
export function toPipelineImage(frame: CapturedFrame): {
  dataBase64: string;
  mime: string;
  timeMs: number;
} {
  return { dataBase64: frame.dataBase64, mime: 'image/jpeg', timeMs: frame.actualMs };
}
