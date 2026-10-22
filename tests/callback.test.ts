import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeCallback, PendingAuthorization } from '../src/core/callback';

const time = 100_000;
const attempt = (extra: Partial<PendingAuthorization> = {}): PendingAuthorization => ({ redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 'bound-state', nonce: 'bound-nonce', verifier: 'private-verifier', createdAt: time, consumed: false, ...extra });
const callback = 'http://127.0.0.1:1455/auth/callback?code=one-time-code&state=bound-state&client_id=oaiapp_test';

test('manual callback is bound to a pending PKCE attempt and consumed only once', () => {
  const pending = attempt();
  assert.deepEqual(consumeCallback(callback, pending, time), { code: 'one-time-code', clientId: 'oaiapp_test' });
  assert.throws(() => consumeCallback(callback, pending, time), /no_pending_authorization/);
  assert.throws(() => consumeCallback(callback, undefined, time), /no_pending_authorization/);
  assert.throws(() => consumeCallback(callback, attempt(), time + 300_001), /authorization_expired/);
});

test('manual callback rejects another origin, port, path, state and credential-bearing URL', () => {
  for (const raw of [callback.replace('127.0.0.1', 'localhost'), callback.replace(':1455', ':1456'), callback.replace('/auth/callback', '/callback'), callback.replace('http:', 'https:'), callback + '#fragment', callback.replace('127.0.0.1', 'attacker@127.0.0.1')])
    assert.throws(() => consumeCallback(raw, attempt(), time), /callback_mismatch/);
  assert.throws(() => consumeCallback(callback.replace('bound-state', 'other-state'), attempt(), time), /state_mismatch/);
  assert.throws(() => consumeCallback(callback + '&refresh_token=secret', attempt(), time), /unexpected_token_in_url/);
  assert.throws(() => consumeCallback(callback + '&state=another', attempt(), time), /duplicate_parameter/);
});

test('manual callback requires a real issued client and preserves an existing client binding', () => {
  assert.throws(() => consumeCallback(callback.replace('oaiapp_test', 'dynamic_agent_client'), attempt(), time), /incomplete_callback/);
  assert.throws(() => consumeCallback(callback, attempt({ clientId: 'oaiapp_other' }), time), /client_mismatch/);
  assert.throws(() => consumeCallback(callback.replace('code=one-time-code&', ''), attempt(), time), /incomplete_callback/);
  const existing = attempt({ clientId: 'oaiapp_test' });
  assert.equal(consumeCallback(callback.replace('&client_id=oaiapp_test', ''), existing, time).clientId, 'oaiapp_test');
});

test('a matching OAuth denial consumes the attempt without returning an authorization code', () => {
  const pending = attempt();
  assert.throws(() => consumeCallback('http://127.0.0.1:1455/auth/callback?state=bound-state&error=access_denied', pending, time), /authorization_denied/);
  assert.equal(pending.consumed, true);
});
