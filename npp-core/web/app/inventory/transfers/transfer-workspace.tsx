'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
} from '../../../lib/inventory-types';
import type { WarehouseLocation } from '../../../lib/organization-types';
import styles from './transfer-workspace.module.css';
import TransferPrintDock from './TransferPrintDock';

export type InventoryTransferLine = {
  id: string;
  lineNumber: number;
  sourceLocationId: string | null;
  sourceVariantId: string;
  sourceSku: string;
  itemName: string;
  sourceUnitId: string;
  sourceUnitCode: string;
  sourceQuantity: string;
  conversionToBase: string;
  baseVariantId: string;
  baseSku: string;
  baseQuantity: string;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  note: string | null;
};

export type InventoryTransfer = {
  id: string;
  documentNumber: string | null;
  transferDate: string;
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  destinationWarehouseId: string;
  destinationWarehouseCode: string;
  destinationWarehouseName: string;
  status: 'draft' | 'approved' | 'dispatched' | 'cancelled';
  note: string | null;
  revision: string;
  inventoryMovementId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  dispatchedAt: string | null;
  dispatchedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  lineCount: number;
  baseQuantityTotal: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  lines?: InventoryTransferLine[];
};

export type InventoryTransferInTransit = {
  transferId: string;
  documentNumber: string;
  transferDate: string;
  dispatchedAt: string;
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  destinationWarehouseId: string;
  destinationWarehouseCode: string;
  destinationWarehouseName: string;
  transferLineId: string;
  lineNumber: number;
  sourceVariantId: string;
  sourceSku: string;
  itemName: string;
  sourceUnitCode: string;
  sourceQuantity: string;
  dispatchedSourceQuantity?: string;
  baseVariantId: string;
  baseSku: string;
  baseQuantity: string;
  dispatchedBaseQuantity?: string;
  acceptedBaseQuantity?: string;
  damagedBaseQuantity?: string;
  shortBaseQuantity?: string;
  overBaseQuantity?: string;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  inventoryMovementId: string;
};

type ReceiptLine = {
  id: string;
  transferLineId: string;
  lineNumber: number;
  destinationLocationId: string | null;
  destinationLocationCode: string | null;
  destinationLocationName: string | null;
  sourceSku: string;
  itemName: string;
  sourceUnitCode: string;
  baseSku: string;
  lotCode: string | null;
  expiryDate: string | null;
  acceptedQuantity: string;
  damagedQuantity: string;
  overQuantity: string;
  acceptedBaseQuantity: string;
  damagedBaseQuantity: string;
  overBaseQuantity: string;
  note: string | null;
};

type TransferReceipt = {
  id: string;
  transferId: string;
  receiptSequence: number;
  receiptDate: string;
  inventoryMovementId: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
  damageApproval: {
    id: string;
    note: string | null;
    approvedAt: string;
    approvedBy: string;
  } | null;
  reversal: {
    id: string;
    inventoryMovementId: string | null;
    reason: string;
    reversedAt: string;
    reversedBy: string;
  } | null;
  lines: ReceiptLine[];
};

type ResolutionLine = {
  transferLineId: string;
  lineNumber: number;
  sourceSku: string;
  itemName: string;
  sourceUnitCode: string;
  lotCode: string | null;
  expiryDate: string | null;
  dispatchedQuantity: string;
  acceptedQuantity: string;
  damagedQuantity: string;
  overQuantity: string;
  shortQuantity: string;
  remainingQuantity: string;
  dispatchedBaseQuantity: string;
  acceptedBaseQuantity: string;
  damagedBaseQuantity: string;
  overBaseQuantity: string;
  shortBaseQuantity: string;
  remainingBaseQuantity: string;
};

type ReceiptBundle = {
  transfer: InventoryTransfer;
  receipts: TransferReceipt[];
  resolution: ResolutionLine[];
  shortClosure: {
    id: string;
    reason: string;
    closedAt: string;
    closedBy: string;
  } | null;
};

type Props = {
  initialTransfers: InventoryTransfer[];
  initialInTransit: InventoryTransferInTransit[];
  balances: InventoryBalance[];
  locations: WarehouseLocation[];
  initialError?: string | null;
};

type RequestEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

type DraftLine = {
  balanceKey: string;
  quantity: string;
};

type ReceiptDraftLine = {
  transferLineId: string;
  destinationLocationId: string;
  acceptedQuantity: string;
  damagedQuantity: string;
  overQuantity: string;
  note: string;
};

type Notice = { kind: 'success' | 'error'; message: string } | null;

const STATUS_LABEL: Record<InventoryTransfer['status'], string> = {
  draft: 'Nháp',
  approved: 'Đã duyệt',
  dispatched: 'Đang đi đường',
  cancelled: 'Đã hủy',
};

function keyOfBalance(balance: InventoryBalance): string {
  return [balance.warehouse_id, balance.location_id ?? '-', balance.base_variant_id, balance.lot_id ?? '-'].join('|');
}

function isPositiveDecimal(value: string): boolean {
  const normalized = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return false;
  return BigInt(match[1]) > 0n || /[1-9]/.test(match[2] ?? '');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
  const payload = (await response.json().catch(() => ({}))) as RequestEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thể xử lý phiếu chuyển kho.');
  }
  return payload.data;
}

function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export default function TransferWorkspace({
  initialTransfers,
  initialInTransit,
  balances,
  locations,
  initialError = null,
}: Props) {
  const [transfers, setTransfers] = useState(initialTransfers);
  const [inTransit, setInTransit] = useState(initialInTransit);
  const [selected, setSelected] = useState<InventoryTransfer | null>(null);
  const [receiptBundle, setReceiptBundle] = useState<ReceiptBundle | null>(null);
  const [mode, setMode] = useState<'transfers' | 'in-transit'>('transfers');
  const [showCreate, setShowCreate] = useState(false);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | InventoryTransfer['status']>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(initialError ? { kind: 'error', message: initialError } : null);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [transferDate, setTransferDate] = useState(today());
  const [note, setNote] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([{ balanceKey: '', quantity: '' }]);
  const [cancelReason, setCancelReason] = useState('');
  const [receiptDate, setReceiptDate] = useState(today());
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptLines, setReceiptLines] = useState<ReceiptDraftLine[]>([]);
  const [shortReason, setShortReason] = useState('');
  const [damageNotes, setDamageNotes] = useState<Record<string, string>>({});
  const [reverseReasons, setReverseReasons] = useState<Record<string, string>>({});

  const warehouseOptions = useMemo(() => {
    const values = new Map<string, { id: string; code: string; name: string }>();
    for (const balance of balances) {
      values.set(balance.warehouse_id, {
        id: balance.warehouse_id,
        code: balance.warehouse_code,
        name: balance.warehouse_name,
      });
    }
    for (const transfer of transfers) {
      values.set(transfer.sourceWarehouseId, {
        id: transfer.sourceWarehouseId,
        code: transfer.sourceWarehouseCode,
        name: transfer.sourceWarehouseName,
      });
      values.set(transfer.destinationWarehouseId, {
        id: transfer.destinationWarehouseId,
        code: transfer.destinationWarehouseCode,
        name: transfer.destinationWarehouseName,
      });
    }
    return [...values.values()].sort((left, right) => left.code.localeCompare(right.code));
  }, [balances, transfers]);

  const balanceByKey = useMemo(() => new Map(balances.map((balance) => [keyOfBalance(balance), balance])), [balances]);
  const sourceBalances = useMemo(
    () => balances.filter((balance) => balance.warehouse_id === sourceWarehouseId && isPositiveDecimal(balance.available_quantity)),
    [balances, sourceWarehouseId],
  );
  const destinationLocations = useMemo(
    () => locations.filter((location) => location.is_active && location.warehouse_id === selected?.destinationWarehouseId),
    [locations, selected?.destinationWarehouseId],
  );
  const transitTransferIds = useMemo(() => new Set(inTransit.map((line) => line.transferId)), [inTransit]);

  const filteredTransfers = useMemo(() => {
    const term = normalizeSearch(search);
    return transfers.filter((transfer) => {
      if (status !== 'all' && transfer.status !== status) return false;
      return !term || matchTerm(
        transfer.documentNumber,
        transfer.sourceWarehouseCode,
        transfer.sourceWarehouseName,
        transfer.destinationWarehouseCode,
        transfer.destinationWarehouseName,
        transfer.status,
        transfer.note,
      ).includes(term);
    });
  }, [search, status, transfers]);

  const filteredInTransit = useMemo(() => {
    const term = normalizeSearch(search);
    return inTransit.filter((line) => !term || matchTerm(
      line.documentNumber,
      line.sourceWarehouseCode,
      line.sourceWarehouseName,
      line.destinationWarehouseCode,
      line.destinationWarehouseName,
      line.sourceSku,
      line.itemName,
      line.lotCode,
    ).includes(term));
  }, [inTransit, search]);

  const counts = useMemo(() => ({
    draft: transfers.filter((item) => item.status === 'draft').length,
    approved: transfers.filter((item) => item.status === 'approved').length,
    dispatched: transfers.filter((item) => item.status === 'dispatched').length,
    inTransitLines: inTransit.length,
  }), [inTransit.length, transfers]);

  function statusLabel(transfer: InventoryTransfer): string {
    if (transfer.status === 'dispatched' && !transitTransferIds.has(transfer.id)) return 'Đã xử lý nhận';
    return STATUS_LABEL[transfer.status];
  }

  async function loadReceiptBundle(transferId: string): Promise<ReceiptBundle> {
    const bundle = await requestJson<ReceiptBundle>(`/api/inventory/transfers/${transferId}/receipts`);
    setReceiptBundle(bundle);
    return bundle;
  }

  async function refresh(selectId?: string) {
    const [nextTransfers, nextInTransit] = await Promise.all([
      requestJson<InventoryTransfer[]>('/api/inventory/transfers?limit=500'),
      requestJson<InventoryTransferInTransit[]>('/api/inventory/transfers/in-transit?limit=1000'),
    ]);
    setTransfers(nextTransfers);
    setInTransit(nextInTransit);
    if (selectId) {
      const detail = await requestJson<InventoryTransfer>(`/api/inventory/transfers/${selectId}`);
      setSelected(detail);
      if (detail.status === 'dispatched') await loadReceiptBundle(detail.id);
      else setReceiptBundle(null);
    }
  }

  async function openDetail(id: string) {
    setBusy(`detail-${id}`);
    setNotice(null);
    try {
      const detail = await requestJson<InventoryTransfer>(`/api/inventory/transfers/${id}`);
      setSelected(detail);
      setShowCreate(false);
      setShowReceiptForm(false);
      if (detail.status === 'dispatched') await loadReceiptBundle(id);
      else setReceiptBundle(null);
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không tải được chi tiết phiếu.' });
    } finally {
      setBusy(null);
    }
  }

  function resetDraft() {
    setSourceWarehouseId('');
    setDestinationWarehouseId('');
    setTransferDate(today());
    setNote('');
    setDraftLines([{ balanceKey: '', quantity: '' }]);
  }

  async function createTransfer() {
    const selectedLines = draftLines.map((line) => ({ line, balance: balanceByKey.get(line.balanceKey) }));
    if (!sourceWarehouseId || !destinationWarehouseId || sourceWarehouseId === destinationWarehouseId) {
      setNotice({ kind: 'error', message: 'Chọn hai kho khác nhau trước khi tạo phiếu.' });
      return;
    }
    if (selectedLines.some(({ line, balance }) => !balance || !isPositiveDecimal(line.quantity))) {
      setNotice({ kind: 'error', message: 'Mỗi dòng phải chọn hàng tồn và nhập số lượng lớn hơn 0.' });
      return;
    }
    setBusy('create');
    setNotice(null);
    try {
      const created = await requestJson<InventoryTransfer>('/api/inventory/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey('transfer-create') },
        body: JSON.stringify({
          transferDate,
          sourceWarehouseId,
          destinationWarehouseId,
          note: note.trim() || null,
          lines: selectedLines.map(({ line, balance }) => ({
            sourceVariantId: balance!.base_variant_id,
            sourceLocationId: balance!.location_id,
            lotId: balance!.lot_id,
            sourceQuantity: line.quantity.trim(),
          })),
        }),
      });
      await refresh(created.id);
      setShowCreate(false);
      resetDraft();
      setNotice({ kind: 'success', message: 'Đã tạo phiếu chuyển kho nháp.' });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không tạo được phiếu chuyển kho.' });
    } finally {
      setBusy(null);
    }
  }

  async function transition(action: 'approve' | 'dispatch' | 'cancel') {
    if (!selected) return;
    if (action === 'cancel' && !cancelReason.trim()) {
      setNotice({ kind: 'error', message: 'Nhập lý do hủy phiếu.' });
      return;
    }
    setBusy(action);
    setNotice(null);
    try {
      const body = action === 'cancel'
        ? { expectedRevision: selected.revision, reason: cancelReason.trim() }
        : { expectedRevision: selected.revision };
      const updated = await requestJson<InventoryTransfer>(`/api/inventory/transfers/${selected.id}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey(`transfer-${action}`) },
        body: JSON.stringify(body),
      });
      await refresh(updated.id);
      setCancelReason('');
      setNotice({
        kind: 'success',
        message: action === 'approve'
          ? 'Phiếu đã được duyệt.'
          : action === 'dispatch'
            ? 'Đã xuất kho nguồn và ghi nhận hàng đang đi đường.'
            : 'Phiếu đã được hủy.',
      });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không thực hiện được thao tác.' });
    } finally {
      setBusy(null);
    }
  }

  function openReceiptForm() {
    if (!receiptBundle) return;
    setReceiptDate(today());
    setReceiptNote('');
    setReceiptLines(receiptBundle.resolution.map((line) => ({
      transferLineId: line.transferLineId,
      destinationLocationId: destinationLocations[0]?.id ?? '',
      acceptedQuantity: '',
      damagedQuantity: '',
      overQuantity: '',
      note: '',
    })));
    setShowReceiptForm(true);
    setNotice(null);
  }

  async function submitReceipt() {
    if (!selected || !receiptBundle) return;
    const activeLines = receiptLines.filter((line) =>
      isPositiveDecimal(line.acceptedQuantity)
      || isPositiveDecimal(line.damagedQuantity)
      || isPositiveDecimal(line.overQuantity));
    if (activeLines.length === 0) {
      setNotice({ kind: 'error', message: 'Nhập ít nhất một số lượng nhận đạt, hư hỏng hoặc thừa.' });
      return;
    }
    if (activeLines.some((line) => isPositiveDecimal(line.acceptedQuantity) && !line.destinationLocationId)) {
      setNotice({ kind: 'error', message: 'Hàng nhận đạt phải có vị trí nhập tại kho đích.' });
      return;
    }
    setBusy('receive');
    setNotice(null);
    try {
      await requestJson<{ transfer: InventoryTransfer; receipt: TransferReceipt }>(
        `/api/inventory/transfers/${selected.id}/receipts`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('transfer-receive') },
          body: JSON.stringify({
            receiptDate,
            note: receiptNote.trim() || null,
            lines: activeLines.map((line) => ({
              transferLineId: line.transferLineId,
              destinationLocationId: line.destinationLocationId || null,
              acceptedQuantity: line.acceptedQuantity.trim() || '0',
              damagedQuantity: line.damagedQuantity.trim() || '0',
              overQuantity: line.overQuantity.trim() || '0',
              note: line.note.trim() || null,
            })),
          }),
        },
      );
      await refresh(selected.id);
      setShowReceiptForm(false);
      setNotice({ kind: 'success', message: 'Đã ghi nhận lần nhận chuyển kho. Chỉ hàng đạt được cộng tồn khả dụng.' });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không ghi nhận được lần nhận.' });
    } finally {
      setBusy(null);
    }
  }

  async function approveDamage(receiptId: string) {
    if (!selected) return;
    setBusy(`damage-${receiptId}`);
    setNotice(null);
    try {
      await requestJson<{ transfer: InventoryTransfer; receipt: TransferReceipt }>(
        `/api/inventory/transfers/${selected.id}/receipts/${receiptId}/approve-damage`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('transfer-damage-approve') },
          body: JSON.stringify({ note: damageNotes[receiptId]?.trim() || null }),
        },
      );
      await loadReceiptBundle(selected.id);
      setNotice({ kind: 'success', message: 'Quản lý kho đã xác nhận biên bản hư hỏng.' });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không duyệt được hư hỏng.' });
    } finally {
      setBusy(null);
    }
  }

  async function closeShort() {
    if (!selected || !shortReason.trim()) {
      setNotice({ kind: 'error', message: 'Nhập lý do trước khi đóng phần thiếu.' });
      return;
    }
    setBusy('close-short');
    setNotice(null);
    try {
      await requestJson<{ transfer: InventoryTransfer; shortClosure: ReceiptBundle['shortClosure']; resolution: ResolutionLine[] }>(
        `/api/inventory/transfers/${selected.id}/close-short`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('transfer-close-short') },
          body: JSON.stringify({ reason: shortReason.trim() }),
        },
      );
      await refresh(selected.id);
      setShortReason('');
      setNotice({ kind: 'success', message: 'Đã đóng phần thiếu bằng biên bản riêng; số lượng xuất gốc không bị sửa.' });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không đóng được phần thiếu.' });
    } finally {
      setBusy(null);
    }
  }

  async function reverseReceipt(receiptId: string) {
    if (!selected || !reverseReasons[receiptId]?.trim()) {
      setNotice({ kind: 'error', message: 'Nhập lý do trước khi đảo lần nhận.' });
      return;
    }
    setBusy(`reverse-${receiptId}`);
    setNotice(null);
    try {
      await requestJson<{ transfer: InventoryTransfer; receipt: TransferReceipt }>(
        `/api/inventory/transfers/${selected.id}/receipts/${receiptId}/reverse`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('transfer-receipt-reverse') },
          body: JSON.stringify({ documentDate: today(), reason: reverseReasons[receiptId].trim() }),
        },
      );
      await refresh(selected.id);
      setNotice({ kind: 'success', message: 'Đã đảo lần nhận và mở lại phần hàng đang đi đường tương ứng.' });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không đảo được lần nhận.' });
    } finally {
      setBusy(null);
    }
  }

  const headerActions = (
    <div className={styles.headerActions}>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={busy !== null}
        onClick={() => {
          setBusy('refresh');
          refresh(selected?.id)
            .then(() => setNotice({ kind: 'success', message: 'Dữ liệu chuyển kho đã được làm mới.' }))
            .catch((error) => setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không làm mới được dữ liệu.' }))
            .finally(() => setBusy(null));
        }}
      >
        Làm mới
      </button>
      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => {
          setShowCreate(true);
          setSelected(null);
          setReceiptBundle(null);
          setShowReceiptForm(false);
          setNotice(null);
        }}
      >
        Tạo phiếu chuyển kho
      </button>
    </div>
  );

  const remainingTotal = receiptBundle?.resolution.reduce(
    (sum, line) => sum + Number(line.remainingBaseQuantity || 0),
    0,
  ) ?? 0;

  return (
    <AppShell
      kicker="Tồn kho & lô hàng"
      title="Chuyển kho"
      subtitle="Tạo, duyệt, xuất và nhận hàng giữa các kho; chênh lệch được lưu bằng chứng từ riêng, không sửa số lượng xuất gốc."
      actions={headerActions}
    >
      <div className={styles.workspace}>
        {notice ? <div className={notice.kind === 'success' ? styles.successNotice : styles.errorNotice}>{notice.message}</div> : null}

        <section className={styles.summaryGrid} aria-label="Tổng hợp chuyển kho">
          <article className={styles.summaryCard}><span>Phiếu nháp</span><strong>{counts.draft}</strong></article>
          <article className={styles.summaryCard}><span>Chờ xuất kho</span><strong>{counts.approved}</strong></article>
          <article className={styles.summaryCard}><span>Đã xuất chuyển</span><strong>{counts.dispatched}</strong></article>
          <article className={styles.summaryCard}><span>Dòng đang đi đường</span><strong>{counts.inTransitLines}</strong></article>
        </section>

        <section className={styles.filterPanel} aria-label="Bộ lọc chuyển kho">
          <div className={styles.segmented}>
            <button type="button" className={mode === 'transfers' ? styles.segmentActive : styles.segment} onClick={() => setMode('transfers')}>Phiếu chuyển kho</button>
            <button type="button" className={mode === 'in-transit' ? styles.segmentActive : styles.segment} onClick={() => setMode('in-transit')}>Hàng đang đi đường</button>
          </div>
          <label className={styles.field}>
            <span>Tìm kiếm</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Số phiếu, kho, SKU hoặc lô" />
          </label>
          {mode === 'transfers' ? (
            <label className={styles.field}>
              <span>Trạng thái chứng từ</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="all">Tất cả</option>
                <option value="draft">Nháp</option>
                <option value="approved">Đã duyệt</option>
                <option value="dispatched">Đã xuất chuyển</option>
                <option value="cancelled">Đã hủy</option>
              </select>
            </label>
          ) : null}
          <button type="button" className={styles.resetButton} onClick={() => { setSearch(''); setStatus('all'); }}>Đặt lại</button>
        </section>

        {showCreate ? (
          <section className={styles.panel} aria-labelledby="create-transfer-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>Phiếu mới</p>
                <h2 id="create-transfer-title">Tạo phiếu chuyển kho</h2>
              </div>
              <button type="button" className={styles.textButton} onClick={() => setShowCreate(false)}>Đóng</button>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Ngày chuyển</span><input type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} /></label>
              <label className={styles.field}>
                <span>Kho xuất</span>
                <select value={sourceWarehouseId} onChange={(event) => { setSourceWarehouseId(event.target.value); setDraftLines([{ balanceKey: '', quantity: '' }]); }}>
                  <option value="">Chọn kho xuất</option>
                  {warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Kho nhận</span>
                <select value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)}>
                  <option value="">Chọn kho nhận</option>
                  {warehouseOptions.filter((warehouse) => warehouse.id !== sourceWarehouseId).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
                </select>
              </label>
              <label className={`${styles.field} ${styles.fullWidth}`}><span>Ghi chú</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
            </div>
            <div className={styles.linesHeader}>
              <div><h3>Hàng chuyển</h3><p>Chọn từ số tồn khả dụng thực tế của kho xuất.</p></div>
              <button type="button" className={styles.secondaryButton} disabled={!sourceWarehouseId} onClick={() => setDraftLines((current) => [...current, { balanceKey: '', quantity: '' }])}>Thêm dòng</button>
            </div>
            <div className={styles.lineList}>
              {draftLines.map((line, index) => {
                const balance = balanceByKey.get(line.balanceKey);
                return (
                  <div className={styles.lineEditor} key={`${index}-${line.balanceKey}`}>
                    <label className={styles.field}>
                      <span>Hàng tồn</span>
                      <select value={line.balanceKey} onChange={(event) => setDraftLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, balanceKey: event.target.value } : item))}>
                        <option value="">Chọn SKU / vị trí / lô</option>
                        {sourceBalances.map((item) => (
                          <option key={keyOfBalance(item)} value={keyOfBalance(item)}>
                            {item.base_sku} · {item.location_code || 'Không vị trí'} · {item.lot_code || 'Không lô'} · khả dụng {formatQuantity(item.available_quantity)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}><span>Số lượng</span><input inputMode="decimal" value={line.quantity} onChange={(event) => setDraftLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>
                    <div className={styles.lineMeta}><span>Khả dụng</span><strong>{balance ? formatQuantity(balance.available_quantity) : '—'}</strong></div>
                    <button type="button" className={styles.removeButton} disabled={draftLines.length === 1} onClick={() => setDraftLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Xóa dòng</button>
                  </div>
                );
              })}
            </div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.secondaryButton} onClick={() => { resetDraft(); setShowCreate(false); }}>Hủy nhập</button>
              <button type="button" className={styles.primaryButton} disabled={busy === 'create'} onClick={createTransfer}>{busy === 'create' ? 'Đang tạo…' : 'Lưu phiếu nháp'}</button>
            </div>
          </section>
        ) : null}

        {selected ? (
          <section className={styles.panel} aria-labelledby="transfer-detail-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>{statusLabel(selected)}</p>
                <h2 id="transfer-detail-title">{selected.documentNumber || 'Phiếu chuyển kho nháp'}</h2>
                <p>{selected.sourceWarehouseCode} → {selected.destinationWarehouseCode} · {formatDate(selected.transferDate)}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TransferPrintDock transfer={selected} />
                <button type="button" className={styles.textButton} onClick={() => { setSelected(null); setReceiptBundle(null); setShowReceiptForm(false); }}>Đóng</button>
              </div>
            </div>

            <div className={styles.detailFacts}>
              <div><span>Kho xuất</span><strong>{selected.sourceWarehouseName}</strong></div>
              <div><span>Kho nhận</span><strong>{selected.destinationWarehouseName}</strong></div>
              <div><span>Số dòng</span><strong>{selected.lines?.length ?? selected.lineCount}</strong></div>
              <div><span>Tổng lượng cơ sở</span><strong>{formatQuantity(selected.baseQuantityTotal)}</strong></div>
              <div><span>Movement nguồn</span><strong>{selected.inventoryMovementId ? 'Đã ghi sổ' : 'Chưa ghi sổ'}</strong></div>
              <div><span>Cập nhật</span><strong>{formatDateTime(selected.updatedAt)}</strong></div>
            </div>

            <div className={styles.detailLineGrid}>
              {(selected.lines ?? []).map((line) => (
                <article className={styles.detailLineCard} key={line.id}>
                  <div><strong>{line.sourceSku}</strong><span>{line.itemName}</span></div>
                  <dl>
                    <div><dt>Số lượng xuất</dt><dd>{formatQuantity(line.sourceQuantity)} {line.sourceUnitCode}</dd></div>
                    <div><dt>Lô</dt><dd>{line.lotCode || 'Không lô'}</dd></div>
                    <div><dt>Hạn dùng</dt><dd>{line.expiryDate ? formatDate(line.expiryDate) : 'Không có'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>

            {selected.status === 'draft' ? (
              <div className={styles.actionRow}>
                <label className={styles.inlineReason}><span>Lý do hủy</span><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
                <button type="button" className={styles.dangerButton} disabled={busy !== null} onClick={() => transition('cancel')}>Hủy phiếu</button>
                <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => transition('approve')}>{busy === 'approve' ? 'Đang duyệt…' : 'Duyệt phiếu'}</button>
              </div>
            ) : null}
            {selected.status === 'approved' ? (
              <div className={styles.actionRow}>
                <label className={styles.inlineReason}><span>Lý do hủy</span><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
                <button type="button" className={styles.dangerButton} disabled={busy !== null} onClick={() => transition('cancel')}>Hủy phiếu</button>
                <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => transition('dispatch')}>{busy === 'dispatch' ? 'Đang xuất kho…' : 'Xuất kho chuyển'}</button>
              </div>
            ) : null}

            {selected.status === 'dispatched' && receiptBundle ? (
              <div className={styles.receiptWorkspace}>
                <div className={styles.linesHeader}>
                  <div>
                    <h3>Nhận hàng tại kho đích</h3>
                    <p>Nhận đạt mới vào tồn khả dụng; hư hỏng và thừa được giữ riêng để xử lý.</p>
                  </div>
                  {!receiptBundle.shortClosure ? <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={openReceiptForm}>Lập lần nhận</button> : null}
                </div>

                <div className={styles.resolutionGrid}>
                  {receiptBundle.resolution.map((line) => (
                    <article className={styles.resolutionCard} key={line.transferLineId}>
                      <div className={styles.cardTop}><strong>{line.sourceSku}</strong><span>{line.sourceUnitCode}</span></div>
                      <p>{line.itemName}{line.lotCode ? ` · lô ${line.lotCode}` : ''}</p>
                      <dl>
                        <div><dt>Đã xuất</dt><dd>{formatQuantity(line.dispatchedQuantity)}</dd></div>
                        <div><dt>Nhận đạt</dt><dd>{formatQuantity(line.acceptedQuantity)}</dd></div>
                        <div><dt>Hư hỏng</dt><dd>{formatQuantity(line.damagedQuantity)}</dd></div>
                        <div><dt>Thiếu đã đóng</dt><dd>{formatQuantity(line.shortQuantity)}</dd></div>
                        <div><dt>Thừa chờ xác minh</dt><dd>{formatQuantity(line.overQuantity)}</dd></div>
                        <div><dt>Còn đi đường</dt><dd>{formatQuantity(line.remainingQuantity)}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>

                {showReceiptForm ? (
                  <section className={styles.subPanel} aria-labelledby="receive-transfer-title">
                    <div className={styles.panelHeader}>
                      <div><p className={styles.eyebrow}>Lần nhận mới</p><h3 id="receive-transfer-title">Ghi nhận kiểm đếm tại kho đích</h3></div>
                      <button type="button" className={styles.textButton} onClick={() => setShowReceiptForm(false)}>Đóng</button>
                    </div>
                    <div className={styles.formGrid}>
                      <label className={styles.field}><span>Ngày nhận</span><input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} /></label>
                      <label className={`${styles.field} ${styles.fullWidth}`}><span>Ghi chú lần nhận</span><textarea rows={2} value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} /></label>
                    </div>
                    <div className={styles.receiptLineList}>
                      {receiptBundle.resolution.map((resolution) => {
                        const draft = receiptLines.find((line) => line.transferLineId === resolution.transferLineId);
                        if (!draft) return null;
                        const updateLine = (patch: Partial<ReceiptDraftLine>) => setReceiptLines((current) => current.map((line) => line.transferLineId === resolution.transferLineId ? { ...line, ...patch } : line));
                        return (
                          <article className={styles.receiptLineEditor} key={resolution.transferLineId}>
                            <div className={styles.receiptLineTitle}>
                              <strong>{resolution.sourceSku} · {resolution.itemName}</strong>
                              <span>Còn đi đường {formatQuantity(resolution.remainingQuantity)} {resolution.sourceUnitCode}</span>
                            </div>
                            <label className={styles.field}>
                              <span>Vị trí nhập hàng đạt</span>
                              <select value={draft.destinationLocationId} onChange={(event) => updateLine({ destinationLocationId: event.target.value })}>
                                <option value="">Chọn vị trí kho đích</option>
                                {destinationLocations.map((location) => <option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}
                              </select>
                            </label>
                            <label className={styles.field}><span>Nhận đạt</span><input inputMode="decimal" value={draft.acceptedQuantity} onChange={(event) => updateLine({ acceptedQuantity: event.target.value })} placeholder="0" /></label>
                            <label className={styles.field}><span>Hư hỏng</span><input inputMode="decimal" value={draft.damagedQuantity} onChange={(event) => updateLine({ damagedQuantity: event.target.value })} placeholder="0" /></label>
                            <label className={styles.field}><span>Thừa chờ xác minh</span><input inputMode="decimal" value={draft.overQuantity} onChange={(event) => updateLine({ overQuantity: event.target.value })} placeholder="0" /></label>
                            <label className={`${styles.field} ${styles.fullWidth}`}><span>Ghi chú dòng</span><input value={draft.note} onChange={(event) => updateLine({ note: event.target.value })} /></label>
                          </article>
                        );
                      })}
                    </div>
                    <div className={styles.infoNotice}>Hàng thừa không tự cộng tồn. Hàng hư hỏng không vào tồn bán được và cần quản lý kho duyệt biên bản.</div>
                    <div className={styles.actionRow}>
                      <button type="button" className={styles.secondaryButton} onClick={() => setShowReceiptForm(false)}>Hủy nhập</button>
                      <button type="button" className={styles.primaryButton} disabled={busy === 'receive'} onClick={submitReceipt}>{busy === 'receive' ? 'Đang ghi nhận…' : 'Xác nhận lần nhận'}</button>
                    </div>
                  </section>
                ) : null}

                {receiptBundle.receipts.length > 0 ? (
                  <div className={styles.receiptHistory}>
                    <h3>Lịch sử nhận và xử lý</h3>
                    {receiptBundle.receipts.map((receipt) => {
                      const damageTotal = receipt.lines.reduce((sum, line) => sum + Number(line.damagedQuantity || 0), 0);
                      return (
                        <article className={styles.receiptCard} key={receipt.id}>
                          <div className={styles.panelHeader}>
                            <div>
                              <p className={styles.eyebrow}>Lần nhận {receipt.receiptSequence}</p>
                              <h4>{formatDate(receipt.receiptDate)} · {receipt.inventoryMovementId ? 'Đã ghi tồn hàng đạt' : 'Không có hàng đạt'}</h4>
                            </div>
                            <span className={receipt.reversal ? styles.reversedBadge : styles.statusBadge}>{receipt.reversal ? 'Đã đảo' : 'Có hiệu lực'}</span>
                          </div>
                          <div className={styles.receiptLineSummary}>
                            {receipt.lines.map((line) => (
                              <div key={line.id}>
                                <strong>{line.sourceSku}</strong>
                                <span>Đạt {formatQuantity(line.acceptedQuantity)} · Hư {formatQuantity(line.damagedQuantity)} · Thừa {formatQuantity(line.overQuantity)}</span>
                                <small>{line.destinationLocationCode ? `Vị trí ${line.destinationLocationCode}` : 'Không nhập tồn'}{line.note ? ` · ${line.note}` : ''}</small>
                              </div>
                            ))}
                          </div>
                          {damageTotal > 0 && !receipt.damageApproval && !receipt.reversal ? (
                            <div className={styles.actionRow}>
                              <label className={styles.inlineReason}><span>Ghi chú duyệt hư hỏng</span><input value={damageNotes[receipt.id] ?? ''} onChange={(event) => setDamageNotes((current) => ({ ...current, [receipt.id]: event.target.value }))} /></label>
                              <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => approveDamage(receipt.id)}>{busy === `damage-${receipt.id}` ? 'Đang duyệt…' : 'Duyệt hư hỏng'}</button>
                            </div>
                          ) : null}
                          {receipt.damageApproval ? <div className={styles.approvalNotice}>Hư hỏng đã được duyệt lúc {formatDateTime(receipt.damageApproval.approvedAt)}.</div> : null}
                          {!receipt.reversal && !receiptBundle.shortClosure ? (
                            <div className={styles.actionRow}>
                              <label className={styles.inlineReason}><span>Lý do đảo lần nhận</span><input value={reverseReasons[receipt.id] ?? ''} onChange={(event) => setReverseReasons((current) => ({ ...current, [receipt.id]: event.target.value }))} /></label>
                              <button type="button" className={styles.dangerButton} disabled={busy !== null} onClick={() => reverseReceipt(receipt.id)}>{busy === `reverse-${receipt.id}` ? 'Đang đảo…' : 'Đảo lần nhận'}</button>
                            </div>
                          ) : null}
                          {receipt.reversal ? <div className={styles.errorNotice}>Đã đảo: {receipt.reversal.reason}</div> : null}
                        </article>
                      );
                    })}
                  </div>
                ) : <div className={styles.emptyState}>Chưa có lần nhận nào cho phiếu này.</div>}

                {receiptBundle.shortClosure ? (
                  <div className={styles.approvalNotice}>
                    <strong>Đã đóng phần thiếu.</strong> {receiptBundle.shortClosure.reason} · {formatDateTime(receiptBundle.shortClosure.closedAt)}
                  </div>
                ) : remainingTotal > 0 ? (
                  <div className={styles.closeShortPanel}>
                    <div><strong>Đóng phần thiếu</strong><p>Chỉ dùng khi đã xác minh phần còn lại sẽ không về. Phiếu xuất gốc vẫn được giữ nguyên.</p></div>
                    <label className={styles.inlineReason}><span>Lý do bắt buộc</span><input value={shortReason} onChange={(event) => setShortReason(event.target.value)} /></label>
                    <button type="button" className={styles.dangerButton} disabled={busy !== null} onClick={closeShort}>{busy === 'close-short' ? 'Đang đóng…' : 'Đóng phần thiếu'}</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {!showCreate && !selected ? mode === 'transfers' ? (
          <section className={styles.cardGrid} aria-label="Danh sách phiếu chuyển kho">
            {filteredTransfers.length === 0 ? <div className={styles.emptyState}>Chưa có phiếu phù hợp bộ lọc.</div> : filteredTransfers.map((transfer) => (
              <button type="button" className={styles.transferCard} key={transfer.id} onClick={() => openDetail(transfer.id)} disabled={busy === `detail-${transfer.id}`}>
                <div className={styles.cardTop}><span className={styles.statusBadge}>{statusLabel(transfer)}</span><time>{formatDate(transfer.transferDate)}</time></div>
                <strong>{transfer.documentNumber || 'Phiếu nháp chưa cấp số'}</strong>
                <p>{transfer.sourceWarehouseCode} → {transfer.destinationWarehouseCode}</p>
                <dl><div><dt>Số dòng</dt><dd>{transfer.lineCount}</dd></div><div><dt>Lượng cơ sở</dt><dd>{formatQuantity(transfer.baseQuantityTotal)}</dd></div></dl>
              </button>
            ))}
          </section>
        ) : (
          <section className={styles.cardGrid} aria-label="Hàng đang đi đường">
            {filteredInTransit.length === 0 ? <div className={styles.emptyState}>Không có hàng đang đi đường phù hợp bộ lọc.</div> : filteredInTransit.map((line) => (
              <button type="button" className={styles.transferCard} key={line.transferLineId} onClick={() => openDetail(line.transferId)}>
                <div className={styles.cardTop}><span className={styles.statusBadge}>Đang đi đường</span><time>{formatDateTime(line.dispatchedAt)}</time></div>
                <strong>{line.sourceSku} · {line.itemName}</strong>
                <p>{line.sourceWarehouseCode} → {line.destinationWarehouseCode}</p>
                <dl><div><dt>Số phiếu</dt><dd>{line.documentNumber}</dd></div><div><dt>Còn lại</dt><dd>{formatQuantity(line.sourceQuantity)} {line.sourceUnitCode}</dd></div><div><dt>Lô</dt><dd>{line.lotCode || 'Không lô'}</dd></div></dl>
              </button>
            ))}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
