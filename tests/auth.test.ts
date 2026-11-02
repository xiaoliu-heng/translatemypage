import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { AuthDependencies, AuthManager, ISSUER, REDIRECT_URI, SCOPES, verifyIdentity } from '../src/core/auth';
import { newRegistration, RegistrationStore } from '../src/core/storage';
import { deferred, until } from './helpers';
import { AppError } from '../src/shared/protocol';

const tokens = (extra: object = {}) => ({ access_token: 'test-access', refresh_token: 'test-refresh', id_token: 'test-id', expires_in: 3600, token_type: 'Bearer', scope: SCOPES, ...extra });
function fixture(t: TestContext, overrides: Partial<AuthDependencies> = {}, saved?: RegistrationStore) {
  let opened!: URL, opens = 0;
  const snapshots: unknown[] = [];
  const store = saved || { data: newRegistration(), save: async () => { snapshots.push(structuredClone(store.data)); } };
  const deps: AuthDependencies = { open: async url => { opened = new URL(url); opens++; },
    verify: async (_token, client, nonce) => { assert.equal(client, 'oaiapp_issued'); if (nonce) assert.equal(nonce, opened.searchParams.get('nonce')); return { sub: 'user-1', iss: ISSUER, email: 'test@example.com' }; },
    fetch: (async () => Response.json(tokens())) as typeof fetch, ...overrides };
  const auth = new AuthManager(store, () => {}, deps);
  t.after(() => auth.close());
  const callback = (fields: Record<string, string> = {}) => {
    const url = new URL(opened.searchParams.get('redirect_uri')!);
    for (const [name, value] of Object.entries({ state: opened.searchParams.get('state')!, code: 'one-time-code', client_id: 'oaiapp_issued', ...fields })) url.searchParams.set(name, value);
    return url.toString();
  };
  return { auth, store, snapshots, callback, opened: () => opened, opens: () => opens };
}

test('manual OAuth binds the full loopback URI, PKCE and nonce; duplicate clicks and callbacks exchange once', async t => {
  let exchanges = 0;
  const f = fixture(t, { fetch: (async (_url, init) => {
    exchanges++; const body = init!.body as URLSearchParams;
    assert.equal(body.get('client_id'), 'oaiapp_issued'); assert.equal(body.get('redirect_uri'), REDIRECT_URI);
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), f.opened().searchParams.get('code_challenge'));
    assert.equal(f.store.data.pendingClientId, 'oaiapp_issued'); assert.equal(init!.credentials, 'omit'); assert.equal(init!.redirect, 'error');
    return Response.json(tokens());
  }) as typeof fetch });
  await Promise.all([f.auth.begin(), f.auth.begin()]);
  assert.equal(f.opens(), 1); assert.equal(f.opened().searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(f.opened().searchParams.get('agent_name_hint'), 'TranslateMyPage');
  assert.equal(f.opened().searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(f.auth.status().authorization!.redirectUri, REDIRECT_URI);
  await assert.rejects(f.auth.complete(f.callback({ state: 'other' })), (error: any) => error.code === 'state_mismatch');
  assert.equal(exchanges, 0);
  const raw = f.callback(); await f.auth.complete(raw);
  await assert.rejects(f.auth.complete(raw), (error: any) => error.code === 'no_pending_authorization');
  assert.equal(exchanges, 1); assert.equal(f.auth.active()!.plan, 'authorized_unverified');
  assert.equal(f.auth.status().authorizing, false);
  assert.equal((await f.auth.access(f.auth.active()!.key)).accessToken, 'test-access');
  const persisted = JSON.stringify(f.snapshots), publicState = JSON.stringify(f.auth.status());
  for (const secret of ['test-access', 'test-refresh', 'test-id', 'one-time-code', 'code_verifier', 'test@example.com']) assert(!persisted.includes(secret));
  for (const secret of ['test-access', 'test-refresh', 'test-id', 'one-time-code', f.opened().searchParams.get('state')!]) assert(!publicState.includes(secret));
});

test('identity without a granted plan scope remains signed in and cannot invoke inference', async t => {
  const f = fixture(t, { fetch: (async () => Response.json(tokens({ scope: 'openid profile email' }))) as typeof fetch });
  await f.auth.begin(); await f.auth.complete(f.callback());
  assert.equal(f.auth.active()!.identity, 'signed_in'); assert.equal(f.auth.active()!.plan, 'not_granted');
  await assert.rejects(f.auth.access(f.auth.active()!.key), (error: any) => error.code === 'not_granted');
});

test('failed initial exchange retains issued registration; next attempt reuses it with a fresh PKCE state', async t => {
  const f = fixture(t, { fetch: (async () => Response.json({ error: 'invalid_grant' }, { status: 400 })) as typeof fetch });
  await f.auth.begin(); const state = f.opened().searchParams.get('state');
  await assert.rejects(f.auth.complete(f.callback()), (error: any) => error.code === 'reauth_required');
  assert.equal(f.auth.active(), undefined); await f.auth.begin();
  assert.equal(f.opened().searchParams.get('client_id'), 'oaiapp_issued');
  assert.notEqual(f.opened().searchParams.get('state'), state); assert.equal(f.opened().searchParams.has('agent_name_hint'), false);
});

test('browser-compatible transport signs in, refreshes once, and revokes the latest rotating token on sign-out', async t => {
  let refreshes = 0;
  const f = fixture(t, { fetch: (async function (this: unknown, url, init) {
    // Native Window.fetch rejects arbitrary receivers; Node's fetch does not.
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    if (String(url).endsWith('openid-configuration')) return Response.json({ revocation_endpoint: `${ISSUER}/revoke` });
    if (String(url).endsWith('/revoke')) { assert.equal((init!.body as URLSearchParams).get('token'), 'rotated-refresh'); return new Response(null, { status: 200 }); }
    const body = init!.body as URLSearchParams;
    if (body.get('grant_type') === 'refresh_token') {
      refreshes++; await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(body.has('scope'), false); assert.equal(body.get('resource'), 'https://api.openai.com/v1');
      return Response.json(tokens({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', id_token: undefined, scope: undefined }));
    }
    return Response.json(tokens({ expires_in: 1 }));
  }) as typeof fetch });
  await f.auth.begin(); await f.auth.complete(f.callback()); const key = f.auth.active()!.key;
  const values = await Promise.all(Array.from({ length: 8 }, () => f.auth.access(key)));
  assert.equal(refreshes, 1); assert(values.every(value => value.accessToken === 'rotated-access'));
  assert.equal((await f.auth.logout(key)).revoked, true); assert.equal(f.auth.active()!.identity, 'signed_out');
  await assert.rejects(f.auth.access(key)); assert.equal(f.store.data.lastClientId, 'oaiapp_issued');
});

test('cancel during code exchange discards its result and never restores credentials', async t => {
  const gate = deferred<Response>(); let requested = false;
  const f = fixture(t, { fetch: (async () => { requested = true; return gate.promise; }) as typeof fetch });
  await f.auth.begin(); const complete = f.auth.complete(f.callback());
  await until(() => requested); f.auth.cancel(); gate.resolve(Response.json(tokens()));
  await assert.rejects(complete); assert.equal(f.auth.active(), undefined); assert.equal(f.auth.status().authorizing, false);
});

test('session close clears memory; a new runtime reuses registration but requires a new authorization', async t => {
  const f = fixture(t); await f.auth.begin(); await f.auth.complete(f.callback()); const key = f.auth.active()!.key;
  f.auth.close(); assert.deepEqual(f.auth.status().accounts, []); await assert.rejects(f.auth.access(key));
  const next = fixture(t, {}, f.store); assert.deepEqual(next.auth.status().accounts, []);
  await next.auth.begin(); assert.equal(next.opened().searchParams.get('client_id'), 'oaiapp_issued');
  await next.auth.complete(next.callback()); assert.equal(next.auth.active()!.key, key);
});

test('reauthorization rejects client or subject substitution and preserves the active credential', async t => {
  let subject = 'user-1';
  const f = fixture(t, { verify: async () => ({ sub: subject, iss: ISSUER }) });
  await f.auth.begin(); await f.auth.complete(f.callback()); const key = f.auth.active()!.key;
  await f.auth.begin(key);
  await assert.rejects(f.auth.complete(f.callback({ client_id: 'another-client' })), (error: any) => error.code === 'client_mismatch');
  f.auth.cancel(); await f.auth.begin(key); subject = 'other-user';
  await assert.rejects(f.auth.complete(f.callback()), (error: any) => error.code === 'account_mismatch');
  assert.equal((await f.auth.access(key)).accessToken, 'test-access');
});

test('unconfirmed remote revocation still clears local access and reports the limit', async t => {
  const f = fixture(t, { fetch: (async (url) => String(url).includes('openid-configuration') ? Response.json({ revocation_endpoint: 'https://attacker.invalid/revoke' }) : Response.json(tokens())) as typeof fetch });
  await f.auth.begin(); await f.auth.complete(f.callback()); const key = f.auth.active()!.key;
  assert.equal((await f.auth.logout(key)).revoked, false); await assert.rejects(f.auth.access(key));
  assert.match(f.auth.status().notice!, /未确认远端撤销/);
});

test('signed identity verification checks JWKS signature, issuer, audience, expiry and nonce', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256'); const jwk = await exportJWK(publicKey); jwk.kid = 'test-key';
  const previous = globalThis.fetch;
  globalThis.fetch = (async url => {
    assert.equal(String(url), `${ISSUER}/.well-known/jwks.json`);
    return Response.json({ keys: [jwk] });
  }) as typeof fetch;
  try {
    const sign = (extra: Record<string, unknown> = {}) => new SignJWT({ sub: 'user', iss: ISSUER, aud: 'issued-client', nonce: 'bound-nonce', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...extra })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
    assert.equal((await verifyIdentity(await sign(), 'issued-client', 'bound-nonce')).sub, 'user');
    for (const extra of [{ nonce: 'another' }, { aud: 'another' }, { iss: 'https://attacker.invalid' }, { exp: 1 }])
      await assert.rejects(verifyIdentity(await sign(extra), 'issued-client', 'bound-nonce'));
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'user', iss: ISSUER, aud: 'issued-client', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, nonce: 'bound-nonce' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(other.privateKey);
    await assert.rejects(verifyIdentity(forged, 'issued-client', 'bound-nonce'));
  } finally { globalThis.fetch = previous; }
});

test('a second pasted callback cannot invalidate the code exchange already in progress', async t => {
  const gate = deferred<Response>(); let started = false;
  const f = fixture(t, { fetch: (async () => { started = true; return gate.promise; }) as typeof fetch });
  await f.auth.begin(); const callback = f.callback(); const first = f.auth.complete(callback);
  await until(() => started);
  await assert.rejects(f.auth.complete(callback), (error: any) => error.code === 'no_pending_authorization');
  gate.resolve(Response.json(tokens())); await first;
  assert.equal(f.auth.active()!.identity, 'signed_in');
});

test('library exceptions never expose credential-bearing diagnostics in the session UI', async t => {
  const f = fixture(t, { fetch: (async () => { throw new Error('raw-private-authorization-data'); }) as typeof fetch });
  await f.auth.begin();
  await assert.rejects(f.auth.complete(f.callback()), (error: any) => error.code === 'auth_exchange_network' && !error.message.includes('raw-private'));
  assert(!JSON.stringify(f.auth.status()).includes('raw-private'));
});

test('token exchange failures retain safe status and stage diagnostics rather than a generic authentication failure', async t => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ['auth_exchange_network', () => { throw new TypeError('private-code-and-verifier'); }],
    ['auth_unavailable', () => new Response('<html>private-code-and-verifier</html>', { status: 403 })],
    ['auth_exchange_response', () => new Response('<html>private-code-and-verifier</html>')],
    ['auth_exchange_response', () => Response.json(null)],
    ['auth_invalid_client', () => Response.json({ error: 'invalid_client', error_description: 'private-code-and-verifier' }, { status: 401 })],
  ];
  for (const [code, response] of cases) {
    const f = fixture(t, { fetch: (async () => response()) as typeof fetch });
    await f.auth.begin(); await assert.rejects(f.auth.complete(f.callback()), (error: any) => error.code === code && !error.message.includes('private-'));
    assert(f.auth.status().notice!.includes(`[${code}]`)); assert(!f.auth.status().notice!.includes('private-'));
    assert.equal(f.auth.status().authorizing, false); assert.equal(f.auth.active(), undefined);
    assert.equal(f.store.data.pendingClientId, 'oaiapp_issued');
  }
});

test('registration storage errors are identified before sending a one-time code to the provider', async t => {
  const store: RegistrationStore = { data: newRegistration(), save: async () => { throw new Error('private-storage-detail'); } };
  let requests = 0;
  const f = fixture(t, { fetch: (async () => { requests++; return Response.json(tokens()); }) as typeof fetch }, store);
  await f.auth.begin();
  await assert.rejects(f.auth.complete(f.callback()), (error: any) => error.code === 'auth_registration_failed' && !error.message.includes('private-'));
  assert.equal(requests, 0); assert(f.auth.status().notice!.includes('auth_registration_failed'));
});

test('API keys stay in local credentials, never in public status or registration storage, and disconnect without OAuth', async t => {
  let requests = 0;
  const f = fixture(t, { fetch: async () => { requests++; throw new Error('OAuth must not be used'); } });
  const before = JSON.stringify(f.store.data);
  const secret = 'personal-key-PRIVATE-KEY-MATERIAL';
  await f.auth.useApiKey(`  ${secret}  `);
  const account = f.auth.active()!;
  assert.equal(account.authType, 'api_key'); assert.equal(account.identity, 'signed_in');
  assert.equal(account.plan, 'authorized_unverified');
  assert.equal('clientId' in account, false); assert.equal('email' in account, false);
  assert.equal('subject' in account, false); assert.equal('issuer' in account, false);
  assert.deepEqual(await f.auth.access(account.key), { authType: 'api_key', accessToken: secret });
  const publicData = JSON.stringify({ status: f.auth.status(), registrations: f.store.data, snapshots: f.snapshots });
  assert.equal(publicData.includes(secret), false); assert.equal(publicData.includes('PRIVATE-KEY-MATERIAL'), false);
  assert.equal(f.snapshots.length, 0);
  assert.equal(f.opens(), 0); assert.equal(requests, 0);
  await f.auth.mark(account.key, 'last_request_succeeded');
  assert.equal(f.auth.status().notice, undefined);
  assert.equal((await f.auth.logout(account.key)).revoked, false);
  assert.equal(f.auth.active()!.identity, 'signed_out'); assert.equal(f.auth.active()!.plan, 'not_granted');
  await assert.rejects(f.auth.access(account.key), (error: unknown) => error instanceof AppError && error.code === 'reauth_required');
  assert.match(f.auth.status().notice!, /未撤销平台密钥/);
  assert.equal(requests, 0); assert.equal(JSON.stringify(f.store.data), before);
});

test('API identities are stable for reused keys and isolate distinct keys across account switches and runtimes', async t => {
  const f = fixture(t);
  await f.auth.useApiKey('first-personal-key'); const first = f.auth.active()!.key;
  await f.auth.useApiKey('second-personal-key'); const second = f.auth.active()!.key;
  assert.notEqual(first, second); assert.equal(f.auth.status().accounts.length, 2);
  await f.auth.select(first);
  assert.equal((await f.auth.access(first)).accessToken, 'first-personal-key');
  await f.auth.useApiKey(' second-personal-key ');
  assert.equal(f.auth.active()!.key, second); assert.equal(f.auth.status().accounts.length, 2);
  await f.auth.logout(second); await f.auth.useApiKey('second-personal-key');
  assert.equal(f.auth.active()!.key, second); assert.equal(f.auth.status().accounts.length, 2);
  f.auth.close();
  const next = fixture(t, {}, f.store);
  assert.deepEqual(next.auth.status().accounts, []);
  await assert.rejects(next.auth.access(first));
  await next.auth.useApiKey('first-personal-key'); assert.equal(next.auth.active()!.key, first);
});

test('invalid API key input leaves the active credential and pending OAuth unchanged without assuming a key prefix', async t => {
  const f = fixture(t);
  await f.auth.useApiKey('not-an-sk-prefixed-key');
  const account = f.auth.active()!;
  await f.auth.begin(); const authorization = f.auth.status().authorization;
  for (const raw of ['', ' \t\n ', 'key with space', 'key\twith-tab', 'key\nwith-newline', 'key\u0000control', 'key\u007fcontrol', 'x'.repeat(4097)]) {
    await assert.rejects(f.auth.useApiKey(raw), (error: unknown) => error instanceof AppError && error.code === 'invalid_api_key');
    assert.equal(f.auth.active()!.key, account.key);
    assert.equal((await f.auth.access(account.key)).accessToken, 'not-an-sk-prefixed-key');
    assert.deepEqual(f.auth.status().authorization, authorization);
  }
});

test('API account reauthorization never opens OAuth and mixed account switching preserves each credential', async t => {
  const f = fixture(t);
  await f.auth.begin(); await f.auth.complete(f.callback()); const chatgpt = f.auth.active()!.key;
  assert.equal(f.auth.active()!.authType, 'chatgpt');
  await f.auth.useApiKey('personal-key'); const api = f.auth.active()!.key;
  await assert.rejects(f.auth.begin(api), (error: unknown) => error instanceof AppError && error.code === 'invalid_auth_type');
  assert.equal(f.opens(), 1);
  await f.auth.select(chatgpt); assert.equal((await f.auth.access(chatgpt)).accessToken, 'test-access');
  await f.auth.select(api); assert.equal((await f.auth.access(api)).accessToken, 'personal-key');
  assert.equal(f.auth.active()!.authType, 'api_key');
});

test('connecting an API key cancels OAuth preparation and does not leave a usable callback', async t => {
  const f = fixture(t);
  const preparing = f.auth.begin();
  const connecting = f.auth.useApiKey('personal-key');
  await assert.rejects(preparing, (error: unknown) => error instanceof AppError && error.code === 'cancelled');
  await connecting;
  assert.equal(f.opens(), 0); assert.equal(f.auth.status().authorizing, false);
  await assert.rejects(f.auth.complete('http://127.0.0.1:1455/auth/callback?code=old&state=old'),
    (error: unknown) => error instanceof AppError && error.code === 'no_pending_authorization');
  assert.equal(f.auth.active()!.authType, 'api_key');
});

test('API connection waits for cancelled in-flight OAuth processing and discards its late credentials', async t => {
  const gate = deferred<Response>(); let requested = false;
  const f = fixture(t, { fetch: async () => { requested = true; return gate.promise; } });
  await f.auth.begin(); const completing = f.auth.complete(f.callback());
  await until(() => requested);
  const rejected = assert.rejects(completing);
  const connecting = f.auth.useApiKey('personal-key');
  assert.equal(f.auth.active(), undefined);
  gate.resolve(Response.json(tokens())); await rejected; await connecting;
  assert.equal(f.auth.status().accounts.length, 1);
  assert.equal(f.auth.active()!.authType, 'api_key');
  assert.equal((await f.auth.access(f.auth.active()!.key)).accessToken, 'personal-key');
});

test('cancel, close, account switch, OAuth and replacement key all invalidate an API digest already in flight', async t => {
  for (const action of ['cancel', 'close', 'select', 'oauth', 'replace'] as const) {
    const f = fixture(t);
    await f.auth.useApiKey('existing-personal-key'); const existing = f.auth.active()!.key;
    const original = crypto.subtle.digest;
    const gate = deferred<void>(); let started = false;
    crypto.subtle.digest = async function (algorithm, data) {
      if (!started) { started = true; await gate.promise; }
      return original.call(this, algorithm, data);
    };
    try {
      const connecting = f.auth.useApiKey('cancelled-personal-key');
      const rejected = assert.rejects(connecting, (error: unknown) => error instanceof AppError && error.code === 'cancelled');
      await until(() => started);
      if (action === 'cancel') f.auth.cancel();
      else if (action === 'close') f.auth.close();
      else if (action === 'select') await f.auth.select(existing);
      else if (action === 'oauth') await f.auth.begin();
      else await f.auth.useApiKey('replacement-personal-key');
      gate.resolve(); await rejected;
      if (action === 'close') assert.deepEqual(f.auth.status().accounts, []);
      else {
        assert.equal(f.auth.status().accounts.length, action === 'replace' ? 2 : 1);
        assert.equal((await f.auth.access(f.auth.active()!.key)).accessToken,
          action === 'replace' ? 'replacement-personal-key' : 'existing-personal-key');
      }
    } finally { gate.resolve(); crypto.subtle.digest = original; f.auth.close(); }
  }
});

test('a closed session rejects API configuration without restoring any account or registration secret', async t => {
  const f = fixture(t); f.auth.close();
  await assert.rejects(f.auth.useApiKey('personal-key'), (error: unknown) => error instanceof AppError && error.code === 'session_closed');
  assert.deepEqual(f.auth.status().accounts, []); assert.equal(f.snapshots.length, 0);
});
