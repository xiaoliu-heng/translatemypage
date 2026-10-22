import { AppError, DEFAULT_SETTINGS, fingerprint, SessionEvent, MAX_BATCH_CHARS, MAX_SEGMENTS, PROMPT_VERSION, Segment, Settings, Status } from '../shared/protocol';
import { protectLiteralMarkers } from '../shared/formatting';
import { appendTranslation, candidates, excluded, OWN, snapshot } from './extractor';
import { TranslationMascot } from './mascot';

interface RecordState { element: Element; segment: Segment; state: 'idle' | 'queued' | 'done' | 'failed' | 'skipped'; near: boolean; node?: HTMLElement }
type Batch = { records: RecordState[]; generation: number; snapshots?: Segment[]; selection?: { id: string; text: string; protected: Record<string, string> } };
type SelectedText = { text: string; range: Range };

export class PageTranslator {
  private records = new Map<Element, RecordState>();
  private ids = new Map<string, RecordState>();
  private jobs = new Map<string, Batch>();
  private earlyEvents = new Map<string, SessionEvent[]>();
  private memory = new Map<string, string>();
  private settings: Settings = DEFAULT_SETTINGS;
  private status?: Status;
  private documentId = '';
  private generation = 0;
  private enabled = false;
  private paused = false;
  private pending = 0;
  private observer?: IntersectionObserver;
  private mutations?: MutationObserver;
  private routeTimer?: ReturnType<typeof setInterval>;
  private connectionTimer?: ReturnType<typeof setInterval>;
  private mutationTimer?: ReturnType<typeof setTimeout>;
  private dirty = new Set<Element>();
  private href = location.href;
  private mascot?: TranslationMascot;
  private selectionBusy = false;
  private selectionError = '';
  private selectionResult = false;
  private retrySelection?: SelectedText;
  private lastSelection?: SelectedText;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private activeSelectionId?: string;
  private sequence = 0;
  private error = '';
  private refreshStyles = () => { if (this.enabled) { this.dirty.add(this.readingRoot()); clearTimeout(this.mutationTimer); this.mutationTimer = setTimeout(() => this.updateDirty(), 120); } };
  private context(): string { const key = this.status?.activeKey || ''; return fingerprint(JSON.stringify([key, this.settings.models[key], this.settings.targetLanguage, this.settings.sourceLanguage, this.settings.glossaryVersion, document.title, PROMPT_VERSION])); }
  private async rpc(type: string, data: Record<string, unknown> = {}): Promise<any> {
    const r = await chrome.runtime.sendMessage({ type, ...data });
    if (r?.error) throw new AppError(r.error.code, r.error.message); return r?.result;
  }
  async control(action: string, status: Status, settings: Settings): Promise<void> {
    this.status = status; this.settings = settings;
    this.ensureMascot();
    if (action === 'selection') { await this.translateSelection(); return; }
    const hello = await this.rpc('page.hello'); this.documentId = hello.documentId;
    if (action === 'stop') { this.stop(); return; }
    if (action === 'idle') { this.render(); return; }
    if (action === 'retry' && this.enabled) {
      await this.retry(); return;
    }
    await this.start();
  }
  private async start(): Promise<void> {
    this.stop(false); this.enabled = true; this.paused = false; this.error = ''; this.href = location.href;
    this.monitorConnection();
    this.ensureMascot();
    this.observer = new IntersectionObserver(entries => {
      for (const e of entries) { const r = this.records.get(e.target); if (r) r.near = e.isIntersecting; }
      this.pump();
    }, { rootMargin: '600px 0px' });
    this.mutations = new MutationObserver(mutations => {
      for (const m of mutations) {
        const target = m.target instanceof Element ? m.target : m.target.parentElement;
        if (!target || target.closest(`[${OWN}]`)) continue;
        // Stylesheets and root theme changes may alter all paragraph and inline styles.
        if (target.closest('head')) { this.dirty.add(this.readingRoot()); continue; }
        for (const removed of m.removedNodes) {
          if (!(removed instanceof Element) || removed.getAttribute(OWN) !== 'translation') continue;
          for (const r of this.records.values()) if (r.node === removed && r.state === 'done') this.dirty.add(r.element);
        }
        if (m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(n => n instanceof Element && n.hasAttribute(OWN))) continue;
        let parent: Element | null = target;
        while (parent) { if (this.records.has(parent)) { this.dirty.add(parent); break; } parent = parent.parentElement; }
        if (!parent) this.dirty.add(target);
        for (const node of m.addedNodes) if (node instanceof Element && !node.hasAttribute(OWN)) this.dirty.add(node);
        if (m.type === 'attributes') this.dirty.add(target);
      }
      clearTimeout(this.mutationTimer);
      this.mutationTimer = setTimeout(() => this.updateDirty(), 120);
    });
    this.scan(this.readingRoot());
    this.mutations.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'style', 'class', 'href', 'target', 'lang', 'dir', 'translate'] });
    document.defaultView?.addEventListener('resize', this.refreshStyles);
    document.addEventListener('load', this.refreshStyles, true);
    this.routeTimer = setInterval(() => {
      if (location.href !== this.href) void this.start();
    }, 750);
    await this.rpc('page.activity', { active: true });
    this.render(); this.pump();
  }
  stop(removeMascot = false): void {
    this.generation++; this.enabled = false; this.paused = false;
    this.observer?.disconnect(); this.mutations?.disconnect(); clearInterval(this.routeTimer); clearInterval(this.connectionTimer); this.connectionTimer = undefined; clearTimeout(this.mutationTimer);
    document.defaultView?.removeEventListener('resize', this.refreshStyles);
    document.removeEventListener('load', this.refreshStyles, true);
    this.dirty.clear();
    for (const r of this.records.values()) r.node?.remove();
    this.records.clear(); this.ids.clear(); this.jobs.clear(); this.earlyEvents.clear();
    clearTimeout(this.selectionTimer); this.clearSelection(); this.lastSelection = undefined; this.error = '';
    void this.rpc('page.cancel').catch(() => {}); void this.rpc('page.activity', { active: false }).catch(() => {});
    if (removeMascot) {
      this.mascot?.destroy(); this.mascot = undefined;
      document.removeEventListener('pointerup', this.selectionEnd); document.removeEventListener('keyup', this.selectionKeyUp); document.removeEventListener('keydown', this.selectionShortcut);
    } else this.render();
  }
  dispose(): void { this.stop(true); }
  private readingRoot(): Element { return document.querySelector('main article,article,main,[role="main"]') || document.body; }
  private scan(root: Element): void {
    const reading = this.readingRoot();
    if (root !== reading && !reading.contains(root)) {
      if (root.contains(reading)) root = reading;
      else return;
    }
    for (const element of candidates(root, this.settings.excludedSelectors)) {
      if (this.records.has(element)) continue;
      const source = snapshot(element);
      const r: RecordState = { element, segment: { id: `p${++this.sequence}`, revision: 1, ...source }, state: 'idle', near: false };
      if (source.text.length + JSON.stringify(source.protected).length > MAX_BATCH_CHARS - 256) r.state = 'skipped';
      this.records.set(element, r); this.ids.set(r.segment.id, r); this.observer?.observe(element);
    }
  }
  private updateDirty(): void {
    if (!this.enabled) return;
    // Prune detached/recycled elements and re-read only changed semantic ancestors.
    for (const [element, r] of this.records) {
      if (!element.isConnected || excluded(element, this.settings.excludedSelectors)) {
        this.observer?.unobserve(element); r.node?.remove(); this.records.delete(element); this.ids.delete(r.segment.id); continue;
      }
      if (![...this.dirty].some(d => d === element || d.contains(element) || element.contains(d))) continue;
      const source = snapshot(element);
      if (source.sourceHash !== r.segment.sourceHash || source.text !== r.segment.text || JSON.stringify(source.protected) !== JSON.stringify(r.segment.protected)) {
        r.node?.remove(); r.node = undefined; r.segment = { ...r.segment, ...source, revision: r.segment.revision + 1 };
        r.state = source.text.length < 2 || source.text.length + JSON.stringify(source.protected).length > MAX_BATCH_CHARS - 256 ? 'skipped' : 'idle';
      } else if (r.state === 'done') {
        // Reapply original styles after a theme/responsive change, or restore a removed node.
        // Reuse the validated translation; formatting changes don't need another model call.
        const translated = this.memory.get(`${this.context()}:${source.sourceHash}`);
        r.node?.remove(); r.node = undefined;
        if (translated !== undefined) r.node = appendTranslation(element, translated, source.protected); else r.state = 'idle';
      }
    }
    for (const root of this.dirty) if (root.isConnected) this.scan(root);
    this.dirty.clear(); this.render(); this.pump();
  }
  private pump(): void {
    if (!this.enabled || this.paused || !this.status) return;
    while (this.jobs.size + this.pending < 2) {
      const queue = [...this.records.values()].filter(r => r.near && r.state === 'idle' && r.element.isConnected)
        .sort((a, b) => Math.abs(a.element.getBoundingClientRect().top) - Math.abs(b.element.getBoundingClientRect().top));
      if (!queue.length) break;
      const records: RecordState[] = []; let budget = 0;
      for (const r of queue) {
        const key = `${this.context()}:${r.segment.sourceHash}`;
        const value = this.memory.get(key);
        if (value !== undefined) { r.node = appendTranslation(r.element, value, r.segment.protected); r.state = 'done'; continue; }
        const chars = r.segment.text.length + JSON.stringify(r.segment.protected).length;
        if (budget + chars > MAX_BATCH_CHARS - 256 || records.length >= MAX_SEGMENTS) break;
        budget += chars; records.push(r); r.state = 'queued';
      }
      if (!records.length) break;
      void this.submit({ records, generation: this.generation });
    }
    this.render();
  }
  private async submit(batch: Batch): Promise<void> {
    this.pending++;
    try {
      const segments: Segment[] = batch.selection ? [{ ...batch.selection, sourceHash: fingerprint(batch.selection.text), revision: 1 }] : batch.records.map(r => structuredClone(r.segment));
      batch.snapshots = segments;
      const response = await this.rpc('page.translate', { requestKey: crypto.randomUUID(), generation: batch.generation,
        accountEpoch: this.status!.accountEpoch, title: document.title, segments, selection: !!batch.selection,
        priority: batch.records.some(r => { const rect = r.element.getBoundingClientRect(); return rect.bottom >= 0 && rect.top <= (globalThis.innerHeight || 800); }) ? 1 : 2 });
      if (batch.generation !== this.generation) return;
      this.jobs.set(response.jobId, batch);
      const early = this.earlyEvents.get(response.jobId) || []; this.earlyEvents.delete(response.jobId);
      for (const e of early) this.handleEvent(e);
    } catch (e) {
      if (batch.generation === this.generation) {
        const current = this.currentRecords(batch);
        for (const r of current) if (r.state === 'queued') r.state = 'failed';
        const message = e instanceof Error ? e.message : '翻译请求失败。';
        if (batch.selection?.id === this.activeSelectionId && batch.selection) this.failSelection(message);
        else if (current.length) { this.error = message; this.paused = true; this.render(); }
      }
    } finally { this.pending--; this.pump(); }
  }
  handleEvent(e: SessionEvent): void {
    if (!e.jobId || e.accountEpoch !== this.status?.accountEpoch) return;
    const batch = this.jobs.get(e.jobId);
    if (!batch) {
      if (this.pending && this.earlyEvents.size < 10) this.earlyEvents.set(e.jobId, [...(this.earlyEvents.get(e.jobId) || []), e].slice(-20));
      return;
    }
    if (batch.generation !== this.generation) { this.jobs.delete(e.jobId); return; }
    if (e.event === 'batchCompleted') {
      if (e.data?.document.id !== this.documentId || e.data.document.generation !== this.generation) return;
      const s = e.data.segment;
      if (batch.selection && batch.selection.id === s.id) {
        if (this.activeSelectionId === s.id) {
          const literals = batch.selection.protected;
          const text = String(s.translation).replace(/⟦TMP:\d+⟧/g, token => literals[token] ?? token);
          this.selectionBusy = false; this.selectionError = ''; this.selectionResult = true;
          this.mascot?.showSelection(s.id, text);
        }
      }
      else {
        const r = this.ids.get(s.id);
        if (!r || !r.element.isConnected || r.segment.revision !== s.revision || r.segment.sourceHash !== s.sourceHash) return;
        const current = snapshot(r.element);
        if (current.text !== r.segment.text || current.sourceHash !== s.sourceHash || excluded(r.element, this.settings.excludedSelectors)) return;
        try { r.node?.remove(); r.node = appendTranslation(r.element, s.translation, r.segment.protected); r.state = 'done'; }
        catch (error) { r.state = 'failed'; this.error = error instanceof Error ? error.message : '译文格式无效。'; this.paused = true; this.render(); return; }
        this.memory.set(`${this.context()}:${r.segment.sourceHash}`, s.translation);
        if (this.memory.size > 500) this.memory.delete(this.memory.keys().next().value!);
      }
    } else if (['jobCompleted', 'failed', 'cancelled'].includes(e.event)) {
      this.jobs.delete(e.jobId);
      if (e.event !== 'jobCompleted') {
        const current = this.currentRecords(batch);
        for (const r of current) if (r.state === 'queued') r.state = 'failed';
        if (batch.selection && batch.selection.id === this.activeSelectionId) this.failSelection(e.data?.error?.message || (e.event === 'cancelled' ? '翻译已取消，可以重新试一次。' : '翻译失败。'));
        else if (e.event === 'failed' && current.length) { this.error = e.data?.error?.message || '翻译失败。'; this.paused = true; }
      }
      this.pump();
    }
    this.render();
  }
  stateChanged(status?: Status, disconnected = false): void {
    if (status?.transportId && this.status?.transportId && status.transportId !== this.status.transportId) disconnected = true;
    if (status && this.status && (status.accountEpoch !== this.status.accountEpoch || status.activeKey !== this.status.activeKey)) {
      this.stop(false); this.memory.clear(); this.error = '账号已变化，点击扩展中的翻译按钮重新开始。';
    }
    this.status = status || this.status;
    const active = this.status?.accounts.find(a => a.key === this.status?.activeKey);
    if (active && ['limited', 'ineligible', 'not_granted'].includes(active.plan)) {
      this.paused = true; this.error = active.plan === 'limited' ? '套餐调用受限，可查看 ChatGPT 用量设置后点击重试。' : '当前账号无法使用套餐调用，请在扩展中查看授权状态。';
    }
    if (disconnected) {
      if (!this.enabled && !this.selectionBusy) return;
      this.paused = true; this.error = '翻译会话已断开，结果未知。重新登录后可重试未完成段落。';
      if (this.selectionBusy) this.failSelection(this.error);
      for (const r of this.records.values()) if (r.state === 'queued') r.state = 'failed';
      this.jobs.clear();
    }
    this.render();
  }
  private monitorConnection(): void {
    if (this.connectionTimer) return;
    this.connectionTimer = setInterval(() => {
      if (!this.enabled && !this.selectionBusy) { clearInterval(this.connectionTimer); this.connectionTimer = undefined; return; }
      void this.rpc('page.hello').then(hello => this.stateChanged(hello.status, hello.connection === 'disconnected'))
        .catch(() => this.stateChanged(undefined, true));
    }, 15_000);
  }
  settingsChanged(settings: Settings): void {
    const changed = JSON.stringify([this.settings.targetLanguage, this.settings.sourceLanguage, this.settings.models, this.settings.glossary, this.settings.excludedSelectors]) !==
      JSON.stringify([settings.targetLanguage, settings.sourceLanguage, settings.models, settings.glossary, settings.excludedSelectors]);
    this.settings = settings;
    if (changed && this.enabled) void this.start();
  }
  private readSelection(): SelectedText {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) throw new AppError('empty_selection', '请先选中网页正文中的文字。');
    return { text: selection.toString().trim(), range: selection.getRangeAt(0).cloneRange() };
  }
  private async translateSelection(input = this.readSelection()): Promise<void> {
    const { text, range } = input;
    const anchor = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const focus = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    if (!text || !range.commonAncestorContainer.isConnected || !anchor || !focus || excluded(anchor, this.settings.excludedSelectors) || excluded(focus, this.settings.excludedSelectors)) throw new AppError('empty_selection', '请先选中网页正文中的文字。');
    if (range.toString().trim() !== text) throw new AppError('stale_selection', '选区内容已变化，请重新选择。');
    const source = protectLiteralMarkers(text);
    if (source.text.length + JSON.stringify(source.protected).length > MAX_BATCH_CHARS - 256) throw new AppError('selection_too_large', '选中文字过长，请减少选区。');
    // Reject ranges crossing excluded forms or code blocks, even when their endpoints are outside them.
    const fragment = range.cloneContents();
    if (fragment.querySelector(`input,textarea,form,[contenteditable],pre,script,style,[${OWN}]`)) throw new AppError('excluded_selection', '选区包含输入区、代码块或译文，请只选择原文正文。');
    this.ensureMascot(); this.selectionBusy = true; this.monitorConnection(); this.selectionError = ''; this.selectionResult = false;
    const id = `selection-${++this.sequence}`; this.activeSelectionId = id;
    this.retrySelection = this.lastSelection = { text, range: range.cloneRange() };
    this.mascot!.beginSelection(id, range); this.render();
    const generation = this.generation;
    try {
      const hello = await this.rpc('page.hello');
      if (generation !== this.generation || id !== this.activeSelectionId) return;
      this.documentId = hello.documentId;
    } catch (e) { if (id === this.activeSelectionId) this.failSelection(e instanceof Error ? e.message : '翻译会话连接失败。'); return; }
    await this.submit({ records: [], generation: this.generation, selection: { id, ...source } });
  }
  private ensureMascot(): void {
    if (this.mascot?.host.isConnected) return;
    this.mascot?.destroy();
    this.mascot = new TranslationMascot({
      toggle: () => {
        if (!this.settings.acknowledgedSharing) { this.error = '请先在扩展中确认网页内容发送说明。'; this.render(); return; }
        if (this.enabled && !this.paused) this.stop();
        else if (this.status) void (this.enabled ? this.retry() : (async () => {
          if (this.paused) await this.rpc('page.resume');
          await this.control('start', this.status!, this.settings);
        })()).catch(e => { this.error = e.message; this.render(); });
      },
      dismiss: () => { this.clearSelection(false); this.render(); },
      retry: () => { void this.retrySelected().catch(e => this.failSelection(e.message)); },
    });
    document.addEventListener('pointerup', this.selectionEnd); document.addEventListener('keyup', this.selectionKeyUp); document.addEventListener('keydown', this.selectionShortcut);
    this.render();
  }
  private clearSelection(close = true): void {
    this.selectionBusy = false; this.selectionError = ''; this.selectionResult = false; this.activeSelectionId = undefined; this.retrySelection = undefined; this.lastSelection = undefined;
    if (close) this.mascot?.closeSelection(false);
  }
  private failSelection(message: string): void {
    this.selectionBusy = false; this.selectionResult = true; this.selectionError = message;
    if (this.activeSelectionId) this.mascot?.showSelection(this.activeSelectionId, message, true);
    this.render();
  }
  private async retrySelected(): Promise<void> {
    const selected = this.retrySelection, id = this.activeSelectionId;
    if (!selected || !id) return;
    // The button is an explicit manual retry, including resuming a quota-paused queue.
    await this.rpc('page.resume');
    if (id === this.activeSelectionId && selected === this.retrySelection) await this.translateSelection(selected);
  }
  private selectionEnd = (e: Event) => {
    if (!this.settings.acknowledgedSharing || !this.status?.activeKey || this.paused || e.composedPath().some(n => n instanceof Element && n.hasAttribute(OWN))) return;
    if (e.target instanceof Element && excluded(e.target, this.settings.excludedSelectors)) return;
    clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      let selected: SelectedText; try { selected = this.readSelection(); } catch { return; }
      if (!this.readingRoot().contains(selected.range.commonAncestorContainer)) return;
      const old = this.lastSelection;
      if (old && old.text === selected.text && old.range.startContainer === selected.range.startContainer && old.range.startOffset === selected.range.startOffset && old.range.endContainer === selected.range.endContainer && old.range.endOffset === selected.range.endOffset) return;
      void this.translateSelection(selected).catch(() => {});
    }, 120);
  };
  private selectionKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift' || e.shiftKey) this.selectionEnd(e); };
  private selectionShortcut = (e: KeyboardEvent) => {
    if (e.altKey && e.code === 'KeyT' && !e.repeat && this.status) {
      if (e.target instanceof Element && excluded(e.target, this.settings.excludedSelectors)) return;
      e.preventDefault(); clearTimeout(this.selectionTimer);
      if (!this.settings.acknowledgedSharing) { this.error = '请先在扩展中确认网页内容发送说明。'; this.render(); return; }
      void this.translateSelection().catch(error => { this.error = error.message; this.render(); });
    }
  }
  private render(): void {
    if (!this.mascot) return;
    const r = [...this.records.values()]; const done = r.filter(x => x.state === 'done').length; const skipped = r.filter(x => x.state === 'skipped').length;
    const busy = this.selectionBusy || this.enabled && !this.paused && (this.jobs.size + this.pending > 0 || r.some(x => x.state === 'queued' || x.state === 'idle' && x.near));
    const error = this.activeSelectionId ? this.selectionError : this.error;
    const mode = error ? 'error' : busy ? 'loading' : this.enabled || this.selectionResult ? 'ready' : 'sleeping';
    const summary = error || (this.selectionBusy ? '正在翻译选中文字' : this.selectionResult ? '选区译文已送达' : this.enabled ? `${done} / ${r.length - skipped} 段已翻译${busy ? '，正在翻译' : '，跟随阅读'}${skipped ? `，${skipped} 段已跳过` : ''}` : '翻译未开启，译译在睡觉');
    this.mascot.update(mode, summary, this.activeSelectionId ? '点击收起并返回' : this.enabled && this.paused ? '点击重试' : this.enabled ? '点击恢复原文' : '点击开启整页翻译');
  }
  private async retry(): Promise<void> {
    await this.rpc('page.resume');
    this.paused = false; this.error = '';
    for (const r of this.records.values()) if (r.state === 'failed') r.state = 'idle';
    this.pump();
  }
  private currentRecords(batch: Batch): RecordState[] {
    return batch.records.filter(r => batch.snapshots?.some(s => s.id === r.segment.id && s.revision === r.segment.revision && s.sourceHash === r.segment.sourceHash));
  }
}
const global = globalThis as typeof globalThis & { __translateMyPage?: PageTranslator };
if (chrome.runtime.id && !global.__translateMyPage) {
  const app = new PageTranslator(); global.__translateMyPage = app;
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m.type === 'page.control') { app.control(m.action, m.status, m.settings).then(() => reply({ ok: true })).catch(e => reply({ error: { code: e.code || 'page_error', message: e.message } })); return true; }
    if (m.type === 'translation.event') app.handleEvent(m.event);
    if (m.type === 'state.changed') app.stateChanged(m.status);
    if (m.type === 'session.disconnected') app.stateChanged(undefined, true);
    if (m.type === 'settings.changed') app.settingsChanged(m.settings);
    return false;
  });
}
