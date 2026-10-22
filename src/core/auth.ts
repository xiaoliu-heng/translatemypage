import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { Account, AppError, assert, PlanState, Status } from '../shared/protocol';
import { consumeCallback, PendingAuthorization, CallbackError } from './callback';
import { digest, RegistrationStore } from './storage';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
export async function verifyIdentity(idToken: string, clientId: string, nonce?: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], algorithms: ['RS256'] });
  assert(payload.sub && (nonce === undefined || payload.nonce === nonce), 'invalid_identity', '登录身份校验失败，请重新登录。');
  return payload;
}
export interface Credential {
  clientId: string; accessToken: string; refreshToken?: string; idToken?: string;
  scopes: string[]; expiresAt: number;
}
export function credentialsFromResponse(t: any, clientId: string, previous?: Credential): Credential {
  assert(typeof t.access_token === 'string' && t.access_token.length > 0 && Number.isFinite(t.expires_in) && t.expires_in > 0 &&
    typeof t.token_type === 'string' && t.token_type.toLowerCase() === 'bearer' &&
    (t.refresh_token === undefined || typeof t.refresh_token === 'string') && (t.id_token === undefined || typeof t.id_token === 'string'),
  'invalid_token_response', '授权服务返回了不完整的凭据。');
  return { clientId, accessToken: t.access_token, refreshToken: t.refresh_token ?? previous?.refreshToken,
    idToken: t.id_token ?? previous?.idToken, expiresAt: Date.now() + t.expires_in * 1000,
    scopes: typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [] };
}
export interface AuthDependencies { fetch: typeof fetch; verify: typeof verifyIdentity; open(url: string): Promise<void> }
interface Attempt extends PendingAuthorization {
  selected?: Account; timer: ReturnType<typeof setTimeout>; abort: AbortController;
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
  constructor(private registrations: RegistrationStore, private changed: (switched: boolean) => void, private deps: AuthDependencies) {}
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
    const generation = this.generation;
    const work = (async () => {
      await this.processing;
      const selected = key ? this.find(key) : undefined;
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
    const work = (async () => {
      try {
        // Preserve an issued registration even if the one-time code exchange fails.
        if (!this.registrations.data.bindings[callback.clientId]) this.registrations.data.pendingClientId = callback.clientId;
        await this.registrations.save();
        attempt.abort.signal.throwIfAborted();
        const response = await this.token({ grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code,
          code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }, attempt.abort.signal);
        const credential = credentialsFromResponse(response, callback.clientId);
        assert(credential.idToken, 'invalid_identity', '授权服务未返回身份令牌。');
        const identity = await this.deps.verify(credential.idToken, callback.clientId, attempt.nonce);
        assert(identity.sub && identity.iss === ISSUER, 'invalid_identity', '登录身份校验失败。');
        const subjectHash = await digest([identity.iss, identity.sub]);
        const bound = this.registrations.data.bindings[callback.clientId];
        assert(!bound || bound === subjectHash, 'account_mismatch', '返回的身份与已有注册不一致，请选择原账号或添加其他账号。');
        assert(!attempt.selected || (identity.sub === attempt.selected.subject && identity.iss === attempt.selected.issuer), 'account_mismatch', '重新授权的账号与所选账号不一致。');
        const key = await digest([callback.clientId, identity.iss, identity.sub]);
        attempt.abort.signal.throwIfAborted();
        this.registrations.data.bindings[callback.clientId] = subjectHash;
        this.registrations.data.lastClientId = callback.clientId; delete this.registrations.data.pendingClientId; await this.registrations.save();
        attempt.abort.signal.throwIfAborted();
        const account: Account = { key, clientId: callback.clientId, subject: identity.sub, issuer: identity.iss,
          name: typeof identity.name === 'string' ? identity.name : '', email: typeof identity.email === 'string' ? identity.email : '',
          identity: 'signed_in', plan: credential.scopes.includes('chatgpt.tokens.use.direct') ? 'authorized_unverified' : 'not_granted' };
        this.credentials.set(key, credential);
        const existing = this.accounts.find(a => a.key === key); if (existing) Object.assign(existing, account); else this.accounts.push(account);
        this.activeKey = key; this.epoch++; this.notice = undefined;
        this.finish(attempt); this.changed(true);
      } catch (e) {
        this.notice = e instanceof AppError ? e.message : '登录验证未完成，请重新授权。'; this.finish(attempt); this.changed(false);
        throw e instanceof AppError ? e : new AppError('auth_failed', this.notice);
      }
    })();
    this.processing = work;
    try { await work; } finally { if (this.processing === work) this.processing = undefined; }
  }
  private finish(attempt: Attempt): void {
    clearTimeout(attempt.timer); attempt.verifier = ''; attempt.state = ''; attempt.nonce = '';
    if (this.attempt === attempt) this.attempt = undefined;
  }
  cancel(): void { this.generation++; if (this.attempt) { this.attempt.abort.abort(); this.finish(this.attempt); } this.changed(false); }
  async select(key: string): Promise<Status> {
    assert(!this.signingOut, 'auth_busy', '正在退出，请稍候再切换账号。');
    this.find(key); this.cancel(); await this.processing?.catch(() => {});
    this.activeKey = key; this.epoch++; this.changed(true); return this.status();
  }
  async mark(key: string, plan: PlanState, reauth = false): Promise<void> {
    const account = this.find(key); account.plan = plan; if (reauth) account.identity = 'reauth_required'; this.changed(false);
  }
  private async token(fields: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const response = await this.deps.fetch(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    const data = await response.json() as any;
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code;
      throw new AppError(code === 'invalid_grant' ? 'reauth_required' : 'auth_unavailable',
        code === 'invalid_grant' ? '授权码或会话已失效，请重新授权。' : '授权服务暂时不可用，请稍后重试。', response.status);
    }
    return data;
  }
  async access(key: string): Promise<Credential> {
    assert(!this.closed, 'session_closed', '翻译会话已结束。');
    const account = this.find(key); assert(account.identity === 'signed_in', 'reauth_required', '请重新登录。');
    const existing = this.refreshes.get(key); if (existing) return existing;
    const work = (async () => {
      const saved = this.credentials.get(key); assert(saved, 'reauth_required', '会话已结束，请重新登录。');
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
    assert(!this.signingOut, 'auth_busy', '正在退出，请稍候。');
    const account = this.find(key); this.signingOut = true; this.cancel(); await this.processing?.catch(() => {});
    account.identity = 'signed_out'; this.epoch++; this.changed(true);
    await this.refreshes.get(key)?.catch(() => {});
    const saved = this.credentials.get(key); let revoked = false;
    try {
      if (saved?.refreshToken) {
        const discovery = await this.deps.fetch(`${ISSUER}/.well-known/openid-configuration`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) });
        const data = await discovery.json() as any;
        assert(discovery.ok && typeof data.revocation_endpoint === 'string' && new URL(data.revocation_endpoint).origin === ISSUER, 'invalid_discovery', '授权服务配置无效。');
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await this.deps.fetch(data.revocation_endpoint, { method: 'POST', credentials: 'omit', redirect: 'error',
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
    this.closed = true; this.cancel(); this.credentials.clear(); this.accounts = []; this.activeKey = undefined; this.epoch++; this.changed(true);
  }
}
