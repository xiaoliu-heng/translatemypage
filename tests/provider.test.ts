import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider, consumeSSE, validateOutput } from '../src/core/provider';
import { ApiKeyCredential, ChatGPTCredential } from '../src/core/auth';
import { AppError } from '../src/shared/protocol';
import { params } from './helpers';
const oauthCredential: ChatGPTCredential = { authType: 'chatgpt', clientId: 'client', accessToken: 'secret', scopes: [], expiresAt: Infinity };
const apiCredential: ApiKeyCredential = { authType: 'api_key', accessToken: 'private-api-key-DO-NOT-EXPOSE' };
function sse(events: unknown[], chunk = 7) {
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
test('browser-compatible provider reads the account catalog and translates with the SIWC request contract', async () => {
  let sent: Record<string, unknown> = {};
  const request: typeof fetch = async function (this: unknown, input, init) {
    // Match Window.fetch receiver validation rather than Node's permissive fetch.
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret');
    if (String(input).endsWith('/models')) return Response.json({ models: [{ slug: 'visible', display_name: 'Visible', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' }] });
    sent = JSON.parse(String(init?.body));
    return new Response(sse([delta('{"translations":[{"id":"s1","text":"你好。"}]}'), done]));
  };
  const provider = new OpenAIProvider({ access: async () => oauthCredential }, request);
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
  const provider = new OpenAIProvider({ access: async () => oauthCredential }, async () => { calls++; return new Response(sse([delta('partial')])); });
  await assert.rejects(provider.translate(params(), new AbortController().signal), (e: any) => e.code === 'interrupted'); assert.equal(calls, 1);
});

test('API key mode reads actual API model IDs and translates through Responses without inventing capabilities', async () => {
  let calls = 0;
  const request: typeof fetch = async function (this: unknown, input, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    calls++;
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${apiCredential.accessToken}`);
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    if (String(input).endsWith('/models')) {
      assert.equal(String(input), 'https://api.openai.com/v1/models');
      return Response.json({ object: 'list', data: [{ id: 'gpt-4.1' }, { id: 'text-embedding-3-small' }] });
    }
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-4.1'); assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.ok(Array.isArray(body.input)); assert.equal(typeof body.instructions, 'string');
    return new Response(sse([delta('{"translations":[{"id":"s1","text":"你好。"}]}'), done]));
  };
  const provider = new OpenAIProvider({ access: async () => apiCredential }, request);
  assert.deepEqual(await provider.models('api-account'), [
    { slug: 'gpt-4.1', displayName: 'gpt-4.1' },
    { slug: 'text-embedding-3-small', displayName: 'text-embedding-3-small' },
  ]);
  const p = params(); p.model = 'gpt-4.1';
  assert.equal((await provider.translate(p, new AbortController().signal)).get('s1'), '你好。');
  assert.equal(calls, 2);
});

test('catalog parsing is selected by explicit credential type and rejects the other catalog shape', async () => {
  for (const [credential, catalog] of [
    [apiCredential, { models: [{ slug: 'gpt-4.1', display_name: 'Model', visibility: 'list' }] }],
    [oauthCredential, { data: [{ id: 'gpt-4.1' }] }],
    [apiCredential, { data: [{ slug: 'invented' }] }],
    [apiCredential, { data: [{ id: '' }] }],
  ] as const) {
    const provider = new OpenAIProvider({ access: async () => credential }, async () => Response.json(catalog));
    await assert.rejects(provider.models('account'), (error: unknown) => error instanceof AppError && error.code === 'incompatible_catalog');
  }
});

test('API invalid-key and quota errors are safe and mode-aware before streaming and within error events', async () => {
  for (const [code, status, expected, message] of [
    ['invalid_api_key', 401, 'reauth_required', /替换密钥/],
    ['insufficient_quota', 429, 'limited', /API 配额或计费/],
  ] as const) {
    const providerBody = { error: { code, message: `provider echoes ${apiCredential.accessToken}` } };
    const safe = (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, expected); assert.match(error.message, message);
      assert.equal(JSON.stringify(error.toJSON()).includes(apiCredential.accessToken), false);
      assert.equal(error.message.includes('ChatGPT 用量设置'), false);
      return true;
    };
    const rejected = new OpenAIProvider({ access: async () => apiCredential }, async () => Response.json(providerBody, { status }));
    await assert.rejects(rejected.models('api-account'), safe);
    await assert.rejects(rejected.translate(params(), new AbortController().signal), safe);
    for (const event of [
      { type: 'error', ...providerBody },
      { type: 'error', code, message: apiCredential.accessToken },
      { type: 'response.failed', response: providerBody },
      { type: 'response.completed', response: { status: 'failed', ...providerBody } },
    ]) {
      const streamed = new OpenAIProvider({ access: async () => apiCredential }, async () => new Response(sse([delta('partial'), event])));
      await assert.rejects(streamed.translate(params(), new AbortController().signal), safe);
    }
  }
});

test('cancelled API translation never starts a request after credential access finishes', async () => {
  const controller = new AbortController(); let calls = 0;
  const provider = new OpenAIProvider({ access: async () => { controller.abort(); return apiCredential; } },
    async () => { calls++; return new Response(sse([done])); });
  await assert.rejects(provider.translate(params(), controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});
