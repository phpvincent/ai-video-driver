/**
 * 抽帧客户端（父 agent 接线）：panel → background → content 请求关键帧。
 *
 * 只在用户开启"结合画面"且配置了视觉模型时由 loader 调用；任何失败（content
 * 未就绪 / videoId 不符 / 抽帧异常）都降级为空数组，主流程不受影响（红线 8 精神）。
 */
import { MSG } from '../messages';
import type { CapturedFrame } from '../messages';

export interface FrameRequestOptions {
  videoId: string;
  /** 目标时间点（毫秒），由调用方按模块预算决定数量 */
  targetsMs: number[];
}

/** 向 content 请求关键帧；失败返回空数组 */
export async function requestFrames(args: FrameRequestOptions): Promise<CapturedFrame[]> {
  if (args.targetsMs.length === 0) return [];
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MSG.CAPTURE_FRAMES,
      payload: { videoId: args.videoId, targetsMs: args.targetsMs },
    })) as { frames?: CapturedFrame[] } | null;
    return Array.isArray(response?.frames) ? (response?.frames as CapturedFrame[]) : [];
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
