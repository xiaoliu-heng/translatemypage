import { createRemoteJWKSet, customFetch, jwtVerify, JWTPayload } from 'jose';
import { AppError, assert } from '../shared/protocol';

const ISSUER = 'https://auth.openai.com';
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;
export type IdentityVerifier = (idToken: string, clientId: string, nonce?: string) => Promise<JWTPayload>;

// Keep errors useful without exposing tokens, raw response bodies or JWT claim values.
function identityError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: unknown })?.code;
  if (code === 'ERR_JWT_EXPIRED') return new AppError('identity_expired', '身份凭据已过期，请检查系统时间并重新授权。');
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    const claim = (error as { claim?: unknown }).claim;
    if (claim === 'aud') return new AppError('identity_audience_mismatch', '身份凭据不属于本次客户端注册，请重新授权。');
    if (claim === 'iss') return new AppError('identity_issuer_mismatch', '身份凭据的签发方校验失败，请重新授权。');
    if (claim === 'nonce') return new AppError('identity_nonce_mismatch', '身份凭据与本次登录不匹配，请重新授权。');
    if (claim === 'nbf') return new AppError('identity_not_yet_valid', '身份凭据尚未生效，请检查系统时间并重新授权。');
    return new AppError('identity_claims_invalid', '身份凭据缺少有效的必需字段，请重新授权。');
  }
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return new AppError('identity_signature_invalid', '身份凭据的签名校验失败，请重新授权。');
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return new AppError('identity_key_missing', 'OpenAI 的签名密钥集中没有匹配的密钥，请稍后重新授权。');
  if (code === 'ERR_JWKS_TIMEOUT') return new AppError('identity_keys_timeout', '读取 OpenAI 签名密钥超时，请检查网络后重新授权。');
  if (code === 'ERR_JWKS_INVALID' || code === 'ERR_JOSE_GENERIC') return new AppError('identity_keys_invalid', 'OpenAI 签名密钥响应无效，请检查网络是否返回了拦截页面。');
  return new AppError('identity_validation_failed', '身份凭据验证失败，请重新授权。');
}

export function createIdentityVerifier(request?: typeof fetch): IdentityVerifier {
  const jwks = createRemoteJWKSet(new URL(JWKS_URI), {
    timeoutDuration: 20_000,
    [customFetch]: async (url, init) => {
      let response: Response;
      try { response = await (request ?? fetch)(url, { ...init, credentials: 'omit', redirect: 'error' }); }
      catch (error) {
        const timeout = init?.signal?.aborted || (error as Error)?.name === 'TimeoutError';
        throw new AppError(timeout ? 'identity_keys_timeout' : 'identity_keys_network', timeout
          ? '读取 OpenAI 签名密钥超时，请检查网络后重新授权。'
          : '无法连接 OpenAI 签名密钥接口，请检查网络及扩展的 OpenAI 网站访问权限。');
      }
      if (response.status !== 200) throw new AppError('identity_keys_http', `读取 OpenAI 签名密钥失败（HTTP ${response.status}），请检查网络是否受到拦截。`, response.status);
      return response;
    },
  });
  return async (idToken, clientId, nonce) => {
    try {
      const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: clientId,
        requiredClaims: nonce === undefined ? ['sub', 'exp', 'iat'] : ['sub', 'exp', 'iat', 'nonce'], algorithms: ['RS256'] });
      assert(payload.sub, 'identity_claims_invalid', '身份凭据缺少有效的账号字段，请重新授权。');
      assert(nonce === undefined || payload.nonce === nonce, 'identity_nonce_mismatch', '身份凭据与本次登录不匹配，请重新授权。');
      return payload;
    } catch (error) { throw identityError(error); }
  };
}

export const verifyIdentity = createIdentityVerifier();
