'use client';

import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import { formatQuantity, type InventoryBalance } from '../../../lib/inventory-types';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import {
  adjustmentKindLabels,
  adjustmentStatusLabels,
  type AdjustmentKind,
  type AdjustmentReason,
  type InventoryAdjustment,
} from '../../../lib/inventory-adjustment-types';
import styles from './workspace.module.css';

type Props = {
  initialAdjustments: InventoryAdjustment[];
  reasons: AdjustmentReason[];
  balances: InventoryBalance[];
  warehouses: Warehouse[];
  locations: WarehouseLocation[];
  initialError: string | null;
};

type Draft = {
  documentKind: AdjustmentKind;
  adjustmentDirection: 'IN' | 'OUT';
  warehouseId: string;
  sourceKey: string;
  destinationLocationId: string;
  quantity: string;
  reasonCode: string;
  reasonNote: string;
};

const emptyDraft: Draft = {
  documentKind: 'MANUAL_ADJUSTMENT', adjustmentDirection: 'OUT', warehouseId: '', sourceKey: '',
  destinationLocationId: '', quantity: '', reasonCode: '', reasonNote: '',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}

function keyForBalance(item: InventoryBalance): string {
  return [item.warehouse_id, item.location_id, item.base_variant_id, item.lot_id ?? ''].join('|');
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload?.error?.message || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

export default function InventoryAdjustmentWorkspace({
  initialAdjustments, reasons, balances, warehouses, locations, initialError,
}: Props) {
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [selected, setSelected] = useState<InventoryAdjustment | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState<string | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const detailRequest = useRef(0);

  const sourceBalances = useMemo(() => balances.filter((item) => item.location_id && (!draft.warehouseId || item.warehouse_id === draft.warehouseId)), [balances, draft.warehouseId]);
  const selectedBalance = sourceBalances.find((item) => keyForBalance(item) === draft.sourceKey) ?? null;
  const destinationType = draft.documentKind === 'QUARANTINE_TRANSFER' ? 'quarantine'
    : draft.documentKind === 'DAMAGED_TRANSFER' ? 'damaged' : null;
  const destinationLocations = locations.filter((item) => item.warehouse_id === draft.warehouseId && item.location_type === destinationType);
  const availableReasons = reasons.filter((reason) => reason.documentKind === draft.documentKind
    && (reason.adjustmentDirection ?? null) === (draft.documentKind === 'MANUAL_ADJUSTMENT' ? draft.adjustmentDirection : null));

  function stableKey(signature: string): string {
    const current = idempotencyKeys.current.get(signature);
    if (current) return current;
    const next = `web_inventory_adjustment_${crypto.randomUUID()}`;
    idempotencyKeys.current.set(signature, next);
    return next;
  }

  function clearKey(signature: string) { idempotencyKeys.current.delete(signature); }

  async function refresh(nextStatus = statusFilter, nextKind = kindFilter) {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (nextStatus) params.set('status', nextStatus);
      if (nextKind) params.set('documentKind', nextKind);
      const data = await requestJson<InventoryAdjustment[]>(`/api/inventory/adjustments${params.toString() ? `?${params}` : ''}`);
      setAdjustments(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải lại được danh sách'); }
    finally { setBusy(false); }
  }

  async function openDetail(id: string) {
    const requestSequence = detailRequest.current + 1;
    detailRequest.current = requestSequence;
    setBusy(true); setError(null);
    try {
      const detail = await requestJson<InventoryAdjustment>(`/api/inventory/adjustments/${id}`);
      if (detailRequest.current === requestSequence) setSelected(detail);
    } catch (cause) {
      if (detailRequest.current === requestSequence) {
        setError(cause instanceof Error ? cause.message : 'Không tải được chi tiết phiếu');
      }
    } finally {
      if (detailRequest.current === requestSequence) setBusy(false);
    }
  }

  async function createDocument() {
    if (!selectedBalance || !draft.reasonCode || !draft.reasonNote.trim() || !draft.quantity.trim()) {
      setError('Chọn đủ kho, dòng tồn, lý do, số lượng và ghi chú lý do.'); return;
    }
    const signature = JSON.stringify(draft);
    setBusy(true); setError(null); setMessage(null);
    try {
      const body = {
        warehouseId: draft.warehouseId,
        documentKind: draft.documentKind,
        ...(draft.documentKind === 'MANUAL_ADJUSTMENT' ? { adjustmentDirection: draft.adjustmentDirection } : {}),
        reasonCode: draft.reasonCode,
        reasonNote: draft.reasonNote.trim(),
        lines: [{
          sourceLocationId: selectedBalance.location_id,
          sourceVariantId: selectedBalance.base_variant_id,
          lotId: selectedBalance.lot_id,
          quantity: draft.quantity.trim(),
          ...(destinationType ? { destinationLocationId: draft.destinationLocationId } : {}),
        }],
      };
      const created = await requestJson<InventoryAdjustment>('/api/inventory/adjustments', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stableKey(`create:${signature}`) }, body: JSON.stringify(body),
      });
      clearKey(`create:${signature}`);
      setAdjustments((items) => [created, ...items]); setSelected(created); setShowCreate(false); setDraft(emptyDraft);
      setMessage(`Đã tạo ${created.adjustmentNumber}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được phiếu'); }
    finally { setBusy(false); }
  }

  async function transition(action: 'submit' | 'approve' | 'post' | 'cancel' | 'reverse') {
    if (!selected) return;
    let extra: Record<string, string> = {};
    if (action === 'cancel' || action === 'reverse') {
      const reason = window.prompt(action === 'cancel' ? 'Nhập lý do hủy phiếu' : 'Nhập lý do đảo phiếu')?.trim();
      if (!reason) return;
      extra = { reason };
    }
    const signature = `${selected.id}:${action}:${selected.revision}:${JSON.stringify(extra)}`;
    setBusy(true); setError(null); setMessage(null);
    try {
      const updated = await requestJson<InventoryAdjustment>(`/api/inventory/adjustments/${selected.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stableKey(signature) },
        body: JSON.stringify({ expectedRevision: selected.revision, ...extra }),
      });
      clearKey(signature); setSelected(updated);
      setAdjustments((items) => items.map((item) => item.id === updated.id ? updated : item));
      setMessage(`Đã cập nhật ${updated.adjustmentNumber}: ${adjustmentStatusLabels[updated.status]}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không cập nhật được phiếu'); }
    finally { setBusy(false); }
  }

  const actions = (
    <div className={styles.headerActions} data-testid="inventory-adjustment-page-actions">
      <button className={styles.secondaryButton} type="button" onClick={() => refresh()} disabled={busy}>Làm mới</button>
      <button className={styles.primaryButton} type="button" onClick={() => setShowCreate((value) => !value)} disabled={busy}>Tạo phiếu</button>
    </div>
  );

  return (
    <AppShell title="Điều chỉnh & xử lý tồn" kicker="Tồn kho & lô hàng"
      subtitle="Điều chỉnh thủ công, chuyển cách ly/hư hỏng và tiêu hủy qua luồng duyệt, ghi sổ append-only." actions={actions}>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}

      {showCreate ? <section className={styles.panel} aria-labelledby="create-adjustment-title">
        <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Phiếu mới</p><h2 id="create-adjustment-title">Tạo phiếu xử lý tồn kho</h2></div></div>
        <div className={styles.formGrid}>
          <label>Loại phiếu<select value={draft.documentKind} onChange={(event) => setDraft({ ...draft, documentKind: event.target.value as AdjustmentKind, reasonCode: '', destinationLocationId: '' })}>
            {Object.entries(adjustmentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {draft.documentKind === 'MANUAL_ADJUSTMENT' ? <label>Hướng điều chỉnh<select value={draft.adjustmentDirection} onChange={(event) => setDraft({ ...draft, adjustmentDirection: event.target.value as 'IN' | 'OUT', reasonCode: '' })}>
            <option value="IN">Tăng tồn</option><option value="OUT">Giảm tồn</option></select></label> : null}
          <label>Kho<select value={draft.warehouseId} onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value, sourceKey: '', destinationLocationId: '' })}>
            <option value="">Chọn kho</option>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>Dòng tồn nguồn<select value={draft.sourceKey} onChange={(event) => setDraft({ ...draft, sourceKey: event.target.value })}>
            <option value="">Chọn vị trí / SKU / lô</option>{sourceBalances.map((item) => <option key={keyForBalance(item)} value={keyForBalance(item)}>
              {item.location_code} — {item.base_sku}{item.lot_code ? ` / ${item.lot_code}` : ''} — khả dụng {formatQuantity(item.available_quantity)}
            </option>)}</select></label>
          {destinationType ? <label>Vị trí đích<select value={draft.destinationLocationId} onChange={(event) => setDraft({ ...draft, destinationLocationId: event.target.value })}>
            <option value="">Chọn vị trí {destinationType === 'quarantine' ? 'cách ly' : 'hư hỏng'}</option>
            {destinationLocations.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label> : null}
          <label>Số lượng không dấu<input inputMode="decimal" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} placeholder="0" /></label>
          <label>Lý do<select value={draft.reasonCode} onChange={(event) => setDraft({ ...draft, reasonCode: event.target.value })}>
            <option value="">Chọn lý do</option>{availableReasons.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label className={styles.fullWidth}>Ghi chú lý do<textarea value={draft.reasonNote} onChange={(event) => setDraft({ ...draft, reasonNote: event.target.value })} rows={3} /></label>
        </div>
        <div className={styles.actionRow}><button type="button" className={styles.secondaryButton} onClick={() => setShowCreate(false)}>Đóng</button>
          <button type="button" className={styles.primaryButton} onClick={createDocument} disabled={busy}>Lưu phiếu nháp</button></div>
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.filters}>
          <label>Trạng thái<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); refresh(event.target.value, kindFilter); }}>
            <option value="">Tất cả</option>{Object.entries(adjustmentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Loại phiếu<select value={kindFilter} onChange={(event) => { setKindFilter(event.target.value); refresh(statusFilter, event.target.value); }}>
            <option value="">Tất cả</option>{Object.entries(adjustmentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className={styles.layout}>
          <div className={styles.list} aria-label="Danh sách phiếu xử lý tồn kho">
            {adjustments.length === 0 ? <p className={styles.empty}>Chưa có phiếu phù hợp.</p> : adjustments.map((item) =>
              <button key={item.id} type="button" className={`${styles.listItem} ${selected?.id === item.id ? styles.active : ''}`} onClick={() => openDetail(item.id)}>
                <strong>{item.adjustmentNumber}</strong><span>{adjustmentKindLabels[item.documentKind]}</span>
                <small>{item.warehouseCode ?? item.warehouseName ?? item.warehouseId} · {adjustmentStatusLabels[item.status]} · {formatDate(item.createdAt)}</small>
              </button>)}
          </div>
          <div className={styles.detail}>
            {!selected ? <p className={styles.empty}>Chọn một phiếu để xem lineage và thao tác theo trạng thái.</p> : <>
              <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>{adjustmentStatusLabels[selected.status]}</p><h2>{selected.adjustmentNumber}</h2>
                <p>{adjustmentKindLabels[selected.documentKind]} · {selected.reasonLabel ?? selected.reasonCode}</p></div>
                <div className={styles.actionRow} data-testid="inventory-adjustment-document-actions">
                  {selected.status === 'DRAFT' ? <><button className={styles.secondaryButton} onClick={() => transition('cancel')} disabled={busy}>Hủy</button><button className={styles.primaryButton} onClick={() => transition('submit')} disabled={busy}>Gửi duyệt</button></> : null}
                  {selected.status === 'SUBMITTED' ? <><button className={styles.secondaryButton} onClick={() => transition('cancel')} disabled={busy}>Hủy</button><button className={styles.primaryButton} onClick={() => transition('approve')} disabled={busy}>Duyệt</button></> : null}
                  {selected.status === 'APPROVED' ? <><button className={styles.secondaryButton} onClick={() => transition('cancel')} disabled={busy}>Hủy</button><button className={styles.primaryButton} onClick={() => transition('post')} disabled={busy}>Ghi sổ</button></> : null}
                  {selected.status === 'POSTED' ? <button className={styles.dangerButton} onClick={() => transition('reverse')} disabled={busy}>Đảo phiếu</button> : null}
                </div>
              </div>
              <dl className={styles.meta}><div><dt>Kho</dt><dd>{selected.warehouseCode} — {selected.warehouseName}</dd></div><div><dt>Revision</dt><dd>{selected.revision}</dd></div>
                <div><dt>Movement</dt><dd>{selected.inventoryMovementId ?? 'Chưa ghi sổ'}</dd></div><div><dt>Người tạo</dt><dd>{selected.createdBy}</dd></div></dl>
              <p className={styles.note}>{selected.reasonNote}</p>
              <div className={styles.lines}>{selected.lines?.map((line) => <article key={line.id} className={styles.lineCard}>
                <strong>{line.sourceSku}{line.lotCode ? ` · Lô ${line.lotCode}` : ''}</strong>
                <span>{line.sourceLocationCode} → {line.destinationLocationCode ?? (selected.adjustmentDirection === 'IN' ? 'Tăng tại vị trí' : 'Ra khỏi tồn')}</span>
                <small>Số lượng {formatQuantity(line.quantity)} {line.sourceUnitCode} · cơ sở {formatQuantity(line.baseQuantity)}</small>
              </article>)}</div>
            </>}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
