'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { StatusBadge } from '../../components/status-badge';
import { WorkspaceTabPanel, WorkspaceTabs, type WorkspaceTabOption } from '../../components/workspace-tabs';
import styles from './delivery-order-workspace.module.css';
import DeliveryOrderPrintDock from './DeliveryOrderPrintDock';

type Eligibility = {
  fulfillmentAllocationId: string;
  fulfillmentDemandId: string;
  salesOrderId: string;
  salesOrderNumber: string | null;
  salesOrderVersionId: string;
  salesOrderLineId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  handoverMode: 'DELIVERY' | 'PICKUP';
  customerCode: string;
  customerName: string;
  requestedDeliveryDate: string | null;
  locationCode: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  sku: string;
  itemName: string;
  unitCode: string;
  packedBaseQuantity: string;
  claimedBaseQuantity: string;
  availableForDeliveryOrderBaseQuantity: string;
  backorderedBaseQuantity: string;
};

type DeliveryOrderLine = {
  id: string;
  fulfillmentAllocationId: string;
  locationCode: string | null;
  lotCode: string | null;
  sku: string;
  itemName: string;
  unitCode: string;
  deliveryBaseQuantity: string;
  issuedBaseQuantity?: string | null;
  inventoryMovementLineId?: string | null;
};

type DeliveryOrderStatus = 'draft' | 'ready_to_dispatch' | 'dispatched' | 'handed_over' | 'cancelled';

type DeliveryOrder = {
  id: string;
  number: string | null;
  salesOrderId: string;
  salesOrderNumber: string | null;
  customerCode: string;
  customerName: string;
  warehouseCode: string;
  warehouseName: string;
  handoverMode: 'DELIVERY' | 'PICKUP';
  status: DeliveryOrderStatus;
  revision: string;
  lineCount?: number;
  totalBaseQuantity?: string;
  cancellationReason?: string | null;
  inventoryIssueId?: string | null;
  inventoryIssueStatus?: string | null;
  inventoryMovementId?: string | null;
  inventoryIssuedAt?: string | null;
  receiverName?: string | null;
  lines?: DeliveryOrderLine[];
};

type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };

type EligibilityGroup = {
  key: string;
  salesOrderId: string;
  salesOrderNumber: string | null;
  salesOrderVersionId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  customerCode: string;
  customerName: string;
  handoverMode: 'DELIVERY' | 'PICKUP';
  requestedDeliveryDate: string | null;
  rows: Eligibility[];
};

type DeliveryOrderTab = 'create' | 'manage';
type DeliveryOrderAction = 'confirm' | 'cancel' | 'pickup-handover' | 'manual-handover' | 'reverse-inventory-issue';

const DELIVERY_ORDER_TABS: readonly WorkspaceTabOption<DeliveryOrderTab>[] = [
  { id: 'create', label: 'Lập chứng từ' },
  { id: 'manage', label: 'Theo dõi & xử lý' },
];

const SCALE = 1_000_000_000_000n;
const IDEMPOTENCY_INTENT_CACHE_LIMIT = 256;
const idempotencyKeys = new Map<string, string>();

function parseQuantity(value: string): bigint {
  const normalized = String(value ?? '').trim();
  if (!/^(0|[1-9]\d*)(?:\.\d{1,12})?$/.test(normalized)) return 0n;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
}

function formatQuantity(value: string | undefined | null): string {
  const normalized = String(value ?? '0');
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Chưa đặt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN').format(date);
}

function localDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function statusLabel(value: DeliveryOrderStatus): string {
  return {
    draft: 'Nháp',
    ready_to_dispatch: 'Sẵn sàng bàn giao',
    dispatched: 'Đã xuất theo chuyến',
    handed_over: 'Đã bàn giao',
    cancelled: 'Đã hủy',
  }[value];
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
    throw new Error(envelope.error?.message || 'Không thực hiện được thao tác giao nhận.');
  }
  return envelope.data;
}

function keyFor(prefix: string, ...parts: string[]): string {
  const intent = `${prefix}:${parts.join(':')}`;
  const existing = idempotencyKeys.get(intent);
  if (existing) return existing;
  const key = createIdempotencyKey(`delivery-order-${prefix}`);
  if (idempotencyKeys.size >= IDEMPOTENCY_INTENT_CACHE_LIMIT) {
    const oldest = idempotencyKeys.keys().next().value;
    if (oldest) idempotencyKeys.delete(oldest);
  }
  idempotencyKeys.set(intent, key);
  return key;
}

function groupEligibility(rows: Eligibility[]): EligibilityGroup[] {
  const groups = new Map<string, EligibilityGroup>();
  for (const row of rows) {
    const key = `${row.salesOrderId}:${row.salesOrderVersionId}:${row.warehouseId}`;
    const existing = groups.get(key);
    if (existing) existing.rows.push(row);
    else groups.set(key, {
      key,
      salesOrderId: row.salesOrderId,
      salesOrderNumber: row.salesOrderNumber,
      salesOrderVersionId: row.salesOrderVersionId,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      customerCode: row.customerCode,
      customerName: row.customerName,
      handoverMode: row.handoverMode,
      requestedDeliveryDate: row.requestedDeliveryDate,
      rows: [row],
    });
  }
  return [...groups.values()];
}

export default function DeliveryOrderWorkspace() {
  const [activeTab, setActiveTab] = useState<DeliveryOrderTab>('create');
  const [eligibility, setEligibility] = useState<Eligibility[]>([]);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverNote, setReceiverNote] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestRef = useRef(0);
  const pickupAttemptAtRef = useRef<string | null>(null);
  const manualAttemptAtRef = useRef<string | null>(null);
  const tabInitializedRef = useRef(false);

  const groups = useMemo(() => groupEligibility(eligibility), [eligibility]);
  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) ?? null;
  const counts = useMemo(() => ({
    eligible: groups.length,
    draft: orders.filter((order) => order.status === 'draft').length,
    ready: orders.filter((order) => order.status === 'ready_to_dispatch').length,
    issued: orders.filter((order) => ['dispatched', 'handed_over'].includes(order.status)).length,
  }), [groups, orders]);

  function seedQuantities(group: EligibilityGroup | null) {
    setQuantities(group ? Object.fromEntries(
      group.rows.map((row) => [row.fulfillmentAllocationId, row.availableForDeliveryOrderBaseQuantity]),
    ) : {});
  }

  async function loadAll(preferredOrderId?: string | null) {
    const requestNumber = requestRef.current + 1;
    requestRef.current = requestNumber;
    setLoading(true);
    setError(null);
    try {
      const [nextEligibility, nextOrders] = await Promise.all([
        requestJson<Eligibility[]>('/api/delivery-orders/eligibility?limit=1000'),
        requestJson<DeliveryOrder[]>('/api/delivery-orders?limit=500'),
      ]);
      if (requestRef.current !== requestNumber) return;
      setEligibility(nextEligibility);
      setOrders(nextOrders);
      const nextGroups = groupEligibility(nextEligibility);
      if (!tabInitializedRef.current) {
        tabInitializedRef.current = true;
        setActiveTab(nextGroups.length === 0 && nextOrders.length > 0 ? 'manage' : 'create');
      }
      const group = nextGroups.find((item) => item.key === selectedGroupKey) ?? nextGroups[0] ?? null;
      setSelectedGroupKey(group?.key ?? null);
      seedQuantities(group);
      const targetOrderId = preferredOrderId && nextOrders.some((order) => order.id === preferredOrderId)
        ? preferredOrderId
        : selectedOrderId && nextOrders.some((order) => order.id === selectedOrderId)
          ? selectedOrderId
          : nextOrders[0]?.id ?? null;
      setSelectedOrderId(targetOrderId);
      if (targetOrderId) await loadOrder(targetOrderId, requestNumber);
      else setSelectedOrder(null);
    } catch (loadError) {
      if (requestRef.current === requestNumber) setError(loadError instanceof Error ? loadError.message : 'Không tải được hàng đợi giao nhận.');
    } finally {
      if (requestRef.current === requestNumber) setLoading(false);
    }
  }

  async function loadOrder(deliveryOrderId: string, parentRequest?: number) {
    const requestNumber = parentRequest ?? requestRef.current + 1;
    if (parentRequest === undefined) requestRef.current = requestNumber;
    setBusy(`detail-${deliveryOrderId}`);
    setError(null);
    setSelectedOrderId(deliveryOrderId);
    try {
      const detail = await requestJson<DeliveryOrder>(`/api/delivery-orders/${deliveryOrderId}`);
      if (requestRef.current !== requestNumber) return;
      setSelectedOrder(detail);
      setCancelReason('');
      setReceiverName(detail.receiverName ?? '');
      setReceiverNote('');
      setReversalReason('');
      pickupAttemptAtRef.current = null;
      manualAttemptAtRef.current = null;
    } catch (loadError) {
      if (requestRef.current === requestNumber) setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết chứng từ.');
    } finally {
      if (requestRef.current === requestNumber) setBusy(null);
    }
  }

  async function createOrder() {
    if (!selectedGroup) return;
    const lines = selectedGroup.rows.map((row) => ({
      fulfillmentAllocationId: row.fulfillmentAllocationId,
      quantity: String(quantities[row.fulfillmentAllocationId] ?? '').trim(),
    })).filter((line) => parseQuantity(line.quantity) > 0n);
    if (lines.length === 0) return setError('Chọn ít nhất một dòng có số lượng lớn hơn 0.');
    if (lines.some((line) => {
      const source = selectedGroup.rows.find((row) => row.fulfillmentAllocationId === line.fulfillmentAllocationId);
      return !source || parseQuantity(line.quantity) > parseQuantity(source.availableForDeliveryOrderBaseQuantity);
    })) return setError('Số lượng bàn giao không được vượt phần đã đóng gói còn khả dụng.');
    const fingerprint = lines.map((line) => `${line.fulfillmentAllocationId}:${line.quantity}`).join('|');
    setBusy('create'); setError(null); setNotice(null);
    try {
      const result = await requestJson<{ deliveryOrder: DeliveryOrder }>('/api/delivery-orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': keyFor('create-do', selectedGroup.salesOrderId, fingerprint) },
        body: JSON.stringify({ lines }),
      });
      setNotice('Đã tạo Delivery Order nháp từ phần hàng đã đóng gói.');
      setActiveTab('manage');
      await loadAll(result.deliveryOrder.id);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không tạo được Delivery Order.');
    } finally { setBusy(null); }
  }

  async function transitionOrder(action: DeliveryOrderAction) {
    if (!selectedOrder) return;
    if (action === 'cancel' && !cancelReason.trim()) return setError('Nhập lý do hủy chứng từ nháp.');
    if (action === 'pickup-handover' && !receiverName.trim()) return setError('Nhập tên người nhận hàng tại quầy.');
    if (action === 'manual-handover' && !receiverName.trim()) return setError('Nhập tên người nhận hàng giao thủ công.');
    if (action === 'reverse-inventory-issue' && !reversalReason.trim()) return setError('Nhập lý do đảo xuất kho.');
    let body: Record<string, unknown> = {};
    let fingerprint = selectedOrder.revision;
    if (action === 'cancel') {
      body = { reason: cancelReason.trim() };
      fingerprint = cancelReason.trim();
    }
    if (action === 'pickup-handover') {
      pickupAttemptAtRef.current ??= new Date().toISOString();
      body = {
        receiverName: receiverName.trim(),
        receiverNote: receiverNote.trim() || undefined,
        handedOverAt: pickupAttemptAtRef.current,
      };
      fingerprint = `${selectedOrder.revision}:${receiverName.trim()}:${pickupAttemptAtRef.current}`;
    }
    if (action === 'manual-handover') {
      manualAttemptAtRef.current ??= new Date().toISOString();
      body = {
        receiverName: receiverName.trim(),
        receiverNote: receiverNote.trim() || undefined,
        handedOverAt: manualAttemptAtRef.current,
      };
      fingerprint = `${selectedOrder.revision}:${receiverName.trim()}:${manualAttemptAtRef.current}`;
    }
    if (action === 'reverse-inventory-issue') {
      body = { documentDate: localDate(), reasonCode: 'OPERATOR_CORRECTION', reasonNote: reversalReason.trim() };
      fingerprint = `${selectedOrder.revision}:${reversalReason.trim()}`;
    }
    setBusy(action); setError(null); setNotice(null);
    try {
      await requestJson(`/api/delivery-orders/${selectedOrder.id}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keyFor(action, selectedOrder.id, fingerprint) },
        body: JSON.stringify(body),
      });
      const messages = {
        confirm: 'Đã xác nhận chứng từ sẵn sàng bàn giao.',
        cancel: 'Đã hủy chứng từ nháp; phần packed đã trở lại hàng đợi.',
        'pickup-handover': 'Đã xác nhận bàn giao tại quầy và ghi xuất kho.',
        'manual-handover': 'Đã xác nhận giao thủ công, ghi xuất kho và công nợ theo lượng thực giao.',
        'reverse-inventory-issue': 'Đã tạo movement đảo và đưa chứng từ về trạng thái sẵn sàng.',
      } as const;
      setNotice(messages[action]);
      pickupAttemptAtRef.current = null;
      manualAttemptAtRef.current = null;
      if (action === 'cancel') setActiveTab('create');
      await loadAll(selectedOrder.id);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không cập nhật được chứng từ.');
    } finally { setBusy(null); }
  }

  useEffect(() => { void loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <AppShell kicker="Kho và giao nhận" title="Bàn giao giao nhận" subtitle="Lập chứng từ từ phần đã đóng gói; giao tận nơi có thể đi chuyến hoặc xác nhận giao thủ công theo đúng Delivery Order.">
      <div className={styles.page} data-testid="delivery-order-workspace">
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Ranh giới sau đóng gói</p>
            <h2>Hàng sẵn sàng lập chứng từ</h2>
            <p>Giao tận nơi xuất kho khi Logistics dispatch chuyến hoặc khi nhân viên xác nhận giao thủ công. Nhận tại quầy xuất kho tại xác nhận bàn giao.</p>
          </div>
          <div className={styles.actions}>
            <Link href="/inventory/customer-returns" className={styles.secondaryButton} data-testid="customer-return-shortcut">Hàng khách trả</Link>
            <button type="button" className={styles.secondaryButton} onClick={() => void loadAll(selectedOrderId)} disabled={loading || busy !== null}>{loading ? 'Đang tải...' : 'Làm mới'}</button>
          </div>
        </section>

        <section className={styles.stats} aria-label="Tổng hợp bàn giao giao nhận">
          <article><strong>{counts.eligible}</strong><span>Đơn còn packed</span></article>
          <article><strong>{counts.draft}</strong><span>Chứng từ nháp</span></article>
          <article><strong>{counts.ready}</strong><span>Sẵn sàng bàn giao</span></article>
          <article><strong>{counts.issued}</strong><span>Đã xuất vật lý</span></article>
        </section>

        {error ? <div className={styles.error} role="alert" data-testid="delivery-order-error">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status" data-testid="delivery-order-notice">{notice}</div> : null}

        <WorkspaceTabs
          tabs={DELIVERY_ORDER_TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          idPrefix="delivery-order-workflow"
          label="Nghiệp vụ bàn giao giao nhận"
        />

        <WorkspaceTabPanel tabId="create" activeTab={activeTab} idPrefix="delivery-order-workflow">
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h3>Phần packed chưa bàn giao</h3><p>Mỗi nhóm thuộc đúng một đơn, một phiên bản và một kho.</p></div></div>
            <div className={styles.queue}>
              {groups.length === 0 ? <p className={styles.empty}>Không còn phần đóng gói nào cần lập chứng từ.</p> : null}
              {groups.map((group) => (
                <button type="button" key={group.key} className={`${styles.queueItem} ${selectedGroupKey === group.key ? styles.active : ''}`} onClick={() => { setSelectedGroupKey(group.key); seedQuantities(group); }} data-testid={`delivery-eligible-${group.salesOrderId}`}>
                  <span className={styles.queueTop}><strong>{group.salesOrderNumber || 'Đơn bán hàng'}</strong><em>{group.handoverMode === 'PICKUP' ? 'Nhận tại quầy' : 'Giao hàng'}</em></span>
                  <span>{group.customerCode} — {group.customerName}</span>
                  <small>{group.warehouseCode} · {group.rows.length} dòng · {formatDate(group.requestedDeliveryDate)}</small>
                </button>
              ))}
            </div>
            {selectedGroup ? (
              <div className={styles.builder}>
                <div className={styles.detailHeader}><div><p className={styles.eyebrow}>{selectedGroup.salesOrderNumber || 'Đơn bán hàng'}</p><h3>{selectedGroup.customerCode} — {selectedGroup.customerName}</h3><p>{selectedGroup.warehouseCode} — {selectedGroup.warehouseName}</p></div><span className={styles.status}>{selectedGroup.handoverMode === 'PICKUP' ? 'Nhận tại quầy' : 'Giao hàng'}</span></div>
                <div className={styles.lines}>
                  {selectedGroup.rows.map((row) => (
                    <article key={row.fulfillmentAllocationId}>
                      <div><strong>{row.sku} — {row.itemName}</strong><span>{row.locationCode || 'Không vị trí'} · Lô {row.lotCode || 'Không lô'}</span><small>Đã gói {formatQuantity(row.packedBaseQuantity)} · Đã claim {formatQuantity(row.claimedBaseQuantity)} · Còn thiếu {formatQuantity(row.backorderedBaseQuantity)}</small></div>
                      <label>Số lượng bàn giao<input inputMode="decimal" value={quantities[row.fulfillmentAllocationId] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [row.fulfillmentAllocationId]: event.target.value }))} aria-label={`Số lượng bàn giao ${row.sku}`} /><small>Tối đa {formatQuantity(row.availableForDeliveryOrderBaseQuantity)} {row.unitCode}</small></label>
                    </article>
                  ))}
                </div>
                <button type="button" className={styles.primaryButton} onClick={() => void createOrder()} disabled={busy !== null} data-testid="delivery-order-create">{busy === 'create' ? 'Đang tạo...' : 'Tạo Delivery Order nháp'}</button>
              </div>
            ) : null}
          </section>
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="manage" activeTab={activeTab} idPrefix="delivery-order-workflow">
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h3>Delivery Orders</h3><p>Delivery chỉ nhận việc sau khi chứng từ được xác nhận; giao thủ công được xác nhận trực tiếp tại Core.</p></div></div>
            <div className={styles.queue}>
              {orders.length === 0 ? <p className={styles.empty}>Chưa có Delivery Order.</p> : null}
              {orders.map((order) => (
                <button type="button" key={order.id} className={`${styles.queueItem} ${selectedOrderId === order.id ? styles.active : ''}`} onClick={() => void loadOrder(order.id)} data-testid={`delivery-order-${order.id}`}>
                  <span className={styles.queueTop}><strong>{order.number || 'Chứng từ nháp'}</strong><StatusBadge status={order.status} label={statusLabel(order.status)} /></span>
                  <span>{order.salesOrderNumber || 'Đơn bán hàng'} · {order.customerCode} — {order.customerName}</span>
                  <small>{order.warehouseCode} · {order.lineCount ?? 0} dòng · {formatQuantity(order.totalBaseQuantity)}</small>
                </button>
              ))}
            </div>

            {selectedOrder ? (
              <div className={styles.builder}>
                <div className={styles.detailHeader}><div><p className={styles.eyebrow}>{selectedOrder.number || 'Delivery Order nháp'}</p><h3>{selectedOrder.customerCode} — {selectedOrder.customerName}</h3><p>{selectedOrder.salesOrderNumber || 'Đơn bán hàng'} · {selectedOrder.warehouseCode}</p></div><div className={styles.actions}><DeliveryOrderPrintDock order={selectedOrder} /><StatusBadge status={selectedOrder.status} label={statusLabel(selectedOrder.status)} /></div></div>
                <div className={styles.lines}>
                  {(selectedOrder.lines ?? []).map((line) => (
                    <article key={line.id}><div><strong>{line.sku} — {line.itemName}</strong><span>{line.locationCode || 'Không vị trí'} · Lô {line.lotCode || 'Không lô'}</span></div><strong>{formatQuantity(line.deliveryBaseQuantity)} {line.unitCode}</strong></article>
                  ))}
                </div>

                {selectedOrder.status === 'draft' ? (
                  <div className={styles.actions}>
                    <button type="button" className={styles.primaryButton} onClick={() => void transitionOrder('confirm')} disabled={busy !== null} data-testid="delivery-order-confirm">{busy === 'confirm' ? 'Đang xác nhận...' : 'Xác nhận sẵn sàng bàn giao'}</button>
                    <label className={styles.cancelField}>Lý do hủy nháp<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1000} /></label>
                    <button type="button" className={styles.dangerButton} onClick={() => void transitionOrder('cancel')} disabled={busy !== null} data-testid="delivery-order-cancel">{busy === 'cancel' ? 'Đang hủy...' : 'Hủy chứng từ nháp'}</button>
                  </div>
                ) : null}

                {selectedOrder.status === 'ready_to_dispatch' && selectedOrder.handoverMode === 'DELIVERY' ? (
                  <div className={styles.actions} data-testid="delivery-manual-handover-panel">
                    <p className={styles.notice}>Nếu đơn không đi chuyến Delivery, xác nhận giao thủ công tại đây. Hệ thống sẽ xuất đúng lượng trên Delivery Order và ghi công nợ từ cùng fact bàn giao.</p>
                    <label className={styles.cancelField}>Người nhận hàng<input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} maxLength={256} aria-label="Người nhận giao thủ công" /></label>
                    <label className={styles.cancelField}>Ghi chú bàn giao<input value={receiverNote} onChange={(event) => setReceiverNote(event.target.value)} maxLength={2000} aria-label="Ghi chú giao thủ công" /></label>
                    <button type="button" className={styles.primaryButton} onClick={() => void transitionOrder('manual-handover')} disabled={busy !== null} data-testid="delivery-order-manual-handover">{busy === 'manual-handover' ? 'Đang xác nhận...' : 'Xác nhận giao thủ công & xuất kho'}</button>
                    <small>Đơn vẫn có thể được đưa vào chuyến Delivery nếu chưa xác nhận giao thủ công.</small>
                  </div>
                ) : null}

                {selectedOrder.status === 'ready_to_dispatch' && selectedOrder.handoverMode === 'PICKUP' ? (
                  <div className={styles.actions}>
                    <label className={styles.cancelField}>Người nhận tại quầy<input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} maxLength={256} aria-label="Người nhận tại quầy" /></label>
                    <label className={styles.cancelField}>Ghi chú bàn giao<input value={receiverNote} onChange={(event) => setReceiverNote(event.target.value)} maxLength={2000} aria-label="Ghi chú bàn giao" /></label>
                    <button type="button" className={styles.primaryButton} onClick={() => void transitionOrder('pickup-handover')} disabled={busy !== null} data-testid="delivery-order-pickup-handover">{busy === 'pickup-handover' ? 'Đang bàn giao...' : 'Xác nhận bàn giao và xuất kho'}</button>
                  </div>
                ) : null}

                {['dispatched', 'handed_over'].includes(selectedOrder.status) ? (
                  <div className={styles.actions}>
                    <p>Movement xuất kho: {selectedOrder.inventoryMovementId || 'Đã ghi trong sổ kho'}</p>
                    <label className={styles.cancelField}>Lý do đảo xuất kho<input value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} maxLength={2000} aria-label="Lý do đảo xuất kho" /></label>
                    <button type="button" className={styles.dangerButton} onClick={() => void transitionOrder('reverse-inventory-issue')} disabled={busy !== null} data-testid="delivery-order-reverse-issue">{busy === 'reverse-inventory-issue' ? 'Đang đảo...' : 'Đảo xuất kho sai'}</button>
                  </div>
                ) : null}
                {selectedOrder.cancellationReason ? <p className={styles.cancelled}>Lý do hủy: {selectedOrder.cancellationReason}</p> : null}
              </div>
            ) : null}
          </section>
        </WorkspaceTabPanel>
      </div>
    </AppShell>
  );
}
