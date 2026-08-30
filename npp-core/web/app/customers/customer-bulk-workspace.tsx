'use client';

import { useMemo, useRef, useState } from 'react';
import { readSpreadsheetMatrix } from '../../lib/spreadsheet-matrix';
import styles from '../products/products.module.css';

type Mode = 'import' | 'update';
type Mapping =
  | 'CUSTOMER_CODE'
  | 'NAME'
  | 'GROUP_CODE'
  | 'RESPONSIBLE_EMPLOYEE_CODE'
  | 'PHONE'
  | 'EMAIL'
  | 'TAX_CODE'
  | 'PAYMENT_TERMS_DAYS'
  | 'CREDIT_LIMIT'
  | 'NOTES'
  | 'IGNORE';
type SourceRow = { rowNumber: number; cells: string[]; expectedUpdatedAt?: string | null };
type RowError = { code: string; message: string };
type RowWarning = { code: string; message: string };
type Change = { field: string; label: string; oldValue: string; newValue: string };
type ResultRow = {
  rowNumber: number;
  customerCode: string;
  customerName: string;
  customerId?: string | null;
  expectedUpdatedAt?: string | null;
  status: string;
  errors: RowError[];
  warnings?: RowWarning[];
  changes?: Change[];
  cells: unknown[];
};
type BulkResult = {
  created?: number;
  updated?: number;
  ready?: number;
  skipped: number;
  unchanged?: number;
  rows: ResultRow[];
  operationKey?: string;
};
type IdentifyResult = { identified: number; skipped: number; rows: ResultRow[] };
type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };

type Props = { mode: Mode };

const OPTIONS: Array<{ value: Mapping; label: string }> = [
  { value: 'IGNORE', label: 'Bỏ qua' },
  { value: 'CUSTOMER_CODE', label: 'Mã khách hàng' },
  { value: 'NAME', label: 'Tên khách hàng' },
  { value: 'GROUP_CODE', label: 'Nhóm khách hàng' },
  { value: 'RESPONSIBLE_EMPLOYEE_CODE', label: 'Nhân viên phụ trách' },
  { value: 'PHONE', label: 'Điện thoại' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'TAX_CODE', label: 'Mã số thuế' },
  { value: 'PAYMENT_TERMS_DAYS', label: 'Thời hạn thanh toán' },
  { value: 'CREDIT_LIMIT', label: 'Hạn mức tín dụng' },
  { value: 'NOTES', label: 'Ghi chú' },
];

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mappingFromHeader(header: string): Mapping | null {
  const value = normalizeHeader(header);
  if (!value) return null;
  if (value.includes('ma khach') || value === 'ma kh' || value === 'customer code') return 'CUSTOMER_CODE';
  if (value.includes('ten khach') || value === 'ten kh' || value === 'customer name') return 'NAME';
  if (value.includes('nhom khach') || value === 'ma nhom') return 'GROUP_CODE';
  if (value.includes('nhan vien') || value.includes('phu trach') || value === 'ma nv') return 'RESPONSIBLE_EMPLOYEE_CODE';
  if (value.includes('dien thoai') || value.includes('so dt') || value === 'phone') return 'PHONE';
  if (value.includes('email')) return 'EMAIL';
  if (value.includes('ma so thue') || value.includes('mst')) return 'TAX_CODE';
  if (value.includes('thoi han') || value.includes('payment terms')) return 'PAYMENT_TERMS_DAYS';
  if (value.includes('han muc') || value.includes('credit limit')) return 'CREDIT_LIMIT';
  if (value.includes('ghi chu') || value === 'note') return 'NOTES';
  return null;
}

function initialMappings(columnCount: number, headers: string[], mode: Mode): Mapping[] {
  const defaults: Mapping[] = mode === 'update'
    ? ['CUSTOMER_CODE', 'NAME', 'PHONE', 'GROUP_CODE', 'RESPONSIBLE_EMPLOYEE_CODE', 'EMAIL', 'TAX_CODE', 'PAYMENT_TERMS_DAYS', 'CREDIT_LIMIT', 'NOTES']
    : ['NAME', 'PHONE', 'GROUP_CODE', 'RESPONSIBLE_EMPLOYEE_CODE', 'EMAIL', 'TAX_CODE', 'PAYMENT_TERMS_DAYS', 'CREDIT_LIMIT', 'NOTES'];
  const used = new Set<Mapping>();
  return Array.from({ length: columnCount }, (_value, index) => {
    if (mode === 'update' && index === 0) {
      used.add('CUSTOMER_CODE');
      return 'CUSTOMER_CODE';
    }
    const fromHeader = mappingFromHeader(headers[index] ?? '');
    const candidate = fromHeader ?? defaults[index] ?? 'IGNORE';
    if (candidate !== 'IGNORE' && used.has(candidate)) return 'IGNORE';
    if (candidate !== 'IGNORE') used.add(candidate);
    return candidate;
  });
}

function sourceRowsFor(matrix: string[][], skipFirst: boolean): SourceRow[] {
  const source = skipFirst ? matrix.slice(1) : matrix;
  const start = skipFirst ? 2 : 1;
  return source.map((cells, index) => ({ rowNumber: start + index, cells }));
}

function sourceCell(value: unknown) {
  const valueText = String(value ?? '');
  return valueText === '' ? 'Trống' : valueText;
}

function rowMessage(row: ResultRow, applied: boolean, mode: Mode) {
  if (row.errors?.length) return row.errors[0].message;
  const warning = row.warnings?.[0]?.message;
  if (!applied) {
    if (warning && mode === 'import') return warning;
    return row.status === 'unchanged' ? 'Không thay đổi' : mode === 'import' ? 'Sẵn sàng nhập' : 'Sẽ cập nhật';
  }
  if (mode === 'import') return row.status === 'created' ? `Đã nhập${warning ? ` · ${warning}` : ''}` : row.status;
  return row.status === 'updated' ? 'Đã cập nhật' : 'Không thay đổi';
}

export default function CustomerBulkWorkspace({ mode }: Props) {
  const [fileName, setFileName] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [identification, setIdentification] = useState<IdentifyResult | null>(null);
  const [preview, setPreview] = useState<BulkResult | null>(null);
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const identifyRequest = useRef(0);

  const columnCount = useMemo(() => matrix.reduce((max, row) => Math.max(max, row.length), 0), [matrix]);
  const dataRows = useMemo(() => sourceRowsFor(matrix, hasHeader), [matrix, hasHeader]);
  const headerCells = hasHeader ? (matrix[0] ?? []) : [];
  const identificationByRow = useMemo(() => new Map((identification?.rows ?? []).map((row) => [row.rowNumber, row])), [identification]);
  const hasRequiredMapping = mode === 'import'
    ? mappings.includes('NAME')
    : mappings.length > 1 && mappings.slice(1).some((mapping) => mapping !== 'IGNORE');

  function invalidatePreview() {
    setPreview(null);
    setOperationKey(null);
    setApplied(false);
    setNotice(null);
  }

  async function identify(rows: SourceRow[]) {
    if (mode !== 'update') return;
    const requestNumber = identifyRequest.current + 1;
    identifyRequest.current = requestNumber;
    setIdentification(null);
    invalidatePreview();
    if (!rows.length) return;
    setIdentifying(true);
    setError(null);
    try {
      const response = await fetch('/api/customers/identify', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
      });
      const envelope = await response.json() as ApiEnvelope<IdentifyResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể nhận diện khách hàng trong tệp');
      if (identifyRequest.current === requestNumber) setIdentification(envelope.data);
    } catch (value) {
      if (identifyRequest.current === requestNumber) setError(value instanceof Error ? value.message : 'Không thể nhận diện khách hàng trong tệp');
    } finally {
      if (identifyRequest.current === requestNumber) setIdentifying(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    identifyRequest.current += 1;
    setReadingFile(true);
    setError(null);
    setNotice(null);
    try {
      const rows = await readSpreadsheetMatrix(file);
      const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (!rows.length || columns < 1) throw new Error('Tệp không có dữ liệu khách hàng');
      const skipFirst = true;
      setFileName(file.name);
      setMatrix(rows);
      setHasHeader(skipFirst);
      setMappings(initialMappings(columns, rows[0] ?? [], mode));
      setIdentification(null);
      setPreview(null);
      setOperationKey(null);
      setApplied(false);
      if (mode === 'update') void identify(sourceRowsFor(rows, skipFirst));
    } catch (value) {
      setFileName('');
      setMatrix([]);
      setMappings([]);
      setIdentification(null);
      invalidatePreview();
      setError(value instanceof Error ? value.message : 'Không đọc được tệp khách hàng');
    } finally {
      setReadingFile(false);
    }
  }

  function resetFile() {
    identifyRequest.current += 1;
    setFileName('');
    setMatrix([]);
    setMappings([]);
    setIdentification(null);
    setIdentifying(false);
    setError(null);
    invalidatePreview();
    setFileInputKey((value) => value + 1);
  }

  function setMapping(index: number, value: Mapping) {
    if (mode === 'update' && index === 0) return;
    if (value !== 'IGNORE' && mappings.some((item, itemIndex) => itemIndex !== index && item === value)) {
      setError('Một trường chỉ được chọn cho một cột');
      return;
    }
    setError(null);
    setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
    invalidatePreview();
  }

  function requestRowsForApply() {
    if (mode !== 'update' || !preview) return dataRows;
    const versionByRow = new Map(preview.rows.map((row) => [row.rowNumber, row.expectedUpdatedAt ?? null]));
    return dataRows.map((row) => ({ ...row, expectedUpdatedAt: versionByRow.get(row.rowNumber) ?? null }));
  }

  async function requestPreview() {
    if (!dataRows.length) return setError('Không có dòng dữ liệu để xem trước');
    if (!hasRequiredMapping) return setError(mode === 'import' ? 'Cần chọn cột Tên khách hàng' : 'Chọn ít nhất một trường cần cập nhật từ cột 2 trở đi');
    if (mode === 'update' && identifying) return setError('Đang nhận diện khách hàng');
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(mode === 'import' ? '/api/customers/import' : '/api/customers/bulk-update', {
        method: mode === 'import' ? 'POST' : 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, mappings, rows: dataRows }),
      });
      const envelope = await response.json() as ApiEnvelope<BulkResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể tạo bản xem trước');
      setPreview(envelope.data);
      setOperationKey(envelope.data.operationKey ?? null);
      setApplied(false);
      setNotice(`Đã đối chiếu ${envelope.data.rows.length} dòng. ${envelope.data.skipped} dòng có lỗi sẽ được bỏ qua.`);
    } catch (value) {
      setPreview(null);
      setOperationKey(null);
      setError(value instanceof Error ? value.message : 'Không thể tạo bản xem trước');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview || !operationKey || applied) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(mode === 'import' ? '/api/customers/import' : '/api/customers/bulk-update', {
        method: mode === 'import' ? 'POST' : 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify({ dryRun: false, mappings, rows: requestRowsForApply() }),
      });
      const envelope = await response.json() as ApiEnvelope<BulkResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || (mode === 'import' ? 'Không thể nhập khách hàng' : 'Không thể cập nhật khách hàng'));
      setPreview(envelope.data);
      setApplied(true);
      setNotice(mode === 'import'
        ? `Đã nhập ${envelope.data.created ?? 0} khách hàng. ${envelope.data.skipped} dòng lỗi đã được bỏ qua.`
        : `Đã cập nhật ${envelope.data.updated ?? 0} khách hàng. ${envelope.data.skipped} dòng lỗi đã được bỏ qua.`);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể thực hiện dữ liệu khách hàng');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'import' ? 'Nhập khách hàng' : 'Cập nhật khách hàng';
  const description = mode === 'import'
    ? 'Mã khách hàng có thể để trống để Công Ty tự sinh. Tên khách hàng là bắt buộc. Chưa có địa chỉ giao hàng — cần bổ sung trước khi đặt hàng.'
    : 'Cột 1 luôn là Mã khách hàng để truy vấn chính xác. Mã khách hàng không được thay đổi trong thao tác này.';

  return (
    <section className={styles.bulkUpdateWorkspace} data-testid={`customer-bulk-${mode}-workspace`}>
      <div className={styles.sectionHeader}><div><h2>{title}</h2><p>{description}</p></div></div>
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {notice ? <div className={styles.noticeBanner}>{notice}</div> : null}

      <div className={styles.updateUploadPanel}>
        <label className={styles.updateFileField}>
          <span>Tệp Excel hoặc CSV</span>
          <input key={fileInputKey} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled={readingFile || busy} onChange={(event) => void loadFile(event.target.files?.[0])} data-testid={`customer-${mode}-file`} />
        </label>
        <label className={styles.updateHeaderToggle}>
          <input type="checkbox" checked={hasHeader} disabled={readingFile || busy || !matrix.length} onChange={(event) => {
            const next = event.target.checked;
            setHasHeader(next);
            setMappings(initialMappings(columnCount, next ? (matrix[0] ?? []) : [], mode));
            invalidatePreview();
            if (mode === 'update') void identify(sourceRowsFor(matrix, next));
          }} />
          <span>Bỏ dòng đầu nếu là tiêu đề</span>
        </label>
        {fileName ? <div className={styles.selectedFile}>Đã chọn: <strong>{fileName}</strong></div> : null}
      </div>

      {matrix.length ? (
        <div className={styles.sourcePreviewCard} data-testid={`customer-${mode}-source-preview`}>
          <div className={styles.updateSummaryBar}>
            <span><strong>{dataRows.length}</strong> dòng dữ liệu</span>
            <span><strong>{columnCount}</strong> cột từ tệp</span>
            {mode === 'update' ? <span className={styles.summarySuccess}><strong>{identification?.identified ?? 0}</strong> khách đã nhận diện</span> : null}
            {mode === 'update' ? <span className={(identification?.skipped ?? 0) ? styles.summaryError : undefined}><strong>{identification?.skipped ?? 0}</strong> dòng mã có lỗi</span> : null}
            {identifying ? <span className={styles.summaryPending}>Đang nhận diện khách hàng…</span> : null}
          </div>
          <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.updateSourceTable}`}>
              <thead><tr>
                {Array.from({ length: columnCount }, (_value, index) => (
                  <th key={index}>
                    <div className={styles.updateColumnHeader}>
                      <strong>{mode === 'update' && index === 0 ? 'Cột 1 · Mã khách hàng' : `Cột ${index + 1}`}</strong>
                      {mode === 'update' && index === 0 ? <span className={styles.queryKeyBadge}>Khóa truy vấn</span> : null}
                      {hasHeader && headerCells[index] ? <small>{headerCells[index]}</small> : null}
                      {mode === 'update' && index === 0 ? null : (
                        <select value={mappings[index] ?? 'IGNORE'} disabled={busy} onChange={(event) => setMapping(index, event.target.value as Mapping)} aria-label={`Trường cột ${index + 1}`}>
                          {OPTIONS.filter((option) => mode === 'import' || option.value !== 'CUSTOMER_CODE').map((option) => (
                            <option key={option.value} value={option.value} disabled={option.value !== 'IGNORE' && mappings.some((item, itemIndex) => itemIndex !== index && item === option.value)}>{option.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </th>
                ))}
                {mode === 'update' ? <th>Tên khách hàng</th> : null}
                <th>Trạng thái</th>
              </tr></thead>
              <tbody>
                {dataRows.map((row) => {
                  const identified = identificationByRow.get(row.rowNumber);
                  return <tr key={row.rowNumber} className={identified?.errors?.length ? styles.updateErrorRow : undefined}>
                    {Array.from({ length: columnCount }, (_value, index) => <td key={index}>{sourceCell(row.cells[index])}</td>)}
                    {mode === 'update' ? <td>{identified?.customerName || (identifying ? 'Đang tra cứu…' : '—')}</td> : null}
                    <td>{mode === 'update' ? (identified?.errors?.[0]?.message || (identified ? 'Đã nhận diện' : 'Chưa nhận diện')) : 'Chờ xem trước'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.updateActionBar}>
            <button type="button" className={styles.secondaryButton} disabled={readingFile || busy} onClick={resetFile}>Làm mới tệp</button>
            <button type="button" className={styles.primaryButton} disabled={readingFile || identifying || busy || !hasRequiredMapping || (mode === 'update' && !identification)} onClick={() => void requestPreview()} data-testid={`customer-${mode}-preview`}>Xem trước thay đổi</button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className={styles.changePreviewCard} data-testid={`customer-${mode}-change-preview`}>
          <div className={styles.sectionHeader}><div><h3>Xem trước thay đổi</h3><p>Chỉ các dòng hợp lệ mới được thực hiện.</p></div></div>
          <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.changePreviewTable}`}>
              <thead><tr><th>Mã khách hàng</th><th>Tên khách hàng</th>{mode === 'update' ? <><th>Trường</th><th>Giá trị cũ</th><th>Giá trị mới</th></> : null}<th>Kết quả</th></tr></thead>
              <tbody>
                {preview.rows.flatMap((row) => {
                  if (mode === 'update' && row.changes?.length) {
                    return row.changes.map((change) => <tr key={`${row.rowNumber}-${change.field}`}><td>{row.customerCode || '—'}</td><td>{row.customerName || '—'}</td><td>{change.label}</td><td>{change.oldValue}</td><td>{change.newValue}</td><td>{rowMessage(row, applied, mode)}</td></tr>);
                  }
                  return [<tr key={`${row.rowNumber}-summary`} className={row.errors?.length ? styles.updateErrorRow : undefined}><td>{row.customerCode || '—'}</td><td>{row.customerName || '—'}</td>{mode === 'update' ? <><td>—</td><td>—</td><td>—</td></> : null}<td>{rowMessage(row, applied, mode)}</td></tr>];
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.updateActionBar}>
            <span className={styles.updateActionHint}>{mode === 'import' ? 'Chưa có địa chỉ giao hàng — cần bổ sung trước khi đặt hàng.' : 'Mã khách hàng chỉ dùng để truy vấn, không bị thay đổi.'}</span>
            <button type="button" className={styles.primaryButton} disabled={busy || !operationKey || applied || (preview.ready ?? 0) === 0} onClick={() => void apply()} data-testid={`customer-${mode}-apply`}>{applied ? 'Đã thực hiện' : mode === 'import' ? 'Nhập các dòng hợp lệ' : 'Cập nhật các dòng hợp lệ'}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
