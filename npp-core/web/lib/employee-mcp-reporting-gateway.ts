import 'server-only';
import { randomUUID } from 'node:crypto';
import type { EmployeeMcpDashboard } from './employee-mcp-reporting-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_QUERY = new Set(['from', 'to']);

type CoreEnvelope<T> = {
  data?: T | null;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export class EmployeeMcpReportingGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'EmployeeMcpReportingGatewayError';
  }
}

export function resolveEmployeeMcpReportingRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeEmployeeMcpReportingGatewayError(error: unknown) {
  if (error instanceof EmployeeMcpReportingGatewayError) return error;
  return new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_UNAVAILABLE', 'Báo cáo nhân sự & MCP tạm thời chưa khả dụng', 503, true);
}

function serverValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) throw new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_NOT_CONFIGURED', 'Báo cáo nhân sự & MCP chưa được cấu hình', 503, false);
  return value;
}

function baseUrl() {
  let parsed: URL;
  try {
    parsed = new URL(serverValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_NOT_CONFIGURED', 'Báo cáo nhân sự & MCP chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
    throw new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_NOT_CONFIGURED', 'Báo cáo nhân sự & MCP chưa được cấu hình', 503, false);
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function getEmployeeMcpDashboard(
  requestId: string,
  params?: Record<string, string | number | undefined>,
): Promise<EmployeeMcpDashboard> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (ALLOWED_QUERY.has(name) && value !== undefined && value !== '') query.set(name, String(value));
  }
  const serialized = query.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}/api/reporting/employee-mcp${serialized ? `?${serialized}` : ''}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serverValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<EmployeeMcpDashboard> | null;
    if (!payload) throw new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_RESPONSE_INVALID', 'Phản hồi báo cáo không hợp lệ', 502, false);
    if (!response.ok) throw new EmployeeMcpReportingGatewayError(payload.error?.code || 'REPORTING_REQUEST_FAILED', payload.error?.message || 'Yêu cầu báo cáo không thành công', response.status, payload.error?.retryable === true, payload.error?.details ?? {});
    if (!Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === null) throw new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_RESPONSE_INVALID', 'Phản hồi báo cáo không hợp lệ', 502, false);
    return payload.data as EmployeeMcpDashboard;
  } catch (error) {
    if (error instanceof EmployeeMcpReportingGatewayError) throw error;
    throw new EmployeeMcpReportingGatewayError('REPORTING_GATEWAY_UNAVAILABLE', 'Báo cáo nhân sự & MCP tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}
