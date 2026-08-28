'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import type { Customer } from '../../../lib/customer-types';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import SalesOrderPrintSheet from '../sales-orders/SalesOrderPrintSheet';
import {
  activeVersion,
  deliveryLabels,
  formatMoney,
  formatQuantity,
  formatVietnamDateTime,
} from '../sales-orders/sales-order-ui';
import styles from './order-management.module.css';

type ListOrder = SalesOrder & Readonly<{ total?: string }>;
type WorkStage = 'all' | 'active' | 'preparing' | 'waiting_delivery' | 'completed' | 'cancelled';
type ResolvedWorkStage = Exclude<WorkStage, 'all'>;
type DeliveryLane = 'all' | 'counter' | 'manual' | 'trip';
type SourceFilter = 'all' | 'internal' | 'mcp' | 'customer';
type PaymentFilter = 'all' | 'unpaid' | 'partial' | 'paid' | 'other';
type Tone = 'draft' | 'confirmed' | 'waiting' | 'cancelled' | 'closed';
type Envelope<T> = { data?: T; error?: { message?: string } };
type Filters = Readonly<{
  search: string;
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
  stage: WorkStage;
  payment: PaymentFilter;
  lane: DeliveryLane;
  source: SourceFilter;
}>;

const FETCH_PAGE_SIZE = 1000;
const MAX_OFFSET = 100000;
const TABLE_PAGE_SIZES = [20, 50, 100] as const;
const DEFAULT_FILTERS: Filters = Object.freeze({
  search: '',
  fromDate: '',
  fromTime: '00:00',
  toDate: '',
  toTime: '23:59',
  stage: 'all',
  payment: 'all',
  lane: 'all',
  source: 'all',
});

const STAGE_LABELS: Readonly<Record<ResolvedWorkStage, string>> = Object.freeze({
  active: 'Đang xử lý',
  preparing: 'Đang chuẩn bị',
  waiting_delivery: 'Chờ giao',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã hủy',
});

const PAYMENT_OPTIONS: ReadonlyArray<Readonly<{ value: PaymentFilter; label: string }>> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'unpaid', label: 'Chưa thu' },
  { value: 'partial', label: 'Thu một phần' },
  { value: 'paid', label: 'Đã thu' },
  { value: 'other', label: 'Đã xử lý khác' },
];

const LANE_OPTIONS: ReadonlyArray<Readonly<{ value: DeliveryLane; label: string }>> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'counter', label: 'Tại quầy' },
  { value: 'manual', label: 'Giao thủ công' },
  { value: 'trip', label: 'Giao theo chuyến' },
];

const SOURCE_OPTIONS: ReadonlyArray<Readonly<{ value: SourceFilter; label: string }>> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'internal', label: 'Công Ty' },
  { value: 'mcp', label: 'MCP' },
  { value: 'customer', label: 'Khách đặt hàng' },
];

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase('vi');
}

function orderLane(order: SalesOrder): Exclude<DeliveryLane, 'all'> {
  if (order.deliveryMode === 'PICKUP') return 'counter';
  return order.deliveryExecutionMode === 'MANUAL' ? 'manual' : 'trip';
}

function laneLabel(order: SalesOrder): string {
  const lane = orderLane(order);
  if (lane === 'counter') return 'Tại quầy';
  if (lane === 'manual') return 'Giao thủ công';
  return 'Giao theo chuyến';
}

function sourceBucket(order: SalesOrder): Exclude<SourceFilter, 'all'> {
  if (order.sourceType === 'MCP') return 'mcp';
  if (order.sourceType === 'API' && order.sourceId?.startsWith('CUSTOMER_PORTAL:')) return 'customer';
  return 'internal';
}

function orderWorkStage(order: SalesOrder): ResolvedWorkStage {
  if (order.status === 'cancelled' || order.deliveryStatus === 'cancelled') return 'cancelled';
  if (order.status === 'closed' || order.deliveryStatus === 'delivered') return 'completed';
  if (order.deliveryStatus === 'returned') return 'active';
  if (
    ['ready_to_dispatch', 'dispatched', 'partially_delivered', 'failed', 'rescheduled'].includes(order.deliveryStatus)
    || String(order.fulfillmentStatus) === 'issued'
  ) return 'waiting_delivery';
  if (
    order.status === 'confirmed'
    && ['reserved', 'partially_allocated', 'allocated', 'partially_fulfilled', 'fulfilled'].includes(String(order.fulfillmentStatus))
  ) return 'preparing';
  return 'active';
}

function orderStatusLabel(order: SalesOrder): string {
  if (order.status === 'cancelled' || order.deliveryStatus === 'cancelled') return 'Đã hủy';
  if (order.status === 'closed') return 'Đã hoàn thành';
  if (order.deliveryStatus === 'delivered') return 'Đã giao';
  if (order.deliveryStatus === 'partially_delivered') return 'Đã giao một phần';
  if (order.deliveryStatus === 'dispatched') return 'Đang giao';
  if (order.deliveryStatus === 'ready_to_dispatch') return 'Chờ giao';
  if (order.deliveryStatus === 'rescheduled') return 'Hẹn giao lại';
  if (order.deliveryStatus === 'failed') return 'Giao chưa thành công';
  if (order.deliveryStatus === 'returned') return 'Đã trả hàng';
  if (String(order.fulfillmentStatus) === 'issued') return 'Đã xuất kho';
  if (order.fulfillmentStatus === 'backordered') return 'Chờ hàng';
  if (order.fulfillmentStatus === 'partially_reserved') return 'Chờ hàng một phần';
  if (orderWorkStage(order) === 'preparing') return 'Đang chuẩn bị';
  if (order.status === 'draft') return 'Đặt hàng';
  return 'Đang xử lý';
}

function orderTone(order: SalesOrder): Tone {
  const stage = orderWorkStage(order);
  if (stage === 'cancelled') return 'cancelled';
  if (stage === 'completed') return 'closed';
  if (stage === 'waiting_delivery' || ['backordered', 'partially_reserved'].includes(String(order.fulfillmentStatus))) return 'waiting';
  return order.status === 'draft' ? 'draft' : 'confirmed';
}

function paymentBucket(order: SalesOrder): Exclude<PaymentFilter, 'all'> {
  if (order.settlementStatus === 'partially_paid') return 'partial';
  if (['paid', 'overpaid'].includes(order.settlementStatus)) return 'paid';
  if (['refunded', 'written_off'].includes(order.settlementStatus)) return 'other';
  return 'unpaid';
}

function paymentLabel(order: SalesOrder): string {
  if (order.settlementStatus === 'partially_paid') return 'Thu một phần';
  if (['paid', 'overpaid'].includes(order.settlementStatus)) return 'Đã thu';
  if (order.settlementStatus === 'refunded') return 'Đã hoàn tiền';
  if (order.settlementStatus === 'written_off') return 'Đã xử lý';
  return 'Chưa thu';
}

function paymentTone(order: SalesOrder): Tone {
  const bucket = paymentBucket(order);
  if (bucket === 'paid') return 'confirmed';
  if (bucket === 'partial') return 'waiting';
  if (bucket === 'other') return 'closed';
  return 'draft';
}

function fulfillmentLabel(order: SalesOrder): string {
  const status = String(order.fulfillmentStatus);
  if (status === 'unallocated') return 'Chưa chuẩn bị';
  if (status === 'backordered') return 'Chờ hàng';
  if (status === 'partially_reserved') return 'Giữ một phần';
  if (status === 'reserved') return 'Đã giữ hàng';
  if (status === 'partially_allocated') return 'Phân bổ một phần';
  if (status === 'allocated') return 'Đã phân bổ';
  if (status === 'partially_fulfilled') return 'Xuất một phần';
  if (status === 'fulfilled' || status === 'issued') return 'Đã xuất kho';
  if (status === 'cancelled') return 'Đã hủy';
  return status || '—';
}

function fulfillmentTone(order: SalesOrder): Tone {
  const status = String(order.fulfillmentStatus);
  if (status === 'cancelled') return 'cancelled';
  if (['backordered', 'partially_reserved'].includes(status)) return 'waiting';
  if (status === 'unallocated') return 'draft';
  return 'confirmed';
}

function deliveryTone(order: SalesOrder): Tone {
  if (order.deliveryStatus === 'cancelled') return 'cancelled';
  if (order.deliveryStatus === 'delivered' || order.deliveryStatus === 'not_required') return 'confirmed';
  if (['failed', 'ready_to_dispatch', 'dispatched', 'partially_delivered', 'rescheduled'].includes(order.deliveryStatus)) return 'waiting';
  return order.status === 'draft' ? 'draft' : 'confirmed';
}

function orderTotal(order: ListOrder): string {
  return activeVersion(order)?.total ?? String(order.total ?? '0');
}

function isPrintable(order: SalesOrder): boolean {
  return Boolean(order.number) && ['confirmed', 'closed'].includes(order.status);
}

function rangeTimestamp(date: string, time: string, end: boolean): number | null {
  if (!date) return null;
  const resolvedTime = time || (end ? '23:59' : '00:00');
  const suffix = end ? ':59.999+07:00' : ':00+07:00';
  const parsed = new Date(`${date}T${resolvedTime}${suffix}`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function timeRangeError(filters: Filters): string | null {
  const start = rangeTimestamp(filters.fromDate, filters.fromTime, false);
  const end = rangeTimestamp(filters.toDate, filters.toTime, true);
  if (start !== null && end !== null && start > end) return 'Thời gian bắt đầu phải trước thời gian kết thúc.';
  return null;
}

async function loadAllPages<T>(basePath: string): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  for (;;) {
    if (offset > MAX_OFFSET) {
      throw new Error('Dữ liệu vượt phạm vi truy vấn an toàn. Chưa thể dùng Chọn tất cả cho danh sách này.');
    }
    const separator = basePath.includes('?') ? '&' : '?';
    const response = await fetch(`${basePath}${separator}limit=${FETCH_PAGE_SIZE}&offset=${offset}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null) as Envelope<T[]> | null;
    if (!response.ok || !Array.isArray(payload?.data)) {
      throw new Error(payload?.error?.message || 'Không tải được dữ liệu.');
    }
    result.push(...payload.data);
    if (payload.data.length < FETCH_PAGE_SIZE) return result;
    offset += payload.data.length;
  }
}

async function fetchOrderDetail(id: string): Promise<SalesOrder> {
  const response = await fetch(`/api/sales-orders/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null) as Envelope<SalesOrder> | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || 'Không tải được chi tiết đơn.');
  return payload.data;
}

async function waitForPrintSurfaces(targetIds: string[], timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-print-surface]'));
    const byId = new Map(surfaces.map((surface) => [surface.dataset.printId ?? '', surface]));
    const allReady = targetIds.every((targetId) => byId.get(targetId)?.querySelector('[data-print-template-ready="true"]'));
    if (allReady) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Mẫu in Công Ty chưa sẵn sàng. Chưa thực hiện in để tránh dùng mẫu chưa hoàn chỉnh.');
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function clearPrintState() {
  document.body.removeAttribute('data-printing');
  document.querySelectorAll('[data-print-root="true"]').forEach((element) => element.remove());
  document.querySelectorAll('[data-print-active="true"]').forEach((element) => element.removeAttribute('data-print-active'));
}

function printTargets(targetIds: string[]) {
  clearPrintState();
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-print-surface]'));
  const byId = new Map(surfaces.map((surface) => [surface.dataset.printId ?? '', surface]));
  const printRoot = document.createElement('div');
  printRoot.setAttribute('data-print-root', 'true');
  let appended = 0;
  for (const targetId of targetIds) {
    const target = byId.get(targetId);
    if (!target) continue;
    const printable = target.cloneNode(true) as HTMLElement;
    printable.setAttribute('data-print-active', 'true');
    if (appended > 0) {
      printable.style.breakBefore = 'page';
      printable.style.pageBreakBefore = 'always';
    }
    printRoot.appendChild(printable);
    appended += 1;
  }
  if (appended !== targetIds.length) {
    clearPrintState();
    throw new Error('Chưa chuẩn bị đủ phiếu in. Hãy thử lại.');
  }
  document.body.appendChild(printRoot);
  document.body.setAttribute('data-printing', 'true');
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    clearPrintState();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}

function PrintPreparation({ orders }: { orders: SalesOrder[] }) {
  return (
    <div className={styles.printPreparation} aria-hidden="true">
      {orders.map((order) => {
        const version = activeVersion(order);
        return version ? <SalesOrderPrintSheet key={order.id} order={order} version={version} /> : null;
      })}
    </div>
  );
}

export default function OrderManagementWorkspace() {
  const [orders, setOrders] = useState<ListOrder[]>([]);
  const [customerPhones, setCustomerPhones] = useState<Map<string, string>>(new Map());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printOrders, setPrintOrders] = useState<SalesOrder[]>([]);
  const [detail, setDetail] = useState<SalesOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const detailCacheRef = useRef(new Map<string, SalesOrder>());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotice(null);
    setSelectedIds(new Set());
    setPage(1);
    try {
      const loadedOrders = await loadAllPages<ListOrder>('/api/sales-orders');
      setOrders(loadedOrders);
      void loadAllPages<Customer>('/api/customers?active=true')
        .then((customers) => {
          setCustomerPhones(new Map(customers.flatMap((customer) => customer.phone ? [[customer.id, customer.phone] as const] : [])));
        })
        .catch(() => setNotice('Danh sách đơn đã tải. Tìm theo số điện thoại khách có sẵn có thể chưa đầy đủ.'));
    } catch (error) {
      setOrders([]);
      setLoadError(error instanceof Error ? error.message : 'Không tải được danh sách đơn hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rangeError = useMemo(() => timeRangeError(filters), [filters]);

  const baseFilteredOrders = useMemo(() => {
    if (rangeError) return [];
    const term = normalizedSearch(filters.search);
    const from = rangeTimestamp(filters.fromDate, filters.fromTime, false);
    const to = rangeTimestamp(filters.toDate, filters.toTime, true);
    return orders.filter((order) => {
      const created = new Date(order.createdAt).getTime();
      if (from !== null && (!Number.isFinite(created) || created < from)) return false;
      if (to !== null && (!Number.isFinite(created) || created > to)) return false;
      if (filters.payment !== 'all' && paymentBucket(order) !== filters.payment) return false;
      if (filters.lane !== 'all' && orderLane(order) !== filters.lane) return false;
      if (filters.source !== 'all' && sourceBucket(order) !== filters.source) return false;
      if (!term) return true;
      return [
        order.number,
        order.customerCode,
        order.customerName,
        order.walkInPhone,
        customerPhones.get(order.customerId),
        order.sourceId,
      ].filter(Boolean).some((value) => String(value).toLocaleLowerCase('vi').includes(term));
    });
  }, [customerPhones, filters, orders, rangeError]);

  const filteredOrders = useMemo(() => filters.stage === 'all'
    ? baseFilteredOrders
    : baseFilteredOrders.filter((order) => orderWorkStage(order) === filters.stage), [baseFilteredOrders, filters.stage]);

  const stageSummary = useMemo(() => {
    const summary: Record<ResolvedWorkStage, { count: number; total: number }> = {
      active: { count: 0, total: 0 },
      preparing: { count: 0, total: 0 },
      waiting_delivery: { count: 0, total: 0 },
      completed: { count: 0, total: 0 },
      cancelled: { count: 0, total: 0 },
    };
    for (const order of baseFilteredOrders) {
      const stage = orderWorkStage(order);
      summary[stage].count += 1;
      summary[stage].total += Number(orderTotal(order)) || 0;
    }
    return summary;
  }, [baseFilteredOrders]);

  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageOrders = useMemo(() => filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize), [currentPage, filteredOrders, pageSize]);
  const selectedOrders = useMemo(() => filteredOrders.filter((order) => selectedIds.has(order.id)), [filteredOrders, selectedIds]);
  const printableSelectedCount = useMemo(() => selectedOrders.filter(isPrintable).length, [selectedOrders]);
  const allFilteredSelected = filteredOrders.length > 0 && filteredOrders.every((order) => selectedIds.has(order.id));
  const someFilteredSelected = filteredOrders.some((order) => selectedIds.has(order.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [allFilteredSelected, someFilteredSelected]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedIds(new Set());
    setPage(1);
    setNotice(null);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setSelectedIds(new Set());
    setPage(1);
    setNotice(null);
  }

  function toggleAllFiltered(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredOrders.map((order) => order.id)));
  }

  function toggleOrder(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function openDetail(order: ListOrder) {
    setDetailError(null);
    const cached = detailCacheRef.current.get(order.id);
    if (cached) {
      setDetail(cached);
      return;
    }
    setDetailLoading(true);
    try {
      const loaded = await fetchOrderDetail(order.id);
      detailCacheRef.current.set(order.id, loaded);
      setDetail(loaded);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Không tải được chi tiết đơn.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadDetailsForPrint(selected: ListOrder[]): Promise<SalesOrder[]> {
    const result: SalesOrder[] = [];
    for (let index = 0; index < selected.length; index += 6) {
      const chunk = selected.slice(index, index + 6);
      const loaded = await Promise.all(chunk.map((order) => fetchOrderDetail(order.id)));
      loaded.forEach((order) => detailCacheRef.current.set(order.id, order));
      result.push(...loaded);
    }
    return result;
  }

  async function printSelected() {
    if (printing || rangeError) return;
    const printable = selectedOrders.filter(isPrintable);
    if (printable.length === 0) return;
    setPrinting(true);
    setNotice(null);
    try {
      const details = await loadDetailsForPrint(printable);
      const ready = details.filter((order) => isPrintable(order) && activeVersion(order));
      if (ready.length !== printable.length) throw new Error('Có đơn đã thay đổi và không còn đủ điều kiện in. Hãy tải lại danh sách.');
      const targetIds = ready.map((order) => {
        const version = activeVersion(order) as SalesOrderVersion;
        return `sales-order-${order.id}-${version.id}`;
      });
      setPrintOrders(ready);
      await waitForPrintSurfaces(targetIds);
      printTargets(targetIds);
      for (const order of ready) {
        const version = activeVersion(order) as SalesOrderVersion;
        try {
          window.localStorage.setItem(`sales-order:last-print:${order.id}`, `${order.id}:${version.id}:${version.revision}`);
        } catch {
          // Dấu lần in chỉ phục vụ nhắc người dùng, không ảnh hưởng nghiệp vụ.
        }
      }
      const skipped = selectedOrders.length - printable.length;
      setNotice(skipped > 0
        ? `Đã gửi ${ready.length} đơn đủ điều kiện sang cửa sổ in; ${skipped} đơn chưa đủ điều kiện được giữ lại ngoài lô in.`
        : `Đã gửi ${ready.length} đơn sang cửa sổ in.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không chuẩn bị được lô in.');
    } finally {
      setPrinting(false);
      setPrintOrders([]);
    }
  }

  const detailVersion = activeVersion(detail);

  return (
    <AppShell
      title="Quản lý đơn hàng"
      subtitle="Theo dõi, lọc, chọn và in đơn bán hàng"
      kicker="Bán hàng"
      actions={<Link className={styles.createButton} href="/sales/sales-orders">Tạo đơn bán hàng</Link>}
    >
      <div className={styles.workspace}>
        <section className={styles.summaryGrid} aria-label="Tổng quan trạng thái đơn">
          {(Object.keys(STAGE_LABELS) as ResolvedWorkStage[]).map((stage) => (
            <button
              key={stage}
              type="button"
              className={`${styles.summaryCard} ${filters.stage === stage ? styles.summaryCardActive : ''}`}
              data-stage={stage}
              onClick={() => updateFilter('stage', filters.stage === stage ? 'all' : stage)}
            >
              <span>{STAGE_LABELS[stage]}</span>
              <strong>{stageSummary[stage].count.toLocaleString('vi-VN')}</strong>
              <small>{formatMoney(stageSummary[stage].total)} ₫</small>
            </button>
          ))}
        </section>

        <section className={styles.filterPanel} aria-label="Bộ lọc đơn hàng">
          <div className={styles.searchRow}>
            <label className={styles.searchField}>
              <span>Tìm kiếm</span>
              <input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Số đơn, khách hàng, số điện thoại" />
            </label>
            <label><span>Từ ngày</span><input type="date" value={filters.fromDate} onChange={(event) => updateFilter('fromDate', event.target.value)} /></label>
            <label><span>Từ giờ</span><input type="time" disabled={!filters.fromDate} value={filters.fromTime} onChange={(event) => updateFilter('fromTime', event.target.value)} /></label>
            <label><span>Đến ngày</span><input type="date" value={filters.toDate} onChange={(event) => updateFilter('toDate', event.target.value)} /></label>
            <label><span>Đến giờ</span><input type="time" disabled={!filters.toDate} value={filters.toTime} onChange={(event) => updateFilter('toTime', event.target.value)} /></label>
          </div>
          <div className={styles.filterRow}>
            <label><span>Trạng thái đơn</span><select value={filters.stage} onChange={(event) => updateFilter('stage', event.target.value as WorkStage)}><option value="all">Tất cả</option>{(Object.keys(STAGE_LABELS) as ResolvedWorkStage[]).map((stage) => <option value={stage} key={stage}>{STAGE_LABELS[stage]}</option>)}</select></label>
            <label><span>Thanh toán</span><select value={filters.payment} onChange={(event) => updateFilter('payment', event.target.value as PaymentFilter)}>{PAYMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>Luồng giao</span><select value={filters.lane} onChange={(event) => updateFilter('lane', event.target.value as DeliveryLane)}>{LANE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>Nguồn đơn</span><select value={filters.source} onChange={(event) => updateFilter('source', event.target.value as SourceFilter)}>{SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div className={styles.filterActions}>
              <button type="button" className={styles.printButton} disabled={printing || printableSelectedCount === 0 || Boolean(rangeError)} onClick={() => void printSelected()}>{printing ? 'Đang chuẩn bị in…' : `In đơn${selectedIds.size ? ` (${printableSelectedCount})` : ''}`}</button>
              <button type="button" className={styles.secondaryButton} onClick={resetFilters}>Xóa bộ lọc</button>
            </div>
          </div>
          {rangeError ? <p className={styles.errorText} role="alert">{rangeError}</p> : null}
        </section>

        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {loadError ? <div className={styles.errorBanner} role="alert">{loadError}<button type="button" onClick={() => void load()}>Tải lại</button></div> : null}

        <section className={styles.tablePanel}>
          <div className={styles.selectionBar}>
            <label className={styles.selectAllLabel}>
              <input ref={selectAllRef} type="checkbox" checked={allFilteredSelected} disabled={filteredOrders.length === 0 || Boolean(rangeError)} onChange={(event) => toggleAllFiltered(event.target.checked)} />
              <span>Chọn tất cả</span>
            </label>
            <span className={styles.resultCount}>{loading ? 'Đang tải đơn hàng…' : `${filteredOrders.length.toLocaleString('vi-VN')} đơn theo bộ lọc`}</span>
            {selectedIds.size > 0 ? <strong className={styles.selectedCount}>{allFilteredSelected ? `Đã chọn ${selectedIds.size.toLocaleString('vi-VN')} đơn theo bộ lọc hiện tại` : `Đã chọn ${selectedIds.size.toLocaleString('vi-VN')} đơn`}</strong> : null}
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr>
                <th className={styles.checkColumn}><span className={styles.srOnly}>Chọn</span></th>
                <th className={styles.orderColumn}>Số đơn</th>
                <th>Ngày tạo</th>
                <th>Khách hàng</th>
                <th>Trạng thái đơn</th>
                <th>Thanh toán</th>
                <th className={styles.moneyColumn}>Giá trị đơn</th>
                <th>Xuất/chuẩn bị hàng</th>
                <th>Giao hàng</th>
              </tr></thead>
              <tbody>
                {!loading && pageOrders.length === 0 ? <tr><td colSpan={9} className={styles.empty}>Không có đơn phù hợp với bộ lọc.</td></tr> : null}
                {pageOrders.map((order) => (
                  <tr key={order.id}>
                    <td className={styles.checkColumn}><input type="checkbox" aria-label={`Chọn đơn ${order.number ?? order.id}`} checked={selectedIds.has(order.id)} onChange={(event) => toggleOrder(order.id, event.target.checked)} /></td>
                    <td className={styles.orderColumn}><button type="button" className={styles.orderLink} onClick={() => void openDetail(order)}>{order.number ?? 'Chưa cấp số'}</button></td>
                    <td className={styles.dateCell}>{formatVietnamDateTime(order.createdAt)}</td>
                    <td><strong className={styles.customerName}>{order.customerName}</strong><small className={styles.customerMeta}>{order.customerCode}</small></td>
                    <td><span className={styles.statusBadge} data-tone={orderTone(order)}>{orderStatusLabel(order)}</span></td>
                    <td><span className={styles.statusBadge} data-tone={paymentTone(order)}>{paymentLabel(order)}</span></td>
                    <td className={styles.moneyColumn}>{formatMoney(orderTotal(order))} ₫</td>
                    <td><span className={styles.statusBadge} data-tone={fulfillmentTone(order)}>{fulfillmentLabel(order)}</span></td>
                    <td><span className={styles.laneBadge} data-lane={orderLane(order)}>{laneLabel(order)}</span><small className={styles.deliveryState} data-tone={deliveryTone(order)}>{deliveryLabels[order.deliveryStatus] ?? order.deliveryStatus}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className={styles.pagination}>
            <span>{filteredOrders.length ? `Hiển thị ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filteredOrders.length)} trong ${filteredOrders.length.toLocaleString('vi-VN')} đơn` : '0 đơn'}</span>
            <div>
              <select aria-label="Số dòng mỗi trang" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{TABLE_PAGE_SIZES.map((size) => <option value={size} key={size}>{size} / trang</option>)}</select>
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trước</button>
              <strong>Trang {currentPage}/{pageCount}</strong>
              <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Sau</button>
            </div>
          </footer>
        </section>
      </div>

      <PrintPreparation orders={printOrders} />

      {(detail || detailLoading || detailError) ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => { if (!detailLoading) { setDetail(null); setDetailError(null); } }}>
        <section className={styles.detailModal} role="dialog" aria-modal="true" aria-label="Chi tiết đơn hàng" onMouseDown={(event) => event.stopPropagation()}>
          <header className={styles.detailHeader}>
            <div><span>Chi tiết đơn hàng</span><h2>{detail?.number ?? (detailLoading ? 'Đang tải…' : 'Không tải được đơn')}</h2></div>
            <button type="button" className={styles.closeButton} onClick={() => { setDetail(null); setDetailError(null); }} aria-label="Đóng">×</button>
          </header>
          {detailError ? <div className={styles.errorText}>{detailError}</div> : null}
          {detailLoading ? <div className={styles.detailLoading}>Đang tải chi tiết đơn…</div> : null}
          {detail && detailVersion ? <div className={styles.detailBody}>
            <div className={styles.detailFacts}>
              <article><span>Khách hàng</span><strong>{detail.customerName}</strong><small>{detail.customerCode}</small></article>
              <article><span>Trạng thái đơn</span><strong>{orderStatusLabel(detail)}</strong></article>
              <article><span>Thanh toán</span><strong>{paymentLabel(detail)}</strong></article>
              <article><span>Luồng giao</span><strong>{laneLabel(detail)}</strong><small>{deliveryLabels[detail.deliveryStatus] ?? detail.deliveryStatus}</small></article>
              <article><span>Giá trị đơn</span><strong>{formatMoney(detailVersion.total)} ₫</strong></article>
            </div>
            <div className={styles.detailTableScroll}><table className={styles.detailTable}><thead><tr><th>STT</th><th>Sản phẩm / SKU</th><th>SL</th><th>ĐVT</th><th className={styles.moneyColumn}>Đơn giá</th><th className={styles.moneyColumn}>Thành tiền</th></tr></thead><tbody>{(detailVersion.lines ?? []).map((line) => <tr key={line.id}><td>{line.lineNumber}</td><td><strong>{line.itemName}</strong><small>{line.sku}</small></td><td>{formatQuantity(line.quantity)}</td><td>{line.unitCode}</td><td className={styles.moneyColumn}>{formatMoney(line.unitPrice)} ₫</td><td className={styles.moneyColumn}>{formatMoney(line.lineTotal)} ₫</td></tr>)}</tbody></table></div>
            <footer className={styles.detailFooter}><span>Tạo lúc {formatVietnamDateTime(detail.createdAt)}</span>{isPrintable(detail) ? <SalesOrderPrintSheet order={detail} version={detailVersion} /> : <small>Đơn này chưa đủ điều kiện in theo quy tắc hiện hành.</small>}</footer>
          </div> : null}
        </section>
      </div> : null}
    </AppShell>
  );
}
