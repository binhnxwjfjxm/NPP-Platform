import 'server-only';

import { randomUUID } from 'node:crypto';
import { createIdempotencyKey, isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TEMPLATE_PART_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const REQUEST_TIMEOUT_MS = 8_000;

type CoreEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };

export class DocumentPrintTemplateGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'DocumentPrintTemplateGatewayError';
  }
}

export function resolveDocumentPrintTemplateRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeDocumentPrintTemplateGatewayError(error: unknown) {
  return error instanceof DocumentPrintTemplateGatewayError
    ? error
    : new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_UNAVAILABLE', 'Cấu hình mẫu in tạm thời chưa sẵn sàng', 503, true);
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_NOT_CONFIGURED', 'Dịch vụ mẫu in chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch { throw new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_NOT_CONFIGURED', 'Dịch vụ mẫu in chưa được cấu hình', 503, false); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_NOT_CONFIGURED', 'Dịch vụ mẫu in chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function part(value: string, code: string, message: string) {
  const normalized = String(value ?? '').trim();
  if (!TEMPLATE_PART_PATTERN.test(normalized)) throw new DocumentPrintTemplateGatewayError(code, message, 400, false);
  return normalized;
}

function mutationKey(value: string | undefined) {
  if (value === undefined || !value.trim()) return createIdempotencyKey('document-print-template-update');
  const normalized = normalizeIdempotencyKey(value);
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new DocumentPrintTemplateGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return normalized;
}

async function request<T>({ method, path, requestId, body, idempotencyKey }: {
  method: 'GET' | 'PATCH'; path: string; requestId: string; body?: unknown; idempotencyKey?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: CoreEnvelope<T>;
    try { payload = await response.json() as CoreEnvelope<T>; } catch {
      throw new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_RESPONSE_INVALID', 'Phản hồi mẫu in không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new DocumentPrintTemplateGatewayError(
        payload.error?.code ?? 'PRINT_TEMPLATE_REQUEST_FAILED',
        payload.error?.message ?? 'Yêu cầu mẫu in không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_RESPONSE_INVALID', 'Phản hồi mẫu in không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (cause) {
    if (cause instanceof DocumentPrintTemplateGatewayError) throw cause;
    throw new DocumentPrintTemplateGatewayError('PRINT_TEMPLATE_GATEWAY_UNAVAILABLE', 'Dịch vụ mẫu in tạm thời chưa sẵn sàng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function listDocumentPrintTemplates<T>(requestId: string): Promise<T[]> {
  return request<T[]>({ method: 'GET', path: '/api/document-print-templates', requestId });
}

export function patchDocumentPrintTemplate<T>(
  documentType: string,
  templateCode: string,
  requestId: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const type = part(documentType, 'INVALID_DOCUMENT_TYPE', 'Loại chứng từ không hợp lệ');
  const code = part(templateCode, 'INVALID_TEMPLATE_CODE', 'Mã mẫu in không hợp lệ');
  return request<T>({
    method: 'PATCH',
    path: `/api/document-print-templates/${type}/${code}`,
    requestId,
    body,
    idempotencyKey: mutationKey(idempotencyKey),
  });
}
