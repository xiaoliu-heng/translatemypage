import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createIdentityVerifier } from '../src/core/identity';

const issuer = 'https://auth.openai.com';
async function fixture(extra: Record<string, unknown> = {}) {
  const pair = await generateKeyPair('RS256'); const jwk = await exportJWK(pair.publicKey); jwk.kid = 'fixture-key';
  const token = await new SignJWT({ sub: 'private-subject', iss: issuer, aud: 'issued-client', nonce: 'private-nonce',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(pair.privateKey);
  return { jwk, token };
}
function safe(error: any, code: string, secret: string) {
  assert.equal(error.code, code); assert(!error.message.includes(secret)); return true;
}

test('identity-key fetch omits browser cookies, rejects redirects, and allows a bounded network timeout', async () => {
  const f = await fixture(); let requests = 0;
  const verify = createIdentityVerifier((async (url, init) => {
    requests++; assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    return Response.json({ keys: [f.jwk] });
  }) as typeof fetch);
  assert.equal((await verify(f.token, 'issued-client', 'private-nonce')).sub, 'private-subject');
  await verify(f.token, 'issued-client', 'private-nonce'); assert.equal(requests, 1);
});

test('identity diagnostics distinguish unavailable keys, HTTP rejection, timeout and malformed responses', async () => {
  const f = await fixture();
  const cases: [string, typeof fetch][] = [
    ['identity_keys_network', (async () => { throw new TypeError('private-network-detail'); }) as typeof fetch],
    ['identity_keys_timeout', (async () => { throw new DOMException('private-timeout-detail', 'TimeoutError'); }) as typeof fetch],
    ['identity_keys_http', (async () => new Response('private-network-detail', { status: 403 })) as typeof fetch],
    ['identity_keys_invalid', (async () => new Response('<html>private-network-detail</html>')) as typeof fetch],
  ];
  for (const [code, request] of cases) {
    const verify = createIdentityVerifier(request);
    await assert.rejects(verify(f.token, 'issued-client', 'private-nonce'), error => safe(error, code, 'private-'));
  }
});

test('identity diagnostics preserve strict signature, account registration, issuer, expiry and nonce validation', async () => {
  const f = await fixture();
  const verify = createIdentityVerifier((async () => Response.json({ keys: [f.jwk] })) as typeof fetch);
  await assert.rejects(verify(f.token, 'other-client', 'private-nonce'), error => safe(error, 'identity_audience_mismatch', 'private-'));
  await assert.rejects(verify(f.token, 'issued-client', 'other-nonce'), error => safe(error, 'identity_nonce_mismatch', 'private-'));
  for (const [claims, code] of [[{ iss: 'https://private-issuer.invalid' }, 'identity_issuer_mismatch'], [{ exp: 1 }, 'identity_expired'], [{ nonce: undefined }, 'identity_nonce_mismatch']] as const) {
    const signed = await fixture(claims);
    const isolated = createIdentityVerifier((async () => Response.json({ keys: [signed.jwk] })) as typeof fetch);
    await assert.rejects(isolated(signed.token, 'issued-client', 'private-nonce'), error => safe(error, code, 'private-'));
  }
  const forged = await fixture();
  await assert.rejects(verify(forged.token, 'issued-client', 'private-nonce'), error => safe(error, 'identity_signature_invalid', 'private-'));
});
