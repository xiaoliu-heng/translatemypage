import { validSourceFormat } from './formatting';
export const HOST_NAME = 'com.translatemypage.host';
export const PROTOCOL = 1;
export const VERSION = '0.1.0';
export const MAX_FRAME = 128 * 1024;
export const MAX_BATCH_CHARS = 12_000;
export const MAX_SEGMENTS = 8;
export const PROMPT_VERSION = 2;
export const USAGE_URL = 'https://chatgpt.com/settings/usage';

export type IdentityState = 'signed_out' | 'authorizing' | 'signed_in' | 'reauth_required';
export type PlanState = 'not_granted' | 'authorized_unverified' | 'last_request_succeeded' | 'limited' | 'ineligible' | 'temporarily_unavailable';
export interface Account {
  key: string; clientId: string; subject: string; issuer: string;
  name: string; email: string; identity: IdentityState; plan: PlanState;
}
export interface Status {
  accounts: Account[]; activeKey?: string; accountEpoch: number;
  authorizing: boolean; notice?: string;
}
export interface Model { slug: string; displayName: string }
export interface GlossaryTerm { source: string; target: string; hostname?: string }
export interface Settings {
  targetLanguage: string; sourceLanguage: string;
  models: Record<string, string>; glossary: GlossaryTerm[]; glossaryVersion: number;
  excludedSelectors: string; acknowledgedPlan: boolean; acknowledgedSharing: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: 'zh-CN', sourceLanguage: 'auto', models: {}, glossary: [],
  glossaryVersion: 1, excludedSelectors: '', acknowledgedPlan: false, acknowledgedSharing: false,
};
export interface Segment {
  id: string; revision: number; sourceHash: string; text: string;
  protected: Record<string, string>;
}
export interface TranslationParams {
  requestKey: string; accountKey: string; accountEpoch: number; model: string;
  document: { id: string; frameId: number; generation: number; pageKey: string };
  sourceLanguage: string; targetLanguage: string; title: string;
  glossary: GlossaryTerm[]; glossaryVersion: number;
  priority: number; segments: Segment[];
}
export interface Translation extends Segment { translation: string }
export interface RpcRequest { v: 1; id: string; method: string; params?: any }
export interface RpcError { code: string; message: string; status?: number; requestId?: string }
export interface RpcResponse { v: 1; id: string; result?: any; error?: RpcError }
export interface HostEvent {
  v: 1; event: string; bootId: string; seq: number;
  jobId?: string; accountEpoch?: number; data?: any;
}
export class AppError extends Error {
  constructor(public code: string, message: string, public status?: number, public requestId?: string) { super(message); }
  toJSON(): RpcError { return { code: this.code, message: this.message, status: this.status, requestId: this.requestId }; }
}
export function publicError(error: unknown): RpcError {
  if (error instanceof AppError) return error.toJSON();
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', message: '任务已取消。' };
  // Never forward raw HTTP/library exceptions: they may contain a credential-bearing URL.
  return { code: 'internal_error', message: '操作失败，请稍后重试或重新连接本地助手。' };
}
export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(code, message);
}
export function fingerprint(value: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 2246822519); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${value.length}`;
}
export function validateTranslationParams(p: TranslationParams): void {
  assert(p && typeof p === 'object', 'invalid_request', '无效翻译任务。');
  assert(typeof p.accountKey === 'string' && Number.isSafeInteger(p.accountEpoch), 'invalid_request', '缺少账号版本。');
  for (const value of [p.model, p.sourceLanguage, p.targetLanguage, p.requestKey]) {
    assert(typeof value === 'string' && value.length > 0 && value.length <= 200, 'invalid_request', '翻译设置无效。');
  }
  assert(typeof p.title === 'string' && p.title.length <= 500, 'invalid_request', '标题过长。');
  assert(p.document && typeof p.document.id === 'string' && p.document.id.length <= 200 &&
    typeof p.document.pageKey === 'string' && p.document.pageKey.length <= 300 &&
    Number.isSafeInteger(p.document.generation) && Number.isSafeInteger(p.document.frameId), 'invalid_request', '页面版本无效。');
  assert(Number.isInteger(p.priority) && p.priority >= 0 && p.priority <= 10, 'invalid_request', '任务优先级无效。');
  assert(Number.isSafeInteger(p.glossaryVersion) && Array.isArray(p.glossary) && p.glossary.length <= 100, 'invalid_request', '术语表过大。');
  assert(p.glossary.every(t => typeof t.source === 'string' && t.source.length > 0 && t.source.length <= 200 &&
    typeof t.target === 'string' && t.target.length > 0 && t.target.length <= 200), 'invalid_request', '术语无效。');
  assert(Array.isArray(p.segments) && p.segments.length > 0 && p.segments.length <= MAX_SEGMENTS, 'invalid_request', '批次过大。');
  const ids = new Set<string>(); let chars = 0;
  for (const s of p.segments) {
    assert(s && typeof s.id === 'string' && s.id.length <= 100 && !ids.has(s.id), 'invalid_request', '段落 ID 无效或重复。');
    ids.add(s.id);
    assert(typeof s.text === 'string' && s.text.trim().length > 0 && typeof s.sourceHash === 'string' && s.sourceHash.length <= 200 &&
      Number.isSafeInteger(s.revision), 'invalid_request', '段落内容无效。');
    assert(s.protected && typeof s.protected === 'object' && !Array.isArray(s.protected) &&
      Object.entries(s.protected).every(([k, v]) => /^⟦TMP:\d+⟧$/.test(k) && typeof v === 'string' && v.length <= MAX_BATCH_CHARS), 'invalid_request', '保护标记无效。');
    assert(validSourceFormat(s.text, s.protected), 'invalid_request', '段落格式标记无效。');
    chars += s.text.length + JSON.stringify(s.protected).length;
  }
  assert(chars <= MAX_BATCH_CHARS, 'invalid_request', '段落内容超出批次预算。');
  assert(new TextEncoder().encode(JSON.stringify(p)).length < MAX_FRAME - 1024, 'message_too_large', '消息过大，请减少段落数量。');
}
