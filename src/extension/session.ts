import { AuthManager, verifyIdentity } from '../core/auth';
import { ChatGPTPlanProvider } from '../core/provider';
import { Scheduler } from '../core/scheduler';
import { AppError, assert, PROTOCOL, publicError, RpcRequest } from '../shared/protocol';
import { registrations, translationCache } from './storage';

export interface SessionRuntime { complete(raw: string): Promise<void>; close(): void }
export async function startSession(): Promise<SessionRuntime> {
  let release!: () => void, ready!: (value: SessionRuntime) => void, fail!: (error: unknown) => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const initialized = new Promise<SessionRuntime>((resolve, reject) => { ready = resolve; fail = reject; });
  // Only one page may hold credentials and refresh tokens in a browser profile.
  void navigator.locks.request('translatemypage-session', { ifAvailable: true }, async lock => {
    if (!lock) { fail(new AppError('session_exists', '已有一个翻译会话。请从扩展按钮打开原会话标签页。')); return; }
    let port: chrome.runtime.Port | undefined, stopped = false, seq = 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;
    const bootId = crypto.randomUUID();
    const emit = (event: string, data?: any, jobId?: string, accountEpoch?: number) => {
      try { port?.postMessage({ v: PROTOCOL, bootId, seq: ++seq, event, data, jobId, accountEpoch }); } catch {}
    };
    try {
      const store = await registrations(), cache = translationCache(); await cache.init();
      const auth = new AuthManager(store, switched => { if (switched) scheduler.cancelAll(); emit('status', auth.status()); },
        { fetch, verify: verifyIdentity, open: async url => { await chrome.tabs.create({ url }); } });
      const provider = new ChatGPTPlanProvider(auth), scheduler = new Scheduler(auth, provider, cache, emit);
      const close = () => {
        if (stopped) return; stopped = true; clearInterval(heartbeat); clearTimeout(reconnect);
        scheduler.cancelAll(); auth.close(); port?.disconnect(); port = undefined; release();
      };
      async function handle(request: RpcRequest): Promise<unknown> {
        assert(!stopped && request.v === PROTOCOL && typeof request.id === 'string' && request.id.length <= 100, 'invalid_request', '会话消息无效。');
        const params = request.params || {};
        switch (request.method) {
          case 'auth.begin': return auth.begin(params.accountKey, params.reconsent === true, params.newAccount === true);
          case 'auth.cancel': auth.cancel(); return {};
          case 'account.select': return auth.select(params.accountKey);
          case 'account.logout': return auth.logout(params.accountKey);
          case 'models.list': {
            const account = auth.active(); assert(account, 'signed_out', '请先登录 ChatGPT。');
            try { return await provider.models(account.key); }
            catch (error) {
              if (error instanceof AppError && ['limited', 'ineligible', 'temporarily_unavailable', 'reauth_required', 'not_granted'].includes(error.code))
                await auth.mark(account.key, error.code === 'reauth_required' ? 'authorized_unverified' : error.code as any, error.code === 'reauth_required');
              throw error;
            }
          }
          case 'translation.submit': return scheduler.submit(params);
          case 'translation.cancel': scheduler.cancel(params.jobId, params.pageKey); return {};
          case 'translation.resume': scheduler.resume(); return {};
          case 'cache.clear': await cache.clear(); return {};
          default: throw new AppError('unknown_method', '不支持此操作。');
        }
      }
      function connect(): void {
        if (stopped || port) return;
        const current = chrome.runtime.connect({ name: 'translation-session' }); port = current;
        current.onMessage.addListener((request: RpcRequest) => {
          void handle(request).then(result => current.postMessage({ v: PROTOCOL, id: request.id, result }))
            .catch(error => { try { current.postMessage({ v: PROTOCOL, id: request.id, error: publicError(error) }); } catch {} });
        });
        current.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (port !== current || stopped) return;
          port = undefined; scheduler.cancelAll();
          // Restore transport only after a worker restart. Never replay an inference.
          reconnect = setTimeout(connect, 1000);
        });
        emit('hello', auth.status());
      }
      chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (message?.type !== 'session.wake' || sender.id !== chrome.runtime.id || sender.tab || stopped) return false;
        clearTimeout(reconnect); connect(); emit('hello', auth.status()); reply({ awake: true }); return false;
      });
      connect();
      heartbeat = setInterval(() => emit('status', auth.status()), 20_000);
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { autoDiscardable: false });
      window.addEventListener('pagehide', close, { once: true });
      ready({ complete: raw => auth.complete(raw), close });
      await held;
    } catch (error) { stopped = true; clearInterval(heartbeat); clearTimeout(reconnect); port?.disconnect(); fail(error); release(); }
  }).catch(fail);
  return initialized;
}
