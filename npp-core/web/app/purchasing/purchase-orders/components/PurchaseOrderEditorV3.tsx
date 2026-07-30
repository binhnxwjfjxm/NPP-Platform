'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Supplier } from '../../../../lib/supplier-types';
import type { Product } from '../../../../lib/product-types';
import type { Warehouse } from '../../../../lib/organization-types';
import type {
  PurchaseOrder,
  PurchaseOrderDiscountMode,
  PurchaseOrderDraft,
  PurchaseOrderDraftLine,
  PurchaseOrderSkuResolution,
  PurchaseOrderSkuSearchOption,
} from '../../../../lib/purchase-order-types';
import {
  calculatePurchaseOrderDraftTotals,
  decimalToScaled,
  formatPurchaseOrderAmount,
} from '../../../../lib/purchase-order-types';
import {
  calculatePurchaseOrderLineFinancials,
  formatDecimalForInput,
  isSafeDecimalIntermediate,
  normalizeDecimalForApi,
  parsePurchaseOrderPasteGrid,
} from '../../../../lib/purchase-order-line-entry';
import {
  MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH,
  PURCHASE_ORDER_SKU_FILTERS,
  filterPurchaseOrderSkuOptions,
  groupPurchaseOrderSkuOptions,
  normalizePurchaseOrderSkuSearchFailure,
  purchaseOrderBulkTemplate,
  type PurchaseOrderSkuFilter,
} from '../../../../lib/purchase-order-sku-entry';
import styles from '../../../organization/organization.module.css';
import localStyles from './purchase-order-editor-v2.module.css';

const SEARCH_PAGE_SIZE = 50;
const MAX_BULK_FILE_BYTES = 2 * 1024 * 1024;
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type EntryMode = 'quick' | 'browse' | 'bulk';
type BulkSourceMode = 'file' | 'paste';

type Props = {
  mode: 'create' | 'edit';
  purchaseOrder: PurchaseOrder | null;
  suppliers: Supplier[];
  warehouses: Warehouse[];
  products: Product[];
  onClose: () => void;
  onSaved: (purchaseOrder: PurchaseOrder) => void;
};

type EditorLine = PurchaseOrderDraftLine & {
  key: string;
  sku: string;
  name: string;
  unitCode: string;
  conversionToBase: string;
};

type ParsedBulkRow = ReturnType<typeof parsePurchaseOrderPasteGrid>[number];
type BulkPreviewRow = ParsedBulkRow & {
  option: PurchaseOrderSkuSearchOption | null;
  resolutionError: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

class UiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UiRequestError';
  }
}

function localToday() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function cleanDecimal(value: string | null | undefined, fallback = '0') {
  return formatDecimalForInput(value ?? fallback) || fallback;
}

function toApiDecimal(value: string, fallback = '0') {
  return normalizeDecimalForApi(value) ?? fallback;
}

function initialLines(purchaseOrder: PurchaseOrder | null): EditorLine[] {
  return (purchaseOrder?.lines ?? []).map((line) => ({
    key: line.id || crypto.randomUUID(),
    variantId: line.variantId,
    sku: line.skuCode,
    name: line.itemName,
    unitCode: line.unitCode,
    conversionToBase: cleanDecimal(line.conversionToBase, '1'),
    quantity: cleanDecimal(line.quantity, '1'),
    unitPrice: cleanDecimal(line.unitPrice, '0'),
    discountMode: line.discountMode ?? 'TOTAL_AMOUNT',
    discountValue: cleanDecimal(line.discountValue ?? line.discountAmount, '0'),
    discountAmount: cleanDecimal(line.discountAmount, '0'),
    taxRate: line.taxRate === null || line.taxRate === undefined ? '' : cleanDecimal(line.taxRate, '0'),
    taxAmount: cleanDecimal(line.taxAmount, '0'),
    note: line.note ?? '',
  }));
}

function editorLineFromOption(option: PurchaseOrderSkuSearchOption): EditorLine {
  return {
    key: crypto.randomUUID(),
    variantId: option.id,
    sku: option.sku,
    name: option.variantName,
    unitCode: option.unitCode ?? '',
    conversionToBase: cleanDecimal(option.conversionToBase, '1'),
    quantity: '1',
    unitPrice: '0',
    discountMode: 'TOTAL_AMOUNT',
    discountValue: '0',
    discountAmount: '0',
    taxRate: '0',
    taxAmount: '0',
    note: '',
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
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    const base = {
      code: payload.error?.code,
      message: payload.error?.message,
      statusCode: response.status,
      retryable: payload.error?.retryable,
    };
    const normalized = path.includes('/sku-search') || path.includes('/sku-resolve')
      ? normalizePurchaseOrderSkuSearchFailure(base)
      : {
          code: base.code || 'PURCHASE_ORDER_REQUEST_FAILED',
          message: base.message || 'Không thực hiện được yêu cầu đơn đặt hàng.',
          statusCode: base.statusCode || 500,
          retryable: base.retryable === true,
        };
    throw new UiRequestError(normalized.message, normalized.code, normalized.statusCode, normalized.retryable);
  }
  return payload.data;
}

function validateDraft(draft: PurchaseOrderDraft): string | null {
  if (!draft.supplierId) return 'Vui lòng chọn nhà cung cấp.';
  if (!draft.warehouseId) return 'Vui lòng chọn kho nhận.';
  if (!draft.orderDate) return 'Vui lòng chọn ngày đặt hàng.';
  if (draft.expectedDate && draft.expectedDate < draft.orderDate) return 'Ngày dự kiến nhận không được trước ngày đặt hàng.';
  if (draft.lines.length === 0) return 'Đơn đặt hàng phải có ít nhất một dòng SKU.';
  const seen = new Set<string>();
  for (let index = 0; index < draft.lines.length; index += 1) {
    const line = draft.lines[index];
    if (!line.variantId) return `Dòng ${index + 1} chưa chọn SKU.`;
    if (seen.has(line.variantId)) return 'Một SKU chỉ được xuất hiện một lần trong đơn.';
    seen.add(line.variantId);
    if (decimalToScaled(line.quantity, false) === null) return `Số lượng dòng ${index + 1} phải lớn hơn 0 và tối đa 6 chữ số thập phân.`;
    if (decimalToScaled(line.unitPrice || '0') === null) return `Đơn giá dòng ${index + 1} không hợp lệ.`;
    if (!calculatePurchaseOrderLineFinancials(line)) return `Chiết khấu hoặc thuế dòng ${index + 1} không hợp lệ.`;
  }
  return null;
}

function initialBulkPreview(text: string): BulkPreviewRow[] {
  return parsePurchaseOrderPasteGrid(text).map((row) => ({ ...row, option: null, resolutionError: null }));
}

function normalizedIdentifier(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

function discountModeLabel(value: string | null | undefined) {
  if (value === 'PERCENT') return '% tiền hàng';
  if (value === 'PER_UNIT') return 'Giảm mỗi đơn vị';
  return 'Giảm tổng dòng';
}

export default function PurchaseOrderEditorV3({
  mode,
  purchaseOrder,
  suppliers,
  warehouses,
  products: _products,
  onClose,
  onSaved,
}: Props) {
  const [supplierId, setSupplierId] = useState(purchaseOrder?.supplierId ?? '');
  const [warehouseId, setWarehouseId] = useState(purchaseOrder?.warehouseId ?? '');
  const [orderDate, setOrderDate] = useState(purchaseOrder?.placedAt ?? localToday());
  const [expectedDate, setExpectedDate] = useState(purchaseOrder?.expectedAt ?? '');
  const [supplierReference, setSupplierReference] = useState(purchaseOrder?.supplierReference ?? '');
  const [note, setNote] = useState(purchaseOrder?.note ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() => initialLines(purchaseOrder));
  const [entryMode, setEntryMode] = useState<EntryMode>('quick');
  const [eligibilityFilter, setEligibilityFilter] = useState<PurchaseOrderSkuFilter>(PURCHASE_ORDER_SKU_FILTERS.eligible);
  const [quickTerm, setQuickTerm] = useState('');
  const [quickResults, setQuickResults] = useState<PurchaseOrderSkuSearchOption[]>([]);
  const [quickHasMore, setQuickHasMore] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);
  const [activeQuickIndex, setActiveQuickIndex] = useState(0);
  const [browseTerm, setBrowseTerm] = useState('');
  const [browseResults, setBrowseResults] = useState<PurchaseOrderSkuSearchOption[]>([]);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseUnit, setBrowseUnit] = useState('all');
  const [selectedBrowseIds, setSelectedBrowseIds] = useState<Set<string>>(new Set());
  const [bulkSourceMode, setBulkSourceMode] = useState<BulkSourceMode>('file');
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => `po-${crypto.randomUUID()}`);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const browseControllerRef = useRef<AbortController | null>(null);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [suppliers],
  );
  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  );
  const filteredQuickResults = useMemo(
    () => filterPurchaseOrderSkuOptions(quickResults, eligibilityFilter),
    [quickResults, eligibilityFilter],
  );
  const browseUnits = useMemo(
    () => [...new Set(browseResults.map((option) => option.unitCode).filter((value): value is string => Boolean(value)))].sort(),
    [browseResults],
  );
  const filteredBrowseResults = useMemo(() => {
    const byEligibility = filterPurchaseOrderSkuOptions(browseResults, eligibilityFilter);
    return browseUnit === 'all' ? byEligibility : byEligibility.filter((option) => option.unitCode === browseUnit);
  }, [browseResults, browseUnit, eligibilityFilter]);
  const browseGroups = useMemo(() => groupPurchaseOrderSkuOptions(filteredBrowseResults), [filteredBrowseResults]);
  const totals = useMemo(() => calculatePurchaseOrderDraftTotals(lines), [lines]);
  const validBulkCount = bulkPreview.filter((row) => row.errors.length === 0 && row.option && !row.resolutionError).length;
  const activeOptionId = filteredQuickResults[activeQuickIndex] ? `po-sku-option-${filteredQuickResults[activeQuickIndex].id}` : undefined;

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('Đơn đặt hàng có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?')) return;
    browseControllerRef.current?.abort();
    onClose();
  }, [busy, dirty, onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    return () => browseControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    function handleDialogKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleDialogKeyboard);
    return () => document.removeEventListener('keydown', handleDialogKeyboard);
  }, [requestClose]);

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  function markChanged() {
    setDirty(true);
    setAttemptKey(`po-${crypto.randomUUID()}`);
    setError(null);
  }

  async function fetchSkuPage(term: string, offset: number, signal?: AbortSignal) {
    const query = new URLSearchParams({ search: term.trim(), limit: String(SEARCH_PAGE_SIZE), offset: String(offset) });
    return requestJson<PurchaseOrderSkuSearchOption[]>(`/api/purchase-orders/sku-search?${query.toString()}`, { signal });
  }

  useEffect(() => {
    if (entryMode !== 'quick') return undefined;
    const term = quickTerm.trim();
    setActiveQuickIndex(0);
    if (term.length < MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH) {
      setQuickResults([]);
      setQuickHasMore(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setQuickLoading(true);
      try {
        const results = await fetchSkuPage(term, 0, controller.signal);
        if (controller.signal.aborted) return;
        setQuickResults(results);
        setQuickHasMore(results.length === SEARCH_PAGE_SIZE);
        setError(null);
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setQuickResults([]);
        setQuickHasMore(false);
        setError(searchError instanceof Error ? searchError.message : 'Không tải được danh sách SKU.');
      } finally {
        if (!controller.signal.aborted) setQuickLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [quickTerm, entryMode]);

  const searchBrowse = useCallback(async (append = false) => {
    browseControllerRef.current?.abort();
    const controller = new AbortController();
    browseControllerRef.current = controller;
    setBrowseLoading(true);
    if (!append) setSelectedBrowseIds(new Set());
    try {
      const offset = append ? browseResults.length : 0;
      const results = await fetchSkuPage(browseTerm, offset, controller.signal);
      if (controller.signal.aborted) return;
      setBrowseResults((current) => append
        ? [...new Map([...current, ...results].map((option) => [option.id, option])).values()]
        : results);
      setBrowseHasMore(results.length === SEARCH_PAGE_SIZE);
      setError(null);
    } catch (searchError) {
      if (controller.signal.aborted) return;
      if (!append) setBrowseResults([]);
      setBrowseHasMore(false);
      setError(searchError instanceof Error ? searchError.message : 'Không tải được danh mục SKU.');
    } finally {
      if (!controller.signal.aborted) setBrowseLoading(false);
    }
  }, [browseResults.length, browseTerm]);

  useEffect(() => {
    if (entryMode === 'browse' && browseResults.length === 0 && !browseLoading) void searchBrowse(false);
  }, [entryMode]);

  async function loadMoreQuick() {
    if (!quickHasMore || quickLoading) return;
    setQuickLoading(true);
    try {
      const results = await fetchSkuPage(quickTerm, quickResults.length);
      setQuickResults((current) => [...new Map([...current, ...results].map((option) => [option.id, option])).values()]);
      setQuickHasMore(results.length === SEARCH_PAGE_SIZE);
      setError(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Không tải thêm được SKU.');
    } finally {
      setQuickLoading(false);
    }
  }

  function addSku(option: PurchaseOrderSkuSearchOption | null) {
    if (!option) return setError('Vui lòng chọn một SKU mua hàng.');
    if (!option.eligibility.selectable) return setError(option.eligibility.message);
    if (lines.some((line) => line.variantId === option.id)) return setError('SKU này đã có trong đơn đặt hàng.');
    markChanged();
    setLines((current) => [...current, editorLineFromOption(option)]);
    setQuickTerm('');
    setQuickResults([]);
  }

  function addBrowseSelection() {
    const existingIds = new Set(lines.map((line) => line.variantId));
    const options = browseResults.filter((option) => selectedBrowseIds.has(option.id) && option.eligibility.selectable && !existingIds.has(option.id));
    if (options.length === 0) return setError('Chưa có SKU hợp lệ mới để thêm.');
    markChanged();
    setLines((current) => [...current, ...options.map(editorLineFromOption)]);
    setSelectedBrowseIds(new Set());
  }

  function handleQuickKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (filteredQuickResults.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveQuickIndex((current) => Math.min(current + 1, filteredQuickResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveQuickIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      addSku(filteredQuickResults[activeQuickIndex] ?? null);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setQuickTerm('');
      setQuickResults([]);
    }
  }

  function updateLine(key: string, field: keyof PurchaseOrderDraftLine, value: string) {
    markChanged();
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  }

  function updateDecimalLine(key: string, field: 'quantity' | 'unitPrice' | 'discountValue' | 'taxRate', value: string) {
    if (isSafeDecimalIntermediate(value)) updateLine(key, field, value);
  }

  function formatLineDecimal(key: string, field: 'quantity' | 'unitPrice' | 'discountValue' | 'taxRate', fallback = '0') {
    setLines((current) => current.map((line) => line.key === key
      ? { ...line, [field]: cleanDecimal(String(line[field] ?? ''), fallback) }
      : line));
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${purchaseOrderBulkTemplate()}`], { type: 'text/tab-separated-values;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'mau-nhap-don-dat-hang.tsv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  async function handleBulkFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_BULK_FILE_BYTES) return setError('Tệp nhập nhiều dòng không được vượt quá 2 MB.');
    try {
      const text = await file.text();
      setBulkText(text);
      setBulkPreview([]);
      setError(null);
    } catch {
      setError('Không đọc được tệp đã chọn.');
    }
  }

  async function checkBulkRows() {
    const parsed = initialBulkPreview(bulkText);
    setBulkPreview(parsed);
    const candidates = parsed.filter((row) => row.errors.length === 0);
    if (candidates.length === 0) return setError('Chưa có dòng nào đúng định dạng để kiểm tra SKU.');
    setBulkResolving(true);
    setError(null);
    try {
      const resolutions = await requestJson<PurchaseOrderSkuResolution[]>('/api/purchase-orders/sku-resolve', {
        method: 'POST',
        body: JSON.stringify({ identifiers: candidates.map((row) => row.sku) }),
      });
      const resolutionByIdentifier = new Map(resolutions.map((resolution) => [normalizedIdentifier(resolution.identifier), resolution]));
      const existingIds = new Set(lines.map((line) => line.variantId));
      const batchIds = new Set<string>();
      const next = parsed.map((row): BulkPreviewRow => {
        if (row.errors.length > 0) return row;
        const resolution = resolutionByIdentifier.get(normalizedIdentifier(row.sku));
        if (!resolution?.option || resolution.error) return { ...row, option: null, resolutionError: resolution?.error?.message || 'Không tìm thấy SKU hoặc mã vạch.' };
        if (!resolution.option.eligibility.selectable) return { ...row, option: resolution.option, resolutionError: resolution.option.eligibility.message };
        if (existingIds.has(resolution.option.id)) return { ...row, option: resolution.option, resolutionError: 'SKU đã có trong đơn hiện tại.' };
        if (batchIds.has(resolution.option.id)) return { ...row, option: resolution.option, resolutionError: 'SKU bị lặp trong dữ liệu nhập.' };
        batchIds.add(resolution.option.id);
        return { ...row, option: resolution.option, resolutionError: null };
      });
      setBulkPreview(next);
      if (!next.some((row) => row.option && !row.resolutionError && row.errors.length === 0)) setError('Không có dòng hợp lệ để thêm vào đơn.');
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Không kiểm tra được dữ liệu SKU.');
    } finally {
      setBulkResolving(false);
    }
  }

  function addBulkRows() {
    const additions = bulkPreview
      .filter((row) => row.errors.length === 0 && row.option?.eligibility.selectable && !row.resolutionError)
      .map((row): EditorLine => {
        const option = row.option as PurchaseOrderSkuSearchOption;
        return {
          ...editorLineFromOption(option),
          quantity: toApiDecimal(row.quantity, '1'),
          unitPrice: toApiDecimal(row.unitPrice, '0'),
          discountMode: row.discountMode,
          discountValue: toApiDecimal(row.discountValue, '0'),
          taxRate: toApiDecimal(row.taxRate, '0'),
          note: row.note,
        };
      });
    if (additions.length === 0) return setError('Không có dòng hợp lệ đã kiểm tra để thêm.');
    markChanged();
    setLines((current) => [...current, ...additions]);
    setBulkText('');
    setBulkPreview([]);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft: PurchaseOrderDraft = {
      supplierId,
      warehouseId,
      orderDate,
      expectedDate,
      supplierReference,
      currencyCode: purchaseOrder?.currency || 'VND',
      note,
      lines: lines.map(({ variantId, quantity, unitPrice, discountMode, discountValue, taxRate, taxAmount, note: lineNote }) => {
        const normalizedTaxRate = normalizeDecimalForApi(taxRate ?? '');
        return {
          variantId,
          quantity: toApiDecimal(quantity, quantity),
          unitPrice: toApiDecimal(unitPrice, '0'),
          discountMode: discountMode ?? 'TOTAL_AMOUNT',
          discountValue: toApiDecimal(discountValue ?? '0', '0'),
          ...(normalizedTaxRate === null ? { taxAmount: toApiDecimal(taxAmount ?? '0', '0') } : { taxRate: normalizedTaxRate }),
          note: lineNote,
        };
      }),
      ...(mode === 'edit' && purchaseOrder ? { expectedRevision: purchaseOrder.revision } : {}),
    };
    const validationError = validateDraft(draft);
    if (validationError) return setError(validationError);
    setBusy(true);
    setError(null);
    try {
      const saved = await requestJson<PurchaseOrder>(
        mode === 'edit' && purchaseOrder ? `/api/purchase-orders/${purchaseOrder.id}` : '/api/purchase-orders',
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: { 'Idempotency-Key': attemptKey },
          body: JSON.stringify(draft),
        },
      );
      setDirty(false);
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được đơn đặt hàng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) requestClose(); }}>
      <section ref={dialogRef} className={localStyles.dialog} role="dialog" aria-modal="true" aria-labelledby="purchase-order-editor-title">
        <header className={localStyles.dialogHeader}>
          <div><p className={styles.panelKicker}>{mode === 'create' ? 'Tạo mới' : 'Chỉnh sửa bản nháp'}</p><h3 id="purchase-order-editor-title">{mode === 'create' ? 'Đơn đặt hàng mới' : purchaseOrder?.number || 'Đơn chưa cấp số'}</h3></div>
          <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={requestClose} disabled={busy}>Đóng</button>
        </header>

        <form className={localStyles.form} onSubmit={save}>
          <div className={localStyles.dialogBody}>
            {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}

            <section className={localStyles.section} aria-labelledby="po-header-title">
              <div className={localStyles.sectionTitle}><h4 id="po-header-title">Thông tin đặt hàng</h4><span>Nhà cung cấp, kho nhận và thời gian dự kiến</span></div>
              <div className={localStyles.headerGrid}>
                <label>Nhà cung cấp<select value={supplierId} onChange={(event) => { markChanged(); setSupplierId(event.target.value); }} required><option value="">Chọn nhà cung cấp</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}</select></label>
                <label>Kho nhận<select value={warehouseId} onChange={(event) => { markChanged(); setWarehouseId(event.target.value); }} required><option value="">Chọn kho nhận</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
                <label>Tiền tệ<input value={purchaseOrder?.currency || 'VND'} readOnly /></label>
                <label>Ngày đặt hàng<input type="date" value={orderDate} onChange={(event) => { markChanged(); setOrderDate(event.target.value); }} required /></label>
                <label>Ngày dự kiến nhận<input type="date" value={expectedDate} min={orderDate} onChange={(event) => { markChanged(); setExpectedDate(event.target.value); }} /></label>
                <label>Tham chiếu nhà cung cấp<input value={supplierReference} maxLength={256} onChange={(event) => { markChanged(); setSupplierReference(event.target.value); }} /></label>
                <label className={localStyles.fullWidth}>Ghi chú đơn hàng<input value={note} maxLength={4000} onChange={(event) => { markChanged(); setNote(event.target.value); }} /></label>
              </div>
            </section>

            <section className={localStyles.section} aria-labelledby="po-entry-title">
              <div className={localStyles.sectionTitle}><h4 id="po-entry-title">Thêm sản phẩm vào đơn</h4><span>Chọn cách phù hợp với thói quen làm việc</span></div>
              <div className={localStyles.modeTabs} role="tablist" aria-label="Cách thêm dòng đặt hàng">
                {([['quick', 'Tìm nhanh'], ['browse', 'Chọn từ danh mục'], ['bulk', 'Nhập nhiều dòng']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={entryMode === value} className={entryMode === value ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => { setEntryMode(value); setError(null); }}>{label}</button>)}
              </div>

              {entryMode !== 'bulk' ? <div className={localStyles.filterBar}><label>Trạng thái SKU<select value={eligibilityFilter} onChange={(event) => setEligibilityFilter(event.target.value as PurchaseOrderSkuFilter)}><option value="eligible">Có thể mua</option><option value="setup">Cần thiết lập</option><option value="all">Tất cả</option></select></label><Link href="/products" className={localStyles.catalogLink}>Mở thiết lập sản phẩm</Link></div> : null}

              {entryMode === 'quick' ? <div className={localStyles.modePanel}>
                <div className={localStyles.quickRow}><label htmlFor="po-quick-search">Từ khóa sản phẩm hoặc SKU</label><p className={localStyles.hint}>{quickTerm.trim().length < MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH ? 'Nhập ít nhất 2 ký tự để tìm.' : `${filteredQuickResults.length} kết quả đang hiển thị.`}</p></div>
                <div className={localStyles.searchInputWrap}><input id="po-quick-search" aria-label="Từ khóa sản phẩm hoặc SKU" role="combobox" aria-expanded={filteredQuickResults.length > 0} aria-controls="po-quick-results" aria-activedescendant={activeOptionId} placeholder="Mã sản phẩm, tên, SKU hoặc mã vạch" value={quickTerm} onKeyDown={handleQuickKeyDown} onChange={(event) => setQuickTerm(event.target.value)} />{quickTerm ? <button type="button" aria-label="Xóa từ khóa tìm SKU" onClick={() => { setQuickTerm(''); setQuickResults([]); setError(null); }}>Xóa</button> : null}</div>
                <div id="po-quick-results" role="listbox" className={localStyles.resultList}>
                  {quickLoading ? <p className={localStyles.empty}>Đang tìm SKU…</p> : null}
                  {!quickLoading && quickTerm.trim().length >= 2 && filteredQuickResults.length === 0 ? <p className={localStyles.empty}>Không tìm thấy SKU phù hợp với bộ lọc.</p> : null}
                  {filteredQuickResults.map((option, index) => <div id={`po-sku-option-${option.id}`} key={option.id} role="option" tabIndex={-1} aria-selected={activeQuickIndex === index} className={`${localStyles.resultCard} ${activeQuickIndex === index ? localStyles.resultCardActive : ''}`} onMouseEnter={() => setActiveQuickIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (option.eligibility.selectable) addSku(option); else setError(option.eligibility.message); }}><span className={localStyles.resultIdentity}><strong>{option.productCode} — {option.productName}</strong><span>{option.sku} — {option.variantName}</span></span><span className={localStyles.resultMeta}>{option.unitCode || 'Chưa có đơn vị'} · Quy đổi {option.conversionToBase || '—'}</span><span className={option.eligibility.selectable ? localStyles.eligible : localStyles.needsSetup}>{option.eligibility.message}</span></div>)}
                  {quickHasMore ? <button type="button" className={localStyles.loadMore} onClick={() => void loadMoreQuick()} disabled={quickLoading}>Tải thêm kết quả</button> : null}
                </div>
              </div> : null}

              {entryMode === 'browse' ? <div className={localStyles.modePanel}>
                <div className={localStyles.browseFilters}><label>Lọc sản phẩm<input value={browseTerm} placeholder="Mã hoặc tên sản phẩm" onChange={(event) => setBrowseTerm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchBrowse(false); } }} /></label><label>Đơn vị<select value={browseUnit} onChange={(event) => setBrowseUnit(event.target.value)}><option value="all">Tất cả đơn vị</option>{browseUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><button type="button" className={styles.secondaryButton} onClick={() => void searchBrowse(false)} disabled={browseLoading}>{browseLoading ? 'Đang lọc…' : 'Lọc danh mục'}</button></div>
                <div className={localStyles.browseSummary}><span>{browseGroups.length} sản phẩm · {filteredBrowseResults.length} SKU</span><button type="button" className={styles.primaryButton} onClick={addBrowseSelection} disabled={selectedBrowseIds.size === 0}>Thêm {selectedBrowseIds.size || ''} SKU đã chọn</button></div>
                <div className={localStyles.productGroups}>{browseLoading && browseResults.length === 0 ? <p className={localStyles.empty}>Đang tải danh mục…</p> : null}{!browseLoading && browseGroups.length === 0 ? <p className={localStyles.empty}>Không có sản phẩm phù hợp.</p> : null}{browseGroups.map((group) => <details key={group.productId} className={localStyles.productGroup}><summary><span><strong>{group.productCode}</strong> — {group.productName}</span><span>{group.options.length} SKU</span></summary><div className={localStyles.productSkuList}>{group.options.map((option) => { const checked = selectedBrowseIds.has(option.id); return <label key={option.id} className={localStyles.browseSku}><input type="checkbox" checked={checked} disabled={!option.eligibility.selectable || lines.some((line) => line.variantId === option.id)} onChange={(event) => setSelectedBrowseIds((current) => { const next = new Set(current); if (event.target.checked) next.add(option.id); else next.delete(option.id); return next; })} /><span className={localStyles.resultIdentity}><strong>{option.sku} — {option.variantName}</strong><span>{option.unitCode || 'Chưa có đơn vị'} · Quy đổi {option.conversionToBase || '—'}</span></span><span className={option.eligibility.selectable ? localStyles.eligible : localStyles.needsSetup}>{option.eligibility.message}</span></label>; })}</div></details>)}</div>
                {browseHasMore ? <button type="button" className={localStyles.loadMore} onClick={() => void searchBrowse(true)} disabled={browseLoading}>Tải thêm sản phẩm/SKU</button> : null}
              </div> : null}

              {entryMode === 'bulk' ? <div className={localStyles.modePanel}>
                <div className={localStyles.bulkIntro}><div><strong>Nhập nhiều dòng theo 3 bước</strong><span>Chọn tệp hoặc dán dữ liệu → Kiểm tra → Thêm dòng hợp lệ</span></div><button type="button" className={styles.secondaryButton} onClick={downloadTemplate}>Tải tệp mẫu</button></div>
                <div className={localStyles.bulkTabs} role="tablist"><button type="button" className={bulkSourceMode === 'file' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => setBulkSourceMode('file')}>Chọn tệp</button><button type="button" className={bulkSourceMode === 'paste' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => setBulkSourceMode('paste')}>Dán từ Excel</button></div>
                {bulkSourceMode === 'file' ? <label className={localStyles.fileDrop}>Chọn tệp CSV, TSV hoặc TXT<input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={(event) => void handleBulkFile(event.target.files?.[0] ?? null)} /><span>Tối đa 2 MB. Dùng tệp mẫu để đúng tên cột.</span></label> : <label>Dán bảng từ Excel<textarea value={bulkText} onChange={(event) => { setBulkText(event.target.value); setBulkPreview([]); }} rows={7} placeholder={'SKU\tSố lượng\tĐơn giá\tKiểu chiết khấu\tGiá trị chiết khấu\tThuế %\tGhi chú'} /></label>}
                {bulkSourceMode === 'file' && bulkText ? <p className={localStyles.fileReady}>Đã đọc tệp: {initialBulkPreview(bulkText).length} dòng dữ liệu.</p> : null}
                <div className={localStyles.bulkActions}><button type="button" className={styles.secondaryButton} onClick={() => void checkBulkRows()} disabled={bulkResolving || !bulkText.trim()}>{bulkResolving ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu'}</button><button type="button" className={styles.primaryButton} onClick={addBulkRows} disabled={validBulkCount === 0}>Thêm {validBulkCount || ''} dòng hợp lệ</button></div>
                {bulkPreview.length ? <div className={localStyles.previewWrap}><table className={localStyles.previewTable}><thead><tr><th>Dòng</th><th>SKU</th><th>Số lượng</th><th>Đơn giá</th><th>Chiết khấu</th><th>Thuế</th><th>Kết quả</th></tr></thead><tbody>{bulkPreview.map((row) => { const messages = [...row.errors, ...(row.resolutionError ? [row.resolutionError] : [])]; return <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.sku || '—'}</td><td>{row.quantity || '—'}</td><td>{row.unitPrice}</td><td>{discountModeLabel(row.discountMode)} · {row.discountValue}</td><td>{row.taxRate}%</td><td className={messages.length ? localStyles.previewError : localStyles.previewSuccess}>{messages.length ? messages.join(' ') : `Hợp lệ: ${row.option?.sku ?? ''}`}</td></tr>; })}</tbody></table></div> : null}
              </div> : null}
            </section>

            <section className={localStyles.section} aria-labelledby="po-lines-title"><div className={localStyles.sectionTitle}><h4 id="po-lines-title">Dòng đặt hàng</h4><span>{lines.length} SKU trong bản nháp</span></div><div className={localStyles.lineList}>{lines.length === 0 ? <p className={localStyles.empty}>Chưa có SKU trong đơn đặt hàng.</p> : lines.map((line, index) => <article key={line.key} className={localStyles.lineCard}><div className={localStyles.lineHeading}><div><strong>{line.sku}</strong><span>{line.name}</span></div><button type="button" className={styles.secondaryButton} onClick={() => { markChanged(); setLines((current) => current.filter((item) => item.key !== line.key)); }}>Xóa dòng</button></div><div className={localStyles.lineFields}><label>Số lượng<input value={line.quantity} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'quantity', '1')} onChange={(event) => updateDecimalLine(line.key, 'quantity', event.target.value)} /></label><label>Đơn vị<input value={line.unitCode} readOnly /></label><label>Quy đổi<input value={line.conversionToBase} readOnly /></label><label>Đơn giá<input value={line.unitPrice} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'unitPrice', '0')} onChange={(event) => updateDecimalLine(line.key, 'unitPrice', event.target.value)} /></label><label className={localStyles.discountMode}>Kiểu chiết khấu<select value={line.discountMode ?? 'TOTAL_AMOUNT'} onChange={(event) => updateLine(line.key, 'discountMode', event.target.value as PurchaseOrderDiscountMode)}><option value="PERCENT">% tiền hàng</option><option value="PER_UNIT">Giảm mỗi đơn vị</option><option value="TOTAL_AMOUNT">Giảm tổng dòng</option></select></label><label>Giá trị chiết khấu<input value={line.discountValue ?? '0'} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'discountValue', '0')} onChange={(event) => updateDecimalLine(line.key, 'discountValue', event.target.value)} /></label><label>Thuế suất %<input value={line.taxRate ?? ''} inputMode="decimal" aria-label={`Thuế suất dòng ${index + 1}`} onBlur={() => formatLineDecimal(line.key, 'taxRate', '')} onChange={(event) => updateDecimalLine(line.key, 'taxRate', event.target.value)} /></label><div className={localStyles.amountField}><span>Thành tiền</span><strong>{formatPurchaseOrderAmount(totals.lineTotals[index], purchaseOrder?.currency || 'VND')}</strong></div><label className={localStyles.lineNote}>Ghi chú dòng<input value={line.note} maxLength={2000} onChange={(event) => updateLine(line.key, 'note', event.target.value)} /></label></div></article>)}</div></section>

            <section className={localStyles.totals} aria-label="Tổng tiền đơn đặt hàng"><div><span>Tiền hàng</span><strong>{formatPurchaseOrderAmount(totals.subtotal, purchaseOrder?.currency || 'VND')}</strong></div><div><span>Chiết khấu</span><strong>{formatPurchaseOrderAmount(totals.discountTotal, purchaseOrder?.currency || 'VND')}</strong></div><div><span>Thuế</span><strong>{formatPurchaseOrderAmount(totals.taxTotal, purchaseOrder?.currency || 'VND')}</strong></div><div><span>Tổng cộng</span><strong>{formatPurchaseOrderAmount(totals.total, purchaseOrder?.currency || 'VND')}</strong></div></section>
          </div>

          <footer className={localStyles.dialogFooter}><button type="button" className={styles.secondaryButton} onClick={requestClose} disabled={busy}>Hủy thao tác</button><button type="submit" className={styles.primaryButton} disabled={busy} data-testid="purchase-order-save">{busy ? 'Đang lưu…' : mode === 'create' ? 'Lưu đơn nháp' : 'Lưu thay đổi'}</button></footer>
        </form>
      </section>
    </div>
  );
}
