'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import { MIN_PRODUCT_SEARCH_LENGTH } from '../../../lib/product-search-contract';
import { readSpreadsheetRows } from '../../../lib/spreadsheet-reader';
import styles from './manual-inbound-workspace.module.css';

type LocationManagementMode = 'MANAGED' | 'UNMANAGED';
type WarehouseOption = {
  id: string;
  code: string;
  name: string;
  locationManagementMode?: LocationManagementMode | null;
  locationRequired?: boolean;
};
type LocationOption = { id: string; code: string; name: string; locationType: string };
type SupplierOption = { id: string; code: string; name: string };
type EntryMode = 'direct' | 'file';
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
type ManualInboundProductOption = {
  id: string;
  productId: string;
  sku: string;
  variantName: string | null;
  productCode: string;
  productName: string;
  unitCode: string;
  unitName: string;
  conversionToBase: string | null;
  baseVariantId: string | null;
  baseSku: string | null;
  lotTrackingMode: 'NONE' | 'REQUIRED' | null;
  expiryTrackingMode: 'NONE' | 'OPTIONAL' | 'REQUIRED' | null;
  primaryBarcode: string | null;
  unitCost: string | null;
  locationManagementMode: LocationManagementMode;
  locationRequired: boolean;
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
  baseUnitCode?: string | null;
  currentOnHand?: string | null;
  afterOnHand?: string | null;
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
type HistoryMovementDetail = {
  documentId: string;
  documentDate: string;
  referenceNumber: string | null;
  warehouseCode: string;
  warehouseName: string;
  lines: Array<{
    baseVariantId: string;
    sku: string;
    productName: string | null;
    baseUnitCode: string | null;
    quantityBefore: string;
    quantityDelta: string;
    quantityAfter: string;
  }>;
};
type Envelope<T> = { data?: T; error?: { message?: string; code?: string } };
type ResolvedItem = {
  sku: string;
  productName?: string;
  sourceUnitCode?: string;
  unitCost?: string | null;
};
type PendingMutation = { key: string; body: string };
type InboundType = 'MANUAL_RECEIPT' | 'OFF_DOCUMENT_CUSTOMER_RETURN' | 'RECOVERY' | 'OTHER';

const SEARCH_DELAY_MS = 120;
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

function rowIsEmpty(row: DraftRow) {
  return Object.values(row).every((value) => !String(value ?? '').trim());
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

function formatCost(value: string | null | undefined) {
  const number = Number(value);
  if (!value || !Number.isFinite(number)) return value || '—';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(number);
}

function formatQuantity(value: string | null | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value || '0';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(number);
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
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [inboundType, setInboundType] = useState<InboundType>('MANUAL_RECEIPT');
  const [documentDate, setDocumentDate] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [note, setNote] = useState('');
  const [entryMode, setEntryMode] = useState<EntryMode>('direct');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [filename, setFilename] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<ManualInboundProductOption[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
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
  const [historyDetail, setHistoryDetail] = useState<HistoryMovementDetail | null>(null);
  const [historyDetailBusy, setHistoryDetailBusy] = useState(false);
  const [historyDetailError, setHistoryDetailError] = useState('');
  const [reverseDraft, setReverseDraft] = useState<{ documentId: string; label: string; documentDate: string; reasonNote: string } | null>(null);
  const [reverseBusy, setReverseBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const productSearchInput = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef(new Map<number, HTMLInputElement>());
  const pendingConfirm = useRef<PendingMutation | null>(null);
  const pendingReverse = useRef<PendingMutation | null>(null);
  const productSearchRun = useRef(0);

  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId) ?? null;
  const errorsByLine = useMemo(() => {
    const map = new Map<number, Array<{ code: string; message: string }>>();
    for (const error of preview?.rowErrors ?? []) {
      map.set(error.lineNumber, [...(map.get(error.lineNumber) ?? []), { code: error.code, message: error.message }]);
    }
    return map;
  }, [preview]);

  function operatorPayload(sourceRows = rows) {
    return {
      warehouseId,
      supplierId: supplierId || null,
      inboundType,
      documentDate,
      referenceNumber: referenceNumber.trim() || null,
      note: note.trim() || null,
      rows: sourceRows.filter((row) => !rowIsEmpty(row)).map((row) => ({
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

  function removeRow(index: number) {
    setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((_, rowIndex) => rowIndex !== index));
    setResolvedItems((current) => {
      const next: Record<number, ResolvedItem> = {};
      (Object.entries(current) as Array<[string, ResolvedItem]>).forEach(([lineNumberText, item]) => {
        const lineIndex = Number(lineNumberText) - 1;
        if (lineIndex === index) return;
        next[lineIndex > index ? lineIndex : lineIndex + 1] = item;
      });
      return next;
    });
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

  function addProduct(option: ManualInboundProductOption) {
    const emptyIndex = rows.findIndex(rowIsEmpty);
    const targetIndex = emptyIndex >= 0 ? emptyIndex : rows.length;
    const nextRow: DraftRow = {
      ...emptyRow(),
      sku: option.sku,
      sourceQuantity: '1',
    };
    setRows((current) => emptyIndex >= 0
      ? current.map((row, index) => index === emptyIndex ? nextRow : row)
      : [...current, nextRow]);
    setResolvedItems((current) => ({
      ...current,
      [targetIndex + 1]: {
        sku: option.sku,
        productName: option.productName,
        sourceUnitCode: option.unitCode,
        unitCost: option.unitCost,
      },
    }));
    setProductSearch('');
    setProductResults([]);
    invalidate();
    window.setTimeout(() => {
      const input = quantityRefs.current.get(targetIndex);
      input?.focus();
      input?.select();
    }, 0);
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

  async function openHistoryDetail(document: HistoryDocument) {
    setHistoryDetail(null);
    setHistoryDetailError('');
    setHistoryDetailBusy(true);
    try {
      const query = new URLSearchParams({ documentId: document.id });
      const data = await requestJson<HistoryMovementDetail>(`/api/inventory/manual-inbounds/operator/history-detail?${query.toString()}`);
      setHistoryDetail(data);
    } catch (error) {
      setHistoryDetailError(error instanceof Error ? error.message : 'Không tải được biến động tồn của chứng từ.');
    } finally {
      setHistoryDetailBusy(false);
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
    requestJson<SupplierOption[]>('/api/inventory/manual-inbounds/operator/suppliers')
      .then((data) => { if (active) setSuppliers(data); })
      .catch((error) => { if (active) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được danh sách nhà cung cấp.' }); });
    void loadHistory('', '');
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    setLocations([]);
    setProductSearch('');
    setProductResults([]);
    setResolvedItems((current) => {
      const next: Record<number, ResolvedItem> = {};
      (Object.entries(current) as Array<[string, ResolvedItem]>).forEach(([key, item]) => { next[Number(key)] = { ...item, unitCost: undefined }; });
      return next;
    });
    setPreview(null);
    setPreviewDirty(false);
    pendingConfirm.current = null;
    setMessage(null);
    if (!warehouseId) return () => { active = false; };
    setBusy('locations');
    requestJson<{ warehouse: WarehouseOption; locations: LocationOption[] }>(`/api/inventory/manual-inbounds/operator/locations?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((data) => { if (active) setLocations(data.locations); })
      .catch((error) => { if (active) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tải được vị trí kho.' }); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [warehouseId]);

  useEffect(() => {
    const term = productSearch.trim();
    const run = ++productSearchRun.current;
    if (entryMode !== 'direct' || term.length < MIN_PRODUCT_SEARCH_LENGTH || !warehouseId) {
      setProductResults([]);
      setProductSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    setProductResults([]);
    const timer = window.setTimeout(async () => {
      setProductSearchLoading(true);
      try {
        const query = new URLSearchParams({ warehouseId, search: term });
        const results = await requestJson<ManualInboundProductOption[]>(`/api/inventory/manual-inbounds/operator/products?${query.toString()}`, { signal: controller.signal });
        if (!controller.signal.aborted && run === productSearchRun.current) setProductResults(results);
      } catch (error) {
        if (!controller.signal.aborted && run === productSearchRun.current) {
          setProductResults([]);
          setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Không tìm được sản phẩm.' });
        }
      } finally {
        if (!controller.signal.aborted && run === productSearchRun.current) setProductSearchLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [entryMode, productSearch, warehouseId]);

  async function chooseFile(file: File) {
    setBusy('file');
    invalidate();
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
    const activeRows = rows.filter((row) => !rowIsEmpty(row));
    if (!activeRows.length || activeRows.some((row) => !row.sku.trim() || !row.sourceQuantity.trim())) {
      setMessage({ kind: 'error', text: 'Mỗi dòng hàng cần có sản phẩm và số lượng.' });
      return;
    }
    if (activeRows.length !== rows.length) setRows(activeRows);
    setBusy('preview');
    setMessage(null);
    setPreview(null);
    setPreviewDirty(false);
    pendingConfirm.current = null;
    try {
      const result = await requestJson<PreviewResult>('/api/inventory/manual-inbounds/operator/preview', {
        method: 'POST',
        body: JSON.stringify(operatorPayload(activeRows)),
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
            unitCost: previewRow.unitCost || null,
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
      setSupplierId('');
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
    if (!reverseDraft.documentDate) { setHistoryMessage('Chọn ngày đảo chứng từ.'); return; }
    if (!reverseDraft.reasonNote.trim()) { setHistoryMessage('Nhập lý do đảo chứng từ.'); return; }
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

  const directRows = rows.filter((row) => !rowIsEmpty(row));

  return <AppShell title="Nhập kho thủ công" kicker="Kho">
    <div className={styles.workspaceGrid}>
      <main className={styles.entryColumn}>
        <section className={`${styles.card} ${styles.documentCard}`}>
          <div className={styles.compactHeading}><h2>Thông tin chứng từ</h2></div>
          <div className={styles.headerGrid}>
            <label><span>Kho nhập *</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={busy === 'warehouses'}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
            <label><span>Nhà cung cấp</span><select value={supplierId} onChange={(event) => { setSupplierId(event.target.value); invalidate(); }}><option value="">Không chọn</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}</select></label>
            <label><span>Loại nhập *</span><select value={inboundType} onChange={(event) => { setInboundType(event.target.value as InboundType); invalidate(); }}>{INBOUND_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label><span>Ngày chứng từ *</span><input type="date" value={documentDate} onChange={(event) => { setDocumentDate(event.target.value); invalidate(); }} /></label>
            <label><span>Số chứng từ / hóa đơn tham chiếu</span><input value={referenceNumber} maxLength={160} onChange={(event) => { setReferenceNumber(event.target.value); invalidate(); }} placeholder="Không bắt buộc" /></label>
            <label className={styles.noteField}><span>Ghi chú {inboundType === 'OTHER' ? '*' : ''}</span><input value={note} maxLength={2000} onChange={(event) => { setNote(event.target.value); invalidate(); }} placeholder={inboundType === 'OTHER' ? 'Nêu rõ lý do nhập' : 'Thông tin cần lưu kèm chứng từ (nếu có)'} /></label>
          </div>
        </section>

        <section className={`${styles.card} ${styles.itemsCard}`}>
          <div className={styles.sectionHeading}>
            <div><h2>Hàng nhập</h2><p>Chọn cách nhập phù hợp. Cả hai cách đều kiểm tra trước khi ghi sổ.</p></div>
          </div>
          <div className={styles.entryTabs} role="tablist" aria-label="Cách nhập hàng">
            <button type="button" role="tab" aria-selected={entryMode === 'direct'} className={entryMode === 'direct' ? styles.tabActive : styles.tab} onClick={() => setEntryMode('direct')}>Nhập trực tiếp</button>
            <button type="button" role="tab" aria-selected={entryMode === 'file'} className={entryMode === 'file' ? styles.tabActive : styles.tab} onClick={() => setEntryMode('file')}>Nhập từ file</button>
          </div>

          {entryMode === 'direct' ? <>
            <div className={styles.productSearchBox}>
              <label htmlFor="manual-inbound-product-search">Tìm sản phẩm</label>
              <div className={styles.searchInputWrap}>
                <span aria-hidden="true">⌕</span>
                <input
                  ref={productSearchInput}
                  id="manual-inbound-product-search"
                  type="search"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder={warehouseId ? 'Tên sản phẩm, SKU hoặc mã vạch' : 'Chọn Kho nhập trước khi tìm sản phẩm'}
                  disabled={!warehouseId}
                  autoComplete="off"
                />
              </div>
              {productSearchLoading ? <p className={styles.searchHint}>Đang tìm sản phẩm…</p> : null}
              {!productSearchLoading && productSearch.trim() && productResults.length === 0 ? <p className={styles.searchHint}>Không có sản phẩm phù hợp.</p> : null}
              {productResults.length ? <div className={styles.productResults} role="listbox" aria-label="Kết quả tìm sản phẩm">
                {productResults.map((option) => <button key={option.id} type="button" className={styles.productResult} onClick={() => addProduct(option)}>
                  <span className={styles.productIdentity}><strong>{option.productName}</strong><small>{option.sku}{option.variantName ? ` · ${option.variantName}` : ''}</small></span>
                  <span className={styles.productMeta}><b>{option.unitCode}</b><small>{option.unitCost ? `Giá vốn ${formatCost(option.unitCost)} đ` : 'Chưa có giá vốn'}</small></span>
                </button>)}
              </div> : null}
            </div>
            {selectedWarehouse?.locationManagementMode === 'MANAGED' ? <p className={styles.policyNote}>Kho này có quản lý vị trí. Khi kiểm tra dữ liệu, dòng hàng chưa có vị trí sẽ được yêu cầu chọn đúng vị trí lưu trữ.</p> : null}
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.directTable}`}>
                <thead><tr><BusinessTableSequenceHeader /><th>SKU</th><th className={styles.productColumn}>Tên sản phẩm</th><th>ĐVT</th><th>Số lượng *</th><th>Giá vốn</th><th /></tr></thead>
                <tbody>{directRows.length ? directRows.map((row, index) => {
                  const actualIndex = rows.indexOf(row);
                  const resolved = resolvedItems[actualIndex + 1];
                  const matches = resolved?.sku === row.sku.trim().toUpperCase();
                  return <tr key={`${actualIndex}-${row.sku}`}>
                    <BusinessTableSequenceCell rowIndex={index} />
                    <td className={styles.skuCell}>{row.sku}</td>
                    <td className={styles.productNameCell}>{matches ? (resolved.productName || '—') : 'Kiểm tra để nhận diện'}{matches && resolved?.unitCost ? <small>Giá vốn hiện hành: {formatCost(resolved.unitCost)} đ</small> : null}</td>
                    <td className={styles.unitCell}>{matches ? (resolved.sourceUnitCode || '—') : '—'}</td>
                    <td><input ref={(element) => { if (element) quantityRefs.current.set(actualIndex, element); else quantityRefs.current.delete(actualIndex); }} aria-label={`Số lượng dòng ${actualIndex + 1}`} inputMode="decimal" value={row.sourceQuantity} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => updateRow(actualIndex, { sourceQuantity: event.target.value })} placeholder="0" /></td>
                    <td><input aria-label={`Giá vốn dòng ${actualIndex + 1}`} inputMode="decimal" value={row.unitCost} onChange={(event) => updateRow(actualIndex, { unitCost: event.target.value })} placeholder={resolved?.unitCost ? formatCost(resolved.unitCost) : 'Tự lấy nếu có'} /></td>
                    <td><button type="button" className={styles.textButton} onClick={() => removeRow(actualIndex)}>Xóa</button></td>
                  </tr>;
                }) : <tr><td colSpan={7} className={styles.emptyState}>Tìm và chọn sản phẩm ở ô phía trên để bắt đầu nhập.</td></tr>}</tbody>
              </table>
            </div>
            <div className={styles.bottomActions}>
              <button type="button" className={styles.secondary} onClick={() => productSearchInput.current?.focus()}>+ Thêm sản phẩm</button>
              <button type="button" className={styles.primary} onClick={() => void checkData()} disabled={busy === 'preview'}>{busy === 'preview' ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu'}</button>
            </div>
          </> : <>
            <div className={styles.fileToolbar}>
              <div><strong>Excel / CSV</strong><span>Tệp cần có SKU và Số lượng. Giá vốn có thể để trống.</span></div>
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={downloadTemplate}>Tải mẫu CSV</button>
                <input ref={fileInput} className={styles.hiddenInput} type="file" accept=".xlsx,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseFile(file); }} />
                <button type="button" className={styles.primary} onClick={() => fileInput.current?.click()} disabled={busy === 'file'}>{busy === 'file' ? 'Đang đọc tệp…' : 'Chọn tệp Excel/CSV'}</button>
              </div>
            </div>
            {filename ? <p className={styles.fileName}>Tệp đang dùng: <strong>{filename}</strong></p> : null}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><BusinessTableSequenceHeader /><th>SKU *</th><th className={styles.productColumn}>Tên sản phẩm</th><th>ĐVT</th><th>Số lượng *</th><th>Giá vốn</th><th /></tr></thead>
                <tbody>{rows.map((row, index) => {
                  const resolved = resolvedItems[index + 1];
                  const matches = resolved?.sku === row.sku.trim().toUpperCase();
                  return <tr key={index}>
                    <BusinessTableSequenceCell rowIndex={index} />
                    <td><input aria-label={`SKU dòng ${index + 1}`} value={row.sku} onChange={(event) => updateRow(index, { sku: event.target.value })} placeholder="VD: SP001" /></td>
                    <td className={styles.productNameCell}>{matches ? (resolved.productName || '—') : 'Kiểm tra để nhận diện'}</td>
                    <td className={styles.unitCell}>{matches ? (resolved.sourceUnitCode || '—') : '—'}</td>
                    <td><input aria-label={`Số lượng dòng ${index + 1}`} inputMode="decimal" value={row.sourceQuantity} onChange={(event) => updateRow(index, { sourceQuantity: event.target.value })} placeholder="0" /></td>
                    <td><input aria-label={`Giá vốn dòng ${index + 1}`} inputMode="decimal" value={row.unitCost} onChange={(event) => updateRow(index, { unitCost: event.target.value })} placeholder="Tự lấy nếu có" /></td>
                    <td><button type="button" className={styles.textButton} onClick={() => removeRow(index)}>Xóa</button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className={styles.bottomActions}>
              <button type="button" className={styles.secondary} onClick={() => { setRows((current) => [...current, emptyRow()]); invalidate(); }}>+ Thêm dòng</button>
              <button type="button" className={styles.primary} onClick={() => void checkData()} disabled={busy === 'preview'}>{busy === 'preview' ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu'}</button>
            </div>
          </>}
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
              <thead><tr><BusinessTableSequenceHeader /><th>SKU</th><th>Tên sản phẩm</th><th>ĐVT</th><th>Số lượng</th><th>Tồn hiện tại</th><th>Tồn sau nhập</th><th>Kho</th><th>Vị trí</th><th>Lô</th><th>HSD</th><th>Giá vốn</th><th>Trạng thái</th></tr></thead>
              <tbody>{preview.rows.map((row, rowIndex) => {
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
                  <BusinessTableSequenceCell rowIndex={rowIndex} />
                  <td><strong>{row.sku}</strong>{row.sourceLineNumbers.length > 1 ? <small>Gộp {row.sourceLineNumbers.length} dòng</small> : null}</td>
                  <td>{row.productName || '—'}</td>
                  <td>{row.sourceUnitCode || '—'}</td>
                  <td>{row.sourceQuantity}</td>
                  <td className={styles.stockCell}>{row.currentOnHand === null || row.currentOnHand === undefined ? '—' : <><strong>{formatQuantity(row.currentOnHand)}</strong><small>{row.baseUnitCode || 'ĐVT tồn'}</small></>}</td>
                  <td className={styles.stockCell}>{row.afterOnHand === null || row.afterOnHand === undefined ? '—' : <><strong>{formatQuantity(row.afterOnHand)}</strong><small>{row.baseUnitCode || 'ĐVT tồn'}</small></>}</td>
                  <td>{row.warehouseCode || '—'}</td>
                  <td>{showLocation ? <div className={styles.inlineEditor}><span className={styles.requiredMark} aria-label="Bắt buộc">*</span><select aria-label={`Vị trí ${row.sku}`} value={selectedLocation} onChange={(event) => updateSourceLines(row.sourceLineNumbers, { locationCode: event.target.value })}><option value="">Chọn vị trí</option>{locations.map((location) => <option key={location.id} value={location.code}>{location.code} — {location.name}</option>)}</select></div> : (row.locationCode || (row.locationRequired ? '—' : 'Tồn chung'))}</td>
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
      </main>

      <aside className={styles.historyColumn}>
        <section className={`${styles.card} ${styles.historyCard}`}>
          <div className={styles.sectionHeading}><div><h2>Lịch sử nhập kho thủ công</h2><p>Tra cứu nhanh các chứng từ đã ghi sổ.</p></div></div>
          <div className={styles.historyFilters}>
            <label><span>Loại nhập</span><select value={historyType} onChange={(event) => setHistoryType(event.target.value as '' | InboundType)}><option value="">Tất cả</option>{INBOUND_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label><span>Số chứng từ tham chiếu</span><input value={historyReference} maxLength={160} onChange={(event) => setHistoryReference(event.target.value)} placeholder="Nhập số cần tìm" /></label>
            <button type="button" className={styles.primary} onClick={() => void loadHistory()} disabled={historyBusy}>{historyBusy ? 'Đang tìm…' : 'Tìm'}</button>
          </div>
          {historyMessage ? <p className={styles.historyMessage}>{historyMessage}</p> : null}
          <div className={styles.historyList}>
            {history.length ? history.slice(0, 12).map((document) => <article key={document.id} className={styles.historyItem}>
              <div className={styles.historyItemHead}><strong>{document.referenceNumber || inboundTypeLabel(document.inboundType)}</strong><span className={document.status === 'POSTED' ? styles.readyBadge : styles.reversedBadge}>{document.status === 'POSTED' ? 'Đã nhập' : 'Đã đảo'}</span></div>
              <div className={styles.historyMeta}><span>{displayDate(document.documentDate)}</span><span>{inboundTypeLabel(document.inboundType)}</span><span>{document.warehouseCode} — {document.warehouseName}</span></div>
              <div className={styles.historyActions}><button type="button" className={styles.textButton} onClick={() => void openHistoryDetail(document)}>Xem biến động</button>{document.status === 'POSTED' ? <button type="button" className={styles.textButton} onClick={() => openReverse(document)}>Đảo chứng từ</button> : null}</div>
            </article>) : <p className={styles.emptyState}>{historyBusy ? 'Đang tải…' : 'Chưa có chứng từ phù hợp.'}</p>}
          </div>
          {reverseDraft ? <div className={styles.reversePanel}>
            <div><strong>Đảo chứng từ: {reverseDraft.label}</strong><p>Hệ thống ghi bút toán đảo và giữ nguyên lịch sử.</p></div>
            <label><span>Ngày đảo *</span><input type="date" value={reverseDraft.documentDate} onChange={(event) => { pendingReverse.current = null; setReverseDraft((current) => current ? { ...current, documentDate: event.target.value } : current); }} /></label>
            <label><span>Lý do *</span><input value={reverseDraft.reasonNote} maxLength={2000} onChange={(event) => { pendingReverse.current = null; setReverseDraft((current) => current ? { ...current, reasonNote: event.target.value } : current); }} placeholder="Nêu rõ lý do" /></label>
            <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { pendingReverse.current = null; setReverseDraft(null); }}>Hủy</button><button type="button" className={styles.primary} disabled={reverseBusy} onClick={() => void submitReverse()}>{reverseBusy ? 'Đang đảo…' : 'Xác nhận đảo'}</button></div>
          </div> : null}
        </section>
      </aside>
    </div>

    {(historyDetailBusy || historyDetail || historyDetailError) ? <div role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) { setHistoryDetail(null); setHistoryDetailError(''); } }} className={styles.dialogBackdrop}>
      <section role="dialog" aria-modal="true" aria-labelledby="manual-inbound-movement-title" className={styles.dialogCard}>
        <div className={styles.sectionHeading}><div><h2 id="manual-inbound-movement-title">Biến động tồn theo chứng từ</h2><p>{historyDetail ? `${historyDetail.warehouseCode} — ${historyDetail.warehouseName} · ${displayDate(historyDetail.documentDate)}${historyDetail.referenceNumber ? ` · ${historyDetail.referenceNumber}` : ''}` : 'Chỉ hiển thị các mã hàng có trên chứng từ này.'}</p></div><button type="button" className={styles.secondary} onClick={() => { setHistoryDetail(null); setHistoryDetailError(''); }}>Đóng</button></div>
        {historyDetailBusy ? <p className={styles.historyMessage}>Đang tải biến động tồn…</p> : null}
        {historyDetailError ? <p className={styles.historyMessage}>{historyDetailError}</p> : null}
        {historyDetail ? <div className={styles.historyTableWrap}><table className={styles.historyTable}><thead><tr><BusinessTableSequenceHeader /><th>Sản phẩm / SKU</th><th>ĐVT</th><th>Tồn trước</th><th>Biến động</th><th>Tồn sau</th></tr></thead><tbody>{historyDetail.lines.map((line, rowIndex) => <tr key={line.baseVariantId}><BusinessTableSequenceCell rowIndex={rowIndex} /><td><strong>{line.productName || line.sku}</strong><small>{line.sku}</small></td><td>{line.baseUnitCode || '—'}</td><td>{formatQuantity(line.quantityBefore)}</td><td><strong>+{formatQuantity(line.quantityDelta)}</strong></td><td><strong>{formatQuantity(line.quantityAfter)}</strong></td></tr>)}</tbody></table></div> : null}
      </section>
    </div> : null}
  </AppShell>;
}