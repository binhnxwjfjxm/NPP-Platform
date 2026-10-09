'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import { BusinessSequenceNumber } from '../../components/business-table-sequence';
import type { SalesOrderBootstrap } from '../../../lib/sales-order-bootstrap';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import { SALES_ORDER_PERMISSION_KEYS } from '../../../lib/sales-order-permissions';
import { vietnamMonthBounds, previousVietnamMonth } from '../../../lib/sales-order-period';
import { matchesSalesOrderSearch, matchesSalesOrderSource, matchesSalesOrderLane } from '../../../lib/sales-order-list-filter';
import SalesOrderDetail from './SalesOrderDetail';
import SalesOrderForm, { type SalesOrderFormMode } from './SalesOrderForm';
import {
  activeVersion,
  apiRequest,
  formatMoney,
  formatVietnamDateTime,
  mutationKey,
  pendingVersion,
} from './sales-order-ui';
import styles from './sales-orders.module.css';
import polishStyles from './sales-order-card-polish.module.css';

type OrderSourceFilter = 'all' | 'internal' | 'mcp' | 'customer';
type OrderWorkStage = 'all' | 'active' | 'preparing' | 'waiting_delivery' | 'completed' | 'cancelled';
type ResolvedOrderWorkStage = Exclude<OrderWorkStage, 'all'>;
type OrderLaneFilter = 'all' | 'counter' | 'manual' | 'trip';
type OrderOperationError = Readonly<{
  orderId: string;
  stateKey: string;
  action: string;
  message: string;
}>;
type StockIssueKeyState = Readonly<{ orderId: string; stateKey: string; key: string }>;
type SalesOrderListValue = SalesOrder & Readonly<{ total?: string }>;
type SalesOrderSummary = Readonly<{ total: number; active: number; preparing: number; waiting_delivery: number; completed: number; cancelled: number }>;
const SALES_PAGE_SIZE = 50;
const MONTH_BATCH_SIZE = 1000;
const LIST_RENDER_BATCH = 80;
type OrderPeriodMode = 'month' | 'pending' | 'history';

const WORK_STAGE_OPTIONS: ReadonlyArray<Readonly<{ value: OrderWorkStage; label: string }>> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang xử lý' },
  { value: 'preparing', label: 'Đang chuẩn bị' },
  { value: 'waiting_delivery', label: 'Chờ giao' },
  { value: 'completed', label: 'Đã hoàn thành' },
  { value: 'cancelled', label: 'Hủy' },
];

const LANE_OPTIONS: ReadonlyArray<Readonly<{ value: OrderLaneFilter; label: string }>> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'counter', label: 'Mua tại quầy' },
  { value: 'manual', label: 'Giao thủ công' },
  { value: 'trip', label: 'Giao theo chuyến' },
];

const WORK_STAGE_LABELS: Readonly<Record<ResolvedOrderWorkStage, string>> = Object.freeze({
  active: 'Đang xử lý',
  preparing: 'Đang chuẩn bị',
  waiting_delivery: 'Chờ giao',
  completed: 'Đã hoàn thành',
  cancelled: 'Hủy',
});

function orderLane(order: SalesOrder): Exclude<OrderLaneFilter, 'all'> {
  if (order.deliveryMode === 'PICKUP') return 'counter';
  return order.deliveryExecutionMode === 'MANUAL' ? 'manual' : 'trip';
}

function orderLaneLabel(order: SalesOrder): string {
  const lane = orderLane(order);
  if (lane === 'counter') return 'Mua tại quầy';
  if (lane === 'manual') return 'Giao thủ công';
  return 'Giao theo chuyến';
}

function orderWorkStage(order: SalesOrder): ResolvedOrderWorkStage {
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

function orderCardStatus(order: SalesOrder): string {
  let status = 'Đang xử lý';
  if (order.status === 'cancelled' || order.deliveryStatus === 'cancelled') status = 'Đã hủy';
  else if (order.status === 'closed') status = 'Đã hoàn thành';
  else if (order.deliveryStatus === 'delivered') status = 'Đã giao';
  else if (order.deliveryStatus === 'partially_delivered') status = 'Đã giao một phần';
  else if (order.deliveryStatus === 'dispatched') status = 'Đang giao';
  else if (order.deliveryStatus === 'ready_to_dispatch') status = 'Chờ giao';
  else if (order.deliveryStatus === 'rescheduled') status = 'Hẹn giao lại';
  else if (order.deliveryStatus === 'failed') status = 'Giao chưa thành công';
  else if (order.deliveryStatus === 'returned') status = 'Đã trả hàng';
  else if (String(order.fulfillmentStatus) === 'issued') status = 'Đã xuất kho';
  else if (order.fulfillmentStatus === 'backordered') status = 'Chờ hàng';
  else if (order.fulfillmentStatus === 'partially_reserved') status = 'Chờ hàng một phần';
  else if (orderWorkStage(order) === 'preparing') status = 'Đang chuẩn bị';
  else if (order.status === 'draft') return 'Đặt hàng';
  return status;
}

function orderCardTone(order: SalesOrder): string {
  const stage = orderWorkStage(order);
  if (stage === 'cancelled') return 'cancelled';
  if (stage === 'completed') return 'closed';
  if (stage === 'waiting_delivery' || ['backordered', 'partially_reserved'].includes(String(order.fulfillmentStatus))) {
    return 'waiting';
  }
  return order.status === 'draft' ? 'draft' : 'confirmed';
}

function orderCardTotal(order: SalesOrder): string {
  return activeVersion(order)?.total ?? String((order as SalesOrderListValue).total ?? '0');
}

export function sortOrdersByCreatedAt(items: SalesOrder[]): SalesOrder[] {
  return [...items].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  ));
}

export function compactOrderNumber(value: string | null | undefined): string {
  const normalized = String(value ?? '').replace(/^#/, '');
  const match = /^SO-\d{6}-(\d{6})$/i.exec(normalized);
  return match ? `SO${match[1]}` : normalized;
}

export function orderBusinessStateKey(order: SalesOrder): string {
  const current = activeVersion(order);
  return [
    order.id,
    String(order.currentVersionNumber ?? ''),
    String(current?.revision ?? ''),
    order.status,
    String(order.fulfillmentStatus ?? ''),
    String(order.deliveryStatus ?? ''),
  ].join('|');
}

export default function SalesOrderWorkspace({ initialBootstrap }: { initialBootstrap: SalesOrderBootstrap }) {
  const [orders, setOrders] = useState(() => sortOrdersByCreatedAt(initialBootstrap.salesOrders));
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialBootstrap.errors.orders);
  const [operationError, setOperationError] = useState<OrderOperationError | null>(null);
  const [search, setSearch] = useState(initialBootstrap.initialSearch);
  const [periodMode, setPeriodMode] = useState<OrderPeriodMode>(initialBootstrap.initialSearch ? 'history' : 'month');
  const [monthKey, setMonthKey] = useState(initialBootstrap.currentMonth);
  const [periodChoice, setPeriodChoice] = useState('current');
  const [periodLoaded, setPeriodLoaded] = useState(false);
  const [renderCount, setRenderCount] = useState(LIST_RENDER_BATCH);
  const monthCacheRef = useRef(new Map<string, SalesOrder[]>());
  const initialSeedRef = useRef<SalesOrder[] | null>(initialBootstrap.salesOrders);
  const listElementRef = useRef<HTMLDivElement | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<SalesOrderSummary | null>(null);
  const [summaryUnavailable, setSummaryUnavailable] = useState(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const offsetRef = useRef(0);
  const listRequestRef = useRef(0);
  const [workStage, setWorkStage] = useState<OrderWorkStage>('all');
  const [lane, setLane] = useState<OrderLaneFilter>('all');
  const [source, setSource] = useState<OrderSourceFilter>('all');
  const [formMode, setFormMode] = useState<SalesOrderFormMode | null>(null);
  const [formVersion, setFormVersion] = useState<SalesOrderVersion | null>(null);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const stockIssueKeyRef = useRef<StockIssueKeyState | null>(null);
  const quickCreateHandledRef = useRef(false);

  const permissions = useMemo(() => new Set(initialBootstrap.permissionKeys), [initialBootstrap.permissionKeys]);
  const canCreate = permissions.has(SALES_ORDER_PERMISSION_KEYS.create);
  const canUpdate = permissions.has(SALES_ORDER_PERMISSION_KEYS.updateDraft);
  const canConfirm = permissions.has(SALES_ORDER_PERMISSION_KEYS.confirm);
  const canAmend = permissions.has(SALES_ORDER_PERMISSION_KEYS.amend);
  const canCancel = permissions.has(SALES_ORDER_PERMISSION_KEYS.cancel);
  const canIssueStock = permissions.has(SALES_ORDER_PERMISSION_KEYS.issueInventory);
  const canSettle = permissions.has(SALES_ORDER_PERMISSION_KEYS.recordCustomerPayment);
  const canPriceOverride = permissions.has(SALES_ORDER_PERMISSION_KEYS.priceOverride);
  const canDiscountOverride = permissions.has(SALES_ORDER_PERMISSION_KEYS.discountOverride);
  const canQuickCreateCustomer = permissions.has(SALES_ORDER_PERMISSION_KEYS.customerWrite);

  useEffect(() => {
    if (quickCreateHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('quickAction') !== 'create') return;
    quickCreateHandledRef.current = true;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('quickAction');
    window.history.replaceState(
      window.history.state,
      '',
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );

    setNotice(null);
    setOperationError(null);
    setFormVersion(null);
    if (!canCreate) {
      setError('Bạn không có quyền tạo đơn bán hàng.');
      return;
    }
    setError(null);
    setFormMode('create');
  }, [canCreate]);

  const selectedStateKey = selected ? orderBusinessStateKey(selected) : null;
  const visibleOperationError = operationError
    && selected
    && operationError.orderId === selected.id
    && operationError.stateKey === selectedStateKey
    ? operationError.message
    : null;
  const visibleError = visibleOperationError ?? error;

  useEffect(() => {
    if (!operationError || !selected || operationError.orderId !== selected.id
      || operationError.stateKey !== orderBusinessStateKey(selected)) {
      if (operationError) setOperationError(null);
    }
    const stockIssue = stockIssueKeyRef.current;
    if (stockIssue && selected?.id === stockIssue.orderId
      && stockIssue.stateKey !== orderBusinessStateKey(selected)) {
      stockIssueKeyRef.current = null;
    }
  }, [operationError, selected]);

  // A month is loaded in bounded server pages, but never capped at one page.
  // Only a completed snapshot is cached, so an interrupted request cannot hide orders.
  async function loadPeriod(kind: 'month' | 'pending', key: string, force = false) {
    const cacheKey = `${kind}:${key}`;
    const cached = !force ? monthCacheRef.current.get(cacheKey) : undefined;
    const run = ++listRequestRef.current;
    requestAbortRef.current?.abort();
    if (cached) {
      setOrders(cached);
      setPeriodLoaded(true);
      setHasMore(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const seed = !force && kind === 'month' && key === initialBootstrap.currentMonth
      ? initialSeedRef.current ?? [] : [];
    initialSeedRef.current = null;
    setOrders(seed);
    setRefreshing(true);
    setPeriodLoaded(false);
    setSummary(null);
    setSummaryUnavailable(false);
    setHasMore(false);
    const { dateFrom, dateTo } = vietnamMonthBounds(key);
    const results = [...seed];
    const seen = new Set(results.map((order) => order.id));
    let offset = seed.length;
    let continuePaging = seed.length === 0 || seed.length === MONTH_BATCH_SIZE;
    try {
      while (continuePaging) {
        const params = new URLSearchParams({
          scope: kind, compact: '1', limit: String(MONTH_BATCH_SIZE), offset: String(offset),
        });
        if (kind === 'month') {
          params.set('dateFrom', dateFrom);
          params.set('dateTo', dateTo);
        } else {
          params.set('beforeDate', dateFrom);
        }
        const next = await apiRequest<SalesOrder[]>(`/api/sales-orders?${params}`, { signal: controller.signal });
        if (run !== listRequestRef.current || controller.signal.aborted) return;
        for (const item of next) {
          if (!seen.has(item.id)) { seen.add(item.id); results.push(item); }
        }
        offset += next.length;
        continuePaging = next.length === MONTH_BATCH_SIZE;
      }
      if (run !== listRequestRef.current || controller.signal.aborted) return;
      const complete = sortOrdersByCreatedAt(results);
      monthCacheRef.current.set(cacheKey, complete);
      setOrders(complete);
      setPeriodLoaded(true);
      setError(null);
      if (force) setNotice('Danh sách đơn đã được cập nhật.');
    } catch (caught) {
      if (run === listRequestRef.current && !controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Không tải đủ danh sách đơn');
        setPeriodLoaded(false);
      }
    } finally {
      if (run === listRequestRef.current) setRefreshing(false);
    }
  }

  async function loadHistory(append = false) {
    const keyword = search.trim();
    const run = ++listRequestRef.current;
    requestAbortRef.current?.abort();
    if (!keyword) {
      setOrders([]);
      setSummary(null);
      setHasMore(false);
      setRefreshing(false);
      setPeriodLoaded(true);
      return;
    }
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setRefreshing(true);
    if (!append) {
      offsetRef.current = 0;
      setOrders([]);
      setSummary(null);
      setSummaryUnavailable(false);
      setHasMore(false);
    }
    const params = new URLSearchParams({
      scope: 'history', compact: '1',
      limit: String(SALES_PAGE_SIZE), offset: String(append ? offsetRef.current : 0),
      search: keyword, source, lane, stage: workStage,
    });
    const summaryParams = new URLSearchParams({ search: keyword, source, lane });
    // A summary error is independent of the result list.
    const summaryRequest = append ? null : apiRequest<SalesOrderSummary>(
      `/api/sales-orders/summary?${summaryParams}`, { signal: controller.signal },
    ).then((data) => ({ data, failed: false }), () => ({ data: null, failed: true }));
    try {
      const next = await apiRequest<SalesOrder[]>(`/api/sales-orders?${params}`, { signal: controller.signal });
      if (run !== listRequestRef.current || controller.signal.aborted) return;
      offsetRef.current = (append ? offsetRef.current : 0) + next.length;
      setOrders((current) => append
        ? sortOrdersByCreatedAt([...current, ...next.filter((item) => !current.some((row) => row.id === item.id))])
        : sortOrdersByCreatedAt(next));
      setHasMore(next.length === SALES_PAGE_SIZE);
      setPeriodLoaded(true);
      setError(null);
      if (summaryRequest) {
        void summaryRequest.then((result) => {
          if (run !== listRequestRef.current || controller.signal.aborted) return;
          if (result.data) setSummary(result.data);
          else setSummaryUnavailable(result.failed);
        });
      }
    } catch (caught) {
      if (run === listRequestRef.current && !controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Không tìm được đơn bán hàng');
      }
    } finally {
      if (run === listRequestRef.current) setRefreshing(false);
    }
  }

  function refreshOrders(showNotice: boolean, append = false) {
    if (showNotice) {
      setNotice(null);
      setError(null);
      setOperationError(null);
      if (periodMode !== 'history') monthCacheRef.current.delete(`${periodMode}:${monthKey}`);
    }
    if (periodMode === 'history') return loadHistory(append);
    return loadPeriod(periodMode, monthKey, showNotice);
  }

  // Changing filters in a loaded month never re-requests its server data.
  useEffect(() => {
    if (periodMode === 'history') return;
    void refreshOrders(false);
    return () => {
      requestAbortRef.current?.abort();
      listRequestRef.current += 1;
    };
  }, [periodMode, monthKey]);

  useEffect(() => {
    if (periodMode !== 'history') return;
    const timer = window.setTimeout(() => { void refreshOrders(false); }, search.trim() ? 450 : 0);
    return () => {
      window.clearTimeout(timer);
      requestAbortRef.current?.abort();
      listRequestRef.current += 1;
    };
  }, [periodMode, search, source, lane, workStage]);

  const locallyMatched = useMemo(() => periodMode === 'history' ? [] : orders.filter((order) =>
    matchesSalesOrderSearch(order, search)
    && matchesSalesOrderSource(order, source)
    && matchesSalesOrderLane(order, lane)
  ), [orders, search, source, lane, periodMode]);

  const filtered = useMemo(() => periodMode === 'history' ? orders
    : locallyMatched.filter((order) => workStage === 'all' || orderWorkStage(order) === workStage),
  [orders, locallyMatched, workStage, periodMode]);

  const stageCounts = useMemo<Record<OrderWorkStage, number> | null>(() => {
    if (periodMode === 'history') return summary
      ? { all: summary.total, active: summary.active, preparing: summary.preparing,
          waiting_delivery: summary.waiting_delivery, completed: summary.completed, cancelled: summary.cancelled }
      : null;
    if (!periodLoaded) return null;
    const counts = { all: locallyMatched.length, active: 0, preparing: 0,
      waiting_delivery: 0, completed: 0, cancelled: 0 };
    for (const order of locallyMatched) counts[orderWorkStage(order)] += 1;
    return counts;
  }, [periodMode, summary, periodLoaded, locallyMatched]);
  const allStageCounts = stageCounts;
  const totalForCurrentStage = stageCounts?.[workStage];
  const canLoadMore = periodMode === 'history' && hasMore
    && (totalForCurrentStage === undefined || orders.length < totalForCurrentStage);
  const visibleOrders = useMemo(() => filtered.slice(0, renderCount), [filtered, renderCount]);

  useEffect(() => {
    setRenderCount(LIST_RENDER_BATCH);
    if (listElementRef.current) listElementRef.current.scrollTop = 0;
  }, [periodMode, monthKey, search, source, lane, workStage]);

  function handleListScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 200) {
      setRenderCount((current) => Math.min(filtered.length, current + LIST_RENDER_BATCH));
    }
  }

  const handleFormError = useCallback((message: string) => {
    if (!message) {
      setError(null);
      setOperationError(null);
      return;
    }
    if (selected) {
      setError(null);
      setOperationError(Object.freeze({
        orderId: selected.id,
        stateKey: orderBusinessStateKey(selected),
        action: formMode ?? 'form',
        message,
      }));
      return;
    }
    setError(message);
  }, [formMode, selected]);

  function mergeOrder(order: SalesOrder) {
    const bounds = vietnamMonthBounds(monthKey);
    const belongs = periodMode === 'history'
      ? true
      : periodMode === 'month'
        ? order.createdAt >= bounds.dateFrom && order.createdAt < bounds.dateTo
        : order.createdAt < bounds.dateFrom && !['completed', 'cancelled'].includes(orderWorkStage(order));
    setOrders((current) => {
      const without = current.filter((item) => item.id !== order.id);
      const next = belongs ? [order, ...without] : without;
      const sorted = sortOrdersByCreatedAt(next);
      if (periodMode !== 'history' && periodLoaded) {
        monthCacheRef.current.set(`${periodMode}:${monthKey}`, sorted);
      }
      return sorted;
    });
    setSelected(order);
  }

  async function loadOrder(id: string) {
    setLoadingId(id);
    setError(null);
    setOperationError(null);
    try {
      mergeOrder(await apiRequest<SalesOrder>(`/api/sales-orders/${id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được đơn bán hàng');
    } finally {
      setLoadingId(null);
    }
  }

  function openForm(mode: SalesOrderFormMode, version: SalesOrderVersion | null = null) {
    setFormMode(mode);
    setFormVersion(version);
    setNotice(null);
    setError(null);
    setOperationError(null);
  }

  async function action(kind: 'confirm' | 'amend' | 'confirm-amendment' | 'issue-stock' | 'cancel' | 'close-execution') {
    if (!selected) return;
    const actionStateKey = orderBusinessStateKey(selected);
    setBusy(true);
    setError(null);
    setOperationError(null);
    setNotice(null);
    try {
      let order: SalesOrder;
      if (kind === 'confirm') {
        order = await apiRequest<SalesOrder>(`/api/sales-orders/${selected.id}/confirm`, {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey('sales-confirm') },
          body: JSON.stringify({}),
        });
        setNotice('Đã xác nhận và cấp số đơn bán hàng');
      } else if (kind === 'amend') {
        if (!amendmentReason.trim()) throw new Error('Hãy nhập lý do điều chỉnh');
        order = await apiRequest<SalesOrder>(`/api/sales-orders/${selected.id}/amendments`, {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey('sales-amend') },
          body: JSON.stringify({ reason: amendmentReason.trim() }),
        });
        setAmendmentReason('');
        setNotice('Đã tạo bản điều chỉnh nháp; phiên bản đang hiệu lực chưa bị thay đổi');
      } else if (kind === 'confirm-amendment') {
        const draft = pendingVersion(selected);
        if (!draft) throw new Error('Không có bản điều chỉnh nháp để xác nhận');
        order = await apiRequest<SalesOrder>(`/api/sales-orders/${selected.id}/amendments/${draft.versionNumber}/confirm`, {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey('sales-amend-confirm') },
          body: JSON.stringify({}),
        });
        setNotice('Đã xác nhận bản điều chỉnh; lịch sử cũ được giữ nguyên');
      } else if (kind === 'issue-stock') {
        const current = activeVersion(selected);
        if (!current) throw new Error('Không tìm thấy phiên bản đơn đang hiệu lực');
        const existing = stockIssueKeyRef.current;
        const key = existing?.orderId === selected.id && existing.stateKey === actionStateKey
          ? existing.key
          : mutationKey('sales-manual-stock-issue');
        stockIssueKeyRef.current = { orderId: selected.id, stateKey: actionStateKey, key };
        order = await apiRequest<SalesOrder>(`/api/sales-orders/${selected.id}/issue-stock`, {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify({ expectedRevision: current.revision }),
        });
        stockIssueKeyRef.current = null;
        setNotice('Đã Xuất kho đơn Giao thủ công');
      } else if (kind === 'close-execution') {
        if (!cancellationReason.trim()) throw new Error('Hãy nhập lý do kết thúc phần chưa giao');
        order = await apiRequest<SalesOrder>(`/api/sales-orders/${selected.id}/close-execution`, {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey('sales-execution-close') },
          body: JSON.stringify({ reason: cancellationReason.trim() }),
        });
        setCancellationReason('');
        setNotice('Đã kết thúc phần chưa giao; lịch sử giao nhận được giữ nguyên');
      } else {
        if (!cancellationReason.trim()) throw new Error('Hãy nhập lý do hủy');
        order = await apiRequest<SalesOrder>(`/api/sales-orders/${selected.id}/cancel`, {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey('sales-cancel') },
          body: JSON.stringify({ reason: cancellationReason.trim() }),
        });
        setCancellationReason('');
        setNotice('Đã hủy đơn bán hàng');
      }
      mergeOrder(order);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Thao tác bán hàng không thành công';
      setOperationError(Object.freeze({
        orderId: selected.id,
        stateKey: actionStateKey,
        action: kind,
        message,
      }));
    } finally {
      setBusy(false);
    }
  }

  // Một lần tải ban đầu lỗi không được tiếp tục cảnh báo sau khi tải lại thành công.
  const warnings = Object.entries(initialBootstrap.errors)
    .filter(([name, value]) => name !== 'orders' && Boolean(value))
    .map(([, value]) => value);
  return (
    <AppShell
      title="Đơn bán hàng"
      kicker="Bán hàng"
      subtitle="Tạo và xác nhận đơn; chuẩn bị hàng, giao hàng và thanh toán được theo dõi độc lập."
      actions={canCreate ? <button className={styles.primaryButton} type="button" onClick={() => openForm('create')}>Tạo đơn bán hàng</button> : null}
    >
      <div className={styles.workspace}>
        {(notice || visibleError || warnings.length > 0) && (
          <div className={`${styles.banner} ${visibleError || warnings.length > 0 ? styles.bannerError : styles.bannerSuccess}`} role="status">
            {visibleError ?? notice ?? warnings.join(' · ')}
          </div>
        )}

        <section className={styles.summaryGrid} aria-label="Tổng hợp đơn bán hàng">
          <article><strong>{allStageCounts?.all ?? '—'}</strong><span>{periodMode === 'history' ? 'Đơn trong kết quả tìm' : periodMode === 'pending' ? 'Đơn tồn từ trước' : 'Đơn trong tháng'}</span></article>
          <article><strong>{allStageCounts?.active ?? '—'}</strong><span>Đang xử lý</span></article>
          <article><strong>{allStageCounts?.waiting_delivery ?? '—'}</strong><span>Chờ giao</span></article>
          <article><strong>{allStageCounts?.completed ?? '—'}</strong><span>Đã hoàn thành</span></article>
        </section>

        <section className={`${styles.filterPanel} ${polishStyles.filterPanelCompact}`} aria-label="Bộ lọc đơn bán hàng">
          <strong className={polishStyles.filterPanelTitle}>Hình thức giao</strong>
          <div className={polishStyles.filterControlRow}>
            <div className={`${styles.filterGroup} ${polishStyles.filterGroupInline}`}>
              <span className={styles.filterLabel}>Luồng bán</span>
              <div className={polishStyles.filterChips} aria-label="Luồng bán">
                {LANE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={lane === option.value}
                    data-sales-order-lane={option.value}
                    className={`${lane === option.value ? styles.segmentActive : styles.segment} ${polishStyles.filterChip} ${polishStyles.laneChip}`}
                    onClick={() => setLane(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <span className={polishStyles.filterDivider} aria-hidden="true">|</span>

            <div className={`${styles.filterGroup} ${polishStyles.filterGroupInline}`}>
              <span className={styles.filterLabel}>Trạng thái giao</span>
              <div className={styles.filterChips} role="tablist" aria-label="Trạng thái giao">
                {WORK_STAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={workStage === option.value}
                    className={`${workStage === option.value ? styles.segmentActive : styles.segment} ${polishStyles.filterChip} ${polishStyles.statusChip}`}
                    onClick={() => setWorkStage(option.value)}
                  >
                    {option.label} · {stageCounts?.[option.value] ?? '—'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className={styles.toolbar}>
          <label><span>Thời gian</span>
            <select value={periodMode === 'history' ? 'history' : periodMode === 'pending' ? 'pending' : periodChoice}
              onChange={(event) => {
                const value = event.target.value;
                setPeriodChoice(value);
                if (value === 'history') setPeriodMode('history');
                else if (value === 'pending') setPeriodMode('pending');
                else { setPeriodMode('month'); if (value === 'current') setMonthKey(initialBootstrap.currentMonth); if (value === 'previous') setMonthKey(previousVietnamMonth(initialBootstrap.currentMonth)); }
              }}>
              <option value="current">Tháng này</option>
              <option value="previous">Tháng trước</option>
              <option value="custom">Chọn tháng/năm</option>
              <option value="pending">Đơn chưa hoàn thành</option>
              <option value="history">Tìm toàn bộ lịch sử</option>
            </select>
          </label>
          {periodMode === 'month' && <label><span>Tháng/năm</span><input type="month" value={monthKey} max={initialBootstrap.currentMonth}
            onChange={(event) => { if (event.target.value) { setMonthKey(event.target.value); setPeriodChoice('custom'); } }} /></label>}
          <label className={styles.orderSearchField}><span>Tìm đơn</span><input value={search} onChange={(event) => {
              const next = event.target.value;
              setSearch(next);
              if (periodMode === 'history' && !next.trim()) {
                setPeriodMode('month');
                setPeriodChoice(monthKey === initialBootstrap.currentMonth ? 'current' : 'custom');
              }
            }} placeholder="Mã đơn hoặc tên khách hàng" /></label>
          <label><span>Nguồn</span><select value={source} onChange={(event) => setSource(event.target.value as OrderSourceFilter)}><option value="all">Tất cả</option><option value="internal">Công Ty</option><option value="mcp">Nhân viên thị trường</option><option value="customer">Khách hàng</option></select></label>
          <button type="button" onClick={() => void refreshOrders(true)} disabled={refreshing}>{refreshing ? 'Đang làm mới…' : 'Làm mới'}</button>
        </div>

        <div className={styles.contentGrid}>
          <section className={styles.listPanel} aria-label="Danh sách đơn bán hàng">
            <header className={styles.panelHeading}><div><h2>Danh sách đơn</h2><p>Đang hiển thị {Math.min(renderCount, filtered.length)} / {totalForCurrentStage ?? '—'} đơn{refreshing && periodMode !== 'history' ? ' · Đang tải đủ đơn trong phạm vi' : ''}{summaryUnavailable ? ' · Chưa tải được thống kê, danh sách vẫn sử dụng được' : ''}</p></div></header>
            <div className={styles.orderList} ref={listElementRef} onScroll={handleListScroll}>
              {visibleOrders.map((order, rowIndex) => (
                <button
                  type="button"
                  key={order.id}
                  className={`${styles.orderCard} ${polishStyles.orderCardGrid} ${selected?.id === order.id ? styles.orderCardActive : ''}`}
                  disabled={loadingId === order.id}
                  onClick={() => loadOrder(order.id)}
                >
                  <div className={polishStyles.orderCardMain}>
                    <div className={polishStyles.orderCardCustomerRow}>
                      <BusinessSequenceNumber rowIndex={rowIndex} className={styles.orderSequence} />
                      <strong className={polishStyles.orderCardCustomerName}>{order.customerName}</strong>
                      <span className={polishStyles.orderCardNumberDivider} aria-hidden="true">|</span>
                      <strong className={polishStyles.orderCardTotal}>{formatMoney(orderCardTotal(order))}đ</strong>
                    </div>
                    <small className={polishStyles.orderCardCompactNumber}>
                      {order.number ? compactOrderNumber(order.number) : 'Đơn đặt hàng chưa cấp số'}
                    </small>
                    <div className={styles.orderCardMeta}>
                      <small>Kênh {order.salesChannelCode ?? 'chưa xác định'}{order.salesChannelName ? ` — ${order.salesChannelName}` : ''}</small>
                      <small>Cập nhật {formatVietnamDateTime(order.updatedAt)}</small>
                    </div>
                  </div>
                  <div className={polishStyles.orderCardStateStack} aria-label="Luồng giao và trạng thái đơn">
                    <span className={polishStyles.orderLaneBadge} data-sales-order-lane={orderLane(order)}>{orderLaneLabel(order)}</span>
                    <span className={polishStyles.orderStatusBadge} data-sales-order-tone={orderCardTone(order)}>{orderCardStatus(order)}</span>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && !refreshing && !error && <p className={styles.empty}>{periodMode === 'history' && !search.trim() ? 'Nhập mã đơn hoặc tên khách hàng để tìm trong toàn bộ lịch sử.' : 'Chưa có đơn phù hợp trong phạm vi này.'}</p>}
              {visibleOrders.length < filtered.length && <button type="button" onClick={() => setRenderCount((count) => count + LIST_RENDER_BATCH)}>Hiện thêm trong danh sách</button>}
              {canLoadMore && <button type="button" disabled={refreshing} onClick={() => void refreshOrders(false, true)}>{refreshing ? 'Đang tải…' : 'Xem thêm đơn cũ'}</button>}
            </div>
          </section>

          <SalesOrderDetail
            order={selected}
            busy={busy}
            canCreate={canCreate}
            canUpdate={canUpdate}
            canConfirm={canConfirm}
            canAmend={canAmend}
            canCancel={canCancel}
            canIssueStock={canIssueStock}
            canSettle={canSettle}
            amendmentReason={amendmentReason}
            cancellationReason={cancellationReason}
            onAmendmentReason={setAmendmentReason}
            onCancellationReason={setCancellationReason}
            onEditDraft={() => openForm('draft', activeVersion(selected))}
            onEditAmendment={() => openForm('amendment', pendingVersion(selected))}
            onEditManual={() => openForm('manual-edit', activeVersion(selected))}
            onConfirm={() => action('confirm')}
            onCreateAmendment={() => action('amend')}
            onConfirmAmendment={() => action('confirm-amendment')}
            onIssueStock={() => action('issue-stock')}
            onManualOrderUpdated={mergeOrder}
            onCancel={() => action('cancel')}
            onCloseExecution={() => action('close-execution')}
          />
        </div>
      </div>

      {formMode && (
        <SalesOrderForm
          mode={formMode}
          orderId={selected?.id}
          version={formVersion}
          customers={initialBootstrap.customers}
          warehouses={initialBootstrap.warehouses}
          products={initialBootstrap.products}
          canConfirm={formMode === 'manual-edit' ? false : formMode === 'amendment' ? canAmend : canConfirm}
          canQuickCreateCustomer={canQuickCreateCustomer}
          canPriceOverride={canPriceOverride}
          canDiscountOverride={canDiscountOverride}
          onClose={() => setFormMode(null)}
          onError={handleFormError}
          onSaved={(order) => {
            const savedMode = formMode;
            const savedStage = orderWorkStage(order);
            const savedLane = orderLane(order);
            const stageMovedOut = workStage !== 'all' && workStage !== savedStage;
            const laneMovedOut = lane !== 'all' && lane !== savedLane;
            mergeOrder(order);
            if (stageMovedOut) setWorkStage('all');
            if (laneMovedOut) setLane('all');
            setFormMode(null);
            setError(null);
            setOperationError(null);
            const locationNote = stageMovedOut || laneMovedOut
              ? ` · Đơn hiện ở ${WORK_STAGE_LABELS[savedStage]} · ${orderLaneLabel(order)}; đã mở Tất cả để không mất khỏi danh sách.`
              : '';
            setNotice(savedMode === 'manual-edit'
              ? `Đã lưu thay đổi đơn Giao thủ công${locationNote}`
              : order.status === 'confirmed'
                ? `Đã lưu, xác nhận và cấp số đơn bán hàng${locationNote}`
                : savedMode === 'create' ? 'Đã tạo đơn bán hàng nháp' : 'Đã lưu phiên bản nháp');
          }}
        />
      )}
    </AppShell>
  );
}
