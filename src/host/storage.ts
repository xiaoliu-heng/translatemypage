import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { Account, AppError } from '../shared/protocol';

export interface Credential {
  clientId: string; accessToken: string; refreshToken?: string; idToken?: string;
  scopes: string[]; expiresAt: number;
}
export interface Vault {
  get(key: string): Promise<Credential | undefined>;
  set(key: string, value: Credential): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface AccountData { hostId: string; accounts: Account[]; activeKey?: string; pendingClientId?: string }
export function dataRoot(): string {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'TranslateMyPage')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'translatemypage');
}
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e: any) { if (e.code === 'ENOENT') return fallback; throw new AppError('storage_error', '本地数据无法读取。'); }
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
export class AccountStore {
  data!: AccountData;
  private release?: () => Promise<void>;
  constructor(public dir: string) {}
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    try { this.release = await lockfile.lock(this.dir, { realpath: false, stale: 15_000, retries: 0 }); }
    catch { throw new AppError('host_busy', '此浏览器配置的助手已运行，请稍后重新连接。'); }
    this.data = await readJson<AccountData>(join(this.dir, 'accounts.json'), { hostId: `urn:uuid:${randomUUID()}`, accounts: [] });
    await this.save();
  }
  save(): Promise<void> { return atomicJson(join(this.dir, 'accounts.json'), this.data); }
  async close(): Promise<void> { await this.release?.(); this.release = undefined; }
}
function command(exe: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => { child.kill(); reject(new AppError('vault_error', '系统凭据库响应超时，请重新连接助手。')); }, 30_000);
    child.stdout.on('data', data => { out += data; if (out.length > 128 * 1024) child.kill(); });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new AppError('vault_unavailable', '系统凭据库不可用，请重新安装助手。')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new AppError('vault_error', '无法访问系统凭据库，请检查系统授权。')); });
    child.stdin.end(input);
  });
}
export class SystemVault implements Vault {
  constructor(private namespace: string, private helperPath: string) {}
  private async run(action: string, key: string, credential?: Credential): Promise<any> {
    if (process.platform === 'darwin') {
      return JSON.parse(await command(this.helperPath, [], JSON.stringify({ action, service: `com.translatemypage.${this.namespace}`, key, value: credential ? JSON.stringify(credential) : undefined })));
    }
    if (process.platform === 'linux') {
      const args = ['service', `com.translatemypage.${this.namespace}`, 'account', key];
      if (action === 'set') { await command('secret-tool', ['store', '--label=TranslateMyPage ChatGPT', ...args], JSON.stringify(credential)); return {}; }
      if (action === 'delete') { await command('secret-tool', ['clear', ...args]); return {}; }
      try { return { value: (await command('secret-tool', ['lookup', ...args])).trim() || undefined }; }
      catch { return {}; }
    }
    throw new AppError('unsupported_platform', '当前助手支持 macOS 和带 Secret Service 的 Linux。');
  }
  async get(key: string): Promise<Credential | undefined> { const r = await this.run('get', key); return r.value ? JSON.parse(r.value) : undefined; }
  async set(key: string, value: Credential): Promise<void> { await this.run('set', key, value); }
  async delete(key: string): Promise<void> { await this.run('delete', key); }
}
export class TranslationCache {
  private entries = new Map<string, { text: string; touched: number }>();
  private writing = Promise.resolve();
  constructor(private path: string, private maxEntries = 2000) {}
  async init(): Promise<void> { this.entries = new Map(await readJson<[string, { text: string; touched: number }][]>(this.path, [])); }
  get(key: string): string | undefined {
    const e = this.entries.get(key); if (e) e.touched = Date.now(); return e?.text;
  }
  set(key: string, text: string): void {
    this.entries.set(key, { text, touched: Date.now() });
    if (this.entries.size > this.maxEntries) {
      const old = [...this.entries].sort((a, b) => a[1].touched - b[1].touched);
      for (const [k] of old.slice(0, this.entries.size - this.maxEntries)) this.entries.delete(k);
    }
  }
  clear(): Promise<void> { this.entries.clear(); return this.flush(); }
  flush(): Promise<void> {
    const snapshot = [...this.entries];
    this.writing = this.writing.catch(() => {}).then(() => atomicJson(this.path, snapshot));
    return this.writing;
  }
}
