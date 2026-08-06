const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const ADMIN_SESSION_COOKIE = 'hp_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type AdminSessionPayload = Readonly<{
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
  return process.env.CORE_API_SERVER_TOKEN?.trim()
    || process.env.CORE_WEB_ADMIN_PASSWORD
    || null;
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

export function adminCredentialsConfigured(): boolean {
  return Boolean(
    process.env.CORE_WEB_ADMIN_USERNAME?.trim()
    && process.env.CORE_WEB_ADMIN_PASSWORD
    && sessionSecret(),
  );
}

export function authenticateAdminCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.CORE_WEB_ADMIN_USERNAME?.trim();
  const expectedPassword = process.env.CORE_WEB_ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;
  return constantTimeEqual(username.trim(), expectedUsername)
    && constantTimeEqual(password, expectedPassword);
}

export async function createAdminSession(username: string): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error('ADMIN_SESSION_NOT_CONFIGURED');
  const payload: AdminSessionPayload = Object.freeze({
    version: 1,
    username,
    expiresAt: Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS,
  });
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await signature(encoded, secret)}`;
}

export async function verifyAdminSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = sessionSecret();
  const expectedUsername = process.env.CORE_WEB_ADMIN_USERNAME?.trim();
  if (!secret || !expectedUsername) return false;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;
  const encoded = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = await signature(encoded, secret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(encoded))) as AdminSessionPayload;
    return payload.version === 1
      && payload.username === expectedUsername
      && Number.isInteger(payload.expiresAt)
      && payload.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function adminSessionCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function safeAdminReturnTo(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
}
