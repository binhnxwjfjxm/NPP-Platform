'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './purchase-orders.module.css';
import type { Supplier } from '../../../lib/supplier-types';
import type { Product } from '../../../lib/product-types';
import type { Warehouse } from '../../../lib/organization-types';
import type { PurchaseOrder, PurchaseOrderStatus } from '../../../lib/purchase-order-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
  formatPurchaseOrderDate,
  purchaseOrderActionPolicy,
  PURCHASE_ORDER_STATUS_LABELS,
} from '../../../lib/purchase-order-types';
import PurchaseOrderList from './components/PurchaseOrderList';
import PurchaseOrderEditor from './components/PurchaseOrderEditor';

type Props = {
  initialPurchaseOrders: PurchaseOrder[];
  initialSuppliers: Supplier[];
  initialWarehouses: Warehouse[];
  initialProducts: Product[];
  initialError: string | null;
  initialLookupError: string | null;
  initialPermissionKeys: string[];
};

type StatusFilter = PurchaseOrderStatus | 'all';
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
    throw new Error(payload.error?.message || 'KhÃ´ng thá»±c hiá»‡n Ä‘Æ°á»£c yÃªu cáº§u Ä‘Æ¡n Ä‘áº·t hÃ ng');
  }
  return payload.data;
}

function actionLabel(action: ActionName) {
  if (action === 'submit') return 'Gá»­i duyá»‡t';
  if (action === 'approve') return 'Duyá»‡t Ä‘Æ¡n';
  return 'Há»§y Ä‘Æ¡n';
}

function actionMessage(action: ActionName, purchaseOrder: PurchaseOrder) {
  const identifier = purchaseOrder.number || 'Ä‘Æ¡n chÆ°a cáº¥p sá»‘';
  if (action === 'submit') return `Gá»­i ${identifier} sang tráº¡ng thÃ¡i chá» duyá»‡t? Sau Ä‘Ã³ ná»™i dung Ä‘Æ¡n sáº½ khÃ´ng cÃ²n Ä‘Æ°á»£c sá»­a trá»±c tiáº¿p.`;
  if (action === 'approve') return `Duyá»‡t ${identifier} vÃ  cáº¥p sá»‘ chá»©ng tá»« chÃ­nh thá»©c?`;
  return `Há»§y ${identifier}? Lá»‹ch sá»­ Ä‘Æ¡n váº«n Ä‘Æ°á»£c giá»¯ láº¡i Ä‘á»ƒ Ä‘á»‘i soÃ¡t.`;
}

export default function PurchaseOrderWorkspace({
  initialPurchaseOrders,
  initialSuppliers,
  initialWarehouses,
  initialProducts,
  initialError,
  initialLookupError,
  initialPermissionKeys,
}: Props) {
  const [items, setItems] = useState<PurchaseOrder[]>(initialPurchaseOrders);
  const [error, setError] = useState<string | null>(initialError || initialLookupError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingAction, setPendingAction] = useState<ActionState>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const actionKeys = useRef(new Map<string, string>());

  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleItems = useMemo(() => items.filter((purchaseOrder) => {
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
  }), [items, normalizedSearch, statusFilter]);

  const counts = useMemo(() => ({
    total: items.length,
    draft: items.filter((item) => item.status === 'draft').length,
    pending: items.filter((item) => item.status === 'pending_approval').length,
  }), [items]);

  const createPolicy = purchaseOrderActionPolicy('draft', initialPermissionKeys);
  const lookupReady = initialSuppliers.length > 0 && initialWarehouses.length > 0 && initialProducts.length > 0;

  useEffect(() => {
    if (selectedPurchaseOrder || pendingAction) closeButtonRef.current?.focus();
  }, [pendingAction, selectedPurchaseOrder]);

  function upsertOrder(purchaseOrder: PurchaseOrder) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === purchaseOrder.id);
      if (index < 0) return [purchaseOrder, ...current];
      return current.map((item) => (item.id === purchaseOrder.id ? purchaseOrder : item));
    });
  }

  async function loadAll(successMessage?: string) {
    setLoadingList(true);
    setError(null);
    try {
      const orders = await requestJson<PurchaseOrder[]>('/api/purchase-orders?limit=1000');
      setItems(orders);
      if (successMessage) setNotice(successMessage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c danh sÃ¡ch Ä‘Æ¡n Ä‘áº·t hÃ ng');
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
      setError(loadError instanceof Error ? loadError.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c chi tiáº¿t Ä‘Æ¡n Ä‘áº·t hÃ ng');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function openView(purchaseOrder: PurchaseOrder) {
    const detail = await loadDetail(purchaseOrder);
    if (detail) setSelectedPurchaseOrder(detail);
  }

  async function openEdit(purchaseOrder: PurchaseOrder) {
    const detail = await loadDetail(purchaseOrder);
    if (detail) setEditor({ mode: 'edit', purchaseOrder: detail });
  }

  function openCreate() {
    setError(null);
    setNotice(null);
    if (!lookupReady) {
      setError('ChÆ°a Ä‘á»§ dá»¯ liá»‡u nhÃ  cung cáº¥p, kho hoáº·c sáº£n pháº©m Ä‘á»ƒ táº¡o Ä‘Æ¡n.');
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
      setError('Vui lÃ²ng nháº­p lÃ½ do há»§y Ä‘Æ¡n.');
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
          ? 'ÄÆ¡n Ä‘áº·t hÃ ng Ä‘Ã£ Ä‘Æ°á»£c gá»­i duyá»‡t.'
          : action === 'approve'
            ? `ÄÆ¡n Ä‘áº·t hÃ ng Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t vá»›i sá»‘ ${updated.number}.`
            : 'ÄÆ¡n Ä‘áº·t hÃ ng Ä‘Ã£ Ä‘Æ°á»£c há»§y.',
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'KhÃ´ng cáº­p nháº­t Ä‘Æ°á»£c tráº¡ng thÃ¡i Ä‘Æ¡n Ä‘áº·t hÃ ng');
    } finally {
      setBusyId(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={() => void loadAll('Danh sÃ¡ch Ä‘Æ¡n Ä‘áº·t hÃ ng Ä‘Ã£ Ä‘Æ°á»£c cáº­p nháº­t.')}
        disabled={loadingList}
      >
        {loadingList ? 'Äang cáº­p nháº­tâ€¦' : 'Cáº­p nháº­t dá»¯ liá»‡u'}
      </button>
      {createPolicy.create ? (
        <button
          type="button"
          className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
          onClick={openCreate}
          data-testid="purchase-order-create-button"
        >
          Táº¡o Ä‘Æ¡n Ä‘áº·t hÃ ng
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      title="ÄÆ¡n Ä‘áº·t hÃ ng"
      subtitle="Táº¡o, gá»­i duyá»‡t vÃ  phÃª duyá»‡t nhu cáº§u mua tá»« nhÃ  cung cáº¥p trÆ°á»›c khi nháº­n hÃ ng."
      kicker="Mua hÃ ng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="purchase-orders-page">
        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
        {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">{notice}</div> : null}
        {initialPermissionKeys.length === 0 ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            ChÆ°a nháº­n Ä‘Æ°á»£c quyá»n mua hÃ ng tá»« backend. Táº¥t cáº£ hÃ nh Ä‘á»™ng thay Ä‘á»•i dá»¯ liá»‡u Ä‘ang bá»‹ khÃ³a.
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Sá»‘ liá»‡u Ä‘Æ¡n Ä‘áº·t hÃ ng">
          <article className={styles.summaryCard}>
            <span>Tá»•ng Ä‘Æ¡n</span><strong>{formatDecimalString(String(counts.total))}</strong><small>Trong pháº¡m vi kho Ä‘Æ°á»£c cáº¥p</small>
          </article>
          <article className={styles.summaryCard}>
            <span>ÄÆ¡n nhÃ¡p</span><strong>{formatDecimalString(String(counts.draft))}</strong><small>CÃ²n cÃ³ thá»ƒ chá»‰nh sá»­a</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Chá» duyá»‡t</span><strong>{formatDecimalString(String(counts.pending))}</strong><small>Cáº§n ngÆ°á»i cÃ³ quyá»n phÃª duyá»‡t</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Bá»™ lá»c Ä‘Æ¡n Ä‘áº·t hÃ ng">
          <div className={styles.toolbarSearch}>
            <label htmlFor="purchase-order-search">TÃ¬m kiáº¿m</label>
            <input id="purchase-order-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sá»‘ Ä‘Æ¡n, nhÃ  cung cáº¥p, kho nháº­n hoáº·c mÃ£ hÃ ngâ€¦" data-testid="purchase-order-search" />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="purchase-order-status">Tráº¡ng thÃ¡i</label>
            <select id="purchase-order-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} data-testid="purchase-order-status-filter">
              <option value="all">Táº¥t cáº£ tráº¡ng thÃ¡i</option>
              {Object.entries(PURCHASE_ORDER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div><p className={styles.panelKicker}>Danh sÃ¡ch mua hÃ ng</p><h2>ÄÆ¡n Ä‘áº·t hÃ ng nhÃ  cung cáº¥p</h2></div>
            <span className={styles.panelChip}>{formatDecimalString(String(visibleItems.length))} Ä‘Æ¡n</span>
          </div>
          <PurchaseOrderList
            purchaseOrders={visibleItems}
            permissionKeys={initialPermissionKeys}
            busyId={busyId}
            onView={(purchaseOrder) => void openView(purchaseOrder)}
            onEdit={(purchaseOrder) => void openEdit(purchaseOrder)}
            onSubmit={(purchaseOrder) => openAction('submit', purchaseOrder)}
            onApprove={(purchaseOrder) => openAction('approve', purchaseOrder)}
            onCancel={(purchaseOrder) => openAction('cancel', purchaseOrder)}
          />
        </section>
      </section>

      {editor ? (
        <PurchaseOrderEditor
          mode={editor.mode}
          purchaseOrder={editor.purchaseOrder}
          suppliers={initialSuppliers}
          warehouses={initialWarehouses}
          products={initialProducts}
          onClose={() => setEditor(null)}
          onSaved={(purchaseOrder) => {
            upsertOrder(purchaseOrder);
            setEditor(null);
            setNotice(editor.mode === 'create' ? 'ÄÃ£ táº¡o Ä‘Æ¡n Ä‘áº·t hÃ ng nhÃ¡p.' : 'ÄÃ£ cáº­p nháº­t Ä‘Æ¡n Ä‘áº·t hÃ ng nhÃ¡p.');
          }}
        />
      ) : null}

      {selectedPurchaseOrder ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedPurchaseOrder(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setSelectedPurchaseOrder(null); }}>
          <section className={`${styles.modal} ${localStyles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="purchase-order-detail-title">
            <div className={styles.modalHeader}>
              <div><p className={styles.panelKicker}>Chi tiáº¿t Ä‘Æ¡n Ä‘áº·t hÃ ng</p><h3 id="purchase-order-detail-title">{selectedPurchaseOrder.number || 'ÄÆ¡n chÆ°a cáº¥p sá»‘'}</h3></div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setSelectedPurchaseOrder(null)}>ÄÃ³ng</button>
            </div>
                        <div className={localStyles.detailGrid}>
              <div className={localStyles.detailItem}><span>Trạng thái</span><strong>{PURCHASE_ORDER_STATUS_LABELS[selectedPurchaseOrder.status]}</strong></div>
              <div className={localStyles.detailItem}><span>Nhà cung cấp</span><strong>{selectedPurchaseOrder.supplierCode} — {selectedPurchaseOrder.supplierName}</strong></div>
              <div className={localStyles.detailItem}><span>Kho nhận</span><strong>{selectedPurchaseOrder.warehouseCode} — {selectedPurchaseOrder.warehouseName}</strong></div>
              <div className={localStyles.detailItem}><span>Ngày đặt</span><strong>{formatPurchaseOrderDate(selectedPurchaseOrder.placedAt)}</strong></div>
              <div className={localStyles.detailItem}><span>Dự kiến nhận</span><strong>{formatPurchaseOrderDate(selectedPurchaseOrder.expectedAt)}</strong></div>
              <div className={localStyles.detailItem}><span>Tham chiếu NCC</span><strong>{selectedPurchaseOrder.supplierReference || 'Không có'}</strong></div>
              <div className={localStyles.detailItem}><span>Số phiếu nhận</span><strong>{formatDecimalString(String(selectedPurchaseOrder.receiptCount ?? 0))}</strong></div>
              <div className={localStyles.detailItem}><span>Đã nhận</span><strong>{formatDecimalString(selectedPurchaseOrder.receivedQuantityTotal ?? '0')}</strong></div>
              <div className={localStyles.detailItem}><span>Còn lại</span><strong>{formatDecimalString(selectedPurchaseOrder.remainingQuantityTotal ?? '0')}</strong></div>
            </div>
            <div className={localStyles.linesWrap}>
              <table className={localStyles.linesTable}>
                <thead><tr><th>SKU</th><th>Số lượng</th><th>Đã nhận</th><th>Còn lại</th><th>Đơn vị</th><th>Quy đổi</th><th>Đơn giá</th><th>Chiết khấu</th><th>Thuế</th><th>Thành tiền</th></tr></thead>
                <tbody>
                  {(selectedPurchaseOrder.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td><div className={localStyles.lineIdentity}><strong>{line.skuCode}</strong><span>{line.itemName}</span></div></td>
                      <td>{formatDecimalString(line.quantity)}</td>
                      <td>{formatDecimalString(line.receivedQuantity ?? '0')}</td>
                      <td>{formatDecimalString(line.remainingQuantity ?? '0')}</td>
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
            </div><div className={localStyles.totals}>
              <div className={localStyles.totalCard}><span>Tiá»n hÃ ng</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.subtotal, selectedPurchaseOrder.currency)}</strong></div>
              <div className={localStyles.totalCard}><span>Chiáº¿t kháº¥u</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.discountTotal, selectedPurchaseOrder.currency)}</strong></div>
              <div className={localStyles.totalCard}><span>Thuáº¿</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.taxTotal, selectedPurchaseOrder.currency)}</strong></div>
              <div className={localStyles.totalCard}><span>Tá»•ng cá»™ng</span><strong>{formatPurchaseOrderAmount(selectedPurchaseOrder.total, selectedPurchaseOrder.currency)}</strong></div>
            </div>
            <div className={localStyles.modalActions}><button type="button" className={styles.secondaryButton} onClick={() => setSelectedPurchaseOrder(null)}>ÄÃ³ng chi tiáº¿t</button></div>
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busyId) setPendingAction(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busyId) setPendingAction(null); }}>
          <section className={`${styles.modal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-labelledby="purchase-order-action-title">
            <div className={styles.modalHeader}>
              <div><p className={styles.panelKicker}>XÃ¡c nháº­n nghiá»‡p vá»¥</p><h3 id="purchase-order-action-title">{actionLabel(pendingAction.action)}</h3></div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>ÄÃ³ng</button>
            </div>
            <p className={localStyles.actionCopy}>{actionMessage(pendingAction.action, pendingAction.purchaseOrder)}</p>
            {pendingAction.action === 'cancel' ? (
              <div className={styles.form}><label>LÃ½ do há»§y<input value={cancellationReason} maxLength={1000} onChange={(event) => setCancellationReason(event.target.value)} autoFocus /></label></div>
            ) : null}
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>Quay láº¡i</button>
              <button type="button" className={styles.primaryButton} onClick={() => void runAction()} disabled={Boolean(busyId)} data-testid={`purchase-order-${pendingAction.action}-confirm`}>
                {busyId ? 'Äang xá»­ lÃ½â€¦' : actionLabel(pendingAction.action)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}

