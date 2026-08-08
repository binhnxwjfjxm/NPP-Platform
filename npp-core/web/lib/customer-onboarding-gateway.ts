import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_STATUSES = new Set([
  'submitted',
  'under_review',
  'need_more_info',
  'approved',
  'linked_existing',
  'rejected',
  'cancelled',
]);
const ALLOWED_SOURCE_SYSTEMS = new Set(['MCP', 'CUSTOMER_PORTAL']);
const ALLOWED_ACTIONS = new Set([
  'review',
  'need-more-info',
  'approve',
  'link-existing',
  'reject',
  'cancel',
]);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export type CustomerOnboardingAction =
  | 'review'
  | 'need-more-info'
  | 'approve'
  | 'link-existing'
  | 'reject'
  | 'cancel';

export type CustomerOnboardingRequestSummary = {
  id: string;
  status: string;
  sourceSystem: 'MCP' | 'CUSTOMER_PORTAL';
  sourceOutletId: string;
  sourceDemandReference: string;
  proposedCustomer: {
    name: string;
    phone: string | null;
    address: {
      addressLine1: string;
      addressLine2: string | null;
      ward: string | null;
      district: string | null;
      province: string | null;
      postalCode: string | null;
      countryCode: string;
      label: string;
    };
  };
  reviewReason: string | null;
  approvedCustomerId: string | null;
  approvedCustomerAddressId: string | null;
  version: number;
  submittedAt: string;
  updatedAt: string;
};

export type CustomerPortalActivationOption = {
  id: string;
  code: string;
  name: string;
};

export type CustomerPortalActivationOptions = {
  warehouses: CustomerPortalActivationOption[];
  salesChannels: CustomerPortalActivationOption[];
};

export class CustomerOnboardingGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'CustomerOnboardingGatewayError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isCustomerOnboardingRequestSummary(value: unknown): value is CustomerOnboardingRequestSummary {
  if (!isRecord(value) || !ALLOWED_STATUSES.has(String(value.status ?? ''))) return false;
  if (!ALLOWED_SOURCE_SYSTEMS.has(String(value.sourceSystem ?? ''))) return false;
  const proposedCustomer = value.proposedCustomer;
  if (!isRecord(proposedCustomer)) return false;
  const address = proposedCustomer.address;
  if (!isRecord(address)) return false;
  return typeof value.id === 'string'
    && typeof value.sourceOutletId === 'string'
    && typeof value.sourceDemandReference === 'string'
    && typeof value.submittedAt === 'string'
    && typeof value.updatedAt === 'string'
    && isPositiveInteger(value.version)
    && isNullableString(value.reviewReason)
    && isNullableString(value.approvedCustomerId)
    && isNullableString(value.approvedCustomerAddressId)
    && typeof proposedCustomer.name === 'string'
    && isNullableString(proposedCustomer.phone)
    && typeof address.addressLine1 === 'string'
    && isNullableString(address.addressLine2)
    && isNullableString(address.ward)
    && isNullableString(address.district)
    && isNullableString(address.province)
    && isNullableString(address.postalCode)
    && typeof address.countryCode === 'string'
    && typeof address.label === 'string';
}

function isPortalActivationOption(value: unknown): value is CustomerPortalActivationOption {
  return isRecord(value)
    && typeof value.id === 'string'
    && UUID_PATTERN.test(value.id)
    && typeof value.code === 'string'
    && typeof value.name === 'string';
}

export function normalizeCustomerOnboardingGatewayError(error: unknown): CustomerOnboardingGatewayError {
  if (error instanceof CustomerOnboardingGatewayError) return error;
  return new CustomerOnboardingGatewayError(
    'CUSTOMER_ONBOARDING_GATEWAY_UNAVAILABLE',
    'Dữ liệu xác minh khách hàng tạm thời chưa sẵn sàng',
    503,
    true,
  );
}

function requiredServerValue(name: 'CORE_API_INTERNAL_URL' | 'CORE_API_SERVER_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_NOT_CONFIGURED',
      'Dữ liệu xác minh khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  return value;
}

function coreApiBaseUrl(): string {
  const raw = requiredServerValue('CORE_API_INTERNAL_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_NOT_CONFIGURED',
      'Dữ liệu xác minh khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_NOT_CONFIGURED',
      'Dữ liệu xác minh khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_NOT_CONFIGURED',
      'Dữ liệu xác minh khách hàng chưa được cấu hình',
      503,
      false,
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertUuid(value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new CustomerOnboardingGatewayError(
      'INVALID_CUSTOMER_ONBOARDING_ID',
      'Mã đề nghị xác minh khách hàng không hợp lệ',
      400,
      false,
    );
  }
  return normalized;
}

function assertAction(value: string): CustomerOnboardingAction {
  if (!ALLOWED_ACTIONS.has(value)) {
    throw new CustomerOnboardingGatewayError(
      'INVALID_CUSTOMER_ONBOARDING_ACTION',
      'Thao tác xác minh khách hàng không hợp lệ',
      400,
      false,
    );
  }
  return value as CustomerOnboardingAction;
}

async function requestCore<T>({
  method,
  path,
  requestId,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST';
  path: string;
  requestId: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) {
      throw new CustomerOnboardingGatewayError(
        'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
        'Phản hồi xác minh khách hàng không hợp lệ',
        502,
        false,
      );
    }
    if (!response.ok) {
      throw new CustomerOnboardingGatewayError(
        payload.error?.code || 'CUSTOMER_ONBOARDING_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu xác minh khách hàng không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new CustomerOnboardingGatewayError(
        'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
        'Phản hồi xác minh khách hàng không hợp lệ',
        502,
        false,
      );
    }
    return payload.data as T;
  } catch (error) {
    throw normalizeCustomerOnboardingGatewayError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveCustomerOnboardingRequestId(value?: string | null): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export async function listCustomerOnboardingRequests({
  requestId,
  status,
  limit = 20,
  offset = 0,
}: {
  requestId: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<CustomerOnboardingRequestSummary[]> {
  const query = new URLSearchParams();
  query.set('limit', String(Math.max(1, Math.min(100, Math.trunc(limit)))));
  query.set('offset', String(Math.max(0, Math.trunc(offset))));
  if (status) {
    if (!ALLOWED_STATUSES.has(status)) {
      throw new CustomerOnboardingGatewayError(
        'CUSTOMER_ONBOARDING_INVALID_STATUS',
        'Trạng thái xác minh khách hàng không hợp lệ',
        400,
        false,
      );
    }
    query.set('status', status);
  }
  const data = await requestCore<{ customerOnboardingRequests: unknown }>({
    method: 'GET',
    path: `/api/customer-onboarding-requests?${query}`,
    requestId,
  });
  const requests = data.customerOnboardingRequests;
  if (!Array.isArray(requests) || !requests.every(isCustomerOnboardingRequestSummary)) {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
      'Phản hồi xác minh khách hàng không hợp lệ',
      502,
      false,
    );
  }
  return requests;
}

export async function getCustomerOnboardingPortalOptions(
  requestId: string,
): Promise<CustomerPortalActivationOptions> {
  const data = await requestCore<{ warehouses: unknown; salesChannels: unknown }>({
    method: 'GET',
    path: '/api/customer-onboarding-portal-options',
    requestId,
  });
  if (!Array.isArray(data.warehouses)
    || !data.warehouses.every(isPortalActivationOption)
    || !Array.isArray(data.salesChannels)
    || !data.salesChannels.every(isPortalActivationOption)) {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
      'Phản hồi cấu hình Customer Portal không hợp lệ',
      502,
      false,
    );
  }
  return { warehouses: data.warehouses, salesChannels: data.salesChannels };
}

export async function getCustomerOnboardingRequest(
  id: string,
  requestId: string,
): Promise<CustomerOnboardingRequestSummary> {
  const data = await requestCore<{ customerOnboardingRequest: unknown }>({
    method: 'GET',
    path: `/api/customer-onboarding-requests/${assertUuid(id)}`,
    requestId,
  });
  if (!isCustomerOnboardingRequestSummary(data.customerOnboardingRequest)) {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
      'Phản hồi xác minh khách hàng không hợp lệ',
      502,
      false,
    );
  }
  return data.customerOnboardingRequest;
}

export async function mutateCustomerOnboardingRequest({
  id,
  action,
  requestId,
  body,
  idempotencyKey,
}: {
  id: string;
  action: string;
  requestId: string;
  body: unknown;
  idempotencyKey?: string;
}): Promise<CustomerOnboardingRequestSummary> {
  const data = await requestCore<{ customerOnboardingRequest: unknown }>({
    method: 'POST',
    path: `/api/customer-onboarding-requests/${assertUuid(id)}/${assertAction(action)}`,
    requestId,
    body,
    idempotencyKey: idempotencyKey?.trim() || `web-${randomUUID()}`,
  });
  if (!isCustomerOnboardingRequestSummary(data.customerOnboardingRequest)) {
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
      'Phản hồi xác minh khách hàng không hợp lệ',
      502,
      false,
    );
  }
  return data.customerOnboardingRequest;
}
