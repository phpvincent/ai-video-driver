import { describe, expect, it } from 'vitest';
import {
  createSubtitleDb,
  getSubtitle,
  listQaByVideo,
  saveQaRecord,
  saveSubtitle,
  type DbLike,
} from '../../../src/storage/db';
import { DB } from '../../../src/config';
import type { QaRecord, SubtitleRecord, VideoMeta } from '../../../src/types';

const meta: VideoMeta = {
  videoId: 'BV1X_p1',
  bvid: 'BV1X',
  page: 1,
  cid: 1,
  title: '测试分P',
  durationMs: 1000,
  url: 'about:blank',
};

const baseRec: SubtitleRecord = {
  videoId: 'BV1X_p1',
  meta,
  source: 'manual',
  lang: null,
  status: 'manual_pasted',
  cues: [{ index: 0, startMs: 0, endMs: 1000, text: '手动粘贴的第一句' }],
  fetchedAt: '1970-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// 内存 DbLike：自写最小 fake（约 20 行），记录 open 调用次数
// ---------------------------------------------------------------------------

class MemoryDbLike implements DbLike {
  readonly stores = new Map<string, Map<IDBValidKey, unknown>>();
  openCalls = 0;

  async open(): Promise<void> {
    this.openCalls++;
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return this.stores.get(store)?.get(key) as T | undefined;
  }

  async put(store: string, key: IDBValidKey, value: unknown): Promise<void> {
    if (!this.stores.has(store)) this.stores.set(store, new Map());
    this.stores.get(store)!.set(key, value);
  }

  async getAll<T>(store: string): Promise<T[]> {
    return [...(this.stores.get(store)?.values() ?? [])] as T[];
  }
}

// ---------------------------------------------------------------------------
// 最小 IDB factory fake：仅覆盖 db.ts 用到的 API 面（open/onupgradeneeded/
// transaction/get/put），事件在微任务中派发，与真实 IDB 异步语义一致
// ---------------------------------------------------------------------------

interface FakeReq {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

function makeRequest(settle: (req: FakeReq) => void): FakeReq {
  const req: FakeReq = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => {
    try {
      settle(req);
    } catch (err) {
      req.error = err instanceof Error ? err : new Error(String(err));
    }
    if (req.error !== null) req.onerror?.();
    else req.onsuccess?.();
  });
  return req;
}

function makeFakeFactory(): { factory: IDBFactory; openCount: () => number } {
  const stores = new Map<string, Map<IDBValidKey, unknown>>();
  let opened = 0;
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.set(name, new Map());
    },
    transaction: (_name: string) => ({
      objectStore: (storeName: string) => ({
        get: (key: IDBValidKey) =>
          makeRequest((req) => {
            req.result = stores.get(storeName)?.get(key);
          }),
        put: (value: unknown, key: IDBValidKey) =>
          makeRequest((req) => {
            const store = stores.get(storeName);
            if (store === undefined) throw new Error(`object store not found: ${storeName}`);
            store.set(key, value);
            req.result = key;
          }),
        getAll: () =>
          makeRequest((req) => {
            const store = stores.get(storeName);
            if (store === undefined) throw new Error(`object store not found: ${storeName}`);
            req.result = [...store.values()];
          }),
      }),
    }),
  };
  const factory = {
    open: (_name: string, _version?: number) => {
      opened++;
      return makeRequest((req) => {
        req.result = db;
        req.onupgradeneeded?.();
      });
    },
  };
  return { factory: factory as unknown as IDBFactory, openCount: () => opened };
}

// ---------------------------------------------------------------------------
// 高层 API（内存 DbLike 注入）
// ---------------------------------------------------------------------------

describe('getSubtitle / saveSubtitle（内存 DbLike 注入）', () => {
  it('未命中 → null', async () => {
    const db = new MemoryDbLike();
    expect(await getSubtitle(db, 'BV1X_p1')).toBeNull();
  });

  it('saveSubtitle 后 getSubtitle 命中，底层键 = videoId @ subtitles store，字段完整', async () => {
    const db = new MemoryDbLike();
    await saveSubtitle(db, baseRec, () => 1_700_000_000_000);
    const got = await getSubtitle(db, 'BV1X_p1');
    expect(got).not.toBeNull();
    expect(got).toMatchObject({
      videoId: 'BV1X_p1',
      status: 'manual_pasted',
      source: 'manual',
      lang: null,
      meta,
      cues: baseRec.cues,
    });
    // 底层存储位置：DB 常量 store 名 + videoId 键
    const raw = db.stores.get(DB.stores.subtitles)?.get('BV1X_p1');
    expect(raw).toEqual(got);
  });

  it('saveSubtitle 时钟注入 → fetchedAt 由 DB 层盖章为固定时间', async () => {
    const db = new MemoryDbLike();
    await saveSubtitle(db, baseRec, () => 1_700_000_000_000);
    const got = await getSubtitle(db, 'BV1X_p1');
    expect(got?.fetchedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('get/save 内部保证已 open（先调用 db.open）', async () => {
    const db = new MemoryDbLike();
    await getSubtitle(db, 'BV1X_p1');
    expect(db.openCalls).toBe(1);
    await saveSubtitle(db, baseRec);
    expect(db.openCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// createSubtitleDb（IDBFactory 注入）
// ---------------------------------------------------------------------------

describe('createSubtitleDb（注入 IDBFactory）', () => {
  it('open 幂等：open×2 + put + get×2 → factory.open 计数恒为 1', async () => {
    const { factory, openCount } = makeFakeFactory();
    const db = createSubtitleDb(factory);
    await db.open();
    await db.open();
    await db.put('subtitles', 'k1', { a: 1 });
    await db.get('subtitles', 'k1');
    await db.get('subtitles', 'k1');
    expect(openCount()).toBe(1);
  });

  it('put → get 往返，onupgradeneeded 自动建 store', async () => {
    const { factory } = makeFakeFactory();
    const db = createSubtitleDb(factory);
    await db.put('subtitles', 'k1', { a: 1 });
    expect(await db.get<{ a: number }>('subtitles', 'k1')).toEqual({ a: 1 });
    expect(await db.get('subtitles', 'missing')).toBeUndefined();
  });

  it('高层 API 走 createSubtitleDb：多操作后 factory.open 计数仍为 1，记录往返一致', async () => {
    const { factory, openCount } = makeFakeFactory();
    const db = createSubtitleDb(factory);
    await saveSubtitle(db, baseRec, () => 1_700_000_000_000);
    const got = await getSubtitle(db, 'BV1X_p1');
    expect(got).toMatchObject({ videoId: 'BV1X_p1', status: 'manual_pasted' });
    expect(openCount()).toBe(1);
  });

  it('createSubtitleDb 的 getAll：全量返回某 store 的全部记录', async () => {
    const { factory } = makeFakeFactory();
    const db = createSubtitleDb(factory);
    await db.put('qaHistory', 'id-1', { id: 'id-1' });
    await db.put('qaHistory', 'id-2', { id: 'id-2' });
    await db.put('qaHistory', 'id-1', { id: 'id-1', v: 2 });
    const all = await db.getAll<{ id: string; v?: number }>('qaHistory');
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === 'id-1')).toMatchObject({ v: 2 });
  });
});

// ---------------------------------------------------------------------------
// qaHistory（SPEC-05）
// ---------------------------------------------------------------------------

function qaRecord(overrides: Partial<QaRecord>): QaRecord {
  return {
    id: 'qa-1',
    videoId: 'BV1X_p1',
    interactionType: 'segment',
    sectionId: null,
    timestampMs: 60_000,
    rangeMs: [30_000, 90_000],
    question: '这段讲了什么',
    answer: '回答正文',
    payload: { answer: '回答正文' },
    createdAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('saveQaRecord / listQaByVideo（内存 DbLike 注入）', () => {
  it('保存后按 videoId 过滤返回，createdAt 升序', async () => {
    const db = new MemoryDbLike();
    await saveQaRecord(db, qaRecord({ id: 'b', createdAt: '2026-09-30T00:00:02.000Z' }));
    await saveQaRecord(db, qaRecord({ id: 'a', createdAt: '2026-09-30T00:00:01.000Z' }));
    const list = await listQaByVideo(db, 'BV1X_p1');
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    // 底层存储位置：qaHistory store + 键 id
    expect(db.stores.get(DB.stores.qaHistory)?.has('a')).toBe(true);
  });

  it('跨视频隔离：只返回目标 videoId 的记录', async () => {
    const db = new MemoryDbLike();
    await saveQaRecord(db, qaRecord({ id: 'x1', videoId: 'BV1X_p1' }));
    await saveQaRecord(db, qaRecord({ id: 'x2', videoId: 'BV1Y_p1' }));
    await saveQaRecord(db, qaRecord({ id: 'x3', videoId: 'BV1X_p1' }));
    const list = await listQaByVideo(db, 'BV1X_p1');
    expect(list.map((r) => r.id)).toEqual(['x1', 'x3']);
  });

  it('无记录返回空数组', async () => {
    const db = new MemoryDbLike();
    expect(await listQaByVideo(db, 'BV1X_p1')).toEqual([]);
  });

  it('记录字段完整透传（A4 聚合字段齐备）', async () => {
    const db = new MemoryDbLike();
    const rec = qaRecord({ sectionId: 'sec_0002', interactionType: 'term', rangeMs: null });
    await saveQaRecord(db, rec);
    const [got] = await listQaByVideo(db, rec.videoId);
    expect(got).toEqual(rec);
    expect(got.sectionId).toBe('sec_0002');
  });
});
