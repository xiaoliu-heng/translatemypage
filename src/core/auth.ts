import { Account, AppError, assert, ChatGPTAccount, PlanState, Status } from '../shared/protocol';
import { consumeCallback, PendingAuthorization, CallbackError } from './callback';
import { ApiProfileData, ApiProfileStore, digest, RegistrationStore } from './storage';
import { normalizeApiBaseUrl } from '../shared/providers';
import { verifyIdentity } from './identity';
export { verifyIdentity } from './identity';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
export interface ChatGPTCredential {
  authType: 'chatgpt'; clientId: string; accessToken: string; refreshToken?: string; idToken?: string;
  scopes: string[]; expiresAt: number;
}
export interface ApiKeyCredential { authType: 'api_key'; accessToken: string; apiBaseUrl: string }
export type Credential = ChatGPTCredential | ApiKeyCredential;
export function credentialsFromResponse(t: unknown, clientId: string, previous?: ChatGPTCredential): ChatGPTCredential {
  assert(t && typeof t === 'object' && 'access_token' in t && 'expires_in' in t && 'token_type' in t,
    'invalid_token_response', '授权服务返回了不完整的凭据。');
  const refreshToken = 'refresh_token' in t ? t.refresh_token : undefined;
  const idToken = 'id_token' in t ? t.id_token : undefined;
  assert(typeof t.access_token === 'string' && t.access_token.length > 0 && typeof t.expires_in === 'number' && Number.isFinite(t.expires_in) && t.expires_in > 0 &&
    typeof t.token_type === 'string' && t.token_type.toLowerCase() === 'bearer' &&
    (refreshToken === undefined || typeof refreshToken === 'string') && (idToken === undefined || typeof idToken === 'string'),
  'invalid_token_response', '授权服务返回了不完整的凭据。');
  return { authType: 'chatgpt', clientId, accessToken: t.access_token, refreshToken: refreshToken ?? previous?.refreshToken,
    idToken: idToken ?? previous?.idToken, expiresAt: Date.now() + t.expires_in * 1000,
    scopes: 'scope' in t && typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [] };
}
export interface AuthDependencies { fetch: typeof fetch; verify: typeof verifyIdentity; open(url: string): Promise<void> }
interface Attempt extends PendingAuthorization {
  selected?: ChatGPTAccount; timer: ReturnType<typeof setTimeout>; abort: AbortController;
}
function random(length = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(length)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export class AuthManager {
  // A new runtime has a new epoch even if the background worker survived the old tab.
  epoch = crypto.getRandomValues(new Uint32Array(1))[0] * 1_048_576;
  private accounts: Account[] = [];
  private activeKey?: string;
  private credentials = new Map<string, Credential>();
  private attempt?: Attempt;
  private preparing?: Promise<{ pending: true }>;
  private processing?: Promise<void>;
  private refreshes = new Map<string, Promise<Credential>>();
  private notice?: string;
  private closed = false;
  private generation = 0;
  private signingOut = false;
  private profiles: ApiProfileData = { profiles: [] };
  private writes: Promise<void> = Promise.resolve();
  private pendingWrites = new Set<AbortController>();
  constructor(private registrations: RegistrationStore, private changed: (switched: boolean) => void,
    private deps: AuthDependencies, private profileStore: ApiProfileStore) {}
  async restore(): Promise<void> {
    const generation = this.generation;
    let saved: unknown;
    try { saved = await this.profileStore.read(); }
    catch { throw new AppError('credential_storage_failed', '无法读取已保存的 API 配置，请检查扩展本地存储。'); }
    assert(!this.closed && generation === this.generation, 'cancelled', '恢复 API 配置已取消。');
    if (saved === undefined) return;
    assert(saved !== null && typeof saved === 'object' && 'profiles' in saved && Array.isArray(saved.profiles),
      'credential_storage_failed', '已保存的 API 配置无效，请检查扩展本地存储。');
    const profiles: ApiProfileData['profiles'] = [];
    for (const value of saved.profiles) {
      assert(value !== null && typeof value === 'object' && 'key' in value && typeof value.key === 'string' &&
        'apiBaseUrl' in value && typeof value.apiBaseUrl === 'string' && 'accessToken' in value && typeof value.accessToken === 'string',
      'credential_storage_failed', '已保存的 API 配置无效。');
      const apiBaseUrl = normalizeApiBaseUrl(value.apiBaseUrl);
      assert(value.accessToken.length > 0 && value.accessToken.length <= 4096 && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value.accessToken) &&
        value.key === await digest(['api_key', apiBaseUrl, value.accessToken]) && !profiles.some(profile => profile.key === value.key),
      'credential_storage_failed', '已保存的 API 配置无效。');
      profiles.push({ key: value.key, apiBaseUrl, accessToken: value.accessToken });
    }
    assert(!this.closed && generation === this.generation, 'cancelled', '恢复 API 配置已取消。');
    const activeKey = 'activeKey' in saved && typeof saved.activeKey === 'string' ? saved.activeKey : undefined;
    assert(activeKey === undefined || profiles.some(profile => profile.key === activeKey), 'credential_storage_failed', '已保存的 API 选择无效。');
    this.profiles = { profiles, activeKey };
    for (const profile of profiles) {
      this.accounts.push({ authType: 'api_key', key: profile.key, apiBaseUrl: profile.apiBaseUrl,
        name: `API · ${profile.apiBaseUrl}`, identity: 'signed_in', plan: 'authorized_unverified' });
      this.credentials.set(profile.key, { authType: 'api_key', accessToken: profile.accessToken, apiBaseUrl: profile.apiBaseUrl });
    }
    this.activeKey = activeKey; this.epoch++; this.changed(true);
  }
  private persist(change: (previous: ApiProfileData) => ApiProfileData, valid: () => boolean, accepted: () => void): Promise<void> {
    const abort = new AbortController(); this.pendingWrites.add(abort);
    const work = this.writes.catch(() => {}).then(async () => {
      assert(valid() && !abort.signal.aborted, 'cancelled', '保存 API 配置已取消。');
      const previous = this.profiles, next = change(previous);
      try {
        await this.profileStore.write(next, abort.signal);
        if (!valid() || abort.signal.aborted) {
          // A cancellation can race the transaction's commit notification.
          try { await this.profileStore.write(previous); }
          catch { throw new AppError('credential_storage_failed', '取消配置时无法回退本地保存，请重新打开会话检查已保存的 API 配置。'); }
          throw new AppError('cancelled', '保存 API 配置已取消。');
        }
        this.profiles = next;
        accepted();
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (abort.signal.aborted) throw new AppError('cancelled', '保存 API 配置已取消。');
        throw new AppError('credential_storage_failed', '无法保存 API 配置，请检查扩展本地存储后重试。');
      }
    }).finally(() => this.pendingWrites.delete(abort));
    this.writes = work;
    return work;
  }
  status(): Status {
    return { accounts: this.accounts.map(a => ({ ...a })), activeKey: this.activeKey, accountEpoch: this.epoch,
      authorizing: !!this.attempt || !!this.preparing, signingOut: this.signingOut,
      authorization: this.attempt ? { redirectUri: this.attempt.redirectUri, expiresAt: this.attempt.createdAt + 300_000, exchanging: this.attempt.consumed } : undefined,
      notice: this.notice };
  }
  active(): Account | undefined { return this.accounts.find(a => a.key === this.activeKey); }
  private find(key: string): Account {
    const account = this.accounts.find(a => a.key === key); assert(account, 'account_missing', '账号不存在。'); return account;
  }
  async begin(key?: string, reconsent = false, newAccount = false): Promise<{ pending: true }> {
    assert(!this.closed, 'session_closed', '翻译会话已结束，请重新打开。');
    assert(!this.signingOut, 'auth_busy', '正在退出，请稍候再登录。');
    if (this.preparing) return this.preparing;
    if (this.attempt) return { pending: true };
    const generation = ++this.generation;
    const work = (async () => {
      await this.processing;
      assert(!this.closed && generation === this.generation, 'cancelled', '登录已取消。');
      const selectedAccount = key ? this.find(key) : undefined;
      assert(!selectedAccount || selectedAccount.authType === 'chatgpt', 'invalid_auth_type', 'API 密钥账号不能通过 ChatGPT 重新授权，请重新输入密钥。');
      const selected = selectedAccount?.authType === 'chatgpt' ? selectedAccount : undefined;
      const clientId = selected?.clientId || this.registrations.data.pendingClientId || (!newAccount ? this.registrations.data.lastClientId : undefined);
      const verifier = random(48), state = random(), nonce = random();
      const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      assert(!this.closed && generation === this.generation, 'cancelled', '登录已取消。');
      const abort = new AbortController();
      const attempt: Attempt = { redirectUri: REDIRECT_URI, state, nonce, verifier, clientId, selected, consumed: false, createdAt: Date.now(), abort,
        timer: setTimeout(() => { if (this.attempt === attempt) { this.notice = '登录已超时，请重新打开授权页。'; this.cancel(); } }, 300_000) };
      this.attempt = attempt; this.notice = undefined; this.changed(false);
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      const fields: Record<string, string> = { client_id: clientId || 'dynamic_agent_client', ext_agent_host_id: this.registrations.data.hostId,
        response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES, resource: RESOURCE, state, nonce,
        code_challenge_method: 'S256', code_challenge: btoa(String.fromCharCode(...new Uint8Array(challenge))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
      if (!clientId) fields.agent_name_hint = 'TranslateMyPage';
      if (selected?.email) fields.login_hint = selected.email;
      // Avoid putting a retained ID token into a browser tab URL. Account selection remains explicit.
      if (reconsent) fields.prompt = 'consent';
      for (const [name, value] of Object.entries(fields)) url.searchParams.set(name, value);
      try { await this.deps.open(url.toString()); } catch { this.cancel(); throw new AppError('browser_unavailable', '无法打开授权页，请重试。'); }
      return { pending: true as const };
    })();
    this.preparing = work;
    try { return await work; } finally { if (this.preparing === work) this.preparing = undefined; this.changed(false); }
  }
  async useApiKey(raw: string, apiBaseUrl: string): Promise<void> {
    assert(!this.closed, 'session_closed', '翻译会话已结束，请重新打开。');
    assert(!this.signingOut, 'auth_busy', '正在退出，请稍候再连接。');
    const secret = raw.trim(), base = normalizeApiBaseUrl(apiBaseUrl);
    assert(secret.length > 0 && secret.length <= 4096 && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(secret),
      'invalid_api_key', '请输入有效的 API 密钥；密钥不能包含空白或控制字符。');
    this.cancel();
    const generation = this.generation;
    await this.processing?.catch(() => {});
    assert(!this.closed && generation === this.generation, 'cancelled', '连接 API 密钥已取消。');
    const key = await digest(['api_key', base, secret]);
    const valid = () => !this.closed && generation === this.generation;
    await this.persist(previous => ({ profiles: [...previous.profiles.filter(profile => profile.key !== key),
      { key, apiBaseUrl: base, accessToken: secret }], activeKey: key }), valid, () => {
      const account: Account = { authType: 'api_key', key, apiBaseUrl: base, name: `API · ${base}`,
        identity: 'signed_in', plan: 'authorized_unverified' };
      const existing = this.accounts.find(value => value.key === key);
      this.credentials.set(key, { authType: 'api_key', accessToken: secret, apiBaseUrl: base });
      if (existing) Object.assign(existing, account); else this.accounts.push(account);
      this.activeKey = key; this.epoch++; this.notice = 'API 密钥已保存在此浏览器的扩展本地数据库中，尚未验证；API 使用单独计费。';
      this.changed(true);
    });
  }
  async complete(raw: string): Promise<void> {
    const attempt = this.attempt;
    const wasConsumed = attempt?.consumed;
    let callback: { code: string; clientId: string };
    try { callback = consumeCallback(raw, attempt); }
    catch (e) {
      if (attempt?.consumed && !wasConsumed) this.finish(attempt);
      const code = e instanceof CallbackError ? e.code : 'invalid_callback';
      const messages: Record<string, string> = {
        no_pending_authorization: '请先在本页打开授权，再粘贴本次回调地址。', authorization_expired: '登录已超时，请重新授权。',
        state_mismatch: '此链接不属于本次登录，请复制刚完成授权后的地址。', authorization_denied: '未获得授权，请重新登录。',
        client_mismatch: '返回的客户端注册与本次登录不一致。',
      };
      this.changed(false); throw new AppError(code, messages[code] || '回调地址无效，请复制地址栏中完整的 127.0.0.1 回调链接。');
    }
    assert(attempt, 'no_pending_authorization', '请先开始登录。');
    this.changed(false);
    let stage: 'registration' | 'exchange' | 'identity' | 'account' = 'registration';
    const work = (async () => {
      try {
        // Preserve an issued registration even if the one-time code exchange fails.
        if (!this.registrations.data.bindings[callback.clientId]) this.registrations.data.pendingClientId = callback.clientId;
        await this.registrations.save();
        attempt.abort.signal.throwIfAborted();
        stage = 'exchange';
        const response = await this.token({ grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code,
          code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }, attempt.abort.signal);
        const credential = credentialsFromResponse(response, callback.clientId);
        assert(credential.idToken, 'invalid_identity', '授权服务未返回身份令牌。');
        stage = 'identity';
        const identity = await this.deps.verify(credential.idToken, callback.clientId, attempt.nonce);
        assert(identity.sub && identity.iss === ISSUER, 'invalid_identity', '登录身份校验失败。');
        stage = 'account';
        const subjectHash = await digest([identity.iss, identity.sub]);
        const bound = this.registrations.data.bindings[callback.clientId];
        assert(!bound || bound === subjectHash, 'account_mismatch', '返回的身份与已有注册不一致，请选择原账号或添加其他账号。');
        assert(!attempt.selected || (identity.sub === attempt.selected.subject && identity.iss === attempt.selected.issuer), 'account_mismatch', '重新授权的账号与所选账号不一致。');
        const key = await digest([callback.clientId, identity.iss, identity.sub]);
        attempt.abort.signal.throwIfAborted();
        this.registrations.data.bindings[callback.clientId] = subjectHash;
        this.registrations.data.lastClientId = callback.clientId; delete this.registrations.data.pendingClientId; await this.registrations.save();
        attempt.abort.signal.throwIfAborted();
        const account: Account = { authType: 'chatgpt', key, clientId: callback.clientId, subject: identity.sub, issuer: identity.iss,
          name: typeof identity.name === 'string' ? identity.name : '', email: typeof identity.email === 'string' ? identity.email : '',
          identity: 'signed_in', plan: credential.scopes.includes('chatgpt.tokens.use.direct') ? 'authorized_unverified' : 'not_granted' };
        await this.persist(previous => ({ profiles: previous.profiles }), () => !this.closed && !attempt.abort.signal.aborted, () => {
          this.credentials.set(key, credential);
          const existing = this.accounts.find(a => a.key === key); if (existing) Object.assign(existing, account); else this.accounts.push(account);
          this.activeKey = key; this.epoch++; this.notice = undefined;
          this.finish(attempt); this.changed(true);
        });
      } catch (e) {
        const messages = { registration: '无法保存客户端注册，请检查扩展的本地存储空间后重新授权。',
          exchange: '授权码兑换未完成，请重新开始授权。', identity: '身份凭据验证未完成，请重新授权。', account: '无法完成账号绑定或保存，请检查扩展的本地存储后重新授权。' };
        const error = e instanceof AppError ? e : new AppError(`auth_${stage}_failed`, messages[stage]);
        this.notice = `${error.message} [${error.code}]`; this.finish(attempt); this.changed(false); throw error;
      }
    })();
    this.processing = work;
    try { await work; } finally { if (this.processing === work) this.processing = undefined; }
  }
  private finish(attempt: Attempt): void {
    clearTimeout(attempt.timer); attempt.verifier = ''; attempt.state = ''; attempt.nonce = '';
    if (this.attempt === attempt) this.attempt = undefined;
  }
  cancel(): void {
    this.generation++; this.preparing = undefined;
    for (const abort of this.pendingWrites) abort.abort();
    if (this.attempt) { this.attempt.abort.abort(); this.finish(this.attempt); }
    this.changed(false);
  }
  async select(key: string): Promise<Status> {
    assert(!this.signingOut, 'auth_busy', '正在退出，请稍候再切换账号。');
    assert(!this.closed, 'session_closed', '翻译会话已结束。');
    const account = this.find(key); this.cancel(); const generation = this.generation; await this.processing?.catch(() => {});
    const valid = () => !this.closed && generation === this.generation;
    await this.persist(previous => ({ profiles: previous.profiles, activeKey: account.authType === 'api_key' ? key : undefined }), valid, () => {
      this.activeKey = key; this.epoch++; this.changed(true);
    });
    return this.status();
  }
  async mark(key: string, plan: PlanState, reauth = false): Promise<void> {
    const account = this.find(key); account.plan = plan; if (reauth) account.identity = 'reauth_required';
    if (account.authType === 'api_key' && plan === 'last_request_succeeded') this.notice = undefined;
    this.changed(false);
  }
  private async token(fields: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const timeout = AbortSignal.timeout(20_000);
    // Native Window.fetch must not receive the dependency object as its receiver.
    const request = this.deps.fetch;
    let response: Response;
    try {
      response = await request(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch {
      if (signal?.aborted) throw new AppError('cancelled', '登录已取消。');
      throw new AppError(timeout.aborted ? 'auth_exchange_timeout' : 'auth_exchange_network', timeout.aborted
        ? '连接 OpenAI 授权接口超时，请检查网络后重新授权。'
        : '无法连接 OpenAI 授权接口，请检查网络及扩展的 OpenAI 网站访问权限，然后重新授权。');
    }
    const data = await response.json().catch(() => undefined) as any;
    if (!response.ok) {
      const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
      if (code === 'invalid_client') throw new AppError('auth_invalid_client', 'OpenAI 未接受此客户端注册，需要检查注册配置。', response.status);
      throw new AppError(code === 'invalid_grant' ? 'reauth_required' : 'auth_unavailable',
        code === 'invalid_grant' ? '授权码或会话已失效，请重新授权；旧回调链接不能再次使用。' : `OpenAI 授权接口返回 HTTP ${response.status}，请稍后重新授权。`, response.status);
    }
    assert(data && typeof data === 'object' && !Array.isArray(data), 'auth_exchange_response', 'OpenAI 授权接口未返回有效 JSON，请检查网络是否返回了拦截页面。');
    return data;
  }
  async access(key: string): Promise<Credential> {
    assert(!this.closed, 'session_closed', '翻译会话已结束。');
    const account = this.find(key);
    const reauthMessage = account.authType === 'api_key' ? '请重新输入 API 密钥。' : '请重新登录。';
    assert(account.identity === 'signed_in', 'reauth_required', reauthMessage);
    const existing = this.refreshes.get(key); if (existing) return existing;
    const work = (async () => {
      const saved = this.credentials.get(key); assert(saved, 'reauth_required', '会话已结束，请重新登录。');
      if (saved.authType === 'api_key') {
        assert(account.authType === 'api_key' && saved.apiBaseUrl === account.apiBaseUrl, 'account_mismatch', 'API 配置与凭据不匹配。');
        return saved;
      }
      assert(account.authType === 'chatgpt', 'account_mismatch', '账号凭据类型不匹配。');
      assert(saved.scopes.includes('chatgpt.tokens.use.direct'), 'not_granted', '请先授权使用 ChatGPT 套餐。');
      if (saved.expiresAt > Date.now() + 60_000) return saved;
      assert(saved.refreshToken, 'reauth_required', '会话已过期，请重新授权。');
      const data = await this.token({ grant_type: 'refresh_token', client_id: saved.clientId, refresh_token: saved.refreshToken, resource: RESOURCE });
      const updated = credentialsFromResponse(data, saved.clientId, saved);
      if (data.id_token) {
        const identity = await this.deps.verify(data.id_token, saved.clientId);
        assert(identity.sub === account.subject && identity.iss === account.issuer, 'account_mismatch', '刷新后的账号身份不匹配。');
      }
      assert(!this.closed && this.credentials.get(key) === saved, 'session_closed', '翻译会话已结束。');
      this.credentials.set(key, updated);
      assert(updated.scopes.includes('chatgpt.tokens.use.direct'), 'not_granted', '套餐权限已撤销，请重新授权。');
      return updated;
    })().catch(e => {
      if (e instanceof AppError && e.code === 'reauth_required' && !this.closed) { account.identity = 'reauth_required'; this.changed(false); } throw e;
    }).finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, work); return work;
  }
  async logout(key: string): Promise<{ revoked: boolean }> {
    assert(!this.closed, 'session_closed', '翻译会话已结束。');
    assert(!this.signingOut, 'auth_busy', '正在退出，请稍候。');
    const account = this.find(key); this.signingOut = true; this.cancel(); await this.processing?.catch(() => {});
    if (account.authType === 'api_key') {
      const generation = this.generation;
      try {
        await this.persist(previous => ({ profiles: previous.profiles.filter(profile => profile.key !== key),
          activeKey: previous.activeKey === key ? undefined : previous.activeKey }), () => !this.closed && generation === this.generation, () => {
          this.credentials.delete(key); this.accounts = this.accounts.filter(value => value.key !== key);
          if (this.activeKey === key) this.activeKey = undefined;
          this.epoch++; this.notice = '已删除本地保存的 API 密钥；未撤销服务商平台上的密钥。';
          this.changed(true);
        });
        return { revoked: false };
      } finally { this.signingOut = false; this.changed(false); }
    }
    account.identity = 'signed_out'; this.epoch++; this.changed(true);
    await this.refreshes.get(key)?.catch(() => {});
    const saved = this.credentials.get(key); let revoked = false;
    try {
      if (saved?.authType === 'chatgpt' && saved.refreshToken) {
        const request = this.deps.fetch;
        const discovery = await request(`${ISSUER}/.well-known/openid-configuration`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) });
        const data = await discovery.json() as any;
        assert(discovery.ok && typeof data.revocation_endpoint === 'string' && new URL(data.revocation_endpoint).origin === ISSUER, 'invalid_discovery', '授权服务配置无效。');
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await request(data.revocation_endpoint, { method: 'POST', credentials: 'omit', redirect: 'error',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: saved.refreshToken, token_type_hint: 'refresh_token', client_id: saved.clientId }), signal: AbortSignal.timeout(10_000) });
            if (result.ok) { revoked = true; break; } if (result.status < 500) break;
          } catch { if (attempt === 1) break; }
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    } catch { /* Always finish local sign-out. */ }
    this.credentials.delete(key); account.plan = 'not_granted';
    this.notice = revoked ? undefined : '已退出本次会话，未确认远端撤销。可在 ChatGPT 设置中断开此应用。';
    this.signingOut = false; this.changed(false); return { revoked };
  }
  close(): void {
    this.closed = true; this.cancel(); this.credentials.clear(); this.accounts = []; this.profiles = { profiles: [] };
    this.activeKey = undefined; this.epoch++; this.changed(true);
  }
}
