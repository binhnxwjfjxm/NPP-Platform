import { createPublicKey, verify as verifySignature } from 'node:crypto';

const CLOCK_SKEW_SECONDS = 60;
const JWKS_CACHE_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

function text(value) {
  return String(value ?? '').trim();
}

function base64UrlDecode(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
}

function decodeJsonSegment(value) {
  try {
    return JSON.parse(base64UrlDecode(value).toString('utf8'));
  } catch {
    return null;
  }
}

function splitCsv(value) {
  return Object.freeze([...new Set(text(value).split(',').map((item) => item.trim()).filter(Boolean))]);
}

function httpUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:')) {
    throw new Error(`${name} must use https`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function authFailure(code, statusCode = 401) {
  return Object.freeze({ ok: false, code, statusCode });
}

export function loadCustomerPortalAuthConfig(env = process.env) {
  const enabled = ['1', 'true', 'yes'].includes(text(env.CUSTOMER_PORTAL_ENABLED).toLowerCase());
  if (!enabled) return Object.freeze({ enabled: false });
  const issuer = httpUrl(text(env.CUSTOMER_PORTAL_CLERK_ISSUER), 'CUSTOMER_PORTAL_CLERK_ISSUER');
  const jwksUrl = httpUrl(text(env.CUSTOMER_PORTAL_CLERK_JWKS_URL), 'CUSTOMER_PORTAL_CLERK_JWKS_URL');
  const audience = text(env.CUSTOMER_PORTAL_CLERK_AUDIENCE) || null;
  const authorizedParties = splitCsv(env.CUSTOMER_PORTAL_CLERK_AUTHORIZED_PARTIES);
  return Object.freeze({ enabled: true, issuer, jwksUrl, audience, authorizedParties });
}

function bearerToken(req) {
  const header = String(req?.headers?.authorization ?? '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || '';
}

function audienceMatches(claim, expected) {
  if (!expected) return true;
  if (Array.isArray(claim)) return claim.includes(expected);
  return claim === expected;
}

function verifyClaims(payload, config, nowMs) {
  if (!payload || typeof payload !== 'object') return authFailure('CUSTOMER_PORTAL_TOKEN_INVALID');
  const nowSeconds = Math.floor(nowMs / 1000);
  if (String(payload.iss ?? '').replace(/\/$/, '') !== config.issuer) return authFailure('CUSTOMER_PORTAL_TOKEN_ISSUER_INVALID');
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) return authFailure('CUSTOMER_PORTAL_TOKEN_SUBJECT_INVALID');
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds - CLOCK_SKEW_SECONDS) return authFailure('CUSTOMER_PORTAL_TOKEN_EXPIRED');
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) return authFailure('CUSTOMER_PORTAL_TOKEN_NOT_ACTIVE');
  if (!audienceMatches(payload.aud, config.audience)) return authFailure('CUSTOMER_PORTAL_TOKEN_AUDIENCE_INVALID');
  if (config.authorizedParties.length > 0 && !config.authorizedParties.includes(String(payload.azp ?? ''))) {
    return authFailure('CUSTOMER_PORTAL_TOKEN_AUTHORIZED_PARTY_INVALID');
  }
  return Object.freeze({ ok: true, subject: payload.sub.trim(), claims: payload });
}

export function createCustomerPortalAuthenticator({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  let config;
  try {
    config = loadCustomerPortalAuthConfig(env);
  } catch {
    return Object.freeze({
      enabled: false,
      authenticate: async () => authFailure('CUSTOMER_PORTAL_AUTH_CONFIG_INVALID', 503),
    });
  }
  if (!config.enabled) {
    return Object.freeze({
      enabled: false,
      authenticate: async () => authFailure('CUSTOMER_PORTAL_NOT_CONFIGURED', 503),
    });
  }

  let cache = { expiresAt: 0, keys: new Map() };

  async function loadKeys() {
    const nowMs = now();
    if (cache.expiresAt > nowMs && cache.keys.size > 0) return cache.keys;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(config.jwksUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('jwks-unavailable');
      const body = await response.json();
      if (!body || !Array.isArray(body.keys)) throw new Error('jwks-invalid');
      const keys = new Map();
      for (const jwk of body.keys) {
        if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
        if (jwk.use && jwk.use !== 'sig') continue;
        if (jwk.alg && jwk.alg !== 'RS256') continue;
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      }
      if (keys.size === 0) throw new Error('jwks-empty');
      cache = { expiresAt: nowMs + JWKS_CACHE_MS, keys };
      return keys;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function authenticate(req) {
    const token = bearerToken(req);
    if (!token) return authFailure('CUSTOMER_PORTAL_AUTH_REQUIRED');
    const parts = token.split('.');
    if (parts.length !== 3) return authFailure('CUSTOMER_PORTAL_TOKEN_INVALID');
    const header = decodeJsonSegment(parts[0]);
    const payload = decodeJsonSegment(parts[1]);
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return authFailure('CUSTOMER_PORTAL_TOKEN_INVALID');
    try {
      const keys = await loadKeys();
      const key = keys.get(header.kid);
      if (!key) return authFailure('CUSTOMER_PORTAL_TOKEN_KEY_UNKNOWN');
      const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
      const signature = base64UrlDecode(parts[2]);
      if (!verifySignature('RSA-SHA256', signed, key, signature)) return authFailure('CUSTOMER_PORTAL_TOKEN_SIGNATURE_INVALID');
      return verifyClaims(payload, config, now());
    } catch {
      return authFailure('CUSTOMER_PORTAL_AUTH_UNAVAILABLE', 503);
    }
  }

  return Object.freeze({ enabled: true, authenticate });
}
