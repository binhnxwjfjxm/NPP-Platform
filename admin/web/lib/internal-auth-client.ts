import 'server-only';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from './admin-session';

export const ADMIN_INTERNAL_SOURCE_APP = 'admin-mcp-npp-web';

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export type InternalAuthResult<T> = Readonly<{
  ok: boolean;
  status: number;
  data?: T;
  code?: string;
  message?: string;
  retryable?: boolean;
}>;

export function adminCoreBaseUrl(): string {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new Error('ADMIN_CORE_NOT_CONFIGURED');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ADMIN_CORE_NOT_CONFIGURED');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ADMIN_CORE_NOT_CONFIGURED');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('ADMIN_CORE_HTTPS_REQUIRED');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function readAdminSessionToken(): string | null {
  return cookies().get(ADMIN_SESSION_COOKIE)?.value?.trim() || null;
}

export async function requestInternalAuth<T>(
  path: '/api/internal-auth/login' | '/api/internal-auth/me' | '/api/internal-auth/logout',
  options: { method: 'GET' | 'POST'; body?: unknown; token?: string | null },
): Promise<InternalAuthResult<T>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${adminCoreBaseUrl()}${path}`, {
        method: options.method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'x-request-id': `admin_auth_${randomUUID()}`,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const payload = await response.json().catch(() => null) as Envelope<T> | null;
      if (!payload) {
        return { ok: false, status: 502, code: 'ADMIN_CORE_RESPONSE_INVALID', message: 'Phản hồi từ NPP Core không hợp lệ' };
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          code: payload.error?.code || 'ADMIN_CORE_REQUEST_FAILED',
          message: payload.error?.message || 'Yêu cầu tới NPP Core không thành công',
          retryable: payload.error?.retryable === true,
        };
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return { ok: false, status: 502, code: 'ADMIN_CORE_RESPONSE_INVALID', message: 'Phản hồi từ NPP Core không hợp lệ' };
      }
      return { ok: true, status: response.status, data: payload.data as T };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { ok: false, status: 503, code: 'ADMIN_CORE_UNAVAILABLE', message: 'NPP Core tạm thời chưa sẵn sàng', retryable: true };
  }
}
