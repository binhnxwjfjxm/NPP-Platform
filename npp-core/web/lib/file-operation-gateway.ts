import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_TIMEOUT_MS = 30_000;
const SAFE_PATHS = new Set([
  'products/export', 'products/import', 'pricing/export', 'pricing/import', 'stocktake/export', 'stocktake/import',
  'inventory/movements', 'inventory/movements/export', 'quotation',
]);
const SAFE_QUERY_KEYS = new Set(['sku', 'warehouseId', 'limit']);

type Envelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
export class FileOperationGatewayError extends Error {
  constructor(public readonly code: string, public readonly publicMessage: string, public readonly statusCode: number, public readonly retryable: boolean, public readonly details: unknown = {}) {
    super(publicMessage); this.name = 'FileOperationGatewayError';
  }
}
function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new FileOperationGatewayError('FILE_OPERATION_GATEWAY_NOT_CONFIGURED', 'Cổng import/export chưa được cấu hình', 503, false);
  let url: URL; try { url = new URL(raw); } catch { throw new FileOperationGatewayError('FILE_OPERATION_GATEWAY_NOT_CONFIGURED', 'Cổng import/export chưa được cấu hình', 503, false); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new FileOperationGatewayError('FILE_OPERATION_GATEWAY_NOT_CONFIGURED', 'Cổng import/export chưa được cấu hình', 503, false);
  url.pathname = url.pathname.replace(/\/$/, ''); url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, '');
}
function safePath(value: string) { const path = value.replace(/^\/+|\/+$/g, ''); if (!SAFE_PATHS.has(path)) throw new FileOperationGatewayError('FILE_OPERATION_PATH_INVALID', 'Đường dẫn import/export không hợp lệ', 404, false); return path; }
function safeQuery(source?: URLSearchParams) { const query = new URLSearchParams(); for (const [key, value] of source?.entries() ?? []) if (SAFE_QUERY_KEYS.has(key) && value.length <= 128) query.append(key, value); return query.size ? `?${query}` : ''; }
function optionalIdempotencyKey(value:string|null|undefined){const normalized=normalizeIdempotencyKey(value);if(!normalized)return null;if(!isValidIdempotencyKey(normalized))throw new FileOperationGatewayError('INVALID_IDEMPOTENCY_KEY','Khóa chống trùng yêu cầu không hợp lệ',400,false);return normalized;}
export async function requestFileOperation<T>({ path, method, body, searchParams, idempotencyKey, requestId }: { path: string; method: 'GET' | 'POST'; body?: unknown; searchParams?: URLSearchParams; idempotencyKey?: string | null; requestId?: string | null }): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const normalizedIdempotencyKey=optionalIdempotencyKey(idempotencyKey);
  try {
    const response = await fetch(`${baseUrl()}/api/file-operations/${safePath(path)}${safeQuery(searchParams)}`, {
      method, cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${requireNppWorkforceSessionToken()}`, Accept: 'application/json', 'x-request-id': requestId?.trim() || `web_${randomUUID()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(normalizedIdempotencyKey ? { 'Idempotency-Key': normalizedIdempotencyKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!payload) throw new FileOperationGatewayError('FILE_OPERATION_GATEWAY_RESPONSE_INVALID', 'Phản hồi import/export không hợp lệ', 502, false);
    if (!response.ok) throw new FileOperationGatewayError(payload.error?.code || 'FILE_OPERATION_FAILED', payload.error?.message || 'Thao tác import/export không thành công', response.status, payload.error?.retryable === true, payload.error?.details ?? {});
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) throw new FileOperationGatewayError('FILE_OPERATION_GATEWAY_RESPONSE_INVALID', 'Phản hồi import/export không hợp lệ', 502, false);
    return payload.data as T;
  } catch (error) {
    if (error instanceof FileOperationGatewayError) throw error;
    throw new FileOperationGatewayError('FILE_OPERATION_GATEWAY_UNAVAILABLE', 'Cổng import/export tạm thời không khả dụng', 503, true);
  } finally { clearTimeout(timer); }
}
