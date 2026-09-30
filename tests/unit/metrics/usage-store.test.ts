/**
 * SPEC-07 usage store 单测：saveUsage / getUsage / listAllUsage（内存 DbLike fake）。
 */
import { describe, expect, it } from 'vitest';
import { getUsage, listAllUsage, saveUsage, type DbLike } from '../../../src/storage/db';
import { applyUsageEvent, createEmptyUsage } from '../../../src/core/metrics/usage';
import { DB } from '../../../src/config';

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

  async delete(store: string, key: IDBValidKey): Promise<void> {
    this.stores.get(store)?.delete(key);
  }
}

describe('usage store', () => {
  it('save + get：按 videoId 读写', async () => {
    const db = new MemoryDbLike();
    const rec = createEmptyUsage('BV1_p1', () => 1_700_000_000_000);
    await saveUsage(db, rec);
    const got = await getUsage(db, 'BV1_p1');
    expect(got).toEqual(rec);
    expect(db.stores.get(DB.stores.usage)?.has('BV1_p1')).toBe(true);
  });

  it('get 未命中返回 null', async () => {
    const db = new MemoryDbLike();
    expect(await getUsage(db, 'BV404_p1')).toBeNull();
  });

  it('save 覆盖同键（事件累积后写回）', async () => {
    const db = new MemoryDbLike();
    let rec = createEmptyUsage('BV1_p2', () => 1_700_000_000_000);
    await saveUsage(db, rec);
    rec = applyUsageEvent(rec, { kind: 'seek' }, () => 1_700_003_600_000);
    rec = applyUsageEvent(rec, { kind: 'subtitle' }, () => 1_700_003_600_001);
    await saveUsage(db, rec);
    const got = await getUsage(db, 'BV1_p2');
    expect(got?.seeks).toBe(1);
    expect(got?.subtitleLoaded).toBe(true);
  });

  it('listAll：返回全部记录', async () => {
    const db = new MemoryDbLike();
    await saveUsage(db, createEmptyUsage('BV1_p1', () => 0));
    await saveUsage(db, createEmptyUsage('BV2_p1', () => 0));
    const all = await listAllUsage(db);
    expect(all.map((r) => r.videoId).sort()).toEqual(['BV1_p1', 'BV2_p1']);
  });

  it('listAll 过滤脏数据（非 UsageRecord）', async () => {
    const db = new MemoryDbLike();
    await saveUsage(db, createEmptyUsage('BV1_p1', () => 0));
    await db.put(DB.stores.usage, 'garbage', { notAUsage: true });
    await db.put(DB.stores.usage, 'nullish', null);
    const all = await listAllUsage(db);
    expect(all).toHaveLength(1);
    expect(all[0].videoId).toBe('BV1_p1');
  });

  it('空库：listAll 返回空数组', async () => {
    expect(await listAllUsage(new MemoryDbLike())).toEqual([]);
  });
});
