/**
 * 侧边栏根组件：顶部视频信息栏 + 四 Tab（字幕 / 大纲 / 导图 / 问答）+ 设置入口。
 * 消息接线：挂载时发 CURRENT_VIDEO_GET；监听 VIDEO_CHANGED / PLAYBACK_CHANGED 更新状态。
 */
import { useEffect, useState } from 'react';
import { MSG, type PlaybackPayload, type RuntimeMessage, type VideoInfoPayload } from '../messages';
import type { FetchResult, VideoMeta } from '../types';
import { ChatTab } from './ChatTab';
import { MindmapTab } from './MindmapTab';
import { OutlineTab } from './OutlineTab';
import { SettingsPage } from './settings/SettingsPage';
import { SubtitleTab } from './SubtitleTab';
import { loadSubtitles as runWaterfall, loadSubtitlesManual } from './subtitleLoader';

type TabKey = 'subtitle' | 'outline' | 'mindmap' | 'chat';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'subtitle', label: '字幕' },
  { key: 'outline', label: '大纲' },
  { key: 'mindmap', label: '导图' },
  { key: 'chat', label: '问答' },
];

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}



export function App() {
  const [video, setVideo] = useState<VideoInfoPayload | null>(null);
  const [playback, setPlayback] = useState<PlaybackPayload | null>(null);
  const [tab, setTab] = useState<TabKey>('subtitle');
  const [showSettings, setShowSettings] = useState(false);
  /** 手动粘贴版本号：递增触发 SubtitleTab 重载（key 变化） */
  const [pasteVersion, setPasteVersion] = useState(0);

  useEffect(() => {
    // 打开侧边栏时拉取当前 tab 的视频信息
    try {
      void chrome.runtime
        .sendMessage({ type: MSG.CURRENT_VIDEO_GET })
        .then((response: unknown) => {
          setVideo((response as VideoInfoPayload | null | undefined) ?? null);
        })
        .catch(() => {
          // background 未就绪时静默，等 VIDEO_CHANGED 推送
        });
    } catch {
      // 扩展上下文异常时静默
    }

    const listener = (message: RuntimeMessage) => {
      if (message.type === MSG.VIDEO_CHANGED) {
        setVideo(message.payload);
        setPlayback(null);
      } else if (message.type === MSG.PLAYBACK_CHANGED) {
        setPlayback(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  /** 字幕 Tab 点句跳播：panel -> background -> content */
  const handleRequestSeek = (targetMs: number) => {
    if (!video) return;
    try {
      void chrome.runtime
        .sendMessage({ type: MSG.SEEK, payload: { videoId: video.videoId, targetMs } })
        .catch(() => {
          // content/background 未就绪时静默
        });
    } catch {
      // 扩展上下文异常时静默
    }
  };

  // TODO(接线)：cid/url 待 background 视频信息补全，字幕 Tab 当前仅消费 title/duration
  const meta: VideoMeta | null = video ? { ...video, cid: 0, url: '' } : null;

  /** 字幕加载：经瀑布（缓存 → B 站一级通道；红线 8 保证不抛） */
  const handleLoadSubtitles = (videoId: string): Promise<FetchResult> =>
    meta
      ? runWaterfall(videoId, meta)
      : Promise.resolve({ cues: [], status: 'no_subtitle', error: '无视频元信息' });

  /** 手动粘贴解析：走瀑布手动直达通道并落缓存，成功后递增版本号触发重载 */
  const handleManualPaste = (text: string) => {
    if (!meta) return;
    void loadSubtitlesManual(meta.videoId, meta, text)
      .then(() => setPasteVersion((v) => v + 1))
      .catch(() => {
        /* 红线 8：瀑布不抛；此处兜底 */
      });
  };

  return (
    <div className="app">
      <header className="info-bar">
        {video ? (
          <>
            <div className="info-title" title={video.title}>
              {video.title}
            </div>
            <div className="info-meta">
              <span className="info-video-id">{video.videoId}</span>
              <span>时长 {formatDuration(video.durationMs)}</span>
              {playback && (
                <span>
                  {formatDuration(playback.positionMs)} · {playback.playing ? '播放中' : '已暂停'}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="info-empty">未检测到 B 站视频</div>
        )}
      </header>

      {showSettings ? (
        <SettingsPage onClose={() => setShowSettings(false)} />
      ) : (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? 'tab active' : 'tab'}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className="tab settings-btn"
              onClick={() => setShowSettings(true)}
            >
              设置
            </button>
          </nav>
          <main className="tab-body">
            {tab === 'subtitle' && (
              <SubtitleTab
                key={`${video?.videoId ?? 'none'}-${pasteVersion}`}
                videoId={video?.videoId ?? null}
                meta={meta}
                positionMs={playback?.positionMs ?? 0}
                onRequestSeek={handleRequestSeek}
                loadSubtitles={handleLoadSubtitles}
                onManualPaste={handleManualPaste}
              />
            )}
            {tab === 'outline' && <OutlineTab />}
            {tab === 'mindmap' && <MindmapTab />}
            {tab === 'chat' && <ChatTab />}
          </main>
        </>
      )}
    </div>
  );
}
