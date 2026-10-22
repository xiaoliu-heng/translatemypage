import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AppError, assert, HOST_NAME, MAX_FRAME, PROTOCOL, publicError, RpcRequest, VERSION } from '../shared/protocol';
import { FrameDecoder, encodeFrame } from './framing';
import { AccountStore, dataRoot, digest, SystemVault, TranslationCache } from './storage';
import { AuthManager } from './auth';
import { ChatGPTPlanProvider } from './provider';
import { Scheduler } from './scheduler';

const bootId = randomUUID(); let seq = 0;
let store: AccountStore | undefined, auth: AuthManager | undefined, scheduler: Scheduler | undefined;
let cache: TranslationCache | undefined, provider: ChatGPTPlanProvider | undefined;
let initialized = false, closing = false, initializing = false;
let control = Promise.resolve();
const dir = dirname(process.argv[1]);
const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
const origin = process.argv[2];
if (origin !== `chrome-extension://${config.extensionId}/`) process.exit(2);
function write(message: unknown): void {
  try { process.stdout.write(encodeFrame(message)); } catch { void shutdown(1); }
}
function emit(event: string, data?: any, jobId?: string, accountEpoch?: number): void {
  write({ v: 1, event, bootId, seq: ++seq, data, jobId, accountEpoch });
}
async function handle(r: RpcRequest): Promise<unknown> {
  assert(r && r.v === PROTOCOL && typeof r.id === 'string' && r.id.length <= 100 && typeof r.method === 'string', 'invalid_request', '不兼容的助手协议。');
  if (r.method === 'bridge.hello') {
    assert(!initializing, 'host_busy', '助手正在初始化。');
    if (!initialized) {
      assert(typeof r.params?.installationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.params.installationId), 'invalid_installation', '扩展安装标识无效。');
      initializing = true;
      try {
        const ns = digest([origin, r.params.installationId]);
        store = new AccountStore(join(dataRoot(), ns)); await store.init();
        cache = new TranslationCache(join(store.dir, 'translations.json')); await cache.init();
        auth = new AuthManager(store, new SystemVault(ns, join(dir, 'keychain')), switched => {
          if (switched) scheduler?.cancelAll(); emit('status', auth?.status());
        });
        provider = new ChatGPTPlanProvider(auth);
        scheduler = new Scheduler(auth, provider, cache, emit); initialized = true;
      } finally { initializing = false; }
    }
    return { protocol: PROTOCOL, version: VERSION, bootId, host: HOST_NAME, maxMessageBytes: MAX_FRAME, status: auth!.status() };
  }
  assert(initialized && auth && provider && scheduler && cache, 'hello_required', '请先连接助手。');
  const p = r.params || {};
  switch (r.method) {
    case 'status.get': return auth.status();
    case 'auth.begin': return auth.begin(p.accountKey, p.reconsent === true);
    case 'auth.cancel': auth.cancel(); return {};
    case 'account.select': return auth.select(p.accountKey);
    case 'account.logout': return auth.logout(p.accountKey);
    case 'models.list': {
      const a = auth.active(); assert(a, 'signed_out', '请先登录 ChatGPT。');
      try { return await provider.models(a.key); }
      catch (e) {
        if (e instanceof AppError && ['limited', 'ineligible', 'temporarily_unavailable', 'reauth_required', 'not_granted'].includes(e.code))
          await auth.mark(a.key, e.code === 'reauth_required' ? 'authorized_unverified' : e.code as any, e.code === 'reauth_required');
        throw e;
      }
    }
    case 'translation.submit': return scheduler.submit(p);
    case 'translation.cancel': scheduler.cancel(p.jobId, p.pageKey); return {};
    case 'translation.resume': scheduler.resume(); return {};
    case 'cache.clear': await cache.clear(); return {};
    default: throw new AppError('unknown_method', '不支持此助手操作。');
  }
}
async function dispatch(request: unknown): Promise<void> {
  const r = request as RpcRequest;
  try { write({ v: 1, id: typeof r?.id === 'string' ? r.id : '', result: await handle(r) }); }
  catch (error) { write({ v: 1, id: typeof r?.id === 'string' ? r.id : '', error: publicError(error) }); }
}
const decoder = new FrameDecoder();
process.stdin.on('data', chunk => {
  try {
    for (const r of decoder.push(chunk)) {
      // Short control mutations are serialized; submitted inference runs independently in Scheduler.
      control = control.then(() => dispatch(r));
    }
  } catch { void shutdown(1); }
});
async function shutdown(code = 0): Promise<void> {
  if (closing) return; closing = true;
  scheduler?.cancelAll(); await auth?.close();
  await cache?.flush().catch(() => {}); await store?.close().catch(() => {});
  process.exit(code);
}
process.stdin.on('end', () => { try { decoder.end(); } catch {} void shutdown(); });
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
process.stdout.on('error', () => void shutdown());
