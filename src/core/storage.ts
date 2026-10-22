import { assert } from '../shared/protocol';

export interface RegistrationData {
  hostId: string;
  lastClientId?: string;
  pendingClientId?: string;
  bindings: Record<string, string>;
}
// This store accepts registration metadata only. Credentials never enter it.
export interface RegistrationStore { data: RegistrationData; save(): Promise<void> }
export function newRegistration(): RegistrationData {
  return { hostId: `urn:uuid:${crypto.randomUUID()}`, bindings: Object.create(null) };
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export interface CachePersistence {
  read(): Promise<unknown>;
  write(value: [string, { text: string; touched: number }][]): Promise<void>;
}
export class TranslationCache {
  private entries = new Map<string, { text: string; touched: number }>();
  private writing = Promise.resolve();
  constructor(private persistence: CachePersistence, private maxEntries = 2000) {}
  async init(): Promise<void> {
    const saved = await this.persistence.read();
    if (Array.isArray(saved)) for (const entry of saved.slice(-this.maxEntries)) {
      if (Array.isArray(entry) && /^[a-f0-9]{64}$/.test(entry[0]) && typeof entry[1]?.text === 'string' &&
        entry[1].text.length <= 16_000 && Number.isFinite(entry[1].touched)) this.entries.set(entry[0], entry[1]);
    }
  }
  get(key: string): string | undefined {
    const value = this.entries.get(key); if (value) value.touched = Date.now(); return value?.text;
  }
  set(key: string, text: string): void {
    assert(/^[a-f0-9]{64}$/.test(key) && typeof text === 'string' && text.length <= 16_000, 'invalid_cache', '译文缓存格式无效。');
    this.entries.set(key, { text, touched: Date.now() });
    if (this.entries.size > this.maxEntries) {
      const sorted = [...this.entries].sort((a, b) => a[1].touched - b[1].touched);
      for (const [old] of sorted.slice(0, this.entries.size - this.maxEntries)) this.entries.delete(old);
    }
  }
  clear(): Promise<void> { this.entries.clear(); return this.flush(); }
  flush(): Promise<void> {
    const snapshot = [...this.entries].map(([key, value]) => [key, { ...value }] as [string, typeof value]);
    this.writing = this.writing.catch(() => {}).then(() => this.persistence.write(snapshot));
    return this.writing;
  }
}
