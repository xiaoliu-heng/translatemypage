import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Scheduler } from '../src/host/scheduler';
import { TranslationCache } from '../src/host/storage';
import { AppError } from '../src/shared/protocol';
import { account, deferred, params, temporary, until } from './helpers';
test('identical requests coalesce across pages; cancelling one subscription preserves another and cache survives restart', async () => {
  const tmp = await temporary(), cache = new TranslationCache(join(tmp.dir, 'cache.json')); await cache.init();
  const gate = deferred<Map<string, string>>(); let calls = 0, signal: AbortSignal | undefined;
  const events: any[] = [];
  const auth = { epoch: 1, active: account, mark: async () => {} };
  const provider = { translate: async (_p: any, s: AbortSignal) => { calls++; signal = s; return gate.promise; } };
  const scheduler = new Scheduler(auth, provider, cache, (event, data, jobId) => events.push({ event, data, jobId }));
  try {
    const a = scheduler.submit(params('a', 'id-a')), b = scheduler.submit(params('b', 'id-b'));
    await until(() => calls === 1); scheduler.cancel(a.jobId);
    assert.equal(signal!.aborted, false); gate.resolve(new Map([['id-a', '你好世界。']]));
    await until(() => events.some(e => e.event === 'jobCompleted' && e.jobId === b.jobId));
    assert.equal(calls, 1);
    assert.equal(events.filter(e => e.jobId === a.jobId && e.event === 'batchCompleted').length, 0);
    assert.equal(events.find(e => e.jobId === b.jobId && e.event === 'batchCompleted').data.segment.id, 'id-b');
    const restored = new TranslationCache(join(tmp.dir, 'cache.json')); await restored.init();
    const next = new Scheduler(auth, { translate: async () => { throw new Error('cache miss'); } }, restored, (event, data) => events.push({ event, data, cachedTest: true }));
    next.submit(params('c', 'id-c')); await until(() => events.some(e => e.cachedTest && e.event === 'jobCompleted'));
    assert.equal(events.find(e => e.cachedTest && e.event === 'batchCompleted').data.cached, true);
  } finally { scheduler.cancelAll(); await tmp.remove(); }
});
test('interrupted or invalid inference never pollutes cache', async () => {
  const tmp = await temporary(), cache = new TranslationCache(join(tmp.dir, 'cache.json')); await cache.init(); let calls = 0;
  const events: any[] = [];
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async () => { calls++; throw new AppError('interrupted', 'unknown'); } }, cache, (e, d) => events.push([e, d]));
  try {
    scheduler.submit(params()); await until(() => events.filter(e => e[0] === 'failed').length === 1);
    scheduler.submit(params()); await until(() => events.filter(e => e[0] === 'failed').length === 2); assert.equal(calls, 2);
  } finally { scheduler.cancelAll(); await tmp.remove(); }
});
test('quota failure pauses remaining queue until explicit resume', async () => {
  const tmp = await temporary(), cache = new TranslationCache(join(tmp.dir, 'cache.json')); await cache.init(); const events: string[] = []; let calls = 0;
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async p => {
    if (++calls === 1) throw new AppError('limited', 'limited'); return new Map(p.segments.map(s => [s.id, '译文']));
  } }, cache, e => events.push(e));
  try {
    scheduler.submit(params('a', 'a', 'first')); scheduler.submit(params('b', 'b', 'second'));
    await until(() => events.includes('failed')); await new Promise(r => setTimeout(r, 30)); assert.equal(calls, 1);
    scheduler.resume(); await until(() => events.includes('jobCompleted')); assert.equal(calls, 2);
  } finally { scheduler.cancelAll(); await tmp.remove(); }
});
test('cancelling and immediately replacing identical content cannot delete the replacement group', async () => {
  const tmp = await temporary(), cache = new TranslationCache(join(tmp.dir, 'cache.json')); await cache.init(); const events: any[] = []; let calls = 0;
  const first = deferred<Map<string, string>>();
  const scheduler = new Scheduler({ epoch: 1, active: account, mark: async () => {} }, { translate: async p => {
    if (++calls === 1) return first.promise; return new Map(p.segments.map(s => [s.id, '新的译文']));
  } }, cache, (event, data, jobId) => events.push({ event, data, jobId }));
  try {
    const old = scheduler.submit(params()); await until(() => calls === 1); scheduler.cancel(old.jobId);
    const replacement = scheduler.submit(params()); first.resolve(new Map([['s1', '旧结果']]));
    await until(() => events.some(e => e.jobId === replacement.jobId && e.event === 'jobCompleted')); assert.equal(calls, 2);
  } finally { scheduler.cancelAll(); await tmp.remove(); }
});
test('stale account submissions and duplicate ids are rejected before any request', async () => {
  const tmp = await temporary(), cache = new TranslationCache(join(tmp.dir, 'cache.json')); await cache.init();
  const scheduler = new Scheduler({ epoch: 2, active: account, mark: async () => {} }, { translate: async () => new Map() }, cache, () => {});
  try {
    assert.throws(() => scheduler.submit(params()), (e: any) => e.code === 'stale_account');
    const invalid = params(); invalid.accountEpoch = 2; invalid.segments.push(invalid.segments[0]);
    assert.throws(() => scheduler.submit(invalid), (e: any) => e.code === 'invalid_request');
  } finally { scheduler.cancelAll(); await tmp.remove(); }
});
