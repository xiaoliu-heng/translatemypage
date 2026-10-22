import { OWN } from './extractor';

export type MascotMode = 'sleeping' | 'loading' | 'ready' | 'error';
type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const WIDTH = 68, HEIGHT = 94, EDGE = 12;
const DIALOG_EXIT = 180;
const CSS = `
:host{all:initial;position:fixed!important;display:block!important;width:68px!important;height:94px!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:light!important;font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif!important;color:#244638!important;transition:left var(--travel-duration,0ms) cubic-bezier(.22,.68,.22,1),top var(--travel-duration,0ms) cubic-bezier(.22,.68,.22,1)!important}
*{box-sizing:border-box}button{font:inherit;color:inherit}button:focus-visible{outline:3px solid #83a6ff;outline-offset:5px}[hidden]{display:none!important}
.stage{position:relative;width:68px;height:94px;pointer-events:none}.orb{position:absolute;left:2px;top:28px;width:64px;height:64px;border:0;padding:0;background:none;cursor:grab;touch-action:none;user-select:none;pointer-events:auto;-webkit-user-select:none;border-radius:50%}.orb:active{cursor:grabbing}
.stride,.gesture{position:absolute;inset:0;transform-origin:50% 90%}.gesture{transition:scale .18s ease}.orb:active .gesture{scale:.96}
.body{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 34% 23%,#fffef7 0,#eff6da 40%,#c8ddb2 100%);border:2px solid #355b43;box-shadow:inset 0 -5px 0 #8aaf7438,inset 0 2px 0 #fff9,0 5px 0 #28432e20,0 10px 22px #203e3523;animation:breathe 3.6s ease-in-out infinite}
.face{position:absolute;inset:0}.eye{position:absolute;top:21px;width:7px;height:10px;transition:top .28s,transform .28s}.eye:before,.eye:after{content:'';position:absolute;inset:0;transition:opacity .24s,transform .28s}.eye:before{border-radius:5px;background:#2d503b;transform-origin:50% 75%}.eye:after{top:2px;height:5px;border-bottom:2px solid #4a6a51;border-radius:0 0 8px 8px;opacity:0;transform:scaleX(.7)}.eye.left{left:17px}.eye.right{right:17px}.mouth{position:absolute;top:34px;left:26px;width:10px;height:8px}.mouth:before,.mouth:after{content:'';position:absolute;transition:opacity .28s,transform .28s}.mouth:before{inset:0 0 2px;border-bottom:2px solid #355b43;border-radius:0 0 12px 12px}.mouth:after{top:2px;left:2px;width:6px;height:5px;border:1.5px solid #5a765c;border-radius:50%;opacity:0;transform:scale(.6)}.cheek{position:absolute;top:33px;width:9px;height:5px;border-radius:50%;background:#e9ab9470}.cheek.left{left:10px}.cheek.right{right:10px}
.head{position:absolute;left:18px;top:0;width:32px;height:29px}.badge{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transform:translateY(7px) scale(.6);transition:opacity .24s ease,transform .38s cubic-bezier(.2,1.4,.4,1);pointer-events:none}.stage[data-mode=sleeping] .badge.dream,.stage[data-mode=loading] .badge.lamp,.stage[data-mode=ready] .badge.lamp,.stage[data-mode=error] .badge.warning{opacity:1;transform:none}.bulb{width:27px;height:29px;overflow:visible;filter:drop-shadow(0 0 5px #ffd56b8c)}.bulb .glass{fill:#ffe59b;stroke:#866b30;stroke-width:1.8}.bulb .rays{stroke:#d8a645;stroke-width:1.8;stroke-linecap:round;opacity:.7}.bulb .base{stroke:#4d6146;stroke-width:2;stroke-linecap:round;fill:none}.sleep{font:600 12px/1 ui-monospace,monospace;letter-spacing:1px;color:#6b8b70;transform:rotate(-12deg);animation:dream 3s ease-in-out infinite}.alert{background:#ffe6b5;border:2px solid #9c7040;color:#8a592b;width:23px;height:23px;border-radius:50%;font:bold 16px/19px system-ui;text-align:center}
.feet{position:absolute;inset:0;pointer-events:none}.foot{position:absolute;bottom:-2px;width:14px;height:7px;border:2px solid #355b43;background:#d6e5bf;border-radius:7px;z-index:-1}.foot.left{left:12px}.foot.right{right:12px}
.stage[data-mode=sleeping] .eye{top:24px}.stage[data-mode=sleeping] .eye:before{opacity:0;transform:scaleY(.15)}.stage[data-mode=sleeping] .eye:after{opacity:1;transform:none}.stage[data-mode=sleeping] .mouth:before{opacity:0;transform:scale(.6)}.stage[data-mode=sleeping] .mouth:after{opacity:1;transform:none}
.glow{position:absolute;left:-6px;top:-5px;width:44px;height:42px;opacity:0;transition:opacity .3s ease}.glow:before{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse,#ffda6da6,#ffe59b00 70%);animation:light .85s ease-in-out infinite}.stage[data-mode=loading] .glow{opacity:1}.stage[data-mode=error] .eye{transform:scaleY(.7) rotate(-12deg)}.stage[data-mode=error] .eye.right{transform:scaleY(.7) rotate(12deg)}.stage[data-mode=error] .mouth:before{transform:rotate(180deg)}
.stage[data-reaction=wake] .gesture{animation:wake .46s cubic-bezier(.2,.8,.3,1)}.stage[data-reaction=sleep] .gesture{animation:doze .46s ease-in-out}.stage[data-reaction=pleased] .gesture{animation:nod .38s ease-in-out}.stage[data-reaction=oops] .gesture{animation:shake .38s ease-in-out}.stage[data-reaction=land] .gesture{animation:land .3s ease-out}
:host([data-traveling]) .stride{animation:run .18s ease-in-out infinite alternate}:host([data-traveling]) .foot.left{animation:step .18s ease-in-out infinite alternate}:host([data-traveling]) .foot.right{animation:step .18s ease-in-out infinite alternate-reverse}
.dialog{position:fixed;pointer-events:auto;width:352px;padding:15px 17px 16px;background:#fffdf1;border:3px solid #345044;border-radius:4px;box-shadow:inset 0 0 0 2px #fffdf1,inset 0 0 0 3px #d7dec4,5px 5px 0 #223b3026,0 12px 30px #1b342321;opacity:0;transform:translateY(9px) scale(.92);transform-origin:var(--tail,50%) 100%;transition:opacity .2s ease,transform .32s cubic-bezier(.16,1.25,.3,1);user-select:text}.dialog[data-state=open]{opacity:1;transform:none}.dialog[data-state=closing]{pointer-events:none;transform:translateY(5px) scale(.96);transition:opacity .16s ease,transform .18s ease}.dialog[data-side=below]{transform-origin:var(--tail,50%) 0}.dialog:before{content:'';position:absolute;width:12px;height:12px;background:#fffdf1;border-left:3px solid #345044;border-bottom:3px solid #345044;left:var(--tail,24px);bottom:-9px;transform:rotate(-45deg)}.dialog[data-side=below]:before{top:-9px;bottom:auto;transform:rotate(135deg)}.dialog[data-side=beside]:before{display:none}
.dialog header{display:flex;align-items:center;gap:8px;margin:0 0 11px;padding:0 0 9px;border-bottom:1px dashed #c7d1b9;font-weight:600;line-height:1.4;color:#3e614a}.dialog .name{background:#e5edce;padding:2px 8px;border-radius:3px}.dialog .kind{font-size:10px;letter-spacing:1.5px;color:#829076}.close{margin-left:auto;border:0;background:none;font:22px/1 system-ui;padding:0 2px;cursor:pointer;border-radius:3px}.result{margin:0;font-size:15px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;max-height:min(320px,50vh);overflow:auto;color:#2c493b}.retry{margin-top:12px;padding:5px 10px;border:1px solid #9bae8b;background:#e8efda;border-radius:3px;cursor:pointer}.sr{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;white-space:nowrap;pointer-events:none}
@keyframes light{0%,100%{opacity:.15;transform:scale(.65)}50%{opacity:1;transform:scale(1.2)}}@keyframes breathe{50%{transform:translateY(2px) scale(1.025,.975)}}@keyframes dream{50%{opacity:.5;transform:translateY(-3px) rotate(-12deg)}}@keyframes run{to{transform:translateY(-3px) rotate(var(--run-lean,4deg))}}@keyframes step{to{transform:translateY(-4px)}}
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
      <div class="head" aria-hidden="true"><span class="badge dream"><span class="sleep">zZz</span></span><span class="badge lamp"><i class="glow"></i><svg class="bulb" viewBox="0 0 28 32"><path class="rays" d="M14 1v3M2 12h3M23 12h3M5 4l2 3M23 4l-2 3"/><path class="glass" d="M8 18c-7-7-3-12 6-12s13 5 6 12c-2 2-2 4-2 6h-8c0-2 0-4-2-6Z"/><path class="base" d="M10 25h8M11 28h6M12 31h4M11 15l3 3 3-3M14 18v6"/></svg></span><span class="badge warning"><span class="alert">!</span></span></div>
      <button class="orb" type="button" aria-label="翻译未开启，点击开启整页翻译；可拖动位置"><span class="stride"><span class="gesture"><span class="body"><span class="face"><i class="eye left"></i><i class="eye right"></i><i class="cheek left"></i><i class="cheek right"></i><i class="mouth"></i></span></span><span class="feet" aria-hidden="true"><i class="foot left"></i><i class="foot right"></i></span></span></span></button></div>
      <section class="dialog" role="dialog" aria-label="译译的翻译对话框" hidden><header><span class="name">译译</span><span class="kind">TRANSLATION</span><button class="close" type="button" aria-label="关闭译文对话框">×</button></header><p class="result" aria-live="polite"></p><button class="retry" type="button" hidden>再试一次</button></section><span class="sr" role="status" aria-live="polite"></span>`;
    shadow.append(style, ...ui.childNodes);
    this.stage = shadow.querySelector('.stage')!; this.orb = shadow.querySelector('.orb')!; this.live = shadow.querySelector('.sr')!;
    this.dialog = shadow.querySelector('.dialog')!; this.result = shadow.querySelector('.result')!; this.retryButton = shadow.querySelector('.retry')!;
    this.orb.addEventListener('pointerdown', this.pointerDown);
    this.orb.onclick = () => { if (this.suppressClick) { this.suppressClick = false; return; } if (this.selectionId) this.closeSelection(); else this.actions.toggle(); };
    this.orb.onkeydown = e => {
      this.suppressClick = false;
      const delta: Record<string, Point> = { ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 }, ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 } };
      if (delta[e.key]) { e.preventDefault(); this.remember(this.clamp({ x: this.point.x + delta[e.key].x, y: this.point.y + delta[e.key].y })); }
    };
    shadow.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.closeSelection();
    this.retryButton.onclick = () => this.actions.retry();
    shadow.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); this.closeSelection(); this.orb.focus({ preventScroll: true }); } });
    document.defaultView?.addEventListener('pointermove', this.pointerMove);
    document.defaultView?.addEventListener('pointerup', this.pointerUp);
    document.defaultView?.addEventListener('pointercancel', this.pointerCancel);
    document.defaultView?.addEventListener('resize', this.reposition);
    document.addEventListener('scroll', this.reposition, { capture: true, passive: true });
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
  update(mode: MascotMode, summary: string, action: string) {
    if (mode !== this.mode) this.react(mode === 'sleeping' ? 'sleep' : this.mode === 'sleeping' ? 'wake' : mode === 'error' ? 'oops' : mode === 'ready' ? 'pleased' : 'wake');
    this.mode = mode; this.stage.dataset.mode = mode; this.host.dataset.state = mode;
    this.orb.setAttribute('aria-label', `${summary}；${action}；拖动或用方向键移动`); this.orb.title = `${summary}\n${action}`;
    if (this.live.textContent !== summary) this.live.textContent = summary;
  }
  private anchor(): Rect | undefined {
    if (!this.range?.commonAncestorContainer.isConnected) return;
    const rects = typeof this.range.getClientRects === 'function' ? [...this.range.getClientRects()] : [];
    return rects.at(-1) || (this.range.commonAncestorContainer instanceof Element ? this.range.commonAncestorContainer : this.range.commonAncestorContainer.parentElement)?.getBoundingClientRect();
  }
  beginSelection(id: string, range: Range) {
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
  private placeDialog() {
    const v = this.viewport(), width = Math.min(352, v.width - EDGE * 2);
    this.dialog.style.width = `${width}px`;
    const height = this.dialog.offsetHeight || this.dialog.getBoundingClientRect().height || 150;
    const x = Math.max(EDGE, Math.min(this.point.x + WIDTH / 2 - width / 2, v.width - width - EDGE));
    let y = this.point.y - height - 14, side = 'above';
    if (y < EDGE) { y = this.point.y + HEIGHT + 12; side = 'below'; }
    if (y + height > v.height - EDGE) { y = Math.max(EDGE, v.height - height - EDGE); side = 'beside'; }
    this.dialog.style.left = `${x}px`; this.dialog.style.top = `${y}px`; this.dialog.dataset.side = side;
    this.dialog.style.setProperty('--tail', `${Math.max(16, Math.min(width - 32, this.point.x + WIDTH / 2 - x - 7))}px`);
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
    clearTimeout(this.reveal); clearTimeout(this.returning); this.pendingResult = undefined;
    this.selectionId = undefined; this.range = undefined;
    const duration = this.hideDialog();
    if (duration) this.returning = setTimeout(() => { this.travel(this.home, 'home'); }, duration);
    else this.travel(this.home, 'home');
    if (notify) this.actions.dismiss();
  }
  destroy() {
    this.disposed = true; clearTimeout(this.reveal); clearTimeout(this.flight); clearTimeout(this.reaction); clearTimeout(this.exit); clearTimeout(this.returning); this.host.remove();
    document.defaultView?.removeEventListener('pointermove', this.pointerMove); document.defaultView?.removeEventListener('pointerup', this.pointerUp);
    document.defaultView?.removeEventListener('pointercancel', this.pointerCancel); document.defaultView?.removeEventListener('resize', this.reposition);
    document.removeEventListener('scroll', this.reposition, true);
  }
}
