import { AppError, assert, PROMPT_VERSION, publicError, TranslationParams, validateTranslationParams } from '../shared/protocol';
import { AuthManager } from './auth';
import { ChatGPTPlanProvider } from './provider';
import { digest, TranslationCache } from './storage';
interface Job { id: string; params: TranslationParams; state: string; group: Group; created: number }
interface Group { key: string; jobs: Job[]; params: TranslationParams; controller: AbortController; running: boolean }
type Emit = (event: string, data: any, jobId?: string, epoch?: number) => void;
export class Scheduler {
  private jobs = new Map<string, Job>();
  private keys = new Map<string, string>();
  private groups = new Map<string, Group>();
  private running = false; private lastPage = ''; private paused = false;
  private cancellation = 0;
  private cancelledPages = new Map<string, number>();
  constructor(private auth: Pick<AuthManager, 'active' | 'epoch' | 'mark'>, private provider: Pick<ChatGPTPlanProvider, 'translate'>,
    private cache: TranslationCache, private emit: Emit) {}
  get busy(): boolean { return this.running || this.groups.size > 0; }
  async submit(p: TranslationParams): Promise<{ jobId: string }> {
    validateTranslationParams(p);
    const a = this.auth.active();
    assert(a && a.key === p.accountKey && p.accountEpoch === this.auth.epoch, 'stale_account', '账号已变化，请重新开始翻译。');
    assert(a.identity === 'signed_in' && a.plan !== 'not_granted', 'not_granted', '请先登录并授权使用套餐。');
    const cancellation = this.cancellation, pageVersion = this.cancelledPages.get(p.document.pageKey);
    this.prune();
    const idempotency = await digest([p.accountEpoch, p.document, p.requestKey]);
    assert(p.accountEpoch === this.auth.epoch, 'stale_account', '账号已变化。');
    const previous = this.keys.get(idempotency);
    if (previous && this.jobs.has(previous)) return { jobId: previous };
    assert(this.jobs.size < 1000 && this.groups.size < 100, 'queue_full', '翻译队列已满，请稍后继续。');
    const key = await digest([p.accountKey, p.model, p.sourceLanguage, p.targetLanguage, p.title, p.glossaryVersion, p.glossary,
      p.segments.map(s => [s.text, s.protected])]);
    assert(p.accountEpoch === this.auth.epoch, 'stale_account', '账号已变化。');
    const raced = this.keys.get(idempotency);
    if (raced && this.jobs.has(raced)) return { jobId: raced };
    assert(cancellation === this.cancellation && pageVersion === this.cancelledPages.get(p.document.pageKey), 'cancelled', '任务已取消。');
    assert(this.jobs.size < 1000 && this.groups.size < 100, 'queue_full', '翻译队列已满，请稍后继续。');
    let group = this.groups.get(key);
    if (!group) { group = { key, jobs: [], params: p, controller: new AbortController(), running: false }; this.groups.set(key, group); }
    const job: Job = { id: crypto.randomUUID(), params: p, state: 'queued', group, created: Date.now() };
    group.jobs.push(job); this.jobs.set(job.id, job); this.keys.set(idempotency, job.id);
    // RPC accepted must be written before the first event, including cache hits.
    setTimeout(() => { if (job.state === 'queued') this.send(job, 'queued'); void this.pump(); });
    return { jobId: job.id };
  }
  cancel(jobId?: string, pageKey?: string): void {
    if (pageKey) this.cancelledPages.set(pageKey, (this.cancelledPages.get(pageKey) || 0) + 1);
    for (const job of this.jobs.values()) {
      if ((!jobId || job.id === jobId) && (!pageKey || job.params.document.pageKey === pageKey) && ['queued', 'started'].includes(job.state)) {
        job.state = 'cancelled'; this.send(job, 'cancelled');
        job.group.jobs = job.group.jobs.filter(j => j !== job);
        if (!job.group.jobs.length) { job.group.controller.abort(); this.groups.delete(job.group.key); }
      }
    }
  }
  cancelAll(): void { this.cancellation++; this.cancel(); this.paused = false; }
  resume(): void { this.paused = false; void this.pump(); }
  private send(job: Job, event: string, data?: any): void { this.emit(event, data, job.id, job.params.accountEpoch); }
  private cacheKey(p: TranslationParams, index: number): Promise<string> {
    const s = p.segments[index];
    return digest([p.accountKey, s.text, s.protected, p.sourceLanguage, p.targetLanguage, p.model, PROMPT_VERSION, p.glossaryVersion, p.glossary, p.title]);
  }
  private async pump(): Promise<void> {
    if (this.running || this.paused) return;
    const eligible = [...this.groups.values()].filter(g => !g.running && g.jobs.length);
    eligible.sort((a, b) => Math.min(...a.jobs.map(j => j.params.priority)) - Math.min(...b.jobs.map(j => j.params.priority)) ||
      Number(a.params.document.pageKey === this.lastPage) - Number(b.params.document.pageKey === this.lastPage));
    const group = eligible[0]; if (!group) return;
    this.running = true; group.running = true; this.lastPage = group.params.document.pageKey;
    const p = group.params; let lastProgress = 0;
    try {
      for (const j of group.jobs) { j.state = 'started'; this.send(j, 'started'); }
      const output = new Map<string, string>();
      const cacheKeys = await Promise.all(p.segments.map((_, i) => this.cacheKey(p, i)));
      group.controller.signal.throwIfAborted();
      const missing = p.segments.filter((s, i) => { const cached = this.cache.get(cacheKeys[i]); if (cached !== undefined) output.set(s.id, cached); return cached === undefined; });
      if (missing.length) {
        const translated = await this.provider.translate({ ...p, segments: missing }, group.controller.signal, () => {
          if (Date.now() - lastProgress > 800) { lastProgress = Date.now(); for (const j of group.jobs) this.send(j, 'progress'); }
        });
        group.controller.signal.throwIfAborted();
        assert(p.accountEpoch === this.auth.epoch, 'stale_account', '账号已切换。');
        for (const [id, value] of translated) output.set(id, value);
        // Validate the entire batch before committing any result to the persistent cache.
        for (let i = 0; i < p.segments.length; i++) this.cache.set(cacheKeys[i], output.get(p.segments[i].id)!);
        // A full/unavailable local cache must not turn a completed paid request into a retry.
        await this.cache.flush().catch(() => {});
        await this.auth.mark(p.accountKey, 'last_request_succeeded');
      }
      group.controller.signal.throwIfAborted();
      assert(p.accountEpoch === this.auth.epoch, 'stale_account', '账号已切换。');
      for (const j of group.jobs) {
        // Identical content with different DOM ids has independent subscriber metadata.
        for (let i = 0; i < j.params.segments.length; i++) {
          const s = j.params.segments[i];
          this.send(j, 'batchCompleted', { document: j.params.document, segment: { id: s.id, revision: s.revision, sourceHash: s.sourceHash, translation: output.get(p.segments[i].id) }, cached: !missing.length });
        }
        j.state = 'completed'; this.send(j, 'jobCompleted');
      }
    } catch (error) {
      const e = publicError(error);
      if (!group.controller.signal.aborted) {
        if (['limited', 'ineligible', 'reauth_required', 'not_granted'].includes(e.code)) {
          this.paused = true;
          await this.auth.mark(p.accountKey, e.code === 'limited' ? 'limited' : e.code === 'ineligible' ? 'ineligible' : e.code === 'not_granted' ? 'not_granted' : 'authorized_unverified', e.code === 'reauth_required').catch(() => {});
        } else if (e.code === 'temporarily_unavailable') await this.auth.mark(p.accountKey, 'temporarily_unavailable').catch(() => {});
        for (const j of group.jobs) { j.state = 'failed'; this.send(j, 'failed', { error: e }); }
      }
    } finally {
      if (this.groups.get(group.key) === group) this.groups.delete(group.key);
      this.running = false;
      setTimeout(() => void this.pump());
    }
  }
  private prune(): void {
    for (const [id, j] of this.jobs) if (!['queued', 'started'].includes(j.state) && Date.now() - j.created > 10 * 60_000) this.jobs.delete(id);
    for (const [key, id] of this.keys) if (!this.jobs.has(id)) this.keys.delete(key);
  }
}
