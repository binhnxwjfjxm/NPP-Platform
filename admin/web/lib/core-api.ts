import 'server-only';

import { randomUUID } from 'node:crypto';
import type {
  Customer,
  CustomerAddress,
  CustomerOnboardingRequestSummary,
  OverviewData,
} from './types';
import { readAdminSessionToken } from './internal-auth-client';

const REQUEST_TIMEOUT_MS = 8_000;
const ONBOARDING_PAGE_SIZE = 100;
const CUSTOMER_PAGE_SIZE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ONBOARDING_STATUSES = new Set([
  'submitted', 'under_review', 'need_more_info', 'approved', 'linked_existing', 'rejected', 'cancelled',
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

function requiredServerValue(name: 'CORE_API_INTERNAL_URL'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối với hệ thống Công Ty chưa được cấu hình', 503, false);
  return value;
}

function baseUrl(): string {
  let url: URL;
  try {
    url = new URL(requiredServerValue('CORE_API_INTERNAL_URL'));
  } catch {
    throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối với hệ thống Công Ty chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối với hệ thống Công Ty chưa được cấu hình', 503, false);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new CoreApiError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối an toàn với hệ thống Công Ty chưa sẵn sàng', 503, false);
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

function employeeSessionToken(): string {
  const token = readAdminSessionToken();
  if (!token) throw new CoreApiError('UNAUTHORIZED', 'Cần đăng nhập', 401, false);
  return token;
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
        Authorization: `Bearer ${employeeSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId(),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!payload) throw new CoreApiError('ADMIN_CORE_RESPONSE_INVALID', 'Phản hồi từ hệ thống Công Ty không hợp lệ', 502, false);
    if (!response.ok) {
      throw new CoreApiError(
        payload.error?.code || 'ADMIN_CORE_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu tới hệ thống Công Ty không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CoreApiError('ADMIN_CORE_RESPONSE_INVALID', 'Phản hồi từ hệ thống Công Ty không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof CoreApiError) throw error;
    throw new CoreApiError('ADMIN_CORE_UNAVAILABLE', 'Hệ thống Công Ty tạm thời chưa sẵn sàng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
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
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && value.version >= 1
    && typeof value.submittedAt === 'string'
    && typeof value.updatedAt === 'string'
    && isNullableString(value.reviewReason)
    && isNullableString(value.approvedCustomerId)
    && isNullableString(value.approvedCustomerAddressId)
    && typeof customer.name === 'string'
    && isNullableString(customer.phone)
    && typeof address.addressLine1 === 'string'
    && isNullableString(address.addressLine2)
    && isNullableString(address.ward)
    && isNullableString(address.district)
    && isNullableString(address.province)
    && isNullableString(address.postalCode)
    && typeof address.countryCode === 'string'
    && typeof address.label === 'string';
}

export async function listOnboarding(status: string, limit = ONBOARDING_PAGE_SIZE, offset = 0): Promise<CustomerOnboardingRequestSummary[]> {
  if (!ONBOARDING_STATUSES.has(status)) return [];
  const query = new URLSearchParams({
    status,
    limit: String(Math.max(1, Math.min(ONBOARDING_PAGE_SIZE, Math.trunc(limit)))),
    offset: String(Math.max(0, Math.trunc(offset))),
  });
  const data = await requestCore<{ customerOnboardingRequests?: unknown }>(`/api/customer-onboarding-requests?${query}`);
  const rows = data.customerOnboardingRequests;
  if (!Array.isArray(rows) || !rows.every(isOnboarding)) {
    throw new CoreApiError('ADMIN_ONBOARDING_RESPONSE_INVALID', 'Danh sách đề nghị khách hàng không hợp lệ', 502, false);
  }
  return rows;
}

async function loadAllOnboardingForStatus(status: string): Promise<CustomerOnboardingRequestSummary[]> {
  const rows: CustomerOnboardingRequestSummary[] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (true) {
    const batch = await listOnboarding(status, ONBOARDING_PAGE_SIZE, offset);
    let added = 0;
    for (const item of batch) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(item);
      added += 1;
    }
    if (batch.length < ONBOARDING_PAGE_SIZE || added === 0) break;
    offset += ONBOARDING_PAGE_SIZE;
  }
  return rows;
}

export async function loadPendingOnboarding(): Promise<CustomerOnboardingRequestSummary[]> {
  const statuses = ['submitted', 'under_review', 'need_more_info'];
  const results = await Promise.all(statuses.map(loadAllOnboardingForStatus));
  const byId = new Map<string, CustomerOnboardingRequestSummary>();
  for (const rows of results) for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function normalizeCustomer(row: unknown): Customer | null {
  if (!isRecord(row)
    || typeof row.id !== 'string'
    || typeof row.code !== 'string'
    || typeof row.name !== 'string'
    || row.is_active !== true) return null;
  return { id: row.id, code: row.code, name: row.name, is_active: true };
}

export async function listCustomers(): Promise<Customer[]> {
  const customers: Customer[] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (true) {
    const batch = await requestCore<unknown[]>(`/api/customers?active=true&limit=${CUSTOMER_PAGE_SIZE}&offset=${offset}`);
    if (!Array.isArray(batch)) throw new CoreApiError('ADMIN_CUSTOMER_RESPONSE_INVALID', 'Danh sách khách hàng không hợp lệ', 502, false);
    let added = 0;
    for (const row of batch) {
      const customer = normalizeCustomer(row);
      if (!customer || seen.has(customer.id)) continue;
      seen.add(customer.id);
      customers.push(customer);
      added += 1;
    }
    if (batch.length < CUSTOMER_PAGE_SIZE || added === 0) break;
    offset += CUSTOMER_PAGE_SIZE;
  }
  return customers;
}

export async function listCustomerAddresses(customerId: string): Promise<CustomerAddress[]> {
  if (!UUID_PATTERN.test(customerId)) throw new CoreApiError('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ', 400, false);
  const data = await requestCore<unknown[]>(`/api/customers/${customerId}/addresses`);
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!isRecord(row)
      || typeof row.id !== 'string'
      || typeof row.label !== 'string'
      || typeof row.address_line1 !== 'string'
      || typeof row.is_active !== 'boolean'
      || !isNullableString(row.ward)
      || !isNullableString(row.district)
      || !isNullableString(row.province)) return [];
    return [{
      id: row.id,
      label: row.label,
      address_line1: row.address_line1,
      ward: row.ward,
      district: row.district,
      province: row.province,
      is_active: row.is_active,
    } satisfies CustomerAddress];
  });
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
  const labels = ['chi nhánh', 'kho', 'vị trí kho', 'đơn bán hàng nháp', 'đề nghị khách hàng'];
  const value = <T,>(index: number, fallback: T): T => {
    const result = settled[index];
    if (result.status === 'fulfilled') return result.value as T;
    warnings.push(labels[index] || 'dữ liệu');
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
