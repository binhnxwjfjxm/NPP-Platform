import { createIdempotencyKey } from '@npp/contracts';
import { formatExactDecimal } from '../../../lib/decimal-display.js';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';

export const collectionLabels: Record<string, string> = {
  PREPAID: 'Đã trả trước',
  COLLECT_ON_DELIVERY: 'Thu khi giao',
  COLLECT_AFTER_DELIVERY: 'Giao trước, chuyển khoản sau',
  CREDIT_TERMS: 'Bán chịu theo hạn mức',
};

export const orderLabels: Record<string, string> = {
  draft: 'Nháp', confirmed: 'Đã xác nhận', cancelled: 'Đã hủy', closed: 'Đã hoàn tất',
};

export const fulfillmentLabels: Record<string, string> = {
  unallocated: 'Chưa tạo nhu cầu giữ hàng',
  backordered: 'Đang chờ hàng',
  partially_reserved: 'Đã giữ một phần',
  reserved: 'Đã giữ đủ hàng',
  partially_allocated: 'Phân bổ một phần',
  allocated: 'Đã phân bổ',
  partially_fulfilled: 'Thực hiện một phần',
  fulfilled: 'Đã thực hiện',
  cancelled: 'Đã hủy',
};

export const deliveryLabels: Record<string, string> = {
  not_required: 'Khách nhận tại kho',
  pending: 'Chờ chuẩn bị giao',
  ready_to_dispatch: 'Sẵn sàng xuất phát',
  dispatched: 'Đang giao',
  partially_delivered: 'Đã giao một phần',
  delivered: 'Đã giao',
  failed: 'Giao không thành công',
  rescheduled: 'Đã hẹn lại',
  returned: 'Đã trả hàng',
  cancelled: 'Đã hủy',
};

export const settlementLabels: Record<string, string> = {
  not_due: 'Chưa đến bước thu tiền',
  pending: 'Chờ thanh toán',
  partially_paid: 'Đã thanh toán một phần',
  paid: 'Đã thanh toán',
  overpaid: 'Thanh toán thừa',
  refunded: 'Đã hoàn tiền',
  written_off: 'Đã xử lý xóa nợ',
};

export type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export class SalesOrderUiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details: unknown = {},
    public readonly statusCode = 0,
  ) {
    super(message);
    this.name = 'SalesOrderUiError';
  }
}

function methodOf(init: RequestInit): string {
  return String(init.method ?? 'GET').toUpperCase();
}

function isDraftSave(path: string, method: string): boolean {
  if (method === 'POST' && path === '/api/sales-orders') return true;
  if (method !== 'PUT') return false;
  return /^\/api\/sales-orders\/[^/]+\/draft$/.test(path)
    || /^\/api\/sales-orders\/[^/]+\/amendments\/[^/]+\/draft$/.test(path)
    || /^\/api\/sales-orders\/[^/]+\/manual-edit$/.test(path);
}

function isConfirm(path: string, method: string): boolean {
  if (method !== 'POST') return false;
  return /^\/api\/sales-orders\/[^/]+\/confirm$/.test(path)
    || /^\/api\/sales-orders\/[^/]+\/amendments\/[^/]+\/confirm$/.test(path);
}

function withMissingBasePricePreview(path: string, init: RequestInit): RequestInit {
  if (path !== '/api/pricing/resolve' || methodOf(init) !== 'POST' || typeof init.body !== 'string') {
    return init;
  }
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ...init,
      body: JSON.stringify({ ...body, allowMissingBasePrice: true }),
    };
  } catch {
    return init;
  }
}

function validateDraftDiscountIntent(path: string, init: RequestInit): void {
  if (!isDraftSave(path, methodOf(init)) || typeof init.body !== 'string') return;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return;
  }
  const mode = String(body.documentDiscountMode ?? 'NONE').trim().toUpperCase();
  const value = String(body.documentDiscountValue ?? '0').trim();
  const positive = mode !== 'NONE'
    && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)
    && /[1-9]/.test(value);
  if (positive && !String(body.documentDiscountReason ?? '').trim()) {
    throw new SalesOrderUiError(
      'DOCUMENT_DISCOUNT_REASON_REQUIRED',
      'Chiết khấu bổ sung toàn đơn cần lý do',
    );
  }
}

export function draftRecoveryTarget(
  order: SalesOrder,
  amendmentVersionNumber?: string | null,
): Readonly<{ path: string; expectedRevision: string }> | null {
  const draft = pendingVersion(order);
  if (!draft) return null;
  return Object.freeze({
    path: amendmentVersionNumber
      ? `/api/sales-orders/${order.id}/amendments/${amendmentVersionNumber}/draft`
      : `/api/sales-orders/${order.id}/draft`,
    expectedRevision: draft.revision,
  });
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  validateDraftDiscountIntent(path, init);
  const requestInit = withMissingBasePricePreview(path, init);
  const requestMethod = methodOf(requestInit);
  const response = await fetch(path, {
    ...requestInit,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(requestInit.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...Object.fromEntries(new Headers(requestInit.headers ?? {}).entries()),
    },
  });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  const previewState = path === '/api/pricing/resolve'
    && response.ok
    && payload?.data
    && typeof payload.data === 'object'
    && (payload.data as { resolutionStatus?: string }).resolutionStatus === 'MANUAL_PRICE_REQUIRED'
    ? payload.data as { code?: string; message?: string }
    : null;
  if (previewState) {
    throw new SalesOrderUiError(
      previewState.code ?? 'BASE_PRICE_NOT_FOUND',
      previewState.message ?? 'Chưa có giá Công Ty. Nhập giá bán cho dòng này để tiếp tục.',
      false,
      { manualPriceRequired: true },
      response.status,
    );
  }
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    const code = payload?.error?.code ?? 'SALES_ORDER_REQUEST_FAILED';
    const priceChangedConfirm = code === 'SALES_PRICE_CHANGED' && isConfirm(path, requestMethod);
    const message = code === 'IDEMPOTENCY_PAYLOAD_MISMATCH'
      ? 'Nội dung đơn đã thay đổi. Hãy lưu lại để hệ thống tạo yêu cầu mới.'
      : payload?.error?.message ?? 'Yêu cầu bán hàng không thành công';
    throw new SalesOrderUiError(
      code,
      message,
      payload?.error?.retryable === true || response.status >= 500 || priceChangedConfirm,
      payload?.error?.details ?? {},
      response.status,
    );
  }
  return payload.data as T;
}

export function mutationKey(prefix: string): string {
  return createIdempotencyKey(prefix);
}

export function deliveryMethodLabel(value: {
  deliveryMode: string;
  deliveryExecutionMode?: string | null;
}): string {
  if (value.deliveryMode === 'PICKUP') return 'Khách nhận tại kho';
  return value.deliveryExecutionMode === 'MANUAL' ? 'Giao thủ công' : 'Giao theo chuyến';
}

export function formatMoney(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(parsed)
    : String(value ?? '0');
}

export function formatQuantity(value: string | null | undefined): string {
  return formatExactDecimal(value);
}

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatVietnamDateTime(value: string | null | undefined): string {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) return '—';
  const local = new Date(parsed.getTime() + VIETNAM_UTC_OFFSET_MS);
  return `${pad2(local.getUTCDate())}/${pad2(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
}

export function activeVersion(order: SalesOrder | null): SalesOrderVersion | null {
  if (!order?.versions?.length) return null;
  return order.versions.find((item) => item.versionNumber === order.currentVersionNumber)
    ?? order.versions[0]
    ?? null;
}

export function pendingVersion(order: SalesOrder | null): SalesOrderVersion | null {
  return order?.versions?.find((item) => item.status === 'draft') ?? null;
}
