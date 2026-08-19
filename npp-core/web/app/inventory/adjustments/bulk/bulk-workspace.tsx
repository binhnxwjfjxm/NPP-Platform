'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../../components/app-shell-core';
import { formatQuantity } from '../../../../lib/inventory-types';
import { formatSignedExactDecimal } from '../../../../lib/decimal-display.js';
import {
  MAX_BULK_INVENTORY_ADJUSTMENT_ROWS,
  bulkInventoryAdjustmentTemplateCsv,
  parseBulkInventoryAdjustmentSheet,
  type BulkInventoryAdjustmentInputRow,
} from '../../../../lib/inventory-adjustment-bulk-entry.js';
import { readSpreadsheetRows } from '../../../../lib/spreadsheet-reader';
import type { AdjustmentReason, InventoryAdjustment } from '../../../../lib/inventory-adjustment-types';
import type { Warehouse } from '../../../../lib/organization-types';
import fileStyles from '../../opening-balances/opening-balance-csv-workspace.module.css';
import { InventoryAdjustmentTabs } from '../adjustment-tabs';
import styles from '../workspace.module.css';

type Props = {
  reasons: AdjustmentReason[];
  warehouses: Warehouse[];
  initialError: string | null;
};

type PreviewError = { code: string; message: string };
type ScopeOption = {
  locationCode: string;
  locationName: string | null;
  lotCode: string | null;
};
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
  lotTrackingMode: string;
  lotRequired: boolean;
  scopeRequired: boolean;
  requiresLocationSelection: boolean;
  requiresLotSelection: boolean;
  locationAutoFilled: boolean;
  lotAutoFilled: boolean;
  scopeOptions: ScopeOption[];
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

type ScopeField = 'locationCode' | 'lotCode';

const DISPLAY_ROW_LIMIT = 100;
const DISPLAY_ERROR_LIMIT = 20;

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

function sameCode(left: string | null | undefined, right: string | null | undefined) {
  return String(left ?? '').trim().toUpperCase() === String(right ?? '').trim().toUpperCase();
}

function lotChoices(options: ScopeOption[], locationCode: string) {
  const seen = new Set<string>();
  const choices: string[] = [];
  for (const option of options) {
    if (locationCode && !sameCode(option.locationCode, locationCode)) continue;
    const code = String(option.lotCode ?? '').trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    choices.push(code);
  }
  return choices;
}

function locationChoices(options: ScopeOption[], lotCode: string) {
  const seen = new Set<string>();
  const choices: Array<{ code: string; name: string | null }> = [];
  for (const option of options) {
    if (lotCode && !sameCode(option.lotCode, lotCode)) continue;
    const code = String(option.locationCode ?? '').trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    choices.push({ code, name: option.locationName ?? null });
  }
  return choices;
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
  const [warehouseId, setWarehouseId] = useState(() => activeWarehouses.length === 1 ? activeWarehouses[0].id : '');
  const [rows, setRows] = useState<BulkInventoryAdjustmentInputRow[]>([]);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [increaseReasonCode, setIncreaseReasonCode] = useState('');
  const [decreaseReasonCode, setDecreaseReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState<'file' | 'preview' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [message, setMessage] = useState<string | null>(null);
  const pendingConfirm = useRef<PendingConfirm | null>(null);
  const confirmSectionRef = useRef<HTMLElement>(null);
  const inputRowsByLine = useMemo(() => new Map(rows.map((row) => [row.lineNumber, row])), [rows]);

  function invalidatePreview() {
    setPreview(null);
    setPreviewStale(false);
    setMessage(null);
    pendingConfirm.current = null;
  }

  function updateScopeValue(lineNumber: number, field: ScopeField, value: string) {
    const normalized = value.trim().toUpperCase();
    setRows((current) => current.map((row) => row.lineNumber === lineNumber
      ? { ...row, [field]: normalized }
      : row));
    setPreviewStale(true);
    setError(null);
    setMessage('Đã cập nhật Lô/Vị trí. Bấm “Kiểm tra tệp” để đối chiếu lại trước khi lập phiếu.');
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
      setPreviewStale(false);
      setIncreaseReasonCode('');
      setDecreaseReasonCode('');
      setReasonNote('');
      pendingConfirm.current = null;
      setMessage(warehouseId
        ? `Đã đọc ${parsed.length} dòng. Bấm “Kiểm tra tệp” ở bước 3 để tiếp tục. Tồn kho chưa thay đổi.`
        : `Đã đọc ${parsed.length} dòng. Chọn kho, rồi bấm “Kiểm tra tệp” ở bước 3. Tồn kho chưa thay đổi.`);
    } catch (cause) {
      setRows([]);
      setFilename('');
      setPreview(null);
      setPreviewStale(false);
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
      setPreviewStale(false);
      pendingConfirm.current = null;
      if (result.ready) {
        const changed = result.totals.increaseRowCount + result.totals.decreaseRowCount;
        setMessage(changed > 0
          ? `Đã kiểm tra toàn bộ ${result.totals.inputRowCount} dòng. Có ${changed} dòng chênh lệch; dùng bước 4 để đi tới lập phiếu.`
          : 'Tất cả dòng đang khớp tồn hệ thống. Không cần lập phiếu điều chỉnh.');
      } else {
        setMessage(`Có ${result.totals.attentionRowCount} dòng cần xử lý. Bổ sung Lô/Vị trí ngay tại Xem trước nếu được yêu cầu, rồi kiểm tra lại. Tồn kho chưa thay đổi.`);
      }
    } catch (cause) {
      setPreview(null);
      setPreviewStale(false);
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được dữ liệu.');
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (previewStale) return setError('Lô/Vị trí vừa thay đổi. Hãy bấm “Kiểm tra tệp” trước khi lập phiếu.');
    if (!preview?.ready) return setError('Hãy kiểm tra tệp và xử lý hết các dòng cần chú ý trước khi lập phiếu.');
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
      setPreviewStale(false);
      const numbers = result.adjustments.map((item) => item.adjustmentNumber).join(', ');
      const firstCreated = result.adjustments[0];
      if (firstCreated) {
        const targetParams = new URLSearchParams({
          adjustment: firstCreated.id,
          created: numbers,
        });
        window.location.assign(`/inventory/adjustments?${targetParams.toString()}`);
        return;
      }
      setMessage('Không có phiếu mới cần lập vì dữ liệu không còn chênh lệch.');
    } catch (cause) {
      setPreview(null);
      setPreviewStale(false);
      setError(cause instanceof Error ? cause.message : 'Không lập được phiếu điều chỉnh. Hãy kiểm tra tệp lại.');
    } finally {
      setBusy(null);
    }
  }

  const hasChanges = Boolean(preview && (preview.totals.increaseRowCount + preview.totals.decreaseRowCount > 0));
  const confirmDisabled = busy !== null
    || previewStale
    || !preview?.ready
    || !hasChanges
    || (preview.totals.increaseRowCount > 0 && !increaseReasonCode)
    || (preview.totals.decreaseRowCount > 0 && !decreaseReasonCode)
    || !reasonNote.trim();
  const displayCount = preview ? Math.min(preview.rows.length, DISPLAY_ROW_LIMIT) : Math.min(rows.length, DISPLAY_ROW_LIMIT);
  const totalCount = preview?.rows.length ?? rows.length;

  function goToConfirm() {
    if (previewStale || !preview?.ready || !hasChanges) return;
    confirmSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <AppShell
      title="Điều chỉnh tồn"
      kicker="Tồn kho & lô hàng"
      subtitle="Quản lý phiếu điều chỉnh, lập điều chỉnh thủ công hoặc nhập hàng loạt trong cùng một nơi. Tồn kho chỉ thay đổi ở bước Cập nhật tồn kho."
    >
      <InventoryAdjustmentTabs active="bulk" />
      <main className={fileStyles.page} data-testid="bulk-inventory-adjustment-page">
        {error ? <div className={fileStyles.error} role="alert">{error}</div> : null}
        {message ? <div className={fileStyles.success} role="status">{message}</div> : null}

        <section className={fileStyles.steps} aria-label="Các bước điều chỉnh tồn hàng loạt">
          <article>
            <strong>1</strong><span>Tải tệp mẫu</span>
            <button type="button" onClick={downloadTemplate}>Tải mẫu Excel/CSV</button>
          </article>
          <article>
            <strong>2</strong><span>Chọn tệp đã điền</span>
            <label>{filename ? 'Chọn tệp khác' : 'Chọn tệp'}
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(event) => void loadFile(event.target.files?.[0] ?? null)}
                disabled={busy !== null}
                data-testid="bulk-adjustment-file-input"
              />
            </label>
          </article>
          <article>
            <strong>3</strong><span>Kiểm tra dữ liệu</span>
            <button type="button" onClick={() => void checkPreview()} disabled={busy !== null || !warehouseId || rows.length === 0}>
              {busy === 'preview' ? 'Đang kiểm tra…' : 'Kiểm tra tệp'}
            </button>
          </article>
          <article>
            <strong>4</strong><span>Lập phiếu</span>
            <button type="button" onClick={goToConfirm} disabled={busy !== null || previewStale || !preview?.ready || !hasChanges}>
              Đi tới lập phiếu
            </button>
          </article>
        </section>

        <section className={fileStyles.card} aria-labelledby="bulk-adjustment-info-title">
          <h2 id="bulk-adjustment-info-title">Thông tin điều chỉnh hàng loạt</h2>
          <div className={fileStyles.formGrid}>
            <label>
              <span>Kho *</span>
              <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); invalidatePreview(); }}>
                <option value="">Chọn kho</option>
                {activeWarehouses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
              </select>
            </label>
            <label>
              <span>Tệp đã chọn</span>
              <input value={filename || 'Chưa chọn tệp'} readOnly />
            </label>
            <label>
              <span>Số dòng</span>
              <input value={rows.length ? `${rows.length} dòng` : 'Chưa có dữ liệu'} readOnly />
            </label>
          </div>
          <p className={fileStyles.helper}>
            Tệp tối thiểu chỉ cần <strong>SKU</strong> và <strong>Tồn thực tế</strong>. <strong>Lô</strong> chỉ bắt buộc với hàng quản lý lô; <strong>Vị trí</strong> chỉ bắt buộc khi cần xác định chính xác dòng tồn. Nếu chỉ có một lựa chọn hợp lệ, hệ thống tự điền tại Xem trước. Mỗi lần xử lý tối đa {MAX_BULK_INVENTORY_ADJUSTMENT_ROWS} dòng.
          </p>
        </section>

        <section className={fileStyles.card} aria-labelledby="bulk-adjustment-preview-title">
          <div className={fileStyles.cardHeader}>
            <div>
              <h2 id="bulk-adjustment-preview-title">Xem trước dữ liệu</h2>
              <p>{rows.length ? `${rows.length} dòng trong ${filename}` : 'Chưa có dữ liệu để xem trước.'}</p>
            </div>
            {preview
              ? <span className={previewStale || !preview.ready ? fileStyles.badgeError : fileStyles.badgeOk}>
                  {previewStale ? 'Cần kiểm tra lại' : preview.ready ? 'Đã kiểm tra' : `${preview.totals.attentionRowCount} dòng cần xử lý`}
                </span>
              : rows.length ? <span className={fileStyles.badgeOk}>Sẵn sàng kiểm tra</span> : null}
          </div>

          <div className={fileStyles.tableWrap}>
            {!preview ? (
              <table data-testid="bulk-adjustment-import-table">
                <thead><tr><th>Dòng</th><th>SKU</th><th>Tồn thực tế</th><th>Vị trí</th><th>Lô</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={6} className={fileStyles.empty}>Chọn tệp để hiển thị dữ liệu.</td></tr> : rows.slice(0, DISPLAY_ROW_LIMIT).map((row) => (
                    <tr key={`${row.lineNumber}-${row.sku}-${row.locationCode}-${row.lotCode}`}>
                      <td>{row.lineNumber}</td>
                      <td>{row.sku || '—'}</td>
                      <td>{row.actualQuantity || '—'}</td>
                      <td>{row.locationCode || '—'}</td>
                      <td>{row.lotCode || '—'}</td>
                      <td><span className={fileStyles.badgeOk}>Chờ kiểm tra</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table data-testid="bulk-adjustment-preview-table">
                <thead><tr><th>Dòng</th><th>SKU</th><th>Tên hàng</th><th>Vị trí *</th><th>Lô *</th><th>Tồn hệ thống</th><th>Tồn thực tế</th><th>Chênh lệch</th><th>Kết quả</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {preview.rows.slice(0, DISPLAY_ROW_LIMIT).map((row) => {
                    const inputRow = inputRowsByLine.get(row.lineNumber);
                    const locationValue = String(inputRow?.locationCode || row.locationCode || '').trim().toUpperCase();
                    const lotValue = String(inputRow?.lotCode || row.lotCode || '').trim().toUpperCase();
                    const availableLots = lotChoices(row.scopeOptions, locationValue);
                    const availableLocations = locationChoices(row.scopeOptions, lotValue);
                    return (
                      <tr key={`${row.lineNumber}-${row.sku}`}>
                        <td>{row.lineNumber}</td>
                        <td><strong>{row.sku || '—'}</strong>{row.productCode ? <div className={fileStyles.policyHint}>{row.productCode}</div> : null}</td>
                        <td>{row.productName || 'Chưa xác định sản phẩm'}</td>
                        <td>
                          {row.scopeRequired || locationValue ? (
                            availableLocations.length > 0 ? (
                              <>
                                <select
                                  aria-label={`Vị trí dòng ${row.lineNumber}`}
                                  value={locationValue}
                                  onChange={(event) => updateScopeValue(row.lineNumber, 'locationCode', event.target.value)}
                                >
                                  <option value="">Chọn vị trí</option>
                                  {availableLocations.map((item) => (
                                    <option key={item.code} value={item.code}>{item.code}{item.name ? ` — ${item.name}` : ''}</option>
                                  ))}
                                </select>
                                {row.locationAutoFilled && !inputRow?.locationCode ? <div className={fileStyles.policyHint}>Tự điền vì chỉ có một vị trí hợp lệ</div> : null}
                              </>
                            ) : (
                              <input
                                aria-label={`Vị trí dòng ${row.lineNumber}`}
                                value={locationValue}
                                placeholder="Nhập vị trí"
                                onChange={(event) => updateScopeValue(row.lineNumber, 'locationCode', event.target.value)}
                              />
                            )
                          ) : 'Không cần'}
                        </td>
                        <td>
                          {row.lotRequired ? (
                            availableLots.length > 0 ? (
                              <>
                                <select
                                  aria-label={`Lô dòng ${row.lineNumber}`}
                                  value={lotValue}
                                  onChange={(event) => updateScopeValue(row.lineNumber, 'lotCode', event.target.value)}
                                >
                                  <option value="">Chọn lô</option>
                                  {availableLots.map((code) => <option key={code} value={code}>{code}</option>)}
                                </select>
                                {row.lotAutoFilled && !inputRow?.lotCode ? <div className={fileStyles.policyHint}>Tự điền vì chỉ có một lô hợp lệ</div> : null}
                              </>
                            ) : (
                              <input
                                aria-label={`Lô dòng ${row.lineNumber}`}
                                value={lotValue}
                                placeholder="Nhập lô"
                                onChange={(event) => updateScopeValue(row.lineNumber, 'lotCode', event.target.value)}
                              />
                            )
                          ) : lotValue || 'Không yêu cầu'}
                        </td>
                        <td>{row.currentBaseQuantity === null ? 'Chưa xác định' : `${formatQuantity(row.currentBaseQuantity)} ${row.baseUnitCode || ''}`}</td>
                        <td>
                          {formatQuantity(row.enteredQuantity)} {row.enteredUnitCode || ''}
                          {row.enteredUnitCode && row.baseUnitCode && row.enteredUnitCode !== row.baseUnitCode && row.actualBaseQuantity !== null
                            ? <div className={fileStyles.policyHint}>= {formatQuantity(row.actualBaseQuantity)} {row.baseUnitCode}</div>
                            : null}
                        </td>
                        <td>{row.deltaBaseQuantity === null ? 'Chưa xác định' : `${formatSignedExactDecimal(row.deltaBaseQuantity)} ${row.baseUnitCode || ''}`}</td>
                        <td>{directionLabel(row.direction)}</td>
                        <td>{previewStale
                          ? <span className={fileStyles.rowError}>Cần kiểm tra lại</span>
                          : row.status === 'READY'
                            ? <span className={fileStyles.badgeOk}>Sẵn sàng</span>
                            : <span className={fileStyles.rowError}>{row.errors[0]?.message || 'Cần xử lý'}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {preview ? <p className={fileStyles.helper}>* Lô chỉ bắt buộc với hàng quản lý lô. Vị trí chỉ bắt buộc khi dòng điều chỉnh cần một phạm vi tồn chính xác.</p> : null}
          {totalCount > DISPLAY_ROW_LIMIT ? (
            <p className={fileStyles.helper}>Đang hiển thị {displayCount}/{totalCount} dòng để màn hình gọn. Hệ thống vẫn kiểm tra toàn bộ {totalCount} dòng trong tệp.</p>
          ) : null}
        </section>

        <section className={fileStyles.gridTwo} aria-label="Kết quả kiểm tra điều chỉnh tồn">
          <article className={fileStyles.card}>
            <h2>Kết quả kiểm tra</h2>
            {!preview ? <p className={fileStyles.empty}>Bấm “Kiểm tra tệp” ở bước 3 để đối chiếu với tồn hệ thống.</p> : (
              <div className={fileStyles.summary}>
                <strong>{preview.totals.readyRowCount}/{preview.totals.inputRowCount} dòng sẵn sàng</strong>
                <span>Tăng tồn: {preview.totals.increaseRowCount} dòng</span>
                <span>Giảm tồn: {preview.totals.decreaseRowCount} dòng</span>
                <span>Không chênh lệch: {preview.totals.unchangedRowCount} dòng</span>
                <span>Cần xử lý: {preview.totals.attentionRowCount} dòng</span>
              </div>
            )}
          </article>
          <article className={fileStyles.card}>
            <h2>Các dòng cần xử lý</h2>
            {!preview ? <p className={fileStyles.empty}>Chưa có kết quả kiểm tra.</p> : preview.rowErrors.length === 0 ? (
              <p className={fileStyles.empty}>Không có dòng lỗi.</p>
            ) : (
              <>
                <ul className={fileStyles.errorList}>
                  {preview.rowErrors.slice(0, DISPLAY_ERROR_LIMIT).map((item, index) => <li key={`${item.lineNumber}-${item.code}-${index}`}>{item.message}</li>)}
                </ul>
                {preview.rowErrors.length > DISPLAY_ERROR_LIMIT ? <p className={fileStyles.helper}>Còn {preview.rowErrors.length - DISPLAY_ERROR_LIMIT} lỗi khác trong kết quả kiểm tra.</p> : null}
              </>
            )}
          </article>
        </section>

        {preview?.ready && !previewStale && hasChanges ? (
          <section ref={confirmSectionRef} className={fileStyles.card} aria-labelledby="bulk-adjustment-confirm-title">
            <div className={fileStyles.cardHeader}>
              <div>
                <h2 id="bulk-adjustment-confirm-title">Lập phiếu Điều chỉnh tồn</h2>
                <p>Hệ thống đọc lại tồn hiện tại trước khi lập phiếu. Nếu tệp có cả tăng và giảm, hệ thống lập riêng phiếu Tăng và phiếu Giảm.</p>
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
            <p className={fileStyles.helper}>Sau khi lập phiếu, hệ thống chuyển sang tab Phiếu điều chỉnh và mở phiếu vừa tạo. Tồn kho vẫn chưa thay đổi; tiếp tục Gửi duyệt → Duyệt → Cập nhật tồn kho.</p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryButton} onClick={() => void confirm()} disabled={confirmDisabled}>
                {busy === 'confirm' ? 'Đang lập phiếu…' : 'Lập phiếu điều chỉnh'}
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
