import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTPlanProvider, consumeSSE, validateOutput } from '../src/host/provider';
import { params } from './helpers';
function sse(events: any[], chunk = 7) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); } });
}
const delta = (text: string) => ({ type: 'response.output_text.delta', delta: text });
const done = { type: 'response.completed', response: { status: 'completed' } };
test('SSE preserves Chinese and CRLF boundaries and requires a completed event', async () => {
  assert.equal(await consumeSSE(sse([delta('你'), delta('好 👋'), done], 1)), '你好 👋');
  await assert.rejects(consumeSSE(sse([delta('partial')])), (e: any) => e.code === 'interrupted');
  await assert.rejects(consumeSSE(sse([delta('partial'), { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])), (e: any) => e.code === 'limited');
  await assert.rejects(consumeSSE(sse([{ type: 'response.incomplete' }])), (e: any) => e.code === 'incomplete');
});
test('output validator rejects missing/duplicate/unknown ids and altered protected markers', () => {
  const p = params(); p.segments[0].text = 'Use ⟦TMP:0⟧.'; p.segments[0].protected = { '⟦TMP:0⟧': 'AbortController' };
  assert.equal(validateOutput('{"translations":[{"id":"s1","text":"使用 ⟦TMP:0⟧。"}]}', p.segments).get('s1'), '使用 ⟦TMP:0⟧。');
  for (const raw of ['{}', '{"translations":[]}', '{"translations":[{"id":"s2","text":"x"}]}', '{"translations":[{"id":"s1","text":"missing marker"}]}', '{"translations":[{"id":"s1","text":"⟦TMP:0⟧⟦TMP:1⟧"}]}']) assert.throws(() => validateOutput(raw, p.segments));
  assert.throws(() => validateOutput('{"translations":[{"id":"s1","text":"x"},{"id":"s1","text":"y"}]}', [...params().segments, { ...params().segments[0], id: 's2' }]));
});
test('provider follows the account catalog and SIWC request contract', async () => {
  let sent: any;
  const provider = new ChatGPTPlanProvider({ access: async () => ({ clientId: 'client', accessToken: 'secret', scopes: [], expiresAt: Infinity }) }, (async (url: string, init: RequestInit) => {
    assert.equal((init.headers as any).Authorization, 'Bearer secret');
    if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'visible', display_name: 'Visible', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' }] });
    sent = JSON.parse(init.body as string);
    return new Response(sse([delta('{"translations":[{"id":"s1","text":"你好。"}]}'), done]));
  }) as any);
  assert.deepEqual(await provider.models('account-1'), [{ slug: 'visible', displayName: 'Visible' }]);
  assert.equal((await provider.translate(params(), new AbortController().signal)).get('s1'), '你好。');
  assert.equal(sent.store, false); assert.equal(sent.stream, true); assert.ok(Array.isArray(sent.input));
  assert.deepEqual(Object.keys(sent).sort(), ['input', 'instructions', 'model', 'store', 'stream']);
});
test('output validator preserves nested inline boundaries and line breaks while allowing peer phrases to reorder', () => {
  const p = params();
  p.segments[0].text = 'Read ⟦TMP:o:0⟧the ⟦TMP:o:1⟧guide⟦TMP:c:1⟧⟦TMP:c:0⟧. Use ⟦TMP:o:3⟧⟦TMP:0⟧⟦TMP:c:3⟧.⟦TMP:br:2⟧Next line.';
  p.segments[0].protected = { '⟦TMP:0⟧': 'AbortController' };
  const check = (text: string) => validateOutput(JSON.stringify({ translations: [{ id: 's1', text }] }), p.segments);
  assert.equal(check('使用 ⟦TMP:o:3⟧⟦TMP:0⟧⟦TMP:c:3⟧。阅读 ⟦TMP:o:0⟧这份⟦TMP:o:1⟧指南⟦TMP:c:1⟧⟦TMP:c:0⟧。⟦TMP:br:2⟧下一行。').size, 1);
  for (const invalid of [
    p.segments[0].text.replace('⟦TMP:br:2⟧', ''),
    p.segments[0].text.replace('⟦TMP:br:2⟧', '').replace('⟦TMP:o:3⟧', '⟦TMP:br:2⟧⟦TMP:o:3⟧'),
    p.segments[0].text.replace('⟦TMP:c:1⟧⟦TMP:c:0⟧', '⟦TMP:c:0⟧⟦TMP:c:1⟧'),
    p.segments[0].text.replace('⟦TMP:o:3⟧⟦TMP:0⟧', '⟦TMP:0⟧⟦TMP:o:3⟧'),
    p.segments[0].text.replace('⟦TMP:c:1⟧⟦TMP:c:0⟧', '⟦TMP:c:1⟧⟦TMP:c:0⟧⟦TMP:o:9⟧新增⟦TMP:c:9⟧'),
    p.segments[0].text + '⟦TMP:br:2⟧', p.segments[0].text + '⟦TMP:malformed⟧',
  ]) assert.throws(() => check(invalid), (e: any) => e.code === 'invalid_markers');
});
test('an interrupted inference is never automatically repeated', async () => {
  let calls = 0;
  const provider = new ChatGPTPlanProvider({ access: async () => ({ clientId: 'c', accessToken: 'secret', scopes: [], expiresAt: Infinity }) }, (async () => { calls++; return new Response(sse([delta('partial')])); }) as any);
  await assert.rejects(provider.translate(params(), new AbortController().signal), (e: any) => e.code === 'interrupted'); assert.equal(calls, 1);
});
