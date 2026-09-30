/**
 * 侧边栏根组件：顶部视频信息栏 + 四 Tab（字幕 / 大纲 / 导图 / 问答）+ 设置入口。
 * 消息接线：挂载时发 CURRENT_VIDEO_GET；监听 VIDEO_CHANGED / PLAYBACK_CHANGED 更新状态。
 */
import { useEffect, useState } from 'react';
import { MSG, type PlaybackPayload, type RuntimeMessage, type VideoInfoPayload } from '../messages';
import type { FetchResult, ModelConfig, VideoMeta } from '../types';
import { ChatTab } from './ChatTab';
import { MindmapTab } from './MindmapTab';
import { OutlineTab } from './OutlineTab';
import { generateOutline, loadOutlineCached, regenerateOne } from './outlineLoader';
import { SettingsPage } from './settings/SettingsPage';
import { SubtitleTab } from './SubtitleTab';
import { currentVideoIdRef, explain as explainFn } from './explainLoader';
import { generateConceptMap as genConceptMap, getConceptMapCached, termIndexFallback } from './mindmapLoader';
import type { ConceptMapData } from '../types';
import type { Section } from '../types';
import { loadSubtitles as runWaterfall, loadSubtitlesManual } from './subtitleLoader';

type TabKey = 'subtitle' | 'outline' | 'mindmap' | 'chat';

/** 全屏模式：panel.html?view=xxx 单视图渲染（无 Tab 栏） */
function parseStandaloneView(): TabKey | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    return (STANDALONE_VIEWS as readonly string[]).includes(v ?? '') ? (v as TabKey) : null;
  } catch {
    return null;
  }
}

const STANDALONE_VIEWS: readonly TabKey[] = ['subtitle', 'outline', 'mindmap', 'chat'];

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
  /** 全屏单视图模式（panel.html?view=xxx）；null=普通侧栏模式 */
  const [standaloneView] = useState<TabKey | null>(parseStandaloneView);
  const effectiveTab: TabKey = standaloneView ?? tab;
  const [showSettings, setShowSettings] = useState(false);
  /** 手动粘贴版本号：递增触发 SubtitleTab 重载（key 变化） */
  const [pasteVersion, setPasteVersion] = useState(0);
  /** 大纲章节（OutlineTab 通知；导图/问答消费） */
  const [sections, setSections] = useState<Section[]>([]);
  /** 划词待解释术语（SubtitleTab → ChatTab 联动） */
  const [pendingTerm, setPendingTerm] = useState<{ term: string; consumed: () => void } | null>(null);
  /** 概念知识图（缓存/生成产物；null=未生成，组件会降级本地术语图） */
  const [conceptMap, setConceptMap] = useState<ConceptMapData | null>(null);
  const [conceptGenerating, setConceptGenerating] = useState(false);
  /** 概念图是否为降级产物（模型生成失败回退本地术语图时为 true） */
  const [conceptDegraded, setConceptDegraded] = useState(false);
  /** 设置中的模型配置（modelReady 判断用；生成时 loadOutlineForVideo 会实时重读） */
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);

  /** chrome.runtime.sendMessage 的安全包装：上下文失效时静默返回 null */
  const sendRuntimeMessage = (message: unknown): Promise<unknown> => {
    try {
      return chrome.runtime.sendMessage(message);
    } catch {
      return Promise.resolve(null);
    }
  };

  /** 拉取设置中的模型配置（挂载时与设置页关闭后刷新 modelReady） */
  const refreshModelConfig = () => {
    sendRuntimeMessage({ type: MSG.GET_SETTINGS })
      .then((response: unknown) => {
        const stored = (response ?? {}) as { model?: ModelConfig };
        setModelConfig(stored.model ?? null);
      })
      .catch(() => {
        // background 未就绪时保持空配置（modelReady=false）
      });
  };

  useEffect(() => {
    currentVideoIdRef.value = video?.videoId ?? null;
    setSections([]);
    setPendingTerm(null);
    setConceptMap(null);
  }, [video?.videoId]);

  /** 概念图缓存回填（模型就绪且 videoId 存在时） */
  useEffect(() => {
    const vid = video?.videoId;
    if (!vid || !modelConfig?.apiKey) return;
    let cancelled = false;
    getConceptMapCached(vid, modelConfig)
      .then((data) => {
        if (!cancelled) {
          setConceptMap(data);
          setConceptDegraded(false);
        }
      })
      .catch(() => {
        if (!cancelled) setConceptMap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [video?.videoId, modelConfig?.apiKey]);

  useEffect(() => {
    refreshModelConfig();
  }, []);

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

  /** 提问自动暂停（ChatTab 调用）：panel -> background -> content */
  const handlePause = () => {
    if (!video) return;
    try {
      void chrome.runtime
        .sendMessage({ type: MSG.PAUSE, payload: { videoId: video.videoId } })
        .catch(() => {});
    } catch {
      /* 静默 */
    }
  };

  /** 一键全屏：当前视图在新标签页全窗口打开（Chrome 不允许扩展改侧栏宽度，此为替代） */
  const handleOpenFullscreen = () => {
    try {
      void chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?view=${effectiveTab}`) });
    } catch {
      /* 静默 */
    }
  };

  /** 生成概念知识图；失败降级为本地术语关联图（零成本兜底） */
  const handleGenerateConceptMap = async (secs: Section[], title: string) => {
    setConceptGenerating(true);
    setConceptDegraded(false);
    try {
      const data = await genConceptMap(video?.videoId ?? '', secs, title);
      setConceptMap(data);
    } catch {
      setConceptMap(termIndexFallback(secs));
      setConceptDegraded(true);
    } finally {
      setConceptGenerating(false);
    }
  };

  /** 划词联动：字幕 Tab 选中术语 → 切问答 Tab 自动解释 */
  const handleExplainTerm = (term: string) => {
    setPendingTerm({ term, consumed: () => setPendingTerm(null) });
    setTab('chat');
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
              <button
                type="button"
                className="btn fullscreen-btn"
                title={standaloneView ? '关闭全屏标签页' : '全屏打开当前视图'}
                onClick={standaloneView ? () => window.close() : handleOpenFullscreen}
              >
                {standaloneView ? '退出全屏' : '全屏'}
              </button>
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
        <SettingsPage
          onClose={() => {
            setShowSettings(false);
            // 保存后返回需刷新 modelReady
            refreshModelConfig();
          }}
        />
      ) : (
        <>
{!standaloneView && (
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
          )}
          <main className="tab-body">
            {effectiveTab === 'subtitle' && (
              <SubtitleTab
                key={`${video?.videoId ?? 'none'}-${pasteVersion}`}
                videoId={video?.videoId ?? null}
                meta={meta}
                positionMs={playback?.positionMs ?? 0}
                onRequestSeek={handleRequestSeek}
                loadSubtitles={handleLoadSubtitles}
                onManualPaste={handleManualPaste}
                onExplainTerm={handleExplainTerm}
              />
            )}
            {effectiveTab === 'outline' && (
              <OutlineTab
                videoId={video?.videoId ?? null}
                meta={meta}
                positionMs={playback?.positionMs ?? 0}
                onRequestSeek={handleRequestSeek}
                loadOutlineCached={loadOutlineCached}
                generateOutline={generateOutline}
                regenerateOne={regenerateOne}
                modelReady={!!modelConfig?.apiKey}
                onSectionsChanged={setSections}
                onOpenSettings={() => setShowSettings(true)}
              />
            )}
            {effectiveTab === 'mindmap' && (
              <MindmapTab
                sections={sections}
                videoTitle={video?.title ?? ''}
                positionMs={playback?.positionMs ?? 0}
                onRequestSeek={handleRequestSeek}
                modelReady={!!modelConfig?.apiKey}
                onOpenSettings={() => setShowSettings(true)}
                generateConceptMap={handleGenerateConceptMap}
                conceptMap={conceptMap}
                degraded={conceptDegraded}
                generating={conceptGenerating}
                onGoOutline={() => setTab('outline')}
              />
            )}
            {effectiveTab === 'chat' && (
              <ChatTab
                videoId={video?.videoId ?? null}
                sections={sections}
                positionMs={playback?.positionMs ?? 0}
                onRequestSeek={handleRequestSeek}
                onPause={handlePause}
                modelReady={!!modelConfig?.apiKey}
                onOpenSettings={() => setShowSettings(true)}
                explain={explainFn}
                pendingTerm={pendingTerm ?? undefined}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
