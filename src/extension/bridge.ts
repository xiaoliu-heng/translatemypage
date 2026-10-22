import { AppError, HOST_NAME, HostEvent, PROTOCOL, RpcError, Status } from '../shared/protocol';
export class NativeBridge {
  private port?: chrome.runtime.Port;
  private connecting?: Promise<void>;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  status?: Status;
  connection: 'missing' | 'connecting' | 'ready' | 'incompatible' | 'disconnected' = 'disconnected';
  bootId?: string;
  private lastSeq = 0;
  constructor(private event: (e: HostEvent) => void, private disconnected: () => void) {}
  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.port && this.connection === 'ready') return;
    this.connecting = (async () => {
      this.connection = 'connecting';
      const saved = await chrome.storage.local.get('installationId');
      const installationId = saved.installationId || crypto.randomUUID();
      if (!saved.installationId) await chrome.storage.local.set({ installationId });
      const port = chrome.runtime.connectNative(HOST_NAME); this.port = port;
      port.onMessage.addListener(message => {
        if (message.v !== PROTOCOL) return;
        if (message.event) {
          const e = message as HostEvent;
          if (e.bootId !== this.bootId || e.seq <= this.lastSeq) return;
          this.lastSeq = e.seq;
          if (e.event === 'status') this.status = e.data;
          this.event(e); return;
        }
        const call = this.pending.get(message.id); if (!call) return;
        clearTimeout(call.timer); this.pending.delete(message.id);
        if (message.error) call.reject(Object.assign(new AppError(message.error.code, message.error.message), message.error));
        else call.resolve(message.result);
      });
      port.onDisconnect.addListener(() => {
        const detail = chrome.runtime.lastError?.message || '';
        if (this.port !== port) return;
        this.port = undefined; this.connection = /not found|forbidden|not registered/i.test(detail) ? 'missing' : 'disconnected';
        for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new AppError('host_disconnected', '助手已断开；已提交任务的结果未知，请手动重试未完成段落。')); }
        this.pending.clear(); this.disconnected();
      });
      const hello = await this.send('bridge.hello', { installationId });
      if (hello.protocol !== PROTOCOL) {
        this.connection = 'incompatible'; this.close(); throw new AppError('incompatible', '请更新本地助手。');
      }
      this.bootId = hello.bootId; this.lastSeq = 0; this.status = hello.status; this.connection = 'ready';
    })().catch(e => {
      const port = this.port; this.port = undefined; port?.disconnect();
      if (this.connection === 'connecting') this.connection = 'disconnected';
      throw e;
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private send(method: string, params?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AppError('host_timeout', '助手响应超时；请重新连接。')); }, method === 'account.logout' ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { if (!this.port) throw new Error(); this.port.postMessage({ v: 1, id, method, params }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new AppError('host_disconnected', '无法连接助手，请检查安装状态。')); }
    });
  }
  async call(method: string, params?: unknown): Promise<any> { await this.connect(); return this.send(method, params); }
  close(): void { const p = this.port; this.port = undefined; p?.disconnect(); this.connection = 'disconnected'; }
}
