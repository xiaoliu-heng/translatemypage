export interface PendingAuthorization {
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  createdAt: number;
  clientId?: string;
  consumed: boolean;
}
export class CallbackError extends Error {
  constructor(public code: string) { super(code); }
}
export function consumeCallback(raw: string, pending?: PendingAuthorization, now = Date.now()): { code: string; clientId: string } {
  if (!pending || pending.consumed) throw new CallbackError('no_pending_authorization');
  if (now < pending.createdAt || now - pending.createdAt > 5 * 60_000) throw new CallbackError('authorization_expired');
  if (raw.length > 12_000) throw new CallbackError('invalid_callback');
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new CallbackError('invalid_callback'); }
  const expected = new URL(pending.redirectUri);
  if (raw.trim().split('?')[0] !== pending.redirectUri) throw new CallbackError('callback_mismatch');
  if (url.username || url.password || url.hash || url.origin !== expected.origin || url.pathname !== expected.pathname)
    throw new CallbackError('callback_mismatch');
  for (const name of ['state', 'code', 'client_id', 'error', 'scope'])
    if (url.searchParams.getAll(name).length > 1) throw new CallbackError('duplicate_parameter');
  if (['access_token', 'refresh_token', 'id_token'].some(name => url.searchParams.has(name))) throw new CallbackError('unexpected_token_in_url');
  if (!pending.state || url.searchParams.get('state') !== pending.state) throw new CallbackError('state_mismatch');
  if (url.searchParams.has('error')) { pending.consumed = true; throw new CallbackError('authorization_denied'); }
  const code = url.searchParams.get('code');
  const clientId = url.searchParams.get('client_id') || pending.clientId;
  if (!code || code.length > 4096 || !clientId || clientId === 'dynamic_agent_client' || !/^[A-Za-z0-9_.-]{1,256}$/.test(clientId))
    throw new CallbackError('incomplete_callback');
  if (pending.clientId && clientId !== pending.clientId) throw new CallbackError('client_mismatch');
  pending.consumed = true;
  return { code, clientId };
}
