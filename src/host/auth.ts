import { createServer, Server } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { Account, AppError, assert, Status, PlanState } from '../shared/protocol';
import { AccountStore, Credential, Vault } from './storage';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
export async function verifyIdentity(idToken: string, clientId: string, nonce?: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], algorithms: ['RS256'] });
  assert(payload.sub && (nonce === undefined || payload.nonce === nonce), 'invalid_identity', '登录身份校验失败。');
  return payload;
}
export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [url], { stdio: 'ignore' });
    c.on('error', () => reject(new AppError('browser_unavailable', '无法打开系统浏览器。')));
    c.on('close', code => code === 0 ? resolve() : reject(new AppError('browser_unavailable', '无法打开系统浏览器。')));
  });
}
export function credentialsFromResponse(t: any, clientId: string, previous?: Credential): Credential {
  assert(typeof t.access_token === 'string' && t.access_token.length > 0 && Number.isFinite(t.expires_in) && t.expires_in > 0 &&
    typeof t.token_type === 'string' && t.token_type.toLowerCase() === 'bearer', 'invalid_token_response', '授权服务返回了不完整的凭据。');
  const scopes = typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
  return { clientId, accessToken: t.access_token, refreshToken: t.refresh_token ?? previous?.refreshToken,
    idToken: t.id_token ?? previous?.idToken, expiresAt: Date.now() + t.expires_in * 1000, scopes };
}
interface Attempt { server: Server; timer: NodeJS.Timeout; abort: AbortController }
export interface AuthDependencies {
  fetch: typeof fetch; verify: typeof verifyIdentity; open: typeof openBrowser;
}
export class AuthManager {
  epoch = 1;
  private attempt?: Attempt;
  private preparing = false;
  private callback?: Promise<void>;
  private refreshes = new Map<string, Promise<Credential>>();
  private notice?: string;
  constructor(public store: AccountStore, private vault: Vault, private changed: (switched: boolean) => void,
    private deps: AuthDependencies = { fetch, verify: verifyIdentity, open: openBrowser }) {}
  status(): Status {
    return { accounts: this.store.data.accounts.map(a => ({ ...a })), activeKey: this.store.data.activeKey,
      accountEpoch: this.epoch, authorizing: !!this.attempt, notice: this.notice };
  }
  active(): Account | undefined { return this.store.data.accounts.find(a => a.key === this.store.data.activeKey); }
  private find(key: string): Account {
    const a = this.store.data.accounts.find(x => x.key === key); assert(a, 'account_missing', '账号不存在。'); return a;
  }
  async begin(key?: string, reconsent = false): Promise<{ pending: true }> {
    if (this.attempt || this.preparing) return { pending: true };
    this.preparing = true;
    try { await this.callback; return await this.startAuthorization(key, reconsent); }
    finally { this.preparing = false; }
  }
  private async startAuthorization(key?: string, reconsent = false): Promise<{ pending: true }> {
    const selected = key ? this.find(key) : undefined;
    const issuedClient = selected?.clientId || this.store.data.pendingClientId;
    const previous = selected ? await this.vault.get(selected.key) : undefined;
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const controller = new AbortController();
    let claimed = false;
    const server = createServer(async (req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (u.pathname !== '/auth/callback' || req.method !== 'GET') { res.writeHead(404).end(); return; }
      const received = Buffer.from(u.searchParams.get('state') || ''); const expected = Buffer.from(state);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) { res.writeHead(400).end('授权状态不匹配，请返回扩展重新登录。'); return; }
      if (claimed || controller.signal.aborted) { res.writeHead(409).end('此登录回调已处理。'); return; }
      claimed = true;
      // Never keep the browser waiting on an upstream network request; the extension receives completion.
      res.end('已收到授权，请回到 TranslateMyPage 扩展查看登录结果。');
      const work = (async () => {
      try {
        assert(!u.searchParams.has('error'), 'auth_declined', '登录已取消或授权未获同意。');
        const clientId = u.searchParams.get('client_id') || issuedClient;
        assert(clientId && clientId !== 'dynamic_agent_client' && (!issuedClient || clientId === issuedClient), 'invalid_client', '登录返回的客户端注册不匹配。');
        const code = u.searchParams.get('code'); assert(code, 'invalid_callback', '登录回调缺少授权码。');
        if (!selected) { this.store.data.pendingClientId = clientId; await this.store.save(); }
        const token = await this.token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }, controller.signal);
        const credential = credentialsFromResponse(token, clientId);
        assert(credential.idToken, 'invalid_identity', '授权服务未返回身份令牌。');
        const identity = await this.deps.verify(credential.idToken, clientId, nonce);
        assert(!selected || (identity.sub === selected.subject && identity.iss === selected.issuer), 'account_mismatch', '重新授权的账号与所选注册不一致。');
        assert(!controller.signal.aborted, 'cancelled', '登录已取消。');
        const existing = selected ?? this.store.data.accounts.find(a => a.clientId === clientId && a.subject === identity.sub && a.issuer === identity.iss);
        const account: Account = { key: existing?.key || randomUUID(), clientId, subject: identity.sub!, issuer: identity.iss!,
          name: typeof identity.name === 'string' ? identity.name : '', email: typeof identity.email === 'string' ? identity.email : '',
          identity: 'signed_in', plan: credential.scopes.includes('chatgpt.tokens.use.direct') ? 'authorized_unverified' : 'not_granted' };
        const oldCredential = existing ? await this.vault.get(account.key) : undefined;
        assert(!controller.signal.aborted, 'cancelled', '登录已取消。');
        await this.vault.set(account.key, credential);
        if (controller.signal.aborted) {
          if (oldCredential) await this.vault.set(account.key, oldCredential); else await this.vault.delete(account.key);
          throw new AppError('cancelled', '登录已取消。');
        }
        if (existing) Object.assign(existing, account); else this.store.data.accounts.push(account);
        if (this.store.data.pendingClientId === clientId) delete this.store.data.pendingClientId;
        this.store.data.activeKey = account.key; this.epoch++; this.notice = undefined;
        await this.store.save(); this.finishAttempt(server); this.changed(true);
      } catch (e) {
        this.notice = e instanceof AppError ? e.message : '登录校验失败，请重试。';
        this.finishAttempt(server); this.changed(false);
      }
      })();
      this.callback = work;
      await work;
      if (this.callback === work) this.callback = undefined;
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert(address && typeof address !== 'string', 'callback_failed', '无法启动登录回调。');
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const timer = setTimeout(() => { this.notice = '登录已超时，请重试。'; this.cancel(); }, 5 * 60_000);
    this.attempt = { server, timer, abort: controller }; this.notice = undefined; this.changed(false);
    const auth = new URL(`${ISSUER}/api/accounts/authorize`);
    const params: Record<string, string> = { client_id: issuedClient || 'dynamic_agent_client', ext_agent_host_id: this.store.data.hostId,
      response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
    if (!issuedClient) params.agent_name_hint = 'TranslateMyPage';
    if (selected && previous?.idToken) params.id_token_hint = previous.idToken;
    if (selected?.email) params.login_hint = selected.email;
    if (reconsent) params.prompt = 'consent';
    for (const [k, v] of Object.entries(params)) auth.searchParams.set(k, v);
    try { await this.deps.open(auth.toString()); } catch (e) { this.cancel(); throw e; }
    return { pending: true };
  }
  private finishAttempt(server?: Server): void { if (this.attempt && (!server || this.attempt.server === server)) { clearTimeout(this.attempt.timer); this.attempt.server.close(); this.attempt = undefined; } }
  cancel(): void { this.attempt?.abort.abort(); this.finishAttempt(); this.changed(false); }
  async select(key: string): Promise<Status> {
    this.find(key); this.cancel(); await this.callback;
    this.epoch++; this.store.data.activeKey = key;
    await this.store.save(); this.changed(true); return this.status();
  }
  async mark(key: string, plan: PlanState, reauth = false): Promise<void> {
    const a = this.find(key); a.plan = plan; if (reauth) a.identity = 'reauth_required';
    await this.store.save(); this.changed(false);
  }
  private async token(fields: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const response = await this.deps.fetch(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    const data = await response.json() as any;
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code;
      throw new AppError(code === 'invalid_grant' ? 'reauth_required' : 'auth_unavailable', code === 'invalid_grant' ? '会话已失效，请重新授权。' : '授权服务暂时不可用，请稍后重试。', response.status);
    }
    return data;
  }
  async access(key: string): Promise<Credential> {
    const account = this.find(key);
    assert(account.identity === 'signed_in', 'reauth_required', '请先登录或重新授权。');
    const existing = this.refreshes.get(key); if (existing) return existing;
    const work = (async () => {
      const saved = await this.vault.get(key); assert(saved, 'reauth_required', '本地凭据缺失，请重新登录。');
      assert(saved.scopes.includes('chatgpt.tokens.use.direct'), 'not_granted', '请在设置中授权使用 ChatGPT 套餐。');
      if (saved.expiresAt > Date.now() + 60_000) return saved;
      assert(saved.refreshToken, 'reauth_required', '会话已过期，请重新授权。');
      const data = await this.token({ grant_type: 'refresh_token', client_id: saved.clientId, refresh_token: saved.refreshToken, resource: RESOURCE });
      const updated = credentialsFromResponse(data, saved.clientId, saved);
      if (data.id_token) {
        const identity = await this.deps.verify(data.id_token, saved.clientId);
        assert(identity.sub === account.subject && identity.iss === account.issuer, 'account_mismatch', '刷新后的账号身份不匹配。');
      }
      await this.vault.set(key, updated);
      assert(updated.scopes.includes('chatgpt.tokens.use.direct'), 'not_granted', '套餐权限已撤销，请重新授权。');
      return updated;
    })().catch(async e => {
      if (e instanceof AppError && e.code === 'reauth_required') { account.identity = 'reauth_required'; await this.store.save(); this.changed(false); }
      throw e;
    }).finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, work); return work;
  }
  async logout(key: string): Promise<{ revoked: boolean }> {
    const account = this.find(key); this.cancel(); await this.callback;
    account.identity = 'signed_out'; this.epoch++; this.changed(true);
    // Wait for any rotation before revoking the latest refresh token.
    await this.refreshes.get(key)?.catch(() => {});
    const saved = await this.vault.get(key); let revoked = false;
    try {
      if (saved?.refreshToken) {
        const discovery = await this.deps.fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
        const d = await discovery.json() as any;
        assert(typeof d.revocation_endpoint === 'string' && new URL(d.revocation_endpoint).origin === ISSUER, 'invalid_discovery', '授权服务配置无效。');
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await this.deps.fetch(d.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: saved.refreshToken, token_type_hint: 'refresh_token', client_id: saved.clientId }), signal: AbortSignal.timeout(10_000) });
            if (r.status === 200) { revoked = true; break; }
            if (r.status < 500) break;
          } catch { if (attempt === 1) break; }
          await new Promise(r => setTimeout(r, 400));
        }
      }
    } catch { /* Local sign-out still completes if remote revocation is unavailable. */ }
    await this.vault.delete(key); account.identity = 'signed_out'; account.plan = 'not_granted';
    this.notice = revoked ? undefined : '已在本地退出，未确认远端撤销；可到 ChatGPT 设置中断开此应用。';
    await this.store.save(); this.changed(false); return { revoked };
  }
  async close(): Promise<void> {
    this.cancel(); await this.callback;
    await Promise.allSettled([...this.refreshes.values()]);
  }
}
