import 'server-only';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

export const RETAIL_SESSION_COOKIE = 'hp_npp_session';
export const RETAIL_SOURCE_APP = 'retail-web';

type CompanyEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
  requestId?: string;
};

export class CompanyGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CompanyGatewayError';
  }
}

function companyBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new CompanyGatewayError('COMPANY_NOT_CONFIGURED', 'Kết nối Hệ thống Công Ty chưa được cấu hình', 503, false);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CompanyGatewayError('COMPANY_NOT_CONFIGURED', 'Kết nối Hệ thống Công Ty chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new CompanyGatewayError('COMPANY_NOT_CONFIGURED', 'Kết nối Hệ thống Công Ty chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

// Only record fixed operation classes: never log customer IDs, search terms,
// request/response bodies, session tokens or raw upstream exceptions.
function companyOperation(path: string) {
  const pathname = path.split('?')[0];
  if (pathname === '/api/retail/prices') return 'retail_prices';
  if (pathname.includes('/availability')) return 'retail_availability';
  if (pathname === '/api/sales-orders') return 'sales_orders';
  if (/^\/api\/sales-orders\/[^/]+\/draft$/.test(pathname)) return 'sales_order_draft';
  if (pathname.startsWith('/api/sales-orders/')) return 'sales_order_action';
  if (pathname === '/api/retail/product-labels') return 'retail_product_labels';
  return 'company_read_other';
}

function logCompanyFailure(options: { path: string; method?: string }, id: string, startedAt: number, code: string, status: number) {
  console.error('retail_company_request_failed', JSON.stringify({
    requestId: id, operation: companyOperation(options.path), method: options.method ?? 'GET',
    code, status, durationMs: Date.now() - startedAt,
  }));
}

function workforceToken() {
  const token = cookies().get(RETAIL_SESSION_COOKIE)?.value?.trim();
  if (token?.startsWith('nppusr.')) return token;
  throw new CompanyGatewayError('UNAUTHORIZED', 'Cần đăng nhập để tiếp tục', 401, false);
}

function requestId(value?: string | null) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(normalized) ? normalized : `retail_${randomUUID()}`;
}

export function retailSessionCookieOptions(expiresAt?: string) {
  const parsed = expiresAt ? new Date(expiresAt) : null;
  const expires = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

export function safeReturnTo(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return candidate.startsWith('/')
    && !candidate.startsWith('//')
    && !candidate.includes('\\')
    && !/%(?:2f|5c)/i.test(candidate)
    ? candidate
    : '/';
}

export async function companyRequest<T>(options: {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  idempotencyKey?: string | null;
  requestId?: string | null;
}) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const id = requestId(options.requestId);
  try {
    const response = await fetch(`${companyBaseUrl()}${options.path}`, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${workforceToken()}`,
        Accept: 'application/json',
        'x-request-id': id,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json().catch(() => null) as CompanyEnvelope<T> | null;
    if (!payload) {
      logCompanyFailure(options, id, startedAt, 'COMPANY_RESPONSE_INVALID', 502);
      throw new CompanyGatewayError('COMPANY_RESPONSE_INVALID', 'Phản hồi từ Hệ thống Công Ty không hợp lệ', 502, false);
    }
    if (!response.ok) {
      if (response.status >= 500) logCompanyFailure(options, id, startedAt, payload.error?.code ?? 'COMPANY_HTTP_FAILURE', response.status);
      throw new CompanyGatewayError(
        payload.error?.code ?? 'COMPANY_REQUEST_FAILED',
        payload.error?.message ?? 'Yêu cầu tới Hệ thống Công Ty không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      logCompanyFailure(options, id, startedAt, 'COMPANY_RESPONSE_INVALID', 502);
      throw new CompanyGatewayError('COMPANY_RESPONSE_INVALID', 'Phản hồi từ Hệ thống Công Ty không hợp lệ', 502, false);
    }
    return { data: payload.data as T, requestId: payload.requestId ?? id };
  } catch (error) {
    if (error instanceof CompanyGatewayError) throw error;
    const timedOut = controller.signal.aborted;
    const code = timedOut ? 'COMPANY_TIMEOUT' : 'COMPANY_UNAVAILABLE';
    const status = timedOut ? 504 : 503;
    logCompanyFailure(options, id, startedAt, code, status);
    throw new CompanyGatewayError(code, timedOut
      ? 'Công Ty phản hồi quá lâu; chưa xác minh được kết quả. Hãy kiểm tra lại trước khi thử lưu.'
      : 'Hệ thống Công Ty tạm thời chưa sẵn sàng', status, true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function companyAuthentication<T>(path: '/api/internal-auth/login' | '/api/internal-auth/me' | '/api/internal-auth/logout', options: {
  method: 'GET' | 'POST'; body?: unknown; token?: string | null;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${companyBaseUrl()}${path}`, {
      method: options.method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'x-request-id': `retail_auth_${randomUUID()}`,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json().catch(() => null) as CompanyEnvelope<T> | null;
    return {
      ok: response.ok && Boolean(payload?.data),
      status: response.status,
      data: payload?.data,
      code: payload?.error?.code,
      message: payload?.error?.message,
      retryable: payload?.error?.retryable === true,
    };
  } catch {
    return { ok: false, status: 503, code: 'COMPANY_UNAVAILABLE', message: 'Hệ thống Công Ty tạm thời chưa sẵn sàng', retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}
