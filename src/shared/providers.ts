import { Account, AppError, assert, Settings } from './protocol';

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

export function normalizeApiBaseUrl(raw: string): string {
  assert(raw.trim().length > 0 && raw.length <= 2048, 'invalid_api_address', '请输入有效的 API 基础地址。');
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new AppError('invalid_api_address', 'API 基础地址无效，请使用完整的 http:// 或 https:// 地址。'); }
  assert((url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname,
    'invalid_api_address', 'API 基础地址只支持 HTTP 或 HTTPS。');
  assert(!url.username && !url.password && !url.search && !url.hash,
    'invalid_api_address', 'API 基础地址不能包含账号、密码、查询参数或片段。');
  return url.href.replace(/\/+$/, '');
}

export function providerOrigin(account: Account): string {
  return account.authType === 'api_key' ? new URL(account.apiBaseUrl).origin : 'https://api.openai.com';
}

export function providerHostPermission(baseUrl: string): string {
  const url = new URL(baseUrl);
  // Chromium host permissions cover all ports on the requested scheme and host.
  return `${url.protocol}//${url.hostname}/*`;
}

export function hasSharingConsent(settings: Settings, account: Account): boolean {
  return settings.acknowledgedSharing && settings.sharingOrigin === providerOrigin(account);
}
