import { type ApiEnvelope, type RowMap, labelFor, normalizeHeader, humanizeMessage } from './data-exchange-model';

export function optional(value: string | undefined) { const text = String(value ?? '').trim(); return text || null; }
export function exactQuantity(value: string, field: string, scale = 12) {
  const normalized = value.trim();
  const pattern = new RegExp(`^(0|[1-9]\\d{0,13})(?:\\.\\d{1,${scale}})?$`);
  if (!pattern.test(normalized)) throw new Error(`${labelFor(field)} phải là số không âm, tối đa ${scale} số lẻ.`);
  return normalized;
}
export function csvEscape(value: unknown) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
export function toCsv(headers: string[], rows: string[][]) { return `\uFEFF${[headers.map(labelFor), ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')}`; }
export function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.replace(/\r$/, '')); if (row.some((value) => value.trim())) rows.push(row); return rows;
}
export function mapRows(rows: string[][]): RowMap[] {
  if (rows.length < 2) throw new Error('Tệp chưa có dòng dữ liệu.');
  const headers = rows[0].map(normalizeHeader);
  if (headers.some((value) => !value) || new Set(headers.map((value) => value.toLowerCase())).size !== headers.length) throw new Error('Tên cột đang trống hoặc bị trùng.');
  return rows.slice(1).filter((row) => row.some((value) => value.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()])));
}
export function requireColumns(rows: RowMap[], required: readonly string[]) {
  if (!rows.length) throw new Error('Tệp chưa có dữ liệu.');
  const keys = new Set(Object.keys(rows[0])); const missing = required.filter((key) => !keys.has(key));
  if (missing.length) throw new Error(`Tệp đang thiếu cột: ${missing.map(labelFor).join(', ')}.`);
}
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error(humanizeMessage(payload?.error?.message || payload?.error?.code || 'Yêu cầu không thành công'));
  return payload.data as T;
}
export function idempotency(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
export function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = href; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(href);
}
export async function exportTable(filename: string, sheetName: string, headers: string[], rows: string[][], format: 'xlsx' | 'csv') {
  if (format === 'csv') { downloadBlob(new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }), filename.replace(/\.xlsx$/i, '.csv')); return; }
  const response = await fetch('/api/data-exchange/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheetName, headers: headers.map(labelFor), rows }) });
  if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message || 'Không tạo được tệp Excel.'); }
  downloadBlob(await response.blob(), filename);
}
export async function readTable(file: File) {
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    const response = await fetch('/api/data-exchange/xlsx', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: await file.arrayBuffer() });
    const payload = await response.json().catch(() => null) as { data?: { rows?: string[][] }; error?: { message?: string } } | null;
    if (!response.ok || !payload?.data?.rows) throw new Error(payload?.error?.message || 'Không đọc được tệp Excel.');
    return mapRows(payload.data.rows);
  }
  return mapRows(parseCsv(await file.text()));
}
export function trimDecimal(value: string) {
  const normalized = String(value ?? '0').trim(); if (!normalized.includes('.')) return normalized;
  const next = normalized.replace(/0+$/, '').replace(/\.$/, ''); return next === '-0' ? '0' : next;
}
export function scaled12(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Số lượng tồn không hợp lệ: ${value}`);
  const absolute = BigInt(match[2]) * 1_000_000_000_000n + BigInt((match[3] ?? '').padEnd(12, '0')); return match[1] ? -absolute : absolute;
}
export function formatScaled12(value: bigint) {
  const negative = value < 0n; const absolute = negative ? -value : value; const whole = absolute / 1_000_000_000_000n;
  const fraction = String(absolute % 1_000_000_000_000n).padStart(12, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
export function scopeKey(warehouse: string, location: string | null, sku: string, lot: string | null) {
  return [warehouse.trim().toUpperCase(), (location ?? '').trim().toUpperCase(), sku.trim().toUpperCase(), (lot ?? '').trim().toUpperCase()].join('|');
}
