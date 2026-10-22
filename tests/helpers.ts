import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Account, TranslationParams } from '../src/shared/protocol';
import { Credential, Vault } from '../src/host/storage';
export class MemoryVault implements Vault {
  values = new Map<string, Credential>();
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: Credential) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}
export async function temporary() { const dir = await mkdtemp(join(tmpdir(), 'translatemypage-test-')); return { dir, remove: () => rm(dir, { recursive: true, force: true }) }; }
export const account = (): Account => ({ key: 'account-1', clientId: 'oaiapp_example', subject: 'user-1', issuer: 'https://auth.openai.com', name: 'Test', email: 'test@example.com', identity: 'signed_in', plan: 'authorized_unverified' });
export function params(page = 'page-1', id = 's1', text = 'Hello world.'): TranslationParams {
  return { requestKey: crypto.randomUUID(), accountKey: 'account-1', accountEpoch: 1, model: 'account-model',
    document: { id: page, frameId: 0, generation: 1, pageKey: page }, sourceLanguage: 'auto', targetLanguage: 'zh-CN', title: 'Test page',
    glossary: [], glossaryVersion: 1, priority: 1, segments: [{ id, revision: 1, sourceHash: 'hash', text, protected: {} }] };
}
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
export async function until(check: () => boolean, timeout = 2000) {
  const start = Date.now(); while (!check()) { if (Date.now() - start > timeout) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 5)); }
}
