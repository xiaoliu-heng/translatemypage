import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AuthManager, ISSUER, SCOPES } from '../src/host/auth';
import { AccountStore } from '../src/host/storage';
import { account, MemoryVault, temporary, until } from './helpers';
test('OAuth uses a real temporary loopback, PKCE, state and issued client id; duplicate clicks share an attempt', async () => {
  const tmp = await temporary(), store = new AccountStore(tmp.dir); await store.init(); const vault = new MemoryVault();
  let opened: URL | undefined, exchanges = 0;
  const auth = new AuthManager(store, vault, () => {}, { open: async u => { opened = new URL(u); }, verify: async (_t, client, nonce) => {
    assert.equal(client, 'oaiapp_issued'); assert.equal(nonce, opened!.searchParams.get('nonce')); return { sub: 'verified-subject', iss: ISSUER, email: 'test@example.com' };
  }, fetch: (async (_url: string, init: RequestInit) => {
    exchanges++; const body = init.body as URLSearchParams;
    assert.equal(body.get('client_id'), 'oaiapp_issued'); assert.equal(body.get('redirect_uri'), opened!.searchParams.get('redirect_uri'));
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), opened!.searchParams.get('code_challenge'));
    return Response.json({ access_token: 'access', refresh_token: 'refresh', id_token: 'id', expires_in: 3600, token_type: 'Bearer', scope: SCOPES });
  }) as any });
  try {
    await Promise.all([auth.begin(), auth.begin()]);
    assert.equal(opened!.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(opened!.searchParams.get('agent_name_hint'), 'TranslateMyPage');
    const callback = new URL(opened!.searchParams.get('redirect_uri')!); assert.equal(callback.hostname, '127.0.0.1'); assert.equal(callback.pathname, '/auth/callback');
    callback.searchParams.set('state', 'wrong'); assert.equal((await fetch(callback)).status, 400); assert.equal(exchanges, 0);
    callback.searchParams.set('state', opened!.searchParams.get('state')!); callback.searchParams.set('code', 'code'); callback.searchParams.set('client_id', 'oaiapp_issued');
    await fetch(callback); await until(() => auth.status().accounts.length === 1 && !auth.status().authorizing);
    assert.equal(exchanges, 1); assert.equal(auth.active()!.subject, 'verified-subject'); assert.equal(auth.active()!.plan, 'authorized_unverified');
    assert.equal((await vault.get(auth.active()!.key))!.accessToken, 'access');
    await assert.rejects(fetch(callback));
    const hostId = store.data.hostId;
    await auth.begin(auth.active()!.key);
    assert.equal(opened!.searchParams.get('client_id'), 'oaiapp_issued'); assert.equal(opened!.searchParams.get('ext_agent_host_id'), hostId);
    assert.equal(opened!.searchParams.get('id_token_hint'), 'id'); assert.equal(opened!.searchParams.has('agent_name_hint'), false);
    auth.cancel(); assert.equal(auth.active()!.identity, 'signed_in');
  } finally { await auth.close(); await store.close(); await tmp.remove(); }
});
test('missing plan scope retains verified identity but disables inference', async () => {
  const tmp = await temporary(), store = new AccountStore(tmp.dir); await store.init(); const vault = new MemoryVault(); let opened!: URL;
  const auth = new AuthManager(store, vault, () => {}, { open: async u => { opened = new URL(u); }, verify: async () => ({ sub: 'u', iss: ISSUER }),
    fetch: (async () => Response.json({ access_token: 'a', id_token: 'id', expires_in: 3600, token_type: 'Bearer', scope: 'openid profile email' })) as any });
  try {
    await auth.begin(); const cb = new URL(opened.searchParams.get('redirect_uri')!);
    for (const [k, v] of Object.entries({ state: opened.searchParams.get('state')!, code: 'c', client_id: 'issued' })) cb.searchParams.set(k, v);
    await fetch(cb); await until(() => !auth.status().authorizing);
    assert.equal(auth.active()!.identity, 'signed_in'); assert.equal(auth.active()!.plan, 'not_granted');
    await assert.rejects(auth.access(auth.active()!.key), (e: any) => e.code === 'not_granted');
  } finally { await auth.close(); await store.close(); await tmp.remove(); }
});
test('rotating token refresh is single-flight and revocation clears secrets but retains registration', async () => {
  const tmp = await temporary(), store = new AccountStore(tmp.dir); await store.init(); const vault = new MemoryVault();
  store.data.accounts.push(account()); store.data.activeKey = 'account-1';
  await vault.set('account-1', { clientId: 'oaiapp_example', accessToken: 'old', refreshToken: 'r1', idToken: 'old-id', expiresAt: 0, scopes: SCOPES.split(' ') });
  let refreshes = 0;
  const auth = new AuthManager(store, vault, () => {}, { open: async () => {}, verify: async () => ({ sub: 'user-1', iss: ISSUER }), fetch: (async (url: string, init?: RequestInit) => {
    if (url.endsWith('openid-configuration')) return Response.json({ revocation_endpoint: `${ISSUER}/revoke` });
    if (url.endsWith('/revoke')) { assert.equal((init!.body as URLSearchParams).get('token'), 'r2'); return new Response(null, { status: 200 }); }
    refreshes++; await new Promise(r => setTimeout(r, 20));
    assert.equal((init!.body as URLSearchParams).has('scope'), false);
    return Response.json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600, token_type: 'Bearer' });
  }) as any });
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => auth.access('account-1')));
    assert.equal(refreshes, 1); assert.ok(results.every(r => r.accessToken === 'new'));
    assert.equal((await auth.logout('account-1')).revoked, true); assert.equal(vault.values.size, 0);
    assert.equal(store.data.accounts[0].clientId, 'oaiapp_example'); assert.equal(store.data.accounts[0].identity, 'signed_out');
  } finally { await auth.close(); await store.close(); await tmp.remove(); }
});
test('namespace lock prevents two assistants racing one rotating session', async () => {
  const tmp = await temporary(), a = new AccountStore(tmp.dir), b = new AccountStore(tmp.dir);
  try { await a.init(); await assert.rejects(b.init(), (e: any) => e.code === 'host_busy'); }
  finally { await a.close(); await tmp.remove(); }
});
test('a failed initial code exchange retains the issued registration for the next authorization', async () => {
  const tmp = await temporary(), store = new AccountStore(tmp.dir); await store.init(); let opened!: URL;
  const auth = new AuthManager(store, new MemoryVault(), () => {}, { open: async u => { opened = new URL(u); }, verify: async () => ({ sub: 'u', iss: ISSUER }),
    fetch: (async () => Response.json({ error: 'invalid_grant' }, { status: 400 })) as any });
  try {
    await auth.begin(); const callback = new URL(opened.searchParams.get('redirect_uri')!);
    for (const [k, v] of Object.entries({ state: opened.searchParams.get('state')!, code: 'expired', client_id: 'oaiapp_retained' })) callback.searchParams.set(k, v);
    await fetch(callback); await until(() => !auth.status().authorizing);
    assert.equal(auth.status().accounts.length, 0); await auth.begin();
    assert.equal(opened.searchParams.get('client_id'), 'oaiapp_retained'); assert.equal(opened.searchParams.has('agent_name_hint'), false);
  } finally { await auth.close(); await store.close(); await tmp.remove(); }
});
test('reauthorization rejects a different issued client and preserves the existing account credentials', async () => {
  const tmp = await temporary(), store = new AccountStore(tmp.dir); await store.init(); const vault = new MemoryVault(); let opened!: URL, exchanges = 0;
  store.data.accounts.push(account()); store.data.activeKey = 'account-1';
  await vault.set('account-1', { clientId: 'oaiapp_example', accessToken: 'original', expiresAt: Infinity, scopes: SCOPES.split(' ') });
  const auth = new AuthManager(store, vault, () => {}, { open: async u => { opened = new URL(u); }, verify: async () => ({}),
    fetch: (async () => { exchanges++; throw new Error(); }) as any });
  try {
    await auth.begin('account-1'); const callback = new URL(opened.searchParams.get('redirect_uri')!);
    for (const [k, v] of Object.entries({ state: opened.searchParams.get('state')!, code: 'c', client_id: 'oaiapp_wrong' })) callback.searchParams.set(k, v);
    await fetch(callback); await until(() => !auth.status().authorizing);
    assert.equal(exchanges, 0); assert.equal((await vault.get('account-1'))!.accessToken, 'original');
    assert.equal(auth.active()!.identity, 'signed_in');
  } finally { await auth.close(); await store.close(); await tmp.remove(); }
});
