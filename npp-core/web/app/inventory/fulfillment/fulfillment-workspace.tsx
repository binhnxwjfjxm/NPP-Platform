'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './fulfillment-workspace.module.css';

type WorkItem = {
  fulfillmentDemandId: string;
  salesOrderId: string;
  salesOrderVersionId: string;
  salesOrderLineId: string;
  orderNumber: string | null;
  orderSubtotal: string | null;
  orderDiscountTotal: string | null;
  orderTaxTotal: string | null;
  orderTotal: string | null;
  salesChannelCode: string | null;
  salesChannelName: string | null;
  fulfillmentStatus: string;
  requestedDeliveryDate: string | null;
  sourceType: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  lineNumber: number;
  itemName: string;
  sku: string;
  unitCode: string;
  orderedQuantity: string;
  orderedUnitCode: string;
  baseUnitCode: string;
  baseVariantId: string;
  orderedBaseQuantity: string;
  reservedBaseQuantity: string;
  backorderedBaseQuantity: string;
  allocatedBaseQuantity: string;
  unallocatedBaseQuantity: string;
  warehouseOnHandBaseQuantity: string;
  warehouseHeldByOthersBaseQuantity: string;
  warehouseAvailableBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  allocationCount: number;
};

type Candidate = {
  rank: number;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  firstReceivedAt: string | null;
  availableBaseQuantity: string;
  allocationPolicy: 'FEFO' | 'FIFO';
};

type Allocation = {
  id: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  allocationPolicy: 'FEFO' | 'FIFO' | 'MANUAL';
  manualOverrideReason: string | null;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  state: 'ACTIVE' | 'COMPLETED';
};

type SuggestionDetail = {
  remainingBaseQuantity: string;
  heldRemainingBaseQuantity: string;
  warehouseOnHandBaseQuantity: string;
  warehouseHeldByOthersBaseQuantity: string;
  warehouseAvailableBaseQuantity: string;
  candidates: Candidate[];
  suggestedPlan: Array<{
    locationId: string | null;
    lotId: string | null;
    allocationPolicy: 'FEFO' | 'FIFO';
    policyRank: number;
    quantity: string;
  }>;
  allocations: Allocation[];
};

type OrderAllocationLineResult = {
  fulfillmentDemandId: string;
  salesOrderLineId: string;
  lineNumber: number;
  sku: string;
  itemName: string;
  unitCode: string;
  orderedBaseQuantity: string;
  reservedBaseQuantity: string;
  allocatedBaseQuantity: string;
  remainingToAllocateBaseQuantity: string;
  shortageBaseQuantity: string;
  outcome: 'READY' | 'SHORTAGE' | 'NEEDS_ATTENTION';
  reasonCode: string | null;
  message: string;
};

type OrderAllocationResult = {
  ok: true;
  replayed: boolean;
  salesOrderId: string;
  summary: {
    totalLines: number;
    readyLines: number;
    shortageLines: number;
    needsAttentionLines: number;
  };
  lines: OrderAllocationLineResult[];
};

type OrderGroup = {
  salesOrderId: string;
  orderNumber: string | null;
  orderSubtotal: string | null;
  orderDiscountTotal: string | null;
  orderTaxTotal: string | null;
  orderTotal: string | null;
  salesChannelCode: string | null;
  salesChannelName: string | null;
  fulfillmentStatus: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  requestedDeliveryDate: string | null;
  items: WorkItem[];
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string; code?: string };
};

type StatusFilter = 'all' | 'waiting' | 'allocated' | 'picking' | 'packing';

const SCALE = 1_000_000_000_000n;
const IDEMPOTENCY_INTENT_CACHE_LIMIT = 256;
const idempotencyKeys = new Map<string, string>();

function parseQuantity(value: string): bigint {
  const [whole = '0', fraction = ''] = String(value ?? '0').split('.');
  return BigInt(whole || '0') * SCALE + BigInt((fraction || '').padEnd(12, '0').slice(0, 12));
}

function quantityDifference(left: string, right: string): string {
  const result = parseQuantity(left) - parseQuantity(right);
  const safe = result > 0n ? result : 0n;
  const whole = safe / SCALE;
  const fraction = String(safe % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function formatQuantity(value: string): string {
  const normalized = String(value ?? '0');
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function orderedQuantityLabel(item: WorkItem): string {
  const ordered = `${formatQuantity(item.orderedQuantity)} ${item.orderedUnitCode}`;
  const base = `${formatQuantity(item.orderedBaseQuantity)} ${item.baseUnitCode}`;
  return item.orderedUnitCode === item.baseUnitCode && item.orderedQuantity === item.orderedBaseQuantity
    ? base
    : `${ordered} → ${base}`;
}

function moneyNumber(value: string | null): number {
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(value: string | null): string {
  if (value === null || value === undefined || String(value).trim() === '') return 'Chưa có tổng';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Chưa có tổng';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatMoneyNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return 'Chưa đặt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN').format(date);
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    backordered: 'Chờ thêm hàng',
    partially_reserved: 'Có hàng một phần',
    reserved: 'Chờ phân bổ',
    partially_allocated: 'Phân bổ một phần',
    allocated: 'Đã phân bổ',
    partially_picked: 'Đang soạn',
    picked: 'Đã soạn',
    partially_packed: 'Đang đóng gói',
    packed: 'Đã đóng gói',
  };
  return labels[value] ?? value;
}

function orderAllocationOutcomeLabel(value: OrderAllocationLineResult['outcome']): string {
  if (value === 'READY') return 'Đã phân bổ đủ';
  if (value === 'SHORTAGE') return 'Chưa đủ hàng';
  return 'Chưa phân bổ hết';
}

function statusBucket(value: string): Exclude<StatusFilter, 'all'> | 'other' {
  if (['backordered', 'partially_reserved', 'reserved'].includes(value)) return 'waiting';
  if (['partially_allocated', 'allocated'].includes(value)) return 'allocated';
  if (['partially_picked', 'picked'].includes(value)) return 'picking';
  if (['partially_packed', 'packed'].includes(value)) return 'packing';
  return 'other';
}

function groupBySalesOrder(items: WorkItem[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const item of items) {
    const existing = groups.get(item.salesOrderId);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(item.salesOrderId, {
      salesOrderId: item.salesOrderId,
      orderNumber: item.orderNumber,
      orderSubtotal: item.orderSubtotal,
      orderDiscountTotal: item.orderDiscountTotal,
      orderTaxTotal: item.orderTaxTotal,
      salesChannelCode: item.salesChannelCode,
      salesChannelName: item.salesChannelName,
      orderTotal: item.orderTotal,
      fulfillmentStatus: item.fulfillmentStatus,
      customerCode: item.customerCode,
      customerName: item.customerName,
      warehouseId: item.warehouseId,
      warehouseCode: item.warehouseCode,
      warehouseName: item.warehouseName,
      requestedDeliveryDate: item.requestedDeliveryDate,
      items: [item],
    });
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    items: [...group.items].sort((left, right) => left.lineNumber - right.lineNumber),
  }));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Không thực hiện được thao tác kho.');
  }
  return envelope.data;
}

function keyFor(prefix: string, id: string, fingerprint: string): string {
  const intent = `${prefix}:${id}:${fingerprint}`;
  const existing = idempotencyKeys.get(intent);
  if (existing) return existing;
  const key = createIdempotencyKey(`fulfillment-${prefix}`);
  if (idempotencyKeys.size >= IDEMPOTENCY_INTENT_CACHE_LIMIT) {
    const oldest = idempotencyKeys.keys().next().value;
    if (oldest) idempotencyKeys.delete(oldest);
  }
  idempotencyKeys.set(intent, key);
  return key;
}

export default function FulfillmentWorkspace() {
  const [work, setWork] = useState<WorkItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SuggestionDetail | null>(null);
  const [orderAllocationResult, setOrderAllocationResult] = useState<OrderAllocationResult | null>(null);
  const [allocationQuantity, setAllocationQuantity] = useState('');
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailRequestRef = useRef(0);

  const selectedWork = work.find((item) => item.fulfillmentDemandId === selectedId) ?? null;
  const groupedWork = useMemo(() => groupBySalesOrder(work), [work]);
  const selectedOrder = useMemo(() => {
    if (!selectedWork) return groupedWork[0] ?? null;
    return groupedWork.find((group) => group.salesOrderId === selectedWork.salesOrderId) ?? null;
  }, [groupedWork, selectedWork]);
  const selectedOrderAllocationResult = orderAllocationResult?.salesOrderId === selectedOrder?.salesOrderId
    ? orderAllocationResult
    : null;
  const orderAllocationLineMap = useMemo(() => new Map(
    (selectedOrderAllocationResult?.lines ?? []).map((line) => [line.fulfillmentDemandId, line] as const),
  ), [selectedOrderAllocationResult]);
  const canAllocateSelectedOrder = useMemo(() => selectedOrder?.items.some(
    (item) => parseQuantity(item.orderedBaseQuantity) > parseQuantity(item.allocatedBaseQuantity),
  ) ?? false, [selectedOrder]);
  const channelOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const group of groupedWork) {
      const code = group.salesChannelCode?.trim() || '__unassigned__';
      const label = group.salesChannelName?.trim()
        ? `${group.salesChannelCode ?? 'Chưa có mã'} — ${group.salesChannelName}`
        : 'Chưa có kênh bán';
      options.set(code, label);
    }
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], 'vi'));
  }, [groupedWork]);
  const warehouseOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const group of groupedWork) options.set(group.warehouseId, `${group.warehouseCode} — ${group.warehouseName}`);
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], 'vi'));
  }, [groupedWork]);
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    return groupedWork.filter((group) => {
      const channelMatches = channelFilter === 'all'
        || (channelFilter === '__unassigned__'
          ? !group.salesChannelCode
          : group.salesChannelCode === channelFilter);
      const statusMatches = statusFilter === 'all' || statusBucket(group.fulfillmentStatus) === statusFilter;
      const warehouseMatches = warehouseFilter === 'all' || group.warehouseId === warehouseFilter;
      if (!channelMatches || !statusMatches || !warehouseMatches) return false;
      if (!term) return true;
      return [
        group.orderNumber,
        group.customerCode,
        group.customerName,
        group.warehouseCode,
        group.warehouseName,
        group.salesChannelCode,
        group.salesChannelName,
        ...group.items.flatMap((item) => [item.sku, item.itemName, statusLabel(item.fulfillmentStatus)]),
      ].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(term);
    });
  }, [channelFilter, groupedWork, search, statusFilter, warehouseFilter]);
  const summary = useMemo(() => ({
    visibleOrders: filteredGroups.length,
    totalOrders: groupedWork.length,
    visibleValue: filteredGroups.reduce((total, group) => total + moneyNumber(group.orderTotal), 0),
    waiting: filteredGroups.filter((group) => statusBucket(group.fulfillmentStatus) === 'waiting').length,
    inProgress: filteredGroups.filter((group) => ['allocated', 'picking'].includes(statusBucket(group.fulfillmentStatus))).length,
    packed: filteredGroups.filter((group) => statusBucket(group.fulfillmentStatus) === 'packing').length,
  }), [filteredGroups, groupedWork.length]);
  const hasFilters = Boolean(
    search.trim()
    || channelFilter !== 'all'
    || statusFilter !== 'all'
    || warehouseFilter !== 'all',
  );

  async function loadWork(preferredId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const next = await requestJson<WorkItem[]>('/api/inventory/fulfillment-work?limit=500');
      setWork(next);
      const target = preferredId && next.some((item) => item.fulfillmentDemandId === preferredId)
        ? preferredId
        : selectedId && next.some((item) => item.fulfillmentDemandId === selectedId)
          ? selectedId
          : next[0]?.fulfillmentDemandId ?? null;
      setSelectedId(target);
      if (target) await loadDetail(target);
      else {
        detailRequestRef.current += 1;
        setDetail(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được hàng đợi kho.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(demandId: string) {
    const requestNumber = detailRequestRef.current + 1;
    detailRequestRef.current = requestNumber;
    setBusy(`detail-${demandId}`);
    setError(null);
    setSelectedId(demandId);
    setAllocationQuantity('');
    try {
      const next = await requestJson<SuggestionDetail>(
        `/api/inventory/fulfillment-demands/${demandId}/suggestions`,
      );
      if (detailRequestRef.current !== requestNumber) return;
      setDetail(next);
    } catch (loadError) {
      if (detailRequestRef.current !== requestNumber) return;
      setError(loadError instanceof Error ? loadError.message : 'Không tải được vị trí/lô gợi ý.');
    } finally {
      if (detailRequestRef.current === requestNumber) setBusy(null);
    }
  }

  function selectOrder(group: OrderGroup) {
    const firstItem = group.items[0];
    if (firstItem) void loadDetail(firstItem.fulfillmentDemandId);
  }

  function resetFilters() {
    setSearch('');
    setChannelFilter('all');
    setStatusFilter('all');
    setWarehouseFilter('all');
  }

  async function autoAllocateOrder() {
    if (!selectedOrder) return;
    const fingerprint = selectedOrder.items
      .map((item) => `${item.fulfillmentDemandId}.${item.orderedBaseQuantity}.${item.allocatedBaseQuantity}`)
      .join('_');
    setBusy('allocate-order');
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<OrderAllocationResult>(
        `/api/inventory/fulfillment-orders/${selectedOrder.salesOrderId}/allocate`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': keyFor('allocate-order', selectedOrder.salesOrderId, fingerprint),
          },
          body: JSON.stringify({ mode: 'AUTO' }),
        },
      );
      setOrderAllocationResult(result);
      setNotice(
        `Phân bổ toàn đơn: ${result.summary.readyLines} dòng đủ, `
        + `${result.summary.shortageLines} dòng chưa đủ hàng, `
        + `${result.summary.needsAttentionLines} dòng chưa phân bổ hết.`,
      );
      const focusLine = result.lines.find((line) => line.outcome === 'NEEDS_ATTENTION')
        ?? result.lines.find((line) => line.outcome === 'SHORTAGE');
      await loadWork(focusLine?.fulfillmentDemandId ?? selectedId);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không phân bổ toàn đơn được.');
    } finally {
      setBusy(null);
    }
  }

  async function allocateSelected(mode: 'AUTO' | 'QUANTITY') {
    if (!selectedId || !detail || !selectedWork) return;
    const unallocated = quantityDifference(selectedWork.orderedBaseQuantity, selectedWork.allocatedBaseQuantity);
    if (parseQuantity(unallocated) <= 0n) return;
    const quantity = allocationQuantity.trim();
    if (mode === 'QUANTITY') {
      if (!/^(0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(quantity) || parseQuantity(quantity) <= 0n) {
        setError('Nhập số lượng phân bổ lớn hơn 0.');
        return;
      }
      if (parseQuantity(quantity) > parseQuantity(unallocated)) {
        setError(`Số lượng phân bổ không được vượt ${formatQuantity(unallocated)} ${selectedWork.baseUnitCode}.`);
        return;
      }
    }
    const fingerprint = mode === 'AUTO'
      ? `${selectedWork.orderedBaseQuantity}:${selectedWork.allocatedBaseQuantity}:full`
      : `${selectedWork.allocatedBaseQuantity}:${quantity}`;
    setBusy('allocate');
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/inventory/fulfillment-demands/${selectedId}/allocate`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': keyFor('allocate', selectedId, fingerprint),
          },
          body: JSON.stringify(mode === 'AUTO'
            ? { mode: 'AUTO' }
            : { mode: 'QUANTITY', quantity }),
        },
      );
      setAllocationQuantity('');
      setNotice(mode === 'AUTO'
        ? 'Đã phân bổ tối đa cho phần đơn còn cần.'
        : `Đã phân bổ ${formatQuantity(quantity)} ${selectedWork.baseUnitCode}.`);
      await loadWork(selectedId);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không phân bổ được hàng.');
    } finally {
      setBusy(null);
    }
  }

  async function updateProgress(allocation: Allocation, action: 'pick' | 'pack') {
    const currentProgress = action === 'pick'
      ? allocation.pickedBaseQuantity
      : allocation.packedBaseQuantity;
    const quantity = action === 'pick'
      ? quantityDifference(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity)
      : quantityDifference(allocation.pickedBaseQuantity, allocation.packedBaseQuantity);
    if (parseQuantity(quantity) <= 0n) return;
    setBusy(`${action}-${allocation.id}`);
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/inventory/fulfillment-allocations/${allocation.id}/${action}`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': keyFor(action, allocation.id, `${currentProgress}:${quantity}`),
          },
          body: JSON.stringify({ quantity }),
        },
      );
      setNotice(action === 'pick'
        ? 'Đã xác nhận soạn phần hàng còn lại.'
        : 'Đã xác nhận đóng gói phần hàng đã soạn.');
      await loadWork(selectedId);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không cập nhật được tiến độ kho.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadWork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (filteredGroups.length === 0) return;
    if (selectedWork && filteredGroups.some((group) => group.salesOrderId === selectedWork.salesOrderId)) return;
    const firstItem = filteredGroups[0]?.items[0];
    if (firstItem) void loadDetail(firstItem.fulfillmentDemandId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGroups, selectedWork]);

  return (
    <AppShell
      kicker="Kho và hoàn tất đơn"
      title="Chuẩn bị hàng"
      subtitle="Phân bổ số lượng phù hợp cho từng đơn; phần chưa phân bổ vẫn để dành cho quyết định tiếp theo."
    >
      <div className={styles.page} data-testid="fulfillment-workspace">
        <div className={styles.topBar}>
          <div className={styles.stageSummary} aria-label="Tổng hợp hàng đợi kho">
            <span data-testid="fulfillment-summary-orders"><strong>{summary.visibleOrders}/{summary.totalOrders}</strong> đơn sau lọc</span>
            <span data-testid="fulfillment-summary-value"><strong>{formatMoneyNumber(summary.visibleValue)}</strong> giá trị</span>
            <span><strong>{summary.waiting}</strong> chờ phân bổ</span>
            <span><strong>{summary.inProgress}</strong> đang xử lý</span>
            <span><strong>{summary.packed}</strong> đóng gói</span>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadWork(selectedId)} disabled={loading || busy !== null}>
            {loading ? 'Đang tải...' : 'Làm mới'}
          </button>
        </div>

        {error ? <div className={styles.error} role="alert" data-testid="fulfillment-error">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status" data-testid="fulfillment-notice">{notice}</div> : null}

        <div className={styles.layout}>
          <section className={styles.queuePanel} aria-label="Danh sách đơn cần chuẩn bị">
            <div className={styles.queueHeader}>
              <div>
                <h3>Đơn cần chuẩn bị</h3>
                <p>{summary.visibleOrders}/{summary.totalOrders} đơn · {formatMoneyNumber(summary.visibleValue)}</p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm đơn, khách, SKU..."
                aria-label="Tìm đơn, khách hàng hoặc SKU"
                className={styles.search}
                data-testid="fulfillment-search"
              />
              <div className={styles.filters} aria-label="Bộ lọc đơn">
                <label>
                  <span>Kênh bán</span>
                  <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} data-testid="fulfillment-filter-channel">
                    <option value="all">Tất cả kênh</option>
                    {channelOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Trạng thái</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} data-testid="fulfillment-filter-status">
                    <option value="all">Tất cả</option>
                    <option value="waiting">Chờ phân bổ</option>
                    <option value="allocated">Đã phân bổ</option>
                    <option value="picking">Đang soạn</option>
                    <option value="packing">Đóng gói</option>
                  </select>
                </label>
                <label>
                  <span>Kho</span>
                  <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} data-testid="fulfillment-filter-warehouse">
                    <option value="all">Tất cả kho</option>
                    {warehouseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <button type="button" className={styles.clearFilters} onClick={resetFilters} disabled={!hasFilters} data-testid="fulfillment-filter-reset">
                  Xóa lọc
                </button>
              </div>
            </div>
            <div className={styles.orderList}>
              {filteredGroups.length === 0 ? <p className={styles.empty}>Không có đơn hàng phù hợp.</p> : null}
              {filteredGroups.map((group) => (
                <button
                  type="button"
                  key={group.salesOrderId}
                  className={`${styles.orderRow} ${selectedOrder?.salesOrderId === group.salesOrderId ? styles.orderRowActive : ''}`}
                  onClick={() => selectOrder(group)}
                  data-testid={`fulfillment-order-${group.salesOrderId}`}
                >
                  <span className={styles.orderIdentity}>
                    <span className={styles.orderPrimary}>
                      <strong>{group.orderNumber || 'Đơn chưa có số'}</strong>
                      <em>{statusLabel(group.fulfillmentStatus)}</em>
                    </span>
                    <small>{group.customerName}</small>
                  </span>
                  <span className={styles.orderMoney}>
                    <strong>{formatMoney(group.orderTotal)}</strong>
                    <small>{group.salesChannelCode || 'Chưa có kênh'}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.detailPanel}>
            {!selectedOrder || !selectedWork ? <p className={styles.empty}>Chọn một đơn để xem chi tiết chuẩn bị hàng.</p> : (
              <>
                <header className={styles.orderHeader} data-testid="fulfillment-order-preview">
                  <div className={styles.orderTitle}>
                    <span>Đơn bán hàng</span>
                    <h3>{selectedOrder.orderNumber || 'Đơn chưa có số'}</h3>
                  </div>
                  <div className={styles.orderMeta}>
                    <strong>{selectedOrder.customerName}</strong>
                    <span>
                      {selectedOrder.customerCode}
                      {' · '}
                      {selectedOrder.salesChannelName || selectedOrder.salesChannelCode || 'Chưa có kênh bán'}
                      {' · '}
                      {selectedOrder.warehouseName}
                      {' · Giao '}
                      {formatDate(selectedOrder.requestedDeliveryDate)}
                    </span>
                  </div>
                  <div className={styles.orderTotal}>
                    <span>Tổng đơn</span>
                    <strong>{formatMoney(selectedOrder.orderTotal)}</strong>
                    <small data-testid="fulfillment-order-financial-breakdown">
                      Tạm tính {formatMoney(selectedOrder.orderSubtotal)}
                      {' · CK '}{formatMoney(selectedOrder.orderDiscountTotal)}
                      {' · Thuế '}{formatMoney(selectedOrder.orderTaxTotal)}
                    </small>
                  </div>
                </header>

                <div className={styles.allocateToolbar} data-testid="fulfillment-order-allocation">
                  <div>
                    <strong>Phân bổ toàn đơn</strong>
                    <span>Phân bổ tối đa theo hàng đang có và thứ tự lô của Kho.</span>
                    {selectedOrderAllocationResult ? (
                      <span data-testid="fulfillment-order-allocation-summary">
                        {selectedOrderAllocationResult.summary.readyLines} dòng đủ · {' '}
                        {selectedOrderAllocationResult.summary.shortageLines} dòng chưa đủ hàng · {' '}
                        {selectedOrderAllocationResult.summary.needsAttentionLines} dòng chưa phân bổ hết
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void autoAllocateOrder()}
                    disabled={!canAllocateSelectedOrder || busy !== null}
                    data-testid="fulfillment-auto-allocate-order"
                  >
                    {busy === 'allocate-order' ? 'Đang phân bổ...' : 'Phân bổ toàn đơn'}
                  </button>
                </div>

                <section className={styles.productSection}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <h4>Sản phẩm trong đơn</h4>
                      <p>Số khách đặt được giữ nguyên; Kho xử lý theo đơn vị quy đổi chuẩn.</p>
                    </div>
                    <span>{selectedOrder.items.length} dòng</span>
                  </div>
                  <div className={styles.tableScroll}>
                    <div className={styles.productTable} data-testid="fulfillment-product-table">
                      <div className={`${styles.productRow} ${styles.tableHeader}`} aria-hidden="true">
                        <span>Sản phẩm</span><span>SKU</span><span>Khách đặt → Kho</span><span>Đã phân bổ</span><span>Còn cần</span><span>Soạn</span><span>Trạng thái</span>
                      </div>
                      {selectedOrder.items.map((item) => {
                        const orderOutcome = orderAllocationLineMap.get(item.fulfillmentDemandId);
                        return (
                          <button
                            type="button"
                            key={item.fulfillmentDemandId}
                            className={`${styles.productRow} ${selectedId === item.fulfillmentDemandId ? styles.productRowActive : ''}`}
                            onClick={() => void loadDetail(item.fulfillmentDemandId)}
                            data-testid={`fulfillment-product-${item.fulfillmentDemandId}`}
                          >
                            <strong>{item.itemName}</strong>
                            <span>{item.sku}</span>
                            <span>{orderedQuantityLabel(item)}</span>
                            <span>{formatQuantity(item.allocatedBaseQuantity)} {item.baseUnitCode}</span>
                            <span>{formatQuantity(quantityDifference(item.orderedBaseQuantity, item.allocatedBaseQuantity))} {item.baseUnitCode}</span>
                            <span>{formatQuantity(item.pickedBaseQuantity)} {item.baseUnitCode}</span>
                            <em title={orderOutcome?.message}>
                              {orderOutcome ? orderAllocationOutcomeLabel(orderOutcome.outcome) : statusLabel(item.fulfillmentStatus)}
                            </em>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className={styles.processSection} data-testid="fulfillment-selected-product">
                  <div className={styles.processHeader}>
                    <div>
                      <span>Đang xử lý sản phẩm</span>
                      <h4>{selectedWork.itemName}</h4>
                      <p>
                        {selectedWork.sku}
                        {' · Khách đặt '}{formatQuantity(selectedWork.orderedQuantity)} {selectedWork.orderedUnitCode}
                        {' · Kho xử lý '}{formatQuantity(selectedWork.orderedBaseQuantity)} {selectedWork.baseUnitCode}
                      </p>
                    </div>
                    <strong className={styles.status}>{statusLabel(selectedWork.fulfillmentStatus)}</strong>
                  </div>

                  <div className={styles.progressStrip} data-testid="fulfillment-allocation-metrics">
                    <span>Tồn thực tế <strong>{formatQuantity(detail?.warehouseOnHandBaseQuantity ?? selectedWork.warehouseOnHandBaseQuantity)} {selectedWork.baseUnitCode}</strong></span>
                    <span>Đơn khác đang giữ <strong>{formatQuantity(detail?.warehouseHeldByOthersBaseQuantity ?? selectedWork.warehouseHeldByOthersBaseQuantity)} {selectedWork.baseUnitCode}</strong></span>
                    <span>Khả dụng cho đơn này <strong>{formatQuantity(detail?.warehouseAvailableBaseQuantity ?? selectedWork.warehouseAvailableBaseQuantity)} {selectedWork.baseUnitCode}</strong></span>
                    <span>Cần <strong>{formatQuantity(selectedWork.orderedBaseQuantity)} {selectedWork.baseUnitCode}</strong></span>
                    <span>Đã phân bổ <strong>{formatQuantity(selectedWork.allocatedBaseQuantity)} {selectedWork.baseUnitCode}</strong></span>
                    <span>Còn cần phân bổ <strong>{formatQuantity(quantityDifference(selectedWork.orderedBaseQuantity, selectedWork.allocatedBaseQuantity))} {selectedWork.baseUnitCode}</strong></span>
                  </div>

                  <div className={styles.allocateToolbar}>
                    <div>
                      <strong>Chọn số lượng muốn phân bổ</strong>
                      <span>Phần chưa phân bổ không bị giữ cho đơn này, nên vẫn có thể dùng cho đơn khác.</span>
                    </div>
                    <div className={styles.rowActions}>
                      <input
                        className={styles.search}
                        inputMode="decimal"
                        value={allocationQuantity}
                        onChange={(event) => setAllocationQuantity(event.target.value)}
                        placeholder={`Số lượng (${selectedWork.baseUnitCode})`}
                        aria-label="Số lượng muốn phân bổ"
                        disabled={busy !== null}
                        data-testid="fulfillment-allocation-quantity"
                      />
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void allocateSelected('QUANTITY')}
                        disabled={busy !== null || parseQuantity(quantityDifference(selectedWork.orderedBaseQuantity, selectedWork.allocatedBaseQuantity)) <= 0n}
                        data-testid="fulfillment-allocate-quantity"
                      >
                        Phân bổ
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void allocateSelected('AUTO')}
                        disabled={busy !== null || parseQuantity(quantityDifference(selectedWork.orderedBaseQuantity, selectedWork.allocatedBaseQuantity)) <= 0n}
                        data-testid="fulfillment-auto-allocate"
                      >
                        {busy === 'allocate' ? 'Đang phân bổ...' : 'Phân bổ đủ'}
                      </button>
                    </div>
                  </div>

                  <section className={styles.subsection}>
                    <div className={styles.sectionHeading}>
                      <div><h4>Vị trí có thể lấy</h4><p>Hệ thống vẫn tự ưu tiên lô/vị trí đúng chính sách Kho.</p></div>
                      <span>{detail?.candidates.length ?? 0} vị trí</span>
                    </div>
                    <div className={styles.tableScroll}>
                      <div className={styles.locationTable}>
                        <div className={`${styles.locationRow} ${styles.tableHeader}`} aria-hidden="true">
                          <span>Vị trí</span><span>Lô</span><span>Khả dụng</span><span>Hạn dùng / nhập đầu</span>
                        </div>
                        {(detail?.candidates ?? []).slice(0, 12).map((candidate) => (
                          <div className={styles.locationRow} key={`${candidate.locationId ?? 'none'}-${candidate.lotId ?? 'none'}`}>
                            <strong>{candidate.locationCode || 'Chưa có vị trí'}</strong>
                            <span>{candidate.lotCode || 'Không theo lô'}</span>
                            <span>{formatQuantity(candidate.availableBaseQuantity)} {selectedWork.baseUnitCode}</span>
                            <span>{candidate.expiryDate ? `HSD ${formatDate(candidate.expiryDate)}` : `Nhập ${formatDate(candidate.firstReceivedAt)}`}</span>
                          </div>
                        ))}
                        {detail && detail.candidates.length === 0 ? <p className={styles.emptyTable}>Không còn vị trí/lô khả dụng.</p> : null}
                      </div>
                    </div>
                  </section>

                  <section className={styles.subsection}>
                    <div className={styles.sectionHeading}>
                      <div><h4>Hàng đã phân bổ</h4><p>Soạn và đóng gói theo đúng phần đã phân bổ.</p></div>
                      <span>{detail?.allocations.length ?? 0} dòng</span>
                    </div>
                    <div className={styles.tableScroll}>
                      <div className={styles.allocationTable}>
                        <div className={`${styles.allocationRow} ${styles.tableHeader}`} aria-hidden="true">
                          <span>Vị trí / lô</span><span>Phân bổ</span><span>Soạn</span><span>Đóng gói</span><span>Trạng thái</span><span>Thao tác</span>
                        </div>
                        {(detail?.allocations ?? []).map((allocation) => {
                          const pickRemaining = quantityDifference(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity);
                          const packRemaining = quantityDifference(allocation.pickedBaseQuantity, allocation.packedBaseQuantity);
                          return (
                            <div className={styles.allocationRow} key={allocation.id} data-testid={`fulfillment-allocation-${allocation.id}`}>
                              <div>
                                <strong>{allocation.locationCode || 'Chưa có vị trí'}</strong>
                                <small>{allocation.lotCode || 'Không theo lô'}{allocation.expiryDate ? ` · HSD ${formatDate(allocation.expiryDate)}` : ''}</small>
                              </div>
                              <span>{formatQuantity(allocation.allocatedBaseQuantity)} {selectedWork.baseUnitCode}</span>
                              <span>{formatQuantity(allocation.pickedBaseQuantity)} {selectedWork.baseUnitCode}</span>
                              <span>{formatQuantity(allocation.packedBaseQuantity)} {selectedWork.baseUnitCode}</span>
                              <em>{allocation.state === 'COMPLETED' ? 'Đã đóng gói' : 'Đang xử lý'}</em>
                              <div className={styles.rowActions}>
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  disabled={parseQuantity(pickRemaining) <= 0n || busy !== null}
                                  onClick={() => void updateProgress(allocation, 'pick')}
                                >
                                  {busy === `pick-${allocation.id}` ? 'Đang xác nhận...' : `Soạn ${formatQuantity(pickRemaining)} ${selectedWork.baseUnitCode}`}
                                </button>
                                <button
                                  type="button"
                                  className={styles.primaryButton}
                                  disabled={parseQuantity(packRemaining) <= 0n || busy !== null}
                                  onClick={() => void updateProgress(allocation, 'pack')}
                                >
                                  {busy === `pack-${allocation.id}` ? 'Đang xác nhận...' : `Đóng gói ${formatQuantity(packRemaining)} ${selectedWork.baseUnitCode}`}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {detail && detail.allocations.length === 0 ? <p className={styles.emptyTable}>Chưa có vị trí/lô đã phân bổ.</p> : null}
                      </div>
                    </div>
                  </section>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
