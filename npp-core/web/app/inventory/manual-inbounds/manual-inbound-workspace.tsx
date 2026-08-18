'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
type Envelope<T> = { data?: T; error?: { message?: string; code?: string } };
type ResolvedItem = { sku: string; productName?: string; sourceUnitCode?: string };

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
  'SKU': 'sku',
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
  const [resolvedItems, setResolvedItems] = useState<Record<number, ResolvedItem>>({});
  const [busy, setBusy] = useState<'warehouses' | 'locations' | 'file' | 'preview' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const errorsByLine = useMemo(() => {
    const map = new Map<number, Array<{ code: string; message: string }>>();
    for (const error of preview?.rowErrors ?? []) {
      map.set(error.lineNumber, [...(map.get(error.lineNumber) ?? []), { code: error.code, message: error.message }]);
    }
    return map;
  }, [preview]);

  function invalidate() {
    setPreview(null);
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
    setPreview(null);
    setMessage({ kind: 'info', text: 'Đã bổ sung thông tin. Kiểm tra lại dữ liệu để cập nhật kết quả.' });
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
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLocations([]);
    setPreview(null);
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
    try {
      const result = await requestJson<PreviewResult>('/api/inventory/manual-inbounds/operator/preview', {
        method: 'POST',
        body: JSON.stringify({
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
        }),
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
          ? 'Dữ liệu đã sẵn sàng. Việc kiểm tra này chưa làm thay đổi tồn kho.'
          : 'Còn dòng cần xử lý. Việc kiểm tra này chưa làm thay đổi tồn kho.',
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không kiểm tra được dữ liệu.' });
    } finally {
      setBusy(null);
    }
  }

  return <AppShell
    title="Nhập kho thủ công"
    subtitle="Chuẩn bị dữ liệu hàng vào kho theo chứng từ thực tế, không thay thế quy trình Mua hàng."
    kicker="Kho"
  >
    <div className={styles.stack}>
      <section className={styles.notice}>
        <strong>Kiểm tra trước, chưa ghi tồn.</strong>
        <span>Dữ liệu chỉ được đối chiếu SKU, kho, lô, hạn dùng, vị trí và giá vốn ở bước này.</span>
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
          <span className={preview.ready ? styles.readyBadge : styles.attentionBadge}>{preview.ready ? 'Sẵn sàng' : 'Cần xử lý'}</span>
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
              return <Fragment key={`${row.lineNumber}-${row.sku}`}>
                <tr key={`${row.lineNumber}-${row.sku}`} className={row.status === 'READY' ? styles.previewReadyRow : styles.previewAttentionRow}>
                  <td><strong>{row.sku}</strong>{row.sourceLineNumbers.length > 1 ? <small>Gộp {row.sourceLineNumbers.length} dòng</small> : null}</td>
                  <td>{row.productName || '—'}</td>
                  <td>{row.sourceUnitCode || '—'}</td>
                  <td>{row.sourceQuantity}</td>
                  <td>{row.warehouseCode || '—'}</td>
                  <td>{row.locationCode || (row.locationRequired ? 'Cần chọn' : 'Không bắt buộc')}</td>
                  <td>{row.lotTrackingMode === 'REQUIRED' ? (row.lotCode || 'Cần nhập') : 'Không quản lý'}</td>
                  <td>{row.expiryTrackingMode === 'REQUIRED' ? (row.expiryDate || 'Cần nhập') : row.expiryTrackingMode === 'OPTIONAL' ? (row.expiryDate || 'Tùy chọn') : 'Không quản lý'}</td>
                  <td>{row.unitCost ? `${formatCost(row.unitCost)} đ${row.costSource === 'CURRENT' ? ' · hiện hành' : ''}` : 'Cần nhập'}</td>
                  <td><span className={row.status === 'READY' ? styles.readyBadge : styles.attentionBadge}>{statusLabel}</span></td>
                </tr>
                {showLocation || showLot || showExpiry || showCost || rowErrors.length ? <tr key={`${row.lineNumber}-${row.sku}-detail`} className={styles.previewDetailRow}><td colSpan={10}>
                  {showLocation || showLot || showExpiry || showCost ? <div className={styles.correctionGrid}>
                    {showLocation ? <label><span>Vị trí kho</span><select value={row.locationCode || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { locationCode: event.target.value })}><option value="">Không chọn</option>{locations.map((location) => <option key={location.id} value={location.code}>{location.code} — {location.name}</option>)}</select></label> : null}
                    {showLot ? <label><span>Mã lô</span><input value={row.lotCode || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { lotCode: event.target.value, ...(errorCodes.has('LOT_NOT_ALLOWED') ? { expiryDate: '', manufacturedDate: '', supplierLotReference: '' } : {}) })} placeholder={errorCodes.has('LOT_NOT_ALLOWED') ? 'Xóa mã lô để tiếp tục' : 'Nhập mã lô'} /></label> : null}
                    {showExpiry ? <label><span>Hạn sử dụng</span><input type="date" value={row.expiryDate || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { expiryDate: event.target.value })} /></label> : null}
                    {showCost ? <label><span>Giá vốn</span><input inputMode="decimal" value={row.unitCost || ''} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { unitCost: event.target.value })} placeholder="Nhập giá vốn" /></label> : null}
                    {errorCodes.has('LOT_NOT_ALLOWED') ? <button type="button" className={styles.secondary} onClick={() => updateSourceLines(row.sourceLineNumbers, { lotCode: '', expiryDate: '', manufacturedDate: '', supplierLotReference: '' })}>Bỏ thông tin lô</button> : null}
                    {errorCodes.has('EXPIRY_NOT_ALLOWED') ? <button type="button" className={styles.secondary} onClick={() => updateSourceLines(row.sourceLineNumbers, { expiryDate: '' })}>Bỏ hạn sử dụng</button> : null}
                  </div> : null}
                  {rowErrors.length ? <ul className={styles.errorList}>{rowErrors.map((error) => <li key={`${error.code}-${error.message}`}>{error.message}</li>)}</ul> : null}
                </td></tr> : null}
              </Fragment>;
            })}</tbody>
          </table>
        </div>
        <div className={styles.previewFooter}><strong>Chưa làm thay đổi tồn kho.</strong><span>Khi dữ liệu còn thiếu, bổ sung ngay tại dòng rồi bấm “Kiểm tra dữ liệu” lại.</span></div>
      </section> : null}
    </div>
  </AppShell>;
}
