import 'server-only';
import { randomUUID } from 'node:crypto';
import type { InventoryReportingDashboard } from './inventory-reporting-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_QUERY = new Set(['from', 'to', 'warehouseId', 'slowDays']);

type CoreEnvelope<T> = {
  data?: T | null;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
};

export class InventoryReportingGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'InventoryReportingGatewayError';
  }
}

export function resolveInventoryReportingRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeInventoryReportingGatewayError(error: unknown) {
  if (error instanceof InventoryReportingGatewayError) return error;
  return new InventoryReportingGatewayError(
    'REPORTING_GATEWAY_UNAVAILABLE',
    'Báo cáo tồn kho tạm thời chưa khả dụng',
    503,
    true,
  );
}

function serverValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InventoryReportingGatewayError(
      'REPORTING_GATEWAY_NOT_CONFIGURED',
      'Báo cáo tồn kho chưa được cấu hình',
      503,
      false,
    );
  }
  return value;
}

function baseUrl() {
  let parsed: URL;
  try {
    parsed = new URL(serverValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new InventoryReportingGatewayError(
      'REPORTING_GATEWAY_NOT_CONFIGURED',
      'Báo cáo tồn kho chưa được cấu hình',
      503,
      false,
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new InventoryReportingGatewayError(
      'REPORTING_GATEWAY_NOT_CONFIGURED',
      'Báo cáo tồn kho chưa được cấu hình',
      503,
      false,
    );
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new InventoryReportingGatewayError(
      'REPORTING_GATEWAY_NOT_CONFIGURED',
      'Báo cáo tồn kho chưa được cấu hình',
      503,
      false,
    );
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function getInventoryReportingDashboard(
  requestId: string,
  params?: Record<string, string | number | undefined>,
): Promise<InventoryReportingDashboard> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (ALLOWED_QUERY.has(name) && value !== undefined && value !== '') {
      query.set(name, String(value));
    }
  }
  const serializedQuery = query.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl()}/api/reporting/inventory${serializedQuery ? `?${serializedQuery}` : ''}`,
      {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${serverValue('CORE_API_SERVER_TOKEN')}`,
          Accept: 'application/json',
          'x-request-id': requestId,
        },
      },
    );
    const payload = await response.json().catch(() => null) as CoreEnvelope<InventoryReportingDashboard> | null;
    if (!payload) {
      throw new InventoryReportingGatewayError(
        'REPORTING_GATEWAY_RESPONSE_INVALID',
        'Phản hồi báo cáo tồn kho không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new InventoryReportingGatewayError(
        payload.error?.code || 'REPORTING_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu báo cáo tồn kho không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === null) {
      throw new InventoryReportingGatewayError(
        'REPORTING_GATEWAY_RESPONSE_INVALID',
        'Phản hồi báo cáo tồn kho không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as InventoryReportingDashboard;
  } catch (error) {
    if (error instanceof InventoryReportingGatewayError) throw error;
    throw new InventoryReportingGatewayError(
      'REPORTING_GATEWAY_UNAVAILABLE',
      'Báo cáo tồn kho tạm thời chưa khả dụng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
