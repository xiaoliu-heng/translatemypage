import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { until } from './helpers';

async function fixture(mode: 'popup' | 'session') {
  const html = (await readFile('src/extension/popup.html', 'utf8')).replace('data-mode="popup"', `data-mode="${mode}"`);
  const calls: any[] = [];
  const state: any = { accounts: [], accountEpoch: 1, authorizing: false };
  const result = await build({ entryPoints: ['src/extension/ui.ts'], bundle: true, platform: 'browser', format: 'iife', write: false,
    plugins: [{ name: 'mock-session-runtime', setup(builder) {
      builder.onResolve({ filter: /^\.\/session$/ }, () => ({ path: 'runtime', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function startSession(){return {complete: async raw => {window.completed=raw;window.clearedDuringSubmit=document.getElementById("callbackUrl").value;},close(){}};}' }));
    } }] });
  const dom = new JSDOM(html, { url: 'https://extension-unit.invalid/', runScripts: 'outside-only' });
  (dom.window as any).chrome = { runtime: { onMessage: { addListener() {} }, openOptionsPage: async () => {},
    sendMessage: async (message: any) => { calls.push(message); return { result: message.type === 'ui.state' ? { connection: 'ready', status: state, settings: structuredClone(DEFAULT_SETTINGS) } : {} }; } } };
  dom.window.eval(result.outputFiles[0].text);
  await until(() => dom.window.document.getElementById('connection')!.textContent === '翻译会话已连接');
  return { dom, calls, state };
}

test('popup sign-in opens the session tab; no native installation flow is shown', async () => {
  const f = await fixture('popup');
  try {
    (f.dom.window.document.getElementById('signIn') as HTMLButtonElement).click();
    await until(() => f.calls.some(call => call.type === 'ui.openSession') && !(f.dom.window.document.getElementById('signIn') as HTMLButtonElement).disabled);
    assert(!f.calls.some(call => call.type === 'ui.auth'));
    assert.equal(f.dom.window.document.getElementById('installHelp'), null);
    assert.equal(f.dom.window.document.getElementById('callbackStep')!.hidden, true);
  } finally { f.dom.window.close(); }
});

test('manual callback input is masked and cleared before the local session handles it, without a callback RPC', async () => {
  const f = await fixture('session');
  try {
    f.state.authorizing = true; f.state.authorization = { redirectUri: 'http://127.0.0.1:1455/auth/callback', expiresAt: Date.now() + 300_000, exchanging: false };
    const input = f.dom.window.document.getElementById('callbackUrl') as HTMLInputElement;
    input.value = 'http://127.0.0.1:1455/auth/callback?code=sensitive-unit-code';
    assert.equal(input.type, 'password');
    const button = f.dom.window.document.getElementById('completeAuth') as HTMLButtonElement;
    button.disabled = false; button.click();
    await until(() => f.dom.window.document.getElementById('feedback')!.textContent!.includes('登录验证完成') && !button.disabled);
    assert.equal((f.dom.window as any).clearedDuringSubmit, ''); assert.equal(input.value, '');
    assert(!JSON.stringify(f.calls).includes('sensitive-unit-code'));
    assert(!f.dom.window.document.getElementById('feedback')!.textContent!.includes('sensitive-unit-code'));
  } finally { f.dom.window.close(); }
});
