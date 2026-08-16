'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
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
  formatVietnamDateTime,
  mutationKey,
  orderLabels,
  pendingVersion,
} from './sales-order-ui';
import styles from './sales-orders.module.css';

type OrderSourceFilter = 'all' | 'internal' | 'mcp' | 'customer';

function sourceBucket(order: SalesOrder): Exclude<OrderSourceFilter, 'all'> {
  if (order.sourceType === 'MCP') return 'mcp';
  if (order.sourceType === 'API' && order.sourceId?.startsWith('CUSTOMER_PORTAL:')) return 'customer';
  return 'internal';
}

function orderCardStatus(order: SalesOrder): string {
  const orderStatus = orderLabels[order.status] ?? 'Trạng thái khác';
  if (order.status !== 'confirmed') return orderStatus;
  if (order.fulfillmentStatus === 'backordered') return `${orderStatus} · Chờ hàng`;
  if (order.fulfillmentStatus === 'partially_reserved') return `${orderStatus} · Chờ hàng một phần`;
  return orderStatus;
}

export default function SalesOrderWorkspace({ initialBootstrap }: { initialBootstrap: SalesOrderBootstrap }) {
  const [orders, setOrders] = useState(initialBootstrap.salesOrders);
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialBootstrap.errors.orders);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState<OrderSourceFilter>('all');
  const [formMode, setFormMode] = useState<SalesOrderFormMode | null>(null);
  const [formVersion, setFormVersion] = useState<SalesOrderVersion | null>(null);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');

  const permissions = useMemo(() => new Set(initialBootstrap.permissionKeys), [initialBootstrap.permissionKeys]);
  const canCreate = permissions.has(SALES_ORDER_PERMISSION_KEYS.create);
  const canUpdate = permissions.has(SALES_ORDER_PERMISSION_KEYS.updateDraft);
  const canConfirm = permissions.has(SALES_ORDER_PERMISSION_KEYS.confirm);
  const canAmend = permissions.has(SALES_ORDER_PERMISSION_KEYS.amend);
  const canCancel = permissions.has(SALES_ORDER_PERMISSION_KEYS.cancel);
  const canPriceOverride = permissions.has(SALES_ORDER_PERMISSION_KEYS.priceOverride);
  const canDiscountOverride = permissions.has(SALES_ORDER_PERMISSION_KEYS.discountOverride);
  const canQuickCreateCustomer = permissions.has(SALES_ORDER_PERMISSION_KEYS.customerWrite);

  const refreshOrders = useCallback(async (showNotice: boolean) => {
    setRefreshing(true);
    if (showNotice) {
      setError(null);
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

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    return orders.filter((order) => {
      if (status !== 'all' && order.status !== status) return false;
      if (source !== 'all' && sourceBucket(order) !== source) return false;
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
    });
  }, [orders, search, status, source]);

  const handleFormError = useCallback((message: string) => {
    setError(message || null);
  }, []);

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
  }

  async function action(kind: 'confirm' | 'amend' | 'confirm-amendment' | 'cancel') {
    if (!selected) return;
    setBusy(true);
    setError(null);
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
      setError(caught instanceof Error ? caught.message : 'Thao tác bán hàng không thành công');
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
        {(notice || error || warnings.length > 0) && (
          <div className={`${styles.banner} ${error || warnings.length > 0 ? styles.bannerError : styles.bannerSuccess}`} role="status">
            {error ?? notice ?? warnings.join(' · ')}
          </div>
        )}

        <section className={styles.summaryGrid} aria-label="Tổng hợp đơn bán hàng">
          <article><strong>{orders.length}</strong><span>Tổng số đơn</span></article>
          <article><strong>{orders.filter((item) => item.status === 'draft').length}</strong><span>Đang nháp</span></article>
          <article><strong>{orders.filter((item) => item.status === 'confirmed').length}</strong><span>Đã xác nhận</span></article>
          <article><strong>{orders.filter((item) => item.deliveryStatus === 'pending').length}</strong><span>Chờ giao</span></article>
        </section>

        <div className={styles.toolbar}>
          <label><span>Tìm đơn</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Số đơn, khách hoặc kênh bán" /></label>
          <label><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả</option><option value="draft">Nháp</option><option value="confirmed">Đã xác nhận</option><option value="cancelled">Đã hủy</option><option value="closed">Đã hoàn tất</option></select></label>
          <label><span>Nguồn</span><select value={source} onChange={(event) => setSource(event.target.value as OrderSourceFilter)}><option value="all">Tất cả</option><option value="internal">Công Ty</option><option value="mcp">Nhân viên thị trường</option><option value="customer">Khách hàng</option></select></label>
          <button type="button" onClick={() => void refreshOrders(true)} disabled={refreshing}>{refreshing ? 'Đang làm mới…' : 'Làm mới'}</button>
        </div>

        <div className={styles.contentGrid}>
          <section className={styles.listPanel} aria-label="Danh sách đơn bán hàng">
            <header className={styles.panelHeading}><div><h2>Danh sách đơn</h2><p>{filtered.length} kết quả</p></div></header>
            <div className={styles.orderList}>
              {filtered.map((order) => (
                <button
                  type="button"
                  key={order.id}
                  className={`${styles.orderCard} ${selected?.id === order.id ? styles.orderCardActive : ''}`}
                  disabled={loadingId === order.id}
                  onClick={() => loadOrder(order.id)}
                >
                  <div className={styles.orderCardTop}><strong>{order.number ?? 'Đơn nháp chưa cấp số'}</strong><span>{orderCardStatus(order)}</span></div>
                  <b>{order.customerCode} — {order.customerName}</b>
                  <div className={styles.orderCardMeta}>
                    <small>Nguồn {salesOrderSourceLabel(order.sourceType, order.sourceId)}</small>
                    <small>Kho {order.warehouseCode} · {collectionLabels[order.collectionPolicy] ?? 'Theo thỏa thuận thanh toán'}</small>
                    <small>Kênh {order.salesChannelCode ?? 'chưa xác định'}{order.salesChannelName ? ` — ${order.salesChannelName}` : ''}</small>
                    <small>Cập nhật {formatVietnamDateTime(order.updatedAt)}</small>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <p className={styles.empty}>Chưa có đơn phù hợp.</p>}
            </div>
          </section>

          <SalesOrderDetail
            order={selected}
            busy={busy}
            canUpdate={canUpdate}
            canConfirm={canConfirm}
            canAmend={canAmend}
            canCancel={canCancel}
            amendmentReason={amendmentReason}
            cancellationReason={cancellationReason}
            onAmendmentReason={setAmendmentReason}
            onCancellationReason={setCancellationReason}
            onEditDraft={() => openForm('draft', activeVersion(selected))}
            onEditAmendment={() => openForm('amendment', pendingVersion(selected))}
            onConfirm={() => action('confirm')}
            onCreateAmendment={() => action('amend')}
            onConfirmAmendment={() => action('confirm-amendment')}
            onCancel={() => action('cancel')}
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
          canConfirm={formMode === 'amendment' ? canAmend : canConfirm}
          canQuickCreateCustomer={canQuickCreateCustomer}
          canPriceOverride={canPriceOverride}
          canDiscountOverride={canDiscountOverride}
          onClose={() => setFormMode(null)}
          onError={handleFormError}
          onSaved={(order) => {
            mergeOrder(order);
            setFormMode(null);
            setError(null);
            setNotice(order.status === 'confirmed'
              ? 'Đã lưu, xác nhận và cấp số đơn bán hàng'
              : formMode === 'create' ? 'Đã tạo đơn bán hàng nháp' : 'Đã lưu phiên bản nháp');
          }}
        />
      )}
    </AppShell>
  );
}
