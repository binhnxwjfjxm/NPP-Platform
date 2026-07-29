'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { formatDateTime, type OpeningBalanceImport } from '../../../lib/inventory-types';
import styles from './opening-balance-csv-workspace.module.css';

type CsvRow = {
  warehouseId: string;
  locationId: string;
  sourceVariantId: string;
  sourceQuantity: string;
  lotCode: string;
  manufacturedDate: string;
  expiryDate: string;
  supplierLotReference: string;
  sourceLineReference: string;
};

type ValidationResult = {
  rowErrors: Array<{ lineNumber: number; code: string; message: string }>;
  rows: Array<Record<string, unknown>>;
  totals: { rowCount: number; sourceQuantityTotal: string; baseQuantityTotal: string };
};

type Envelope<T> = { data?: T; error?: { message?: string; code?: string } };
type WorkspaceProps = { initialImports: OpeningBalanceImport[]; initialError?: string | null };

const CSV_COLUMNS = [
  { key: 'warehouseId', label: 'Mã kho' },
  { key: 'locationId', label: 'Mã vị trí' },
  { key: 'sourceVariantId', label: 'Mã tham chiếu SKU' },
  { key: 'sourceQuantity', label: 'Số lượng' },
  { key: 'lotCode', label: 'Mã lô' },
  { key: 'manufacturedDate', label: 'Ngày sản xuất' },
  { key: 'expiryDate', label: 'Hạn sử dụng' },
  { key: 'supplierLotReference', label: 'Mã lô nhà cung cấp' },
  { key: 'sourceLineReference', label: 'Tham chiếu dòng' },
] as const;
const HEADERS = CSV_COLUMNS.map((column) => column.key);
const HEADER_ALIASES = Object.fromEntries(CSV_COLUMNS.flatMap((column) => [[column.label, column.key], [column.key, column.key]]));

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(value.trim()); value = '';
    } else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]).map((header) => HEADER_ALIASES[header.trim()] ?? header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? ''])) as Partial<CsvRow>;
    return Object.fromEntries(HEADERS.map((header) => [header, row[header as keyof CsvRow] ?? ''])) as CsvRow;
  });
}

function apiRows(rows: CsvRow[]) {
  return rows.map((row, index) => ({
    warehouseId: row.warehouseId,
    locationId: row.locationId || null,
    sourceVariantId: row.sourceVariantId,
    sourceQuantity: row.sourceQuantity,
    lotCode: row.lotCode || null,
    manufacturedDate: row.manufacturedDate || null,
    expiryDate: row.expiryDate || null,
    supplierLotReference: row.supplierLotReference || null,
    sourceLineReference: row.sourceLineReference || `Dong-${index + 2}`,
    metadata: {},
  }));
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
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  return payload.data;
}

function downloadTemplate() {
  const content = CSV_COLUMNS.map((column) => column.label).join(',');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mau-ton-dau-ky.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function OpeningBalanceCsvWorkspace({ initialImports, initialError = null }: WorkspaceProps) {
  const [sourceKey, setSourceKey] = useState('');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [filename, setFilename] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationChecksum, setValidationChecksum] = useState<string | null>(null);
  const [imports, setImports] = useState(initialImports);
  const [busy, setBusy] = useState<'validate' | 'post' | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    initialError ? { kind: 'error', text: initialError } : null,
  );
  const draftRevision = useRef(0);

  const localErrors = useMemo(() => rows.map((row, index) => {
    const missing: string[] = [];
    if (!row.warehouseId) missing.push('kho');
    if (!row.sourceVariantId) missing.push('mã hàng');
    if (!row.sourceQuantity) missing.push('số lượng');
    return missing.length ? { line: index + 2, message: `Thiếu ${missing.join(', ')}` } : null;
  }).filter(Boolean) as Array<{ line: number; message: string }>, [rows]);

  useEffect(() => {
    let active = true;
    requestJson<OpeningBalanceImport[]>('/api/inventory/opening-balances?limit=200')
      .then((next) => {
        if (!active) return;
        setImports(next);
        if (initialError) setMessage(null);
      })
      .catch((error) => {
        if (!active) return;
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được lịch sử nhập tồn đầu kỳ.' });
      });
    return () => { active = false; };
  }, [initialError]);

  function invalidateDraft() {
    draftRevision.current += 1;
    setValidation(null);
    setValidationChecksum(null);
  }

  async function chooseFile(file: File) {
    invalidateDraft();
    setRows([]); setMessage(null); setFilename('');
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMessage({ kind: 'error', text: 'Chỉ nhận tệp CSV UTF-8. Trong Excel, chọn “Lưu thành CSV UTF-8” rồi tải lại.' });
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length === 0) {
      setMessage({ kind: 'error', text: 'Tệp không có dòng dữ liệu hoặc sai cấu trúc mẫu.' });
      return;
    }
    setFilename(file.name);
    setRows(parsed);
    setMessage({ kind: 'success', text: `Đã đọc ${parsed.length} dòng. Kiểm tra bảng xem trước trước khi xác nhận.` });
  }

  function normalizedBody() {
    return {
      sourceKey: sourceKey.trim().toUpperCase(),
      sourceFilename: filename || null,
      documentDate,
      metadata: { importMethod: 'csv-upload', originalFilename: filename },
      rows: apiRows(rows),
    };
  }

  async function validate() {
    if (!sourceKey.trim()) { setMessage({ kind: 'error', text: 'Nhập mã đợt dữ liệu để tránh nhập trùng.' }); return; }
    if (!rows.length) { setMessage({ kind: 'error', text: 'Chọn tệp CSV trước khi kiểm tra.' }); return; }
    if (localErrors.length) { setMessage({ kind: 'error', text: 'Tệp còn dòng thiếu dữ liệu bắt buộc. Xem danh sách dòng lỗi bên dưới.' }); return; }
    const revision = draftRevision.current;
    setBusy('validate'); setMessage(null); setValidation(null); setValidationChecksum(null);
    try {
      const body = normalizedBody();
      const contentChecksum = await checksum(body);
      const result = await requestJson<ValidationResult>('/api/inventory/opening-balances/validate', { method: 'POST', body: JSON.stringify({ ...body, contentChecksum }) });
      if (revision !== draftRevision.current) return;
      setValidation(result);
      setValidationChecksum(contentChecksum);
      setMessage(result.rowErrors.length ? { kind: 'error', text: 'Có dòng chưa hợp lệ. Xem danh sách lỗi bên dưới.' } : { kind: 'success', text: 'Dữ liệu hợp lệ. Có thể xác nhận nhập tồn.' });
    } catch (error) {
      if (revision !== draftRevision.current) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không kiểm tra được tệp.' });
    } finally { setBusy(null); }
  }

  async function post() {
    if (!validation || validation.rowErrors.length || !validationChecksum) return;
    setBusy('post'); setMessage(null);
    try {
      const body = normalizedBody();
      const contentChecksum = await checksum(body);
      if (contentChecksum !== validationChecksum) {
        invalidateDraft();
        setMessage({ kind: 'error', text: 'Dữ liệu đã thay đổi sau lần kiểm tra. Vui lòng kiểm tra lại trước khi xác nhận.' });
        return;
      }
      await requestJson('/api/inventory/opening-balances/post', {
        method: 'POST',
        headers: { 'Idempotency-Key': `opening-${body.sourceKey}-${contentChecksum.slice(0, 16)}` },
        body: JSON.stringify({ ...body, contentChecksum }),
      });
      const next = await requestJson<OpeningBalanceImport[]>('/api/inventory/opening-balances?limit=200');
      draftRevision.current += 1;
      setImports(next); setRows([]); setValidation(null); setValidationChecksum(null); setFilename(''); setSourceKey('');
      setMessage({ kind: 'success', text: 'Đã ghi nhận tồn đầu kỳ thành công.' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không ghi nhận được tồn đầu kỳ.' });
    } finally { setBusy(null); }
  }

  return <AppShell title="Thiết lập tồn đầu kỳ" subtitle="Nhập dữ liệu từ Excel bằng tệp CSV, xem trước lỗi rồi mới ghi nhận.">
    <main className={styles.page} data-testid="inventory-page">
      <header className={styles.header}>
        <div><p className={styles.kicker}>TỒN KHO</p><h1>Nhập tồn đầu kỳ</h1><p>Luồng 4 bước rõ ràng: tải mẫu, chọn tệp, kiểm tra, xác nhận.</p></div>
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
          <label><span>Mã đợt dữ liệu</span><input value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); invalidateDraft(); }} placeholder="Mã đợt nhập" data-testid="inventory-opening-source-key-input" /></label>
          <label><span>Ngày ghi nhận</span><input type="date" value={documentDate} onChange={(event) => { setDocumentDate(event.target.value); invalidateDraft(); }} data-testid="inventory-opening-document-date-input" /></label>
          <label><span>Tệp đã chọn</span><input value={filename || 'Chưa chọn tệp'} readOnly /></label>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}><div><h2>Xem trước dữ liệu</h2><p>{rows.length ? `${rows.length} dòng trong ${filename}` : 'Chưa có dữ liệu để xem trước.'}</p></div>{localErrors.length ? <span className={styles.badgeError}>{localErrors.length} dòng thiếu dữ liệu</span> : rows.length ? <span className={styles.badgeOk}>Sẵn sàng kiểm tra</span> : null}</div>
        <div className={styles.tableWrap}><table><thead><tr><th>Dòng</th><th>Kho</th><th>Vị trí</th><th>Mã hàng</th><th>Số lượng</th><th>Lô hàng</th><th>Hạn dùng</th><th>Trạng thái</th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={8} className={styles.empty}>Chọn tệp CSV để hiển thị dữ liệu.</td></tr> : rows.slice(0, 100).map((row, index) => {
            const issue = localErrors.find((item) => item.line === index + 2);
            return <tr key={index}><td>{index + 2}</td><td>{row.warehouseId || '—'}</td><td>{row.locationId || '—'}</td><td>{row.sourceVariantId || '—'}</td><td>{row.sourceQuantity || '—'}</td><td>{row.lotCode || '—'}</td><td>{row.expiryDate || '—'}</td><td>{issue ? <span className={styles.rowError}>{issue.message}</span> : 'Hợp lệ sơ bộ'}</td></tr>;
          })}
        </tbody></table></div>
        {localErrors.length ? <div><h3>Các dòng cần sửa</h3><ul className={styles.errorList}>{localErrors.map((item) => <li key={item.line}>Dòng {item.line}: {item.message}</li>)}</ul></div> : null}
      </section>

      <section className={styles.gridTwo}>
        <article className={styles.card}><h2>Kết quả kiểm tra</h2>{!validation ? <p className={styles.empty}>Chưa kiểm tra tệp.</p> : validation.rowErrors.length ? <ul className={styles.errorList}>{validation.rowErrors.map((item) => <li key={`${item.lineNumber}-${item.code}`}>Dòng {item.lineNumber + 1}: {item.message}</li>)}</ul> : <div className={styles.summary}><strong>{validation.totals.rowCount} dòng hợp lệ</strong><span>Tổng số lượng nhập: {validation.totals.sourceQuantityTotal}</span><span>Quy đổi tồn kho: {validation.totals.baseQuantityTotal}</span></div>}</article>
        <article className={styles.card}><h2>Lịch sử nhập tồn đầu kỳ</h2><div className={styles.tableWrap}><table><thead><tr><th>Mã đợt</th><th>Tệp nguồn</th><th>Số dòng</th><th>Thời gian</th></tr></thead><tbody>{imports.length === 0 ? <tr><td colSpan={4} className={styles.empty}>Chưa có lần nhập nào.</td></tr> : imports.map((item) => <tr key={item.id}><td>{item.source_key}</td><td>{item.source_filename || '—'}</td><td>{item.row_count}</td><td>{formatDateTime(item.created_at)}</td></tr>)}</tbody></table></div></article>
      </section>
    </main>
  </AppShell>;
}
