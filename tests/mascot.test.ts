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
test('the only persistent UI is a sleeping orb; loading, ready and failure use distinct head expressions', () => {
  const f = setup();
  try {
    assert.equal(f.shadow.querySelector('.panel'), null);
    assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    for (const mode of ['sleeping', 'loading', 'ready', 'error'] as const) {
      f.pet.update(mode, `状态 ${mode}`, '点击操作');
      assert.equal(f.pet.host.dataset.state, mode);
      assert.equal(f.shadow.querySelector<HTMLElement>('.stage')!.dataset.mode, mode);
      assert.equal(f.shadow.querySelector('.head')!.getAttribute('aria-hidden'), 'true');
      assert.equal(f.shadow.querySelector('.head [hidden]'), null, 'head layers remain mounted for crossfades');
      assert.equal(f.pet.host.style.getPropertyValue('--travel-duration'), '0ms');
      assert.equal(f.shadow.querySelector<HTMLElement>('.dialog')!.hidden, true);
    }
    f.orb.click(); assert.equal(f.actions.toggles, 1);
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
    f.orb.click(); assert.equal(f.actions.toggles, 1);
  } finally { f.close(); }
});
test('an immediate cached result completes the wake gesture before settling, while reduced motion skips gestures', () => {
  for (const reduced of [false, true]) {
    const f = setup(reduced);
    try {
      const stage = f.shadow.querySelector<HTMLElement>('.stage')!;
      f.pet.update('loading', '正在翻译', '等待');
      const waking = stage.dataset.reaction;
      f.pet.update('ready', '已完成', '点击操作');
      assert.equal(stage.dataset.reaction, reduced ? undefined : 'wake');
      assert.equal(stage.dataset.reaction, waking);
      f.pet.update('sleeping', '未开启', '点击开启');
      assert.equal(stage.dataset.reaction, reduced ? undefined : 'sleep');
    } finally { f.close(); }
  }
});
test('selection loading only moves the pet; a safe game dialog opens on completion and closes back to the chosen dock', () => {
  const f = setup();
  try {
    const home = [f.pet.host.style.left, f.pet.host.style.top];
    f.pet.beginSelection('s1', f.range); f.pet.update('loading', '正在翻译', '点击收起');
    assert.notDeepEqual([f.pet.host.style.left, f.pet.host.style.top], home);
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
test('selection dialogs stay within a narrow viewport, follow scrolling, and support an explicit retry', () => {
  const f = setup();
  try {
    Object.defineProperty(f.w, 'innerWidth', { value: 320 }); Object.defineProperty(f.w, 'innerHeight', { value: 420 });
    f.setRect(new f.w.DOMRect(210, 330, 90, 20) as any);
    f.pet.beginSelection('s', f.range); f.pet.showSelection('s', '连接中断，可以重试。', true);
    const dialog = f.shadow.querySelector<HTMLElement>('.dialog')!;
    assert.equal(dialog.style.width, '296px'); assert(parseFloat(dialog.style.left) >= 12); assert(parseFloat(dialog.style.top) >= 12);
    assert.equal(f.shadow.querySelector<HTMLButtonElement>('.retry')!.hidden, false);
    f.shadow.querySelector<HTMLButtonElement>('.retry')!.click(); assert.equal(f.actions.retries, 1);
    const previousY = f.pet.host.style.top;
    f.setRect(new f.w.DOMRect(210, 170, 90, 20) as any); f.w.document.dispatchEvent(new f.w.Event('scroll'));
    assert.notEqual(f.pet.host.style.top, previousY);
    f.setRect(new f.w.DOMRect(210, -100, 90, 20) as any); f.w.document.dispatchEvent(new f.w.Event('scroll'));
    assert.equal(dialog.hidden, true); assert.equal(f.actions.dismissals, 1);
  } finally { f.close(); }
});
