'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { readSpreadsheetRows } from '../../../lib/spreadsheet-reader';
import styles from './manual-inbound-workspace.module.css';

type WarehouseOption = { id: string; code: string; name: string };
type LocationOption = { id: string; code: string; name: string; locationType: string };
type DraftRow = {
  sku: string;
  sourceQuantity: string;
  unitCost: string;
  locationCode: string;
  lotCode: string;
  manufacturedDate: string;
  expiryDate: string;
  supplierLotReference: string;
};
type PreviewRow = DraftRow & {
  lineNumber: number;
  sourceLineNumbers: number[];
  warehouseCode?: string;
  warehouseName?: string;
  productCode?: string;
  productName?: string;
  sourceUnitCode?: string;
  baseSku?: string;
  baseQuantity?: string;
  locationName?: string;
  lotTrackingMode?: 'NONE' | 'REQUIRED' | null;
  expiryTrackingMode?: 'NONE' | 'OPTIONAL' | 'REQUIRED' | null;
  locationRequired?: boolean;
  costSource?: 'ENTERED' | 'CURRENT' | null;
  requiredFields: Array<'LOCATION' | 'LOT' | 'EXPIRY' | 'COST'>;
  status: 'READY' | 'NEEDS_ATTENTION';
};
type PreviewResult = {
  ready: boolean;
  stockUnchanged: boolean;
  rowErrors: Array<{ lineNumber: number; code: string; message: string }>;
  rows: PreviewRow[];
  totals: {
    inputRowCount: number;
    previewRowCount: number;
    mergedDuplicateCount: number;
    sourceQuantityTotal: string;
    readyRowCount: number;
    attentionRowCount: number;
  };
};
type HistoryDocument = {
  id: string;
  inboundType: InboundType;
  warehouseCode: string;
  warehouseName: string;
  documentDate: string;
  referenceNumber: string | null;
  note: string | null;
  createdAt: string;
  status: 'POSTED' | 'REVERSED';
  reversalDate: string | null;
  reversalNote: string | null;
};
type Envelope<T> = { data?: T; error?: { message?: string; code?: string } };
type ResolvedItem = { sku: string; productName?: string; sourceUnitCode?: string };
type PendingMutation = { key: string; body: string };
type InboundType = 'MANUAL_RECEIPT' | 'OFF_DOCUMENT_CUSTOMER_RETURN' | 'RECOVERY' | 'OTHER';

const ADMIN_CONFIGURATION_CODES = new Set([
  'INVENTORY_POLICY_UNAVAILABLE',
  'SKU_AMBIGUOUS',
  'BASE_VARIANT_NOT_AVAILABLE',
  'CONVERSION_NOT_CONFIGURED',
  'TRACKING_POLICY_NOT_FOUND',
]);

const INBOUND_TYPES: Array<{ value: InboundType; label: string }> = [
  { value: 'MANUAL_RECEIPT', label: 'Nhập hàng thủ công' },
  { value: 'OFF_DOCUMENT_CUSTOMER_RETURN', label: 'Khách trả ngoài chứng từ' },
  { value: 'RECOVERY', label: 'Hàng thu hồi' },
  { value: 'OTHER', label: 'Khác' },
];

const HEADER_ALIASES: Record<string, keyof DraftRow> = {
  sku: 'sku',
  SKU: 'sku',
  sourceQuantity: 'sourceQuantity',
  'Số lượng': 'sourceQuantity',
  unitCost: 'unitCost',
  'Giá vốn': 'unitCost',
  locationCode: 'locationCode',
  'Vị trí': 'locationCode',
  lotCode: 'lotCode',
  'Mã lô': 'lotCode',
  manufacturedDate: 'manufacturedDate',
  'Ngày sản xuất': 'manufacturedDate',
  expiryDate: 'expiryDate',
  'Hạn sử dụng': 'expiryDate',
  supplierLotReference: 'supplierLotReference',
  'Mã lô nhà cung cấp': 'supplierLotReference',
};

function emptyRow(): DraftRow {
  return {
    sku: '', sourceQuantity: '', unitCost: '', locationCode: '', lotCode: '',
    manufacturedDate: '', expiryDate: '', supplierLotReference: '',
  };
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

function rowsFromSheet(sheet: string[][]): DraftRow[] {
  if (sheet.length < 2) throw new Error('Tệp cần có dòng tiêu đề và ít nhất một dòng dữ liệu.');
  const headers = sheet[0].map((header) => HEADER_ALIASES[String(header ?? '').trim()] ?? null);
  if (!headers.includes('sku') || !headers.includes('sourceQuantity')) {
    throw new Error('Tệp cần có hai cột bắt buộc: SKU và Số lượng.');
  }
  const rows = sheet.slice(1).filter((cells) => cells.some((cell) => String(cell ?? '').trim())).map((cells) => {
    const row = emptyRow();
    headers.forEach((field, index) => {
      if (field) row[field] = String(cells[index] ?? '').trim();
    });
    return row;
  });
  if (!rows.length) throw new Error('Tệp chưa có dòng dữ liệu.');
  if (rows.length > 500) throw new Error('Mỗi lần kiểm tra tối đa 500 dòng.');
  return rows;
}

function downloadTemplate() {
  const blob = new Blob(['\uFEFFSKU,Số lượng,Giá vốn\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mau-nhap-kho-thu-cong.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function previewStatusLabel(row: PreviewRow, errors: Array<{ code: string }>) {
  if (row.status === 'READY') return 'Sẵn sàng';
  if (errors.some((error) => ADMIN_CONFIGURATION_CODES.has(error.code))) return 'Cần quản trị';
  if (row.requiredFields.length > 0) return 'Cần bổ sung';
  return 'Cần chỉnh';
}

function formatCost(value: string | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value || '—';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(number);
}

function inboundTypeLabel(value: InboundType) {
  return INBOUND_TYPES.find((item) => item.value === value)?.label ?? value;
}

function displayDate(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

export default function ManualInboundWorkspace() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [inboundType, setInboundType] = useState<InboundType>('MANUAL_RECEIPT');
  const [documentDate, setDocumentDate] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [resolvedItems, setResolvedItems] = useState<Record<number, ResolvedItem>>({});
  const [busy, setBusy] = useState<'warehouses' | 'locations' | 'file' | 'preview' | 'confirm' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryDocument[]>([]);
  const [historyType, setHistoryType] = useState<'' | InboundType>('');
  const [historyReference, setHistoryReference] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMessage, setHistoryMessage] = useState('');
  const [reverseDraft, setReverseDraft] = useState<{ documentId: string; label: string; documentDate: string; reasonNote: string } | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingConfirm = useRef<PendingMutation | null>(null);
  const pendingReverse = useRef<PendingMutation | null>(null);

  const errorsByLine = useMemo(() => {
    const map = new Map<number, Array<{ code: string; message: string }>>();
    for (const error of preview?.rowErrors ?? []) {
      map.set(error.lineNumber, [...(map.get(error.lineNumber) ?? []), { code: error.code, message: error.message }]);
    }
    return map;
  }, [preview]);

  function operatorPayload() {
    return {
      warehouseId,
      inboundType,
      documentDate,
      referenceNumber: referenceNumber.trim() || null,
      note: note.trim() || null,
      rows: rows.map((row) => ({
        sku: row.sku.trim(),
        sourceQuantity: row.sourceQuantity.trim(),
        unitCost: row.unitCost.trim() || null,
        locationCode: row.locationCode.trim() || null,
        lotCode: row.lotCode.trim() || null,
        manufacturedDate: row.manufacturedDate || null,
        expiryDate: row.expiryDate || null,
        supplierLotReference: row.supplierLotReference.trim() || null,
      })),
    };
  }

  function invalidate() {
    setPreview(null);
    setPreviewDirty(false);
    pendingConfirm.current = null;
    setMessage(null);
  }

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
    if (Object.prototype.hasOwnProperty.call(patch, 'sku')) {
      setResolvedItems((current) => {
        const next = { ...current };
        delete next[index + 1];
        return next;
      });
    }
    invalidate();
  }

  function updateSourceLines(lineNumbers: number[], patch: Partial<DraftRow>) {
    const indexes = new Set(lineNumbers.map((line) => line - 1));
    setRows((current) => current.map((row, index) => indexes.has(index) ? { ...row, ...patch } : row));
    setPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.sourceLineNumbers.some((line) => lineNumbers.includes(line)) ? { ...row, ...patch } : row),
    } : current);
    setPreviewDirty(true);
    pendingConfirm.current = null;
    setMessage({ kind: 'info', text: 'Đã bổ sung thông tin. Bấm “Kiểm tra dữ liệu” lại trước khi xác nhận nhập.' });
  }

  async function loadHistory(type = historyType, reference = historyReference) {
    setHistoryBusy(true);
    setHistoryMessage('');
    try {
      const query = new URLSearchParams();
      if (type) query.set('inboundType', type);
      if (reference.trim()) query.set('referenceNumber', reference.trim());
      const data = await requestJson<HistoryDocument[]>(`/api/inventory/manual-inbounds/operator/history?${query.toString()}`);
      setHistory(data);
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : 'Không tải được lịch sử nhập kho.');
    } finally {
      setHistoryBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    setBusy('warehouses');
    requestJson<WarehouseOption[]>('/api/inventory/manual-inbounds/operator/warehouses')
      .then((data) => {
        if (!active) return;
        setWarehouses(data);
        if (data.length === 1) setWarehouseId(data[0].id);
      })
      .catch((error) => { if (active) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được danh sách kho.' }); })
      .finally(() => { if (active) setBusy(null); });
    void loadHistory('', '');
    return () => { active = false; };
    // History is loaded once with empty filters; later searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    setLocations([]);
    setPreview(null);
    setPreviewDirty(false);
    pendingConfirm.current = null;
    if (!warehouseId) return () => { active = false; };
    setBusy('locations');
    requestJson<{ warehouse: WarehouseOption; locations: LocationOption[] }>(`/api/inventory/manual-inbounds/operator/locations?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((data) => { if (active) setLocations(data.locations); })
      .catch((error) => { if (active) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được vị trí kho.' }); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [warehouseId]);

  async function chooseFile(file: File) {
    setBusy('file');
    setPreview(null);
    setPreviewDirty(false);
    pendingConfirm.current = null;
    setMessage(null);
    try {
      const parsed = rowsFromSheet(await readSpreadsheetRows(file));
      setRows(parsed);
      setResolvedItems({});
      setFilename(file.name);
      setMessage({ kind: 'info', text: `Đã đọc ${parsed.length} dòng từ ${file.name}. Hãy kiểm tra dữ liệu trước khi tiếp tục.` });
    } catch (error) {
      setFilename('');
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không đọc được tệp.' });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function checkData() {
    if (!warehouseId) { setMessage({ kind: 'error', text: 'Chọn kho nhập trước khi kiểm tra.' }); return; }
    if (!documentDate) { setMessage({ kind: 'error', text: 'Nhập ngày chứng từ trước khi kiểm tra.' }); return; }
    if (inboundType === 'OTHER' && !note.trim()) { setMessage({ kind: 'error', text: 'Loại “Khác” cần có ghi chú.' }); return; }
    if (!rows.length || rows.every((row) => !row.sku.trim() && !row.sourceQuantity.trim())) {
      setMessage({ kind: 'error', text: 'Nhập ít nhất một dòng SKU và số lượng.' });
      return;
    }
    setBusy('preview');
    setMessage(null);
    setPreview(null);
    setPreviewDirty(false);
    pendingConfirm.current = null;
    try {
      const result = await requestJson<PreviewResult>('/api/inventory/manual-inbounds/operator/preview', {
        method: 'POST',
        body: JSON.stringify(operatorPayload()),
      });
      setPreview(result);
      const nextResolved: Record<number, ResolvedItem> = {};
      for (const previewRow of result.rows) {
        if (!previewRow.productName && !previewRow.sourceUnitCode) continue;
        for (const sourceLineNumber of previewRow.sourceLineNumbers) {
          nextResolved[sourceLineNumber] = {
            sku: previewRow.sku,
            productName: previewRow.productName,
            sourceUnitCode: previewRow.sourceUnitCode,
          };
        }
      }
      setResolvedItems(nextResolved);
      setMessage({
        kind: 'info',
        text: result.ready
          ? 'Dữ liệu đã sẵn sàng. Kiểm tra chưa làm thay đổi tồn kho.'
          : 'Còn dòng cần xử lý. Kiểm tra chưa làm thay đổi tồn kho.',
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không kiểm tra được dữ liệu.' });
    } finally {
      setBusy(null);
    }
  }

  async function confirmInbound() {
    if (!preview?.ready || previewDirty) {
      setMessage({ kind: 'error', text: 'Hãy kiểm tra lại để tất cả dòng ở trạng thái Sẵn sàng trước khi xác nhận nhập.' });
      return;
    }
    let pending = pendingConfirm.current;
    if (!pending) {
      pending = {
        key: createIdempotencyKey('manual-inbound-confirm'),
        body: JSON.stringify(operatorPayload()),
      };
      pendingConfirm.current = pending;
    }
    setBusy('confirm');
    setMessage(null);
    try {
      await requestJson('/api/inventory/manual-inbounds/operator/confirm', {
        method: 'POST',
        headers: { 'Idempotency-Key': pending.key },
        body: pending.body,
      });
      pendingConfirm.current = null;
      setRows([emptyRow()]);
      setResolvedItems({});
      setFilename('');
      setReferenceNumber('');
      setNote('');
      setPreview(null);
      setPreviewDirty(false);
      setMessage({ kind: 'info', text: 'Đã xác nhận nhập kho. Tồn kho đã được cập nhật theo sổ kho.' });
      await loadHistory();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không xác nhận được nhập kho.' });
    } finally {
      setBusy(null);
    }
  }

  function openReverse(document: HistoryDocument) {
    pendingReverse.current = null;
    setReverseDraft({
      documentId: document.id,
      label: document.referenceNumber || `${inboundTypeLabel(document.inboundType)} · ${displayDate(document.documentDate)}`,
      documentDate: '',
      reasonNote: '',
    });
  }

  async function submitReverse() {
    if (!reverseDraft) return;
    if (!reverseDraft.documentDate) {
      setHistoryMessage('Chọn ngày đảo chứng từ.');
      return;
    }
    if (!reverseDraft.reasonNote.trim()) {
      setHistoryMessage('Nhập lý do đảo chứng từ.');
      return;
    }
    let pending = pendingReverse.current;
    if (!pending) {
      pending = {
        key: createIdempotencyKey('manual-inbound-reverse'),
        body: JSON.stringify({
          documentId: reverseDraft.documentId,
          documentDate: reverseDraft.documentDate,
          reasonNote: reverseDraft.reasonNote.trim(),
        }),
      };
      pendingReverse.current = pending;
    }
    setReverseBusy(true);
    setHistoryMessage('');
    try {
      await requestJson('/api/inventory/manual-inbounds/operator/reverse', {
        method: 'POST',
        headers: { 'Idempotency-Key': pending.key },
        body: pending.body,
      });
      pendingReverse.current = null;
      setReverseDraft(null);
      setHistoryMessage('Đã đảo chứng từ. Sổ kho giữ nguyên lịch sử và đã ghi bút toán đảo.');
      await loadHistory();
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : 'Không đảo được chứng từ.');
    } finally {
      setReverseBusy(false);
    }
  }

  return <AppShell
    title="Nhập kho thủ công"
    subtitle="Ghi nhận hàng thực tế vào Kho mà vẫn giữ đúng sổ kho, giá vốn và lịch sử chứng từ."
    kicker="Kho"
  >
    <div className={styles.stack}>
      <section className={styles.notice}>
        <strong>Kiểm tra trước khi xác nhận.</strong>
        <span>Chỉ thao tác “XÁC NHẬN NHẬP” mới làm thay đổi tồn kho.</span>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>Thông tin chứng từ</h2><p>Chọn đúng kho và lý do hàng vào kho.</p></div></div>
        <div className={styles.headerGrid}>
          <label><span>Kho nhập *</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); invalidate(); }} disabled={busy === 'warehouses'}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
          <label><span>Loại nhập *</span><select value={inboundType} onChange={(event) => { setInboundType(event.target.value as InboundType); invalidate(); }}>{INBOUND_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Ngày chứng từ *</span><input type="date" value={documentDate} onChange={(event) => { setDocumentDate(event.target.value); invalidate(); }} /></label>
          <label><span>Số chứng từ / hóa đơn tham chiếu</span><input value={referenceNumber} maxLength={160} onChange={(event) => { setReferenceNumber(event.target.value); invalidate(); }} placeholder="Không bắt buộc" /></label>
          <label className={styles.noteField}><span>Ghi chú {inboundType === 'OTHER' ? '*' : ''}</span><textarea value={note} maxLength={2000} onChange={(event) => { setNote(event.target.value); invalidate(); }} rows={2} placeholder={inboundType === 'OTHER' ? 'Nêu rõ lý do nhập' : 'Thông tin cần lưu kèm chứng từ'} /></label>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeading}>
          <div><h2>Hàng nhập</h2><p>Nhập trực tiếp hoặc lấy dữ liệu từ Excel/CSV. Hai cột bắt buộc là SKU và Số lượng.</p></div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={downloadTemplate}>Tải mẫu CSV cho Excel</button>
            <input ref={fileInput} className={styles.hiddenInput} type="file" accept=".xlsx,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseFile(file); }} />
            <button type="button" className={styles.secondary} onClick={() => fileInput.current?.click()} disabled={busy === 'file'}>{busy === 'file' ? 'Đang đọc tệp…' : 'Chọn tệp Excel/CSV'}</button>
          </div>
        </div>
        {filename ? <p className={styles.fileName}>Tệp đang dùng: <strong>{filename}</strong></p> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>#</th><th>SKU *</th><th>Tên sản phẩm</th><th>ĐVT</th><th>Số lượng *</th><th>Giá vốn</th><th /></tr></thead>
            <tbody>{rows.map((row, index) => {
              const resolved = resolvedItems[index + 1];
              const matches = resolved?.sku === row.sku.trim().toUpperCase();
              return <tr key={index}>
                <td>{index + 1}</td>
                <td><input aria-label={`SKU dòng ${index + 1}`} value={row.sku} onChange={(event) => updateRow(index, { sku: event.target.value })} placeholder="VD: SP001" /></td>
                <td className={styles.readOnlyCell}>{matches ? (resolved.productName || '—') : 'Kiểm tra để nhận diện'}</td>
                <td className={styles.unitCell}>{matches ? (resolved.sourceUnitCode || '—') : '—'}</td>
                <td><input aria-label={`Số lượng dòng ${index + 1}`} inputMode="decimal" value={row.sourceQuantity} onChange={(event) => updateRow(index, { sourceQuantity: event.target.value })} placeholder="0" /></td>
                <td><input aria-label={`Giá vốn dòng ${index + 1}`} inputMode="decimal" value={row.unitCost} onChange={(event) => updateRow(index, { unitCost: event.target.value })} placeholder="Tự lấy nếu có" /></td>
                <td><button type="button" className={styles.textButton} onClick={() => { setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((_, rowIndex) => rowIndex !== index)); setResolvedItems({}); invalidate(); }}>Xóa</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className={styles.bottomActions}>
          <button type="button" className={styles.secondary} onClick={() => { setRows((current) => [...current, emptyRow()]); invalidate(); }}>+ Thêm dòng</button>
          <button type="button" className={styles.primary} onClick={() => void checkData()} disabled={busy === 'preview'}>{busy === 'preview' ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu'}</button>
        </div>
      </section>

      {message ? <div className={message.kind === 'error' ? styles.errorBanner : styles.infoBanner}>{message.text}</div> : null}

      {preview ? <section className={styles.card}>
        <div className={styles.sectionHeading}>
          <div><h2>Kết quả kiểm tra</h2><p>{preview.totals.readyRowCount} dòng sẵn sàng · {preview.totals.attentionRowCount} dòng cần xử lý · Tổng số lượng {preview.totals.sourceQuantityTotal}</p></div>
          <span className={preview.ready && !previewDirty ? styles.readyBadge : styles.attentionBadge}>{preview.ready && !previewDirty ? 'Sẵn sàng' : previewDirty ? 'Cần kiểm tra lại' : 'Cần xử lý'}</span>
        </div>
        {preview.totals.mergedDuplicateCount > 0 ? <p className={styles.mergeNote}>Đã gộp {preview.totals.mergedDuplicateCount} dòng trùng cùng SKU, vị trí, lô và giá vốn để kiểm tra dễ hơn.</p> : null}
        <div className={styles.previewTableWrap}>
          <table className={styles.previewTable}>
            <thead><tr><th>SKU</th><th>Tên sản phẩm</th><th>ĐVT</th><th>Số lượng</th><th>Kho</th><th>Vị trí</th><th>Lô</th><th>HSD</th><th>Giá vốn</th><th>Trạng thái</th></tr></thead>
            <tbody>{preview.rows.map((row) => {
              const rowErrors = errorsByLine.get(row.lineNumber) ?? [];
              const errorCodes = new Set(rowErrors.map((error) => error.code));
              const showLocation = row.requiredFields.includes('LOCATION') || errorCodes.has('LOCATION_NOT_FOUND');
              const showLot = row.requiredFields.includes('LOT') || errorCodes.has('LOT_NOT_ALLOWED');
              const showExpiry = row.requiredFields.includes('EXPIRY') || errorCodes.has('EXPIRY_NOT_ALLOWED') || errorCodes.has('LOT_EXPIRY_MISMATCH');
              const showCost = row.requiredFields.includes('COST');
              const statusLabel = previewStatusLabel(row, rowErrors);
              const errorTitle = rowErrors.map((error) => error.message).join('\n');
              const selectedLocation = locations.some((location) => location.code === row.locationCode) ? (row.locationCode || '') : '';
              return <tr key={`${row.lineNumber}-${row.sku}`} className={row.status === 'READY' && !previewDirty ? styles.previewReadyRow : styles.previewAttentionRow}>
                <td><strong>{row.sku}</strong>{row.sourceLineNumbers.length > 1 ? <small>Gộp {row.sourceLineNumbers.length} dòng</small> : null}</td>
                <td>{row.productName || '—'}</td>
                <td>{row.sourceUnitCode || '—'}</td>
                <td>{row.sourceQuantity}</td>
                <td>{row.warehouseCode || '—'}</td>
                <td>{showLocation ? <div className={styles.inlineEditor}><span className={styles.requiredMark} aria-label="Bắt buộc">*</span><select aria-label={`Vị trí ${row.sku}`} value={selectedLocation} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { locationCode: event.target.value })}><option value="">Chọn vị trí</option>{locations.map((location) => <option key={location.id} value={location.code}>{location.code} — {location.name}</option>)}</select></div> : (row.locationCode || (row.locationRequired ? '—' : 'Không bắt buộc'))}</td>
                <td>{errorCodes.has('LOT_NOT_ALLOWED') ? <button type="button" className={styles.inlineAction} onClick={() => updateSourceLines(row.sourceLineNumbers, { lotCode: '', expiryDate: '', manufacturedDate: '', supplierLotReference: '' })}>Bỏ mã lô</button> : showLot ? <div className={styles.inlineEditor}><span className={styles.requiredMark} aria-label="Bắt buộc">*</span><input aria-label={`Mã lô ${row.sku}`} value={row.lotCode || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { lotCode: event.target.value })} placeholder="Nhập mã lô" /></div> : row.lotTrackingMode === 'REQUIRED' ? (row.lotCode || '—') : 'Không quản lý'}</td>
                <td>{errorCodes.has('EXPIRY_NOT_ALLOWED') ? <button type="button" className={styles.inlineAction} onClick={() => updateSourceLines(row.sourceLineNumbers, { expiryDate: '' })}>Bỏ HSD</button> : showExpiry ? <div className={styles.inlineEditor}>{row.requiredFields.includes('EXPIRY') ? <span className={styles.requiredMark} aria-label="Bắt buộc">*</span> : null}<input aria-label={`Hạn sử dụng ${row.sku}`} type="date" value={row.expiryDate || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { expiryDate: event.target.value })} /></div> : row.expiryTrackingMode === 'OPTIONAL' ? (row.expiryDate || 'Tùy chọn') : row.expiryTrackingMode === 'REQUIRED' ? (row.expiryDate || '—') : 'Không quản lý'}</td>
                <td>{showCost ? <div className={styles.inlineEditor}><span className={styles.requiredMark} aria-label="Bắt buộc">*</span><input aria-label={`Giá vốn ${row.sku}`} inputMode="decimal" value={row.unitCost || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { unitCost: event.target.value })} placeholder="Nhập giá vốn" /></div> : row.unitCost ? `${formatCost(row.unitCost)} đ${row.costSource === 'CURRENT' ? ' · hiện hành' : ''}` : '—'}</td>
                <td><span title={errorTitle || undefined} className={row.status === 'READY' && !previewDirty ? styles.readyBadge : styles.attentionBadge}>{previewDirty && row.status === 'READY' ? 'Kiểm tra lại' : statusLabel}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className={styles.previewFooter}>
          <div>{previewDirty ? <><strong>Cần kiểm tra lại.</strong><span> Các ô đã được bổ sung nhưng chưa đối chiếu lại.</span></> : preview.ready ? <><strong>Dữ liệu đã sẵn sàng.</strong><span> Chưa làm thay đổi tồn kho.</span></> : <><strong>Chưa làm thay đổi tồn kho.</strong><span> Bổ sung trực tiếp tại ô có dấu * đỏ.</span></>}</div>
          <div className={styles.actions}>
            {previewDirty ? <button type="button" className={styles.secondary} onClick={() => void checkData()} disabled={busy === 'preview'}>Kiểm tra lại</button> : null}
            <button type="button" className={styles.primary} onClick={() => void confirmInbound()} disabled={!preview.ready || previewDirty || busy === 'confirm'}>{busy === 'confirm' ? 'Đang xác nhận…' : 'XÁC NHẬN NHẬP'}</button>
          </div>
        </div>
      </section> : null}

      <section className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>Lịch sử nhập kho thủ công</h2><p>Tra cứu theo loại nhập hoặc số chứng từ tham chiếu; chứng từ đã ghi sổ chỉ sửa sai bằng thao tác đảo.</p></div></div>
        <div className={styles.historyFilters}>
          <label><span>Loại nhập</span><select value={historyType} onChange={(event) => setHistoryType(event.target.value as '' | InboundType)}><option value="">Tất cả</option>{INBOUND_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label><span>Số chứng từ tham chiếu</span><input value={historyReference} maxLength={160} onChange={(event) => setHistoryReference(event.target.value)} placeholder="Nhập số cần tìm" /></label>
          <button type="button" className={styles.secondary} onClick={() => void loadHistory()} disabled={historyBusy}>{historyBusy ? 'Đang tìm…' : 'Tìm'}</button>
        </div>
        {historyMessage ? <p className={styles.historyMessage}>{historyMessage}</p> : null}
        <div className={styles.historyTableWrap}>
          <table className={styles.historyTable}>
            <thead><tr><th>Ngày</th><th>Loại nhập</th><th>Số tham chiếu</th><th>Kho</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>{history.length ? history.map((document) => <tr key={document.id}>
              <td>{displayDate(document.documentDate)}</td>
              <td>{inboundTypeLabel(document.inboundType)}</td>
              <td>{document.referenceNumber || '—'}</td>
              <td>{document.warehouseCode} — {document.warehouseName}</td>
              <td><span className={document.status === 'POSTED' ? styles.readyBadge : styles.reversedBadge}>{document.status === 'POSTED' ? 'Đã nhập' : 'Đã đảo'}</span>{document.reversalDate ? <small>Ngày đảo {displayDate(document.reversalDate)}</small> : null}</td>
              <td>{document.status === 'POSTED' ? <button type="button" className={styles.textButton} onClick={() => openReverse(document)}>Đảo chứng từ</button> : null}</td>
            </tr>) : <tr><td colSpan={6} className={styles.emptyState}>{historyBusy ? 'Đang tải…' : 'Chưa có chứng từ phù hợp.'}</td></tr>}</tbody>
          </table>
        </div>
        {reverseDraft ? <div className={styles.reversePanel}>
          <div><strong>Đảo chứng từ: {reverseDraft.label}</strong><p>Hệ thống sẽ ghi bút toán đảo, không xóa lịch sử nhập kho cũ.</p></div>
          <label><span>Ngày đảo *</span><input type="date" value={reverseDraft.documentDate} onChange={(event) => { pendingReverse.current = null; setReverseDraft((current) => current ? { ...current, documentDate: event.target.value } : current); }} /></label>
          <label className={styles.reverseReason}><span>Lý do *</span><input value={reverseDraft.reasonNote} maxLength={2000} onChange={(event) => { pendingReverse.current = null; setReverseDraft((current) => current ? { ...current, reasonNote: event.target.value } : current); }} placeholder="Nêu rõ lý do cần đảo chứng từ" /></label>
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { pendingReverse.current = null; setReverseDraft(null); }}>Hủy</button><button type="button" className={styles.primary} disabled={reverseBusy} onClick={() => void submitReverse()}>{reverseBusy ? 'Đang đảo…' : 'Xác nhận đảo'}</button></div>
        </div> : null}
      </section>
    </div>
  </AppShell>;
}
