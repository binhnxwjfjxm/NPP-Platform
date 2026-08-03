import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
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

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

export type CustomerOnboardingRequestSummary = {
  id: string;
  status: string;
  sourceOutletId: string;
  sourceDemandReference: string;
  proposedCustomer: {
    name: string;
    phone: string | null;
    address: {
      addressLine1: string;
      ward: string | null;
      district: string | null;
      province: string | null;
    };
  };
  submittedAt: string;
  updatedAt: string;
};

export class CustomerOnboardingGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(publicMessage);
    this.name = 'CustomerOnboardingGatewayError';
  }
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

export function resolveCustomerOnboardingRequestId(value?: string | null): string {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export async function listCustomerOnboardingRequests({
  requestId,
  status,
  limit = 20,
}: {
  requestId: string;
  status?: string;
  limit?: number;
}): Promise<CustomerOnboardingRequestSummary[]> {
  const query = new URLSearchParams();
  query.set('limit', String(Math.max(1, Math.min(100, Math.trunc(limit)))));
  if (status && ALLOWED_STATUSES.has(status)) query.set('status', status);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${coreApiBaseUrl()}/api/customer-onboarding-requests?${query}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requiredServerValue('CORE_API_SERVER_TOKEN')}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<{
      customerOnboardingRequests: CustomerOnboardingRequestSummary[];
    }> | null;
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
        payload.error?.message || 'Không tải được đề nghị xác minh khách hàng',
        response.status,
        payload.error?.retryable === true,
      );
    }
    const requests = payload.data?.customerOnboardingRequests;
    if (!Array.isArray(requests)) {
      throw new CustomerOnboardingGatewayError(
        'CUSTOMER_ONBOARDING_GATEWAY_RESPONSE_INVALID',
        'Phản hồi xác minh khách hàng không hợp lệ',
        502,
        false,
      );
    }
    return requests;
  } catch (error) {
    if (error instanceof CustomerOnboardingGatewayError) throw error;
    throw new CustomerOnboardingGatewayError(
      'CUSTOMER_ONBOARDING_GATEWAY_UNAVAILABLE',
      'Dữ liệu xác minh khách hàng tạm thời chưa sẵn sàng',
      503,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
