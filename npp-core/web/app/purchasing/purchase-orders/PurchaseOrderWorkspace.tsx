'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './purchase-orders.module.css';
import type { PurchaseOrderBootstrap } from '../../../lib/purchase-order-bootstrap';
import type { PurchaseOrder, PurchaseOrderStatus } from '../../../lib/purchase-order-types';
import type { GoodsReceipt } from '../../../lib/goods-receipt-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
  formatPurchaseOrderDate,
  purchaseOrderActionPolicy,
  PURCHASE_ORDER_STATUS_LABELS,
} from '../../../lib/purchase-order-types';
import {
  formatGoodsReceiptDate,
  GOODS_RECEIPT_STATUS_LABELS,
} from '../../../lib/goods-receipt-types';
import PurchaseOrderList from './components/PurchaseOrderList';
import PurchaseOrderEditor from './components/PurchaseOrderEditor';
import { describePurchaseOrderLookupIssues } from './purchase-order-lookup-state';
import { shouldShowPurchaseOrderProductsCatalogLink } from '../../../lib/purchase-order-products-link';

type Props = {
  initialBootstrap: PurchaseOrderBootstrap;
  initialSearch: string;
};

type StatusFilter = PurchaseOrderStatus | 'all';
type OrderListState = 'fresh' | 'stale' | 'unknown';
type EditorState = { mode: 'create' | 'edit'; purchaseOrder: PurchaseOrder | null } | null;
type ActionName = 'submit' | 'approve' | 'cancel';
type ActionState = { action: ActionName; purchaseOrder: PurchaseOrder } | null;

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu đơn đặt hàng');
  }
  return payload.data;
}

function actionLabel(action: ActionName) {
  if (action === 'submit') return 'Gửi duyệt';
  if (action === 'approve') return 'Duyệt đơn';
  return 'Hủy đơn';
}

function actionMessage(action: ActionName, purchaseOrder: PurchaseOrder) {
  const identifier = purchaseOrder.number || 'đơn chưa cấp số';
  if (action === 'submit') return `Gửi ${identifier} sang trạng thái chờ duyệt? Sau đó nội dung đơn sẽ không còn được sửa trực tiếp.`;
  if (action === 'approve') return `Duyệt ${identifier} và cấp số chứng từ chính thức?`;
  return `Hủy ${identifier}? Lịch sử đơn vẫn được giữ lại để đối soát.`;
}

export default function PurchaseOrderWorkspace({
  initialBootstrap,
  initialSearch,
}: Props) {
  const [bootstrap, setBootstrap] = useState<PurchaseOrderBootstrap>(initialBootstrap);
  const [error, setError] = useState<string | null>(null);
  const [orderListState, setOrderListState] = useState<OrderListState>(
    initialBootstrap.errors.orders ? 'unknown' : 'fresh',
  );
  const [orderListError, setOrderListError] = useState<string | null>(initialBootstrap.errors.orders);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [selectedReceipts, setSelectedReceipts] = useState<GoodsReceipt[]>([]);
  const [receiptSummaryLoading, setReceiptSummaryLoading] = useState(false);
  const [receiptSummaryError, setReceiptSummaryError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingAction, setPendingAction] = useState<ActionState>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const actionKeys = useRef(new Map<string, string>());

  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleItems = useMemo(() => bootstrap.purchaseOrders.filter((purchaseOrder) => {
    const matchesStatus = statusFilter === 'all' || purchaseOrder.status === statusFilter;
    const searchable = [
      purchaseOrder.number,
      purchaseOrder.supplierCode,
      purchaseOrder.supplierName,
      purchaseOrder.warehouseCode,
      purchaseOrder.warehouseName,
      purchaseOrder.supplierReference,
      ...(purchaseOrder.lines ?? []).flatMap((line) => [line.skuCode, line.itemName]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('vi-VN');
    return matchesStatus && (!normalizedSearch || searchable.includes(normalizedSearch));
  }), [bootstrap.purchaseOrders, normalizedSearch, statusFilter]);

  const counts = useMemo(() => ({
    total: bootstrap.purchaseOrders.length,
    draft: bootstrap.purchaseOrders.filter((item) => item.status === 'draft').length,
    pending: bootstrap.purchaseOrders.filter((item) => item.status === 'pending_approval').length,
  }), [bootstrap.purchaseOrders]);

  const orderCountsKnown = orderListState !== 'unknown';
  const canRenderOrderList = orderListState === 'fresh' || bootstrap.purchaseOrders.length > 0;
  const countValue = (value: number) => orderCountsKnown ? formatDecimalString(String(value)) : '—';
  const listStateHint = orderListState === 'unknown'
    ? 'Chưa xác định do tải danh sách lỗi'
    : orderListState === 'stale'
      ? 'Dữ liệu gần nhất — lần cập nhật mới bị lỗi'
      : null;

  const createPolicy = purchaseOrderActionPolicy('draft', bootstrap.permissionKeys);
  const lookupIssues = useMemo(() => describePurchaseOrderLookupIssues(bootstrap), [bootstrap]);
  const lookupReady = lookupIssues.length === 0;
  const lookupMessage = lookupIssues.length > 0 ? lookupIssues.join(' · ') : null;
  const showProductsCatalogLink = shouldShowPurchaseOrderProductsCatalogLink(bootstrap);

  useEffect(() => {
    if (selectedPurchaseOrder || pendingAction) closeButtonRef.current?.focus();
  }, [pendingAction, selectedPurchaseOrder]);

  function closeDetail() {
    setSelectedPurchaseOrder(null);
    setSelectedReceipts([]);
    setReceiptSummaryError(null);
    setReceiptSummaryLoading(false);
  }

  function upsertOrder(purchaseOrder: PurchaseOrder) {
    setBootstrap((current) => {
      const index = current.purchaseOrders.findIndex((item) => item.id === purchaseOrder.id);
      const purchaseOrders = index < 0
        ? [purchaseOrder, ...current.purchaseOrders]
        : current.purchaseOrders.map((item) => (item.id === purchaseOrder.id ? purchaseOrder : item));
      return { ...current, purchaseOrders };
    });
  }

  async function loadAll(successMessage?: string) {
    setLoadingList(true);
    setError(null);
    setNotice(null);
    try {
      const next = await requestJson<PurchaseOrderBootstrap>('/api/purchase-orders/bootstrap');
      setBootstrap((current) => ({
        ...current,
        purchaseOrders: next.errors.orders ? current.purchaseOrders : next.purchaseOrders,
        suppliers: next.errors.suppliers ? current.suppliers : next.suppliers,
        warehouses: next.errors.warehouses ? current.warehouses : next.warehouses,
        products: next.errors.products ? current.products : next.products,
        permissionKeys: next.errors.permissions ? [] : next.permissionKeys,
        errors: next.errors,
        checkedAt: next.checkedAt,
        lookupError: next.lookupError,
      }));
      setOrderListState((current) => next.errors.orders
        ? (current === 'unknown' ? 'unknown' : 'stale')
        : 'fresh');
      setOrderListError(next.errors.orders);
      if (successMessage && !next.errors.orders && !next.errors.suppliers && !next.errors.warehouses && !next.errors.products && !next.errors.permissions) {
        setNotice(successMessage);
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Không tải được danh sách đơn đặt hàng';
      setOrderListState((current) => current === 'unknown' ? 'unknown' : 'stale');
      setOrderListError(message);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(purchaseOrder: PurchaseOrder): Promise<PurchaseOrder | null> {
    setBusyId(purchaseOrder.id);
    setError(null);
    try {
      return await requestJson<PurchaseOrder>(`/api/purchase-orders/${purchaseOrder.id}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết đơn đặt hàng');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function openView(purchaseOrder: PurchaseOrder) {
    const detail = await loadDetail(purchaseOrder);
    if (!detail) return;
    setSelectedPurchaseOrder(detail);
    setSelectedReceipts([]);
    setReceiptSummaryError(null);
    setReceiptSummaryLoading(true);
    try {
      const receipts = await requestJson<GoodsReceipt[]>(`/api/goods-receipts?purchaseOrderId=${encodeURIComponent(detail.id)}&limit=1000`);
      setSelectedReceipts(receipts);
    } catch (loadError) {
      setReceiptSummaryError(loadError instanceof Error ? loadError.message : 'Không tải được lịch sử nhận hàng');
    } finally {
      setReceiptSummaryLoading(false);
    }
  }

  async function openEdit(purchaseOrder: PurchaseOrder) {
    const detail = await loadDetail(purchaseOrder);
    if (detail) setEditor({ mode: 'edit', purchaseOrder: detail });
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    if (!lookupReady) {
      setError(lookupMessage || 'Chưa đủ dữ liệu nhà cung cấp, kho hoặc sản phẩm để tạo đơn.');
      return;
    }
    setEditor({ mode: 'create', purchaseOrder: null });
  }

  function openAction(action: ActionName, purchaseOrder: PurchaseOrder) {
    setError(null);
    setNotice(null);
    setCancellationReason('');
    setPendingAction({ action, purchaseOrder });
  }

  function actionKey(action: ActionName, purchaseOrder: PurchaseOrder) {
    const identity = `${action}:${purchaseOrder.id}:${purchaseOrder.revision}`;
    const existing = actionKeys.current.get(identity);
    if (existing) return existing;
    const key = `po-${action}-${crypto.randomUUID()}`;
    actionKeys.current.set(identity, key);
    return key;
  }

  async function runAction() {
    if (!pendingAction) return;
    if (pendingAction.action === 'cancel' && !cancellationReason.trim()) {
      setError('Vui lòng nhập lý do hủy đơn.');
      return;
    }
    const { action, purchaseOrder } = pendingAction;
    const identity = `${action}:${purchaseOrder.id}:${purchaseOrder.revision}`;
    setBusyId(purchaseOrder.id);
    setError(null);
    try {
      const updated = await requestJson<PurchaseOrder>(
        `/api/purchase-orders/${purchaseOrder.id}/${action}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': actionKey(action, purchaseOrder) },
          body: JSON.stringify({
            expectedRevision: purchaseOrder.revision,
            ...(action === 'cancel' ? { reason: cancellationReason.trim() } : {}),
          }),
        },
      );
      actionKeys.current.delete(identity);
      upsertOrder(updated);
      setPendingAction(null);
      setCancellationReason('');
      setNotice(
        action === 'submit'
          ? 'Đơn đặt hàng đã được gửi duyệt.'
          : action === 'approve'
            ? `Đơn đặt hàng đã được duyệt với số ${updated.number}.`
            : 'Đơn đặt hàng đã được hủy.',
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Không cập nhật được trạng thái đơn đặt hàng');
    } finally {
      setBusyId(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={() => void loadAll('Danh sách đơn đặt hàng và dữ liệu tạo đơn đã được cập nhật.')}
        disabled={loadingList}
        data-testid="purchase-order-refresh-button"
      >
        {loadingList ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      {createPolicy.create ? (
        <button
          type="button"
          className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
          onClick={openCreate}
          disabled={!lookupReady}
          data-testid="purchase-order-create-button"
        >
          Tạo đơn đặt hàng
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      title="Đơn đặt hàng"
      subtitle="Tạo, gửi duyệt và phê duyệt nhu cầu mua từ nhà cung cấp trước khi nhận hàng."
      kicker="Mua hàng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="purchase-orders-page">
        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
        {orderListError ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert" data-testid="purchase-order-data-state-banner">
            {orderListState === 'stale'
              ? `Không cập nhật được danh sách đơn đặt hàng. Đang giữ dữ liệu từ lần tải thành công gần nhất. ${orderListError}`
              : `Chưa xác định được danh sách đơn đặt hàng hiện tại. ${orderListError}`}
          </div>
        ) : null}
        {lookupMessage ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{lookupMessage}</div> : null}
        {showProductsCatalogLink ? (
          <p className={localStyles.contextualHelp}>
            Mở{' '}
            <Link href="/products" className={localStyles.contextualLink} data-testid="purchase-order-products-link">
              Danh mục sản phẩm
            </Link>{' '}
            để bổ sung SKU mua hàng hợp lệ.
          </p>
        ) : null}
        {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">{notice}</div> : null}

        <section className={styles.summaryGrid} aria-label="Số liệu đơn đặt hàng">
          <article className={styles.summaryCard}>
            <span>Tổng đơn</span><strong data-testid="purchase-order-total-count">{countValue(counts.total)}</strong><small>{listStateHint || 'Trong phạm vi kho được cấp'}</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đơn nháp</span><strong>{countValue(counts.draft)}</strong><small>{listStateHint || 'Còn có thể chỉnh sửa'}</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Chờ duyệt</span><strong>{countValue(counts.pending)}</strong><small>{listStateHint || 'Cần người có quyền phê duyệt'}</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Bộ lọc đơn đặt hàng">
          <div className={styles.toolbarSearch}>
            <label htmlFor="purchase-order-search">Tìm kiếm</label>
            <input id="purchase-order-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Số đơn, nhà cung cấp, kho nhận hoặc mã hàng…" data-testid="purchase-order-search" />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="purchase-order-status">Trạng thái</label>
            <select id="purchase-order-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} data-testid="purchase-order-status-filter">
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(PURCHASE_ORDER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div><p className={styles.panelKicker}>Danh sách mua hàng</p><h2>Đơn đặt hàng nhà cung cấp</h2></div>
            <span className={styles.panelChip} data-testid="purchase-order-list-count">
              {orderListState === 'unknown'
                ? 'Chưa xác định'
                : `${formatDecimalString(String(visibleItems.length))} đơn${orderListState === 'stale' ? ' · dữ liệu cũ' : ''}`}
            </span>
          </div>
          {canRenderOrderList ? (
            <PurchaseOrderList
              purchaseOrders={visibleItems}
              permissionKeys={bootstrap.permissionKeys}
              busyId={busyId}
              onView={(purchaseOrder) => void openView(purchaseOrder)}
              onEdit={(purchaseOrder) => void openEdit(purchaseOrder)}
              onSubmit={(purchaseOrder) => openAction('submit', purchaseOrder)}
              onApprove={(purchaseOrder) => openAction('approve', purchaseOrder)}
              onCancel={(purchaseOrder) => openAction('cancel', purchaseOrder)}
            />
          ) : (
            <div className={styles.emptyState} data-testid="purchase-order-list-unavailable">
              {orderListState === 'stale'
                ? 'Lần tải thành công gần nhất không có đơn; lần cập nhật hiện tại thất bại nên chưa thể khẳng định danh sách hiện tại đang rỗng.'
                : 'Chưa xác định được danh sách đơn đặt hàng hiện tại. Hãy cập nhật dữ liệu để thử lại.'}
            </div>
          )}
        </section>
      </section>

      {editor ? (
        <PurchaseOrderEditor
          mode={editor.mode}
          purchaseOrder={editor.purchaseOrder}
          suppliers={bootstrap.suppliers}
          warehouses={bootstrap.warehouses}
          products={bootstrap.products}
          onClose={() => setEditor(null)}
          onSaved={(purchaseOrder) => {
            upsertOrder(purchaseOrder);
            setEditor(null);
            setNotice(editor.mode === 'create' ? 'Đã tạo đơn đặt hàng nháp.' : 'Đã cập nhật đơn đặt hàng nháp.');
          }}
        />
      ) : null}

      {selectedPurchaseOrder ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeDetail(); }} onKeyDown={(event) => { if (event.key === 'Escape') closeDetail(); }}>
          <section className={`${styles.modal} ${localStyles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="purchase-order-detail-title">
            <div className={styles.modalHeader}>
              <div><p className={styles.panelKicker}>Chi tiết đơn đặt hàng</p><h3 id="purchase-order-detail-title">{selectedPurchaseOrder.number || 'Đơn chưa cấp số'}</h3></div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={closeDetail}>Đóng</button>
            </div>
            <div className={localStyles.detailGrid}>
              <div className={localStyles.detailItem}><span>Trạng thái</span><strong>{PURCHASE_ORDER_STATUS_LABELS[selectedPurchaseOrder.status]}</strong></div>
              <div className={localStyles.detailItem}><span>Nhà cung cấp</span><strong>{selectedPurchaseOrder.supplierCode} — {selectedPurchaseOrder.supplierName}</strong></div>
              <div className={localStyles.detailItem}><span>Kho nhận</span><strong>{selectedPurchaseOrder.warehouseCode} — {selectedPurchaseOrder.warehouseName}</strong></div>
              <div className={localStyles.detailItem}><span>Ngày đặt</span><strong>{formatPurchaseOrderDate(selectedPurchaseOrder.placedAt)}</strong></div>
              <div className={localStyles.detailItem}><span>Dự kiến nhận</span><strong>{formatPurchaseOrderDate(selectedPurchaseOrder.expectedAt)}</strong></div>
              <div className={localStyles.detailItem}><span>Tham chiếu NCC</span><strong>{selectedPurchaseOrder.supplierReference || 'Không có'}</strong></div>
              <div className={localStyles.detailItem}><span>Số phiếu nhận</span><strong>{formatDecimalString(String(selectedPurchaseOrder.receiptCount ?? 0))}</strong></div>
              <div className={localStyles.detailItem}><span>Thực nhận</span><strong>{formatDecimalString(selectedPurchaseOrder.receivedQuantityTotal ?? '0')}</strong></div>
              <div className={localStyles.detailItem}><span>Chấp nhận</span><strong>{formatDecimalString(selectedPurchaseOrder.acceptedQuantityTotal ?? '0')}</strong></div>
              <div className={localStyles.detailItem}><span>Loại</span><strong>{formatDecimalString(selectedPurchaseOrder.rejectedQuantityTotal ?? '0')}</strong></div>
              <div className={localStyles.detailItem}><span>Chốt thiếu</span><strong>{formatDecimalString(selectedPurchaseOrder.shortageClosedQuantityTotal ?? '0')}</strong></div>
              <div className={localStyles.detailItem}><span>Còn lại</span><strong>{formatDecimalString(selectedPurchaseOrder.remainingQuantityTotal ?? '0')}</strong></div>
            </div>
            <div className={localStyles.linesWrap}>
              <div className={styles.sectionHeader}>
                <div><p className={styles.panelKicker}>Lịch sử nhận hàng</p><h4>Phiếu nhận của đơn</h4></div>
                <span className={styles.panelChip}>{formatDecimalString(String(selectedReceipts.length))} phiếu</span>
              </div>
              {receiptSummaryLoading ? <p role="status">Đang tải lịch sử nhận hàng…</p> : null}
              {receiptSummaryError ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{receiptSummaryError}</div> : null}
              {!receiptSummaryLoading && !receiptSummaryError && selectedReceipts.length === 0 ? <p>Chưa có phiếu nhận hàng.</p> : null}
              {selectedReceipts.length > 0 ? (
                <table className={localStyles.linesTable} data-testid="purchase-order-receipts-table">
                  <thead><tr><th>Số phiếu</th><th>Ngày nhận</th><th>Trạng thái</th><th>Tham chiếu NCC</th><th>Số lượng nhận</th></tr></thead>
                  <tbody>
                    {selectedReceipts.map((receipt) => (
                      <tr key={receipt.id}>
                        <td>{receipt.documentNumber || 'Chưa cấp số'}</td>
                        <td>{formatGoodsReceiptDate(receipt.receiptDate)}</td>
                        <td>{GOODS_RECEIPT_STATUS_LABELS[receipt.status]}</td>
                        <td>{receipt.supplierDeliveryReference || 'Không có'}</td>
                        <td>{formatDecimalString(receipt.receivedQuantityTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className={localStyles.linesWrap}>
              <table className={localStyles.linesTable}>
                <thead><tr><th>SKU</th><th>Số lượng</th><th>Thực nhận</th><th>Chấp nhận</th><th>Loại</th><th>Chốt thiếu</th><th>Còn lại</th><th>Đơn vị</th><th>Quy đổi</th><th>Đơn giá</th><th>Chiết khấu</th><th>Thuế</th><th>Thành tiền</th></tr></thead>
                <tbody>
                  {(selectedPurchaseOrder.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td><div className={localStyles.lineIdentity}><strong>{line.skuCode}</strong><span>{line.itemName}</span></div></td>
                      <td>{formatDecimalString(line.quantity)}</td>
                      <td>{formatDecimalString(line.receivedQuantity ?? '0')}</td>
                      <td>{formatDecimalString(line.acceptedQuantity ?? '0')}</td>
                      <td>{formatDecimalString(line.rejectedQuantity ?? '0')}</td>
                      <td>{formatDecimalString(line.shortageClosedQuantity ?? '0')}</td>
                      <td>{formatDecimalString(line.remainingQuantity ?? line.quantity)}</td>
                      <td>{line.unitCode}</td>
                      <td>{formatDecimalString(line.conversionToBase)}</td>
                      <td>{formatPurchaseOrderAmount(line.unitPrice, selectedPurchaseOrder.currency)}</td>
                      <td>{formatPurchaseOrderAmount(line.discountAmount, selectedPurchaseOrder.currency)}</td>
                      <td>{formatPurchaseOrderAmount(line.taxAmount, selectedPurchaseOrder.currency)}</td>
                      <td>{formatPurchaseOrderAmount(line.lineTotal, selectedPurchaseOrder.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={localStyles.totals}>
              <div className={localStyles.totalCard}><span>Tiền hàng</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.subtotal, selectedPurchaseOrder.currency)}</strong></div>
              <div className={localStyles.totalCard}><span>Chiết khấu</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.discountTotal, selectedPurchaseOrder.currency)}</strong></div>
              <div className={localStyles.totalCard}><span>Thuế</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.taxTotal, selectedPurchaseOrder.currency)}</strong></div>
              <div className={localStyles.totalCard}><span>Tổng cộng</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.total, selectedPurchaseOrder.currency)}</strong></div>
            </div>
            <div className={localStyles.modalActions}><button type="button" className={styles.secondaryButton} onClick={closeDetail}>Đóng chi tiết</button></div>
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busyId) setPendingAction(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busyId) setPendingAction(null); }}>
          <section className={`${styles.modal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-labelledby="purchase-order-action-title">
            <div className={styles.modalHeader}>
              <div><p className={styles.panelKicker}>Xác nhận nghiệp vụ</p><h3 id="purchase-order-action-title">{actionLabel(pendingAction.action)}</h3></div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>Đóng</button>
            </div>
            <p className={localStyles.actionCopy}>{actionMessage(pendingAction.action, pendingAction.purchaseOrder)}</p>
            {pendingAction.action === 'cancel' ? (
              <div className={styles.form}><label>Lý do hủy<input value={cancellationReason} maxLength={1000} onChange={(event) => setCancellationReason(event.target.value)} autoFocus /></label></div>
            ) : null}
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>Quay lại</button>
              <button type="button" className={styles.primaryButton} onClick={() => void runAction()} disabled={Boolean(busyId)} data-testid={`purchase-order-${pendingAction.action}-confirm`}>
                {busyId ? 'Đang xử lý…' : actionLabel(pendingAction.action)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
