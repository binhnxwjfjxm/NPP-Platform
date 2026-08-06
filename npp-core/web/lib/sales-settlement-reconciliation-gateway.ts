import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SalesSettlementReport } from './sales-settlement-reconciliation-types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_QUERY = new Set(['from', 'to', 'search', 'status', 'limit']);

type CoreEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };

export class SalesSettlementGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'SalesSettlementGatewayError';
  }
}

export function resolveSalesSettlementRequestId(value: string | null | undefined) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeSalesSettlementGatewayError(error: unknown) {
  if (error instanceof SalesSettlementGatewayError) return error;
  return new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_UNAVAILABLE', 'Đối soát bán hàng và COD tạm thời chưa khả dụng', 503, true);
}

function serverValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_NOT_CONFIGURED', 'Đối soát bán hàng và COD chưa được cấu hình', 503, false);
  return value;
}

function baseUrl() {
  let parsed: URL;
  try { parsed = new URL(serverValue('CORE_API_INTERNAL_URL')); } catch {
    throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_NOT_CONFIGURED', 'Đối soát bán hàng và COD chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_NOT_CONFIGURED', 'Đối soát bán hàng và COD chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_NOT_CONFIGURED', 'Đối soát bán hàng và COD chưa được cấu hình', 503, false);
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function getSalesSettlementReport(requestId: string, params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (ALLOWED_QUERY.has(name) && value !== undefined && value !== '') query.set(name, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}/api/accounting/reconciliation${query.size ? `?${query}` : ''}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serverValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<SalesSettlementReport> | null;
    if (!payload) throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_RESPONSE_INVALID', 'Phản hồi đối soát không hợp lệ', 502, false);
    if (!response.ok) throw new SalesSettlementGatewayError(
      payload.error?.code || 'SALES_SETTLEMENT_REQUEST_FAILED',
      payload.error?.message || 'Yêu cầu đối soát không thành công',
      response.status,
      payload.error?.retryable === true,
      payload.error?.details ?? {},
    );
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_RESPONSE_INVALID', 'Phản hồi đối soát không hợp lệ', 502, false);
    }
    return payload.data as SalesSettlementReport;
  } catch (error) {
    if (error instanceof SalesSettlementGatewayError) throw error;
    throw new SalesSettlementGatewayError('SALES_SETTLEMENT_GATEWAY_UNAVAILABLE', 'Đối soát bán hàng và COD tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}
