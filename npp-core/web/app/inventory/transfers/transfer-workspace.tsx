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
import styles from './transfer-workspace.module.css';

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
  baseVariantId: string;
  baseSku: string;
  baseQuantity: string;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  inventoryMovementId: string;
};

type Props = {
  initialTransfers: InventoryTransfer[];
  initialInTransit: InventoryTransferInTransit[];
  balances: InventoryBalance[];
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
  initialError = null,
}: Props) {
  const [transfers, setTransfers] = useState(initialTransfers);
  const [inTransit, setInTransit] = useState(initialInTransit);
  const [selected, setSelected] = useState<InventoryTransfer | null>(null);
  const [mode, setMode] = useState<'transfers' | 'in-transit'>('transfers');
  const [showCreate, setShowCreate] = useState(false);
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

  const warehouseOptions = useMemo(() => {
    const values = new Map<string, { id: string; code: string; name: string }>();
    for (const balance of balances) {
      values.set(balance.warehouse_id, {
        id: balance.warehouse_id,
        code: balance.warehouse_code,
        name: balance.warehouse_name,
      });
    }
    return [...values.values()].sort((left, right) => left.code.localeCompare(right.code));
  }, [balances]);

  const balanceByKey = useMemo(() => new Map(balances.map((balance) => [keyOfBalance(balance), balance])), [balances]);
  const sourceBalances = useMemo(
    () => balances.filter((balance) => balance.warehouse_id === sourceWarehouseId && isPositiveDecimal(balance.available_quantity)),
    [balances, sourceWarehouseId],
  );

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
    }
  }

  async function openDetail(id: string) {
    setBusy(`detail-${id}`);
    setNotice(null);
    try {
      setSelected(await requestJson<InventoryTransfer>(`/api/inventory/transfers/${id}`));
      setShowCreate(false);
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
          setNotice(null);
        }}
      >
        Tạo phiếu chuyển kho
      </button>
    </div>
  );

  return (
    <AppShell
      kicker="Tồn kho & lô hàng"
      title="Chuyển kho"
      subtitle="Tạo, duyệt và xuất hàng giữa các kho; hàng đã xuất được theo dõi riêng trong trạng thái đang đi đường."
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
              <span>Trạng thái</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="all">Tất cả</option>
                <option value="draft">Nháp</option>
                <option value="approved">Đã duyệt</option>
                <option value="dispatched">Đang đi đường</option>
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
              <label className={styles.field}>
                <span>Ngày chuyển</span>
                <input type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} />
              </label>
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
              <label className={`${styles.field} ${styles.fullWidth}`}>
                <span>Ghi chú</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Mục đích hoặc lưu ý khi chuyển kho" />
              </label>
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
                    <label className={styles.field}>
                      <span>Số lượng</span>
                      <input inputMode="decimal" value={line.quantity} onChange={(event) => setDraftLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                    </label>
                    <div className={styles.lineMeta}>
                      <span>Khả dụng</span>
                      <strong>{balance ? formatQuantity(balance.available_quantity) : '—'}</strong>
                    </div>
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
                <p className={styles.eyebrow}>{STATUS_LABEL[selected.status]}</p>
                <h2 id="transfer-detail-title">{selected.documentNumber || 'Phiếu chuyển kho nháp'}</h2>
                <p>{selected.sourceWarehouseCode} → {selected.destinationWarehouseCode} · {formatDate(selected.transferDate)}</p>
              </div>
              <button type="button" className={styles.textButton} onClick={() => setSelected(null)}>Đóng</button>
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
                    <div><dt>Số lượng</dt><dd>{formatQuantity(line.sourceQuantity)} {line.sourceUnitCode}</dd></div>
                    <div><dt>Vị trí</dt><dd>{line.sourceLocationId ? 'Theo vị trí đã chọn' : 'Không vị trí'}</dd></div>
                    <div><dt>Lô</dt><dd>{line.lotCode || 'Không lô'}</dd></div>
                    <div><dt>Hạn dùng</dt><dd>{line.expiryDate ? formatDate(line.expiryDate) : 'Không có'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>

            {selected.status === 'draft' ? (
              <div className={styles.actionRow}>
                <label className={styles.inlineReason}><span>Lý do hủy</span><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Bắt buộc khi hủy" /></label>
                <button type="button" className={styles.dangerButton} disabled={busy !== null} onClick={() => transition('cancel')}>Hủy phiếu</button>
                <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => transition('approve')}>{busy === 'approve' ? 'Đang duyệt…' : 'Duyệt phiếu'}</button>
              </div>
            ) : null}
            {selected.status === 'approved' ? (
              <div className={styles.actionRow}>
                <label className={styles.inlineReason}><span>Lý do hủy</span><input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Bắt buộc khi hủy" /></label>
                <button type="button" className={styles.dangerButton} disabled={busy !== null} onClick={() => transition('cancel')}>Hủy phiếu</button>
                <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => transition('dispatch')}>{busy === 'dispatch' ? 'Đang xuất kho…' : 'Xuất kho chuyển'}</button>
              </div>
            ) : null}
          </section>
        ) : null}

        {!showCreate && !selected ? mode === 'transfers' ? (
          <section className={styles.cardGrid} aria-label="Danh sách phiếu chuyển kho">
            {filteredTransfers.length === 0 ? <div className={styles.emptyState}>Chưa có phiếu phù hợp bộ lọc.</div> : filteredTransfers.map((transfer) => (
              <button type="button" className={styles.transferCard} key={transfer.id} onClick={() => openDetail(transfer.id)} disabled={busy === `detail-${transfer.id}`}>
                <div className={styles.cardTop}><span className={styles.statusBadge}>{STATUS_LABEL[transfer.status]}</span><time>{formatDate(transfer.transferDate)}</time></div>
                <strong>{transfer.documentNumber || 'Phiếu nháp chưa cấp số'}</strong>
                <p>{transfer.sourceWarehouseCode} → {transfer.destinationWarehouseCode}</p>
                <dl>
                  <div><dt>Số dòng</dt><dd>{transfer.lineCount}</dd></div>
                  <div><dt>Lượng cơ sở</dt><dd>{formatQuantity(transfer.baseQuantityTotal)}</dd></div>
                </dl>
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
                <dl>
                  <div><dt>Số phiếu</dt><dd>{line.documentNumber}</dd></div>
                  <div><dt>Số lượng</dt><dd>{formatQuantity(line.sourceQuantity)} {line.sourceUnitCode}</dd></div>
                  <div><dt>Lô</dt><dd>{line.lotCode || 'Không lô'}</dd></div>
                </dl>
              </button>
            ))}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
