import 'server-only';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 300_000;

type CoreEnvelope = {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
};

export class BusinessDataExportGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'BusinessDataExportGatewayError';
  }
}

export function resolveBusinessDataExportRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeBusinessDataExportGatewayError(error: unknown) {
  return error instanceof BusinessDataExportGatewayError
    ? error
    : new BusinessDataExportGatewayError(
      'BUSINESS_DATA_EXPORT_GATEWAY_UNAVAILABLE',
      'Xuất số liệu doanh nghiệp tạm thời chưa khả dụng',
      503,
      true,
    );
}

function coreApiBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new BusinessDataExportGatewayError(
      'BUSINESS_DATA_EXPORT_NOT_CONFIGURED',
      'Xuất số liệu doanh nghiệp chưa được cấu hình',
      503,
      false,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BusinessDataExportGatewayError(
      'BUSINESS_DATA_EXPORT_NOT_CONFIGURED',
      'Xuất số liệu doanh nghiệp chưa được cấu hình',
      503,
      false,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
    throw new BusinessDataExportGatewayError(
      'BUSINESS_DATA_EXPORT_NOT_CONFIGURED',
      'Xuất số liệu doanh nghiệp chưa được cấu hình',
      503,
      false,
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function getBusinessDataExport(requestId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/reporting/business-export`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x-request-id': requestId,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as CoreEnvelope | null;
      throw new BusinessDataExportGatewayError(
        payload?.error?.code || 'BUSINESS_DATA_EXPORT_REQUEST_FAILED',
        payload?.error?.message || 'Không xuất được số liệu doanh nghiệp',
        response.status,
        payload?.error?.retryable === true,
        payload?.error?.details ?? {},
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      || !response.body) {
      throw new BusinessDataExportGatewayError(
        'BUSINESS_DATA_EXPORT_RESPONSE_INVALID',
        'File Excel trả về không hợp lệ',
        502,
        false,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof BusinessDataExportGatewayError) throw error;
    throw new BusinessDataExportGatewayError(
      'BUSINESS_DATA_EXPORT_GATEWAY_UNAVAILABLE',
      'Xuất số liệu doanh nghiệp tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
