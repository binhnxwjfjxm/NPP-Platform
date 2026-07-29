'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from '../purchase-orders/purchase-orders.module.css';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import type { GoodsReceipt, GoodsReceiptDraftLine, GoodsReceiptStatus } from '../../../lib/goods-receipt-types';
import {
  GOODS_RECEIPT_STATUS_LABELS,
  formatGoodsReceiptDate,
  goodsReceiptActionPolicy,
} from '../../../lib/goods-receipt-types';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import {
  decimalToScaled,
  formatDecimalString,
  PURCHASE_ORDER_STATUS_LABELS,
  scaledToDecimal,
} from '../../../lib/purchase-order-types';

type Props = {
  initialGoodsReceipts: GoodsReceipt[];
  initialPurchaseOrders: PurchaseOrder[];
  initialWarehouses: Warehouse[];
  initialLocations: WarehouseLocation[];
  initialPermissionKeys: string[];
  initialPurchaseOrderPermissionKeys: string[];
  initialError: string | null;
  initialLookupError: string | null;
};

type StatusFilter = GoodsReceiptStatus | 'all';
type DraftLine = GoodsReceiptDraftLine & {
  purchaseOrderLineId: string;
  lineNumber: number;
  skuCode: string;
  itemName: string;
  unitCode: string;
  orderedQuantity: string;
  receivedQuantityBefore: string;
  remainingQuantityBefore: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  finalizeLine: boolean;
  qualityReasonCode: string;
  qualityNote: string;
};

type PurchaseOrderLine = NonNullable<PurchaseOrder['lines']>[number];

type EditorState = {
  mode: 'create' | 'edit';
  receipt: GoodsReceipt | null;
  purchaseOrder: PurchaseOrder | null;
  purchaseOrderId: string;
  receiptDate: string;
  supplierDeliveryReference: string;
  note: string;
  lines: DraftLine[];
  loading: boolean;
} | null;

type ActionName = 'post' | 'reverse';
type ActionState = { action: ActionName; goodsReceipt: GoodsReceipt } | null;

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

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
    throw new Error(payload.error?.message || 'KhÃ´ng thá»±c hiá»‡n Ä‘Æ°á»£c yÃªu cáº§u phiáº¿u nháº­n hÃ ng');
  }
  return payload.data;
}

function actionLabel(action: ActionName) {
  return action === 'post' ? 'Ghi sá»•' : 'Äáº£o phiáº¿u';
}

function actionMessage(action: ActionName, goodsReceipt: GoodsReceipt) {
  const identifier = goodsReceipt.documentNumber || 'phiáº¿u chÆ°a cáº¥p sá»‘';
  if (action === 'post') {
    return `Ghi sá»• ${identifier}? HÃ ng sáº½ Ä‘i vÃ o tá»“n kho ngay sau khi xÃ¡c nháº­n.`;
  }
  return `Äáº£o ${identifier}? Há»‡ thá»‘ng sáº½ táº¡o chá»©ng tá»« bÃ¹ vÃ  trá»« tá»“n kho ngÆ°á»£c láº¡i.`;
}

function normalizeDecimalInput(value: string): string {
  const trimmed = value.trim();
  return trimmed || '0';
}
function decimalSum(...values: Array<string | null | undefined>): string {
  let total = 0n;
  for (const value of values) {
    total += decimalToScaled(normalizeDecimalInput(String(value ?? '0')), true) ?? 0n;
  }
  return scaledToDecimal(total);
}
function decimalPositive(value: string | null | undefined): boolean {
  return (decimalToScaled(normalizeDecimalInput(String(value ?? '0')), false) ?? 0n) > 0n;
}

function buildDraftLineFromOrderLine(line: PurchaseOrderLine, warehouseLocations: WarehouseLocation[]): DraftLine {
  const defaultLocation = warehouseLocations[0]?.id ?? '';
  const received = line.remainingQuantity ?? line.quantity;
  return {
    purchaseOrderLineId: line.id,
    lineNumber: line.lineNumber,
    skuCode: line.skuCode,
    itemName: line.itemName,
    unitCode: line.unitCode,
    orderedQuantity: line.quantity,
    receivedQuantityBefore: line.receivedQuantity ?? '0',
    remainingQuantityBefore: line.remainingQuantity ?? line.quantity,
    receivedQuantity: received,
    acceptedQuantity: received,
    rejectedQuantity: '0',
    finalizeLine: false,
    qualityReasonCode: '',
    qualityNote: '',
    locationId: defaultLocation,
    lotId: '',
    lotCode: '',
    manufacturedDate: '',
    expiryDate: '',
    supplierLotReference: '',
    note: '',
  };
}

function buildDraftLineFromReceiptLine(line: NonNullable<GoodsReceipt['lines']>[number]): DraftLine {
  return {
    purchaseOrderLineId: line.purchaseOrderLineId,
    lineNumber: line.lineNumber,
    skuCode: line.skuCode,
    itemName: line.itemName,
    unitCode: line.unitCode,
    orderedQuantity: line.orderedQuantity,
    receivedQuantityBefore: line.receivedQuantityBefore,
    remainingQuantityBefore: line.remainingQuantityBefore,
    receivedQuantity: line.receivedQuantity,
    acceptedQuantity: line.acceptedQuantity,
    rejectedQuantity: line.rejectedQuantity,
    finalizeLine: line.finalizeLine,
    qualityReasonCode: line.qualityReasonCode ?? '',
    qualityNote: line.qualityNote ?? '',
    locationId: line.locationId ?? '',
    lotId: line.lotId ?? '',
    lotCode: line.lotCode ?? '',
    manufacturedDate: line.manufacturedDate ?? '',
    expiryDate: line.expiryDate ?? '',
    supplierLotReference: line.supplierLotReference ?? '',
    note: line.note ?? '',
  };
}

export default function GoodsReceiptWorkspace({
  initialGoodsReceipts,
  initialPurchaseOrders,
  initialWarehouses,
  initialLocations,
  initialPermissionKeys,
  initialPurchaseOrderPermissionKeys,
  initialError,
  initialLookupError,
}: Props) {
  const [items, setItems] = useState<GoodsReceipt[]>(initialGoodsReceipts);
  const [error, setError] = useState<string | null>(initialError || initialLookupError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedGoodsReceipt, setSelectedGoodsReceipt] = useState<GoodsReceipt | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingAction, setPendingAction] = useState<ActionState>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseDate, setReverseDate] = useState(todayLocal());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const actionKeys = useRef(new Map<string, string>());

  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleItems = useMemo(() => items.filter((goodsReceipt) => {
    const matchesStatus = statusFilter === 'all' || goodsReceipt.status === statusFilter;
    const searchable = [
      goodsReceipt.documentNumber,
      goodsReceipt.purchaseOrderNumber,
      goodsReceipt.supplierCode,
      goodsReceipt.supplierName,
      goodsReceipt.warehouseCode,
      goodsReceipt.warehouseName,
      goodsReceipt.supplierDeliveryReference,
      ...(goodsReceipt.lines ?? []).flatMap((line) => [line.skuCode, line.itemName, line.lotCode]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('vi-VN');
    return matchesStatus && (!normalizedSearch || searchable.includes(normalizedSearch));
  }), [items, normalizedSearch, statusFilter]);

  const counts = useMemo(() => ({
    total: items.length,
    draft: items.filter((item) => item.status === 'draft').length,
    posted: items.filter((item) => item.status === 'posted').length,
    reversed: items.filter((item) => item.status === 'reversed').length,
  }), [items]);

  const eligiblePurchaseOrders = useMemo(
    () => initialPurchaseOrders.filter((purchaseOrder) => ['approved', 'partially_received'].includes(purchaseOrder.status)),
    [initialPurchaseOrders],
  );

  const draftPolicy = goodsReceiptActionPolicy('draft', initialPermissionKeys);
  const createAllowed = draftPolicy.create;
  const varianceAllowed = draftPolicy.variance;
  const purchaseOrderReadable = initialPurchaseOrderPermissionKeys.includes('core.purchase-order.read');
  const activePurchaseOrder = editor?.purchaseOrder ?? null;

  useEffect(() => {
    if (selectedGoodsReceipt || pendingAction || editor) closeButtonRef.current?.focus();
  }, [editor, pendingAction, selectedGoodsReceipt]);

  function upsertReceipt(goodsReceipt: GoodsReceipt) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === goodsReceipt.id);
      if (index < 0) return [goodsReceipt, ...current];
      return current.map((item) => (item.id === goodsReceipt.id ? goodsReceipt : item));
    });
  }

  async function loadAll(successMessage?: string) {
    setLoadingList(true);
    setError(null);
    try {
      const receipts = await requestJson<GoodsReceipt[]>('/api/goods-receipts?limit=1000');
      setItems(receipts);
      if (successMessage) setNotice(successMessage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c danh sÃ¡ch phiáº¿u nháº­n hÃ ng');
    } finally {
      setLoadingList(false);
    }
  }

  async function loadReceiptDetail(goodsReceipt: GoodsReceipt): Promise<GoodsReceipt | null> {
    setBusyId(goodsReceipt.id);
    setError(null);
    try {
      return await requestJson<GoodsReceipt>(`/api/goods-receipts/${goodsReceipt.id}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c chi tiáº¿t phiáº¿u nháº­n hÃ ng');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function loadPurchaseOrderDetail(purchaseOrderId: string): Promise<PurchaseOrder | null> {
    setBusyId(purchaseOrderId);
    setError(null);
    try {
      return await requestJson<PurchaseOrder>(`/api/purchase-orders/${purchaseOrderId}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'KhÃ´ng táº£i Ä‘Æ°á»£c chi tiáº¿t Ä‘Æ¡n Ä‘áº·t hÃ ng');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  function receiptActionKey(action: ActionName, goodsReceipt: GoodsReceipt) {
    const identity = `${action}:${goodsReceipt.id}:${goodsReceipt.revision}`;
    const existing = actionKeys.current.get(identity);
    if (existing) return existing;
    const key = `gr-${action}-${crypto.randomUUID()}`;
    actionKeys.current.set(identity, key);
    return key;
  }

  async function openView(goodsReceipt: GoodsReceipt) {
    const detail = await loadReceiptDetail(goodsReceipt);
    if (detail) setSelectedGoodsReceipt(detail);
  }

  async function openCreate() {
    setError(null);
    setNotice(null);
    if (!eligiblePurchaseOrders.length) {
      setError('ChÆ°a cÃ³ Ä‘Æ¡n Ä‘áº·t hÃ ng nÃ o á»Ÿ tráº¡ng thÃ¡i Ä‘Ã£ duyá»‡t Ä‘á»ƒ táº¡o phiáº¿u nháº­n hÃ ng.');
      return;
    }
    const purchaseOrder = await loadPurchaseOrderDetail(eligiblePurchaseOrders[0].id);
    if (!purchaseOrder?.lines?.length) {
      setError('ÄÆ¡n Ä‘áº·t hÃ ng Ä‘Æ°á»£c chá»n chÆ°a cÃ³ dÃ²ng hÃ ng há»£p lá»‡.');
      return;
    }
    const warehouseLocations = initialLocations.filter((location) => location.warehouse_id === purchaseOrder.warehouseId);
    setEditor({
      mode: 'create',
      receipt: null,
      purchaseOrder,
      purchaseOrderId: purchaseOrder.id,
      receiptDate: todayLocal(),
      supplierDeliveryReference: '',
      note: '',
      lines: purchaseOrder.lines.map((line) => buildDraftLineFromOrderLine(line, warehouseLocations)),
      loading: false,
    });
  }

  async function openEdit(goodsReceipt: GoodsReceipt) {
    const detail = await loadReceiptDetail(goodsReceipt);
    if (!detail) return;
    const purchaseOrder = await loadPurchaseOrderDetail(detail.purchaseOrderId);
    if (!purchaseOrder) return;
    setEditor({
      mode: 'edit',
      receipt: detail,
      purchaseOrder,
      purchaseOrderId: detail.purchaseOrderId,
      receiptDate: detail.receiptDate,
      supplierDeliveryReference: detail.supplierDeliveryReference ?? '',
      note: detail.note ?? '',
      lines: (detail.lines ?? []).map(buildDraftLineFromReceiptLine),
      loading: false,
    });
  }

  function openAction(action: ActionName, goodsReceipt: GoodsReceipt) {
    setError(null);
    setNotice(null);
    setReverseReason('');
    setReverseDate(todayLocal());
    setPendingAction({ action, goodsReceipt });
  }

  function updateEditorLine(index: number, patch: Partial<DraftLine>) {
    setEditor((current) => {
      if (!current) return current;
      const nextLines = current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line));
      return { ...current, lines: nextLines };
    });
  }

  async function refreshEditorPurchaseOrder(purchaseOrderId: string) {
    if (!editor) return;
    setEditor((current) => current ? { ...current, loading: true } : current);
    const purchaseOrder = await loadPurchaseOrderDetail(purchaseOrderId);
    if (!purchaseOrder?.lines?.length) {
      setEditor((current) => current ? { ...current, loading: false } : current);
      return;
    }
    const purchaseOrderLines = purchaseOrder.lines ?? [];
    const warehouseLocations = initialLocations.filter((location) => location.warehouse_id === purchaseOrder.warehouseId);
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        purchaseOrder,
        purchaseOrderId,
        lines: purchaseOrderLines.map((line) => buildDraftLineFromOrderLine(line, warehouseLocations)),
        loading: false,
      };
    });
  }

  async function saveEditor() {
    if (!editor || !editor.purchaseOrder) return;
    const purchaseOrder = editor.purchaseOrder;
    for (const line of editor.lines) {
      if (!line.purchaseOrderLineId) {
        setError('Vui lÃ²ng chá»n Ä‘Ãºng dÃ²ng Ä‘Æ¡n Ä‘áº·t hÃ ng cho tá»«ng máº·t hÃ ng.');
        return;
      }
      if (varianceAllowed) {
        const accepted = decimalToScaled(normalizeDecimalInput(line.acceptedQuantity), true) ?? 0n;
        const rejected = decimalToScaled(normalizeDecimalInput(line.rejectedQuantity), true) ?? 0n;
        if (accepted + rejected <= 0n) {
          setError('Vui lÃ²ng nháº­p sá»‘ lÆ°á»£ng cháº¥p nháº­n hoáº·c loáº¡i há»£p lá»‡ cho Ã­t nháº¥t má»™t dÃ²ng.');
          return;
        }
        if (rejected > 0n && (!line.qualityReasonCode.trim() || !line.qualityNote.trim())) {
          setError('DÃ²ng cÃ³ sá»‘ lÆ°á»£ng loáº¡i pháº£i cÃ³ lÃ½ do vÃ  ghi chÃº cháº¥t lÆ°á»£ng.');
          return;
        }
      } else if (!decimalPositive(line.receivedQuantity)) {
        setError('Vui lÃ²ng nháº­p sá»‘ lÆ°á»£ng nháº­n há»£p lá»‡ cho Ã­t nháº¥t má»™t dÃ²ng.');
        return;
      }
    }
    setBusyId(editor.mode === 'edit' && editor.receipt ? editor.receipt.id : purchaseOrder.id);
    setError(null);
    try {
      const payload = {
        purchaseOrderId: editor.purchaseOrderId,
        receiptDate: editor.receiptDate,
        supplierDeliveryReference: editor.supplierDeliveryReference,
        note: editor.note,
        lines: editor.lines.map((line) => {
          if (varianceAllowed) {
            const acceptedQuantity = normalizeDecimalInput(line.acceptedQuantity);
            const rejectedQuantity = normalizeDecimalInput(line.rejectedQuantity);
            return {
              purchaseOrderLineId: line.purchaseOrderLineId,
              receivedQuantity: decimalSum(acceptedQuantity, rejectedQuantity),
              acceptedQuantity,
              rejectedQuantity,
              finalizeLine: line.finalizeLine,
              ...((decimalPositive(rejectedQuantity) || line.finalizeLine)
                ? {
                  qualityReasonCode: line.qualityReasonCode.trim(),
                  qualityNote: line.qualityNote.trim(),
                }
                : {}),
              locationId: line.locationId,
              lotId: line.lotId,
              lotCode: line.lotCode,
              manufacturedDate: line.manufacturedDate,
              expiryDate: line.expiryDate,
              supplierLotReference: line.supplierLotReference,
              note: line.note,
            };
          }
          return {
            purchaseOrderLineId: line.purchaseOrderLineId,
            receivedQuantity: normalizeDecimalInput(line.receivedQuantity),
            acceptedQuantity: normalizeDecimalInput(line.receivedQuantity),
            rejectedQuantity: '0',
            finalizeLine: false,
            locationId: line.locationId,
            lotId: line.lotId,
            lotCode: line.lotCode,
            manufacturedDate: line.manufacturedDate,
            expiryDate: line.expiryDate,
            supplierLotReference: line.supplierLotReference,
            note: line.note,
          };
        }),
        ...(editor.mode === 'edit' && editor.receipt ? { expectedRevision: editor.receipt.revision } : {}),
      };
      const saved = editor.mode === 'edit' && editor.receipt
        ? await requestJson<GoodsReceipt>(
          `/api/goods-receipts/${editor.receipt.id}`,
          {
            method: 'PATCH',
            headers: { 'Idempotency-Key': `gr-edit-${crypto.randomUUID()}` },
            body: JSON.stringify(payload),
          },
        )
        : await requestJson<GoodsReceipt>(
          '/api/goods-receipts',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': `gr-create-${crypto.randomUUID()}` },
            body: JSON.stringify(payload),
          },
        );
      upsertReceipt(saved);
      setEditor(null);
      setNotice(editor.mode === 'create' ? 'ÄÃ£ táº¡o phiáº¿u nháº­n hÃ ng nhÃ¡p.' : 'ÄÃ£ cáº­p nháº­t phiáº¿u nháº­n hÃ ng nhÃ¡p.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'KhÃ´ng lÆ°u Ä‘Æ°á»£c phiáº¿u nháº­n hÃ ng');
    } finally {
      setBusyId(null);
    }
  }

  async function runAction() {
    if (!pendingAction) return;
    const { action, goodsReceipt } = pendingAction;
    if (action === 'reverse' && !reverseReason.trim()) {
      setError('Vui lÃ²ng nháº­p lÃ½ do Ä‘áº£o phiáº¿u.');
      return;
    }
    setBusyId(goodsReceipt.id);
    setError(null);
    try {
      const updated = await requestJson<GoodsReceipt>(
        action === 'post'
          ? `/api/goods-receipts/${goodsReceipt.id}/post`
          : `/api/goods-receipts/${goodsReceipt.id}/reverse`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': receiptActionKey(action, goodsReceipt) },
          body: JSON.stringify(action === 'post'
            ? { expectedRevision: goodsReceipt.revision }
            : {
              expectedRevision: goodsReceipt.revision,
              documentDate: reverseDate,
              reasonNote: reverseReason.trim(),
            }),
        },
      );
      actionKeys.current.delete(`${action}:${goodsReceipt.id}:${goodsReceipt.revision}`);
      upsertReceipt(updated);
      if (selectedGoodsReceipt?.id === updated.id) setSelectedGoodsReceipt(updated);
      setPendingAction(null);
      setReverseReason('');
      setNotice(action === 'post' ? 'Phiáº¿u nháº­n hÃ ng Ä‘Ã£ Ä‘Æ°á»£c ghi sá»•.' : 'Phiáº¿u nháº­n hÃ ng Ä‘Ã£ Ä‘Æ°á»£c Ä‘áº£o.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'KhÃ´ng thá»±c hiá»‡n Ä‘Æ°á»£c thao tÃ¡c phiáº¿u nháº­n hÃ ng');
    } finally {
      setBusyId(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={() => void loadAll('Danh sÃ¡ch phiáº¿u nháº­n hÃ ng Ä‘Ã£ Ä‘Æ°á»£c cáº­p nháº­t.')}
        disabled={loadingList}
      >
        {loadingList ? 'Äang cáº­p nháº­tâ€¦' : 'Cáº­p nháº­t dá»¯ liá»‡u'}
      </button>
      {createAllowed && purchaseOrderReadable ? (
        <button
          type="button"
          className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
          onClick={() => void openCreate()}
          data-testid="goods-receipt-create-button"
        >
          Táº¡o phiáº¿u nháº­n hÃ ng
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      title="Phiáº¿u nháº­n hÃ ng"
      subtitle="Nháº­p hÃ ng tá»« Ä‘Æ¡n Ä‘áº·t hÃ ng, ghi sá»• tá»“n kho vÃ  Ä‘áº£o phiáº¿u khi cáº§n."
      kicker="Mua hÃ ng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="goods-receipts-page">
        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
        {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">{notice}</div> : null}
        {!purchaseOrderReadable ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            ChÆ°a nháº­n Ä‘Æ°á»£c quyá»n Ä‘á»c Ä‘Æ¡n Ä‘áº·t hÃ ng tá»« backend. Danh sÃ¡ch phiáº¿u nháº­n hÃ ng váº«n hiá»ƒn thá»‹ nhÆ°ng thao tÃ¡c táº¡o phiáº¿u sáº½ bá»‹ khÃ³a.
          </div>
        ) : null}
        {initialPermissionKeys.length === 0 ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            ChÆ°a nháº­n Ä‘Æ°á»£c quyá»n phiáº¿u nháº­n hÃ ng tá»« backend. CÃ¡c thao tÃ¡c thay Ä‘á»•i dá»¯ liá»‡u Ä‘ang bá»‹ khÃ³a.
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Sá»‘ liá»‡u phiáº¿u nháº­n hÃ ng">
          <article className={styles.summaryCard}>
            <span>Tá»•ng phiáº¿u</span><strong>{formatDecimalString(String(counts.total))}</strong><small>Trong pháº¡m vi kho Ä‘Æ°á»£c cáº¥p</small>
          </article>
          <article className={styles.summaryCard}>
            <span>NhÃ¡p</span><strong>{formatDecimalString(String(counts.draft))}</strong><small>CÃ²n cÃ³ thá»ƒ chá»‰nh sá»­a</small>
          </article>
          <article className={styles.summaryCard}>
            <span>ÄÃ£ ghi sá»•</span><strong>{formatDecimalString(String(counts.posted))}</strong><small>ÄÃ£ vÃ o tá»“n kho</small>
          </article>
          <article className={styles.summaryCard}>
            <span>ÄÃ£ Ä‘áº£o</span><strong>{formatDecimalString(String(counts.reversed))}</strong><small>Chá»©ng tá»« bÃ¹ Ä‘Ã£ phÃ¡t hÃ nh</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Bá»™ lá»c phiáº¿u nháº­n hÃ ng">
          <div className={styles.toolbarSearch}>
            <label htmlFor="goods-receipt-search">TÃ¬m kiáº¿m</label>
            <input
              id="goods-receipt-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sá»‘ phiáº¿u, sá»‘ Ä‘Æ¡n, nhÃ  cung cáº¥p, kho nháº­n, lÃ´ hÃ ngâ€¦"
              data-testid="goods-receipt-search"
            />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="goods-receipt-status">Tráº¡ng thÃ¡i</label>
            <select
              id="goods-receipt-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              data-testid="goods-receipt-status-filter"
            >
              <option value="all">Táº¥t cáº£ tráº¡ng thÃ¡i</option>
              {Object.entries(GOODS_RECEIPT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Danh sÃ¡ch phiáº¿u</p>
              <h2>Nháº­p hÃ ng vÃ  ghi sá»• tá»“n kho</h2>
            </div>
            <span className={styles.panelChip}>{formatDecimalString(String(visibleItems.length))} phiáº¿u</span>
          </div>
          <div className={localStyles.linesWrap}>
            <table className={localStyles.linesTable} data-testid="goods-receipts-table">
              <thead>
                <tr>
                  <th>Sá»‘ phiáº¿u</th>
                  <th>ÄÆ¡n Ä‘áº·t hÃ ng</th>
                  <th>Kho nháº­n</th>
                  <th>NgÃ y nháº­n</th>
                  <th>Tráº¡ng thÃ¡i</th>
                  <th>Sá»‘ dÃ²ng</th>
                  <th>Tá»•ng SL</th>
                  <th>Thao tÃ¡c</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((goodsReceipt) => (
                  <tr key={goodsReceipt.id}>
                    <td>
                      <div className={localStyles.lineIdentity}>
                        <strong>{goodsReceipt.documentNumber || 'ChÆ°a cáº¥p sá»‘'}</strong>
                        <span>{goodsReceipt.supplierCode} - {goodsReceipt.supplierName}</span>
                      </div>
                    </td>
                    <td>{goodsReceipt.purchaseOrderNumber || 'ChÆ°a cáº¥p sá»‘'}</td>
                    <td>{goodsReceipt.warehouseCode} - {goodsReceipt.warehouseName}</td>
                    <td>{formatGoodsReceiptDate(goodsReceipt.receiptDate)}</td>
                    <td>{GOODS_RECEIPT_STATUS_LABELS[goodsReceipt.status]}</td>
                    <td>{formatDecimalString(String(goodsReceipt.lineCount))}</td>
                    <td>{formatDecimalString(goodsReceipt.receivedQuantityTotal)}</td>
                    <td>
                      <div className={styles.toolbarActions}>
                        <button type="button" className={styles.secondaryButton} onClick={() => void openView(goodsReceipt)}>Xem</button>
                        {goodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.update') ? (
                          <button type="button" className={styles.secondaryButton} onClick={() => void openEdit(goodsReceipt)}>Sá»­a</button>
                        ) : null}
                        {goodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.post') ? (
                          <button type="button" className={styles.primaryButton} onClick={() => openAction('post', goodsReceipt)}>Ghi sá»•</button>
                        ) : null}
                        {goodsReceipt.status === 'posted' && initialPermissionKeys.includes('core.goods-receipt.reverse') ? (
                          <button type="button" className={styles.primaryButton} onClick={() => openAction('reverse', goodsReceipt)}>Äáº£o phiáº¿u</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {editor ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !editor.loading) setEditor(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !editor.loading) setEditor(null); }}>
          <section className={`${styles.modal} ${localStyles.wideModal}`} role="dialog" aria-modal="true" aria-labelledby="goods-receipt-editor-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>{editor.mode === 'create' ? 'Táº¡o phiáº¿u nháº­n hÃ ng' : 'Sá»­a phiáº¿u nháº­n hÃ ng nhÃ¡p'}</p>
                <h3 id="goods-receipt-editor-title">{editor.receipt?.documentNumber || 'Phiáº¿u nháº­n hÃ ng nhÃ¡p'}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setEditor(null)} disabled={editor.loading}>ÄÃ³ng</button>
            </div>

            <div className={localStyles.headerGrid}>
              <div className={styles.form}>
                <label>ÄÆ¡n Ä‘áº·t hÃ ng</label>
                <select
                  value={editor.purchaseOrderId}
                  onChange={(event) => void refreshEditorPurchaseOrder(event.target.value)}
                  disabled={editor.mode === 'edit' || editor.loading}
                >
                  {eligiblePurchaseOrders.map((purchaseOrder) => (
                    <option key={purchaseOrder.id} value={purchaseOrder.id}>
                      {purchaseOrder.number || 'ChÆ°a cáº¥p sá»‘'} - {purchaseOrder.supplierName}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.form}>
                <label>NgÃ y nháº­n</label>
                <input type="date" value={editor.receiptDate} onChange={(event) => setEditor((current) => current ? { ...current, receiptDate: event.target.value } : current)} disabled={editor.loading} />
              </div>
              <div className={styles.form}>
                <label>Tham chiáº¿u giao hÃ ng</label>
                <input value={editor.supplierDeliveryReference} onChange={(event) => setEditor((current) => current ? { ...current, supplierDeliveryReference: event.target.value } : current)} disabled={editor.loading} />
              </div>
              <div className={`${styles.form} ${localStyles.spanThree}`}>
                <label>Ghi chÃº</label>
                <input value={editor.note} onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)} disabled={editor.loading} />
              </div>
            </div>

            <div className={localStyles.linesWrap}>
              <table className={localStyles.linesTable}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Äáº·t</th>
                    <th>ÄÃ£ nháº­n</th>
                    <th>CÃ²n láº¡i</th>
                    <th>Thá»±c nháº­n</th>
                    <th>Cháº¥p nháº­n</th>
                    <th>Loáº¡i</th>
                    <th>Chá»‘t thiáº¿u</th>
                    <th>LÃ½ do CL</th>
                    <th>Ghi chÃº CL</th>
                    <th>Kho/Vá»‹ trÃ­</th>
                    <th>LÃ´ hÃ ng</th>
                    <th>NgÃ y SX</th>
                    <th>HSD</th>
                  </tr>
                </thead>
                <tbody>
                  {editor.lines.map((line, index) => {
                    const availableLocations = initialLocations.filter((location) => location.warehouse_id === editor.purchaseOrder?.warehouseId);
                    const receivedDisplay = varianceAllowed
                      ? decimalSum(line.acceptedQuantity, line.rejectedQuantity)
                      : normalizeDecimalInput(line.receivedQuantity);
                    const acceptedDisplay = varianceAllowed
                      ? line.acceptedQuantity
                      : normalizeDecimalInput(line.receivedQuantity);
                    const rejectedDisplay = varianceAllowed ? line.rejectedQuantity : '0';
                    const rejectedPositive = varianceAllowed && decimalPositive(line.rejectedQuantity);
                    const varianceReasonRequired = varianceAllowed && (rejectedPositive || line.finalizeLine);
                    return (
                      <tr key={`${line.purchaseOrderLineId}-${line.lineNumber}`}>
                        <td>
                          <div className={localStyles.lineIdentity}>
                            <strong>{line.skuCode}</strong>
                            <span>{line.itemName}</span>
                          </div>
                        </td>
                        <td>{formatDecimalString(line.orderedQuantity)}</td>
                        <td>{formatDecimalString(line.receivedQuantityBefore)}</td>
                        <td>{formatDecimalString(line.remainingQuantityBefore)}</td>
                        <td>
                          {varianceAllowed ? (
                            <div className={styles.form} style={{ gap: '0.5rem' }}>
                              <strong>{formatDecimalString(receivedDisplay)}</strong>
                              <small>Nháº­n = cháº¥p nháº­n + loáº¡i</small>
                            </div>
                          ) : (
                            <input
                              value={line.receivedQuantity}
                              onChange={(event) => updateEditorLine(index, { receivedQuantity: event.target.value })}
                              inputMode="decimal"
                              disabled={editor.loading}
                            />
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <input
                              value={acceptedDisplay}
                              onChange={(event) => updateEditorLine(index, { acceptedQuantity: event.target.value })}
                              inputMode="decimal"
                              disabled={editor.loading}
                            />
                          ) : (
                            <strong>{formatDecimalString(acceptedDisplay)}</strong>
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <input
                              value={rejectedDisplay}
                              onChange={(event) => updateEditorLine(index, { rejectedQuantity: event.target.value })}
                              inputMode="decimal"
                              disabled={editor.loading}
                            />
                          ) : (
                            <strong>{formatDecimalString(rejectedDisplay)}</strong>
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <label className={styles.inlineCheckbox}>
                              <input
                                type="checkbox"
                                checked={line.finalizeLine}
                                onChange={(event) => updateEditorLine(index, { finalizeLine: event.target.checked })}
                                disabled={editor.loading}
                              />
                              Chá»‘t
                            </label>
                          ) : (
                            <span>KhÃ´ng</span>
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <input
                              value={line.qualityReasonCode}
                              onChange={(event) => updateEditorLine(index, { qualityReasonCode: event.target.value })}
                              disabled={editor.loading || !varianceReasonRequired}
                              placeholder={rejectedPositive ? 'VD: DAMAGED' : 'Chá»‰ má»Ÿ khi cÃ³ loáº¡i'}
                              maxLength={64}
                            />
                          ) : (
                            <span>â€”</span>
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <input
                              value={line.qualityNote}
                              onChange={(event) => updateEditorLine(index, { qualityNote: event.target.value })}
                              disabled={editor.loading || !varianceReasonRequired}
                              placeholder={rejectedPositive ? 'Ghi chÃº cháº¥t lÆ°á»£ng' : 'Chá»‰ má»Ÿ khi cÃ³ loáº¡i'}
                              maxLength={2000}
                            />
                          ) : (
                            <span>â€”</span>
                          )}
                        </td>
                        <td>
                          <select
                            value={line.locationId}
                            onChange={(event) => updateEditorLine(index, { locationId: event.target.value })}
                            disabled={editor.loading}
                          >
                            <option value="">KhÃ´ng chá»n</option>
                            {availableLocations.map((location) => (
                              <option key={location.id} value={location.id}>{location.code} - {location.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            value={line.lotCode}
                            onChange={(event) => updateEditorLine(index, { lotCode: event.target.value })}
                            disabled={editor.loading}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={line.manufacturedDate}
                            onChange={(event) => updateEditorLine(index, { manufacturedDate: event.target.value })}
                            disabled={editor.loading}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={line.expiryDate}
                            onChange={(event) => updateEditorLine(index, { expiryDate: event.target.value })}
                            disabled={editor.loading}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={localStyles.totals}>
              <div className={localStyles.totalCard}><span>ÄÆ¡n Ä‘áº·t hÃ ng</span><strong>{activePurchaseOrder?.number || 'ChÆ°a cáº¥p sá»‘'}</strong></div>
              <div className={localStyles.totalCard}><span>NhÃ  cung cáº¥p</span><strong>{activePurchaseOrder?.supplierName || '---'}</strong></div>
              <div className={localStyles.totalCard}><span>Kho nháº­n</span><strong>{activePurchaseOrder?.warehouseName || '---'}</strong></div>
              <div className={localStyles.totalCard}><span>Sá»‘ dÃ²ng</span><strong>{formatDecimalString(String(editor.lines.length))}</strong></div>
              <div className={localStyles.totalCard}><span>ChÃªnh lá»‡ch</span><strong>{varianceAllowed ? 'CÃ³' : 'KhÃ´ng'}</strong></div>
            </div>

            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)} disabled={editor.loading}>Há»§y</button>
              <button type="button" className={styles.primaryButton} onClick={() => void saveEditor()} disabled={editor.loading} data-testid="goods-receipt-save-button">
                {busyId ? 'Äang lÆ°uâ€¦' : editor.mode === 'create' ? 'Táº¡o phiáº¿u' : 'LÆ°u phiáº¿u'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedGoodsReceipt ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedGoodsReceipt(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setSelectedGoodsReceipt(null); }}>
          <section className={`${styles.modal} ${localStyles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="goods-receipt-detail-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>Chi tiáº¿t phiáº¿u nháº­n hÃ ng</p>
                <h3 id="goods-receipt-detail-title">{selectedGoodsReceipt.documentNumber || 'Phiáº¿u chÆ°a cáº¥p sá»‘'}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setSelectedGoodsReceipt(null)}>ÄÃ³ng</button>
            </div>
            <div className={localStyles.detailGrid}>
              <div className={localStyles.detailItem}><span>Tráº¡ng thÃ¡i</span><strong>{GOODS_RECEIPT_STATUS_LABELS[selectedGoodsReceipt.status]}</strong></div>
              <div className={localStyles.detailItem}><span>ÄÆ¡n Ä‘áº·t hÃ ng</span><strong>{selectedGoodsReceipt.purchaseOrderNumber || 'ChÆ°a cáº¥p sá»‘'}</strong></div>
              <div className={localStyles.detailItem}><span>Kho nháº­n</span><strong>{selectedGoodsReceipt.warehouseCode} - {selectedGoodsReceipt.warehouseName}</strong></div>
              <div className={localStyles.detailItem}><span>NgÃ y nháº­n</span><strong>{formatGoodsReceiptDate(selectedGoodsReceipt.receiptDate)}</strong></div>
              <div className={localStyles.detailItem}><span>Tham chiáº¿u giao hÃ ng</span><strong>{selectedGoodsReceipt.supplierDeliveryReference || 'KhÃ´ng cÃ³'}</strong></div>
              <div className={localStyles.detailItem}><span>Tráº¡ng thÃ¡i PO</span><strong>{PURCHASE_ORDER_STATUS_LABELS[selectedGoodsReceipt.purchaseOrderStatus as keyof typeof PURCHASE_ORDER_STATUS_LABELS]}</strong></div>
            </div>
            <div className={localStyles.linesWrap}>
              <table className={localStyles.linesTable}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Thực nhận</th>
                    <th>Chấp nhận</th>
                    <th>Loại</th>
                    <th>Chốt thiếu</th>
                    <th>Lý do chênh lệch</th>
                    <th>Ghi chú chênh lệch</th>
                    <th>Đơn vị</th>
                    <th>Vị trí</th>
                    <th>Lô</th>
                    <th>HSD</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedGoodsReceipt.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td>
                        <div className={localStyles.lineIdentity}>
                          <strong>{line.skuCode}</strong>
                          <span>{line.itemName}</span>
                        </div>
                      </td>
                      <td>{formatDecimalString(line.receivedQuantity)}</td>
                      <td>{formatDecimalString(line.acceptedQuantity)}</td>
                      <td>{formatDecimalString(line.rejectedQuantity)}</td>
                      <td>{formatDecimalString(line.shortageClosedQuantity)}</td>
                      <td>{line.qualityReasonCode || 'Không có'}</td>
                      <td>{line.qualityNote || 'Không có'}</td>
                      <td>{line.unitCode}</td>
                      <td>{line.locationId || 'Không có'}</td>
                      <td>{line.lotCode || 'Không có'}</td>
                      <td>{line.expiryDate || 'Không có'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={localStyles.totals}>
              <div className={localStyles.totalCard}><span>Thực nhận</span><strong>{formatDecimalString(selectedGoodsReceipt.receivedQuantityTotal)}</strong></div>
              <div className={localStyles.totalCard}><span>Chấp nhận</span><strong>{formatDecimalString(selectedGoodsReceipt.acceptedQuantityTotal)}</strong></div>
              <div className={localStyles.totalCard}><span>Loại</span><strong>{formatDecimalString(selectedGoodsReceipt.rejectedQuantityTotal)}</strong></div>
              <div className={localStyles.totalCard}><span>Chốt thiếu</span><strong>{formatDecimalString(selectedGoodsReceipt.shortageClosedQuantityTotal)}</strong></div>
              <div className={localStyles.totalCard}><span>Trạng thái</span><strong>{GOODS_RECEIPT_STATUS_LABELS[selectedGoodsReceipt.status]}</strong></div>
              <div className={localStyles.totalCard}><span>Ngày tạo</span><strong>{formatGoodsReceiptDate(selectedGoodsReceipt.createdAt)}</strong></div>
              <div className={localStyles.totalCard}><span>Cập nhật</span><strong>{formatGoodsReceiptDate(selectedGoodsReceipt.updatedAt)}</strong></div>
            </div>
            <div className={localStyles.modalActions}>
              {selectedGoodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.update') ? (
                <button type="button" className={styles.secondaryButton} onClick={() => void openEdit(selectedGoodsReceipt)} disabled={Boolean(busyId)}>Sá»­a nhÃ¡p</button>
              ) : null}
              {selectedGoodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.post') ? (
                <button type="button" className={styles.primaryButton} onClick={() => openAction('post', selectedGoodsReceipt)} disabled={Boolean(busyId)}>Ghi sá»•</button>
              ) : null}
              {selectedGoodsReceipt.status === 'posted' && initialPermissionKeys.includes('core.goods-receipt.reverse') ? (
                <button type="button" className={styles.primaryButton} onClick={() => openAction('reverse', selectedGoodsReceipt)} disabled={Boolean(busyId)}>Äáº£o phiáº¿u</button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busyId) setPendingAction(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busyId) setPendingAction(null); }}>
          <section className={`${styles.modal} ${styles.confirmModal}`} role="dialog" aria-modal="true" aria-labelledby="goods-receipt-action-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>XÃ¡c nháº­n nghiá»‡p vá»¥</p>
                <h3 id="goods-receipt-action-title">{actionLabel(pendingAction.action)}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>ÄÃ³ng</button>
            </div>
            <p className={localStyles.actionCopy}>{actionMessage(pendingAction.action, pendingAction.goodsReceipt)}</p>
            {pendingAction.action === 'reverse' ? (
              <div className={styles.form}>
                <label>LÃ½ do Ä‘áº£o phiáº¿u<input value={reverseReason} maxLength={1000} onChange={(event) => setReverseReason(event.target.value)} autoFocus /></label>
                <label>NgÃ y Ä‘áº£o phiáº¿u<input type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} /></label>
              </div>
            ) : null}
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>Quay láº¡i</button>
              <button type="button" className={styles.primaryButton} onClick={() => void runAction()} disabled={Boolean(busyId)} data-testid={`goods-receipt-${pendingAction.action}-confirm`}>
                {busyId ? 'Äang xá»­ lÃ½â€¦' : actionLabel(pendingAction.action)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
