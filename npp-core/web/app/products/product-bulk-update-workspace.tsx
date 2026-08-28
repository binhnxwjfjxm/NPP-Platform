'use client';

import { useMemo, useState } from 'react';
import { readSpreadsheetMatrix } from '../../lib/spreadsheet-matrix';
import styles from './products.module.css';

type Mapping = 'SKU' | 'IGNORE' | 'WEIGHT_VALUE' | 'WEIGHT_UOM';
type PreviewChange = { field: string; label: string; oldValue: string; newValue: string };
type PreviewError = { code: string; message: string };
type PreviewRow = {
  rowNumber: number;
  sku: string;
  status: 'ready' | 'updated' | 'unchanged' | 'error';
  errors: PreviewError[];
  changes: PreviewChange[];
  cells: unknown[];
};
type PreviewResult = {
  updated: number;
  skipped: number;
  ready?: number;
  unchanged?: number;
  rows: PreviewRow[];
  operationKey?: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string; code?: string };
};

const OPTIONS: Array<{ value: Mapping; label: string }> = [
  { value: 'IGNORE', label: 'Bỏ qua' },
  { value: 'WEIGHT_VALUE', label: 'Khối lượng' },
  { value: 'WEIGHT_UOM', label: 'Đơn vị khối lượng' },
];

function mappingLabel(mapping: Mapping) {
  if (mapping === 'SKU') return 'SKU';
  return OPTIONS.find((option) => option.value === mapping)?.label ?? 'Bỏ qua';
}

function initialMappings(columnCount: number): Mapping[] {
  return Array.from({ length: columnCount }, (_value, index) => {
    if (index === 0) return 'SKU';
    if (index === 1) return 'WEIGHT_VALUE';
    if (index === 2) return 'WEIGHT_UOM';
    return 'IGNORE';
  });
}

function rowStatus(row: PreviewRow) {
  if (row.status === 'error') return 'Có lỗi — bỏ qua';
  if (row.status === 'updated') return 'Đã cập nhật';
  if (row.status === 'unchanged') return 'Không thay đổi';
  return 'Sẵn sàng';
}

function cellDisplay(row: PreviewRow, index: number) {
  if (index >= row.cells.length) return 'Không có cột';
  const value = row.cells[index];
  return String(value ?? '') === '' ? 'Trống' : String(value);
}

export default function ProductBulkUpdateWorkspace() {
  const [fileName, setFileName] = useState('');
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const columnCount = useMemo(() => matrix.reduce((max, row) => Math.max(max, row.length), 0), [matrix]);
  const dataRows = useMemo(() => {
    const source = hasHeader ? matrix.slice(1) : matrix;
    const start = hasHeader ? 2 : 1;
    return source.map((cells, index) => ({ rowNumber: start + index, cells }));
  }, [matrix, hasHeader]);
  const headerCells = hasHeader ? (matrix[0] ?? []) : [];

  function invalidatePreview() {
    setPreview(null);
    setOperationKey(null);
    setApplied(false);
    setNotice(null);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const rows = await readSpreadsheetMatrix(file);
      const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (rows.length === 0 || columns < 2) throw new Error('Tệp cần có cột 1 là SKU và ít nhất một cột dữ liệu');
      setFileName(file.name);
      setMatrix(rows);
      setMappings(initialMappings(columns));
      setPreview(null);
      setOperationKey(null);
      setApplied(false);
    } catch (value) {
      setFileName('');
      setMatrix([]);
      setMappings([]);
      setPreview(null);
      setOperationKey(null);
      setApplied(false);
      setError(value instanceof Error ? value.message : 'Không đọc được tệp cập nhật');
    } finally {
      setBusy(false);
    }
  }

  function setMapping(index: number, value: Mapping) {
    if (index === 0) return;
    if (value !== 'IGNORE' && mappings.some((item, itemIndex) => itemIndex !== index && item === value)) {
      setError('Một thuộc tính chỉ được chọn cho một cột');
      return;
    }
    setError(null);
    setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
    invalidatePreview();
  }

  function payload(dryRun: boolean) {
    return { dryRun, mappings, rows: dataRows };
  }

  async function requestPreview() {
    if (dataRows.length === 0) {
      setError('Không có dòng dữ liệu để xem trước');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/products/variants/bulk-update', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(true)),
      });
      const envelope = await response.json() as ApiEnvelope<PreviewResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể tạo bản xem trước');
      setPreview(envelope.data);
      setOperationKey(envelope.data.operationKey ?? null);
      setApplied(false);
      setNotice(`Đã kiểm tra ${envelope.data.rows.length} dòng. ${envelope.data.skipped} dòng có lỗi sẽ được bỏ qua.`);
    } catch (value) {
      setPreview(null);
      setOperationKey(null);
      setError(value instanceof Error ? value.message : 'Không thể tạo bản xem trước');
    } finally {
      setBusy(false);
    }
  }

  async function applyUpdate() {
    if (!preview || !operationKey || applied) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/products/variants/bulk-update', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify(payload(false)),
      });
      const envelope = await response.json() as ApiEnvelope<PreviewResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể cập nhật sản phẩm');
      setPreview(envelope.data);
      setApplied(true);
      setNotice(`Đã cập nhật ${envelope.data.updated} SKU. ${envelope.data.skipped} dòng có lỗi đã được bỏ qua.`);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể cập nhật sản phẩm');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="product-bulk-update-workspace">
      <div className={styles.sectionHeader}>
        <div>
          <h2>Cập nhật sản phẩm</h2>
          <p>Cập nhật hàng loạt theo SKU hiện có. Cột 1 luôn là SKU; thao tác này không tạo sản phẩm hoặc SKU mới.</p>
        </div>
      </div>

      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {notice ? <div className={styles.noticeBanner}>{notice}</div> : null}

      <div className={styles.formPanel}>
        <div className={styles.formGrid}>
          <label className={styles.wide}>
            Tệp Excel hoặc CSV
            <input
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              disabled={busy}
              onChange={(event) => void loadFile(event.target.files?.[0])}
              data-testid="product-update-file"
            />
          </label>
        </div>
        <div className={styles.checks}>
          <label>
            <input
              type="checkbox"
              checked={hasHeader}
              disabled={busy || matrix.length === 0}
              onChange={(event) => { setHasHeader(event.target.checked); invalidatePreview(); }}
            />
            Dòng đầu là tiêu đề
          </label>
        </div>
        {fileName ? <p>Đã chọn: <strong>{fileName}</strong> · {dataRows.length} dòng dữ liệu · {columnCount} cột</p> : null}
      </div>

      {matrix.length > 0 ? (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h3>Chọn nội dung cần cập nhật</h3>
              <p>Ý nghĩa được xác định theo vị trí cột, không phụ thuộc tên tiêu đề trong tệp.</p>
            </div>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead><tr><th>Cột</th><th>Tiêu đề trong tệp</th><th>Nội dung cập nhật</th></tr></thead>
              <tbody>
                {Array.from({ length: columnCount }, (_value, index) => (
                  <tr key={index}>
                    <td><strong>Cột {index + 1}</strong></td>
                    <td>{hasHeader ? (headerCells[index] || 'Trống') : 'Không dùng tiêu đề'}</td>
                    <td>
                      {index === 0 ? (
                        <strong>SKU — cố định</strong>
                      ) : (
                        <select
                          value={mappings[index] ?? 'IGNORE'}
                          disabled={busy}
                          onChange={(event) => setMapping(index, event.target.value as Mapping)}
                          aria-label={`Nội dung cột ${index + 1}`}
                        >
                          {OPTIONS.map((option) => (
                            <option
                              key={option.value}
                              value={option.value}
                              disabled={option.value !== 'IGNORE' && mappings.some((item, itemIndex) => itemIndex !== index && item === option.value)}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.inlineTools}>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void requestPreview()} data-testid="product-update-preview">Xem trước thay đổi</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || !preview || !operationKey || applied || (preview.ready ?? 0) === 0}
              onClick={() => void applyUpdate()}
              data-testid="product-update-apply"
            >
              Cập nhật các dòng hợp lệ
            </button>
          </div>
        </>
      ) : null}

      {preview ? (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h3>Xem trước theo từng dòng</h3>
              <p>Ô trống ở cột được chọn là yêu cầu xóa dữ liệu; cột không có trong dòng sẽ không làm thay đổi dữ liệu cũ.</p>
            </div>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Dòng</th>
                  {Array.from({ length: columnCount }, (_value, index) => <th key={index}>Cột {index + 1} · {mappingLabel(mappings[index] ?? 'IGNORE')}</th>)}
                  <th>Giá trị cũ → mới</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.sku}`} data-testid={`product-update-row-${row.rowNumber}`}>
                    <td>{row.rowNumber}</td>
                    {Array.from({ length: columnCount }, (_value, index) => <td key={index}>{cellDisplay(row, index)}</td>)}
                    <td>{row.changes.length > 0 ? row.changes.map((change) => <div key={change.field}><strong>{change.label}:</strong> {change.oldValue} → {change.newValue}</div>) : 'Không thay đổi'}</td>
                    <td>{row.errors.length > 0 ? row.errors.map((item) => <div key={item.code}>{item.message}</div>) : rowStatus(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
