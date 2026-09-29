/**
 * 消息协议契约 —— 仅父 agent 可修改（CONSTITUTION §4）。
 * content ↔ background ↔ panel 三方通信的唯一消息形状。
 */

import type { VideoId } from './types';

export const MSG = {
  /** content -> background：检测到 / SPA 切换到某视频 */
  VIDEO_DETECTED: 'video/detected',
  /** content -> background：离开视频页 */
  VIDEO_LEFT: 'video/left',
  /** content -> background：播放进度（节流 500ms） */
  PLAYBACK_PROGRESS: 'playback/progress',
  /** background -> panel：当前 tab 的视频变化 */
  VIDEO_CHANGED: 'video/changed',
  /** background -> panel：播放进度变化 */
  PLAYBACK_CHANGED: 'playback/changed',
  /** panel -> background -> content：跳播 */
  SEEK: 'player/seek',
  /** panel -> background -> content：暂停（提问自动暂停用） */
  PAUSE: 'player/pause',
  /** panel -> background -> content：恢复播放 */
  RESUME: 'player/resume',
  /** panel <-> background：设置读写 */
  GET_SETTINGS: 'settings/get',
  SET_SETTINGS: 'settings/set',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export interface VideoInfoPayload {
  videoId: VideoId;
  bvid: string;
  page: number;
  /** 分 P 标题 */
  title: string;
  durationMs: number;
}

export interface PlaybackPayload {
  videoId: VideoId;
  positionMs: number;
  playing: boolean;
}

export interface SeekPayload {
  videoId: VideoId;
  targetMs: number;
}

export interface VideoIdPayload {
  videoId: VideoId;
}

export type RuntimeMessage =
  | { type: typeof MSG.VIDEO_DETECTED; payload: VideoInfoPayload }
  | { type: typeof MSG.VIDEO_LEFT; payload: VideoIdPayload }
  | { type: typeof MSG.PLAYBACK_PROGRESS; payload: PlaybackPayload }
  | { type: typeof MSG.VIDEO_CHANGED; payload: VideoInfoPayload | null }
  | { type: typeof MSG.PLAYBACK_CHANGED; payload: PlaybackPayload }
  | { type: typeof MSG.SEEK; payload: SeekPayload }
  | { type: typeof MSG.PAUSE; payload: VideoIdPayload }
  | { type: typeof MSG.RESUME; payload: VideoIdPayload }
  | { type: typeof MSG.GET_SETTINGS }
  | { type: typeof MSG.SET_SETTINGS; payload: Record<string, unknown> };
