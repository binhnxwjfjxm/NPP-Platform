'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import { BusinessSequenceNumber } from '../../components/business-table-sequence';
import { formatQuantity, type InventoryBalance } from '../../../lib/inventory-types';
import {
  addExactDecimal,
  formatSignedExactDecimal,
  subtractExactDecimal,
} from '../../../lib/decimal-display.js';
import {
  inventoryWorkflowErrorMessage,
  officeActorLabel,
} from '../../../lib/inventory-workflow-errors';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import {
  adjustmentKindLabels,
  adjustmentStatusLabels,
  type AdjustmentKind,
  type AdjustmentLine,
  type AdjustmentReason,
  type InventoryAdjustment,
} from '../../../lib/inventory-adjustment-types';
import { InventoryAdjustmentTabs, type InventoryAdjustmentTab } from './adjustment-tabs';
import styles from './workspace.module.css';

type Props = {
  initialAdjustments: InventoryAdjustment[];
  reasons: AdjustmentReason[];
  balances: InventoryBalance[];
  warehouses: Warehouse[];
  locations: WarehouseLocation[];
  initialError: string | null;
  initialTab: InventoryAdjustmentTab;
  initialAdjustmentId: string | null;
  createdSummary: string | null;
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

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

const emptyDraft: Draft = {
  documentKind: 'MANUAL_ADJUSTMENT',
  adjustmentDirection: 'OUT',
  warehouseId: '',
  sourceKey: '',
  destinationLocationId: '',
  quantity: '',
  reasonCode: '',
  reasonNote: '',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

function keyForBalance(item: InventoryBalance): string {
  return [item.warehouse_id, item.location_id, item.base_variant_id, item.lot_id ?? ''].join('|');
}

function balanceMatchesLine(balance: InventoryBalance, line: AdjustmentLine): boolean {
  return balance.warehouse_id === line.warehouseId
    && balance.location_id === line.sourceLocationId
    && balance.base_variant_id === line.baseVariantId
    && (balance.lot_id ?? null) === (line.lotId ?? null);
}

function sourceDelta(adjustment: InventoryAdjustment, line: AdjustmentLine): string {
  if (adjustment.documentKind === 'MANUAL_ADJUSTMENT' && adjustment.adjustmentDirection === 'IN') {
    return line.baseQuantity;
  }
  return subtractExactDecimal('0', line.baseQuantity) ?? `-${line.baseQuantity}`;
}

function adjustmentSourceLabel(adjustment: InventoryAdjustment): string {
  if (adjustment.correctionOfAdjustmentId) return 'Phiếu điều chỉnh trước';
  if (adjustment.documentKind === 'MANUAL_ADJUSTMENT') return 'Điều chỉnh thủ công';
  return adjustmentKindLabels[adjustment.documentKind];
}

function workflowHint(adjustment: InventoryAdjustment): string {
  if (adjustment.status === 'DRAFT') return 'Phiếu đang được lập. Kiểm tra số lượng và lý do rồi chọn Gửi duyệt.';
  if (adjustment.status === 'SUBMITTED') return 'Phiếu đang chờ người có quyền duyệt.';
  if (adjustment.status === 'APPROVED') return 'Tồn kho chưa thay đổi. Chọn Cập nhật tồn kho để hoàn tất.';
  if (adjustment.status === 'POSTED') return 'Hoàn tất. Tồn kho đã được cập nhật theo phiếu đã duyệt.';
  if (adjustment.status === 'REVERSED') return 'Phần cập nhật tồn kho của phiếu này đã được hoàn tác.';
  return 'Phiếu đã hủy và không làm thay đổi tồn kho.';
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(inventoryWorkflowErrorMessage(payload?.error));
  }
  return payload.data as T;
}

export default function InventoryAdjustmentWorkspace({
  initialAdjustments,
  reasons,
  balances,
  warehouses,
  locations,
  initialError,
  initialTab,
  initialAdjustmentId,
  createdSummary,
}: Props) {
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [selected, setSelected] = useState<InventoryAdjustment | null>(null);
  const [activeTab, setActiveTab] = useState<InventoryAdjustmentTab>(initialTab);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState<string | null>(createdSummary
    ? `Đã lập ${createdSummary}. Đang mở phiếu vừa lập để kiểm tra và Gửi duyệt.`
    : null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const detailRequest = useRef(0);

  const sourceBalances = useMemo(
    () => balances.filter((item) => item.location_id && (!draft.warehouseId || item.warehouse_id === draft.warehouseId)),
    [balances, draft.warehouseId],
  );
  const selectedBalance = sourceBalances.find((item) => keyForBalance(item) === draft.sourceKey) ?? null;
  const destinationType = draft.documentKind === 'QUARANTINE_TRANSFER'
    ? 'quarantine'
    : draft.documentKind === 'DAMAGED_TRANSFER'
      ? 'damaged'
      : null;
  const destinationLocations = locations.filter(
    (item) => item.warehouse_id === draft.warehouseId && item.location_type === destinationType,
  );
  const availableReasons = reasons.filter(
    (reason) => reason.documentKind === draft.documentKind
      && (reason.adjustmentDirection ?? null) === (draft.documentKind === 'MANUAL_ADJUSTMENT' ? draft.adjustmentDirection : null),
  );

  function stableKey(signature: string): string {
    const current = idempotencyKeys.current.get(signature);
    if (current) return current;
    const next = createIdempotencyKey('inventory-adjustment');
    idempotencyKeys.current.set(signature, next);
    return next;
  }

  function clearKey(signature: string) {
    idempotencyKeys.current.delete(signature);
  }

  async function refresh(nextStatus = statusFilter, nextKind = kindFilter) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextStatus) params.set('status', nextStatus);
      if (nextKind) params.set('documentKind', nextKind);
      const data = await requestJson<InventoryAdjustment[]>(
        `/api/inventory/adjustments${params.toString() ? `?${params}` : ''}`,
      );
      setAdjustments(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải lại được danh sách');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string, preserveMessage = false) {
    const requestSequence = detailRequest.current + 1;
    detailRequest.current = requestSequence;
    setBusy(true);
    setError(null);
    if (!preserveMessage) setMessage(null);
    setActionReason('');
    try {
      const next = await requestJson<InventoryAdjustment>(`/api/inventory/adjustments/${id}`);
      if (detailRequest.current === requestSequence) setSelected(next);
    } catch (cause) {
      if (detailRequest.current === requestSequence) {
        setError(cause instanceof Error ? cause.message : 'Không tải được chi tiết phiếu');
      }
    } finally {
      if (detailRequest.current === requestSequence) setBusy(false);
    }
  }

  useEffect(() => {
    setActiveTab(initialTab);
    if (!initialAdjustmentId) return;
    setActiveTab('documents');
    void openDetail(initialAdjustmentId, true);
  }, [initialAdjustmentId, initialTab]);

  async function createDocument() {
    if (!selectedBalance || !draft.reasonCode || !draft.reasonNote.trim() || !draft.quantity.trim()) {
      setError('Chọn đủ kho, sản phẩm/lô/vị trí, lý do và số lượng.');
      return;
    }
    if (destinationType && !draft.destinationLocationId) {
      setError(`Chọn vị trí ${destinationType === 'quarantine' ? 'cách ly' : 'hư hỏng'} trước khi lập phiếu.`);
      return;
    }
    const signature = JSON.stringify(draft);
    setBusy(true);
    setError(null);
    setMessage(null);
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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': stableKey(`create:${signature}`),
        },
        body: JSON.stringify(body),
      });
      clearKey(`create:${signature}`);
      setAdjustments((items) => [created, ...items]);
      setSelected(created);
      setActiveTab('documents');
      window.history.replaceState(null, '', '/inventory/adjustments');
      setDraft(emptyDraft);
      setMessage(`Đã lập ${created.adjustmentNumber}. Kiểm tra lại phiếu rồi chọn Gửi duyệt.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được phiếu');
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: 'submit' | 'approve' | 'post' | 'cancel' | 'reverse') {
    if (!selected) return;
    let extra: Record<string, string> = {};
    if (action === 'cancel' || action === 'reverse') {
      if (!actionReason.trim()) {
        setError(action === 'cancel' ? 'Nhập lý do hủy phiếu.' : 'Nhập lý do hoàn tác phiếu.');
        return;
      }
      extra = { reason: actionReason.trim() };
    }
    const signature = `${selected.id}:${action}:${selected.revision}:${JSON.stringify(extra)}`;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await requestJson<InventoryAdjustment>(`/api/inventory/adjustments/${selected.id}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': stableKey(signature),
        },
        body: JSON.stringify({ expectedRevision: selected.revision, ...extra }),
      });
      clearKey(signature);
      setSelected(updated);
      setAdjustments((items) => items.map((item) => item.id === updated.id ? updated : item));
      setActionReason('');
      setMessage({
        submit: 'Đã gửi phiếu chờ duyệt.',
        approve: 'Đã duyệt phiếu. Tồn kho chưa thay đổi. Chọn Cập nhật tồn kho để hoàn tất.',
        post: 'Đã cập nhật tồn kho theo phiếu đã duyệt.',
        cancel: 'Đã hủy phiếu. Tồn kho không thay đổi.',
        reverse: 'Đã hoàn tác phần cập nhật tồn kho của phiếu.',
      }[action]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không cập nhật được phiếu');
    } finally {
      setBusy(false);
    }
  }

  const actions = activeTab === 'documents' ? (
    <div className={styles.headerActions} data-testid="inventory-adjustment-page-actions">
      <button className={styles.secondaryButton} type="button" onClick={() => refresh()} disabled={busy}>Làm mới</button>
    </div>
  ) : undefined;

  return (
    <AppShell
      title="Điều chỉnh tồn"
      kicker="Tồn kho & lô hàng"
      subtitle="Quản lý phiếu điều chỉnh, lập điều chỉnh thủ công hoặc nhập hàng loạt trong cùng một nơi. Tồn kho chỉ thay đổi ở bước Cập nhật tồn kho."
      actions={actions}
    >
      <InventoryAdjustmentTabs active={activeTab} />
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}

      {activeTab === 'manual' ? (
        <section className={styles.panel} aria-labelledby="create-adjustment-title">
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Điều chỉnh thủ công</p>
              <h2 id="create-adjustment-title">Lập phiếu điều chỉnh thủ công</h2>
              <p>Chủ động tăng, giảm hoặc xử lý tồn có lý do. Đây không phải phiếu kiểm kê.</p>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label>
              Loại phiếu
              <select
                value={draft.documentKind}
                onChange={(event) => setDraft({
                  ...draft,
                  documentKind: event.target.value as AdjustmentKind,
                  reasonCode: '',
                  destinationLocationId: '',
                })}
              >
                {Object.entries(adjustmentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {draft.documentKind === 'MANUAL_ADJUSTMENT' ? (
              <label>
                Điều chỉnh
                <select
                  value={draft.adjustmentDirection}
                  onChange={(event) => setDraft({
                    ...draft,
                    adjustmentDirection: event.target.value as 'IN' | 'OUT',
                    reasonCode: '',
                  })}
                >
                  <option value="IN">Tăng tồn</option>
                  <option value="OUT">Giảm tồn</option>
                </select>
              </label>
            ) : null}
            <label>
              Kho
              <select
                value={draft.warehouseId}
                onChange={(event) => setDraft({
                  ...draft,
                  warehouseId: event.target.value,
                  sourceKey: '',
                  destinationLocationId: '',
                })}
              >
                <option value="">Chọn kho</option>
                {warehouses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </select>
            </label>
            <label>
              Sản phẩm / Lô / Vị trí
              <select value={draft.sourceKey} onChange={(event) => setDraft({ ...draft, sourceKey: event.target.value })}>
                <option value="">Chọn dòng tồn cần xử lý</option>
                {sourceBalances.map((item) => (
                  <option key={keyForBalance(item)} value={keyForBalance(item)}>
                    {item.product_name || item.base_variant_name || item.base_sku} · {item.base_sku} · Lô {item.lot_code || 'Không lô'} · Vị trí {item.location_code || 'Không vị trí'} · Tồn hiện tại {formatQuantity(item.on_hand_quantity)} · Có thể xử lý {formatQuantity(item.available_quantity)}
                  </option>
                ))}
              </select>
            </label>
            {destinationType ? (
              <label>
                Vị trí nhận
                <select
                  value={draft.destinationLocationId}
                  onChange={(event) => setDraft({ ...draft, destinationLocationId: event.target.value })}
                >
                  <option value="">Chọn vị trí {destinationType === 'quarantine' ? 'cách ly' : 'hư hỏng'}</option>
                  {destinationLocations.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              Số lượng điều chỉnh
              <input
                inputMode="decimal"
                value={draft.quantity}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              Lý do
              <select value={draft.reasonCode} onChange={(event) => setDraft({ ...draft, reasonCode: event.target.value })}>
                <option value="">Chọn lý do</option>
                {availableReasons.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>
            <label className={styles.fullWidth}>
              Diễn giải
              <textarea value={draft.reasonNote} onChange={(event) => setDraft({ ...draft, reasonNote: event.target.value })} rows={3} />
            </label>
          </div>
          {selectedBalance ? (
            <p>
              <strong>Nguồn: </strong>{draft.documentKind === 'MANUAL_ADJUSTMENT' ? 'Điều chỉnh thủ công' : adjustmentKindLabels[draft.documentKind]}
              {' · '}Tồn hiện tại {formatQuantity(selectedBalance.on_hand_quantity)} {selectedBalance.base_unit_code || ''}
            </p>
          ) : null}
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setActiveTab('documents');
                window.history.replaceState(null, '', '/inventory/adjustments');
              }}
            >
              Đóng
            </button>
            <button type="button" className={styles.primaryButton} onClick={createDocument} disabled={busy}>Lập phiếu</button>
          </div>
        </section>
      ) : null}

      {activeTab === 'documents' ? (
        <section className={styles.panel}>
          <div className={styles.filters}>
            <label>
              Trạng thái
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  refresh(event.target.value, kindFilter);
                }}
              >
                <option value="">Tất cả</option>
                {Object.entries(adjustmentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Loại phiếu
              <select
                value={kindFilter}
                onChange={(event) => {
                  setKindFilter(event.target.value);
                  refresh(statusFilter, event.target.value);
                }}
              >
                <option value="">Tất cả</option>
                {Object.entries(adjustmentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <div className={styles.layout}>
            <div className={styles.list} aria-label="Danh sách phiếu điều chỉnh tồn">
              {adjustments.length === 0 ? <p className={styles.empty}>Chưa có phiếu phù hợp.</p> : adjustments.map((item, rowIndex) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.listItem} ${selected?.id === item.id ? styles.active : ''}`}
                  onClick={() => openDetail(item.id)}
                >
                  <strong><BusinessSequenceNumber rowIndex={rowIndex} /> {item.adjustmentNumber}</strong>
                  <span>{adjustmentKindLabels[item.documentKind]}</span>
                  <small>{item.warehouseCode ?? item.warehouseName ?? 'Kho'} · {adjustmentStatusLabels[item.status]} · {formatDate(item.createdAt)}</small>
                </button>
              ))}
            </div>

            <div className={styles.detail}>
              {!selected ? <p className={styles.empty}>Chọn một phiếu để xem nguồn, số lượng và bước cần làm tiếp theo.</p> : (
                <>
                  <div className={styles.sectionHeader}>
                    <div>
                      <p className={styles.eyebrow}>{adjustmentStatusLabels[selected.status]}</p>
                      <h2>{selected.adjustmentNumber}</h2>
                      <p>{adjustmentKindLabels[selected.documentKind]} · {selected.reasonLabel ?? selected.reasonCode}</p>
                    </div>
                    <div className={styles.actionRow} data-testid="inventory-adjustment-document-actions">
                      {selected.status === 'DRAFT' ? (
                        <>
                          <button className={styles.secondaryButton} onClick={() => transition('cancel')} disabled={busy}>Hủy</button>
                          <button className={styles.primaryButton} onClick={() => transition('submit')} disabled={busy}>Gửi duyệt</button>
                        </>
                      ) : null}
                      {selected.status === 'SUBMITTED' ? (
                        <>
                          <button className={styles.secondaryButton} onClick={() => transition('cancel')} disabled={busy}>Hủy</button>
                          <button className={styles.primaryButton} onClick={() => transition('approve')} disabled={busy}>Duyệt</button>
                        </>
                      ) : null}
                      {selected.status === 'APPROVED' ? (
                        <>
                          <button className={styles.secondaryButton} onClick={() => transition('cancel')} disabled={busy}>Hủy</button>
                          <button className={styles.primaryButton} onClick={() => transition('post')} disabled={busy}>Cập nhật tồn kho</button>
                        </>
                      ) : null}
                      {selected.status === 'POSTED' ? (
                        <button className={styles.dangerButton} onClick={() => transition('reverse')} disabled={busy}>Hoàn tác phiếu</button>
                      ) : null}
                    </div>
                  </div>

                  <p>{workflowHint(selected)}</p>
                  <dl className={styles.meta}>
                    <div><dt>Kho</dt><dd>{selected.warehouseCode} — {selected.warehouseName}</dd></div>
                    <div><dt>Nguồn</dt><dd>{adjustmentSourceLabel(selected)}</dd></div>
                    <div><dt>Người lập</dt><dd>{officeActorLabel(selected.createdBy, 'Người lập')}</dd></div>
                    <div>
                      <dt>Người gửi</dt>
                      <dd>{officeActorLabel(selected.submittedBy, 'Người gửi')}{selected.submittedAt ? ` · ${formatDate(selected.submittedAt)}` : ''}</dd>
                    </div>
                    <div>
                      <dt>Người duyệt</dt>
                      <dd>{officeActorLabel(selected.approvedBy, 'Người duyệt')}{selected.approvedAt ? ` · ${formatDate(selected.approvedAt)}` : ''}</dd>
                    </div>
                    <div>
                      <dt>Cập nhật tồn kho</dt>
                      <dd>{selected.postedAt ? `Đã hoàn tất · ${formatDate(selected.postedAt)}` : selected.status === 'APPROVED' ? 'Chưa cập nhật' : 'Chưa đến bước cập nhật tồn'}</dd>
                    </div>
                  </dl>

                  <p className={styles.note}>{selected.reasonNote}</p>

                  {(selected.status === 'DRAFT'
                    || selected.status === 'SUBMITTED'
                    || selected.status === 'APPROVED'
                    || selected.status === 'POSTED') ? (
                      <label className={styles.fullWidth}>
                        Lý do hủy hoặc hoàn tác
                        <textarea
                          value={actionReason}
                          onChange={(event) => setActionReason(event.target.value)}
                          rows={2}
                          placeholder="Chỉ nhập khi hủy hoặc hoàn tác phiếu"
                        />
                      </label>
                    ) : null}

                  <div className={styles.lines}>
                    {selected.lines?.map((line, rowIndex) => {
                      const balance = balances.find((item) => balanceMatchesLine(item, line)) ?? null;
                      const delta = sourceDelta(selected, line);
                      const loadedOnHand = balance?.on_hand_quantity ?? null;
                      const canPreviewResult = ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(selected.status);
                      const after = canPreviewResult && loadedOnHand !== null
                        ? addExactDecimal(loadedOnHand, delta)
                        : null;
                      const productName = balance?.product_name || balance?.base_variant_name || line.sourceSku;
                      return (
                        <article key={line.id} className={styles.lineCard}>
                          <strong><BusinessSequenceNumber rowIndex={rowIndex} /> {productName}</strong>
                          <span>Sản phẩm: {line.sourceSku}</span>
                          <span>Lô: {line.lotCode || 'Không lô'}</span>
                          <span>Vị trí: {line.sourceLocationCode || 'Không vị trí'}{line.sourceLocationName ? ` · ${line.sourceLocationName}` : ''}</span>
                          {line.destinationLocationCode ? <span>Vị trí nhận: {line.destinationLocationCode}{line.destinationLocationName ? ` · ${line.destinationLocationName}` : ''}</span> : null}
                          {canPreviewResult ? (
                            <span>
                              Tồn hiện tại {loadedOnHand === null ? 'Chưa tải được' : formatQuantity(loadedOnHand)}
                              {' → '}Điều chỉnh {formatSignedExactDecimal(delta)}
                              {' → '}Tồn sau điều chỉnh {after === null ? 'Chưa tải được' : formatQuantity(after)}
                            </span>
                          ) : (
                            <span>
                              Điều chỉnh {formatSignedExactDecimal(delta)}
                              {' · '}{selected.status === 'POSTED' ? 'Tồn kho đã cập nhật' : selected.status === 'REVERSED' ? 'Đã hoàn tác cập nhật tồn' : 'Không làm thay đổi tồn kho'}
                            </span>
                          )}
                          <small>Số lượng phiếu {formatQuantity(line.quantity)} {line.sourceUnitCode} · Quy đổi tồn {formatQuantity(line.baseQuantity)}</small>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
