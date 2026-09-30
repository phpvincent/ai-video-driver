/**
 * routeBackgroundMessage 纯函数路由单测（无 chrome.* 依赖，mock ctx）。
 * 消息类型一律经 src/messages.ts 的 MSG 常量构造。
 */
import { describe, expect, it } from 'vitest';
import { routeBackgroundMessage, type RouteContext } from '../../src/background/index';
import { MSG, type PlaybackPayload, type RuntimeMessage, type SeekPayload, type VideoInfoPayload } from '../../src/messages';

const TAB_ID = 7;

const video: VideoInfoPayload = {
  videoId: 'BV1YG7G6eEPR_p2',
  bvid: 'BV1YG7G6eEPR',
  page: 2,
  title: 'Agent 基本概念',
  durationMs: 1922000,
};

const otherVideo: VideoInfoPayload = {
  videoId: 'BV1YG7G6eEPR_p3',
  bvid: 'BV1YG7G6eEPR',
  page: 3,
  title: 'Agent 进阶',
  durationMs: 1800000,
};

/** 默认 mock ctx：映射存在（tab 7 → video），panel 视角活跃 tab 即 tab 7 */
function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    senderTabId: TAB_ID,
    getActiveTabVideo: () => video,
    getLastVideo: () => video,
    getVideoByTabId: () => video,
    getTabIdByVideoId: () => TAB_ID,
    ...overrides,
  };
}

const kinds = (actions: { kind: string }[]) => actions.map((a) => a.kind);

describe('routeBackgroundMessage', () => {
  it('VIDEO_DETECTED：store + enableSidePanel + forward(VIDEO_CHANGED)（per-tab 启用是禁用残留的唯一重启用时机）', () => {
    const actions = routeBackgroundMessage({ type: MSG.VIDEO_DETECTED, payload: video }, makeCtx());
    expect(kinds(actions)).toEqual(['storeVideo', 'enableSidePanel', 'forwardToPanel']);
    expect(actions[0]).toMatchObject({ tabId: TAB_ID, payload: video });
    expect(actions[1]).toEqual({ kind: 'enableSidePanel', tabId: TAB_ID });
    expect(actions[2]).toEqual({
      kind: 'forwardToPanel',
      message: { type: MSG.VIDEO_CHANGED, payload: video },
    });
  });

  it('VIDEO_DETECTED 但 sender 无 tab（非 content 来源）：ignore', () => {
    const actions = routeBackgroundMessage(
      { type: MSG.VIDEO_DETECTED, payload: video },
      makeCtx({ senderTabId: null }),
    );
    expect(kinds(actions)).toEqual(['ignore']);
  });

  it('VIDEO_LEFT：clear + forward(VIDEO_CHANGED, null)；不禁用侧边栏（per-tab 禁用会残留导致 open 失败）', () => {
    const actions = routeBackgroundMessage(
      { type: MSG.VIDEO_LEFT, payload: { videoId: video.videoId } },
      makeCtx(),
    );
    expect(kinds(actions)).toEqual(['clearVideo', 'forwardToPanel']);
    expect(actions[0]).toEqual({ kind: 'clearVideo', tabId: TAB_ID });
    expect(actions[1]).toEqual({
      kind: 'forwardToPanel',
      message: { type: MSG.VIDEO_CHANGED, payload: null },
    });
  });

  it('VIDEO_LEFT 但映射已更新（SPA 快速切换的过期消息）：ignore', () => {
    const actions = routeBackgroundMessage(
      { type: MSG.VIDEO_LEFT, payload: { videoId: video.videoId } },
      makeCtx({ getVideoByTabId: () => otherVideo }),
    );
    expect(kinds(actions)).toEqual(['ignore']);
  });

  it('PLAYBACK_PROGRESS：仅 forward(PLAYBACK_CHANGED，payload 原样)', () => {
    const playback: PlaybackPayload = {
      videoId: video.videoId,
      positionMs: 61_000,
      playing: true,
    };
    const actions = routeBackgroundMessage({ type: MSG.PLAYBACK_PROGRESS, payload: playback }, makeCtx());
    expect(kinds(actions)).toEqual(['forwardToPanel']);
    expect(actions[0]).toEqual({
      kind: 'forwardToPanel',
      message: { type: MSG.PLAYBACK_CHANGED, payload: playback },
    });
  });

  it('SEEK：按 videoId 反查 tabId，forwardToTab 转发原消息给 content', () => {
    const seek: SeekPayload = { videoId: video.videoId, targetMs: 300_000 };
    const actions = routeBackgroundMessage({ type: MSG.SEEK, payload: seek }, makeCtx());
    expect(kinds(actions)).toEqual(['forwardToTab']);
    expect(actions[0]).toEqual({
      kind: 'forwardToTab',
      tabId: TAB_ID,
      message: { type: MSG.SEEK, payload: seek },
    });
  });

  it('SEEK 映射缺失：ignore', () => {
    const seek: SeekPayload = { videoId: 'BVunknown_p1', targetMs: 0 };
    const actions = routeBackgroundMessage(
      { type: MSG.SEEK, payload: seek },
      makeCtx({ getTabIdByVideoId: () => null }),
    );
    expect(kinds(actions)).toEqual(['ignore']);
  });

  it('PAUSE / RESUME：与 SEEK 同路径，forwardToTab', () => {
    const pause: RuntimeMessage = { type: MSG.PAUSE, payload: { videoId: video.videoId } };
    const resume: RuntimeMessage = { type: MSG.RESUME, payload: { videoId: video.videoId } };
    expect(kinds(routeBackgroundMessage(pause, makeCtx()))).toEqual(['forwardToTab']);
    expect(kinds(routeBackgroundMessage(resume, makeCtx()))).toEqual(['forwardToTab']);
  });

  it('CURRENT_VIDEO_GET：respond 活跃 tab 的 VideoInfoPayload', () => {
    const actions = routeBackgroundMessage({ type: MSG.CURRENT_VIDEO_GET }, makeCtx({ senderTabId: null }));
    expect(actions).toEqual([{ kind: 'respond', response: video }]);
  });

  it('CURRENT_VIDEO_GET 但活跃 tab 无视频：respond null', () => {
    const actions = routeBackgroundMessage(
      { type: MSG.CURRENT_VIDEO_GET },
      makeCtx({ senderTabId: null, getActiveTabVideo: () => null }),
    );
    expect(actions).toEqual([{ kind: 'respond', response: null }]);
  });

  it('GET_SETTINGS / SET_SETTINGS', () => {
    expect(routeBackgroundMessage({ type: MSG.GET_SETTINGS }, makeCtx())).toEqual([{ kind: 'readSettings' }]);
    const settings = { model: 'deepseek-chat' };
    expect(routeBackgroundMessage({ type: MSG.SET_SETTINGS, payload: settings }, makeCtx())).toEqual([
      { kind: 'writeSettings', settings },
    ]);
  });

  it('background 自身发出的消息（VIDEO_CHANGED / PLAYBACK_CHANGED）：ignore', () => {
    expect(kinds(routeBackgroundMessage({ type: MSG.VIDEO_CHANGED, payload: null }, makeCtx()))).toEqual(['ignore']);
    expect(
      kinds(
        routeBackgroundMessage(
          { type: MSG.PLAYBACK_CHANGED, payload: { videoId: video.videoId, positionMs: 0, playing: false } },
          makeCtx(),
        ),
      ),
    ).toEqual(['ignore']);
  });
});
