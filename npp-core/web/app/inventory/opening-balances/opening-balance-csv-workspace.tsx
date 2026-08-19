'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import { formatDateTime, type OpeningBalanceImport } from '../../../lib/inventory-types';
import styles from './opening-balance-csv-workspace.module.css';

type WarehouseOption = { id: string; code: string; name: string };
type LocationOption = { id: string; code: string; name: string; locationType: string };
type CsvRow = {
  sku: string;
  sourceQuantity: string;
  locationCode: string;
  lotCode: string;
  manufacturedDate: string;
  expiryDate: string;
  supplierLotReference: string;
  sourceLineReference: string;
};
type ValidationRow = {
  lineNumber?: number;
  warehouseCode?: string;
  warehouseName?: string;
  locationCode?: string | null;
  locationName?: string | null;
  sourceSku?: string;
  productCode?: string;
  productName?: string;
  sourceUnitCode?: string | null;
  sourceQuantity?: string;
  baseVariantId?: string | null;
  baseSku?: string | null;
  baseQuantity?: string;
  lotTrackingMode?: 'NONE' | 'REQUIRED' | null;
  expiryTrackingMode?: 'NONE' | 'OPTIONAL' | 'REQUIRED' | null;
  locationRequired?: boolean | null;
  lotCode?: string | null;
  expiryDate?: string | null;
};
type ValidationResult = {
  rowErrors: Array<{ lineNumber: number; code: string; message: string }>;
  rows: ValidationRow[];
  totals: { rowCount: number; sourceQuantityTotal: string; baseQuantityTotal: string };
};
type LocationEnvelope = { warehouse: WarehouseOption; locations: LocationOption[] };
type Envelope<T> = { data?: T; error?: { message?: string; code?: string; details?: unknown } };
type WorkspaceProps = { initialImports: OpeningBalanceImport[]; initialError?: string | null };

const CSV_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'sourceQuantity', label: 'Số lượng' },
  { key: 'locationCode', label: 'Vị trí' },
  { key: 'lotCode', label: 'Mã lô' },
  { key: 'manufacturedDate', label: 'Ngày sản xuất' },
  { key: 'expiryDate', label: 'Hạn sử dụng' },
  { key: 'supplierLotReference', label: 'Mã lô nhà cung cấp' },
  { key: 'sourceLineReference', label: 'Tham chiếu dòng' },
] as const;
const TEMPLATE_COLUMNS = CSV_COLUMNS.filter((column) => ['sku', 'sourceQuantity', 'locationCode'].includes(column.key));
const HEADERS = CSV_COLUMNS.map((column) => column.key);
const HEADER_ALIASES = Object.fromEntries(CSV_COLUMNS.flatMap((column) => [
  [column.label, column.key],
  [column.key, column.key],
]));
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function parseLine(line: string, delimiter = ','): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function delimiterFor(line: string) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = parseLine(line, delimiter).length - 1;
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = delimiterFor(lines[0]);
  const headers: string[] = parseLine(lines[0], delimiter).map((header) => HEADER_ALIASES[header.trim()] ?? header.trim());
  if (!headers.includes('sku') || !headers.includes('sourceQuantity')) return [];
  return lines.slice(1).map((line) => {
    const cells = parseLine(line, delimiter);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])) as Partial<CsvRow>;
    return Object.fromEntries(HEADERS.map((header) => [header, row[header as keyof CsvRow] ?? ''])) as CsvRow;
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

async function checksum(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data;
}

function downloadTemplate() {
  const content = TEMPLATE_COLUMNS.map((column) => column.label).join(',');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mau-ton-dau-ky.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function displayQuantity(value: string | undefined) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '—';
  return normalized.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function lotPolicyLabel(row: ValidationRow | undefined) {
  if (!row?.baseVariantId) return 'Chưa đối chiếu';
  if (!row.lotTrackingMode) return 'Chưa cấu hình chính sách';
  return row.lotTrackingMode === 'REQUIRED' ? 'Quản lý theo lô' : 'Không quản lý theo lô';
}

function expiryPolicyLabel(row: ValidationRow | undefined) {
  if (!row?.baseVariantId || !row.expiryTrackingMode) return '';
  if (row.expiryTrackingMode === 'REQUIRED') return 'HSD bắt buộc';
  if (row.expiryTrackingMode === 'OPTIONAL') return 'HSD tùy chọn';
  return 'Không quản lý HSD';
}

export default function OpeningBalanceCsvWorkspace({ initialImports, initialError = null }: WorkspaceProps) {
  const [sourceKey, setSourceKey] = useState('');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [filename, setFilename] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [defaultLocationCode, setDefaultLocationCode] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [resolvedRows, setResolvedRows] = useState<ValidationRow[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationChecksum, setValidationChecksum] = useState<string | null>(null);
  const [imports, setImports] = useState(initialImports);
  const [busy, setBusy] = useState<'bootstrap' | 'locations' | 'validate' | 'post' | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    initialError ? { kind: 'error', text: initialError } : null,
  );
  const draftRevision = useRef(0);

  const selectedWarehouse = useMemo(
    () => warehouseOptions.find((warehouse) => warehouse.id === selectedWarehouseId) ?? null,
    [selectedWarehouseId, warehouseOptions],
  );

  const effectiveRows = useMemo(() => rows.map((row) => ({
    ...row,
    locationCode: row.locationCode || defaultLocationCode,
  })), [defaultLocationCode, rows]);

  const localErrors = useMemo(() => effectiveRows.map((row, index) => {
    const missing: string[] = [];
    if (!row.sku) missing.push('SKU');
    if (!row.sourceQuantity) missing.push('số lượng');
    return missing.length ? { line: index + 2, message: `Thiếu ${missing.join(', ')}` } : null;
  }).filter(Boolean) as Array<{ line: number; message: string }>, [effectiveRows]);

  function invalidateDraft() {
    draftRevision.current += 1;
    setValidation(null);
    setValidationChecksum(null);
  }

  function updateRow(index: number, patch: Partial<CsvRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
    invalidateDraft();
    setMessage(null);
  }

  useEffect(() => {
    let active = true;
    setBusy('bootstrap');
    const warehousesRequest = requestJson<WarehouseOption[]>('/api/inventory/opening-balances/operator/warehouses')
      .then((warehouses) => {
        if (!active) return;
        setWarehouseOptions(warehouses);
        if (warehouses.length === 1) setSelectedWarehouseId(warehouses[0].id);
        if (initialError) setMessage(null);
      })
      .catch((error) => {
        if (active) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được danh mục kho.' });
      });
    const historyRequest = requestJson<OpeningBalanceImport[]>('/api/inventory/opening-balances?limit=200')
      .then((nextImports) => { if (active) setImports(nextImports); })
      .catch((error) => {
        if (!active) return;
        setMessage({
          kind: 'error',
          text: error instanceof Error
            ? `Không tải được lịch sử nhập tồn đầu kỳ: ${error.message}`
            : 'Không tải được lịch sử nhập tồn đầu kỳ.',
        });
      });
    void Promise.allSettled([warehousesRequest, historyRequest]).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [initialError]);

  useEffect(() => {
    let active = true;
    setLocationOptions([]);
    setDefaultLocationCode('');
    invalidateDraft();
    setResolvedRows([]);
    if (!selectedWarehouseId) return () => { active = false; };
    setBusy('locations');
    requestJson<LocationEnvelope>(`/api/inventory/opening-balances/operator/locations?warehouseId=${encodeURIComponent(selectedWarehouseId)}`)
      .then((payload) => { if (active) setLocationOptions(payload.locations); })
      .catch((error) => {
        if (active) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được vị trí của kho.' });
      })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [selectedWarehouseId]);

  async function chooseFile(file: File) {
    invalidateDraft();
    setRows([]);
    setResolvedRows([]);
    setMessage(null);
    setFilename('');
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMessage({ kind: 'error', text: 'Chỉ nhận tệp CSV UTF-8. Trong Excel, chọn “Lưu thành CSV UTF-8” rồi tải lại.' });
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length === 0) {
      setMessage({ kind: 'error', text: 'Tệp cần đúng mẫu và có ít nhất một dòng dữ liệu. Hai cột bắt buộc là SKU và Số lượng.' });
      return;
    }
    setFilename(file.name);
    setRows(parsed);
    setMessage({ kind: 'success', text: `Đã đọc ${parsed.length} dòng. Bấm “Kiểm tra tệp” để đối chiếu SKU và tự áp dụng chính sách lô/hạn dùng.` });
  }

  function normalizedBody() {
    return {
      warehouseId: selectedWarehouseId,
      sourceKey: sourceKey.trim().toUpperCase(),
      sourceFilename: filename || null,
      documentDate,
      metadata: {
        importMethod: 'csv-upload-operator',
        originalFilename: filename,
        defaultLocationCode: defaultLocationCode || null,
      },
      rows: effectiveRows.map((row, index) => ({
        sku: row.sku.trim(),
        sourceQuantity: row.sourceQuantity.trim(),
        locationCode: row.locationCode.trim() || null,
        lotCode: row.lotCode.trim() || null,
        manufacturedDate: row.manufacturedDate.trim() || null,
        expiryDate: row.expiryDate.trim() || null,
        supplierLotReference: row.supplierLotReference.trim() || null,
        sourceLineReference: row.sourceLineReference.trim() || `Dong-${index + 2}`,
        metadata: {},
      })),
    };
  }

  async function validate() {
    if (!selectedWarehouseId) { setMessage({ kind: 'error', text: 'Chọn kho trước khi kiểm tra tệp.' }); return; }
    const normalizedSourceKey = sourceKey.trim().toUpperCase();
    if (!normalizedSourceKey) { setMessage({ kind: 'error', text: 'Nhập mã đợt dữ liệu để tránh nhập trùng.' }); return; }
    if (!SOURCE_KEY_PATTERN.test(normalizedSourceKey)) { setMessage({ kind: 'error', text: 'Mã đợt dữ liệu chỉ dùng chữ không dấu, số và các ký tự . _ : - (tối đa 128 ký tự).' }); return; }
    if (!rows.length) { setMessage({ kind: 'error', text: 'Chọn tệp CSV trước khi kiểm tra.' }); return; }
    if (localErrors.length) { setMessage({ kind: 'error', text: 'Tệp còn dòng thiếu SKU hoặc số lượng. Sửa các dòng báo đỏ trước.' }); return; }
    const revision = draftRevision.current;
    setBusy('validate');
    setMessage(null);
    setValidation(null);
    setValidationChecksum(null);
    try {
      const body = normalizedBody();
      const contentChecksum = await checksum(body);
      const result = await requestJson<ValidationResult>('/api/inventory/opening-balances/operator/validate', {
        method: 'POST',
        body: JSON.stringify({ ...body, contentChecksum }),
      });
      if (revision !== draftRevision.current) return;
      setResolvedRows(result.rows);
      setValidation(result);
      setValidationChecksum(contentChecksum);
      setMessage(result.rowErrors.length
        ? { kind: 'error', text: 'Có dòng chưa hợp lệ. Chính sách SKU đã được đối chiếu; điền các dữ liệu lô/hạn dùng được yêu cầu rồi kiểm tra lại.' }
        : { kind: 'success', text: 'Dữ liệu đã khớp kho, vị trí, SKU và chính sách tồn kho. Có thể xác nhận nhập tồn.' });
    } catch (error) {
      if (revision !== draftRevision.current) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không kiểm tra được tệp.' });
    } finally {
      setBusy(null);
    }
  }

  async function post() {
    if (!validation || validation.rowErrors.length || !validationChecksum || !selectedWarehouseId) return;
    setBusy('post');
    setMessage(null);
    try {
      const body = normalizedBody();
      const contentChecksum = await checksum(body);
      if (contentChecksum !== validationChecksum) {
        invalidateDraft();
        setMessage({ kind: 'error', text: 'Kho, vị trí hoặc dữ liệu đã thay đổi sau lần kiểm tra. Vui lòng kiểm tra lại trước khi xác nhận.' });
        return;
      }
      await requestJson('/api/inventory/opening-balances/operator/post', {
        method: 'POST',
        headers: { 'Idempotency-Key': `opening-${contentChecksum}` },
        body: JSON.stringify({ ...body, contentChecksum }),
      });
      const next = await requestJson<OpeningBalanceImport[]>('/api/inventory/opening-balances?limit=200').catch(() => null);
      draftRevision.current += 1;
      if (next) setImports(next);
      setRows([]);
      setResolvedRows([]);
      setValidation(null);
      setValidationChecksum(null);
      setFilename('');
      setSourceKey('');
      setMessage({ kind: 'success', text: 'Đã ghi nhận tồn đầu kỳ thành công. Kho đang chọn được giữ lại cho đợt tiếp theo.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không ghi nhận được tồn đầu kỳ.' });
    } finally {
      setBusy(null);
    }
  }

  return <AppShell title="Thiết lập tồn đầu kỳ" subtitle="Chọn kho, nhập SKU và số lượng; hệ thống tự áp dụng chính sách lô/hạn dùng đã cấu hình theo SKU.">
    <main className={styles.page} data-testid="inventory-page">
      <header className={styles.header}>
        <div><p className={styles.kicker}>TỒN KHO</p><h1>Nhập tồn đầu kỳ</h1><p>Mỗi đợt nhập thuộc một kho. Nhân viên chỉ dùng SKU và mã vị trí, không cần biết ID hệ thống. Chính sách lô/hạn dùng lấy từ danh mục SKU.</p></div>
        <Link href="/inventory/balances" className={styles.backLink}>Về tra cứu tồn kho</Link>
      </header>

      {message ? <div className={message.kind === 'success' ? styles.success : styles.error} role={message.kind === 'error' ? 'alert' : undefined}>{message.text}</div> : null}

      <section className={styles.steps} aria-label="Các bước nhập tồn đầu kỳ">
        <article><strong>1</strong><span>Tải tệp mẫu</span><button type="button" onClick={downloadTemplate}>Tải mẫu Excel/CSV</button></article>
        <article><strong>2</strong><span>Chọn tệp đã điền</span><label>Chọn tệp<input type="file" accept=".csv,text/csv" data-testid="inventory-opening-file-input" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseFile(file); }} /></label></article>
        <article><strong>3</strong><span>Kiểm tra dữ liệu</span><button type="button" onClick={() => void validate()} disabled={busy !== null}>{busy === 'validate' ? 'Đang kiểm tra…' : 'Kiểm tra tệp'}</button></article>
        <article><strong>4</strong><span>Xác nhận ghi nhận</span><button type="button" onClick={() => void post()} disabled={busy !== null || !validation || !validationChecksum || validation.rowErrors.length > 0}>{busy === 'post' ? 'Đang ghi nhận…' : 'Xác nhận nhập tồn'}</button></article>
      </section>

      <section className={styles.card}>
        <h2>Thông tin đợt nhập</h2>
        <div className={styles.formGrid}>
          <label><span>Kho *</span><select data-testid="inventory-opening-warehouse-select" value={selectedWarehouseId} onChange={(event) => { setSelectedWarehouseId(event.target.value); setMessage(null); }} disabled={busy === 'bootstrap'}><option value="">Chọn kho</option>{warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
          <label><span>Vị trí mặc định</span><select data-testid="inventory-opening-location-select" value={defaultLocationCode} onChange={(event) => { setDefaultLocationCode(event.target.value); invalidateDraft(); setResolvedRows([]); }} disabled={!selectedWarehouseId || busy === 'locations'}><option value="">Không chọn — lấy theo từng dòng CSV</option>{locationOptions.map((location) => <option key={location.id} value={location.code}>{location.code} — {location.name}</option>)}</select><small>Dòng CSV có Vị trí sẽ ưu tiên vị trí của dòng đó.</small></label>
          <label><span>Mã đợt dữ liệu *</span><input value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); invalidateDraft(); }} placeholder="Ví dụ TONDAUKY-2026-08" data-testid="inventory-opening-source-key-input" /></label>
          <label><span>Ngày ghi nhận</span><input type="date" value={documentDate} onChange={(event) => { setDocumentDate(event.target.value); invalidateDraft(); }} data-testid="inventory-opening-document-date-input" /></label>
          <label><span>Tệp đã chọn</span><input value={filename || 'Chưa chọn tệp'} readOnly /></label>
        </div>
        <p className={styles.helper}>Mã kho được chọn từ danh mục kho; Mã tham chiếu SKU là mã SKU nghiệp vụ trong file, không phải ID hệ thống. Mẫu chỉ cần <strong>SKU</strong>, <strong>Số lượng</strong> và <strong>Vị trí</strong> khi cần. Sau khi đối chiếu, màn hình sẽ tự yêu cầu Mã lô/Hạn sử dụng đúng theo chính sách của SKU; không cần khai báo chính sách trong file tồn đầu kỳ.</p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}><div><h2>Xem trước dữ liệu</h2><p>{rows.length ? `${rows.length} dòng trong ${filename}` : 'Chưa có dữ liệu để xem trước.'}</p></div>{localErrors.length ? <span className={styles.badgeError}>{localErrors.length} dòng thiếu dữ liệu</span> : rows.length ? <span className={styles.badgeOk}>Sẵn sàng kiểm tra</span> : null}</div>
        <div className={styles.tableWrap}><table><thead><tr><th>Dòng</th><th>Kho</th><th>Vị trí</th><th>SKU</th><th>Tên hàng</th><th>Số lượng</th><th>Chính sách</th><th>Lô hàng</th><th>Hạn dùng</th><th>Trạng thái</th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={10} className={styles.empty}>Chọn tệp CSV để hiển thị dữ liệu.</td></tr> : effectiveRows.slice(0, 100).map((row, index) => {
            const issue = localErrors.find((item) => item.line === index + 2);
            const canonical = resolvedRows[index] ?? validation?.rows[index];
            const serverIssue = validation?.rowErrors.find((item) => item.lineNumber === index + 1);
            const lotRequired = canonical?.lotTrackingMode === 'REQUIRED';
            const expiryMode = canonical?.expiryTrackingMode;
            const policyResolved = Boolean(canonical?.baseVariantId && canonical?.lotTrackingMode);
            return <tr key={`${index}-${row.sku}-${row.locationCode}`}>
              <td>{index + 2}</td>
              <td>{canonical?.warehouseCode ? `${canonical.warehouseCode} — ${canonical.warehouseName ?? ''}` : selectedWarehouse ? `${selectedWarehouse.code} — ${selectedWarehouse.name}` : 'Chưa chọn'}</td>
              <td>{canonical?.locationCode ? `${canonical.locationCode}${canonical.locationName ? ` — ${canonical.locationName}` : ''}` : row.locationCode || '—'}</td>
              <td>{canonical?.sourceSku || row.sku || '—'}</td>
              <td>{canonical?.productName || '—'}</td>
              <td>{displayQuantity(canonical?.sourceQuantity || row.sourceQuantity)}</td>
              <td><div className={styles.policyStack}><strong>{lotPolicyLabel(canonical)}</strong><span className={styles.policyHint}>{expiryPolicyLabel(canonical)}{canonical?.locationRequired ? ' · Bắt buộc vị trí' : ''}</span></div></td>
              <td>{policyResolved && lotRequired ? <input className={styles.inlineInput} value={row.lotCode} onChange={(event) => updateRow(index, { lotCode: event.target.value })} placeholder="Nhập mã lô" aria-label={`Mã lô dòng ${index + 2}`} /> : policyResolved ? <span className={styles.policyHint}>Không áp dụng</span> : <span className={styles.policyHint}>{row.lotCode || 'Đối chiếu SKU trước'}</span>}</td>
              <td>{policyResolved && expiryMode && expiryMode !== 'NONE' ? <input className={styles.inlineInput} type="date" value={row.expiryDate} onChange={(event) => updateRow(index, { expiryDate: event.target.value })} aria-label={`Hạn dùng dòng ${index + 2}`} /> : policyResolved ? <span className={styles.policyHint}>Không áp dụng</span> : <span className={styles.policyHint}>{row.expiryDate || 'Đối chiếu SKU trước'}</span>}</td>
              <td>{issue ? <span className={styles.rowError}>{issue.message}</span> : serverIssue ? <span className={styles.rowError}>{serverIssue.message}</span> : validation ? <span className={styles.badgeOk}>Đã đối chiếu</span> : resolvedRows.length ? 'Cần kiểm tra lại sau khi sửa' : 'Hợp lệ sơ bộ'}</td>
            </tr>;
          })}
        </tbody></table></div>
        {localErrors.length ? <div><h3>Các dòng cần sửa</h3><ul className={styles.errorList}>{localErrors.map((item) => <li key={item.line}>Dòng {item.line}: {item.message}</li>)}</ul></div> : null}
      </section>

      <section className={styles.gridTwo}>
        <article className={styles.card}><h2>Kết quả kiểm tra</h2>{!validation ? <p className={styles.empty}>Chưa kiểm tra tệp hoặc dữ liệu vừa được chỉnh sửa.</p> : validation.rowErrors.length ? <ul className={styles.errorList}>{validation.rowErrors.map((item) => <li key={`${item.lineNumber}-${item.code}`}>Dòng {item.lineNumber + 1}: {item.message}</li>)}</ul> : <div className={styles.summary}><strong>{validation.totals.rowCount} dòng hợp lệ</strong><span>Tổng số lượng theo đơn vị nhập: {displayQuantity(validation.totals.sourceQuantityTotal)}</span><span>Quy đổi tồn kho: {displayQuantity(validation.totals.baseQuantityTotal)}</span><span>Kho: {selectedWarehouse ? `${selectedWarehouse.code} — ${selectedWarehouse.name}` : '—'}</span></div>}</article>
        <article className={styles.card}><h2>Lịch sử nhập tồn đầu kỳ</h2><div className={styles.tableWrap}><table><thead><tr><BusinessTableSequenceHeader /><th>Mã đợt</th><th>Tệp nguồn</th><th>Số dòng</th><th>Thời gian</th></tr></thead><tbody>{imports.length === 0 ? <tr><td colSpan={5} className={styles.empty}>Chưa có lần nhập nào.</td></tr> : imports.map((item, rowIndex) => <tr key={item.id}><BusinessTableSequenceCell rowIndex={rowIndex} /><td>{item.source_key}</td><td>{item.source_filename || '—'}</td><td>{item.row_count}</td><td>{formatDateTime(item.created_at)}</td></tr>)}</tbody></table></div></article>
      </section>
    </main>
  </AppShell>;
}
