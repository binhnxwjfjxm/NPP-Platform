import 'server-only';

import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 300_000;
const ALLOWED_QUERY = new Set(['from', 'to', 'warehouseId', 'dimension', 'format', 'column']);
const ACCEPTED_CONTENT_TYPES = Object.freeze([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

type CoreEnvelope = Readonly<{
  error?: Readonly<{
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  }>;
}>;

export class SalesReportingExportGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'SalesReportingExportGatewayError';
  }
}

export function resolveSalesReportingExportRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeSalesReportingExportGatewayError(error: unknown) {
  return error instanceof SalesReportingExportGatewayError
    ? error
    : new SalesReportingExportGatewayError(
      'SALES_REPORT_EXPORT_GATEWAY_UNAVAILABLE',
      'Xuất Báo cáo bán hàng tạm thời chưa khả dụng',
      503,
      true,
    );
}

function coreApiBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new SalesReportingExportGatewayError(
      'SALES_REPORT_EXPORT_NOT_CONFIGURED',
      'Xuất Báo cáo bán hàng chưa được cấu hình',
      503,
      false,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SalesReportingExportGatewayError(
      'SALES_REPORT_EXPORT_NOT_CONFIGURED',
      'Xuất Báo cáo bán hàng chưa được cấu hình',
      503,
      false,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
    throw new SalesReportingExportGatewayError(
      'SALES_REPORT_EXPORT_NOT_CONFIGURED',
      'Xuất Báo cáo bán hàng chưa được cấu hình',
      503,
      false,
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

function safeQuery(params: URLSearchParams) {
  const outgoing = new URLSearchParams();
  for (const [name, value] of params.entries()) {
    if (!ALLOWED_QUERY.has(name)) continue;
    if (value.length > 240) {
      throw new SalesReportingExportGatewayError(
        'SALES_REPORT_EXPORT_QUERY_INVALID',
        'Bộ lọc xuất báo cáo không hợp lệ',
        400,
        false,
      );
    }
    outgoing.append(name, value);
  }
  return outgoing;
}

export async function getSalesReportingExport(requestId: string, params: URLSearchParams) {
  const query = safeQuery(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/reporting/sales-export?${query.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv',
        'x-request-id': requestId,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as CoreEnvelope | null;
      throw new SalesReportingExportGatewayError(
        payload?.error?.code || 'SALES_REPORT_EXPORT_REQUEST_FAILED',
        payload?.error?.message || 'Không xuất được Báo cáo bán hàng',
        response.status,
        payload?.error?.retryable === true,
        payload?.error?.details ?? {},
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!ACCEPTED_CONTENT_TYPES.some((allowed) => contentType.includes(allowed)) || !response.body) {
      throw new SalesReportingExportGatewayError(
        'SALES_REPORT_EXPORT_RESPONSE_INVALID',
        'File Báo cáo bán hàng trả về không hợp lệ',
        502,
        false,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof SalesReportingExportGatewayError) throw error;
    throw new SalesReportingExportGatewayError(
      'SALES_REPORT_EXPORT_GATEWAY_UNAVAILABLE',
      'Xuất Báo cáo bán hàng tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
