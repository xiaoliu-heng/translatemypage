import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import { account, until } from './helpers';
function dom(html: string) {
  const d = new JSDOM(`<!doctype html><html><head><title>Article</title></head><body>${html}</body></html>`, { url: 'https://example.com/article', pretendToBeVisual: true });
  const w = d.window;
  for (const key of ['document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'location', 'getSelection']) (globalThis as any)[key] = key === 'getSelection' ? w.getSelection.bind(w) : (w as any)[key];
  (globalThis as any).getComputedStyle = w.getComputedStyle.bind(w);
  (globalThis as any).IntersectionObserver = class {
    constructor(private cb: any) {} observe(target: any) { queueMicrotask(() => this.cb([{ target, isIntersecting: true }])); }
    unobserve() {} disconnect() {}
  };
  return d;
}
test('semantic extraction merges inline context, protects code, avoids nested duplication and excludes editable/private areas', async () => {
  const d = dom('<main><p>Read the <a href="/guide">installation guide</a> before using <code>AbortController</code>.</p><ul><li>Introduction<p>Nested paragraph.</p></li></ul><table><tr><td>Table cell.</td></tr></table><form><p>Do not read this form.</p></form><div contenteditable="true"><p>Private draft.</p></div><pre>Do not translate code.</pre><p hidden>Hidden text.</p></main>');
  try {
    const { candidates, snapshot } = await import('../src/extension/extractor');
    const values = candidates(document.querySelector('main')!).map(snapshot);
    assert.equal(values.length, 4);
    assert.equal(values[0].text, 'Read the ⟦TMP:o:0⟧installation guide⟦TMP:c:0⟧ before using ⟦TMP:0⟧.');
    assert.equal(values[0].protected['⟦TMP:0⟧'], 'AbortController');
    assert.deepEqual(values.slice(1).map(v => v.text), ['Introduction', 'Nested paragraph.', 'Table cell.']);
  } finally { d.window.close(); }
});
test('safe insertion treats output as text, uses legal table/list containers and preserves original links', async () => {
  const d = dom('<p id="p">Original <a href="/x">link</a>. <code>&lt;script&gt;</code></p><ul><li>Item.<p>Nested paragraph.</p></li></ul><table><tr><td>Cell.</td></tr></table>');
  try {
    const { appendTranslation, snapshot } = await import('../src/extension/extractor');
    const p = document.querySelector('#p')!, link = p.querySelector('a')!;
    let clicks = 0; link.addEventListener('click', e => { e.preventDefault(); clicks++; });
    const source = snapshot(p);
    const n = appendTranslation(p, '<img src=x onerror=alert(1)> ⟦TMP:o:0⟧链接⟦TMP:c:0⟧ ⟦TMP:0⟧', source.protected);
    assert.equal(n.querySelector('img'), null); assert.equal(n.textContent, '<img src=x onerror=alert(1)> 链接 <script>');
    assert.equal(n.parentElement, p); assert.equal(n.querySelector('a')!.href, link.href);
    assert.equal(n.querySelector('code')!.textContent, '<script>');
    assert.deepEqual(snapshot(p), source);
    for (const selector of ['li', 'td']) { const e = document.querySelector(selector)!; const child = appendTranslation(e, '译文', {}); assert.equal(child.parentElement, e); child.remove(); }
    n.remove(); link.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(clicks, 1); assert.equal(document.querySelector('a'), link); assert.equal(p.textContent, 'Original link. <script>');
  } finally { d.window.close(); }
});
test('rich translations retain nested formatting, local link targets, original typography and hard line breaks', async () => {
  const d = dom(`<style>
    h2{font:600 28px/1.3 Georgia;color:rgb(32, 51, 67);letter-spacing:1px;text-align:center}
    h2>a{color:rgb(110, 30, 80);text-decoration:underline}
    h2>a>strong{font-weight:900;font-size:30px} code{font:15px/1.4 monospace;background-color:rgb(230, 231, 232);padding:2px 4px}
    span{font-size:9px;color:red;margin:99px;border:7px solid blue}
    </style><h2 id="heading">Read <a id="original-link" href="/guide?q=1" target="_blank" onclick="bad()"><strong>the guide</strong></a><br><em>carefully</em>, H<sub>2</sub>O and x<sup>2</sup>, <code><span style="color:green">run()</span></code>. Literal ⟦TMP:o:99⟧</h2>`);
  try {
    const { snapshot, appendTranslation } = await import('../src/extension/extractor');
    const sourceElement = document.querySelector('h2')!, source = snapshot(sourceElement);
    const output = source.text.replace('Read', '阅读').replace('the guide', '指南').replace('carefully', '仔细');
    const n = appendTranslation(sourceElement, output, source.protected);
    const originalLink = document.getElementById('original-link')!, translatedLink = n.querySelector('a')!;
    assert.equal(translatedLink.href, 'https://example.com/guide?q=1');
    assert.equal(translatedLink.target, '_blank'); assert.equal(translatedLink.rel, 'noopener noreferrer');
    assert.equal(translatedLink.id, ''); assert.equal(translatedLink.getAttribute('onclick'), null);
    for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'letter-spacing', 'text-align']) {
      assert.equal(n.style.getPropertyValue(property), 'inherit', property);
    }
    for (const selector of ['a', 'a>strong', 'em', 'sub', 'sup', 'code', 'code>span']) {
      const original = [...sourceElement.querySelectorAll(selector)].find(e => !n.contains(e))!;
      const translated = n.querySelector<HTMLElement>(selector)!;
      for (const property of ['font-size', 'font-weight', 'font-style', 'color', 'vertical-align', 'background-color', 'padding-left']) {
        const expected = getComputedStyle(original).getPropertyValue(property);
        if (expected) assert.equal(translated.style.getPropertyValue(property), expected, `${selector} ${property}`);
      }
    }
    assert.equal(n.querySelectorAll('br').length, 1);
    assert.equal(n.textContent, '阅读 指南仔细, H2O and x2, run(). Literal ⟦TMP:o:99⟧');
    assert.equal(document.querySelectorAll('h2').length, 1);
    assert.deepEqual(snapshot(sourceElement), source);
    n.remove(); assert.equal(sourceElement.querySelector('a'), originalLink);
  } finally { d.window.close(); }
});
test('rendering rejects altered format pairs and never clones executable links or embedded content', async () => {
  const d = dom('<p>Read <a href="javascript:bad()" id="bad" onmouseover="bad()">this</a> <code><script>bad()</script><b>safe</b></code>.</p>');
  try {
    const { snapshot, appendTranslation } = await import('../src/extension/extractor');
    const p = document.querySelector('p')!, s = snapshot(p);
    assert.throws(() => appendTranslation(p, '无标记', s.protected), (e: any) => e.code === 'invalid_markers');
    assert.equal(p.querySelector('[data-tmp-owned]'), null);
    const n = appendTranslation(p, s.text.replace('Read', '阅读').replace('this', '这里'), s.protected);
    assert.equal(n.querySelector('a')!.getAttribute('href'), null);
    assert.equal(n.querySelector('[id],[onclick],[onmouseover],script,iframe,object,img,svg'), null);
    assert.equal(n.querySelector('code')!.textContent, 'safe');
  } finally { d.window.close(); }
});
test('pre-line source keeps author line breaks without enforcing new translation line spacing', async () => {
  const d = dom('<p style="white-space:pre-line;line-height:1.2">First line.\nSecond line.</p>');
  try {
    const { snapshot, appendTranslation } = await import('../src/extension/extractor');
    const p = document.querySelector('p')!, s = snapshot(p);
    const n = appendTranslation(p, s.text.replace('First line.', '第一行。').replace('Second line.', '第二行。'), s.protected);
    assert.equal(n.textContent, '第一行。\n第二行。'); assert.equal(n.style.whiteSpace, 'inherit'); assert.equal(n.style.lineHeight, 'inherit');
  } finally { d.window.close(); }
});
test('page translator rejects recycled DOM results, observes new content, avoids translating own nodes and restores original DOM', async () => {
  const d = dom('<main><p id="source">Original sentence.</p></main>');
  const submissions: any[] = [];
  (globalThis as any).chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(m: any) {
    if (m.type === 'page.hello') return { result: { documentId: 'doc-1', pageKey: 'page-1' } };
    if (m.type === 'page.translate') { const jobId = `job-${submissions.length}`; submissions.push({ ...m, jobId }); return { result: { jobId } }; }
    return { result: {} };
  } } };
  const { PageTranslator } = await import('../src/extension/content');
  const app = new PageTranslator();
  const status = { accounts: [account()], activeKey: 'account-1', accountEpoch: 1, authorizing: false };
  const emit = (s: any, text: string, epoch = 1) => {
    app.handleEvent({ v: 1, bootId: 'boot', seq: 1, jobId: s.jobId, accountEpoch: epoch, event: 'batchCompleted', data: {
      document: { id: 'doc-1', generation: s.generation }, segment: { ...s.segments[0], translation: text },
    } });
    app.handleEvent({ v: 1, bootId: 'boot', seq: 2, jobId: s.jobId, accountEpoch: epoch, event: 'jobCompleted' });
  };
  try {
    await app.control('start', status, { ...DEFAULT_SETTINGS, models: { 'account-1': 'model' } });
    await until(() => submissions.length === 1);
    document.querySelector('#source')!.textContent = 'Updated sentence.';
    emit(submissions[0], '旧的译文'); assert.equal(document.querySelector('[data-tmp-owned="translation"]'), null);
    await until(() => submissions.length === 2);
    assert.equal(submissions[1].segments[0].revision, 2); emit(submissions[1], '更新的译文');
    assert.equal(document.querySelector('[data-tmp-owned="translation"]')!.textContent, '更新的译文');
    await new Promise(r => setTimeout(r, 200)); assert.equal(submissions.length, 2);
    document.querySelector('[data-tmp-owned="translation"]')!.remove();
    await until(() => document.querySelectorAll('[data-tmp-owned="translation"]').length === 1);
    assert.equal(submissions.length, 2);
    const sourceElement = document.querySelector<HTMLElement>('#source')!;
    const beforeStyle = sourceElement.querySelector('[data-tmp-owned="translation"]');
    sourceElement.style.cssText = 'font-size:23px;line-height:1.3;color:rgb(20, 50, 90)';
    await until(() => sourceElement.querySelector('[data-tmp-owned="translation"]') !== beforeStyle);
    assert.equal(sourceElement.querySelector<HTMLElement>('[data-tmp-owned="translation"]')!.style.lineHeight, 'inherit');
    assert.equal(submissions.length, 2);
    const beforeTheme = sourceElement.querySelector('[data-tmp-owned="translation"]');
    const style = document.createElement('style'); style.textContent = '.large #source{font-size:29px!important}'; document.head.append(style);
    sourceElement.style.removeProperty('font-size');
    document.documentElement.classList.add('large');
    await until(() => sourceElement.querySelector('[data-tmp-owned="translation"]') !== beforeTheme);
    assert.equal(getComputedStyle(sourceElement).fontSize, '29px');
    assert.equal(submissions.length, 2);
    const popup = document.createElement('aside'); popup.innerHTML = '<div>Unrelated browser extension popup outside the article.</div>'; document.body.append(popup);
    await new Promise(r => setTimeout(r, 200)); assert.equal(submissions.length, 2);
    const added = document.createElement('div'); added.textContent = 'New dynamic paragraph.'; document.querySelector('main')!.append(added);
    await until(() => submissions.length === 3); emit(submissions[2], '动态段落');
    assert.equal(document.querySelectorAll('[data-tmp-owned="translation"]').length, 2);
    app.stop(); assert.equal(document.querySelectorAll('[data-tmp-owned="translation"]').length, 0);
    assert.equal(document.querySelector<HTMLElement>('[data-tmp-owned="mascot"]')!.dataset.state, 'sleeping');
    assert.equal(document.querySelector('#source')!.textContent, 'Updated sentence.');
  } finally { app.dispose(); d.window.close(); }
});
test('account changes and explicit cancellation discard late results', async () => {
  const d = dom('<main><p>Pending sentence.</p></main>'); let submission: any;
  (globalThis as any).chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(m: any) {
    if (m.type === 'page.hello') return { result: { documentId: 'doc' } };
    if (m.type === 'page.translate') { submission = m; return { result: { jobId: 'pending' } }; }
    return { result: {} };
  } } };
  const { PageTranslator } = await import('../src/extension/content'); const app = new PageTranslator();
  const status = { accounts: [account()], activeKey: 'account-1', accountEpoch: 1, authorizing: false };
  try {
    await app.control('start', status, DEFAULT_SETTINGS); await until(() => !!submission);
    app.stateChanged({ ...status, accountEpoch: 2 });
    app.handleEvent({ v: 1, event: 'batchCompleted', bootId: 'boot', seq: 1, jobId: 'pending', accountEpoch: 1, data: { document: { id: 'doc', generation: submission.generation }, segment: { ...submission.segments[0], translation: '不能写入' } } });
    assert.equal(document.querySelector('[data-tmp-owned="translation"]'), null);
  } finally { app.dispose(); d.window.close(); }
});
test('a late selection translation cannot overwrite a newer selection', async () => {
  const d = dom('<main><p id="first">First selection.</p><p id="second">Second selection.</p></main>'); const submissions: any[] = [];
  (globalThis as any).chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(m: any) {
    if (m.type === 'page.hello') return { result: { documentId: 'doc' } };
    if (m.type === 'page.translate') { const jobId = `selection-${submissions.length}`; submissions.push({ ...m, jobId }); return { result: { jobId } }; }
    return { result: {} };
  } } };
  const { PageTranslator } = await import('../src/extension/content'); const app = new PageTranslator();
  const status = { accounts: [account()], activeKey: 'account-1', accountEpoch: 1, authorizing: false };
  const emit = (n: number, text: string) => app.handleEvent({ v: 1, event: 'batchCompleted', bootId: 'boot', seq: n + 1,
    jobId: submissions[n].jobId, accountEpoch: 1, data: { document: { id: 'doc', generation: submissions[n].generation }, segment: { ...submissions[n].segments[0], translation: text } } });
  try {
    for (const id of ['first', 'second']) {
      const range = document.createRange(); range.selectNodeContents(document.getElementById(id)!);
      const selection = d.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      await app.control('selection', status, DEFAULT_SETTINGS);
    }
    emit(1, '第二个选区的译文'); emit(0, '旧选区的译文');
    const mascot = document.querySelector('[data-tmp-owned="mascot"]')!;
    await until(() => mascot.shadowRoot!.querySelector('.result')!.textContent === '第二个选区的译文');
    assert.equal(mascot.shadowRoot!.querySelector('.result')!.textContent, '第二个选区的译文');
    assert.equal(mascot.shadowRoot!.querySelector<HTMLElement>('.dialog')!.hidden, false);
  } finally { app.dispose(); d.window.close(); }
});
test('a completed text selection starts the nearby mascot, deduplicates pointer events, retries failures and preserves private inputs', async () => {
  const d = dom('<main><p id="reading">A fresh selected sentence.</p><form><p id="private">A private form draft.</p></form></main>');
  const submissions: any[] = [];
  let resumed = 0;
  (globalThis as any).chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(m: any) {
    if (m.type === 'page.hello') return { result: { documentId: 'selection-doc' } };
    if (m.type === 'page.resume') resumed++;
    if (m.type === 'page.translate') { const jobId = `job-${submissions.length}`; submissions.push({ ...m, jobId }); return { result: { jobId } }; }
    return { result: {} };
  } } };
  const { PageTranslator } = await import('../src/extension/content'); const app = new PageTranslator();
  const status = { accounts: [account()], activeKey: 'account-1', accountEpoch: 1, authorizing: false };
  const select = (id: string) => {
    const range = document.createRange(); range.selectNodeContents(document.getElementById(id)!);
    const selection = d.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.getElementById(id)!.dispatchEvent(new d.window.MouseEvent('pointerup', { bubbles: true }));
  };
  try {
    await app.control('idle', status, { ...DEFAULT_SETTINGS, acknowledgedSharing: true });
    const pet = document.querySelector<HTMLElement>('[data-tmp-owned="mascot"]')!, shadow = pet.shadowRoot!;
    assert.equal(pet.dataset.state, 'sleeping'); select('reading'); await until(() => submissions.length === 1);
    assert.equal(pet.dataset.state, 'loading'); assert.equal(shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    select('reading'); await new Promise(r => setTimeout(r, 180)); assert.equal(submissions.length, 1);
    app.handleEvent({ v: 1, bootId: 'boot', seq: 1, jobId: submissions[0].jobId, accountEpoch: 1, event: 'failed', data: { error: { message: '连接中断，请重试。' } } });
    await until(() => !shadow.querySelector<HTMLElement>('.dialog')!.hidden);
    assert.equal(pet.dataset.state, 'error'); shadow.querySelector<HTMLButtonElement>('.retry')!.click();
    await until(() => submissions.length === 2); assert.equal(pet.dataset.state, 'loading'); assert.equal(resumed, 1);
    app.handleEvent({ v: 1, bootId: 'boot', seq: 2, jobId: submissions[1].jobId, accountEpoch: 1, event: 'batchCompleted', data: { document: { id: 'selection-doc', generation: submissions[1].generation }, segment: { ...submissions[1].segments[0], translation: '新的划词译文。' } } });
    await until(() => shadow.querySelector('.result')!.textContent === '新的划词译文。');
    assert.equal(pet.dataset.state, 'ready'); shadow.querySelector<HTMLButtonElement>('.close')!.click();
    assert.equal(pet.dataset.state, 'sleeping');
    assert.equal(shadow.querySelector<HTMLElement>('.dialog')!.getAttribute('aria-hidden'), 'true');
    await until(() => shadow.querySelector<HTMLElement>('.dialog')!.hidden);
    select('private'); await new Promise(r => setTimeout(r, 200)); assert.equal(submissions.length, 2);
    app.stop(); assert.equal(pet.dataset.state, 'sleeping');
  } finally { app.dispose(); d.window.close(); }
});
test('clicking the mascot toggles page translation while stopping discards pending selection dialogs', async () => {
  const d = dom('<main><p>A short paragraph.</p></main>'); const submissions: any[] = [];
  (globalThis as any).chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(m: any) {
    if (m.type === 'page.hello') return { result: { documentId: 'orb-doc' } };
    if (m.type === 'page.translate') { const jobId = `orb-${submissions.length}`; submissions.push({ ...m, jobId }); return { result: { jobId } }; }
    return { result: {} };
  } } };
  const { PageTranslator } = await import('../src/extension/content'); const app = new PageTranslator();
  const status = { accounts: [account()], activeKey: 'account-1', accountEpoch: 1, authorizing: false };
  try {
    await app.control('idle', status, { ...DEFAULT_SETTINGS, acknowledgedSharing: true });
    const pet = document.querySelector<HTMLElement>('[data-tmp-owned="mascot"]')!, shadow = pet.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('.orb')!.click(); await until(() => submissions.length === 1);
    assert.equal(pet.dataset.state, 'loading');
    shadow.querySelector<HTMLButtonElement>('.orb')!.click(); assert.equal(pet.dataset.state, 'sleeping');
    const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!); d.window.getSelection()!.addRange(range);
    await app.control('selection', status, { ...DEFAULT_SETTINGS, acknowledgedSharing: true });
    const pending = submissions[1]; app.stop();
    app.handleEvent({ v: 1, bootId: 'boot', seq: 3, jobId: pending.jobId, accountEpoch: 1, event: 'batchCompleted', data: { document: { id: 'orb-doc', generation: pending.generation }, segment: { ...pending.segments[0], translation: '关闭后不能弹出。' } } });
    await new Promise(r => setTimeout(r, 520));
    assert.equal(pet.dataset.state, 'sleeping'); assert.equal(shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
  } finally { app.dispose(); d.window.close(); }
});
