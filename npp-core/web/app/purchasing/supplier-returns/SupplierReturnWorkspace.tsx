'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from '../purchase-orders/purchase-orders.module.css';
import type { GoodsReceipt } from '../../../lib/goods-receipt-types';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import type {
  SupplierReturn,
  SupplierReturnDraftLine,
  SupplierReturnLine,
  SupplierReturnStatus,
} from '../../../lib/supplier-return-types';
import {
  formatSupplierReturnDate,
  supplierReturnActionPolicy,
  SUPPLIER_RETURN_STATUS_LABELS,
} from '../../../lib/supplier-return-types';
import {
  formatDecimalString,
} from '../../../lib/purchase-order-types';
import {
  approveSupplierReturn,
  cancelSupplierReturn,
  createSupplierReturnDraft,
  getSupplierReturn,
  listSupplierReturnSourceLines,
  patchSupplierReturnDraft,
  postSupplierReturn,
  reverseSupplierReturn,
  submitSupplierReturn,
} from '../../../lib/supplier-return-gateway';

type Props = {
  initialSupplierReturns: SupplierReturn[];
  initialGoodsReceipts: GoodsReceipt[];
  initialWarehouses: Warehouse[];
  initialLocations: WarehouseLocation[];
  initialPermissionKeys: string[];
  initialError: string | null;
  initialLookupError: string | null;
  initialSourceGoodsReceiptId: string | null;
};

type StatusFilter = SupplierReturnStatus | 'all';
type ActionName = 'submit' | 'approve' | 'cancel' | 'post' | 'reverse';
type ActionState = { action: ActionName; supplierReturn: SupplierReturn } | null;

type DraftLine = SupplierReturnDraftLine & {
  sourceGoodsReceiptLineNumber: number;
  sourceGoodsReceiptNumber: string;
  sourcePurchaseOrderNumber: string;
  sourceSku: string;
  sourceItemName: string;
  sourceUnitCode: string;
  sourceAcceptedQuantity: string;
  returnableQuantity: string;
  postedReturnQuantity: string;
  locationId: string | null;
  lotCode: string | null;
};

type EditorState = {
  mode: 'create' | 'edit';
  supplierReturn: SupplierReturn | null;
  goodsReceiptId: string;
  returnDate: string;
  note: string;
  lines: DraftLine[];
  loading: boolean;
} | null;

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type SourceLine = SupplierReturnLine;

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
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu phiếu trả nhà cung cấp');
  }
  return payload.data;
}

function normalizeDecimalInput(value: string): string {
  const trimmed = value.trim();
  return trimmed || '0';
}

function buildDraftLineFromSourceLine(line: SourceLine): DraftLine {
  return {
    sourceGoodsReceiptLineId: line.sourceGoodsReceiptLineId,
    returnQuantity: '',
    reasonCode: '',
    reasonNote: '',
    note: '',
    sourceGoodsReceiptLineNumber: line.sourceGoodsReceiptLineNumber,
    sourceGoodsReceiptNumber: line.sourceGoodsReceiptNumber,
    sourcePurchaseOrderNumber: line.sourcePurchaseOrderNumber,
    sourceSku: line.sourceSku,
    sourceItemName: line.sourceItemName,
    sourceUnitCode: line.sourceUnitCode,
    sourceAcceptedQuantity: line.sourceAcceptedQuantity,
    returnableQuantity: line.returnableQuantity ?? line.sourceAcceptedQuantity,
    postedReturnQuantity: line.postedReturnQuantity ?? '0',
    locationId: line.locationId,
    lotCode: line.lotCode,
  };
}

function buildDraftLineFromReturnLine(line: NonNullable<SupplierReturn['lines']>[number]): DraftLine {
  return {
    sourceGoodsReceiptLineId: line.sourceGoodsReceiptLineId,
    returnQuantity: line.returnQuantity,
    reasonCode: line.reasonCode,
    reasonNote: line.reasonNote,
    note: line.note ?? '',
    sourceGoodsReceiptLineNumber: line.sourceGoodsReceiptLineNumber,
    sourceGoodsReceiptNumber: line.sourceGoodsReceiptNumber,
    sourcePurchaseOrderNumber: line.sourcePurchaseOrderNumber,
    sourceSku: line.sourceSku,
    sourceItemName: line.sourceItemName,
    sourceUnitCode: line.sourceUnitCode,
    sourceAcceptedQuantity: line.sourceAcceptedQuantity,
    returnableQuantity: line.returnableQuantity ?? line.sourceAcceptedQuantity,
    postedReturnQuantity: line.postedReturnQuantity ?? '0',
    locationId: line.locationId,
    lotCode: line.lotCode,
  };
}

function actionLabel(action: ActionName) {
  if (action === 'submit') return 'Gửi duyệt';
  if (action === 'approve') return 'Duyệt phiếu';
  if (action === 'cancel') return 'Hủy phiếu';
  if (action === 'post') return 'Ghi sổ';
  return 'Đảo phiếu';
}

function actionMessage(action: ActionName, supplierReturn: SupplierReturn) {
  const identifier = supplierReturn.documentNumber || 'phiếu chưa cấp số';
  if (action === 'submit') return `Gửi ${identifier} sang trạng thái chờ duyệt?`;
  if (action === 'approve') return `Duyệt ${identifier} trước khi ghi sổ?`;
  if (action === 'cancel') return `Hủy ${identifier}?`;
  if (action === 'post') return `Ghi sổ ${identifier} và phát sinh xuất kho?`;
  return `Đảo ${identifier} bằng chứng từ bù?`;
}

function statusTone(status: SupplierReturnStatus): string {
  if (status === 'posted' || status === 'approved') return styles.toneSuccess;
  if (status === 'cancelled' || status === 'reversed') return styles.toneDanger;
  return '';
}

export default function SupplierReturnWorkspace({
  initialSupplierReturns,
  initialGoodsReceipts,
  initialWarehouses,
  initialLocations,
  initialPermissionKeys,
  initialError,
  initialLookupError,
  initialSourceGoodsReceiptId,
}: Props) {
  const [items, setItems] = useState<SupplierReturn[]>(initialSupplierReturns);
  const [error, setError] = useState<string | null>(initialError || initialLookupError);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedSupplierReturn, setSelectedSupplierReturn] = useState<SupplierReturn | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingAction, setPendingAction] = useState<ActionState>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [postReason, setPostReason] = useState('');
  const [postDate, setPostDate] = useState(todayLocal());
  const [reverseReason, setReverseReason] = useState('');
  const [reverseDate, setReverseDate] = useState(todayLocal());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [sourceLines, setSourceLines] = useState<SourceLine[]>([]);
  const [sourceReceiptId, setSourceReceiptId] = useState('');
  const [sourceLinesLoading, setSourceLinesLoading] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const actionKeys = useRef(new Map<string, string>());
  const initialPrefillHandled = useRef(false);

  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleItems = useMemo(() => items.filter((supplierReturn) => {
    const matchesStatus = statusFilter === 'all' || supplierReturn.status === statusFilter;
    const searchable = [
      supplierReturn.documentNumber,
      supplierReturn.supplierCode,
      supplierReturn.supplierName,
      supplierReturn.warehouseCode,
      supplierReturn.warehouseName,
      ...(supplierReturn.lines ?? []).flatMap((line) => [line.sourceSku, line.sourceItemName, line.sourceGoodsReceiptNumber, line.reasonCode]),
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
    posted: items.filter((item) => item.status === 'posted').length,
  }), [items]);

  const lookupReady = initialGoodsReceipts.length > 0 && initialWarehouses.length > 0;

  useEffect(() => {
    if (selectedSupplierReturn || pendingAction || editor) closeButtonRef.current?.focus();
  }, [editor, pendingAction, selectedSupplierReturn]);

  useEffect(() => {
    if (initialPrefillHandled.current) return;
    if (!initialSourceGoodsReceiptId || !lookupReady || initialPermissionKeys.length === 0) return;
    if (selectedSupplierReturn || pendingAction || editor) return;
    initialPrefillHandled.current = true;
    void openCreate(initialSourceGoodsReceiptId);
  }, [editor, initialPermissionKeys.length, initialSourceGoodsReceiptId, lookupReady, pendingAction, selectedSupplierReturn]);

  function upsertItem(supplierReturn: SupplierReturn) {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === supplierReturn.id);
      if (index < 0) return [supplierReturn, ...current];
      return current.map((item) => (item.id === supplierReturn.id ? supplierReturn : item));
    });
  }

  async function loadAll(successMessage?: string) {
    setLoadingList(true);
    setError(null);
    try {
      const returns = await requestJson<SupplierReturn[]>('/api/supplier-returns?limit=1000');
      setItems(returns);
      if (successMessage) setNotice(successMessage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh sách phiếu trả nhà cung cấp');
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(item: SupplierReturn): Promise<SupplierReturn | null> {
    setBusyId(item.id);
    setError(null);
    try {
      return await requestJson<SupplierReturn>(`/api/supplier-returns/${item.id}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết phiếu trả');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function loadSourceLines(receiptId: string) {
    if (!receiptId) return;
    setSourceLinesLoading(true);
    setError(null);
    try {
      const lines = await requestJson<SourceLine[]>(`/api/supplier-returns/source-lines?goodsReceiptId=${encodeURIComponent(receiptId)}`);
      setSourceLines(lines);
      setSourceReceiptId(receiptId);
      setEditor((current) => current ? {
        ...current,
        goodsReceiptId: receiptId,
        lines: lines.map(buildDraftLineFromSourceLine),
        loading: false,
      } : current);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dòng nguồn');
      setSourceLines([]);
      setEditor((current) => current ? { ...current, loading: false } : current);
    } finally {
      setSourceLinesLoading(false);
    }
  }

  async function openView(supplierReturn: SupplierReturn) {
    const detail = await loadDetail(supplierReturn);
    if (detail) setSelectedSupplierReturn(detail);
  }

  async function openCreate(receiptId?: string) {
    setError(null);
    setNotice(null);
    const firstReceipt = initialGoodsReceipts[0];
    if (!lookupReady || !firstReceipt) {
      setError('Chưa có phiếu nhận hàng đã ghi sổ để tạo phiếu trả.');
      return;
    }
    let targetReceipt = firstReceipt;
    if (receiptId) {
      const matchedReceipt = initialGoodsReceipts.find((receipt) => receipt.id === receiptId);
      if (!matchedReceipt) {
        setError('Không tìm thấy phiếu nhận hàng nguồn được yêu cầu trong phạm vi truy cập.');
        return;
      }
      targetReceipt = matchedReceipt;
    }
    setEditor({
      mode: 'create',
      supplierReturn: null,
      goodsReceiptId: targetReceipt.id,
      returnDate: todayLocal(),
      note: '',
      lines: [],
      loading: true,
    });
    await loadSourceLines(targetReceipt.id);
  }

  async function openEdit(supplierReturn: SupplierReturn) {
    const detail = await loadDetail(supplierReturn);
    if (!detail) return;
    setEditor({
      mode: 'edit',
      supplierReturn: detail,
      goodsReceiptId: detail.lines?.[0]?.sourceGoodsReceiptId ?? '',
      returnDate: detail.returnDate,
      note: detail.note ?? '',
      lines: (detail.lines ?? []).map(buildDraftLineFromReturnLine),
      loading: false,
    });
  }

  function openAction(action: ActionName, supplierReturn: SupplierReturn) {
    setError(null);
    setNotice(null);
    setCancellationReason('');
    setPostReason('');
    setPostDate(todayLocal());
    setReverseReason('');
    setReverseDate(todayLocal());
    setPendingAction({ action, supplierReturn });
  }

  function updateEditorLine(index: number, patch: Partial<DraftLine>) {
    setEditor((current) => {
      if (!current) return current;
      const nextLines = current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line));
      return { ...current, lines: nextLines };
    });
  }

  function actionKey(action: ActionName, supplierReturn: SupplierReturn) {
    const identity = `${action}:${supplierReturn.id}:${supplierReturn.revision}`;
    const existing = actionKeys.current.get(identity);
    if (existing) return existing;
    const key = `sr-${action}-${crypto.randomUUID()}`;
    actionKeys.current.set(identity, key);
    return key;
  }

  async function saveEditor() {
    if (!editor) return;
    const header = initialGoodsReceipts.find((receipt) => receipt.id === editor.goodsReceiptId);
    if (!header) {
      setError('Vui lòng chọn phiếu nhận hàng nguồn hợp lệ.');
      return;
    }
    const sourceLinesResult = sourceLines.length > 0 ? sourceLines : null;
    if (!sourceLinesResult) {
      setError('Chưa có dòng nguồn để tạo phiếu trả.');
      return;
    }
    const supplierId = sourceLinesResult[0]?.sourceSupplierId ?? '';
    const warehouseId = sourceLinesResult[0]?.sourceWarehouseId ?? '';
    const selectedLines = editor.lines.filter((line) => {
      const quantity = Number(normalizeDecimalInput(line.returnQuantity));
      return Number.isFinite(quantity) && quantity > 0;
    });
    if (selectedLines.length === 0) {
      setError('Vui lòng nhập số lượng trả hợp lệ cho ít nhất một dòng.');
      return;
    }
    for (const line of selectedLines) {
      if (!line.sourceGoodsReceiptLineId) {
        setError('Vui lòng chọn đúng dòng phiếu nhận hàng cho từng mặt hàng.');
        return;
      }
      const quantity = Number(normalizeDecimalInput(line.returnQuantity));
      const returnable = Number(line.returnableQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(returnable) || quantity > returnable) {
        setError('Số lượng trả phải lớn hơn 0 và không vượt quá số lượng còn có thể trả.');
        return;
      }
      if (!line.reasonCode.trim() || !line.reasonNote.trim()) {
        setError('Mỗi dòng được chọn phải có mã lý do và ghi chú lý do.');
        return;
      }
    }
    setBusyId(editor.mode === 'edit' && editor.supplierReturn ? editor.supplierReturn.id : header.id);
    setError(null);
    try {
      const payload = {
        supplierId,
        warehouseId,
        returnDate: editor.returnDate,
        note: editor.note,
        lines: selectedLines.map((line) => ({
          sourceGoodsReceiptLineId: line.sourceGoodsReceiptLineId,
          returnQuantity: normalizeDecimalInput(line.returnQuantity),
          reasonCode: line.reasonCode.trim(),
          reasonNote: line.reasonNote.trim(),
          note: line.note?.trim() || '',
        })),
        ...(editor.mode === 'edit' && editor.supplierReturn ? { expectedRevision: editor.supplierReturn.revision } : {}),
      };
      const saved = editor.mode === 'edit' && editor.supplierReturn
        ? await requestJson<SupplierReturn>(
          `/api/supplier-returns/${editor.supplierReturn.id}`,
          {
            method: 'PATCH',
            headers: { 'Idempotency-Key': `sr-edit-${crypto.randomUUID()}` },
            body: JSON.stringify(payload),
          },
        )
        : await requestJson<SupplierReturn>(
          '/api/supplier-returns',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': `sr-create-${crypto.randomUUID()}` },
            body: JSON.stringify(payload),
          },
        );
      upsertItem(saved);
      setEditor(null);
      setNotice(editor.mode === 'create' ? 'Đã tạo phiếu trả nhà cung cấp nháp.' : 'Đã cập nhật phiếu trả nhà cung cấp nháp.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được phiếu trả nhà cung cấp');
    } finally {
      setBusyId(null);
    }
  }

  async function runAction() {
    if (!pendingAction) return;
    const { action, supplierReturn } = pendingAction;
    if (action === 'cancel' && !cancellationReason.trim()) {
      setError('Vui lòng nhập lý do hủy phiếu.');
      return;
    }
    if (action === 'reverse' && !reverseReason.trim()) {
      setError('Vui lòng nhập lý do đảo phiếu.');
      return;
    }
    setBusyId(supplierReturn.id);
    setError(null);
    try {
      const updated = await requestJson<SupplierReturn>(
        action === 'submit'
          ? `/api/supplier-returns/${supplierReturn.id}/submit`
          : action === 'approve'
            ? `/api/supplier-returns/${supplierReturn.id}/approve`
            : action === 'cancel'
              ? `/api/supplier-returns/${supplierReturn.id}/cancel`
              : action === 'post'
                ? `/api/supplier-returns/${supplierReturn.id}/post`
                : `/api/supplier-returns/${supplierReturn.id}/reverse`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': actionKey(action, supplierReturn) },
          body: JSON.stringify({
            expectedRevision: supplierReturn.revision,
            ...(action === 'cancel' ? { reason: cancellationReason.trim() } : {}),
            ...(action === 'post' ? { reasonNote: postReason.trim(), documentDate: postDate } : {}),
            ...(action === 'reverse' ? {
              reasonNote: reverseReason.trim(),
              documentDate: reverseDate,
            } : {}),
          }),
        },
      );
      actionKeys.current.delete(`${action}:${supplierReturn.id}:${supplierReturn.revision}`);
      upsertItem(updated);
      if (selectedSupplierReturn?.id === updated.id) setSelectedSupplierReturn(updated);
      setPendingAction(null);
      setCancellationReason('');
      setPostReason('');
      setReverseReason('');
      setNotice(
        action === 'submit'
          ? 'Phiếu trả nhà cung cấp đã được gửi duyệt.'
          : action === 'approve'
            ? 'Phiếu trả nhà cung cấp đã được duyệt.'
            : action === 'cancel'
              ? 'Phiếu trả nhà cung cấp đã được hủy.'
              : action === 'post'
                ? 'Phiếu trả nhà cung cấp đã được ghi sổ.'
                : 'Phiếu trả nhà cung cấp đã được đảo.',
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Không thực hiện được thao tác phiếu trả');
    } finally {
      setBusyId(null);
    }
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={() => void loadAll('Danh sách phiếu trả nhà cung cấp đã được cập nhật.')}
        disabled={loadingList}
      >
        {loadingList ? 'Đang cập nhật…' : 'Cập nhật dữ liệu'}
      </button>
      {supplierReturnActionPolicy('draft', initialPermissionKeys).create ? (
        <button
          type="button"
          className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
          onClick={() => void openCreate()}
          data-testid="supplier-return-create-button"
        >
          Tạo phiếu trả
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      title="Phiếu trả nhà cung cấp"
      subtitle="Trả hàng đã nhận về đúng nhà cung cấp, ghi sổ xuất kho và đảo phiếu khi cần."
      kicker="Mua hàng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="supplier-returns-page">
        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
        {notice ? <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">{notice}</div> : null}
        {initialPermissionKeys.length === 0 ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            Chưa nhận được quyền phiếu trả nhà cung cấp từ backend. Các thao tác thay đổi dữ liệu đang bị khóa.
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Số liệu phiếu trả nhà cung cấp">
          <article className={styles.summaryCard}>
            <span>Tổng phiếu</span><strong>{formatDecimalString(String(counts.total))}</strong><small>Trong phạm vi kho được cấp</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Nháp</span><strong>{formatDecimalString(String(counts.draft))}</strong><small>Còn có thể chỉnh sửa</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Chờ duyệt</span><strong>{formatDecimalString(String(counts.pending))}</strong><small>Đang khóa nội dung</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Bộ lọc phiếu trả nhà cung cấp">
          <div className={styles.toolbarSearch}>
            <label htmlFor="supplier-return-search">Tìm kiếm</label>
            <input
              id="supplier-return-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Số phiếu, nhà cung cấp, kho, mã lý do, số phiếu nhận…"
              data-testid="supplier-return-search"
            />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="supplier-return-status">Trạng thái</label>
            <select
              id="supplier-return-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              data-testid="supplier-return-status-filter"
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(SUPPLIER_RETURN_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Danh sách phiếu</p>
              <h2>Trả hàng về nhà cung cấp</h2>
            </div>
            <span className={styles.panelChip}>{formatDecimalString(String(visibleItems.length))} phiếu</span>
          </div>
          <div className={localStyles.linesWrap}>
            <table className={localStyles.linesTable} data-testid="supplier-returns-table">
              <thead>
                <tr>
                  <BusinessTableSequenceHeader />
                  <th>Số phiếu</th>
                  <th>Nhà cung cấp</th>
                  <th>Kho</th>
                  <th>Ngày trả</th>
                  <th>Trạng thái</th>
                  <th>Số dòng</th>
                  <th>Tổng SL</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((supplierReturn, rowIndex) => {
                  const policy = supplierReturnActionPolicy(supplierReturn.status, initialPermissionKeys);
                  const disabled = busyId === supplierReturn.id;
                  return (
                    <tr key={supplierReturn.id} data-testid={`supplier-return-row-${supplierReturn.id}`}>
                      <BusinessTableSequenceCell rowIndex={rowIndex} />
                      <td>
                        <div className={localStyles.lineIdentity}>
                          <strong>{supplierReturn.documentNumber || 'Chưa cấp số'}</strong>
                          <span>{supplierReturn.note || 'Không có ghi chú'}</span>
                        </div>
                      </td>
                      <td>{supplierReturn.supplierCode} - {supplierReturn.supplierName}</td>
                      <td>{supplierReturn.warehouseCode} - {supplierReturn.warehouseName}</td>
                      <td>{formatSupplierReturnDate(supplierReturn.returnDate)}</td>
                      <td><span className={`${styles.statusPill} ${statusTone(supplierReturn.status)}`}>{SUPPLIER_RETURN_STATUS_LABELS[supplierReturn.status]}</span></td>
                      <td>{formatDecimalString(String(supplierReturn.lineCount))}</td>
                      <td>{formatDecimalString(supplierReturn.returnQuantityTotal)}</td>
                      <td>
                        <div className={styles.toolbarActions}>
                          <button type="button" className={styles.secondaryButton} onClick={() => void openView(supplierReturn)} disabled={disabled}>Xem</button>
                          {policy.edit ? <button type="button" className={styles.secondaryButton} onClick={() => void openEdit(supplierReturn)} disabled={disabled}>Sửa</button> : null}
                          {policy.submit ? <button type="button" className={styles.primaryButton} onClick={() => openAction('submit', supplierReturn)} disabled={disabled}>Gửi duyệt</button> : null}
                          {policy.approve ? <button type="button" className={styles.primaryButton} onClick={() => openAction('approve', supplierReturn)} disabled={disabled}>Duyệt</button> : null}
                          {policy.cancel ? <button type="button" className={styles.secondaryButton} onClick={() => openAction('cancel', supplierReturn)} disabled={disabled}>Hủy</button> : null}
                          {policy.post ? <button type="button" className={styles.primaryButton} onClick={() => openAction('post', supplierReturn)} disabled={disabled}>Ghi sổ</button> : null}
                          {policy.reverse ? <button type="button" className={styles.primaryButton} onClick={() => openAction('reverse', supplierReturn)} disabled={disabled}>Đảo phiếu</button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {selectedSupplierReturn ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedSupplierReturn(null); }}
        >
          <section className={`${styles.modal} ${localStyles.detailModal}`} role="dialog" aria-modal="true" aria-labelledby="supplier-return-detail-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>Chi tiết phiếu trả</p>
                <h3 id="supplier-return-detail-title">{selectedSupplierReturn.documentNumber || 'Phiếu trả chưa cấp số'}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setSelectedSupplierReturn(null)}>Đóng</button>
            </div>

            <div className={localStyles.detailGrid}>
              <div className={localStyles.detailItem}><span>Nhà cung cấp</span><strong>{selectedSupplierReturn.supplierCode} - {selectedSupplierReturn.supplierName}</strong></div>
              <div className={localStyles.detailItem}><span>Kho</span><strong>{selectedSupplierReturn.warehouseCode} - {selectedSupplierReturn.warehouseName}</strong></div>
              <div className={localStyles.detailItem}><span>Ngày trả</span><strong>{formatSupplierReturnDate(selectedSupplierReturn.returnDate)}</strong></div>
              <div className={localStyles.detailItem}><span>Trạng thái</span><strong>{SUPPLIER_RETURN_STATUS_LABELS[selectedSupplierReturn.status]}</strong></div>
              <div className={localStyles.detailItem}><span>Tổng số lượng</span><strong>{formatDecimalString(selectedSupplierReturn.returnQuantityTotal)}</strong></div>
              <div className={localStyles.detailItem}><span>Ghi sổ kho</span><strong>{selectedSupplierReturn.inventoryMovementId || 'Chưa có'}</strong></div>
            </div>

            <div className={localStyles.linesWrap} style={{ marginTop: 12 }}>
              <table className={localStyles.linesTable}>
                <thead>
                  <tr>
                    <th>Dòng nguồn</th>
                    <th>Hàng trả</th>
                    <th>Lý do</th>
                    <th>SL trả</th>
                    <th>SL còn lại</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedSupplierReturn.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td>
                        <div className={localStyles.lineIdentity}>
                          <strong>{line.sourceGoodsReceiptNumber}</strong>
                          <span>{line.sourceSku} · {line.sourceItemName}</span>
                        </div>
                      </td>
                      <td>{line.sourceGoodsReceiptLineNumber}</td>
                      <td>
                        <div className={localStyles.lineIdentity}>
                          <strong>{line.reasonCode}</strong>
                          <span>{line.reasonNote}</span>
                        </div>
                      </td>
                      <td>{formatDecimalString(line.returnQuantity)}</td>
                      <td>{formatDecimalString(line.returnableQuantity ?? '0')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={localStyles.modalActions}>
              {selectedSupplierReturn.inventoryMovementId ? (
                <Link href="/inventory/balances" className={styles.secondaryButton}>Mở sổ kho</Link>
              ) : null}
              <button type="button" className={styles.secondaryButton} onClick={() => setSelectedSupplierReturn(null)}>Đóng</button>
            </div>
          </section>
        </div>
      ) : null}

      {editor ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.currentTarget === event.target && !editor.loading) setEditor(null); }}
        >
          <section className={`${styles.modal} ${localStyles.wideModal}`} role="dialog" aria-modal="true" aria-labelledby="supplier-return-editor-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>{editor.mode === 'create' ? 'Tạo phiếu trả nhà cung cấp' : 'Sửa phiếu trả nhà cung cấp nháp'}</p>
                <h3 id="supplier-return-editor-title">{editor.supplierReturn?.documentNumber || 'Phiếu trả nháp'}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setEditor(null)} disabled={editor.loading}>Đóng</button>
            </div>

            {editor.mode === 'create' ? (
              <div className={localStyles.lookupRow}>
                <div className={styles.form}>
                  <label>Phiếu nhận hàng nguồn</label>
                  <select value={sourceReceiptId} onChange={(event) => void loadSourceLines(event.target.value)} disabled={editor.loading || sourceLinesLoading}>
                    {initialGoodsReceipts.map((receipt) => (
                      <option key={receipt.id} value={receipt.id}>
                        {receipt.documentNumber || 'Chưa cấp số'} - {receipt.supplierName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.form}>
                  <label>Nhà cung cấp / kho</label>
                  <input readOnly value={sourceLines[0] ? `${sourceLines[0].sourceSupplierCode} - ${sourceLines[0].sourceSupplierName} / ${sourceLines[0].sourceWarehouseCode} - ${sourceLines[0].sourceWarehouseName}` : 'Đang tải…'} />
                </div>
                <div className={styles.form}>
                  <label>Ngày trả</label>
                  <input type="date" value={editor.returnDate} onChange={(event) => setEditor((current) => current ? { ...current, returnDate: event.target.value } : current)} disabled={editor.loading} />
                </div>
              </div>
            ) : (
              <div className={localStyles.detailGrid}>
                <div className={localStyles.detailItem}><span>Nhà cung cấp</span><strong>{editor.supplierReturn?.supplierCode} - {editor.supplierReturn?.supplierName}</strong></div>
                <div className={localStyles.detailItem}><span>Kho</span><strong>{editor.supplierReturn?.warehouseCode} - {editor.supplierReturn?.warehouseName}</strong></div>
                <div className={localStyles.detailItem}><span>Ngày trả</span><strong>{formatSupplierReturnDate(editor.returnDate)}</strong></div>
              </div>
            )}

            <div className={styles.form} style={{ marginTop: 12 }}>
              <label>Ghi chú</label>
              <input value={editor.note} onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)} disabled={editor.loading} />
            </div>

            <div className={localStyles.linesWrap} style={{ marginTop: 12 }}>
              <table className={localStyles.linesTable}>
                <thead>
                  <tr>
                    <th>Phiếu nhận hàng</th>
                    <th>Mặt hàng</th>
                    <th>SL đã nhận</th>
                    <th>SL còn trả</th>
                    <th>SL trả</th>
                    <th>Mã lý do</th>
                    <th>Ghi chú lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {editor.lines.map((line, index) => (
                    <tr key={`${line.sourceGoodsReceiptLineId}-${line.sourceGoodsReceiptLineNumber}`}>
                      <td>
                        <div className={localStyles.lineIdentity}>
                          <strong>{line.sourceGoodsReceiptNumber}</strong>
                          <span>Dòng {line.sourceGoodsReceiptLineNumber}</span>
                        </div>
                      </td>
                      <td>
                        <div className={localStyles.lineIdentity}>
                          <strong>{line.sourceSku}</strong>
                          <span>{line.sourceItemName}</span>
                        </div>
                      </td>
                      <td>{formatDecimalString(line.sourceAcceptedQuantity)}</td>
                      <td>{formatDecimalString(line.returnableQuantity)}</td>
                      <td>
                        <input
                          value={line.returnQuantity}
                          onChange={(event) => updateEditorLine(index, { returnQuantity: event.target.value })}
                          inputMode="decimal"
                          disabled={editor.loading}
                        />
                      </td>
                      <td>
                        <input
                          value={line.reasonCode}
                          onChange={(event) => updateEditorLine(index, { reasonCode: event.target.value.toUpperCase() })}
                          disabled={editor.loading}
                          placeholder="DAMAGED / OTHER"
                        />
                      </td>
                      <td>
                        <input
                          value={line.reasonNote}
                          onChange={(event) => updateEditorLine(index, { reasonNote: event.target.value })}
                          disabled={editor.loading}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setEditor(null)} disabled={editor.loading}>Đóng</button>
              <button type="button" className={styles.primaryButton} onClick={() => void saveEditor()} disabled={editor.loading} data-testid="supplier-return-save">
                {editor.mode === 'create' ? 'Lưu nháp' : 'Cập nhật'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPendingAction(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="supplier-return-action-title">
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>{actionLabel(pendingAction.action)}</p>
                <h3 id="supplier-return-action-title">{pendingAction.supplierReturn.documentNumber || 'Phiếu chưa cấp số'}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={() => setPendingAction(null)}>Đóng</button>
            </div>
            <p className={localStyles.actionCopy}>{actionMessage(pendingAction.action, pendingAction.supplierReturn)}</p>
            {pendingAction.action === 'cancel' ? (
              <div className={styles.form}>
                <label>Lý do hủy</label>
                <input value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} />
              </div>
            ) : null}
            {pendingAction.action === 'post' ? (
              <div className={localStyles.headerGrid}>
                <div className={styles.form}>
                  <label>Ngày ghi sổ</label>
                  <input type="date" value={postDate} onChange={(event) => setPostDate(event.target.value)} />
                </div>
                <div className={`${styles.form} ${localStyles.spanTwo}`}>
                  <label>Ghi chú ghi sổ</label>
                  <input value={postReason} onChange={(event) => setPostReason(event.target.value)} />
                </div>
              </div>
            ) : null}
            {pendingAction.action === 'reverse' ? (
              <div className={localStyles.headerGrid}>
                <div className={styles.form}>
                  <label>Ngày đảo</label>
                  <input type="date" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} />
                </div>
                <div className={`${styles.form} ${localStyles.spanTwo}`}>
                  <label>Lý do đảo</label>
                  <input data-testid="supplier-return-reverse-reason" value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} />
                </div>
              </div>
            ) : null}
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setPendingAction(null)}>Đóng</button>
              <button type="button" className={styles.primaryButton} onClick={() => void runAction()} data-testid={`supplier-return-${pendingAction.action}-confirm`}>
                {actionLabel(pendingAction.action)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
