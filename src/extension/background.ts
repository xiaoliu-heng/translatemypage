import { AppError, assert, DEFAULT_SETTINGS, SessionEvent, MAX_BATCH_CHARS, Model, publicError, Settings, TranslationParams } from '../shared/protocol';
import { SessionBridge } from './bridge';
import { translationCache } from './storage';
interface Page { tabId: number; frameId: number; documentId: string; pageKey: string; active: boolean }
const pages = new Map<string, Page>();
const jobs = new Map<string, Page>();
const earlyEvents = new Map<string, SessionEvent[]>();
const transportId = crypto.randomUUID();
let accepting = 0;
const bridge = new SessionBridge(onSessionEvent, () => {
  jobs.clear(); earlyEvents.clear();
  for (const page of pages.values()) void sendPage(page, { type: 'session.disconnected' });
  broadcastStatus();
});
chrome.runtime.onConnect.addListener(port => bridge.attach(port));
function pageStatus() {
  return bridge.status && { ...bridge.status, transportId, notice: undefined, authorization: undefined,
    accounts: bridge.status.accounts.map(account => ({ ...account, name: '', email: '', subject: '', issuer: '', clientId: '' })) };
}
async function openSession(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [chrome.runtime.getURL('session.html')] });
  const existing = contexts.find(context => context.tabId >= 0);
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url: chrome.runtime.getURL('session.html') });
}
async function settings(): Promise<Settings> { const s = await chrome.storage.local.get('settings'); return { ...DEFAULT_SETTINGS, ...(s.settings as Partial<Settings> || {}) }; }
async function sendPage(p: Page, message: unknown): Promise<void> {
  try { await chrome.tabs.sendMessage(p.tabId, message, { documentId: p.documentId }); } catch { pages.delete(p.pageKey); }
}
function broadcastStatus(): void {
  const message = { type: 'state.changed', connection: bridge.connection, status: bridge.status };
  for (const p of pages.values()) void sendPage(p, { ...message, status: pageStatus() });
  void chrome.runtime.sendMessage(message).catch(() => {});
}
function onSessionEvent(e: SessionEvent): void {
  if (e.event === 'status') { broadcastStatus(); return; }
  if (!e.jobId) return;
  const page = jobs.get(e.jobId);
  if (!page && accepting && earlyEvents.size < 16) {
    earlyEvents.set(e.jobId, [...(earlyEvents.get(e.jobId) || []), e].slice(-24)); return;
  }
  if (page) void sendPage(page, { type: 'translation.event', event: e });
  if (['jobCompleted', 'cancelled', 'failed'].includes(e.event)) { jobs.delete(e.jobId); }
}
function contentPage(sender: chrome.runtime.MessageSender): Page {
  assert(sender.tab?.id !== undefined && sender.documentId && sender.frameId === 0 && !sender.tab.incognito &&
    typeof sender.url === 'string' && /^https?:\/\//.test(sender.url), 'forbidden_sender', '此页面不支持翻译。');
  const pageKey = `${sender.tab.id}:${sender.frameId}:${sender.documentId}`;
  let p = pages.get(pageKey);
  if (!p) { p = { tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, pageKey, active: false }; pages.set(pageKey, p); }
  return p;
}
function extensionUI(sender: chrome.runtime.MessageSender): boolean {
  return !!sender.url && [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html'), chrome.runtime.getURL('session.html')].includes(sender.url.split(/[?#]/)[0]);
}
async function actOnPage(action: string): Promise<any> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  assert(tab?.id !== undefined && !tab.incognito && /^https?:\/\//.test(tab.url || ''), 'unsupported_page', '请在普通 HTTP/HTTPS 网页上使用翻译。');
  if (!['stop', 'idle'].includes(action)) await bridge.connect();
  await chrome.scripting.insertCSS({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.css'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tab.id, { type: 'page.control', action, status: pageStatus(), settings: await settings() }, { frameId: 0 });
}
async function route(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  assert(sender.id === chrome.runtime.id && message && typeof message.type === 'string', 'forbidden_sender', '消息来源无效。');
  if (sender.tab && !extensionUI(sender)) {
    const page = contentPage(sender);
    switch (message.type) {
      case 'page.hello':
        await bridge.connect().catch(() => {});
        return { pageKey: page.pageKey, documentId: page.documentId, connection: bridge.connection, status: pageStatus() };
      case 'page.activity': page.active = message.active === true; return {};
      case 'page.cancel':
        if (bridge.connection === 'ready') await bridge.call('translation.cancel', { pageKey: page.pageKey });
        return {};
      case 'page.resume':
        await bridge.call('translation.resume'); broadcastStatus(); return {};
      case 'page.translate': {
        await bridge.connect();
        const s = await settings(); const a = bridge.status?.accounts.find(x => x.key === bridge.status?.activeKey);
        assert(a && a.identity === 'signed_in', 'signed_out', '请先在扩展中登录 ChatGPT。');
        const model = s.models[a.key]; assert(model, 'model_required', '请先在扩展中选择模型。');
        assert(message.accountEpoch === bridge.status!.accountEpoch && Number.isSafeInteger(message.generation), 'stale_account', '账号或页面设置已变化。');
        const hostname = new URL(sender.url!).hostname;
        const terms = new Map<string, any>();
        for (const t of s.glossary.filter(t => !t.hostname)) terms.set(t.source.toLocaleLowerCase(), t);
        for (const t of s.glossary.filter(t => t.hostname === hostname)) terms.set(t.source.toLocaleLowerCase(), t);
        const text = (message.segments || []).map((x: any) => typeof x.text === 'string' ? x.text : '').join('\n').toLocaleLowerCase();
        assert(text.length <= MAX_BATCH_CHARS, 'invalid_request', '翻译段落过长。');
        const p: TranslationParams = {
          requestKey: message.requestKey, accountKey: a.key, accountEpoch: bridge.status!.accountEpoch, model,
          document: { id: page.documentId, frameId: page.frameId, generation: message.generation, pageKey: page.pageKey },
          sourceLanguage: s.sourceLanguage, targetLanguage: s.targetLanguage, title: String(message.title || '').slice(0, 500),
          glossary: [...terms.values()].filter(t => text.includes(t.source.toLocaleLowerCase())).slice(0, 100), glossaryVersion: s.glossaryVersion,
          priority: message.selection === true ? 0 : message.priority === 2 ? 2 : 1, segments: message.segments,
        };
        accepting++;
        try {
          const result = await bridge.call('translation.submit', p); jobs.set(result.jobId, page);
          for (const event of earlyEvents.get(result.jobId) || []) onSessionEvent(event);
          earlyEvents.delete(result.jobId); return result;
        } finally { accepting--; if (!accepting) earlyEvents.clear(); }
      }
      default: throw new AppError('forbidden_method', '网页不能执行此操作。');
    }
  }
  assert(extensionUI(sender), 'forbidden_sender', '仅扩展界面可以管理账号和设置。');
  switch (message.type) {
    case 'ui.state':
      await bridge.connect().catch(() => {});
      return { connection: bridge.connection, status: bridge.status, settings: await settings() };
    case 'ui.models': {
      const epoch = bridge.status?.accountEpoch;
      const models: Model[] = await bridge.call('models.list');
      assert(epoch === undefined || epoch === bridge.status?.accountEpoch, 'stale_account', '账号已切换。');
      const key = bridge.status?.activeKey;
      if (key && models.length) {
        const s = await settings();
        if (!models.some(m => m.slug === s.models[key])) { s.models[key] = models[0].slug; await chrome.storage.local.set({ settings: s }); }
      }
      return models;
    }
    case 'ui.openSession': await openSession(); return {};
    case 'ui.auth': return bridge.call('auth.begin', { accountKey: message.accountKey, reconsent: message.reconsent === true, newAccount: message.newAccount === true });
    case 'ui.cancelAuth': return bridge.call('auth.cancel');
    case 'ui.selectAccount': return bridge.call('account.select', { accountKey: message.accountKey });
    case 'ui.logout': return bridge.call('account.logout', { accountKey: message.accountKey });
    case 'ui.clearCache': {
      if (bridge.connection === 'ready') return bridge.call('cache.clear');
      const cache = translationCache(); await cache.clear(); return {};
    }
    case 'ui.resume': await bridge.call('translation.resume'); return actOnPage('retry');
    case 'ui.page': return actOnPage(message.action);
    case 'ui.settings': {
      const s: Settings = { ...await settings(), ...message.settings };
      assert(typeof s.targetLanguage === 'string' && s.targetLanguage.length <= 40 && typeof s.sourceLanguage === 'string' && s.sourceLanguage.length <= 40 &&
        Array.isArray(s.glossary) && s.glossary.length <= 100 && s.glossary.every(t => typeof t.source === 'string' && t.source.length > 0 && t.source.length <= 200 && typeof t.target === 'string' && t.target.length > 0 && t.target.length <= 200 && (!t.hostname || /^[a-z0-9.-]+$/i.test(t.hostname))), 'invalid_settings', '语言或术语表格式无效。');
      assert(typeof s.excludedSelectors === 'string' && s.excludedSelectors.length <= 2000, 'invalid_settings', '排除选择器过长。');
      await chrome.storage.local.set({ settings: s });
      for (const p of pages.values()) void sendPage(p, { type: 'settings.changed', settings: s });
      return s;
    }
    default: throw new AppError('unknown_method', '不支持此操作。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (['state.changed', 'translation.event', 'session.wake'].includes(message?.type)) return false;
  route(message, sender).then(result => reply({ result })).catch(e => reply({ error: publicError(e), connection: bridge.connection }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => {
  for (const [key, p] of pages) if (p.tabId === id) { pages.delete(key); if (bridge.connection === 'ready') void bridge.call('translation.cancel', { pageKey: key }).catch(() => {}); }

});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status !== 'loading') return;
  for (const [key, p] of pages) if (p.tabId === id) { pages.delete(key); if (bridge.connection === 'ready') void bridge.call('translation.cancel', { pageKey: key }).catch(() => {}); }
});
