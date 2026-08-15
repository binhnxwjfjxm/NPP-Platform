'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from '../purchase-orders/purchase-orders.module.css';
import GoodsReceiptPrintDock from './GoodsReceiptPrintDock';
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
type TrackingPolicy = {
  baseVariantId: string;
  lotTrackingMode: 'NONE' | 'REQUIRED';
  expiryTrackingMode: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  locationRequired: boolean;
};
type TrackingRequirement = {
  purchaseOrderLineId: string;
  lineNumber: number;
  sourceVariantId: string;
  skuCode: string;
  trackingPolicy: TrackingPolicy | null;
};
type GoodsReceiptLineWithTracking = NonNullable<GoodsReceipt['lines']>[number] & {
  trackingPolicy?: TrackingPolicy | null;
};
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
  trackingPolicy: TrackingPolicy | null;
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
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu phiếu nhận hàng');
  }
  return payload.data;
}

function actionLabel(action: ActionName) {
  return action === 'post' ? 'Ghi sổ' : 'Đảo phiếu';
}

function actionMessage(action: ActionName, goodsReceipt: GoodsReceipt) {
  const identifier = goodsReceipt.documentNumber || 'phiếu chưa cấp số';
  if (action === 'post') {
    return `Ghi sổ ${identifier}? Phần chấp nhận sẽ vào tồn kho; phần loại hoặc chốt thiếu chỉ được ghi nhận trên phiếu.`;
  }
  return `Đảo ${identifier}? Hệ thống sẽ tạo chứng từ bù và trừ tồn kho ngược lại.`;
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

function buildDraftLineFromOrderLine(
  line: PurchaseOrderLine,
  warehouseLocations: WarehouseLocation[],
  trackingPolicy: TrackingPolicy | null,
): DraftLine {
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
    trackingPolicy,
  };
}

function buildDraftLineFromReceiptLine(line: GoodsReceiptLineWithTracking): DraftLine {
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
    trackingPolicy: line.trackingPolicy ?? null,
  };
}

function trackingIssue(line: DraftLine): string | null {
  if (!decimalPositive(line.acceptedQuantity)) return null;
  const policy = line.trackingPolicy;
  if (!policy) return `SKU ${line.skuCode} chưa được cấu hình quản lý lô/kho.`;
  if (policy.locationRequired && !line.locationId.trim()) {
    return `SKU ${line.skuCode} bắt buộc chọn vị trí kho.`;
  }
  if (policy.lotTrackingMode === 'REQUIRED' && !line.lotId.trim() && !line.lotCode.trim()) {
    return `SKU ${line.skuCode} bắt buộc nhập Số lô.`;
  }
  if (policy.expiryTrackingMode === 'REQUIRED' && !line.lotId.trim() && !line.expiryDate.trim()) {
    return `SKU ${line.skuCode} bắt buộc nhập Hạn sử dụng.`;
  }
  return null;
}

function needsTrackingGuidance(line: DraftLine): boolean {
  const policy = line.trackingPolicy;
  return Boolean(
    policy
      && decimalPositive(line.acceptedQuantity)
      && (
        policy.lotTrackingMode === 'REQUIRED'
        || policy.expiryTrackingMode !== 'NONE'
        || (policy.locationRequired && !line.locationId.trim())
      ),
  );
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
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(initialPurchaseOrders);
  const [error, setError] = useState<string | null>(initialError || initialLookupError);
  const [receiptRefreshError, setReceiptRefreshError] = useState<string | null>(null);
  const [purchaseOrderRefreshError, setPurchaseOrderRefreshError] = useState<string | null>(null);
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
  const refreshGeneration = useRef(0);

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
    () => purchaseOrders.filter((purchaseOrder) => ['approved', 'partially_received'].includes(purchaseOrder.status)),
    [purchaseOrders],
  );

  const draftPolicy = goodsReceiptActionPolicy('draft', initialPermissionKeys);
  const createAllowed = draftPolicy.create;
  const varianceAllowed = draftPolicy.variance;
  const purchaseOrderReadable = initialPurchaseOrderPermissionKeys.includes('core.purchase-order.read');
  const activePurchaseOrder = editor?.purchaseOrder ?? null;
  const trackingGuidanceLines = editor?.lines.filter(needsTrackingGuidance) ?? [];
  const editorOpen = Boolean(editor);

  useEffect(() => {
    if (selectedGoodsReceipt || pendingAction || editorOpen) closeButtonRef.current?.focus();
  }, [editorOpen, pendingAction, selectedGoodsReceipt]);

  function upsertReceipt(goodsReceipt: GoodsReceipt) {
    refreshGeneration.current += 1;
    setLoadingList(false);
    setItems((current) => {
      const index = current.findIndex((item) => item.id === goodsReceipt.id);
      if (index < 0) return [goodsReceipt, ...current];
      return current.map((item) => (item.id === goodsReceipt.id ? goodsReceipt : item));
    });
  }

  async function loadAll(successMessage?: string) {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    setLoadingList(true);
    setError(null);
    setNotice(null);
    setReceiptRefreshError(null);
    setPurchaseOrderRefreshError(null);
    try {
      const [receiptsResult, purchaseOrdersResult] = await Promise.allSettled([
        requestJson<GoodsReceipt[]>('/api/goods-receipts?limit=1000'),
        requestJson<PurchaseOrder[]>('/api/purchase-orders?limit=1000'),
      ]);

      if (refreshGeneration.current !== generation) return;

      if (receiptsResult.status === 'fulfilled') {
        setItems(receiptsResult.value);
      } else {
        setReceiptRefreshError(
          receiptsResult.reason instanceof Error
            ? receiptsResult.reason.message
            : 'Không tải được danh sách phiếu nhận hàng',
        );
      }

      if (purchaseOrdersResult.status === 'fulfilled') {
        setPurchaseOrders(purchaseOrdersResult.value);
      } else {
        setPurchaseOrderRefreshError(
          purchaseOrdersResult.reason instanceof Error
            ? purchaseOrdersResult.reason.message
            : 'Không tải được danh sách đơn đặt hàng',
        );
      }

      if (successMessage && receiptsResult.status === 'fulfilled' && purchaseOrdersResult.status === 'fulfilled') {
        setNotice(successMessage);
      } else if (receiptsResult.status === 'fulfilled' || purchaseOrdersResult.status === 'fulfilled') {
        setNotice('Đã cập nhật nguồn tải thành công; nguồn còn lỗi đang giữ dữ liệu gần nhất.');
      }
    } finally {
      if (refreshGeneration.current === generation) {
        setLoadingList(false);
      }
    }
  }

  async function loadReceiptDetail(goodsReceipt: GoodsReceipt): Promise<GoodsReceipt | null> {
    setBusyId(goodsReceipt.id);
    setError(null);
    try {
      return await requestJson<GoodsReceipt>(`/api/goods-receipts/${goodsReceipt.id}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết phiếu nhận hàng');
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
      setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết đơn đặt hàng');
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

  function openCreate() {
    setError(null);
    setNotice(null);
    if (!eligiblePurchaseOrders.length) {
      setError('Chưa có đơn đặt hàng nào ở trạng thái đã duyệt để tạo phiếu nhận hàng.');
      return;
    }
    setEditor({
      mode: 'create',
      receipt: null,
      purchaseOrder: null,
      purchaseOrderId: '',
      receiptDate: todayLocal(),
      supplierDeliveryReference: '',
      note: '',
      lines: [],
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
      lines: ((detail.lines ?? []) as GoodsReceiptLineWithTracking[]).map(buildDraftLineFromReceiptLine),
      loading: false,
    });
  }

  async function openAction(action: ActionName, goodsReceipt: GoodsReceipt) {
    setError(null);
    setNotice(null);
    setReverseReason('');
    setReverseDate(todayLocal());

    if (action === 'post') {
      const detail = await loadReceiptDetail(goodsReceipt);
      if (!detail) return;
      const draftLines = ((detail.lines ?? []) as GoodsReceiptLineWithTracking[]).map(buildDraftLineFromReceiptLine);
      const missingPolicy = draftLines.find((line) => decimalPositive(line.acceptedQuantity) && !line.trackingPolicy);
      if (missingPolicy) {
        setError(`Chưa thể ghi sổ: SKU ${missingPolicy.skuCode} chưa được cấu hình quản lý lô/kho. Cần cấu hình mặt hàng trước, hệ thống chưa gửi yêu cầu Ghi sổ.`);
        return;
      }
      const missingTracking = draftLines.map(trackingIssue).find((message): message is string => Boolean(message));
      if (missingTracking) {
        if (!initialPermissionKeys.includes('core.goods-receipt.update')) {
          setError(`Chưa thể ghi sổ: ${missingTracking} Tài khoản hiện tại không có quyền sửa phiếu để bổ sung.`);
          return;
        }
        const purchaseOrder = await loadPurchaseOrderDetail(detail.purchaseOrderId);
        if (!purchaseOrder) return;
        setSelectedGoodsReceipt(null);
        setPendingAction(null);
        setEditor({
          mode: 'edit',
          receipt: detail,
          purchaseOrder,
          purchaseOrderId: detail.purchaseOrderId,
          receiptDate: detail.receiptDate,
          supplierDeliveryReference: detail.supplierDeliveryReference ?? '',
          note: detail.note ?? '',
          lines: draftLines,
          loading: false,
        });
        setError(`Chưa thể ghi sổ: ${missingTracking} Phiếu đã được mở để bổ sung. Nhập thông tin ở khung “Cần bổ sung trước khi ghi sổ”, lưu phiếu rồi Ghi sổ lại.`);
        return;
      }
      setPendingAction({ action, goodsReceipt: detail });
      return;
    }

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
    if (!editor || editor.mode !== 'create' || !purchaseOrderId) return;
    setEditor((current) => current?.mode === 'create'
      ? { ...current, purchaseOrderId, purchaseOrder: null, lines: [], loading: true }
      : current);
    const purchaseOrder = await loadPurchaseOrderDetail(purchaseOrderId);
    if (!purchaseOrder?.lines?.length) {
      setEditor((current) => current?.mode === 'create' && current.purchaseOrderId === purchaseOrderId
        ? { ...current, loading: false }
        : current);
      if (purchaseOrder) setError('Đơn đặt hàng được chọn chưa có dòng hàng hợp lệ.');
      return;
    }

    let requirements: TrackingRequirement[];
    try {
      requirements = await requestJson<TrackingRequirement[]>(
        `/api/goods-receipts/tracking-requirements?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`,
      );
    } catch (trackingError) {
      setEditor((current) => current?.mode === 'create' && current.purchaseOrderId === purchaseOrderId
        ? { ...current, purchaseOrder: null, lines: [], loading: false }
        : current);
      setError(trackingError instanceof Error
        ? `Không tải được yêu cầu lô/kho của đơn đặt hàng: ${trackingError.message}`
        : 'Không tải được yêu cầu lô/kho của đơn đặt hàng.');
      return;
    }

    const purchaseOrderLines = purchaseOrder.lines ?? [];
    const requirementByLineId = new Map(requirements.map((requirement) => [requirement.purchaseOrderLineId, requirement]));
    const incompleteRequirement = purchaseOrderLines.find((line) => !requirementByLineId.has(line.id));
    if (incompleteRequirement) {
      setEditor((current) => current?.mode === 'create' && current.purchaseOrderId === purchaseOrderId
        ? { ...current, purchaseOrder: null, lines: [], loading: false }
        : current);
      setError(`Không xác định được yêu cầu lô/kho cho SKU ${incompleteRequirement.skuCode}. Chưa thể tạo phiếu nhận hàng.`);
      return;
    }
    const missingPolicy = requirements.find((requirement) => !requirement.trackingPolicy);
    if (missingPolicy) {
      setEditor((current) => current?.mode === 'create' && current.purchaseOrderId === purchaseOrderId
        ? { ...current, purchaseOrder: null, lines: [], loading: false }
        : current);
      setError(`SKU ${missingPolicy.skuCode} chưa được cấu hình quản lý lô/kho. Cần cấu hình mặt hàng trước khi tạo phiếu nhận hàng.`);
      return;
    }

    const warehouseLocations = initialLocations.filter((location) => location.warehouse_id === purchaseOrder.warehouseId);
    setEditor((current) => {
      if (!current || current.mode !== 'create' || current.purchaseOrderId !== purchaseOrderId) return current;
      return {
        ...current,
        purchaseOrder,
        lines: purchaseOrderLines.map((line) => buildDraftLineFromOrderLine(
          line,
          warehouseLocations,
          requirementByLineId.get(line.id)?.trackingPolicy ?? null,
        )),
        loading: false,
      };
    });
  }

  async function saveEditor() {
    if (!editor || !editor.purchaseOrder) return;
    const purchaseOrder = editor.purchaseOrder;
    for (const line of editor.lines) {
      if (!line.purchaseOrderLineId) {
        setError('Vui lòng chọn đúng dòng đơn đặt hàng cho từng mặt hàng.');
        return;
      }
      if (varianceAllowed) {
        const accepted = decimalToScaled(normalizeDecimalInput(line.acceptedQuantity), true) ?? 0n;
        const rejected = decimalToScaled(normalizeDecimalInput(line.rejectedQuantity), true) ?? 0n;
        if (accepted + rejected <= 0n) {
          setError('Vui lòng nhập số lượng chấp nhận hoặc loại hợp lệ cho ít nhất một dòng.');
          return;
        }
        if ((rejected > 0n || line.finalizeLine) && (!line.qualityReasonCode.trim() || !line.qualityNote.trim())) {
          setError('Dòng có hàng loại hoặc chốt thiếu phải có mã lý do và ghi chú chênh lệch.');
          return;
        }
      } else if (!decimalPositive(line.receivedQuantity)) {
        setError('Vui lòng nhập số lượng nhận hợp lệ cho ít nhất một dòng.');
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
      setNotice(editor.mode === 'create' ? 'Đã tạo phiếu nhận hàng nháp.' : 'Đã cập nhật phiếu nhận hàng nháp.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được phiếu nhận hàng');
    } finally {
      setBusyId(null);
    }
  }

  async function runAction() {
    if (!pendingAction) return;
    const { action, goodsReceipt } = pendingAction;
    if (action === 'reverse' && !reverseReason.trim()) {
      setError('Vui lòng nhập lý do đảo phiếu.');
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
      void loadAll(action === 'post' ? 'Phiếu nhận hàng đã được ghi sổ.' : 'Phiếu nhận hàng đã được đảo.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Không thực hiện được thao tác phiếu nhận hàng');
    } finally {
      setBusyId(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={() => void loadAll('Danh sách phiếu nhận hàng và đơn đặt hàng đã được cập nhật.')}
        disabled={loadingList}
        data-testid="goods-receipt-refresh-button"
      >
        {loadingList ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      {createAllowed && purchaseOrderReadable ? (
        <button
          type="button"
          className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
          onClick={openCreate}
          data-testid="goods-receipt-create-button"
        >
          Tạo phiếu nhận hàng
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      title="Phiếu nhận hàng"
      subtitle="Nhập hàng từ đơn đặt hàng, ghi sổ tồn kho và đảo phiếu khi cần."
      kicker="Mua hàng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="goods-receipts-page">
        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
        {receiptRefreshError ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert" data-testid="goods-receipt-refresh-error">
            Phiếu nhận hàng chưa cập nhật: {receiptRefreshError}. Đang giữ dữ liệu gần nhất.
          </div>
        ) : null}
        {purchaseOrderRefreshError ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert" data-testid="purchase-order-refresh-error">
            Đơn đặt hàng chưa cập nhật: {purchaseOrderRefreshError}. Đang giữ dữ liệu gần nhất.
          </div>
        ) : null}
        {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">{notice}</div> : null}
        {!purchaseOrderReadable ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            Chưa nhận được quyền đọc đơn đặt hàng từ backend. Danh sách phiếu nhận hàng vẫn hiển thị nhưng thao tác tạo phiếu sẽ bị khóa.
          </div>
        ) : null}
        {initialPermissionKeys.length === 0 ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            Chưa nhận được quyền phiếu nhận hàng từ backend. Các thao tác thay đổi dữ liệu đang bị khóa.
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Số liệu phiếu nhận hàng">
          <article className={styles.summaryCard}>
            <span>Tổng phiếu</span><strong>{formatDecimalString(String(counts.total))}</strong><small>Trong phạm vi kho được cấp</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Nháp</span><strong>{formatDecimalString(String(counts.draft))}</strong><small>Còn có thể chỉnh sửa</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đã ghi sổ</span><strong>{formatDecimalString(String(counts.posted))}</strong><small>Đã ghi nhận nhập hàng và chênh lệch</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đã đảo</span><strong>{formatDecimalString(String(counts.reversed))}</strong><small>Chứng từ bù đã phát hành</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Bộ lọc phiếu nhận hàng">
          <div className={styles.toolbarSearch}>
            <label htmlFor="goods-receipt-search">Tìm kiếm</label>
            <input
              id="goods-receipt-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Số phiếu, số đơn, nhà cung cấp, kho nhận, lô hàng…"
              data-testid="goods-receipt-search"
            />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="goods-receipt-status">Trạng thái</label>
            <select
              id="goods-receipt-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              data-testid="goods-receipt-status-filter"
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(GOODS_RECEIPT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Danh sách phiếu</p>
              <h2>Nhập hàng và ghi sổ tồn kho</h2>
            </div>
            <span className={styles.panelChip}>{formatDecimalString(String(visibleItems.length))} phiếu</span>
          </div>
          <div className={localStyles.linesWrap}>
            <table className={localStyles.linesTable} data-testid="goods-receipts-table">
              <thead>
                <tr>
                  <th>Số phiếu</th>
                  <th>Đơn đặt hàng</th>
                  <th>Kho nhận</th>
                  <th>Ngày nhận</th>
                  <th>Trạng thái</th>
                  <th>Số dòng</th>
                  <th>Tổng SL</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((goodsReceipt) => (
                  <tr key={goodsReceipt.id}>
                    <td>
                      <div className={localStyles.lineIdentity}>
                        <strong>{goodsReceipt.documentNumber || 'Chưa cấp số'}</strong>
                        <span>{goodsReceipt.supplierCode} - {goodsReceipt.supplierName}</span>
                      </div>
                    </td>
                    <td>{goodsReceipt.purchaseOrderNumber || 'Chưa cấp số'}</td>
                    <td>{goodsReceipt.warehouseCode} - {goodsReceipt.warehouseName}</td>
                    <td>{formatGoodsReceiptDate(goodsReceipt.receiptDate)}</td>
                    <td>{GOODS_RECEIPT_STATUS_LABELS[goodsReceipt.status]}</td>
                    <td>{formatDecimalString(String(goodsReceipt.lineCount))}</td>
                    <td>{formatDecimalString(goodsReceipt.receivedQuantityTotal)}</td>
                    <td>
                      <div className={styles.toolbarActions}>
                        <button type="button" className={styles.secondaryButton} onClick={() => void openView(goodsReceipt)}>Xem</button>
                        {goodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.update') ? (
                          <button type="button" className={styles.secondaryButton} onClick={() => void openEdit(goodsReceipt)}>Sửa</button>
                        ) : null}
                        {goodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.post') ? (
                          <button type="button" className={styles.primaryButton} onClick={() => void openAction('post', goodsReceipt)}>Ghi sổ</button>
                        ) : null}
                        {goodsReceipt.status === 'posted' && initialPermissionKeys.includes('core.goods-receipt.reverse') ? (
                          <button type="button" className={styles.primaryButton} onClick={() => void openAction('reverse', goodsReceipt)}>Đảo phiếu</button>
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
                <p className={styles.panelKicker}>{editor.mode === 'create' ? 'Tạo phiếu nhận hàng' : 'Sửa phiếu nhận hàng nháp'}</p>
                <h3 id="goods-receipt-editor-title">{editor.receipt?.documentNumber || 'Phiếu nhận hàng nháp'}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setEditor(null)} disabled={editor.loading}>Đóng</button>
            </div>

            {error ? (
              <div className={`${styles.banner} ${styles.bannerError}`} role="alert" data-testid="goods-receipt-editor-error">
                {error}
              </div>
            ) : null}

            <div className={localStyles.headerGrid}>
              <div className={styles.form}>
                <label>Đơn đặt hàng</label>
                <select
                  value={editor.purchaseOrderId}
                  onChange={(event) => {
                    const purchaseOrderId = event.currentTarget.value;
                    void refreshEditorPurchaseOrder(purchaseOrderId);
                  }}
                  disabled={editor.mode === 'edit' || editor.loading}
                  data-testid="goods-receipt-purchase-order-select"
                >
                  {editor.mode === 'create' ? <option value="">Chọn đơn đặt hàng</option> : null}
                  {eligiblePurchaseOrders.map((purchaseOrder) => (
                    <option key={purchaseOrder.id} value={purchaseOrder.id}>
                      {purchaseOrder.number || 'Chưa cấp số'} - {purchaseOrder.supplierName}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.form}>
                <label>Ngày nhận</label>
                <input type="date" value={editor.receiptDate} onChange={(event) => setEditor((current) => current ? { ...current, receiptDate: event.target.value } : current)} disabled={editor.loading} />
              </div>
              <div className={styles.form}>
                <label>Tham chiếu giao hàng</label>
                <input value={editor.supplierDeliveryReference} onChange={(event) => setEditor((current) => current ? { ...current, supplierDeliveryReference: event.target.value } : current)} disabled={editor.loading} />
              </div>
              <div className={`${styles.form} ${localStyles.spanThree}`}>
                <label>Ghi chú</label>
                <input value={editor.note} onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)} disabled={editor.loading} />
              </div>
            </div>

            {trackingGuidanceLines.length > 0 ? (
              <section className={styles.tableSection} aria-label="Thông tin bắt buộc trước khi ghi sổ" data-testid="goods-receipt-tracking-panel">
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.panelKicker}>Cần bổ sung trước khi ghi sổ</p>
                    <h2>Lô, hạn sử dụng và vị trí kho</h2>
                    <small>Có thể lưu nháp trước; các mục có dấu * phải đủ trước khi Ghi sổ.</small>
                  </div>
                </div>
                <div className={localStyles.headerGrid}>
                  {editor.lines.map((line, index) => {
                    if (!needsTrackingGuidance(line) || !line.trackingPolicy) return null;
                    const policy = line.trackingPolicy;
                    const availableLocations = initialLocations.filter((location) => location.warehouse_id === editor.purchaseOrder?.warehouseId);
                    return (
                      <div key={`tracking-${line.purchaseOrderLineId}`} className={`${styles.form} ${localStyles.spanThree}`} data-testid={`goods-receipt-tracking-${line.purchaseOrderLineId}`}>
                        <strong>{line.skuCode} — {line.itemName}</strong>
                        {policy.locationRequired ? (
                          <label>
                            Vị trí kho *
                            <select
                              value={line.locationId}
                              onChange={(event) => updateEditorLine(index, { locationId: event.target.value })}
                              disabled={editor.loading}
                            >
                              <option value="">Chọn vị trí kho</option>
                              {availableLocations.map((location) => (
                                <option key={location.id} value={location.id}>{location.code} - {location.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {policy.lotTrackingMode === 'REQUIRED' ? (
                          <label>
                            Số lô *
                            <input
                              value={line.lotCode}
                              onChange={(event) => updateEditorLine(index, { lotCode: event.target.value })}
                              placeholder="Nhập số lô trên bao bì"
                              maxLength={100}
                              disabled={editor.loading || Boolean(line.lotId)}
                              data-testid={`goods-receipt-lot-code-${line.purchaseOrderLineId}`}
                            />
                          </label>
                        ) : null}
                        {policy.lotTrackingMode === 'REQUIRED' ? (
                          <label>
                            Ngày sản xuất (nếu có)
                            <input
                              type="date"
                              value={line.manufacturedDate}
                              onChange={(event) => updateEditorLine(index, { manufacturedDate: event.target.value })}
                              disabled={editor.loading || Boolean(line.lotId)}
                            />
                          </label>
                        ) : null}
                        {policy.expiryTrackingMode !== 'NONE' ? (
                          <label>
                            {policy.expiryTrackingMode === 'REQUIRED' ? 'Hạn sử dụng *' : 'Hạn sử dụng (nếu có)'}
                            <input
                              type="date"
                              value={line.expiryDate}
                              onChange={(event) => updateEditorLine(index, { expiryDate: event.target.value })}
                              disabled={editor.loading || Boolean(line.lotId)}
                              data-testid={`goods-receipt-expiry-${line.purchaseOrderLineId}`}
                            />
                          </label>
                        ) : null}
                        <small>
                          {policy.lotTrackingMode === 'REQUIRED'
                            ? 'Mặt hàng này bắt buộc có số lô trước khi ghi sổ.'
                            : 'Mặt hàng này có yêu cầu theo dõi kho cần hoàn tất trước khi ghi sổ.'}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className={localStyles.linesWrap}>
              <table className={localStyles.linesTable}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Đặt</th>
                    <th>Đã nhận</th>
                    <th>Còn lại</th>
                    <th>Thực nhận</th>
                    <th>Chấp nhận</th>
                    <th>Loại</th>
                    <th>Chốt thiếu</th>
                    <th>Lý do chênh lệch</th>
                    <th>Ghi chú chênh lệch</th>
                    <th>Kho/Vị trí</th>
                    <th>Lô hàng</th>
                    <th>Ngày SX</th>
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
                              <small>Nhận = chấp nhận + loại</small>
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
                              Chốt
                            </label>
                          ) : (
                            <span>Không</span>
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <input
                              value={line.qualityReasonCode}
                              onChange={(event) => updateEditorLine(index, { qualityReasonCode: event.target.value })}
                              disabled={editor.loading || !varianceReasonRequired}
                              placeholder={varianceReasonRequired ? 'VD: DAMAGED hoặc SHORTAGE' : 'Chỉ mở khi có loại/chốt thiếu'}
                              maxLength={64}
                            />
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                        <td>
                          {varianceAllowed ? (
                            <input
                              value={line.qualityNote}
                              onChange={(event) => updateEditorLine(index, { qualityNote: event.target.value })}
                              disabled={editor.loading || !varianceReasonRequired}
                              placeholder={varianceReasonRequired ? 'Ghi chú chênh lệch' : 'Chỉ mở khi có loại/chốt thiếu'}
                              maxLength={2000}
                            />
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                        <td>
                          <select
                            value={line.locationId}
                            onChange={(event) => updateEditorLine(index, { locationId: event.target.value })}
                            disabled={editor.loading}
                          >
                            <option value="">Không chọn</option>
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
              <div className={localStyles.totalCard}><span>Đơn đặt hàng</span><strong>{activePurchaseOrder?.number || 'Chưa cấp số'}</strong></div>
              <div className={localStyles.totalCard}><span>Nhà cung cấp</span><strong>{activePurchaseOrder?.supplierName || '---'}</strong></div>
              <div className={localStyles.totalCard}><span>Kho nhận</span><strong>{activePurchaseOrder?.warehouseName || '---'}</strong></div>
              <div className={localStyles.totalCard}><span>Số dòng</span><strong>{formatDecimalString(String(editor.lines.length))}</strong></div>
              <div className={localStyles.totalCard}><span>Chênh lệch</span><strong>{varianceAllowed ? 'Có' : 'Không'}</strong></div>
            </div>

            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)} disabled={editor.loading}>Hủy</button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void saveEditor()}
                disabled={editor.loading || !editor.purchaseOrder}
                data-testid="goods-receipt-save-button"
              >
                {busyId ? 'Đang lưu…' : editor.mode === 'create' ? 'Tạo phiếu' : 'Lưu phiếu'}
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
                <p className={styles.panelKicker}>Chi tiết phiếu nhận hàng</p>
                <h3 id="goods-receipt-detail-title">{selectedGoodsReceipt.documentNumber || 'Phiếu chưa cấp số'}</h3>
              </div>
              <div className={styles.toolbarActions}>
                <GoodsReceiptPrintDock receipt={selectedGoodsReceipt} />
                <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setSelectedGoodsReceipt(null)}>Đóng</button>
              </div>
            </div>
            <div className={localStyles.detailGrid}>
              <div className={localStyles.detailItem}><span>Trạng thái</span><strong>{GOODS_RECEIPT_STATUS_LABELS[selectedGoodsReceipt.status]}</strong></div>
              <div className={localStyles.detailItem}><span>Đơn đặt hàng</span><strong>{selectedGoodsReceipt.purchaseOrderNumber || 'Chưa cấp số'}</strong></div>
              <div className={localStyles.detailItem}><span>Kho nhận</span><strong>{selectedGoodsReceipt.warehouseCode} - {selectedGoodsReceipt.warehouseName}</strong></div>
              <div className={localStyles.detailItem}><span>Ngày nhận</span><strong>{formatGoodsReceiptDate(selectedGoodsReceipt.receiptDate)}</strong></div>
              <div className={localStyles.detailItem}><span>Tham chiếu giao hàng</span><strong>{selectedGoodsReceipt.supplierDeliveryReference || 'Không có'}</strong></div>
              <div className={localStyles.detailItem}><span>Trạng thái PO</span><strong>{PURCHASE_ORDER_STATUS_LABELS[selectedGoodsReceipt.purchaseOrderStatus as keyof typeof PURCHASE_ORDER_STATUS_LABELS]}</strong></div>
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
              {selectedGoodsReceipt.status === 'posted' && initialPermissionKeys.includes('core.goods-receipt.read') ? (
                <Link
                  href={`/purchasing/supplier-returns?goodsReceiptId=${selectedGoodsReceipt.id}`}
                  className={styles.secondaryButton}
                >
                  Tạo phiếu trả NCC
                </Link>
              ) : null}
              {selectedGoodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.update') ? (
                <button type="button" className={styles.secondaryButton} onClick={() => void openEdit(selectedGoodsReceipt)} disabled={Boolean(busyId)}>Sửa nháp</button>
              ) : null}
              {selectedGoodsReceipt.status === 'draft' && initialPermissionKeys.includes('core.goods-receipt.post') ? (
                <button type="button" className={styles.primaryButton} onClick={() => void openAction('post', selectedGoodsReceipt)} disabled={Boolean(busyId)}>Ghi sổ</button>
              ) : null}
              {selectedGoodsReceipt.status === 'posted' && initialPermissionKeys.includes('core.goods-receipt.reverse') ? (
                <button type="button" className={styles.primaryButton} onClick={() => void openAction('reverse', selectedGoodsReceipt)} disabled={Boolean(busyId)}>Đảo phiếu</button>
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
                <p className={styles.panelKicker}>Xác nhận nghiệp vụ</p>
                <h3 id="goods-receipt-action-title">{actionLabel(pendingAction.action)}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>Đóng</button>
            </div>
            <p className={localStyles.actionCopy}>{actionMessage(pendingAction.action, pendingAction.goodsReceipt)}</p>
            {pendingAction.action === 'reverse' ? (
              <div className={styles.form}>
                <label>Lý do đảo phiếu<input value={reverseReason} maxLength={1000} onChange={(event) => setReverseReason(event.target.value)} autoFocus /></label>
                <label>Ngày đảo phiếu<input type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} /></label>
              </div>
            ) : null}
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setPendingAction(null)} disabled={Boolean(busyId)}>Quay lại</button>
              <button type="button" className={styles.primaryButton} onClick={() => void runAction()} disabled={Boolean(busyId)} data-testid={`goods-receipt-${pendingAction.action}-confirm`}>
                {busyId ? 'Đang xử lý…' : actionLabel(pendingAction.action)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}