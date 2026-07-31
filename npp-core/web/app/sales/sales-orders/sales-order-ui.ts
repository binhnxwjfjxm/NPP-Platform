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
  unallocated: 'Chưa phân bổ hàng',
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
  ) {
    super(message);
    this.name = 'SalesOrderUiError';
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new SalesOrderUiError(
      payload?.error?.code ?? 'SALES_ORDER_REQUEST_FAILED',
      payload?.error?.message ?? 'Yêu cầu bán hàng không thành công',
      payload?.error?.retryable === true,
      payload?.error?.details ?? {},
    );
  }
  return payload.data as T;
}

export function mutationKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function formatMoney(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(parsed)
    : String(value ?? '0');
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
