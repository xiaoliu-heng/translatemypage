import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/core/scheduler';
import { TranslationCache } from '../src/core/storage';
import { AppError } from '../src/shared/protocol';
import { account, deferred, params, cacheDisk, until } from './helpers';
test('identical requests coalesce across pages; cancelling one subscription preserves another and cache survives restart', async () => {
  const disk = cacheDisk(), cache = new TranslationCache(disk); await cache.init();
  const gate = deferred<Map<string, string>>(); let calls = 0, signal: AbortSignal | undefined;
  const events: any[] = [];
  const auth = { epoch: 1, active: account, mark: async () => {} };
  const provider = { translate: async (_p: any, s: AbortSignal) => { calls++; signal = s; return gate.promise; } };
  const scheduler = new Scheduler(auth, provider, cache, (event, data, jobId) => events.push({ event, data, jobId }));
  try {
    const a = await scheduler.submit(params('a', 'id-a')), b = await scheduler.submit(params('b', 'id-b'));
    await until(() => calls === 1); scheduler.cancel(a.jobId);
    assert.equal(signal!.aborted, false); gate.resolve(new Map([['id-a', '你好世界。']]));
    await until(() => events.some(e => e.event === 'jobCompleted' && e.jobId === b.jobId));
    assert.equal(calls, 1);
    assert.equal(events.filter(e => e.jobId === a.jobId && e.event === 'batchCompleted').length, 0);
    assert.equal(events.find(e => e.jobId === b.jobId && e.event === 'batchCompleted').data.segment.id, 'id-b');
    const restored = new TranslationCache(disk); await restored.init();
    const next = new Scheduler(auth, { translate: async () => { throw new Error('cache miss'); } }, restored, (event, data) => events.push({ event, data, cachedTest: true }));
    await next.submit(params('c', 'id-c')); await until(() => events.some(e => e.cachedTest && e.event === 'jobCompleted'));
    assert.equal(events.find(e => e.cachedTest && e.event === 'batchCompleted').data.cached, true);
  } finally { scheduler.cancelAll(); }
});
test('interrupted or invalid inference never pollutes cache', async () => {
  const disk = cacheDisk(), cache = new TranslationCache(disk); await cache.init(); let calls = 0;
  const events: any[] = [];
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async () => { calls++; throw new AppError('interrupted', 'unknown'); } }, cache, (e, d) => events.push([e, d]));
  try {
    await scheduler.submit(params()); await until(() => events.filter(e => e[0] === 'failed').length === 1);
    await scheduler.submit(params()); await until(() => events.filter(e => e[0] === 'failed').length === 2); assert.equal(calls, 2);
  } finally { scheduler.cancelAll(); }
});
test('quota failure pauses remaining queue until explicit resume', async () => {
  const disk = cacheDisk(), cache = new TranslationCache(disk); await cache.init(); const events: string[] = []; let calls = 0;
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async p => {
    if (++calls === 1) throw new AppError('limited', 'limited'); return new Map(p.segments.map(s => [s.id, '译文']));
  } }, cache, e => events.push(e));
  try {
    await scheduler.submit(params('a', 'a', 'first')); await scheduler.submit(params('b', 'b', 'second'));
    await until(() => events.includes('failed')); await new Promise(r => setTimeout(r, 30)); assert.equal(calls, 1);
    scheduler.resume(); await until(() => events.includes('jobCompleted')); assert.equal(calls, 2);
  } finally { scheduler.cancelAll(); }
});
test('cancelling and immediately replacing identical content cannot delete the replacement group', async () => {
  const disk = cacheDisk(), cache = new TranslationCache(disk); await cache.init(); const events: any[] = []; let calls = 0;
  const first = deferred<Map<string, string>>();
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async p => {
    if (++calls === 1) return first.promise; return new Map(p.segments.map(s => [s.id, '新的译文']));
  } }, cache, (event, data, jobId) => events.push({ event, data, jobId }));
  try {
    const old = await scheduler.submit(params()); await until(() => calls === 1); scheduler.cancel(old.jobId);
    const replacement = await scheduler.submit(params()); first.resolve(new Map([['s1', '旧结果']]));
    await until(() => events.some(e => e.jobId === replacement.jobId && e.event === 'jobCompleted')); assert.equal(calls, 2);
  } finally { scheduler.cancelAll(); }
});
test('stale account submissions and duplicate ids are rejected before any request', async () => {
  const disk = cacheDisk(), cache = new TranslationCache(disk); await cache.init();
  const scheduler = new Scheduler({ epoch: 2, active: account, mark: async () => {} }, { translate: async () => new Map() }, cache, () => {});
  try {
    await assert.rejects(scheduler.submit(params()), (e: any) => e.code === 'stale_account');
    const invalid = params(); invalid.accountEpoch = 2; invalid.segments.push(invalid.segments[0]);
    await assert.rejects(scheduler.submit(invalid), (e: any) => e.code === 'invalid_request');
  } finally { scheduler.cancelAll(); }
});

test('concurrent duplicate submissions remain idempotent across async hashing', async () => {
  const cache = new TranslationCache(cacheDisk()); await cache.init();
  const gate = deferred<Map<string, string>>(); let calls = 0;
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async () => { calls++; return gate.promise; } }, cache, () => {});
  try {
    const request = params(); const results = await Promise.all(Array.from({ length: 12 }, () => scheduler.submit(request)));
    assert.equal(new Set(results.map(result => result.jobId)).size, 1);
    await until(() => calls === 1);
  } finally { scheduler.cancelAll(); gate.resolve(new Map()); }
});

test('cancelling a page or ending a session while hashing cannot enqueue a late request', async () => {
  const cache = new TranslationCache(cacheDisk()); await cache.init(); let calls = 0;
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async () => { calls++; return new Map(); } }, cache, () => {});
  const page = scheduler.submit(params()); scheduler.cancel(undefined, 'page-1');
  await assert.rejects(page, (error: any) => error.code === 'cancelled');
  const session = scheduler.submit(params()); scheduler.cancelAll();
  await assert.rejects(session, (error: any) => error.code === 'cancelled'); assert.equal(calls, 0);
});

test('cache persistence failure still delivers a validated completed translation without replay', async () => {
  const cache = new TranslationCache({ read: async () => [], write: async () => { throw new Error('storage full'); } }); await cache.init();
  const events: string[] = []; let calls = 0;
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async () => { calls++; return new Map([['s1', '译文']]); } }, cache, event => events.push(event));
  await scheduler.submit(params()); await until(() => events.includes('jobCompleted'));
  assert.equal(calls, 1); assert(!events.includes('failed')); scheduler.cancelAll();
});
