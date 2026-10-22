import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionBridge } from '../src/extension/bridge';
import { account } from './helpers';

class Event<T extends (...args: any[]) => unknown> {
  listeners: T[] = [];
  addListener = (listener: T) => { this.listeners.push(listener); };
  emit(...args: Parameters<T>) { for (const listener of this.listeners) listener(...args); }
}
function port(url = 'chrome-extension://test/session.html', tab = 1) {
  const messages: any[] = [];
  const value = { name: 'translation-session', sender: { id: 'test', url, tab: { id: tab, incognito: false } },
    onMessage: new Event<(message: any) => void>(), onDisconnect: new Event<() => void>(),
    postMessage: (message: any) => { messages.push(message); }, disconnected: false,
    disconnect() { this.disconnected = true; this.onDisconnect.emit(); } };
  return { value, messages, cast: value as unknown as chrome.runtime.Port };
}

test('only the owned session tab can attach; stale events are ignored and disconnect rejects pending work', async t => {
  const previous = globalThis.chrome;
  (globalThis as any).chrome = { runtime: { id: 'test', getURL: (file: string) => `chrome-extension://test/${file}`, sendMessage: async () => { throw new Error('no session'); } } };
  t.after(() => { (globalThis as any).chrome = previous; });
  const events: string[] = []; let disconnected = 0;
  const bridge = new SessionBridge(event => events.push(event.event), () => { disconnected++; });
  const hostile = port('https://attacker.invalid/'); bridge.attach(hostile.cast); assert.equal(hostile.value.disconnected, true);
  const session = port(); bridge.attach(session.cast);
  const duplicate = port(undefined, 2); bridge.attach(duplicate.cast); assert.equal(duplicate.value.disconnected, true);
  session.value.onMessage.emit({ v: 1, bootId: 'first', seq: 1, event: 'hello', data: { accounts: [account()], activeKey: 'account-1', accountEpoch: 1, authorizing: false } });
  assert.equal(bridge.connection, 'ready'); assert.equal(bridge.tabId, 1);
  session.value.onMessage.emit({ v: 1, bootId: 'other', seq: 9, event: 'status', data: {} });
  session.value.onMessage.emit({ v: 1, bootId: 'first', seq: 1, event: 'failed', jobId: 'old' });
  assert.deepEqual(events, ['status']);
  const call = bridge.call('models.list'); await new Promise(resolve => setTimeout(resolve, 0));
  const request = session.messages[0]; session.value.onMessage.emit({ v: 1, id: request.id, result: ['model'] });
  assert.deepEqual(await call, ['model']);
  const pending = bridge.call('translation.submit'); await new Promise(resolve => setTimeout(resolve, 0));
  session.value.disconnect(); await assert.rejects(pending, (error: any) => error.code === 'session_disconnected');
  assert.equal(bridge.status, undefined); assert.equal(bridge.connection, 'disconnected'); assert.equal(disconnected, 1);
  await assert.rejects(bridge.call('models.list'), (error: any) => error.code === 'session_required');
});

test('a suspended worker wakes the existing session before forwarding a new request', async t => {
  const previous = globalThis.chrome;
  const bridge = new SessionBridge(() => {}, () => {}), session = port(); let wakes = 0;
  (globalThis as any).chrome = { runtime: { id: 'test', getURL: (file: string) => `chrome-extension://test/${file}`,
    sendMessage: async (message: any) => {
      assert.equal(message.type, 'session.wake'); wakes++;
      bridge.attach(session.cast);
      session.value.onMessage.emit({ v: 1, bootId: 'surviving-session', seq: 1, event: 'hello', data: { accounts: [], accountEpoch: 99, authorizing: false } });
      return { awake: true };
    } } };
  t.after(() => { session.value.disconnect(); (globalThis as any).chrome = previous; });
  await Promise.all([bridge.connect(), bridge.connect()]);
  assert.equal(bridge.connection, 'ready'); assert.equal(wakes, 1); assert.equal(bridge.status!.accountEpoch, 99);
});
