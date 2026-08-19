'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../../components/app-shell-core';
import { formatQuantity } from '../../../../lib/inventory-types';
import { formatSignedExactDecimal } from '../../../../lib/decimal-display.js';
import {
  bulkInventoryAdjustmentTemplateCsv,
  parseBulkInventoryAdjustmentSheet,
  type BulkInventoryAdjustmentInputRow,
} from '../../../../lib/inventory-adjustment-bulk-entry.js';
import { readSpreadsheetRows } from '../../../../lib/spreadsheet-reader';
import type { AdjustmentReason, InventoryAdjustment } from '../../../../lib/inventory-adjustment-types';
import type { Warehouse } from '../../../../lib/organization-types';
import styles from '../workspace.module.css';

type Props = {
  reasons: AdjustmentReason[];
  warehouses: Warehouse[];
  initialError: string | null;
};

type PreviewError = { code: string; message: string };
type PreviewRow = {
  lineNumber: number;
  sku: string;
  productCode: string | null;
  productName: string | null;
  enteredQuantity: string;
  enteredUnitCode: string | null;
  actualBaseQuantity: string | null;
  baseUnitCode: string | null;
  currentBaseQuantity: string | null;
  deltaBaseQuantity: string | null;
  signedDeltaBaseQuantity: string | null;
  direction: 'IN' | 'OUT' | 'NONE';
  locationCode: string | null;
  locationName: string | null;
  lotCode: string | null;
  status: 'READY' | 'NEEDS_ATTENTION';
  errors: PreviewError[];
};
type PreviewResult = {
  ready: boolean;
  stockUnchanged: boolean;
  rows: PreviewRow[];
  rowErrors: Array<PreviewError & { lineNumber: number }>;
  totals: {
    inputRowCount: number;
    readyRowCount: number;
    attentionRowCount: number;
    increaseRowCount: number;
    decreaseRowCount: number;
    unchangedRowCount: number;
  };
};
type ConfirmResult = { adjustments: InventoryAdjustment[]; preview: PreviewResult };
type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };
type PendingConfirm = { signature: string; key: string };

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
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu điều chỉnh tồn hàng loạt.');
  }
  return payload.data;
}

function downloadTemplate() {
  const blob = new Blob([bulkInventoryAdjustmentTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mau-dieu-chinh-ton-hang-loat.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function directionLabel(direction: PreviewRow['direction']) {
  if (direction === 'IN') return 'Tăng tồn';
  if (direction === 'OUT') return 'Giảm tồn';
  return 'Không chênh lệch';
}

export default function BulkInventoryAdjustmentWorkspace({ reasons, warehouses, initialError }: Props) {
  const activeWarehouses = useMemo(() => warehouses.filter((item) => item.is_active), [warehouses]);
  const increaseReasons = useMemo(
    () => reasons.filter((reason) => reason.documentKind === 'MANUAL_ADJUSTMENT' && reason.adjustmentDirection === 'IN'),
    [reasons],
  );
  const decreaseReasons = useMemo(
    () => reasons.filter((reason) => reason.documentKind === 'MANUAL_ADJUSTMENT' && reason.adjustmentDirection === 'OUT'),
    [reasons],
  );
  const [warehouseId, setWarehouseId] = useState('');
  const [rows, setRows] = useState<BulkInventoryAdjustmentInputRow[]>([]);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [increaseReasonCode, setIncreaseReasonCode] = useState('');
  const [decreaseReasonCode, setDecreaseReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState<'file' | 'preview' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [message, setMessage] = useState<string | null>(null);
  const pendingConfirm = useRef<PendingConfirm | null>(null);

  function invalidatePreview() {
    setPreview(null);
    setMessage(null);
    pendingConfirm.current = null;
  }

  async function loadFile(file: File | null) {
    if (!file) return;
    setBusy('file');
    setError(null);
    setMessage(null);
    try {
      const sheet = await readSpreadsheetRows(file);
      const parsed = parseBulkInventoryAdjustmentSheet(sheet);
      setRows(parsed);
      setFilename(file.name);
      setPreview(null);
      pendingConfirm.current = null;
      setMessage(`Đã đọc ${parsed.length} dòng. Chọn kho rồi bấm “Kiểm tra và xem trước”. Tồn kho chưa thay đổi.`);
    } catch (cause) {
      setRows([]);
      setFilename('');
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Không đọc được tệp đã chọn.');
    } finally {
      setBusy(null);
    }
  }

  async function checkPreview() {
    if (!warehouseId) return setError('Hãy chọn kho cần điều chỉnh.');
    if (rows.length === 0) return setError('Hãy chọn tệp có dữ liệu trước khi kiểm tra.');
    setBusy('preview');
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<PreviewResult>('/api/inventory/adjustments/bulk-preview', {
        method: 'POST',
        body: JSON.stringify({ warehouseId, rows }),
      });
      setPreview(result);
      pendingConfirm.current = null;
      if (result.ready) {
        const changed = result.totals.increaseRowCount + result.totals.decreaseRowCount;
        setMessage(changed > 0
          ? `Đã kiểm tra ${result.totals.inputRowCount} dòng. Có ${changed} dòng chênh lệch; tồn kho vẫn chưa thay đổi.`
          : 'Tất cả dòng đang khớp tồn hệ thống. Không cần lập phiếu điều chỉnh.');
      } else {
        setMessage(`Có ${result.totals.attentionRowCount} dòng cần xử lý trước khi lập phiếu. Tồn kho chưa thay đổi.`);
      }
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được dữ liệu.');
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview?.ready) return setError('Hãy kiểm tra file và xử lý hết các dòng cần chú ý trước khi lập phiếu.');
    if (preview.totals.increaseRowCount > 0 && !increaseReasonCode) return setError('Hãy chọn lý do cho các dòng tăng tồn.');
    if (preview.totals.decreaseRowCount > 0 && !decreaseReasonCode) return setError('Hãy chọn lý do cho các dòng giảm tồn.');
    if (!reasonNote.trim()) return setError('Hãy nhập diễn giải cho đợt điều chỉnh tồn hàng loạt.');
    const body = {
      warehouseId,
      rows,
      increaseReasonCode: increaseReasonCode || null,
      decreaseReasonCode: decreaseReasonCode || null,
      reasonNote: reasonNote.trim(),
    };
    const signature = JSON.stringify(body);
    if (!pendingConfirm.current || pendingConfirm.current.signature !== signature) {
      pendingConfirm.current = { signature, key: createIdempotencyKey('inventory-adjustment-bulk') };
    }
    setBusy('confirm');
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<ConfirmResult>('/api/inventory/adjustments/bulk-confirm', {
        method: 'POST',
        headers: { 'Idempotency-Key': pendingConfirm.current.key },
        body: JSON.stringify(body),
      });
      pendingConfirm.current = null;
      setPreview(result.preview);
      const numbers = result.adjustments.map((item) => item.adjustmentNumber).join(', ');
      setMessage(`Đã lập ${result.adjustments.length} phiếu: ${numbers}. Tồn kho chưa thay đổi; kiểm tra phiếu rồi Gửi duyệt theo quy trình hiện tại.`);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Không lập được phiếu điều chỉnh. Hãy kiểm tra và xem trước lại.');
    } finally {
      setBusy(null);
    }
  }

  const hasChanges = Boolean(preview && (preview.totals.increaseRowCount + preview.totals.decreaseRowCount > 0));
  const confirmDisabled = busy !== null
    || !preview?.ready
    || !hasChanges
    || (preview.totals.increaseRowCount > 0 && !increaseReasonCode)
    || (preview.totals.decreaseRowCount > 0 && !decreaseReasonCode)
    || !reasonNote.trim();

  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.secondaryButton} href="/inventory/adjustments">Về Điều chỉnh tồn</Link>
      <button className={styles.secondaryButton} type="button" onClick={downloadTemplate}>Tải tệp mẫu</button>
    </div>
  );

  return (
    <AppShell
      title="Điều chỉnh tồn hàng loạt"
      kicker="Tồn kho & lô hàng"
      subtitle="Nhập Tồn thực tế từ file, kiểm tra chênh lệch rồi lập phiếu Điều chỉnh tồn chuẩn. Bước kiểm tra không làm thay đổi tồn kho."
      actions={actions}
    >
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}

      <section className={styles.panel} aria-labelledby="bulk-adjustment-input-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Bước 1</p>
            <h2 id="bulk-adjustment-input-title">Chọn file và kho</h2>
            <p>Hai cột bắt buộc: <strong>SKU</strong> và <strong>Tồn thực tế</strong>. Nếu SKU có nhiều lô hoặc vị trí, bổ sung cột <strong>Lô</strong> và <strong>Vị trí</strong>.</p>
          </div>
        </div>
        <div className={styles.formGrid}>
          <label>
            Kho
            <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); invalidatePreview(); }}>
              <option value="">Chọn kho</option>
              {activeWarehouses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
            </select>
          </label>
          <label>
            File Excel hoặc CSV
            <input
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(event) => void loadFile(event.target.files?.[0] ?? null)}
              disabled={busy !== null}
            />
          </label>
        </div>
        <p>{filename ? `Đã chọn: ${filename} · ${rows.length} dòng dữ liệu.` : 'Chưa chọn file.'}</p>
        <div className={styles.actionRow}>
          <button type="button" className={styles.primaryButton} onClick={() => void checkPreview()} disabled={busy !== null || !warehouseId || rows.length === 0}>
            {busy === 'preview' ? 'Đang kiểm tra…' : 'Kiểm tra và xem trước'}
          </button>
        </div>
      </section>

      {preview ? (
        <section className={styles.panel} aria-labelledby="bulk-adjustment-preview-title">
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Bước 2</p>
              <h2 id="bulk-adjustment-preview-title">Xem trước chênh lệch</h2>
              <p>
                Sẵn sàng {preview.totals.readyRowCount} · Cần xử lý {preview.totals.attentionRowCount}
                {' · '}Tăng {preview.totals.increaseRowCount} · Giảm {preview.totals.decreaseRowCount} · Không đổi {preview.totals.unchangedRowCount}
              </p>
            </div>
          </div>
          <div className={styles.lines}>
            {preview.rows.map((row) => (
              <article key={`${row.lineNumber}-${row.sku}`} className={styles.lineCard}>
                <strong>Dòng {row.lineNumber} · {row.sku || 'Chưa có SKU'}</strong>
                <span>{row.productName || 'Chưa xác định sản phẩm'}{row.productCode ? ` · ${row.productCode}` : ''}</span>
                <span>Lô: {row.lotCode || 'Không lô'} · Vị trí: {row.locationCode || 'Chưa xác định'}{row.locationName ? ` · ${row.locationName}` : ''}</span>
                <span>
                  Tồn hệ thống: {row.currentBaseQuantity === null ? 'Chưa xác định' : formatQuantity(row.currentBaseQuantity)} {row.baseUnitCode || ''}
                  {' · '}Tồn thực tế: {formatQuantity(row.enteredQuantity)} {row.enteredUnitCode || ''}
                  {row.enteredUnitCode && row.baseUnitCode && row.enteredUnitCode !== row.baseUnitCode && row.actualBaseQuantity !== null
                    ? ` = ${formatQuantity(row.actualBaseQuantity)} ${row.baseUnitCode}`
                    : ''}
                </span>
                <span>
                  Chênh lệch: {row.deltaBaseQuantity === null ? 'Chưa xác định' : formatSignedExactDecimal(row.deltaBaseQuantity)} {row.baseUnitCode || ''}
                  {' · '}{directionLabel(row.direction)}
                </span>
                <small>{row.status === 'READY' ? 'Sẵn sàng' : 'Cần xử lý trước khi lập phiếu'}</small>
                {row.errors.map((item) => <span key={`${row.lineNumber}-${item.code}`}>• {item.message}</span>)}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {preview?.ready && hasChanges ? (
        <section className={styles.panel} aria-labelledby="bulk-adjustment-confirm-title">
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Bước 3</p>
              <h2 id="bulk-adjustment-confirm-title">Lập phiếu Điều chỉnh tồn</h2>
              <p>Hệ thống sẽ đọc lại tồn hiện tại và tính lại chênh lệch. Nếu file có cả tăng và giảm, hệ thống lập riêng phiếu Tăng và phiếu Giảm.</p>
            </div>
          </div>
          <div className={styles.formGrid}>
            {preview.totals.increaseRowCount > 0 ? (
              <label>
                Lý do tăng tồn
                <select value={increaseReasonCode} onChange={(event) => { setIncreaseReasonCode(event.target.value); pendingConfirm.current = null; }}>
                  <option value="">Chọn lý do</option>
                  {increaseReasons.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
            ) : null}
            {preview.totals.decreaseRowCount > 0 ? (
              <label>
                Lý do giảm tồn
                <select value={decreaseReasonCode} onChange={(event) => { setDecreaseReasonCode(event.target.value); pendingConfirm.current = null; }}>
                  <option value="">Chọn lý do</option>
                  {decreaseReasons.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
            ) : null}
            <label className={styles.fullWidth}>
              Diễn giải
              <textarea value={reasonNote} onChange={(event) => { setReasonNote(event.target.value); pendingConfirm.current = null; }} rows={3} placeholder="Ví dụ: Đối chiếu tồn thực tế cuối ngày" />
            </label>
          </div>
          <p className={styles.note}>Sau khi lập phiếu, tồn kho vẫn chưa thay đổi. Người dùng tiếp tục Gửi duyệt → Duyệt → Cập nhật tồn kho như luồng Điều chỉnh tồn hiện tại.</p>
          <div className={styles.actionRow}>
            <button type="button" className={styles.primaryButton} onClick={() => void confirm()} disabled={confirmDisabled}>
              {busy === 'confirm' ? 'Đang lập phiếu…' : 'Lập phiếu điều chỉnh'}
            </button>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}