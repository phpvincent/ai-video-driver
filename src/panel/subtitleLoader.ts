/**
 * 字幕瀑布接线层（SPEC-02 2.3/2.4 由父 agent 接线）。
 * 组装真实依赖：fetchBiliSubtitles（B 站通道）+ createSubtitleDb（IndexedDB）+
 * runSubtitleWaterfall（编排）。panel 侧唯一字幕数据入口。
 */
import { fetchBiliSubtitles } from '../providers/bilibili';
import { runSubtitleWaterfall } from '../providers/waterfall';
import { createSubtitleDb, getSubtitle, saveSubtitle } from '../storage/db';
import type { FetchResult, VideoMeta } from '../types';

/** 模块级单例 DB（惰性 open 由 db 层内部保证幂等） */
const db = createSubtitleDb();

export function loadSubtitles(videoId: string, meta: VideoMeta): Promise<FetchResult> {
  return runSubtitleWaterfall(
    {
      videoId,
      bvid: meta.bvid,
      page: meta.page,
      meta,
    },
    {
      fetchBili: ({ bvid, page }) => fetchBiliSubtitles({ bvid, page }),
      getSubtitle: (vid) => getSubtitle(db, vid),
      saveSubtitle: (rec) => saveSubtitle(db, rec),
    },
  );
}

/** 手动粘贴：复用瀑布的手动直达通道（成功结果由瀑布落缓存） */
export function loadSubtitlesManual(
  videoId: string,
  meta: VideoMeta,
  manualText: string,
): Promise<FetchResult> {
  return runSubtitleWaterfall(
    {
      videoId,
      bvid: meta.bvid,
      page: meta.page,
      meta,
      manualText,
    },
    {
      fetchBili: ({ bvid, page }) => fetchBiliSubtitles({ bvid, page }),
      getSubtitle: (vid) => getSubtitle(db, vid),
      saveSubtitle: (rec) => saveSubtitle(db, rec),
    },
  );
}
