/**
 * 关键帧抽取（视觉问答的内容侧实现）：定位 <video> 到目标时间 → 画到 canvas → JPEG base64。
 *
 * 用户洞察：视频的画面 / 页面才是精华，要和字幕一起喂给模型。本模块只负责"取帧"，
 * 不做任何模型调用（红线 10：content script 禁入模型配置 / 密钥 / 模型调用模块）。
 *
 * 纯函数（computeCanvasSize / toBase64）可脱离浏览器测试；drawToDataUrl 可注入，
 * 单测用假 video + 假绘制函数驱动，无需 jsdom。
 */
import { MSG, type CapturedFrame, type RuntimeMessage } from '../messages';
import type { VideoId } from '../types';

/** 默认最长边像素 */
const DEFAULT_MAX_SIZE = 512;
/** 默认 JPEG 质量 */
const DEFAULT_QUALITY = 0.7;
/** 默认单帧 seek 超时 */
const DEFAULT_TIMEOUT_MS = 3_000;
/** 默认最多抽帧数（红线 3：图像不额外膨胀文本预算，帧数硬上限） */
const DEFAULT_MAX_FRAMES = 6;
/** 画布尺寸下限：防退化（0 宽 / 极端宽高比抽帧得到空白图） */
const MIN_CANVAS_SIZE = 16;

export interface FrameCaptureOptions {
  /** 最长边像素，默认 512 */
  maxSize?: number;
  /** JPEG 质量，默认 0.7 */
  quality?: number;
  /** 单帧超时（毫秒），默认 3000 */
  timeoutMs?: number;
}

/**
 * 最小 video 接口（便于单测用假对象）：只取抽帧必需的字段与 seeked 监听。
 */
export interface HTMLVideoElementLike {
  currentTime: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  paused: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** 绘制到 canvas 并转 dataURL（浏览器默认实现走 document；单测注入假实现） */
export type DrawToDataUrl = (
  video: HTMLVideoElementLike,
  width: number,
  height: number,
  quality: number,
) => string;

/** 内部扩展选项：drawToDataUrl 仅用于注入，不属对外契约 */
interface CaptureRuntimeOptions extends FrameCaptureOptions {
  drawToDataUrl?: DrawToDataUrl;
}

/**
 * 按视频原始宽高算缩放后的画布尺寸：保持比例，最长边 ≤ maxSize，最小 16。
 * 极端宽高比缩到最长边后仍有边 < 16 时，该边兜底补到 16（比例让步于非退化）。
 */
export function computeCanvasSize(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  const limit = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : DEFAULT_MAX_SIZE;
  const w0 = Number.isFinite(width) && width > 0 ? width : 0;
  const h0 = Number.isFinite(height) && height > 0 ? height : 0;
  if (w0 === 0 || h0 === 0) {
    return { width: MIN_CANVAS_SIZE, height: MIN_CANVAS_SIZE };
  }
  let w = w0;
  let h = h0;
  // 源本身过小（<16）：按较小边补到 16，保持比例
  if (Math.min(w, h) < MIN_CANVAS_SIZE) {
    const f = MIN_CANVAS_SIZE / Math.min(w, h);
    w = Math.round(w * f);
    h = Math.round(h * f);
  }
  const longest = Math.max(w, h);
  if (longest > limit) {
    const f = limit / longest;
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
  }
  if (w < MIN_CANVAS_SIZE) w = MIN_CANVAS_SIZE;
  if (h < MIN_CANVAS_SIZE) h = MIN_CANVAS_SIZE;
  return { width: w, height: h };
}

/** dataURL → base64 部分（去掉 `data:image/...;base64,` 前缀）；空 / 非法 → '' */
export function toBase64(dataUrl: string): string {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return '';
  const marker = ';base64,';
  const idx = dataUrl.indexOf(marker);
  if (idx >= 0) return dataUrl.slice(idx + marker.length);
  // 带 data: 但缺 base64 段 → 非法
  if (dataUrl.startsWith('data:')) return '';
  // 已是裸 base64（无前缀）→ 原样返回；其余视为非法
  return /^[A-Za-z0-9+/=\s]+$/.test(dataUrl) ? dataUrl : '';
}

/** 浏览器默认绘制：canvas 缩放绘制 + JPEG 导出 */
function defaultDrawToDataUrl(
  video: HTMLVideoElementLike,
  width: number,
  height: number,
  quality: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context 不可用');
  ctx.drawImage(video as unknown as CanvasImageSource, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 定位到 seconds 并等待 seeked；超时 / 无监听能力时立即返回（超时仍尝试抽帧）。
 */
function seekTo(video: HTMLVideoElementLike, seconds: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (video.removeEventListener && listener) video.removeEventListener('seeked', listener);
      resolve();
    };
    const listener = () => done();
    if (video.addEventListener) video.addEventListener('seeked', listener);
    try {
      video.currentTime = seconds;
    } catch {
      done();
      return;
    }
    if (!video.addEventListener) {
      done();
      return;
    }
    if (timeoutMs > 0) {
      setTimeout(done, timeoutMs);
    } else {
      done();
    }
  });
}

/**
 * 抽单帧：seek → 画到 canvas → JPEG base64。
 * 任何异常一律 throw（由调用方决定降级：丢该帧）。
 */
export async function captureFrameAt(
  video: HTMLVideoElementLike,
  targetMs: number,
  opts: CaptureRuntimeOptions = {},
): Promise<CapturedFrame> {
  const maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const draw = opts.drawToDataUrl ?? defaultDrawToDataUrl;

  const seconds = Number.isFinite(targetMs) ? targetMs / 1000 : 0;
  await seekTo(video, seconds, timeoutMs);
  const { width, height } = computeCanvasSize(video.videoWidth, video.videoHeight, maxSize);
  const dataUrl = draw(video, width, height, quality);
  return {
    targetMs,
    actualMs: Math.round((Number.isFinite(video.currentTime) ? video.currentTime : 0) * 1000),
    dataBase64: toBase64(dataUrl),
  };
}

/**
 * 批量抽帧：取前 maxFrames（默认 6）个目标；单帧失败跳过继续（不整体失败）。
 */
export async function captureFrames(
  video: HTMLVideoElementLike,
  targetsMs: number[],
  opts: CaptureRuntimeOptions & { maxFrames?: number } = {},
): Promise<CapturedFrame[]> {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  const targets = Array.isArray(targetsMs) ? targetsMs.slice(0, Math.max(0, maxFrames)) : [];
  const frames: CapturedFrame[] = [];
  for (const targetMs of targets) {
    try {
      frames.push(await captureFrameAt(video, targetMs, opts));
    } catch {
      // 单帧失败（seek 失败 / canvas 被污染 / 编码失败）跳过该帧
    }
  }
  return frames;
}

/**
 * 注册 CAPTURE_FRAMES 消息监听（panel → background → content）。
 * 校验 videoId 与当前一致；无 video / 不一致 / 抛错 → 回 { frames: [] }（不 throw）。
 */
export function registerFrameCaptureHandler(
  getVideoId: () => VideoId | null,
  getVideo: () => HTMLVideoElementLike | null,
): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as RuntimeMessage;
    if (msg.type !== MSG.CAPTURE_FRAMES) return;
    void (async () => {
      const video = getVideo();
      const videoId = getVideoId();
      const payload = msg.payload;
      if (!video || (videoId !== null && payload?.videoId !== videoId)) {
        sendResponse({ frames: [] });
        return;
      }
      try {
        const frames = await captureFrames(video, payload?.targetsMs ?? [], {
          maxSize: payload?.maxSize,
        });
        sendResponse({ frames });
      } catch {
        sendResponse({ frames: [] });
      }
    })();
    return true;
  });
}
