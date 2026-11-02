import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiKeyAccount, AppError, DEFAULT_SETTINGS } from '../src/shared/protocol';
import { hasSharingConsent, normalizeApiBaseUrl } from '../src/shared/providers';

const apiAccount = (apiBaseUrl: string): ApiKeyAccount => ({
  authType: 'api_key', key: 'provider-account', name: 'Provider', apiBaseUrl,
  identity: 'signed_in', plan: 'authorized_unverified',
});

test('content consent is bound to the exact provider origin, not another port or lookalike host', () => {
  const settings = { ...DEFAULT_SETTINGS, acknowledgedSharing: true, sharingOrigin: 'https://provider.example:8443' };
  assert.equal(hasSharingConsent(settings, apiAccount('https://provider.example:8443/proxy/v1')), true);
  assert.equal(hasSharingConsent(settings, apiAccount('https://provider.example:8443/another/v1')), true);
  assert.equal(hasSharingConsent(settings, apiAccount('https://provider.example:9443/v1')), false);
  assert.equal(hasSharingConsent(settings, apiAccount('http://provider.example:8443/v1')), false);
  assert.equal(hasSharingConsent(settings, apiAccount('https://provider.example.attacker.invalid:8443/v1')), false);
  assert.equal(hasSharingConsent({ ...settings, acknowledgedSharing: false }, apiAccount('https://provider.example:8443/v1')), false);
  assert.equal(hasSharingConsent({ ...DEFAULT_SETTINGS, acknowledgedSharing: true }, apiAccount('https://provider.example/v1')), false);
});

test('API base addresses cannot carry credentials or secret query parameters into public connection state', () => {
  for (const raw of [
    'https://user:private-secret@provider.example/v1',
    'https://provider.example/v1?api_key=private-secret',
    'https://provider.example/v1#private-secret',
    'javascript:private-secret',
    'not-an-address-private-secret',
  ]) assert.throws(() => normalizeApiBaseUrl(raw), error => error instanceof AppError &&
    error.code === 'invalid_api_address' && !error.message.includes('private-secret'));
});
