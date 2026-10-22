import { AppError, PROTOCOL, SessionEvent, Status } from '../shared/protocol';

// This link carries public status and translation data, never login credentials.
export class SessionBridge {
  private port?: chrome.runtime.Port;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  status?: Status;
  tabId?: number;
  connection: 'ready' | 'disconnected' = 'disconnected';
  private bootId?: string;
  private lastSeq = 0;
  private connecting?: Promise<void>;
  private ready?: () => void;
  constructor(private event: (event: SessionEvent) => void, private disconnected: () => void) {}
  attach(port: chrome.runtime.Port): void {
    const sender = port.sender;
    if (port.name !== 'translation-session' || sender?.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('session.html') || sender.tab?.id === undefined || sender.tab.incognito || this.port) {
      port.disconnect(); return;
    }
    this.port = port; this.tabId = sender.tab.id;
    port.onMessage.addListener(message => {
      if (this.port !== port || message?.v !== PROTOCOL) return;
      if (message.event) {
        const event = message as SessionEvent;
        if (event.event === 'hello') {
          this.bootId = event.bootId; this.lastSeq = event.seq; this.status = event.data;
          this.connection = 'ready'; this.ready?.(); this.event({ ...event, event: 'status' }); return;
        }
        if (event.bootId !== this.bootId || event.seq <= this.lastSeq) return;
        this.lastSeq = event.seq;
        if (event.event === 'status') this.status = event.data;
        this.event(event); return;
      }
      const call = this.pending.get(message.id); if (!call) return;
      clearTimeout(call.timer); this.pending.delete(message.id);
      if (message.error) call.reject(Object.assign(new AppError(message.error.code, message.error.message), message.error));
      else call.resolve(message.result);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (this.port !== port) return;
      this.port = undefined; this.tabId = undefined; this.status = undefined; this.connection = 'disconnected';
      for (const call of this.pending.values()) {
        clearTimeout(call.timer); call.reject(new AppError('session_disconnected', '翻译会话已断开，已提交任务的结果未知。请重新登录后手动重试。'));
      }
      this.pending.clear(); this.disconnected();
    });
  }
  async connect(): Promise<void> {
    if (this.port && this.connection === 'ready') return;
    if (this.connecting) return this.connecting;
    // A visible session survives service-worker suspension. Wake its transport on demand.
    this.connecting = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AppError('session_required', '请打开扩展中的“翻译会话”并登录 ChatGPT。')), 3000);
      this.ready = () => { clearTimeout(timer); resolve(); };
      void chrome.runtime.sendMessage({ type: 'session.wake' }).catch(() => {
        if (this.connection === 'ready') { clearTimeout(timer); resolve(); }
        else { clearTimeout(timer); reject(new AppError('session_required', '请打开扩展中的“翻译会话”并登录 ChatGPT。')); }
      });
    }).finally(() => { this.connecting = undefined; this.ready = undefined; });
    return this.connecting;
  }
  async call(method: string, params?: unknown): Promise<any> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new AppError('session_timeout', '翻译会话响应超时，请检查会话标签页。'));
      }, method === 'account.logout' ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.port!.postMessage({ v: PROTOCOL, id, method, params }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new AppError('session_disconnected', '翻译会话已断开。')); }
    });
  }
}
