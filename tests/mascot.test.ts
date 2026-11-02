import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TranslationMascot } from '../src/extension/mascot';
import { until } from './helpers';

function setup(reducedMotion = true) {
  const dom = new JSDOM('<main><p>Read this sentence.</p></main>', { url: 'https://example.com', pretendToBeVisual: true });
  const w = dom.window;
  for (const key of ['document', 'Node', 'Element', 'HTMLElement']) (globalThis as any)[key] = (w as any)[key];
  (w as any).matchMedia = () => ({ matches: reducedMotion });
  const saved: any[] = [];
  (globalThis as any).chrome = { storage: { local: { get: async () => ({}), set: async (v: any) => { saved.push(v); } } } };
  let rect = new w.DOMRect(300, 270, 110, 22);
  (w.Range.prototype as any).getClientRects = () => [rect];
  const range = w.document.createRange(); range.selectNodeContents(w.document.querySelector('p')!);
  const actions = { toggles: 0, dismissals: 0, retries: 0 };
  const pet = new TranslationMascot({ toggle() { actions.toggles++; }, dismiss() { actions.dismissals++; }, retry() { actions.retries++; } });
  const shadow = pet.host.shadowRoot!, orb = shadow.querySelector<HTMLButtonElement>('.orb')!;
  function pointer(target: EventTarget, type: string, x: number, y: number) {
    const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerId', { value: 1 }); target.dispatchEvent(e);
  }
  return { dom, w, pet, shadow, orb, actions, range, saved, pointer, setRect(value: DOMRect) { rect = value as any; }, close() { pet.destroy(); w.close(); } };
}
test('logo toggle state stays off during setup and errors, and does not confuse a selection result with page translation', () => {
  const f = setup();
  try {
    assert.equal(f.pet.host.isConnected, true);
    assert(f.orb.querySelector('svg'));
    assert.equal(f.orb.getAttribute('aria-pressed'), 'false');
    f.pet.update('error', '需要配置提供商', '点击配置', false);
    assert.equal(f.orb.getAttribute('aria-pressed'), 'false');
    f.pet.update('loading', '正在翻译正文', '点击关闭翻译', true);
    assert.equal(f.orb.getAttribute('aria-pressed'), 'true');
    f.pet.update('ready', '选区翻译完成', '点击开启整页翻译', false);
    assert.equal(f.orb.getAttribute('aria-pressed'), 'false');
    assert.equal(f.shadow.querySelector('[role=\"dialog\"]:not([hidden])'), null);
  } finally { f.close(); }
});
test('dragging the orb stores a clamped position without activating translation; keyboard movement and resize remain on screen', async () => {
  const f = setup();
  try {
    f.pointer(f.orb, 'pointerdown', 960, 700); f.pointer(f.w, 'pointermove', 260, 200); f.pointer(f.w, 'pointerup', 260, 200);
    f.orb.click(); assert.equal(f.actions.toggles, 0);
    assert.equal(parseFloat(f.pet.host.style.left), 230); assert.equal(parseFloat(f.pet.host.style.top), 150);
    assert.equal(f.saved.length, 1);
    f.orb.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(parseFloat(f.pet.host.style.left), 246);
    Object.defineProperty(f.w, 'innerWidth', { value: 320 }); Object.defineProperty(f.w, 'innerHeight', { value: 300 });
    f.w.dispatchEvent(new f.w.Event('resize'));
    assert(parseFloat(f.pet.host.style.left) + 68 <= 308); assert(parseFloat(f.pet.host.style.top) + 94 <= 288);
    f.orb.click(); assert.equal(f.actions.toggles, 0, 'synthetic clicks never activate translation');
  } finally { f.close(); }
});
test('synthetic logo, keyboard and retry events cannot activate paid translation, including with a selection open', () => {
  const f = setup();
  try {
    f.orb.click();
    f.orb.dispatchEvent(new f.w.MouseEvent('click', { bubbles: true }));
    f.orb.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(f.actions.toggles, 0);
    f.pet.beginSelection('s', f.range); f.pet.showSelection('s', '失败后可以重试', true);
    const retry = f.shadow.querySelector<HTMLButtonElement>('.retry')!;
    retry.click(); retry.dispatchEvent(new f.w.MouseEvent('click', { bubbles: true }));
    retry.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.orb.click();
    assert.deepEqual(f.actions, { toggles: 0, dismissals: 0, retries: 0 });
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, false, 'untrusted input cannot masquerade as a logo action');
  } finally { f.close(); }
});
test('reduced motion shows safe selection results without travel delays and closes back to the chosen dock', () => {
  const f = setup(true);
  try {
    const home = [f.pet.host.style.left, f.pet.host.style.top];
    f.pet.beginSelection('s1', f.range); f.pet.update('loading', '正在翻译', '点击收起', false);
    assert.notDeepEqual([f.pet.host.style.left, f.pet.host.style.top], home);
    assert.equal(f.pet.host.hasAttribute('data-traveling'), false);
    assert.equal(f.shadow.querySelector<HTMLElement>('.stage')!.dataset.reaction, undefined);
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    f.pet.showSelection('s1', '<img src=x onerror=alert(1)> 原样文本');
    assert.equal(f.shadow.querySelector('.result')!.textContent, '<img src=x onerror=alert(1)> 原样文本');
    assert.equal(f.shadow.querySelector('img'), null); assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, false);
    f.shadow.querySelector<HTMLButtonElement>('.close')!.click();
    assert.equal(f.actions.dismissals, 1); assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    assert.deepEqual([f.pet.host.style.left, f.pet.host.style.top], home);
    f.pet.showSelection('s1', '迟到的译文'); assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
  } finally { f.close(); }
});
test('a superseded flight cannot reveal an old dialog and Escape dismisses the current result', async () => {
  const f = setup(false);
  try {
    f.pet.beginSelection('old', f.range); f.pet.showSelection('old', '旧译文');
    f.setRect(new f.w.DOMRect(300, 120, 110, 22) as any);
    f.pet.beginSelection('new', f.range); f.pet.showSelection('new', '新译文'); f.pet.showSelection('old', '不能覆盖');
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    await until(() => !f.shadow.querySelector<HTMLElement>('.dialog')!.hidden);
    assert.equal(f.shadow.querySelector('.result')!.textContent, '新译文');
    f.shadow.querySelector<HTMLButtonElement>('.close')!.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const dialog = f.shadow.querySelector<HTMLElement>('.dialog')!;
    assert.equal(f.actions.dismissals, 1); assert.equal(dialog.dataset.state, 'closing');
    assert.equal(dialog.inert, true); assert.equal(dialog.getAttribute('aria-hidden'), 'true');
    await until(() => dialog.hidden); assert.equal(f.pet.host.dataset.traveling, 'home');
  } finally { f.close(); }
});
test('closing cancels results immediately while the dialog exits, and a new selection cancels the pending return', async () => {
  const f = setup(false);
  try {
    const dialog = f.shadow.querySelector<HTMLElement>('.dialog')!;
    f.pet.beginSelection('first', f.range); f.pet.showSelection('first', '第一条译文');
    await until(() => dialog.dataset.state === 'open');
    const selectedPosition = [f.pet.host.style.left, f.pet.host.style.top];
    f.pet.closeSelection();
    assert.equal(dialog.hidden, false); assert.equal(dialog.dataset.state, 'closing');
    assert.deepEqual([f.pet.host.style.left, f.pet.host.style.top], selectedPosition, 'the pet waits for the bubble to fold');
    f.pet.showSelection('first', '迟到结果'); assert.equal(f.shadow.querySelector('.result')!.textContent, '第一条译文');
    f.pet.beginSelection('second', f.range); f.pet.showSelection('second', '第二条译文');
    await until(() => dialog.dataset.state === 'open');
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(dialog.hidden, false); assert.equal(dialog.inert, false);
    assert.equal(f.shadow.querySelector('.result')!.textContent, '第二条译文');
    assert.deepEqual([f.pet.host.style.left, f.pet.host.style.top], selectedPosition);
    assert.notEqual(f.pet.host.dataset.traveling, 'home');
  } finally { f.close(); }
});
test('dragging interrupts a journey and releases its pending result without a later snap back', async () => {
  const f = setup(false);
  try {
    f.pet.beginSelection('drag', f.range); f.pet.showSelection('drag', '拖动中的译文');
    assert.equal(f.pet.host.dataset.traveling, 'selection');
    f.pointer(f.orb, 'pointerdown', 440, 290); f.pointer(f.w, 'pointermove', 240, 180); f.pointer(f.w, 'pointerup', 240, 180);
    const dock = [f.pet.host.style.left, f.pet.host.style.top];
    assert.equal(f.pet.host.hasAttribute('data-traveling'), false);
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.dataset.state, 'open');
    f.pet.closeSelection(); await until(() => f.shadow.querySelector<HTMLElement>('.dialog')!.hidden);
    assert.deepEqual([f.pet.host.style.left, f.pet.host.style.top], dock);
    assert.equal(f.saved.length, 1);
  } finally { f.close(); }
});
test('selection dialogs stay within a narrow viewport, follow scrolling, and reject synthetic retry', () => {
  const f = setup();
  try {
    Object.defineProperty(f.w, 'innerWidth', { value: 320 }); Object.defineProperty(f.w, 'innerHeight', { value: 420 });
    f.setRect(new f.w.DOMRect(210, 330, 90, 20) as any);
    f.pet.beginSelection('s', f.range); f.pet.showSelection('s', '连接中断，可以重试。', true);
    const dialog = f.shadow.querySelector<HTMLElement>('.dialog')!;
    assert.equal(dialog.style.width, '296px'); assert(parseFloat(dialog.style.left) >= 12); assert(parseFloat(dialog.style.top) >= 12);
    assert.equal(f.shadow.querySelector<HTMLButtonElement>('.retry')!.hidden, false);
    f.shadow.querySelector<HTMLButtonElement>('.retry')!.click(); assert.equal(f.actions.retries, 0);
    const previousY = f.pet.host.style.top;
    f.setRect(new f.w.DOMRect(210, 170, 90, 20) as any); f.w.document.dispatchEvent(new f.w.Event('scroll'));
    assert.notEqual(f.pet.host.style.top, previousY);
    f.setRect(new f.w.DOMRect(210, -100, 90, 20) as any); f.w.document.dispatchEvent(new f.w.Event('scroll'));
    assert.equal(dialog.hidden, true); assert.equal(f.actions.dismissals, 1);
  } finally { f.close(); }
});
test('sharing displays untrusted recipient and billing data as text, and synthetic acceptance leaves it pending', async () => {
  const f = setup();
  try {
    const origin = 'https://provider.example/<img src=x onerror=alert(1)>';
    const billing = '<script>paid()</script> API 按量计费';
    let result: boolean | undefined;
    const answer = f.pet.requestSharing(origin, billing).then(value => { result = value; return value; });
    const dialog = f.shadow.querySelector<HTMLElement>('.sharing')!;
    const accept = dialog.querySelector<HTMLButtonElement>('.accept')!;
    assert.equal(dialog.hidden, false);
    assert.equal(dialog.querySelector('.recipient')!.textContent, origin);
    assert.equal(dialog.querySelector('.billing')!.textContent, billing);
    assert.equal(dialog.querySelector('img,script'), null);
    assert.equal(f.shadow.activeElement, dialog.querySelector('.cancel'), 'cancel is the initial keyboard action');
    accept.click(); accept.dispatchEvent(new f.w.MouseEvent('click', { bubbles: true }));
    accept.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    assert.equal(result, undefined, 'an untrusted accept must not grant consent or resolve the request');
    assert.equal(dialog.hidden, false);
    f.pet.cancelSharing();
    assert.equal(await answer, false);
    assert.equal(dialog.hidden, true); assert.equal(dialog.inert, true);
    assert.equal(f.shadow.activeElement, f.orb);
  } finally { f.close(); }
});
test('all sharing dismissals settle false, clear content, and cannot be revived by late acceptance', async () => {
  const dismissals = ['cancel API', 'cancel button', 'close button', 'Escape', 'outside Escape', 'outside pointer', 'selection dismissal', 'new selection', 'destroy'] as const;
  for (const reason of dismissals) {
    const f = setup();
    try {
      let settlements = 0;
      const answer = f.pet.requestSharing('https://provider.example', 'API 按量计费').then(value => { settlements++; return value; });
      switch (reason) {
        case 'cancel API': f.pet.cancelSharing(); break;
        case 'cancel button': f.shadow.querySelector<HTMLButtonElement>('.sharing .cancel')!.click(); break;
        case 'close button': f.shadow.querySelector<HTMLButtonElement>('.sharing-close')!.click(); break;
        case 'Escape': f.shadow.querySelector('.sharing')!.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); break;
        case 'outside Escape': f.w.document.body.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); break;
        case 'outside pointer': f.pointer(f.w.document.body, 'pointerdown', 20, 20); break;
        case 'selection dismissal': f.pet.closeSelection(); break;
        case 'new selection': f.pet.beginSelection('new', f.range); break;
        case 'destroy': f.pet.destroy(); break;
      }
      assert.equal(await answer, false, reason);
      f.shadow.querySelector<HTMLButtonElement>('.sharing .accept')!.click();
      f.pet.cancelSharing(); await Promise.resolve();
      assert.equal(settlements, 1, reason);
      const dialog = f.shadow.querySelector<HTMLElement>('.sharing')!;
      assert.equal(dialog.hidden, true, reason);
      assert.equal(dialog.querySelector('.recipient')!.textContent, '', reason);
      assert.equal(dialog.querySelector('.billing')!.textContent, '', reason);
      assert.equal(f.actions.toggles, 0, reason);
    } finally { f.close(); }
  }
});
test('superseding consent cancels only the previous request and destroyed surfaces cannot request consent', async () => {
  const f = setup();
  try {
    const first = f.pet.requestSharing('https://first.example', 'first billing');
    const second = f.pet.requestSharing('https://second.example', 'second billing');
    assert.equal(await first, false);
    assert.equal(f.shadow.querySelector('.sharing .recipient')!.textContent, 'https://second.example');
    assert.equal(f.shadow.querySelector<HTMLElement>('.sharing')!.hidden, false);
    f.pet.destroy();
    assert.equal(await second, false);
    assert.equal(await f.pet.requestSharing('https://third.example', 'third billing'), false);
    assert.equal(f.pet.host.isConnected, false);
  } finally { f.close(); }
});
test('sharing replaces an active selection and remains bounded when the viewport changes', async () => {
  const f = setup();
  try {
    f.pet.beginSelection('s', f.range); f.pet.showSelection('s', '已翻译');
    const answer = f.pet.requestSharing('https://provider.example', 'API 按量计费');
    assert.equal(f.actions.dismissals, 1);
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    const dialog = f.shadow.querySelector<HTMLElement>('.sharing')!;
    Object.defineProperty(f.w, 'innerWidth', { value: 280 });
    Object.defineProperty(f.w, 'innerHeight', { value: 320 });
    f.w.dispatchEvent(new f.w.Event('resize'));
    const x = parseFloat(dialog.style.left), y = parseFloat(dialog.style.top), width = parseFloat(dialog.style.width);
    assert(x >= 0 && x + width <= f.w.innerWidth); assert(y >= 0 && y < f.w.innerHeight);
    f.pet.showSelection('s', '迟到的译文');
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    f.pet.cancelSharing(); assert.equal(await answer, false);
  } finally { f.close(); }
});
