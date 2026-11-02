import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Account, DEFAULT_SETTINGS, Model, Settings, Status } from '../src/shared/protocol';
import { deferred, until } from './helpers';

type UiMessage = { type: string; accountKey?: string; settings?: Partial<Settings>; [key: string]: unknown };
interface FixtureOptions {
  failure?: { code: string; message: string };
  accounts?: Account[];
  settings?: Partial<Settings>;
  catalogs?: Record<string, Model[]>;
  apiGate?: Promise<void>;
  settingsGate?: Promise<void>;
  apiFailure?: Error;
  permission?: boolean | Promise<boolean>;
  readModels?: (accountKey: string) => Promise<Model[]>;
}
const apiAccount = (key = 'api-sha256-public-id-12345678', apiBaseUrl = 'https://api.openai.com/v1'): Account => ({ key, authType: 'api_key', apiBaseUrl, name: 'API', identity: 'signed_in', plan: 'authorized_unverified' });
const chatAccount = (): Account => ({ key: 'chat-account', authType: 'chatgpt', name: 'Reader', email: 'reader@example.invalid', clientId: 'chat-client-654321', subject: 'reader', issuer: 'https://auth.openai.com', identity: 'signed_in', plan: 'authorized_unverified' });

async function fixture(mode: 'popup' | 'session' | 'options', options: FixtureOptions = {}) {
  const html = (await readFile('src/extension/popup.html', 'utf8')).replace('data-mode="popup"', `data-mode="${mode}"`);
  const calls: UiMessage[] = [];
  const state: Status = { accounts: options.accounts || [], activeKey: options.accounts?.[0]?.key, accountEpoch: 1, authorizing: false };
  let settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...options.settings };
  let listener: ((message: { type: string; status: Status; connection: string }) => boolean) | undefined;
  let callbackCleared = '', callbackCalls = 0, apiCleared = '', apiCalls = 0;
  const saved: { raw: string; base: string }[] = [], permissions: string[][] = [];
  const result = await build({ entryPoints: ['src/extension/ui.ts'], bundle: true, platform: 'browser', format: 'iife', write: false,
    plugins: [{ name: 'mock-session-runtime', setup(builder) {
      builder.onResolve({ filter: /^\.\/session$/ }, () => ({ path: 'runtime', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function startSession(){return window.sessionFixture;}' }));
    } }] });
  const dom = new JSDOM(html, { url: 'https://extension-unit.invalid/', runScripts: 'outside-only' });
  const document = dom.window.document;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const emit = () => listener?.({ type: 'state.changed', status: structuredClone(state), connection: 'ready' });
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); },
    close(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
  Object.assign(dom.window, {
    sessionFixture: {
      async complete() { callbackCalls++; callbackCleared = element<HTMLInputElement>('callbackUrl').value; },
      async useApiKey(raw: string, base: string) {
        apiCalls++; apiCleared = element<HTMLInputElement>('apiKey').value; saved.push({ raw, base });
        await options.apiGate;
        if (options.apiFailure) throw options.apiFailure;
        const account = apiAccount(undefined, base);
        if (!state.accounts.some(a => a.key === account.key)) state.accounts.push(account);
        state.activeKey = account.key; state.accountEpoch++; emit();
      },
      close() {},
    },
    chrome: { permissions: { request: (request: { origins: string[] }) => {
      permissions.push(Array.from(request.origins));
      return Promise.resolve(options.permission ?? true);
    } }, runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } }, openOptionsPage: async () => {},
      sendMessage: async (message: UiMessage) => {
        calls.push(message);
        if (options.failure && message.type !== 'ui.state') return { error: options.failure };
        if (message.type === 'ui.state') return { result: { connection: 'ready', status: structuredClone(state), settings: structuredClone(settings) } };
        if (message.type === 'ui.models') return { result: options.readModels ? await options.readModels(state.activeKey || '') : options.catalogs?.[state.activeKey || ''] || [] };
        if (message.type === 'ui.settings') { await options.settingsGate; settings = { ...settings, ...message.settings }; return { result: structuredClone(settings) }; }
        if (message.type === 'ui.selectAccount') { state.activeKey = message.accountKey; state.accountEpoch++; emit(); }
        if (message.type === 'ui.logout') {
          state.accounts = state.accounts.filter(a => a.key !== message.accountKey);
          state.activeKey = undefined; state.accountEpoch++; emit();
        }
        return { result: {} };
      },
    } },
  });
  dom.window.eval(result.outputFiles[0].text);
  await until(() => element('connection').textContent === '翻译会话已连接');
  return { dom, calls, state, element, emit, saved, permissions, credentials: () => ({ callbackCleared, callbackCalls, apiCleared, apiCalls }), settings: () => settings };
}

test('popup sign-in opens the session tab; no native installation flow is shown', async () => {
  const f = await fixture('popup');
  try {
    f.element<HTMLButtonElement>('signIn').click();
    await until(() => f.calls.some(call => call.type === 'ui.openSession') && !f.element<HTMLButtonElement>('signIn').disabled);
    assert(!f.calls.some(call => call.type === 'ui.auth'));
    assert.equal(f.dom.window.document.getElementById('installHelp'), null);
    assert.equal(f.element('callbackStep').hidden, true);
  } finally { f.dom.window.close(); }
});

test('manual callback input is masked and cleared before local completion without a callback RPC', async () => {
  const f = await fixture('session');
  try {
    f.state.authorizing = true; f.state.authorization = { redirectUri: 'http://127.0.0.1:1455/auth/callback', expiresAt: Date.now() + 300_000, exchanging: false }; f.emit();
    const input = f.element<HTMLInputElement>('callbackUrl');
    input.value = 'http://127.0.0.1:1455/auth/callback?code=sensitive-unit-code';
    assert.equal(input.type, 'password');
    const button = f.element<HTMLButtonElement>('completeAuth'); button.click();
    await until(() => f.element('feedback').textContent!.includes('登录验证完成') && !button.disabled);
    assert.equal(f.credentials().callbackCalls, 1); assert.equal(f.credentials().callbackCleared, ''); assert.equal(input.value, '');
    assert(!JSON.stringify(f.calls).includes('sensitive-unit-code'));
    assert(!f.element('feedback').textContent!.includes('sensitive-unit-code'));
  } finally { f.dom.window.close(); }
});

test('UI preserves a safe authentication error code returned through the background RPC', async () => {
  const f = await fixture('popup', { failure: { code: 'auth_exchange_network', message: '无法连接 OpenAI 授权接口。' } });
  try {
    f.element<HTMLButtonElement>('signIn').click();
    await until(() => f.element('feedback').textContent!.includes('[auth_exchange_network]'));
  } finally { f.dom.window.close(); }
});

for (const mode of ['popup', 'options'] as const) test(`${mode} API-key entry opens the session without revealing or submitting the secret form`, async () => {
  const f = await fixture(mode);
  try {
    f.element<HTMLButtonElement>('useApiKey').click();
    await until(() => f.calls.some(call => call.type === 'ui.openSession') && !f.element<HTMLButtonElement>('useApiKey').disabled);
    assert.equal(f.element('apiKeyForm').hidden, true);
    f.element<HTMLInputElement>('apiKey').value = 'sk-ui-must-not-send';
    f.element<HTMLButtonElement>('connectApiKey').click();
    assert.equal(f.credentials().apiCalls, 0);
    assert(!JSON.stringify(f.calls).includes('sk-ui-must-not-send'));
  } finally { f.dom.window.close(); }
});

test('session API-key entry clears masked input before local handling and stays busy through state updates', async () => {
  const gate = deferred<void>();
  const f = await fixture('session', { apiGate: gate.promise });
  try {
    f.element<HTMLButtonElement>('useApiKey').click();
    const input = f.element<HTMLInputElement>('apiKey');
    assert.equal(f.element('apiKeyForm').hidden, false); assert.equal(f.dom.window.document.activeElement, input);
    assert.equal(input.type, 'password'); assert.equal(input.autocomplete, 'off');
    input.value = 'sk-ui-private-unit-secret';
    input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => f.credentials().apiCalls === 1);
    assert.equal(input.value, ''); assert.equal(f.credentials().apiCleared, '');
    f.emit();
    assert.equal(f.element<HTMLButtonElement>('connectApiKey').disabled, true);
    assert.equal(f.element<HTMLButtonElement>('useApiKey').disabled, true);
    assert.equal(input.disabled, true);
    gate.resolve();
    await until(() => f.element('apiKeyForm').hidden && !f.element<HTMLButtonElement>('connectApiKey').disabled);
    assert.equal(f.element('apiKeyForm').hidden, true);
    assert.equal(f.element('identity').textContent, '已设置');
    assert(!JSON.stringify(f.calls).includes('sk-ui-private-unit-secret'));
    assert(!f.dom.window.document.body.textContent!.includes('sk-ui-private-unit-secret'));
  } finally { gate.resolve(); await until(() => !f.element<HTMLButtonElement>('connectApiKey').disabled); f.dom.window.close(); }
});

test('API-key dismiss and Escape erase unsubmitted credentials; local failures never echo secrets', async () => {
  const f = await fixture('session', { apiFailure: new Error('sk-ui-secret-provider-body') });
  try {
    const input = f.element<HTMLInputElement>('apiKey');
    f.element<HTMLButtonElement>('useApiKey').click(); input.value = 'sk-ui-dismissed';
    f.element<HTMLButtonElement>('dismissApiKey').click();
    assert.equal(input.value, ''); assert.equal(f.element('apiKeyForm').hidden, true);
    await until(() => !f.element<HTMLButtonElement>('useApiKey').disabled);
    f.element<HTMLButtonElement>('useApiKey').click(); input.value = 'sk-ui-escaped';
    input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(input.value, ''); assert.equal(f.element('apiKeyForm').hidden, true);
    await until(() => !f.element<HTMLButtonElement>('useApiKey').disabled);
    f.element<HTMLButtonElement>('useApiKey').click(); input.value = 'sk-ui-secret-provider-body';
    f.element<HTMLButtonElement>('connectApiKey').click();
    await until(() => f.element('feedback').textContent!.includes('无法保存 API key') && !f.element<HTMLButtonElement>('connectApiKey').disabled);
    assert(!f.element('feedback').textContent!.includes('sk-ui-secret-provider-body'));
    assert.equal(input.value, '');
  } finally { f.dom.window.close(); }
});

test('API billing bypasses ChatGPT plan consent and requires an explicit persisted model choice', async () => {
  const api = apiAccount();
  const f = await fixture('popup', { accounts: [api], catalogs: { [api.key]: [{ slug: 'gpt-text-unit', displayName: 'gpt-text-unit' }, { slug: 'audio-unit', displayName: 'audio-unit' }] } });
  try {
    const model = f.element<HTMLSelectElement>('model');
    await until(() => model.options.length === 3);
    assert.equal(model.value, ''); assert.equal(f.settings().models[api.key], undefined);
    assert.equal(f.element<HTMLButtonElement>('translate').disabled, true);
    assert.equal(f.element<HTMLDialogElement>('planDialog').open, false);
    model.value = 'gpt-text-unit'; model.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => !f.element<HTMLButtonElement>('translate').disabled);
    assert.equal(f.settings().models[api.key], 'gpt-text-unit');
    f.element<HTMLButtonElement>('refreshModels').click();
    await until(() => !f.element<HTMLButtonElement>('refreshModels').disabled);
    assert.equal(model.value, 'gpt-text-unit');
    f.element<HTMLButtonElement>('translate').click();
    await until(() => f.element<HTMLDialogElement>('sharingDialog').open);
    assert.equal(f.element<HTMLDialogElement>('planDialog').open, false);
  } finally { f.dom.window.close(); }
});

test('refreshing while a model selection is being saved preserves the user selection', async () => {
  const api = apiAccount(), gate = deferred<void>();
  const f = await fixture('popup', { accounts: [api], settingsGate: gate.promise, catalogs: { [api.key]: [{ slug: 'text-choice', displayName: 'Text choice' }] } });
  try {
    const model = f.element<HTMLSelectElement>('model');
    await until(() => model.options.length === 2);
    model.value = 'text-choice'; model.dispatchEvent(new f.dom.window.Event('change'));
    f.emit();
    assert.equal(model.value, 'text-choice');
    f.element<HTMLButtonElement>('refreshModels').click();
    await until(() => !f.element<HTMLButtonElement>('refreshModels').disabled);
    assert.equal(model.value, 'text-choice'); assert.equal(f.settings().models[api.key], undefined);
    gate.resolve();
    await until(() => !f.element<HTMLButtonElement>('translate').disabled);
    assert.equal(model.value, 'text-choice'); assert.equal(f.settings().models[api.key], 'text-choice');
  } finally { gate.resolve(); f.dom.window.close(); }
});

test('switching connections keeps billing and model selections isolated and ChatGPT login never reuses an API account key', async () => {
  const api = apiAccount(), chat = chatAccount();
  const f = await fixture('session', {
    accounts: [api, chat], settings: { models: { [api.key]: 'api-text-unit', [chat.key]: 'chat-text-unit' } },
    catalogs: { [api.key]: [{ slug: 'api-text-unit', displayName: 'API text' }], [chat.key]: [{ slug: 'chat-text-unit', displayName: 'Chat text' }] },
  });
  try {
    const model = f.element<HTMLSelectElement>('model'), accounts = f.element<HTMLSelectElement>('accounts');
    await until(() => model.value === 'api-text-unit');
    f.element<HTMLButtonElement>('signIn').click();
    await until(() => f.calls.some(call => call.type === 'ui.auth') && !f.element<HTMLButtonElement>('signIn').disabled);
    assert.equal(f.calls.find(call => call.type === 'ui.auth')?.accountKey, undefined);
    accounts.value = chat.key; accounts.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => model.value === 'chat-text-unit');
    assert.equal(f.element<HTMLDialogElement>('planDialog').open, true);
    assert.equal(f.element<HTMLAnchorElement>('manageUsage').href, 'https://chatgpt.com/settings/usage');
    accounts.value = api.key; accounts.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => model.value === 'api-text-unit');
    assert.equal(f.element<HTMLDialogElement>('planDialog').open, false);
    const active = f.state.accounts.find(a => a.key === api.key)!; active.identity = 'reauth_required'; f.emit();
    f.element<HTMLButtonElement>('useApiKey').click();
    assert.equal(f.element('apiKeyForm').hidden, false);
    assert.equal(f.calls.filter(call => call.type === 'ui.auth').length, 1);
    await until(() => !f.element<HTMLButtonElement>('useApiKey').disabled);
  } finally { f.dom.window.close(); }
});

test('a slow old catalog cannot replace the models for a newly selected connection', async () => {
  const first = apiAccount('api-first-11111111'), second = apiAccount('api-second-22222222');
  const slow = deferred<Model[]>();
  const f = await fixture('session', { accounts: [first, second], settings: { models: { [second.key]: 'second-text' } }, readModels: key => key === first.key ? slow.promise : Promise.resolve([{ slug: 'second-text', displayName: 'Second' }, { slug: 'second-choice', displayName: 'Second choice' }]) });
  try {
    const accounts = f.element<HTMLSelectElement>('accounts'), model = f.element<HTMLSelectElement>('model');
    accounts.value = second.key; accounts.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => model.value === 'second-text');
    slow.resolve([{ slug: 'first-text', displayName: 'First' }]);
    model.value = 'second-choice'; model.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => f.settings().models[second.key] === 'second-choice');
    assert.equal(model.value, 'second-choice'); assert(!model.textContent!.includes('First'));
    assert.equal(accounts.value, second.key);
  } finally { slow.resolve([]); f.dom.window.close(); }
});

test('custom Save requests its exact host synchronously, clears the key, and retains the canonical API path', async () => {
  const permission = deferred<boolean>();
  const f = await fixture('session', { permission: permission.promise });
  try {
    f.element<HTMLButtonElement>('useApiKey').click();
    const base = f.element<HTMLInputElement>('apiBaseUrl'), key = f.element<HTMLInputElement>('apiKey');
    base.value = 'http://provider.example:8123/proxy/v1///';
    base.dispatchEvent(new f.dom.window.Event('input'));
    assert.equal(f.element('apiHttpWarning').hidden, false);
    assert(f.element('apiRecipient').textContent!.includes('http://provider.example:8123'));
    key.value = 'sk-custom-private';
    f.element<HTMLButtonElement>('connectApiKey').click();
    assert.deepEqual(f.permissions, [['http://provider.example/*']]);
    assert.equal(key.value, '');
    assert.equal(f.credentials().apiCalls, 0);
    assert.equal(base.disabled, true);
    assert.equal(f.element<HTMLSelectElement>('accounts').disabled, true);
    assert.equal(f.element<HTMLButtonElement>('signIn').disabled, true);
    permission.resolve(true);
    await until(() => f.saved.length === 1 && !f.element<HTMLButtonElement>('connectApiKey').disabled);
    assert.deepEqual(f.saved, [{ raw: 'sk-custom-private', base: 'http://provider.example:8123/proxy/v1' }]);
    assert.equal(f.credentials().apiCleared, '');
    assert(!JSON.stringify(f.calls).includes('sk-custom-private'));
    assert(!f.dom.window.document.documentElement.outerHTML.includes('sk-custom-private'));
  } finally { permission.resolve(false); f.dom.window.close(); }
});

test('denied host access never saves a credential and never leaks it to RPC or feedback', async () => {
  const f = await fixture('session', { permission: false });
  try {
    f.element<HTMLButtonElement>('useApiKey').click();
    f.element<HTMLInputElement>('apiBaseUrl').value = 'https://denied.example/v1';
    f.element<HTMLInputElement>('apiKey').value = 'sk-denied-private';
    const save = f.element<HTMLButtonElement>('connectApiKey'); save.click();
    await until(() => !save.disabled);
    assert.equal(f.credentials().apiCalls, 0);
    assert.equal(f.element<HTMLInputElement>('apiKey').value, '');
    assert.equal(f.element('apiKeyForm').hidden, false);
    assert(f.element('feedback').textContent!.length > 0);
    assert(!JSON.stringify(f.calls).includes('sk-denied-private'));
    assert(!f.dom.window.document.documentElement.outerHTML.includes('sk-denied-private'));
  } finally { f.dom.window.close(); }
});

test('invalid credential-bearing addresses never reach permission requests or local saving', async () => {
  const f = await fixture('session');
  try {
    f.element<HTMLButtonElement>('useApiKey').click();
    for (const address of ['https://user:sk-url-secret@provider.example/v1', 'https://provider.example/v1?key=sk-url-secret', 'file:///v1']) {
      f.element<HTMLInputElement>('apiBaseUrl').value = address;
      f.element<HTMLInputElement>('apiKey').value = 'sk-input-secret';
      const save = f.element<HTMLButtonElement>('connectApiKey'); save.click();
      await until(() => !save.disabled);
      assert.equal(f.element<HTMLInputElement>('apiKey').value, '');
      assert(!f.element('feedback').textContent!.includes('sk-url-secret'));
    }
    assert.equal(f.permissions.length, 0);
    assert.equal(f.credentials().apiCalls, 0);
    assert(!JSON.stringify(f.calls).includes('sk-input-secret'));
  } finally { f.dom.window.close(); }
});

test('restored custom profiles identify their endpoint without revealing keys, and an edited endpoint requires a new key', async () => {
  const api = apiAccount('restored-public-profile', 'https://restored.example:8443/api/v1');
  const f = await fixture('session', { accounts: [api], settings: { models: { [api.key]: 'chosen' } }, catalogs: { [api.key]: [{ slug: 'chosen', displayName: 'Chosen' }] } });
  try {
    await until(() => f.element<HTMLSelectElement>('model').value === 'chosen');
    assert(f.element<HTMLSelectElement>('accounts').selectedOptions[0].textContent!.includes('https://restored.example:8443/api/v1'));
    assert.equal(f.element<HTMLAnchorElement>('manageUsage').href, 'https://restored.example:8443/');
    assert.equal(f.permissions.length, 0);
    f.element<HTMLButtonElement>('useApiKey').click();
    assert.equal(f.element<HTMLInputElement>('apiBaseUrl').value, 'https://restored.example:8443/api/v1');
    assert.equal(f.element<HTMLInputElement>('apiKey').value, '');
    f.element<HTMLInputElement>('apiBaseUrl').value = 'https://another.example/v1';
    const save = f.element<HTMLButtonElement>('connectApiKey'); save.click();
    await until(() => !save.disabled);
    assert.equal(f.credentials().apiCalls, 0);
    assert.equal(f.permissions.length, 0);
    assert.equal(f.state.activeKey, api.key);
  } finally { f.dom.window.close(); }
});

test('automatic model refresh never prompts, but an explicit refresh requests access and denial does not fetch', async () => {
  const api = apiAccount('permission-profile', 'https://models.example:8443/api/v1');
  const f = await fixture('session', { accounts: [api], permission: false });
  try {
    await until(() => f.calls.some(c => c.type === 'ui.models'));
    assert.equal(f.permissions.length, 0);
    const before = f.calls.filter(c => c.type === 'ui.models').length;
    const refresh = f.element<HTMLButtonElement>('refreshModels'); refresh.click();
    assert.deepEqual(f.permissions, [['https://models.example/*']]);
    await until(() => !refresh.disabled);
    assert.equal(f.calls.filter(c => c.type === 'ui.models').length, before);
    assert(f.element('feedback').textContent!.includes('provider_permission_required'));
  } finally { f.dom.window.close(); }
});

test('a connection change while host permission is pending cannot save over the new selection or cancel OAuth', async () => {
  const gate = deferred<boolean>();
  const f = await fixture('session', { permission: gate.promise });
  try {
    f.element<HTMLButtonElement>('useApiKey').click();
    f.element<HTMLInputElement>('apiBaseUrl').value = 'https://pending.example/v1';
    f.element<HTMLInputElement>('apiKey').value = 'sk-pending-private';
    const save = f.element<HTMLButtonElement>('connectApiKey'); save.click();
    f.state.accountEpoch++; f.state.authorizing = true; f.emit();
    gate.resolve(true);
    await until(() => !f.element<HTMLInputElement>('apiKey').disabled);
    assert.equal(f.credentials().apiCalls, 0);
    assert.equal(f.state.authorizing, true);
    assert(!f.calls.some(c => c.type === 'ui.cancelAuth'));
    assert.equal(save.disabled, true);
  } finally { gate.resolve(false); f.dom.window.close(); }
});

test('sharing consent is recipient-bound, includes the port, and switching recipient cancels a pending action', async () => {
  const first = apiAccount('first-recipient', 'https://recipient.example:8443/v1');
  const second = apiAccount('second-recipient', 'https://recipient.example:9443/v1');
  const f = await fixture('popup', { accounts: [first, second], settings: { acknowledgedSharing: true, sharingOrigin: 'https://api.openai.com', models: { [first.key]: 'text', [second.key]: 'text' } }, catalogs: { [first.key]: [{ slug: 'text', displayName: 'Text' }], [second.key]: [{ slug: 'text', displayName: 'Text' }] } });
  try {
    await until(() => !f.element<HTMLButtonElement>('translate').disabled);
    f.element<HTMLButtonElement>('translate').click();
    await until(() => f.element<HTMLDialogElement>('sharingDialog').open);
    assert(f.element('sharingBilling').textContent!.includes('https://recipient.example:8443'));
    assert(!f.calls.some(c => c.type === 'ui.page'));
    const accounts = f.element<HTMLSelectElement>('accounts'); accounts.value = second.key;
    accounts.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => f.state.activeKey === second.key && !f.element<HTMLDialogElement>('sharingDialog').open && !f.element<HTMLButtonElement>('translate').disabled);
    f.element<HTMLButtonElement>('confirmSharing').click();
    await until(() => !f.element<HTMLButtonElement>('confirmSharing').disabled);
    assert(!f.calls.some(c => c.type === 'ui.page' || c.type === 'ui.settings'));
    f.element<HTMLButtonElement>('translate').click();
    await until(() => f.element<HTMLDialogElement>('sharingDialog').open);
    f.element<HTMLButtonElement>('confirmSharing').click();
    await until(() => f.calls.some(c => c.type === 'ui.page'));
    assert.equal(f.settings().sharingOrigin, 'https://recipient.example:9443');
    const consent = f.calls.find(c => c.type === 'ui.settings');
    assert.deepEqual(structuredClone(consent?.settings), { acknowledgedSharing: true, sharingOrigin: 'https://recipient.example:9443' });
  } finally { f.dom.window.close(); }
});

test('switching provider during a consent save never starts the previously confirmed action', async () => {
  const gate = deferred<void>(), first = apiAccount('consent-first', 'https://first.example/v1'), second = apiAccount('consent-second', 'https://second.example/v1');
  const f = await fixture('popup', { accounts: [first, second], settingsGate: gate.promise, settings: { models: { [first.key]: 'text', [second.key]: 'text' } } });
  try {
    await until(() => !f.element<HTMLButtonElement>('translate').disabled);
    f.element<HTMLButtonElement>('translate').click();
    await until(() => f.element<HTMLDialogElement>('sharingDialog').open);
    f.element<HTMLButtonElement>('confirmSharing').click();
    await until(() => f.calls.some(c => c.type === 'ui.settings'));
    const accounts = f.element<HTMLSelectElement>('accounts'); accounts.value = second.key;
    accounts.dispatchEvent(new f.dom.window.Event('change'));
    await until(() => f.state.activeKey === second.key);
    gate.resolve();
    await until(() => !f.element<HTMLButtonElement>('confirmSharing').disabled);
    assert.equal(f.settings().sharingOrigin, 'https://first.example');
    assert(!f.calls.some(c => c.type === 'ui.page' || c.type === 'ui.resume'));
    f.element<HTMLButtonElement>('resume').click();
    await until(() => f.element<HTMLDialogElement>('sharingDialog').open);
    assert(f.element('sharingBilling').textContent!.includes('https://second.example'));
  } finally { gate.resolve(); f.dom.window.close(); }
});

test('existing official sharing consent is not invalidated by an API model refresh', async () => {
  const api = apiAccount();
  const f = await fixture('popup', { accounts: [api], settings: { acknowledgedSharing: true, sharingOrigin: 'https://api.openai.com', models: { [api.key]: 'text' } } });
  try {
    await until(() => !f.element<HTMLButtonElement>('translate').disabled);
    f.element<HTMLButtonElement>('translate').click();
    await until(() => f.calls.some(c => c.type === 'ui.page') && !f.element<HTMLButtonElement>('translate').disabled);
    assert.equal(f.element<HTMLDialogElement>('sharingDialog').open, false);
    assert(!f.calls.some(c => c.type === 'ui.settings'));
  } finally { f.dom.window.close(); }
});

test('deleting a saved API profile targets only that profile and never silently selects another', async () => {
  const first = apiAccount('delete-profile', 'https://delete.example/v1'), second = apiAccount('keep-profile', 'https://keep.example/v1');
  const f = await fixture('session', { accounts: [first, second], catalogs: { [first.key]: [{ slug: 'saved-profile-model', displayName: 'Saved profile model' }] } });
  try {
    await until(() => [...f.element<HTMLSelectElement>('model').options].some(option => option.value === 'saved-profile-model'));
    const remove = f.element<HTMLButtonElement>('logout'), completed = deferred<void>(), action = remove.onclick!;
    remove.onclick = function(event) { void Promise.resolve(action.call(this, event)).then(completed.resolve, completed.reject); };
    remove.click(); await completed.promise;
    assert.equal(f.state.accounts.length, 1);
    assert.deepEqual(structuredClone(f.calls.filter(c => c.type === 'ui.logout')), [{ type: 'ui.logout', accountKey: first.key }]);
    assert.equal(f.state.accounts[0].key, second.key);
    assert.equal(f.state.activeKey, undefined);
    assert.equal(f.element<HTMLSelectElement>('accounts').value, '');
    assert.equal(f.element<HTMLButtonElement>('translate').disabled, true);
    assert(!f.calls.some(c => c.type === 'ui.auth' || c.type === 'ui.selectAccount'));
  } finally { f.dom.window.close(); }
});
