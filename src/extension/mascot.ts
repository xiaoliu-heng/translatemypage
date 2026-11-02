import { OWN } from './extractor';

export type MascotMode = 'sleeping' | 'loading' | 'ready' | 'error';
type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const WIDTH = 68, HEIGHT = 94, EDGE = 12;
const DIALOG_EXIT = 180;
const CSS = `
:host{all:initial;position:fixed!important;display:block!important;width:68px!important;height:94px!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:light!important;font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif!important;color:#244638!important;transition:left var(--travel-duration,0ms) cubic-bezier(.22,.68,.22,1),top var(--travel-duration,0ms) cubic-bezier(.22,.68,.22,1)!important}
*{box-sizing:border-box}button{font:inherit;color:inherit}button:focus-visible{outline:3px solid #83a6ff;outline-offset:5px}[hidden]{display:none!important}
.stage{position:relative;width:68px;height:94px;pointer-events:none}.orb{position:absolute;left:2px;top:28px;width:64px;height:64px;border:0;padding:0;background:none;cursor:grab;touch-action:none;user-select:none;pointer-events:auto;-webkit-user-select:none;border-radius:17px}.orb:active{cursor:grabbing}
.stride,.gesture{position:absolute;inset:0;transform-origin:50% 90%}.gesture{transition:scale .18s ease}.orb:active .gesture{scale:.96}
.brand{display:block;width:64px;height:64px;filter:drop-shadow(0 4px 5px #203e3523)}.state{position:absolute;left:4px;right:4px;top:4px;text-align:center;font-size:11px;line-height:19px;border-radius:3px;background:#eef0e9;color:#617166;border:1px solid #b6c4ba}.stage[data-mode=ready] .state{background:#e5edce;color:#285442;border-color:#9bae8b}.stage[data-mode=loading] .state{background:#fff3c9;color:#795f21;border-color:#d0b963}.stage[data-mode=error] .state{background:#ffe6b5;color:#8a592b;border-color:#9c7040}.stage[data-mode=loading] .brand{animation:working 1s ease-in-out infinite}
.stage[data-reaction=wake] .gesture{animation:wake .46s cubic-bezier(.2,.8,.3,1)}.stage[data-reaction=sleep] .gesture{animation:doze .46s ease-in-out}.stage[data-reaction=pleased] .gesture{animation:nod .38s ease-in-out}.stage[data-reaction=oops] .gesture{animation:shake .38s ease-in-out}.stage[data-reaction=land] .gesture{animation:land .3s ease-out}
:host([data-traveling]) .stride{animation:run .18s ease-in-out infinite alternate}
.dialog{position:fixed;pointer-events:auto;width:352px;padding:15px 17px 16px;background:#fffdf1;border:3px solid #345044;border-radius:4px;box-shadow:inset 0 0 0 2px #fffdf1,inset 0 0 0 3px #d7dec4,5px 5px 0 #223b3026,0 12px 30px #1b342321;opacity:0;transform:translateY(9px) scale(.92);transform-origin:var(--tail,50%) 100%;transition:opacity .2s ease,transform .32s cubic-bezier(.16,1.25,.3,1);user-select:text}.dialog[data-state=open]{opacity:1;transform:none}.dialog[data-state=closing]{pointer-events:none;transform:translateY(5px) scale(.96);transition:opacity .16s ease,transform .18s ease}.dialog[data-side=below]{transform-origin:var(--tail,50%) 0}.dialog:before{content:'';position:absolute;width:12px;height:12px;background:#fffdf1;border-left:3px solid #345044;border-bottom:3px solid #345044;left:var(--tail,24px);bottom:-9px;transform:rotate(-45deg)}.dialog[data-side=below]:before{top:-9px;bottom:auto;transform:rotate(135deg)}.dialog[data-side=beside]:before{display:none}
.dialog header{display:flex;align-items:center;gap:8px;margin:0 0 11px;padding:0 0 9px;border-bottom:1px dashed #c7d1b9;font-weight:600;line-height:1.4;color:#3e614a}.dialog .name{background:#e5edce;padding:2px 8px;border-radius:3px}.dialog .kind{font-size:10px;letter-spacing:1.5px;color:#829076}.close{margin-left:auto;border:0;background:none;font:22px/1 system-ui;padding:0 2px;cursor:pointer;border-radius:3px}.result{margin:0;font-size:15px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;max-height:min(320px,50vh);overflow:auto;color:#2c493b}.retry{margin-top:12px;padding:5px 10px;border:1px solid #9bae8b;background:#e8efda;border-radius:3px;cursor:pointer}.sr{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;white-space:nowrap;pointer-events:none}
.sharing p{margin:8px 0;overflow-wrap:anywhere}.sharing .recipient{font-weight:600;color:#285442}.sharing .choices{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.sharing .choices button{border:1px solid #9bae8b;border-radius:3px;padding:5px 10px;background:#fffdf1;cursor:pointer}.sharing .choices .accept{background:#285442;border-color:#285442;color:#fffdf1}.sharing{max-height:calc(100vh - 24px);overflow:auto}
@keyframes working{50%{opacity:.6}}@keyframes run{to{transform:translateY(-3px) rotate(var(--run-lean,4deg))}}
@keyframes wake{0%{transform:scale(1.06,.94)}38%{transform:translateY(-7px) scale(.94,1.07)}70%{transform:translateY(1px) scale(1.04,.96)}100%{transform:none}}@keyframes doze{30%{transform:translateY(-2px) rotate(-5deg)}65%{transform:translateY(2px) scale(1.04,.96)}100%{transform:none}}@keyframes nod{35%{transform:translateY(2px) scale(1.04,.96)}70%{transform:translateY(-3px)}100%{transform:none}}@keyframes shake{25%,65%{transform:rotate(-5deg)}45%,85%{transform:rotate(5deg)}100%{transform:none}}@keyframes land{0%{transform:translateY(-2px)}40%{transform:translateY(2px) scale(1.07,.93)}100%{transform:none}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
`;

export class TranslationMascot {
  readonly host: HTMLElement;
  private stage: HTMLElement;
  private orb: HTMLButtonElement;
  private live: HTMLElement;
  private dialog: HTMLElement;
  private result: HTMLElement;
  private retryButton: HTMLButtonElement;
  private stateLabel: HTMLElement;
  private sharing: HTMLElement;
  private recipient: HTMLElement;
  private billing: HTMLElement;
  private sharingResolve?: (accepted: boolean) => void;
  private mode: MascotMode = 'sleeping';
  private home: Point;
  private point: Point;
  private range?: Range;
  private selectionId?: string;
  private flight?: ReturnType<typeof setTimeout>;
  private reveal?: ReturnType<typeof setTimeout>;
  private reaction?: ReturnType<typeof setTimeout>;
  private exit?: ReturnType<typeof setTimeout>;
  private returning?: ReturnType<typeof setTimeout>;
  private pendingResult?: { id: string; text: string; failed: boolean };
  private arrival = 0;
  private userMoved = false;
  private disposed = false;
  private drag?: { id: number; x: number; y: number; origin: Point; moved: boolean };
  private suppressClick = false;

  constructor(private actions: { toggle(): void; dismiss(): void; retry(): void }) {
    const size = this.viewport(); this.home = this.clamp({ x: size.width - 94, y: size.height - 118 }); this.point = { ...this.home };
    const host = document.createElement('div'); this.host = host; host.setAttribute(OWN, 'mascot'); host.dataset.state = 'sleeping';
    // Keep the reset in the outer inline context so it cannot override dynamically positioned
    // coordinates across the Shadow DOM's reversed !important cascade.
    host.style.setProperty('all', 'initial', 'important');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = CSS;
    // All markup is static UI artwork. Translation text is assigned with textContent below.
    const ui = document.createElement('div'); ui.innerHTML = `<div class="stage" data-mode="sleeping">
      <span class="state" aria-hidden="true">未开启</span>
      <button class="orb" type="button" aria-pressed="false" aria-label="翻译未开启，点击开启整页翻译；可拖动位置"><span class="stride"><span class="gesture"><svg class="brand" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" aria-hidden="true"><rect x="12" y="12" width="104" height="104" rx="27" fill="#285442"/><text x="64" y="88" text-anchor="middle" fill="#fffdf1" font-family="PingFang SC,Heiti SC,Microsoft YaHei,sans-serif" font-size="70" font-weight="600">译</text></svg></span></span></button></div>
      <section class="dialog" role="dialog" aria-label="译译的翻译对话框" hidden><header><span class="name">译译</span><span class="kind">TRANSLATION</span><button class="close" type="button" aria-label="关闭译文对话框">×</button></header><p class="result" aria-live="polite"></p><button class="retry" type="button" hidden>再试一次</button></section>
      <section class="dialog sharing" role="dialog" aria-label="确认分享网页内容" hidden><header>开启翻译前确认<button class="close sharing-close" type="button" aria-label="取消分享网页内容">×</button></header><p>待翻译的网页或选中文本将发送至：</p><p class="recipient"></p><p class="billing"></p><p>仅在你确认后发送。请勿分享密码或其他敏感信息。</p><div class="choices"><button class="cancel" type="button">取消</button><button class="accept" type="button">同意并翻译</button></div></section><span class="sr" role="status" aria-live="polite"></span>`;
    shadow.append(style, ...ui.childNodes);
    this.stage = shadow.querySelector('.stage')!; this.orb = shadow.querySelector('.orb')!; this.live = shadow.querySelector('.sr')!;
    this.dialog = shadow.querySelector('.dialog')!; this.result = shadow.querySelector('.result')!; this.retryButton = shadow.querySelector('.retry')!;
    this.stateLabel = shadow.querySelector('.state')!; this.sharing = shadow.querySelector('.sharing')!;
    this.recipient = shadow.querySelector('.recipient')!; this.billing = shadow.querySelector('.billing')!;
    this.orb.addEventListener('pointerdown', this.pointerDown);
    this.orb.onclick = e => {
      if (!e.isTrusted || this.disposed) return;
      if (this.suppressClick) { this.suppressClick = false; return; }
      this.cancelSharing();
      if (this.selectionId) this.closeSelection();
      this.actions.toggle();
    };
    this.orb.onkeydown = e => {
      this.suppressClick = false;
      const delta: Record<string, Point> = { ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 }, ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 } };
      if (delta[e.key]) { e.preventDefault(); this.remember(this.clamp({ x: this.point.x + delta[e.key].x, y: this.point.y + delta[e.key].y })); }
    };
    shadow.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.closeSelection();
    this.retryButton.onclick = e => { if (e.isTrusted && !this.disposed && !this.retryButton.hidden && this.selectionId) this.actions.retry(); };
    shadow.querySelector<HTMLButtonElement>('.sharing-close')!.onclick = () => this.cancelSharing();
    shadow.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => this.cancelSharing();
    shadow.querySelector<HTMLButtonElement>('.accept')!.onclick = e => { if (e.isTrusted && !this.disposed) this.settleSharing(true); };
    shadow.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key !== 'Escape') return;
      e.stopPropagation();
      if (this.sharingResolve) this.cancelSharing(); else this.closeSelection();
      this.orb.focus({ preventScroll: true });
    });
    document.defaultView?.addEventListener('pointermove', this.pointerMove);
    document.defaultView?.addEventListener('pointerup', this.pointerUp);
    document.defaultView?.addEventListener('pointercancel', this.pointerCancel);
    document.defaultView?.addEventListener('resize', this.reposition);
    document.addEventListener('scroll', this.reposition, { capture: true, passive: true });
    document.addEventListener('pointerdown', this.dismissSharing, true);
    document.addEventListener('keydown', this.escapeSharing, true);
    document.documentElement.append(host); this.place(this.point);
    const storage = (globalThis as any).chrome?.storage?.local;
    void storage?.get('mascotPosition').then((stored: any) => {
      const p = stored?.mascotPosition;
      if (!this.disposed && !this.userMoved && Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
        this.home = this.clamp(p); if (!this.selectionId) this.place(this.home);
      }
    }).catch(() => {});
  }
  private viewport() { return { width: document.defaultView?.innerWidth || 1024, height: document.defaultView?.innerHeight || 768 }; }
  private reducedMotion() { return document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; }
  private clamp(p: Point): Point { const v = this.viewport(); return { x: Math.max(EDGE, Math.min(p.x, v.width - WIDTH - EDGE)), y: Math.max(EDGE, Math.min(p.y, v.height - HEIGHT - EDGE)) }; }
  private place(p: Point, duration = 0) {
    this.point = this.clamp(p);
    this.host.style.setProperty('--travel-duration', `${duration}ms`);
    if (!duration) { clearTimeout(this.flight); this.host.removeAttribute('data-traveling'); this.arrival = 0; }
    this.host.style.setProperty('left', `${this.point.x}px`, 'important'); this.host.style.setProperty('top', `${this.point.y}px`, 'important');
    if (!this.dialog.hidden && this.dialog.dataset.state !== 'closing') this.placeDialog();
    if (!this.sharing.hidden) this.placeDialog(this.sharing);
  }
  private actualPoint(): Point {
    const rect = this.host.getBoundingClientRect();
    return rect.width ? { x: rect.left, y: rect.top } : this.point;
  }
  private travel(p: Point, kind: 'selection' | 'home') {
    clearTimeout(this.flight);
    const from = this.actualPoint(), target = this.clamp(p), distance = Math.hypot(target.x - from.x, target.y - from.y);
    // Freeze an interrupted journey at its rendered position before changing the destination.
    this.place(from); this.host.getBoundingClientRect();
    const duration = this.reducedMotion() || distance < 1 ? 0 : Math.round(Math.min(760, 240 + distance * .5));
    if (duration) {
      this.host.dataset.traveling = kind;
      this.host.style.setProperty('--run-lean', target.x < from.x ? '-4deg' : '4deg');
    }
    this.place(target, duration); this.arrival = Date.now() + duration;
    if (duration) this.flight = setTimeout(() => {
      this.host.removeAttribute('data-traveling'); this.host.style.setProperty('--travel-duration', '0ms');
      this.react('land');
    }, duration);
    return duration;
  }
  private react(name: string) {
    // A cached result can arrive within a frame; let the initial stretch finish first.
    if (this.stage.dataset.reaction === 'wake' && (name === 'pleased' || name === 'land')) return;
    clearTimeout(this.reaction);
    if (this.reducedMotion()) { delete this.stage.dataset.reaction; return; }
    this.stage.dataset.reaction = name;
    this.reaction = setTimeout(() => { delete this.stage.dataset.reaction; }, 470);
  }
  private remember(p: Point) {
    clearTimeout(this.returning);
    this.userMoved = true; this.range = undefined; this.home = this.clamp(p); this.place(this.home);
    void (globalThis as any).chrome?.storage?.local?.set({ mascotPosition: this.home }).catch(() => {});
  }
  private pointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.drag) return;
    e.preventDefault(); e.stopPropagation(); this.suppressClick = false;
    const actual = this.host.getBoundingClientRect();
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, origin: { x: actual.width ? actual.left : this.point.x, y: actual.height ? actual.top : this.point.y }, moved: false };
    try { this.orb.setPointerCapture(e.pointerId); } catch {}
  };
  private pointerMove = (e: PointerEvent) => {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    const x = e.clientX - d.x, y = e.clientY - d.y;
    if (!d.moved && Math.hypot(x, y) < 4) return;
    d.moved = true; clearTimeout(this.returning); this.place(this.clamp({ x: d.origin.x + x, y: d.origin.y + y })); this.revealSelection();
  };
  private pointerUp = (e: PointerEvent) => {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    this.drag = undefined; this.suppressClick = d.moved;
    if (d.moved) this.remember(this.point);
    try { this.orb.releasePointerCapture(e.pointerId); } catch {}
  };
  private pointerCancel = (e: PointerEvent) => { if (this.drag?.id === e.pointerId) { this.drag = undefined; this.suppressClick = true; this.place(this.point); } };
  update(mode: MascotMode, summary: string, action: string, enabled: boolean) {
    if (mode !== this.mode) this.react(mode === 'sleeping' ? 'sleep' : this.mode === 'sleeping' ? 'wake' : mode === 'error' ? 'oops' : mode === 'ready' ? 'pleased' : 'wake');
    this.mode = mode; this.stage.dataset.mode = mode; this.host.dataset.state = mode;
    this.stateLabel.textContent = mode === 'loading' && !enabled ? '准备中' : mode === 'ready' && !enabled ? '选区完成'
      : { sleeping: '未开启', loading: '翻译中', ready: '已开启', error: '出错了' }[mode];
    this.orb.setAttribute('aria-pressed', String(enabled));
    this.orb.setAttribute('aria-label', `${summary}；${action}；拖动或用方向键移动`); this.orb.title = `${summary}\n${action}`;
    if (this.live.textContent !== summary) this.live.textContent = summary;
  }
  private anchor(): Rect | undefined {
    if (!this.range?.commonAncestorContainer.isConnected) return;
    const rects = typeof this.range.getClientRects === 'function' ? [...this.range.getClientRects()] : [];
    return rects.at(-1) || (this.range.commonAncestorContainer instanceof Element ? this.range.commonAncestorContainer : this.range.commonAncestorContainer.parentElement)?.getBoundingClientRect();
  }
  beginSelection(id: string, range: Range) {
    this.cancelSharing();
    clearTimeout(this.reveal); clearTimeout(this.returning); this.pendingResult = undefined; this.hideDialog();
    this.selectionId = id; this.range = range.cloneRange();
    const rect = this.anchor(), v = this.viewport();
    const target = rect ? { x: rect.right + WIDTH + EDGE <= v.width ? rect.right + 10 : rect.left - WIDTH - 10, y: rect.bottom - HEIGHT + 32 } : this.home;
    this.travel(target, 'selection');
  }
  showSelection(id: string, text: string, failed = false) {
    if (id !== this.selectionId) return;
    this.pendingResult = { id, text, failed }; this.revealSelection();
  }
  private revealSelection() {
    clearTimeout(this.reveal);
    if (!this.pendingResult) return;
    const show = () => {
      const result = this.pendingResult;
      if (!result || result.id !== this.selectionId || this.disposed) return;
      this.pendingResult = undefined; clearTimeout(this.exit);
      this.result.textContent = result.text; this.retryButton.hidden = !result.failed;
      this.dialog.hidden = false; this.dialog.inert = false; this.dialog.removeAttribute('aria-hidden');
      this.dialog.dataset.state = 'opening'; this.placeDialog(); this.dialog.getBoundingClientRect();
      this.dialog.dataset.state = 'open';
    };
    const wait = this.arrival - Date.now(); if (wait > 0) this.reveal = setTimeout(show, wait); else show();
  }
  private hideDialog() {
    clearTimeout(this.exit);
    const finish = () => { this.dialog.hidden = true; this.result.textContent = ''; delete this.dialog.dataset.state; };
    const duration = this.dialog.hidden || this.reducedMotion() ? 0 : DIALOG_EXIT;
    this.dialog.inert = true; this.dialog.setAttribute('aria-hidden', 'true');
    if (duration) { this.dialog.dataset.state = 'closing'; this.exit = setTimeout(finish, duration); }
    else finish();
    return duration;
  }
  private placeDialog(dialog = this.dialog) {
    const v = this.viewport(), width = Math.min(352, v.width - EDGE * 2);
    dialog.style.width = `${width}px`;
    const height = dialog.offsetHeight || dialog.getBoundingClientRect().height || 150;
    const x = Math.max(EDGE, Math.min(this.point.x + WIDTH / 2 - width / 2, v.width - width - EDGE));
    let y = this.point.y - height - 14, side = 'above';
    if (y < EDGE) { y = this.point.y + HEIGHT + 12; side = 'below'; }
    if (y + height > v.height - EDGE) { y = Math.max(EDGE, v.height - height - EDGE); side = 'beside'; }
    dialog.style.left = `${x}px`; dialog.style.top = `${y}px`; dialog.dataset.side = side;
    dialog.style.setProperty('--tail', `${Math.max(16, Math.min(width - 32, this.point.x + WIDTH / 2 - x - 7))}px`);
  }
  private reposition = () => {
    this.home = this.clamp(this.home);
    if (this.range) {
      const rect = this.anchor(), v = this.viewport();
      if (!rect || rect.bottom < 0 || rect.top > v.height) { this.closeSelection(); return; }
      this.place({ x: rect.right + WIDTH + EDGE <= v.width ? rect.right + 10 : rect.left - WIDTH - 10, y: rect.bottom - HEIGHT + 32 });
      this.revealSelection();
    } else {
      const target = this.selectionId ? this.point : this.home;
      if (!this.host.hasAttribute('data-traveling') || target.x !== this.point.x || target.y !== this.point.y) this.place(target);
    }
  };
  closeSelection(notify = true) {
    this.cancelSharing();
    clearTimeout(this.reveal); clearTimeout(this.returning); this.pendingResult = undefined;
    this.selectionId = undefined; this.range = undefined;
    const duration = this.hideDialog();
    if (duration) this.returning = setTimeout(() => { this.travel(this.home, 'home'); }, duration);
    else this.travel(this.home, 'home');
    if (notify) this.actions.dismiss();
  }
  requestSharing(origin: string, billingLabel: string): Promise<boolean> {
    this.cancelSharing();
    if (this.disposed) return Promise.resolve(false);
    if (this.selectionId) this.closeSelection();
    this.recipient.textContent = origin;
    this.billing.textContent = billingLabel;
    this.sharing.hidden = false; this.sharing.inert = false; this.sharing.removeAttribute('aria-hidden');
    this.sharing.dataset.state = 'open'; this.placeDialog(this.sharing);
    const answer = new Promise<boolean>(resolve => { this.sharingResolve = resolve; });
    this.sharing.querySelector<HTMLButtonElement>('.cancel')!.focus({ preventScroll: true });
    return answer;
  }
  cancelSharing(): void { this.settleSharing(false); }
  private settleSharing(accepted: boolean) {
    const resolve = this.sharingResolve;
    this.sharingResolve = undefined;
    this.sharing.hidden = true; this.sharing.inert = true; this.sharing.setAttribute('aria-hidden', 'true');
    this.recipient.textContent = ''; this.billing.textContent = ''; delete this.sharing.dataset.state;
    if (resolve) { resolve(accepted); this.orb.focus({ preventScroll: true }); }
  }
  private dismissSharing = (e: Event) => { if (this.sharingResolve && !e.composedPath().includes(this.host)) this.cancelSharing(); };
  private escapeSharing = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.sharingResolve) { e.stopPropagation(); this.cancelSharing(); }
  };
  destroy() {
    this.cancelSharing();
    this.disposed = true; clearTimeout(this.reveal); clearTimeout(this.flight); clearTimeout(this.reaction); clearTimeout(this.exit); clearTimeout(this.returning); this.host.remove();
    document.defaultView?.removeEventListener('pointermove', this.pointerMove); document.defaultView?.removeEventListener('pointerup', this.pointerUp);
    document.defaultView?.removeEventListener('pointercancel', this.pointerCancel); document.defaultView?.removeEventListener('resize', this.reposition);
    document.removeEventListener('scroll', this.reposition, true);
    document.removeEventListener('pointerdown', this.dismissSharing, true);
    document.removeEventListener('keydown', this.escapeSharing, true);
  }
}
