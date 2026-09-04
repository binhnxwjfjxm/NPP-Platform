'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import { BusinessSequenceNumber } from '../../components/business-table-sequence';
import type { SalesOrderBootstrap } from '../../../lib/sales-order-bootstrap';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import { SALES_ORDER_PERMISSION_KEYS } from '../../../lib/sales-order-permissions';
import { salesOrderSourceLabel } from '../../../lib/business-language';
import SalesOrderDetail from './SalesOrderDetail';
import SalesOrderForm, { type SalesOrderFormMode } from './SalesOrderForm';
import {
  activeVersion,
  apiRequest,
  collectionLabels,
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

function sourceBucket(order: SalesOrder): Exclude<OrderSourceFilter, 'all'> {
  if (order.sourceType === 'MCP') return 'mcp';
  if (order.sourceType === 'API' && order.sourceId?.startsWith('CUSTOMER_PORTAL:')) return 'customer';
  return 'internal';
}

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

export function compactOrderNumber(value: string | null | undefined): string {
  const normalized = String(value ?? '').replace(/^#/, '');
  const match = /^(.+-)(\d{6})(-\d+)$/.exec(normalized);
  return match ? `${match[1]}…${match[3]}` : normalized;
}

function matchesSearch(order: SalesOrder, term: string): boolean {
  if (!term) return true;
  return [
    order.number,
    order.customerCode,
    order.customerName,
    order.warehouseCode,
    order.salesChannelCode,
    order.salesChannelName,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase('vi').includes(term));
}

function stageCountsFor(orders: SalesOrder[]) {
  const counts: Record<OrderWorkStage, number> = {
    all: orders.length,
    active: 0,
    preparing: 0,
    waiting_delivery: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const order of orders) counts[orderWorkStage(order)] += 1;
  return counts;
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
  const [orders, setOrders] = useState(initialBootstrap.salesOrders);
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialBootstrap.errors.orders);
  const [operationError, setOperationError] = useState<OrderOperationError | null>(null);
  const [search, setSearch] = useState('');
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

  const refreshOrders = useCallback(async (showNotice: boolean) => {
    setRefreshing(true);
    if (showNotice) {
      setError(null);
      setOperationError(null);
      setNotice(null);
    }
    try {
      const next = await apiRequest<SalesOrder[]>('/api/sales-orders?limit=1000');
      const sorted = [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setOrders(sorted);
      setSelected((current) => current ? sorted.find((item) => item.id === current.id) ?? null : null);
      setError(null);
      if (showNotice) setNotice('Danh sách đơn bán hàng đã được làm mới.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được danh sách đơn bán hàng');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshOrders(false);
  }, [refreshOrders]);

  const scopedOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    return orders.filter((order) => {
      if (source !== 'all' && sourceBucket(order) !== source) return false;
      if (lane !== 'all' && orderLane(order) !== lane) return false;
      return matchesSearch(order, term);
    });
  }, [orders, search, source, lane]);

  const stageCounts = useMemo(() => stageCountsFor(scopedOrders), [scopedOrders]);
  const allStageCounts = useMemo(() => stageCountsFor(orders), [orders]);

  const filtered = useMemo(
    () => workStage === 'all'
      ? scopedOrders
      : scopedOrders.filter((order) => orderWorkStage(order) === workStage),
    [scopedOrders, workStage],
  );

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
    setOrders((current) => {
      const next = current.some((item) => item.id === order.id)
        ? current.map((item) => item.id === order.id ? order : item)
        : [order, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

  const warnings = Object.values(initialBootstrap.errors).filter(Boolean);
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
          <article><strong>{orders.length}</strong><span>Tổng số đơn</span></article>
          <article><strong>{allStageCounts.active}</strong><span>Đang xử lý</span></article>
          <article><strong>{allStageCounts.waiting_delivery}</strong><span>Chờ giao</span></article>
          <article><strong>{allStageCounts.completed}</strong><span>Đã hoàn thành</span></article>
        </section>

        <section className={`${styles.filterPanel} ${polishStyles.filterPanelCompact}`} aria-label="Bộ lọc đơn bán hàng">
          <strong className={polishStyles.filterPanelTitle}>Hình thức giao</strong>
          <div className={polishStyles.filterControlRow}>
            <div className={`${styles.filterGroup} ${polishStyles.filterGroupInline}`}>
              <span className={styles.filterLabel}>Luồng bán</span>
              <div className={styles.filterChips} aria-label="Luồng bán">
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
                    {option.label} · {stageCounts[option.value]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className={styles.toolbar}>
          <label><span>Tìm đơn</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Số đơn, khách hoặc kênh bán" /></label>
          <label><span>Nguồn</span><select value={source} onChange={(event) => setSource(event.target.value as OrderSourceFilter)}><option value="all">Tất cả</option><option value="internal">Công Ty</option><option value="mcp">Nhân viên thị trường</option><option value="customer">Khách hàng</option></select></label>
          <button type="button" onClick={() => void refreshOrders(true)} disabled={refreshing}>{refreshing ? 'Đang làm mới…' : 'Làm mới'}</button>
        </div>

        <div className={styles.contentGrid}>
          <section className={styles.listPanel} aria-label="Danh sách đơn bán hàng">
            <header className={styles.panelHeading}><div><h2>Danh sách đơn</h2><p>{filtered.length} kết quả</p></div></header>
            <div className={styles.orderList}>
              {filtered.map((order, rowIndex) => (
                <button
                  type="button"
                  key={order.id}
                  className={`${styles.orderCard} ${polishStyles.orderCardGrid} ${selected?.id === order.id ? styles.orderCardActive : ''}`}
                  disabled={loadingId === order.id}
                  onClick={() => loadOrder(order.id)}
                >
                  <div className={polishStyles.orderCardMain}>
                    <div className={`${styles.orderCardTop} ${polishStyles.orderCardTopCompact}`}>
                      <div className={styles.orderCardNumber}>
                        <BusinessSequenceNumber rowIndex={rowIndex} className={styles.orderSequence} />
                        <strong>{order.number ? `#${compactOrderNumber(order.number)}` : 'Đơn đặt hàng chưa cấp số'}</strong>
                        <span className={polishStyles.orderCardNumberDivider} aria-hidden="true">|</span>
                        <strong className={polishStyles.orderCardTotal}>{formatMoney(orderCardTotal(order))}đ</strong>
                      </div>
                    </div>
                    <b>{order.customerCode} — {order.customerName}</b>
                    <div className={styles.orderCardMeta}>
                      <small>Nguồn {salesOrderSourceLabel(order.sourceType, order.sourceId)}</small>
                      <small>Kho {order.warehouseCode} · {collectionLabels[order.collectionPolicy] ?? 'Theo thỏa thuận thanh toán'}</small>
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
              {filtered.length === 0 && <p className={styles.empty}>Chưa có đơn phù hợp trong nhóm này.</p>}
            </div>
          </section>

          <SalesOrderDetail
            order={selected}
            busy={busy}
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