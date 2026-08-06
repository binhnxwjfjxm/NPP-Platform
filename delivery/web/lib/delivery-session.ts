const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const DELIVERY_SESSION_COOKIE = 'hp_delivery_session';
export const DELIVERY_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type DeliverySessionPayload = Readonly<{
  version: 1;
  username: string;
  expiresAt: number;
}>;

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sessionSecret(): string | null {
  const token = process.env.DELIVERY_CORE_API_TOKEN?.trim();
  const authMaterial = String(process.env.DELIVERY_SETUP_MODE || '').trim().toLowerCase() === 'true'
    ? process.env.DELIVERY_SETUP_PASSWORD
    : process.env.DELIVERY_WEB_USERS_JSON;
  return token && authMaterial ? `${token}\u0000${authMaterial}` : null;
}

async function signature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(result));
}

export async function createDeliverySession(username: string): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error('DELIVERY_SESSION_NOT_CONFIGURED');
  const payload: DeliverySessionPayload = Object.freeze({
    version: 1,
    username,
    expiresAt: Math.floor(Date.now() / 1000) + DELIVERY_SESSION_TTL_SECONDS,
  });
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await signature(encoded, secret)}`;
}

export async function verifyDeliverySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = await signature(encoded, secret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(encoded))) as DeliverySessionPayload;
    return payload.version === 1
      && /^[A-Za-z0-9._-]{2,80}$/.test(payload.username)
      && Number.isInteger(payload.expiresAt)
      && payload.expiresAt > Math.floor(Date.now() / 1000)
      ? payload.username
      : null;
  } catch {
    return null;
  }
}

export function deliverySessionCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DELIVERY_SESSION_TTL_SECONDS,
  });
}

export function safeDeliveryReturnTo(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
}
