import 'server-only';

import { requireNppWorkforceSessionToken } from './internal-auth-client';
import { InventoryGatewayError, resolveInventoryRequestId } from './inventory-gateway';
import type { InventoryTrackingPolicyCandidate } from './inventory-policy-types';

export type { InventoryTrackingPolicyCandidate } from './inventory-policy-types';

type CoreEnvelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
};

function coreBaseUrl(): string {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new InventoryGatewayError('INVENTORY_GATEWAY_NOT_CONFIGURED', 'Cổng tồn kho chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export async function listInventoryTrackingPolicyCandidates(
  requestId = resolveInventoryRequestId(undefined),
): Promise<InventoryTrackingPolicyCandidate[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${coreBaseUrl()}/api/inventory/tracking-policies/candidates?limit=2000`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': requestId,
      },
    });
    let payload: CoreEnvelope<InventoryTrackingPolicyCandidate[]>;
    try {
      payload = await response.json() as CoreEnvelope<InventoryTrackingPolicyCandidate[]>;
    } catch {
      throw new InventoryGatewayError('INVENTORY_GATEWAY_RESPONSE_INVALID', 'Phản hồi danh sách SKU không hợp lệ', 502, false);
    }
    if (!response.ok) {
      throw new InventoryGatewayError(
        payload.error?.code || 'INVENTORY_REQUEST_FAILED',
        payload.error?.message || 'Không tải được danh sách SKU',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Array.isArray(payload.data)) {
      throw new InventoryGatewayError('INVENTORY_GATEWAY_RESPONSE_INVALID', 'Phản hồi danh sách SKU không hợp lệ', 502, false);
    }
    return payload.data;
  } catch (error) {
    if (error instanceof InventoryGatewayError) throw error;
    throw new InventoryGatewayError('INVENTORY_GATEWAY_UNAVAILABLE', 'Cổng tồn kho tạm thời không khả dụng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}
