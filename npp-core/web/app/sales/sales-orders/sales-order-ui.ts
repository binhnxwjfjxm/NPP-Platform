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

type DraftRecovery = Readonly<{ order: SalesOrder }>;

let lastSavedDraft: DraftRecovery | null = null;
let draftRecovery: DraftRecovery | null = null;

function methodOf(init: RequestInit): string {
  return String(init.method ?? 'GET').toUpperCase();
}

function isEntrySettings(path: string, method: string): boolean {
  return method === 'GET' && path === '/api/sales-orders/entry-settings';
}

function isDraftSave(path: string, method: string): boolean {
  if (method === 'POST' && path === '/api/sales-orders') return true;
  if (method !== 'PUT') return false;
  return /^\/api\/sales-orders\/[^/]+\/draft$/.test(path)
    || /^\/api\/sales-orders\/[^/]+\/amendments\/[^/]+\/draft$/.test(path);
}

function isConfirm(path: string, method: string): boolean {
  if (method !== 'POST') return false;
  return /^\/api\/sales-orders\/[^/]+\/confirm$/.test(path)
    || /^\/api\/sales-orders\/[^/]+\/amendments\/[^/]+\/confirm$/.test(path);
}

function orderIdFromPath(path: string): string | null {
  return /^\/api\/sales-orders\/([^/]+)/.exec(path)?.[1] ?? null;
}

function isSalesOrder(value: unknown): value is SalesOrder {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as SalesOrder).id === 'string'
    && Array.isArray((value as SalesOrder).versions);
}

function resetDraftRecovery(): void {
  lastSavedDraft = null;
  draftRecovery = null;
}

function recoverCommittedDraft(path: string, init: RequestInit): {
  path: string;
  init: RequestInit;
  recovered: boolean;
} {
  if (!draftRecovery || !isDraftSave(path, methodOf(init))) {
    return { path, init, recovered: false };
  }
  const draft = pendingVersion(draftRecovery.order);
  if (!draft || typeof init.body !== 'string') {
    return { path, init, recovered: false };
  }
  const currentOrderId = orderIdFromPath(path);
  if (currentOrderId && currentOrderId !== draftRecovery.order.id) {
    return { path, init, recovered: false };
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return { path, init, recovered: false };
  }
  const recoveredPath = path === '/api/sales-orders'
    ? `/api/sales-orders/${draftRecovery.order.id}/draft`
    : path;
  return {
    path: recoveredPath,
    init: {
      ...init,
      method: 'PUT',
      body: JSON.stringify({ ...body, expectedRevision: draft.revision }),
    },
    recovered: true,
  };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const initialMethod = methodOf(init);
  if (isEntrySettings(path, initialMethod)) resetDraftRecovery();

  const request = recoverCommittedDraft(path, init);
  const requestMethod = methodOf(request.init);
  const response = await fetch(request.path, {
    ...request.init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(request.init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(request.init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    const code = payload?.error?.code ?? 'SALES_ORDER_REQUEST_FAILED';
    if (code === 'SALES_PRICE_CHANGED' && isConfirm(request.path, requestMethod) && lastSavedDraft) {
      const confirmedOrderId = orderIdFromPath(request.path);
      if (confirmedOrderId === lastSavedDraft.order.id) draftRecovery = lastSavedDraft;
    }
    throw new SalesOrderUiError(
      code,
      payload?.error?.message ?? 'Yêu cầu bán hàng không thành công',
      payload?.error?.retryable === true,
      payload?.error?.details ?? {},
    );
  }

  const data = payload.data as T;
  if (isDraftSave(request.path, requestMethod) && isSalesOrder(data)) {
    lastSavedDraft = { order: data };
    if (request.recovered) draftRecovery = lastSavedDraft;
  }
  if (isConfirm(request.path, requestMethod)) resetDraftRecovery();
  return data;
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
