import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_TIMEOUT_MS = 30_000;
const SAFE_PATH = /^\/(?:api\/backups(?:\/[0-9a-f-]{36}(?:\/download)?)?|api\/data-deletions(?:\/[0-9a-f-]{36}\/verify)?)$/i;

type Envelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
export class BackupGatewayError extends Error {
  constructor(public readonly code: string, public readonly publicMessage: string, public readonly statusCode: number, public readonly retryable: boolean, public readonly details: unknown = {}) {
    super(publicMessage);
    this.name = 'BackupGatewayError';
  }
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new BackupGatewayError('BACKUP_GATEWAY_NOT_CONFIGURED', 'Chức năng sao lưu chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch { throw new BackupGatewayError('BACKUP_GATEWAY_NOT_CONFIGURED', 'Chức năng sao lưu chưa được cấu hình', 503, false); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new BackupGatewayError('BACKUP_GATEWAY_NOT_CONFIGURED', 'Chức năng sao lưu chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safePath(value: string) {
  const path = value.startsWith('/') ? value : `/${value}`;
  if (!SAFE_PATH.test(path)) throw new BackupGatewayError('BACKUP_GATEWAY_PATH_INVALID', 'Đường dẫn sao lưu không hợp lệ', 404, false);
  return path;
}

function requiredKey(value?: string | null) {
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new BackupGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng yêu cầu không hợp lệ', 400, false);
  }
  return normalized;
}

export function normalizeBackupGatewayError(error: unknown) {
  return error instanceof BackupGatewayError
    ? error
    : new BackupGatewayError('BACKUP_GATEWAY_UNAVAILABLE', 'Chức năng sao lưu tạm thời chưa khả dụng', 503, true);
}

export async function requestBackupApi<T>({
  path,
  method,
  body,
  idempotencyKey,
  requestId,
}: {
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string | null;
  requestId?: string | null;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const key = method === 'POST' ? requiredKey(idempotencyKey) : null;
    const response = await fetch(`${baseUrl()}${safePath(path)}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId?.trim() || `web_${randomUUID()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!payload) throw new BackupGatewayError('BACKUP_GATEWAY_RESPONSE_INVALID', 'Phản hồi sao lưu không hợp lệ', 502, false);
    if (!response.ok) throw new BackupGatewayError(
      payload.error?.code || 'BACKUP_REQUEST_FAILED',
      payload.error?.message || 'Yêu cầu sao lưu không thành công',
      response.status,
      payload.error?.retryable === true,
      payload.error?.details ?? {},
    );
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) throw new BackupGatewayError('BACKUP_GATEWAY_RESPONSE_INVALID', 'Phản hồi sao lưu không hợp lệ', 502, false);
    return payload.data as T;
  } catch (error) {
    if (error instanceof BackupGatewayError) throw error;
    throw new BackupGatewayError('BACKUP_GATEWAY_UNAVAILABLE', 'Chức năng sao lưu tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timer);
  }
}
