import 'server-only';
import { randomUUID } from 'node:crypto';
import { requireNppWorkforceSessionToken } from './internal-auth-client';
import type { Customer } from './customer-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PERIODS = new Set(['30d', '90d', '365d', 'all']);
const REQUEST_TIMEOUT_MS = 8_000;

type CoreEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean } };

export type CustomerProfilePeriod = '30d' | '90d' | '365d' | 'all';
export type CustomerSalesSummary = Readonly<{
  period: CustomerProfilePeriod;
  currencyCode: 'VND';
  revenue: string;
  orderCount: string;
  lastPurchaseAt: string | null;
}>;
export type CustomerReceivableSummary = Readonly<{
  currencyCode: 'VND';
  balance: string;
  openAmount: string;
  openDocumentCount: string;
  updatedAt: string | null;
}>;
export type CustomerProfileOverview = Readonly<{
  customer: Customer;
  period: CustomerProfilePeriod;
  sales: CustomerSalesSummary | null;
  receivable: CustomerReceivableSummary | null;
  permissions: Readonly<{ sales: boolean; receivable: boolean }>;
}>;
export type CustomerPurchasedItem = Readonly<{
  variantId: string;
  sku: string;
  productName: string;
  unitCode: string;
  totalQuantity: string;
  revenue: string;
  purchaseCount: string;
  lastUnitPrice: string;
  lastPurchaseAt: string | null;
}>;
export type CustomerPurchasedItemsPage = Readonly<{
  period: CustomerProfilePeriod;
  currencyCode: 'VND';
  search: string;
  limit: number;
  offset: number;
  total: string;
  items: readonly CustomerPurchasedItem[];
}>;

export class CustomerProfileGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(publicMessage);
    this.name = 'CustomerProfileGatewayError';
  }
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new CustomerProfileGatewayError('CUSTOMER_PROFILE_NOT_CONFIGURED', 'Hồ sơ khách hàng chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new CustomerProfileGatewayError('CUSTOMER_PROFILE_NOT_CONFIGURED', 'Hồ sơ khách hàng chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new CustomerProfileGatewayError('CUSTOMER_PROFILE_NOT_CONFIGURED', 'Hồ sơ khách hàng chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function resolveCustomerProfileRequestId(value?: string | null) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export function normalizeCustomerProfilePeriod(value?: string | null): CustomerProfilePeriod {
  const normalized = String(value ?? '90d').trim().toLowerCase();
  return PERIODS.has(normalized) ? normalized as CustomerProfilePeriod : '90d';
}

function validateCustomerId(customerId: string) {
  const id = customerId.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new CustomerProfileGatewayError('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ', 400, false);
  }
  return id;
}

async function getCustomerProfileData<T>(path: string, requestId: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    const payload = await response.json().catch(() => ({})) as CoreEnvelope<T>;
    if (!response.ok || payload.data === undefined) {
      throw new CustomerProfileGatewayError(
        payload.error?.code || 'CUSTOMER_PROFILE_REQUEST_FAILED',
        payload.error?.message || 'Không tải được hồ sơ khách hàng',
        response.status,
        payload.error?.retryable === true,
      );
    }
    return payload.data;
  } catch (error) {
    if (error instanceof CustomerProfileGatewayError) throw error;
    throw new CustomerProfileGatewayError('CUSTOMER_PROFILE_UNAVAILABLE', 'Hồ sơ khách hàng tạm thời chưa khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCustomerProfileOverview(
  customerId: string,
  requestId: string,
  period: CustomerProfilePeriod = '90d',
): Promise<CustomerProfileOverview> {
  const id = validateCustomerId(customerId);
  return getCustomerProfileData<CustomerProfileOverview>(
    `/api/customers/${id}/overview?period=${encodeURIComponent(period)}`,
    requestId,
  );
}

export async function getCustomerPurchasedItems(
  customerId: string,
  requestId: string,
  options: Readonly<{
    period?: CustomerProfilePeriod;
    search?: string;
    limit?: number;
    offset?: number;
  }> = {},
): Promise<CustomerPurchasedItemsPage> {
  const id = validateCustomerId(customerId);
  const query = new URLSearchParams({
    period: options.period ?? '90d',
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  const search = String(options.search ?? '').trim();
  if (search) query.set('search', search);
  return getCustomerProfileData<CustomerPurchasedItemsPage>(
    `/api/customers/${id}/purchased-items?${query.toString()}`,
    requestId,
  );
}
