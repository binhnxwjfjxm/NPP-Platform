import 'server-only';

import { randomUUID } from 'node:crypto';
import type {
  Customer,
  CustomerAddress,
  CustomerOnboardingRequestSummary,
  OverviewData,
} from './types';

const REQUEST_TIMEOUT_MS = 8_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ONBOARDING_STATUSES = new Set([
  'submitted',
  'under_review',
  'need_more_info',
  'approved',
  'linked_existing',
  'rejected',
  'cancelled',
]);

export class CoreApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CoreApiError';
  }
}

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối NPP Core chưa được cấu hình', 503, false);
  return value;
}

function baseUrl(): string {
  let url: URL;
  try {
    url = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối NPP Core chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối NPP Core chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối NPP Core phải dùng HTTPS', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function requestId(): string {
  return `admin_${randomUUID()}`;
}

function safePath(path: string): string {
  if (!path.startsWith('/api/') || path.includes('..') || /[\r\n]/.test(path)) {
    throw new CoreApiError('ADMIN_CORE_PATH_INVALID', 'Đường dữ liệu không hợp lệ', 400, false);
  }
  return path;
}

export async function requestCore<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${safePath(path)}`, {
      method: options.method ?? 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId(),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!payload) throw new CoreApiError('ADMIN_CORE_RESPONSE_INVALID', 'Phản hồi từ NPP Core không hợp lệ', 502, false);
    if (!response.ok) {
      throw new CoreApiError(
        payload.error?.code || 'ADMIN_CORE_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu tới NPP Core không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CoreApiError('ADMIN_CORE_RESPONSE_INVALID', 'Phản hồi từ NPP Core không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof CoreApiError) throw error;
    throw new CoreApiError('ADMIN_CORE_UNAVAILABLE', 'NPP Core tạm thời chưa sẵn sàng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOnboarding(value: unknown): value is CustomerOnboardingRequestSummary {
  if (!isRecord(value) || !ONBOARDING_STATUSES.has(String(value.status ?? ''))) return false;
  const customer = value.proposedCustomer;
  const address = isRecord(customer) ? customer.address : null;
  return isRecord(customer)
    && isRecord(address)
    && typeof value.id === 'string'
    && typeof value.sourceOutletId === 'string'
    && typeof value.sourceDemandReference === 'string'
    && Number.isInteger(value.version)
    && typeof value.updatedAt === 'string'
    && typeof customer.name === 'string'
    && typeof address.addressLine1 === 'string';
}

export async function listOnboarding(status: string, limit = 100, offset = 0): Promise<CustomerOnboardingRequestSummary[]> {
  if (!ONBOARDING_STATUSES.has(status)) return [];
  const query = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  const data = await requestCore<{ customerOnboardingRequests?: unknown }>(`/api/customer-onboarding-requests?${query}`);
  const rows = data.customerOnboardingRequests;
  if (!Array.isArray(rows) || !rows.every(isOnboarding)) {
    throw new CoreApiError('ADMIN_ONBOARDING_RESPONSE_INVALID', 'Danh sách đề nghị khách hàng không hợp lệ', 502, false);
  }
  return rows;
}

export async function loadPendingOnboarding(): Promise<CustomerOnboardingRequestSummary[]> {
  const statuses = ['submitted', 'under_review', 'need_more_info'];
  const results = await Promise.all(statuses.map((status) => listOnboarding(status)));
  const byId = new Map<string, CustomerOnboardingRequestSummary>();
  for (const rows of results) for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function listCustomers(): Promise<Customer[]> {
  const data = await requestCore<unknown[]>('/api/customers?active=true&limit=1000&offset=0');
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Customer => isRecord(row)
    && typeof row.id === 'string'
    && typeof row.code === 'string'
    && typeof row.name === 'string'
    && row.is_active === true);
}

export async function listCustomerAddresses(customerId: string): Promise<CustomerAddress[]> {
  if (!UUID_PATTERN.test(customerId)) throw new CoreApiError('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ', 400, false);
  const data = await requestCore<unknown[]>(`/api/customers/${customerId}/addresses`);
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is CustomerAddress => isRecord(row)
    && typeof row.id === 'string'
    && typeof row.label === 'string'
    && typeof row.address_line1 === 'string'
    && typeof row.is_active === 'boolean');
}

async function countActive(path: string): Promise<number> {
  const rows = await requestCore<unknown[]>(`${path}?active=true&limit=1000&offset=0`);
  return Array.isArray(rows)
    ? rows.filter((row) => !isRecord(row) || row.is_active !== false).length
    : 0;
}

export async function loadOverview(): Promise<OverviewData> {
  const warnings: string[] = [];
  const settled = await Promise.allSettled([
    countActive('/api/branches'),
    countActive('/api/warehouses'),
    countActive('/api/warehouse-locations'),
    requestCore<unknown[]>('/api/sales-orders?status=draft&limit=20&offset=0'),
    loadPendingOnboarding(),
  ]);
  const value = <T,>(index: number, fallback: T): T => {
    const result = settled[index];
    if (result.status === 'fulfilled') return result.value as T;
    warnings.push(['chi nhánh', 'kho', 'vị trí kho', 'đơn bán hàng nháp', 'đề nghị khách hàng'][index]);
    return fallback;
  };
  return {
    branches: value<number | null>(0, null),
    warehouses: value<number | null>(1, null),
    locations: value<number | null>(2, null),
    draftOrders: value<unknown[]>(3, []),
    onboarding: value<CustomerOnboardingRequestSummary[]>(4, []),
    warnings,
  };
}
