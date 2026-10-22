import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { AuthDependencies, AuthManager, ISSUER, REDIRECT_URI, SCOPES, verifyIdentity } from '../src/core/auth';
import { newRegistration, RegistrationStore } from '../src/core/storage';
import { deferred, until } from './helpers';

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

test('refresh is single-flight; sign-out revokes the latest rotating token and clears the session', async t => {
  let refreshes = 0;
  const f = fixture(t, { fetch: (async (url, init) => {
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
  await assert.rejects(f.auth.complete(f.callback()), (error: any) => error.code === 'auth_failed' && !error.message.includes('raw-private'));
  assert(!JSON.stringify(f.auth.status()).includes('raw-private'));
});
