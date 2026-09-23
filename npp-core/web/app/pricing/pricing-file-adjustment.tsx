'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useRef, useState } from 'react';
import Modal from '../components/modal';
import type { PriceList } from '../../lib/pricing-types';
import { exportTable, readTable, requireColumns } from '../operations/data-exchange/data-exchange-file-utils';
import styles from './pricing-bulk-overlay.module.css';

type RowMap = Record<string, string>;
type ApplyMode = 'NOW' | 'SCHEDULED';
type ImportResult = { itemsCreated: number; itemsUpdated: number; itemsReplaced?: number; totalItems: number };
type Props = { priceLists: PriceList[]; defaultPriceListId?: string; onApplied?: (priceListId: string) => void | Promise<void> };
const COLUMNS = ['sku', 'amountMinor'] as const;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string; code?: string } } | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error(payload?.error?.message || payload?.error?.code || 'Yêu cầu không thành công');
  return payload.data as T;
}
function apiDate(value: string) { return value ? new Date(value).toISOString() : null; }

export default function PricingFileAdjustment({ priceLists, defaultPriceListId = '', onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState('');
  const [applyMode, setApplyMode] = useState<ApplyMode>('NOW');
  const [applyAt, setApplyAt] = useState('');
  const [rows, setRows] = useState<RowMap[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const operationKeyRef = useRef<string | null>(null);
  const lists = priceLists.filter((list) => list.is_active);

  useEffect(() => { operationKeyRef.current = null; }, [selectedListId, applyMode, applyAt, rows]);

  function preferredListId() {
    return lists.some((list) => list.id === defaultPriceListId) ? defaultPriceListId : lists.find((list) => list.list_type === 'BASE')?.id ?? lists[0]?.id ?? '';
  }
  function openImport() {
    setSelectedListId(preferredListId()); setApplyMode('NOW'); setApplyAt(''); setRows([]); setFileName(''); setMessage(''); setError(''); setOpen(true);
  }
  async function downloadTemplate() {
    setBusy(true); setError('');
    try { await exportTable('mau-dieu-chinh-gia.xlsx', 'Điều chỉnh giá', [...COLUMNS], [], 'xlsx'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được file mẫu.'); }
    finally { setBusy(false); }
  }
  async function loadFile(file: File) {
    setBusy(true); setError(''); setMessage('');
    try {
      const parsed = await readTable(file, COLUMNS);
      requireColumns(parsed, COLUMNS);
      if (parsed.length > 2000) throw new Error('Mỗi lần điều chỉnh tối đa 2.000 SKU.');
      const seen = new Set<string>();
      const normalized = parsed.map((row, index) => {
        const sku = String(row.sku ?? '').trim().toUpperCase();
        const amountMinor = String(row.amountMinor ?? '').trim();
        if (!sku) throw new Error(`Dòng ${index + 2}: SKU đang trống.`);
        if (seen.has(sku)) throw new Error(`Dòng ${index + 2}: SKU ${sku} bị lặp trong file.`);
        seen.add(sku);
        if (!/^(?:0|[1-9]\d{0,18})$/.test(amountMinor)) throw new Error(`Dòng ${index + 2} · SKU ${sku}: Giá bán phải là số nguyên không âm.`);
        return { sku, amountMinor };
      });
      setRows(normalized); setFileName(file.name);
      setMessage(`Đã đọc ${normalized.length} SKU. Kiểm tra bảng xem trước rồi xác nhận.`);
    } catch (cause) {
      setRows([]); setFileName(''); setError(cause instanceof Error ? cause.message : 'Không đọc được file giá.');
    } finally { setBusy(false); }
  }
  async function confirm() {
    const list = lists.find((item) => item.id === selectedListId) ?? null;
    if (!list) { setError('Chọn bảng giá cần điều chỉnh.'); return; }
    if (!rows.length) { setError('Chọn file có dữ liệu giá.'); return; }
    if (applyMode === 'SCHEDULED' && !applyAt) { setError('Chọn ngày áp dụng giá mới.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const operationKey = operationKeyRef.current ?? createIdempotencyKey('pricing_adjust_file');
      operationKeyRef.current = operationKey;
      const result = await requestJson<ImportResult>('/api/pricing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify({
          matchBySku: true, replaceFrom: true, applyAt: applyMode === 'SCHEDULED' ? apiDate(applyAt) : null, sourceBatchId: operationKey,
          items: rows.map((row) => ({
            priceListCode: list.code, sku: row.sku, adjustmentType: 'FIXED_PRICE', amountMinor: row.amountMinor,
            minQuantity: '0', maxQuantity: null, sourceKind: 'IMPORT', externalRuleCode: 'PRICE_FILE_ADJUSTMENT', note: null, isActive: true,
          })),
        }),
      });
      operationKeyRef.current = null; setRows([]); setFileName('');
      setMessage(`Đã điều chỉnh ${result.totalItems} SKU${applyMode === 'NOW' ? ' và áp dụng ngay.' : ' theo ngày đã chọn.'}`);
      await onApplied?.(list.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không cập nhật được giá từ file.'); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className={styles.secondaryButton} onClick={() => void downloadTemplate()} disabled={busy} data-testid="download-pricing-template">Tải file mẫu</button>
    <button type="button" className={styles.secondaryButton} onClick={openImport} disabled={busy} data-testid="open-pricing-file-adjustment">Nhập từ file</button>
    <Modal open={open} title="Điều chỉnh giá từ file" description="File chỉ cần SKU và Giá bán (VND). Chỉ các SKU có trong file mới thay đổi." onClose={() => { if (!busy) setOpen(false); }} testId="pricing-file-adjustment-modal" size="workspace"
      footer={<><button type="button" className={styles.secondaryButton} onClick={() => setOpen(false)} disabled={busy}>Đóng</button><button type="button" className={styles.primaryButton} onClick={() => void confirm()} disabled={busy || !rows.length}>{busy ? 'Đang cập nhật…' : `Xác nhận ${rows.length || ''} SKU`}</button></>}>
      {error ? <div className={styles.errorNotice} role="alert">{error}</div> : null}
      {message ? <div className={styles.notice} role="status">{message}</div> : null}
      <div className={styles.scopeGrid}>
        <label>Bảng giá<select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}><option value="">Chọn bảng giá</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.code} — {list.name}</option>)}</select></label>
        <label>Thời điểm áp dụng<select value={applyMode} onChange={(event) => setApplyMode(event.target.value as ApplyMode)}><option value="NOW">Cập nhật ngay</option><option value="SCHEDULED">Áp dụng từ ngày</option></select></label>
        {applyMode === 'SCHEDULED' ? <label>Ngày áp dụng<input type="datetime-local" value={applyAt} onChange={(event) => setApplyAt(event.target.value)} /></label> : null}
      </div>
      <div className={styles.fileBox}>
        <input ref={inputRef} type="file" accept=".xlsx,.csv" className={styles.hiddenInput} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void loadFile(selected); event.currentTarget.value = ''; }} />
        <button type="button" className={styles.primaryButton} onClick={() => inputRef.current?.click()} disabled={busy}>Chọn file</button>
        <span>{fileName || 'Chưa chọn file'}</span>
      </div>
      {rows.length ? <div className={styles.filePreview}><table><thead><tr><th>SKU</th><th>Giá mới</th></tr></thead><tbody>{rows.slice(0, 200).map((row) => <tr key={row.sku}><td><strong>{row.sku}</strong></td><td>{new Intl.NumberFormat('vi-VN').format(BigInt(row.amountMinor))} ₫</td></tr>)}</tbody></table>{rows.length > 200 ? <p>Đang hiển thị 200/{rows.length} dòng để kiểm tra nhanh.</p> : null}</div> : null}
    </Modal>
  </>;
}
