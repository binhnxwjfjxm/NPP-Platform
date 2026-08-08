import 'server-only';
import { randomUUID } from 'node:crypto';

type CoreEnvelope<T> = { data?: T | null; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
type PageState = { hasMore: boolean; nextCursor: string | null };

export type AuditHistoryRow = {
  auditId: string; actorId: string; employeeId: string | null; sourceApp: string; requestId: string;
  action: string; resourceType: string; resourceId: string | null; occurredAt: string;
  hasBeforeData: boolean; hasAfterData: boolean; hasMetadata: boolean;
};

export type ImportExportHistoryRow = {
  jobId: string; direction: 'IMPORT' | 'EXPORT'; definitionKey: string; definitionVersion: string; format: string; status: string;
  actorId: string; employeeId: string | null; sourceApp: string; requestId: string;
  normalizedFilters: Record<string, unknown>; effectiveScopes: Record<string, unknown>; businessTimezone: string; sourceAsOf: string | null;
  rowCount: string | null; hasResult: boolean; resultChecksumSha256: string | null; failureCode: string | null;
  requestedAt: string; startedAt: string | null; completedAt: string | null;
};

export type AuditHistoryData = { generatedAt: string; timezone: string; rows: AuditHistoryRow[]; page: PageState };
export type ImportExportHistoryData = { generatedAt: string; timezone: string; rows: ImportExportHistoryRow[]; page: PageState };

export class OperationsHistoryGatewayError extends Error {
  constructor(public readonly code: string, public readonly publicMessage: string, public readonly statusCode: number, public readonly retryable: boolean) {
    super(publicMessage);
    this.name = 'OperationsHistoryGatewayError';
  }
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new OperationsHistoryGatewayError('REPORTING_GATEWAY_NOT_CONFIGURED', 'Lịch sử vận hành chưa được cấu hình', 503, false);
  return value;
}

function baseUrl(): string {
  let url: URL;
  try { url = new URL(requiredServerValue('CORE_API_INTERNAL_URL')); }
  catch { throw new OperationsHistoryGatewayError('REPORTING_GATEWAY_NOT_CONFIGURED', 'Lịch sử vận hành chưa được cấu hình', 503, false); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new OperationsHistoryGatewayError('REPORTING_GATEWAY_NOT_CONFIGURED', 'Lịch sử vận hành chưa được cấu hình', 503, false);
  }
  return url.toString().replace(/\/$/, '');
}

async function getHistory<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const serialized = query.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl()}${path}${serialized ? `?${serialized}` : ''}`, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`, Accept: 'application/json', 'x-request-id': `web_${randomUUID()}` },
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) throw new OperationsHistoryGatewayError('REPORTING_GATEWAY_RESPONSE_INVALID', 'Phản hồi lịch sử vận hành không hợp lệ', 502, false);
    if (!response.ok) throw new OperationsHistoryGatewayError(payload.error?.code || 'REPORTING_REQUEST_FAILED', payload.error?.message || 'Không tải được lịch sử vận hành', response.status, payload.error?.retryable === true);
    if (!Object.prototype.hasOwnProperty.call(payload, 'data') || payload.data === null) throw new OperationsHistoryGatewayError('REPORTING_GATEWAY_RESPONSE_INVALID', 'Phản hồi lịch sử vận hành không hợp lệ', 502, false);
    return payload.data as T;
  } catch (error) {
    if (error instanceof OperationsHistoryGatewayError) throw error;
    throw new OperationsHistoryGatewayError('REPORTING_GATEWAY_UNAVAILABLE', 'Lịch sử vận hành tạm thời chưa khả dụng', 503, true);
  } finally { clearTimeout(timeout); }
}

export function getAuditHistory(params: Record<string, string | undefined>): Promise<AuditHistoryData> {
  return getHistory('/api/reporting/audit-history', params);
}

export function getImportExportHistory(params: Record<string, string | undefined>): Promise<ImportExportHistoryData> {
  return getHistory('/api/reporting/import-export-history', params);
}
