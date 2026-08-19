'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import type { Supplier } from '../../../../lib/supplier-types';
import type { Product } from '../../../../lib/product-types';
import type { Warehouse } from '../../../../lib/organization-types';
import type {
  PurchaseOrder,
  PurchaseOrderDiscountMode,
  PurchaseOrderDraft,
  PurchaseOrderDraftLine,
  PurchaseOrderPriceSource,
  PurchaseOrderPriceStatus,
  PurchaseOrderSkuResolution,
  PurchaseOrderSkuSearchOption,
  SupplierPurchasePriceResolution,
} from '../../../../lib/purchase-order-types';
import {
  calculatePurchaseOrderDraftTotals,
  decimalToScaled,
  formatPurchaseOrderAmount,
  PURCHASE_ORDER_PERMISSION_KEYS,
} from '../../../../lib/purchase-order-types';
import {
  formatDecimalForInput,
  isSafeDecimalIntermediate,
  normalizeDecimalForApi,
  parsePurchaseOrderPasteGrid,
} from '../../../../lib/purchase-order-line-entry';
import {
  MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH,
  PURCHASE_ORDER_BULK_TEMPLATE_FILENAME,
  PURCHASE_ORDER_BULK_TEMPLATE_MIME,
  PURCHASE_ORDER_SKU_FILTERS,
  filterPurchaseOrderSkuOptions,
  normalizePurchaseOrderSkuSearchFailure,
  type PurchaseOrderSkuFilter,
} from '../../../../lib/purchase-order-sku-entry';
import styles from '../../../organization/organization.module.css';
import localStyles from './purchase-order-editor-v2.module.css';
import priceStyles from './purchase-order-price.module.css';

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
  permissionKeys: string[];
  onClose: () => void;
  onSaved: (purchaseOrder: PurchaseOrder) => void;
};

type EditorLine = {
  key: string;
  variantId: string;
  sku: string;
  name: string;
  unitId: string;
  unitCode: string;
  conversionToBase: string;
  quantity: string;
  unitPrice: string;
  discountMode: PurchaseOrderDiscountMode;
  discountValue: string;
  taxRate: string;
  note: string;
  priceStatus: PurchaseOrderPriceStatus;
  priceSource: PurchaseOrderPriceSource;
  manualOverride: boolean;
  priceOverrideReason: string;
  resolvingPrice: boolean;
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

function positiveDecimal(value: string | null | undefined) {
  const normalized = normalizeDecimalForApi(value ?? '');
  return normalized !== null && decimalToScaled(normalized, false) !== null;
}

function initialLines(purchaseOrder: PurchaseOrder | null): EditorLine[] {
  return (purchaseOrder?.lines ?? []).map((line) => ({
    key: line.id || crypto.randomUUID(),
    variantId: line.variantId,
    sku: line.skuCode,
    name: line.itemName,
    unitId: line.unitId,
    unitCode: line.unitCode,
    conversionToBase: cleanDecimal(line.conversionToBase, '1'),
    quantity: cleanDecimal(line.quantity, '1'),
    unitPrice: line.unitPrice === undefined ? '' : cleanDecimal(line.unitPrice, ''),
    discountMode: line.discountMode ?? 'TOTAL_AMOUNT',
    discountValue: cleanDecimal(line.discountValue ?? line.discountAmount, '0'),
    taxRate: line.taxRate === null || line.taxRate === undefined ? '0' : cleanDecimal(line.taxRate, '0'),
    note: line.note ?? '',
    priceStatus: line.priceStatus ?? (positiveDecimal(line.unitPrice) ? 'RESOLVED' : 'NOT_FOUND'),
    priceSource: line.purchasePriceSource ?? null,
    manualOverride: line.purchasePriceSource === 'MANUAL_OVERRIDE',
    priceOverrideReason: line.priceOverrideReason ?? '',
    resolvingPrice: false,
  }));
}

function editorLineFromOption(option: PurchaseOrderSkuSearchOption): EditorLine {
  return {
    key: crypto.randomUUID(),
    variantId: option.id,
    sku: option.sku,
    name: option.variantName,
    unitId: option.unitId ?? '',
    unitCode: option.unitCode ?? '',
    conversionToBase: cleanDecimal(option.conversionToBase, '1'),
    quantity: '1',
    unitPrice: '',
    discountMode: 'TOTAL_AMOUNT',
    discountValue: '0',
    taxRate: '0',
    note: '',
    priceStatus: 'NOT_FOUND',
    priceSource: null,
    manualOverride: false,
    priceOverrideReason: '',
    resolvingPrice: false,
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
          message: base.message || 'Không thực hiện được yêu cầu đơn mua hàng.',
          statusCode: base.statusCode || 500,
          retryable: base.retryable === true,
        };
    throw new UiRequestError(normalized.message, normalized.code, normalized.statusCode, normalized.retryable);
  }
  return payload.data;
}

function normalizedIdentifier(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

function initialBulkPreview(text: string): BulkPreviewRow[] {
  return parsePurchaseOrderPasteGrid(text).map((row) => ({ ...row, option: null, resolutionError: null }));
}

function discountModeLabel(value: string | null | undefined) {
  if (value === 'PERCENT') return '% tiền hàng';
  if (value === 'PER_UNIT') return 'Giảm mỗi đơn vị';
  return 'Giảm tổng dòng';
}

function sourceLabel(line: EditorLine) {
  if (line.manualOverride || line.priceSource === 'MANUAL_OVERRIDE') return 'Giá nhập thủ công';
  if (line.priceStatus === 'RESOLVED') return 'Giá nhà cung cấp';
  return 'Chưa có giá mua';
}

function sourceClass(line: EditorLine) {
  if (line.manualOverride || line.priceSource === 'MANUAL_OVERRIDE') return priceStyles.manual;
  return line.priceStatus === 'RESOLVED' ? priceStyles.resolved : priceStyles.notFound;
}

export default function PurchaseOrderEditorV4({
  mode,
  purchaseOrder,
  suppliers,
  warehouses,
  products: _products,
  permissionKeys,
  onClose,
  onSaved,
}: Props) {
  const permissions = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canReadPrice = permissions.has(PURCHASE_ORDER_PERMISSION_KEYS.priceRead);
  const canOverridePrice = canReadPrice && permissions.has(PURCHASE_ORDER_PERMISSION_KEYS.priceOverride);

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
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickHasMore, setQuickHasMore] = useState(false);
  const [activeQuickIndex, setActiveQuickIndex] = useState(0);
  const [browseTerm, setBrowseTerm] = useState('');
  const [browseResults, setBrowseResults] = useState<PurchaseOrderSkuSearchOption[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [selectedBrowseIds, setSelectedBrowseIds] = useState<Set<string>>(new Set());
  const [bulkSourceMode, setBulkSourceMode] = useState<BulkSourceMode>('file');
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [bulkOverrideReason, setBulkOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => createIdempotencyKey('purchase-order-save'));
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.is_active).sort((left, right) => left.code.localeCompare(right.code)),
    [suppliers],
  );
  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.is_active).sort((left, right) => left.code.localeCompare(right.code)),
    [warehouses],
  );
  const filteredQuickResults = useMemo(
    () => filterPurchaseOrderSkuOptions(quickResults, eligibilityFilter),
    [quickResults, eligibilityFilter],
  );
  const filteredBrowseResults = useMemo(
    () => filterPurchaseOrderSkuOptions(browseResults, eligibilityFilter),
    [browseResults, eligibilityFilter],
  );
  const activeOptionId = filteredQuickResults[activeQuickIndex]
    ? `po-sku-option-${filteredQuickResults[activeQuickIndex].id}`
    : undefined;
  const totals = useMemo(() => calculatePurchaseOrderDraftTotals(lines.map((line) => ({
    variantId: line.variantId,
    quantity: toApiDecimal(line.quantity, '0'),
    unitPrice: toApiDecimal(line.unitPrice, '0'),
    discountMode: line.discountMode,
    discountValue: toApiDecimal(line.discountValue, '0'),
    taxRate: toApiDecimal(line.taxRate, '0'),
    note: line.note,
  }))), [lines]);
  const validBulkCount = bulkPreview.filter((row) => row.errors.length === 0 && row.option && !row.resolutionError).length;

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('Đơn mua hàng có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?')) return;
    onClose();
  }, [busy, dirty, onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
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
    setAttemptKey(createIdempotencyKey('purchase-order-save'));
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
        const result = await fetchSkuPage(term, 0, controller.signal);
        if (!controller.signal.aborted) {
          setQuickResults(result);
          setQuickHasMore(result.length === SEARCH_PAGE_SIZE);
          setError(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setQuickResults([]);
          setQuickHasMore(false);
          setError(failure instanceof Error ? failure.message : 'Không tải được danh sách SKU.');
        }
      } finally {
        if (!controller.signal.aborted) setQuickLoading(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [entryMode, quickTerm]);

  const searchBrowse = useCallback(async (append = false) => {
    setBrowseLoading(true);
    try {
      const offset = append ? browseResults.length : 0;
      const result = await fetchSkuPage(browseTerm, offset);
      setBrowseResults((current) => append
        ? [...new Map([...current, ...result].map((option) => [option.id, option])).values()]
        : result);
      setBrowseHasMore(result.length === SEARCH_PAGE_SIZE);
      if (!append) setSelectedBrowseIds(new Set());
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không tải được danh mục SKU.');
    } finally {
      setBrowseLoading(false);
    }
  }, [browseResults.length, browseTerm]);

  useEffect(() => {
    if (entryMode === 'browse' && browseResults.length === 0 && !browseLoading) void searchBrowse(false);
  }, [entryMode]);

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
      const option = filteredQuickResults[activeQuickIndex];
      if (!option) return;
      if (option.eligibility.selectable) void addOptions([option]);
      else setError(option.eligibility.message);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setQuickTerm('');
      setQuickResults([]);
      setError(null);
    }
  }

  async function resolveLineData(line: EditorLine): Promise<Partial<EditorLine>> {
    if (!supplierId || !orderDate || !line.unitId || !positiveDecimal(line.quantity)) {
      return { priceStatus: 'NOT_FOUND', priceSource: null, unitPrice: canReadPrice ? '' : line.unitPrice, resolvingPrice: false };
    }
    try {
      const resolution = await requestJson<SupplierPurchasePriceResolution>('/api/supplier-purchase-prices/resolve', {
        method: 'POST',
        body: JSON.stringify({
          supplierId,
          variantId: line.variantId,
          unitId: line.unitId,
          quantity: toApiDecimal(line.quantity, line.quantity),
          currencyCode: purchaseOrder?.currency || 'VND',
          orderDate,
        }),
      });
      if (resolution.status !== 'RESOLVED') {
        return { priceStatus: 'NOT_FOUND', priceSource: null, unitPrice: canReadPrice ? '' : line.unitPrice, resolvingPrice: false };
      }
      return {
        priceStatus: 'RESOLVED',
        priceSource: 'SUPPLIER_PRICE',
        unitPrice: canReadPrice && resolution.price ? cleanDecimal(resolution.price.unitPrice, '') : line.unitPrice,
        discountMode: 'TOTAL_AMOUNT',
        discountValue: '0',
        taxRate: '0',
        priceOverrideReason: '',
        manualOverride: false,
        resolvingPrice: false,
      };
    } catch {
      return { priceStatus: 'NOT_FOUND', priceSource: null, unitPrice: canReadPrice ? '' : line.unitPrice, resolvingPrice: false };
    }
  }

  async function refreshLinePrice(key: string, sourceLine?: EditorLine) {
    const line = sourceLine ?? lines.find((item) => item.key === key);
    if (!line || line.manualOverride) return;
    setLines((current) => current.map((item) => item.key === key ? { ...item, resolvingPrice: true } : item));
    const next = await resolveLineData(line);
    setLines((current) => current.map((item) => item.key === key ? { ...item, ...next } : item));
  }

  useEffect(() => {
    if (!supplierId || !orderDate || lines.length === 0) return undefined;
    const timeout = window.setTimeout(async () => {
      const automatic = lines.filter((line) => !line.manualOverride);
      const resolved = await Promise.all(automatic.map(async (line) => [line.key, await resolveLineData(line)] as const));
      const byKey = new Map(resolved);
      setLines((current) => current.map((line) => byKey.has(line.key) ? { ...line, ...byKey.get(line.key) } : line));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [supplierId, orderDate]);

  async function addOptions(options: PurchaseOrderSkuSearchOption[]) {
    if (!supplierId) return setError('Vui lòng chọn nhà cung cấp trước khi thêm SKU.');
    const existing = new Set(lines.map((line) => line.variantId));
    const candidates = options.filter((option) => option.eligibility.selectable && option.unitId && !existing.has(option.id));
    if (candidates.length === 0) return setError('Không có SKU hợp lệ mới để thêm.');
    markChanged();
    const baseLines = candidates.map(editorLineFromOption);
    const resolved = await Promise.all(baseLines.map(async (line) => ({ ...line, resolvingPrice: true, ...await resolveLineData(line) })));
    setLines((current) => [...current, ...resolved]);
    setQuickTerm('');
    setQuickResults([]);
    setSelectedBrowseIds(new Set());
  }

  function updateLine(key: string, patch: Partial<EditorLine>) {
    markChanged();
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function updateDecimalLine(key: string, field: 'quantity' | 'unitPrice' | 'discountValue' | 'taxRate', value: string) {
    if (isSafeDecimalIntermediate(value)) updateLine(key, { [field]: value });
  }

  function formatLineDecimal(key: string, field: 'quantity' | 'unitPrice' | 'discountValue' | 'taxRate', fallback = '0') {
    setLines((current) => current.map((line) => line.key === key
      ? { ...line, [field]: cleanDecimal(String(line[field] ?? ''), fallback) }
      : line));
  }

  function handleQuantityBlur(line: EditorLine) {
    const quantity = cleanDecimal(line.quantity, '1');
    setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity } : item));
    if (!line.manualOverride) void refreshLinePrice(line.key, { ...line, quantity });
  }

  function enableManualOverride(line: EditorLine) {
    if (!canOverridePrice) return;
    updateLine(line.key, {
      manualOverride: true,
      priceSource: 'MANUAL_OVERRIDE',
      unitPrice: line.unitPrice || '',
      priceOverrideReason: line.priceOverrideReason || '',
    });
  }

  async function useSupplierPrice(line: EditorLine) {
    const automaticLine: EditorLine = {
      ...line,
      manualOverride: false,
      priceSource: null,
      priceOverrideReason: '',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxRate: '0',
    };
    updateLine(line.key, {
      manualOverride: false,
      priceSource: null,
      priceOverrideReason: '',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxRate: '0',
    });
    await refreshLinePrice(line.key, automaticLine);
  }

  async function downloadTemplate() {
    try {
      const response = await fetch('/api/purchase-orders/bulk-template', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: PURCHASE_ORDER_BULK_TEMPLATE_MIME },
      });
      if (!response.ok) throw new Error('TEMPLATE_FAILED');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = PURCHASE_ORDER_BULK_TEMPLATE_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setError(null);
    } catch {
      setError('Không tải được tệp mẫu XLSX.');
    }
  }

  async function handleBulkFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_BULK_FILE_BYTES) return setError('Tệp nhập nhiều dòng không được vượt quá 2 MB.');
    try {
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.type === PURCHASE_ORDER_BULK_TEMPLATE_MIME;
      let text: string;
      if (isXlsx) {
        const response = await fetch('/api/purchase-orders/bulk-xlsx', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': PURCHASE_ORDER_BULK_TEMPLATE_MIME,
          },
          body: file,
        });
        const payload = await response.json().catch(() => ({})) as ApiEnvelope<{ text: string }>;
        if (!response.ok || !payload.data?.text) {
          throw new Error(payload.error?.message || 'Không đọc được tệp XLSX.');
        }
        text = payload.data.text;
      } else {
        text = await file.text();
      }
      setBulkText(text);
      setBulkPreview([]);
      setError(null);
    } catch (failure) {
      setBulkText('');
      setBulkPreview([]);
      setError(failure instanceof Error ? failure.message : 'Không đọc được tệp đã chọn.');
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
      const byIdentifier = new Map(resolutions.map((resolution) => [normalizedIdentifier(resolution.identifier), resolution]));
      const existing = new Set(lines.map((line) => line.variantId));
      const batch = new Set<string>();
      setBulkPreview(parsed.map((row): BulkPreviewRow => {
        if (row.errors.length > 0) return row;
        const resolution = byIdentifier.get(normalizedIdentifier(row.sku));
        if (!resolution?.option || resolution.error) return { ...row, option: null, resolutionError: resolution?.error?.message || 'Không tìm thấy SKU hoặc mã vạch.' };
        if (!resolution.option.eligibility.selectable || !resolution.option.unitId) return { ...row, option: resolution.option, resolutionError: resolution.option.eligibility.message };
        if (existing.has(resolution.option.id)) return { ...row, option: resolution.option, resolutionError: 'SKU đã có trong đơn hiện tại.' };
        if (batch.has(resolution.option.id)) return { ...row, option: resolution.option, resolutionError: 'SKU bị lặp trong dữ liệu nhập.' };
        batch.add(resolution.option.id);
        return { ...row, option: resolution.option, resolutionError: null };
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không kiểm tra được dữ liệu SKU.');
    } finally {
      setBulkResolving(false);
    }
  }

  async function addBulkRows() {
    if (!supplierId) return setError('Vui lòng chọn nhà cung cấp trước khi thêm dữ liệu.');
    const valid = bulkPreview.filter((row) => row.errors.length === 0 && row.option?.eligibility.selectable && !row.resolutionError);
    const includesManualPrice = canOverridePrice && valid.some((row) => positiveDecimal(row.unitPrice));
    if (includesManualPrice && !bulkOverrideReason.trim()) return setError('Vui lòng nhập lý do áp dụng giá nhập thủ công cho dữ liệu nhập nhiều dòng.');
    const base = valid.map((row): EditorLine => {
      const line = editorLineFromOption(row.option as PurchaseOrderSkuSearchOption);
      const manual = includesManualPrice && positiveDecimal(row.unitPrice);
      return {
        ...line,
        quantity: toApiDecimal(row.quantity, '1'),
        note: row.note,
        manualOverride: manual,
        priceSource: manual ? 'MANUAL_OVERRIDE' : null,
        unitPrice: manual ? toApiDecimal(row.unitPrice, '') : '',
        discountMode: manual ? row.discountMode : 'TOTAL_AMOUNT',
        discountValue: manual ? toApiDecimal(row.discountValue, '0') : '0',
        taxRate: manual ? toApiDecimal(row.taxRate, '0') : '0',
        priceOverrideReason: manual ? bulkOverrideReason.trim() : '',
      };
    });
    if (base.length === 0) return setError('Không có dòng hợp lệ đã kiểm tra để thêm.');
    const resolved = await Promise.all(base.map(async (line) => line.manualOverride ? line : ({ ...line, ...await resolveLineData(line) })));
    markChanged();
    setLines((current) => [...current, ...resolved]);
    setBulkText('');
    setBulkPreview([]);
    setBulkOverrideReason('');
  }

  function validateDraft(): string | null {
    if (!supplierId) return 'Vui lòng chọn nhà cung cấp.';
    if (!warehouseId) return 'Vui lòng chọn kho nhận.';
    if (!orderDate) return 'Vui lòng chọn ngày đặt hàng.';
    if (expectedDate && expectedDate < orderDate) return 'Ngày dự kiến nhận không được trước ngày đặt hàng.';
    if (lines.length === 0) return 'Đơn mua hàng phải có ít nhất một dòng SKU.';
    const seen = new Set<string>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (seen.has(line.variantId)) return 'Một SKU chỉ được xuất hiện một lần trong đơn.';
      seen.add(line.variantId);
      if (!positiveDecimal(line.quantity)) return `Số lượng dòng ${index + 1} phải lớn hơn 0.`;
      if (line.manualOverride) {
        if (!canOverridePrice) return `Dòng ${index + 1}: không có quyền nhập thủ công giá mua.`;
        if (!positiveDecimal(line.unitPrice)) return `Dòng ${index + 1}: giá nhập thủ công phải lớn hơn 0.`;
        if (!line.priceOverrideReason.trim()) return `Dòng ${index + 1}: phải nhập lý do thay giá mua.`;
      } else if (line.priceStatus !== 'RESOLVED') {
        return `Dòng ${index + 1}: chưa có giá mua hợp lệ. Hãy thiết lập bảng giá mua hoặc dùng quyền nhập thủ công.`;
      }
    }
    return null;
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateDraft();
    if (validation) return setError(validation);
    const draft: PurchaseOrderDraft = {
      supplierId,
      warehouseId,
      orderDate,
      expectedDate,
      supplierReference,
      currencyCode: purchaseOrder?.currency || 'VND',
      note,
      lines: lines.map((line): PurchaseOrderDraftLine => {
        const base = {
          variantId: line.variantId,
          quantity: toApiDecimal(line.quantity, line.quantity),
          note: line.note,
        };
        if (!line.manualOverride) return base;
        return {
          ...base,
          unitPrice: toApiDecimal(line.unitPrice, line.unitPrice),
          discountMode: line.discountMode,
          discountValue: toApiDecimal(line.discountValue, '0'),
          taxRate: toApiDecimal(line.taxRate, '0'),
          priceOverrideReason: line.priceOverrideReason.trim(),
        };
      }),
      ...(mode === 'edit' && purchaseOrder ? { expectedRevision: purchaseOrder.revision } : {}),
    };
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
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không lưu được đơn mua hàng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) requestClose(); }}>
      <section ref={dialogRef} className={localStyles.dialog} role="dialog" aria-modal="true" aria-labelledby="purchase-order-editor-title">
        <header className={localStyles.dialogHeader}>
          <div><p className={styles.panelKicker}>{mode === 'create' ? 'Tạo mới' : 'Chỉnh sửa bản nháp'}</p><h3 id="purchase-order-editor-title">{mode === 'create' ? 'Đơn mua hàng mới' : purchaseOrder?.number || 'Đơn chưa cấp số'}</h3></div>
          <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={requestClose} disabled={busy}>Đóng</button>
        </header>

        <form className={localStyles.form} onSubmit={save}>
          <div className={localStyles.dialogBody}>
            {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}

            <section className={localStyles.section}>
              <div className={localStyles.sectionTitle}><h4>Thông tin mua hàng</h4><span>Chọn nhà cung cấp trước để hệ thống xác định đúng giá mua.</span></div>
              <div className={localStyles.headerGrid}>
                <label>Nhà cung cấp<select value={supplierId} onChange={(event) => { markChanged(); setSupplierId(event.target.value); }}><option value="">Chọn nhà cung cấp</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}</select></label>
                <label>Kho nhận<select value={warehouseId} onChange={(event) => { markChanged(); setWarehouseId(event.target.value); }}><option value="">Chọn kho nhận</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
                <label>Ngày đặt<input type="date" value={orderDate} onChange={(event) => { markChanged(); setOrderDate(event.target.value); }} /></label>
                <label>Dự kiến nhận<input type="date" value={expectedDate} onChange={(event) => { markChanged(); setExpectedDate(event.target.value); }} /></label>
                <label>Tham chiếu nhà cung cấp<input value={supplierReference} maxLength={256} onChange={(event) => { markChanged(); setSupplierReference(event.target.value); }} /></label>
                <label className={localStyles.fullWidth}>Ghi chú đơn<input value={note} maxLength={4000} onChange={(event) => { markChanged(); setNote(event.target.value); }} /></label>
              </div>
            </section>

            <section className={localStyles.section}>
              <div className={localStyles.sectionTitle}><h4>Thêm SKU</h4><span>Giá bán nền không được dùng trong luồng này.</span></div>
              <div className={localStyles.modeTabs} role="tablist" aria-label="Cách thêm dòng mua hàng">
                <button type="button" role="tab" aria-selected={entryMode === 'quick'} className={entryMode === 'quick' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => { setEntryMode('quick'); setError(null); }}>Tìm nhanh</button>
                <button type="button" role="tab" aria-selected={entryMode === 'browse'} className={entryMode === 'browse' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => { setEntryMode('browse'); setError(null); }}>Chọn từ danh mục</button>
                <button type="button" role="tab" aria-selected={entryMode === 'bulk'} className={entryMode === 'bulk' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => { setEntryMode('bulk'); setError(null); }}>Nhập nhiều dòng</button>
              </div>

              {entryMode !== 'bulk' ? <div className={localStyles.filterBar}><label>Trạng thái SKU<select value={eligibilityFilter} onChange={(event) => setEligibilityFilter(event.target.value as PurchaseOrderSkuFilter)}><option value="eligible">Có thể mua</option><option value="setup">Cần thiết lập</option><option value="all">Tất cả</option></select></label><Link href="/products" className={localStyles.catalogLink}>Mở thiết lập sản phẩm</Link></div> : null}

              {entryMode === 'quick' ? <div className={localStyles.modePanel}>
                <div className={localStyles.quickRow}><label htmlFor="po-quick-search">Từ khóa sản phẩm hoặc SKU</label><p className={localStyles.hint}>{quickTerm.trim().length < MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH ? 'Nhập ít nhất 1 ký tự để tìm.' : `${filteredQuickResults.length} kết quả đang hiển thị.`}</p></div>
                <div className={localStyles.searchInputWrap}><input id="po-quick-search" aria-label="Từ khóa sản phẩm hoặc SKU" role="combobox" aria-expanded={filteredQuickResults.length > 0} aria-controls="po-quick-results" aria-activedescendant={activeOptionId} placeholder="Mã sản phẩm, tên, SKU hoặc mã vạch" value={quickTerm} onKeyDown={handleQuickKeyDown} onChange={(event) => setQuickTerm(event.target.value)} />{quickTerm ? <button type="button" aria-label="Xóa từ khóa tìm SKU" onClick={() => { setQuickTerm(''); setQuickResults([]); setError(null); }}>Xóa</button> : null}</div>
                <div id="po-quick-results" role="listbox" className={localStyles.resultList}>
                  {quickLoading ? <p className={localStyles.empty}>Đang tìm SKU…</p> : null}
                  {!quickLoading && quickTerm.trim().length >= MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH && filteredQuickResults.length === 0 ? <p className={localStyles.empty}>Không tìm thấy SKU phù hợp với bộ lọc.</p> : null}
                  {filteredQuickResults.map((option, index) => <div id={`po-sku-option-${option.id}`} key={option.id} role="option" tabIndex={-1} aria-selected={activeQuickIndex === index} className={`${localStyles.resultCard} ${activeQuickIndex === index ? localStyles.resultCardActive : ''}`} onMouseEnter={() => setActiveQuickIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (option.eligibility.selectable) void addOptions([option]); else setError(option.eligibility.message); }}><span className={localStyles.resultIdentity}><strong>{option.sku} — {option.variantName}</strong><span>{option.productCode} · {option.productName}</span></span><span className={localStyles.resultMeta}>{option.unitCode || 'Chưa có đơn vị'} · {option.conversionToBase || '—'}</span><span className={option.eligibility.selectable ? localStyles.eligible : localStyles.needsSetup}>{option.eligibility.message}</span></div>)}
                  {quickHasMore ? <button type="button" className={localStyles.loadMore} onClick={async () => { const result = await fetchSkuPage(quickTerm, quickResults.length); setQuickResults((current) => [...new Map([...current, ...result].map((option) => [option.id, option])).values()]); setQuickHasMore(result.length === SEARCH_PAGE_SIZE); }}>Tải thêm</button> : null}
                </div>
              </div> : null}

              {entryMode === 'browse' ? <div className={localStyles.modePanel}>
                <div className={localStyles.browseFilters}>
                  <label>Tìm trong danh mục<input value={browseTerm} onChange={(event) => setBrowseTerm(event.target.value)} placeholder="Có thể để trống để tải theo trang" /></label>
                  <button type="button" className={styles.secondaryButton} onClick={() => void searchBrowse(false)} disabled={browseLoading}>{browseLoading ? 'Đang tải…' : 'Tải danh mục'}</button>
                  <button type="button" className={styles.primaryButton} onClick={() => void addOptions(filteredBrowseResults.filter((option) => selectedBrowseIds.has(option.id)))} disabled={selectedBrowseIds.size === 0}>Thêm {selectedBrowseIds.size} SKU</button>
                </div>
                <div className={localStyles.productSkuList}>
                  {filteredBrowseResults.map((option) => <label key={option.id} className={localStyles.browseSku}><input type="checkbox" checked={selectedBrowseIds.has(option.id)} disabled={!option.eligibility.selectable || !option.unitId} onChange={(event) => setSelectedBrowseIds((current) => { const next = new Set(current); if (event.target.checked) next.add(option.id); else next.delete(option.id); return next; })} /><span className={localStyles.resultIdentity}><strong>{option.sku} — {option.variantName}</strong><span>{option.productCode} · {option.productName}</span></span><span className={option.eligibility.selectable ? localStyles.eligible : localStyles.needsSetup}>{option.unitCode || 'Chưa có đơn vị'} · {option.eligibility.message}</span></label>)}
                </div>
                {browseHasMore ? <button type="button" className={localStyles.loadMore} onClick={() => void searchBrowse(true)}>Tải thêm</button> : null}
              </div> : null}

              {entryMode === 'bulk' ? <div className={localStyles.modePanel}>
                <div className={localStyles.bulkIntro}><div><strong>Nhập nhiều dòng theo 3 bước</strong><span>Chọn tệp hoặc dán dữ liệu → Kiểm tra SKU → Thêm dòng và tự xác định giá mua</span></div><button type="button" className={styles.secondaryButton} onClick={() => void downloadTemplate()}>Tải mẫu XLSX</button></div>
                <div className={localStyles.bulkTabs}><button type="button" className={bulkSourceMode === 'file' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => setBulkSourceMode('file')}>Chọn tệp</button><button type="button" className={bulkSourceMode === 'paste' ? localStyles.modeTabActive : localStyles.modeTab} onClick={() => setBulkSourceMode('paste')}>Dán từ Excel</button></div>
                {bulkSourceMode === 'file' ? <label className={localStyles.fileDrop}>Chọn tệp XLSX, CSV, TSV hoặc TXT<input type="file" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain" onChange={(event) => void handleBulkFile(event.target.files?.[0] ?? null)} /><span>Tối đa 2 MB. Giá để trống sẽ dùng bảng giá mua.</span></label> : <label>Dán bảng từ Excel<textarea value={bulkText} onChange={(event) => { setBulkText(event.target.value); setBulkPreview([]); }} rows={7} placeholder={'SKU\tSố lượng\tĐơn giá\tKiểu chiết khấu\tGiá trị chiết khấu\tThuế %\tGhi chú'} /></label>}
                {canOverridePrice ? <label className={priceStyles.bulkReason}>Lý do nhập giá thủ công cho các dòng có đơn giá<input value={bulkOverrideReason} maxLength={1000} onChange={(event) => setBulkOverrideReason(event.target.value)} placeholder="Ví dụ: Giá thương lượng riêng theo báo giá…" /></label> : null}
                <div className={localStyles.bulkActions}><button type="button" className={styles.secondaryButton} onClick={() => void checkBulkRows()} disabled={bulkResolving || !bulkText.trim()}>{bulkResolving ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu'}</button><button type="button" className={styles.primaryButton} onClick={() => void addBulkRows()} disabled={validBulkCount === 0}>Thêm {validBulkCount || ''} dòng hợp lệ</button></div>
                {bulkPreview.length ? <div className={localStyles.previewWrap}><table className={localStyles.previewTable}><thead><tr><th>Dòng</th><th>SKU</th><th>Số lượng</th>{canReadPrice ? <><th>Đơn giá</th><th>Chiết khấu</th><th>Thuế</th></> : null}<th>Kết quả</th></tr></thead><tbody>{bulkPreview.map((row) => { const messages = [...row.errors, ...(row.resolutionError ? [row.resolutionError] : [])]; return <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.sku || '—'}</td><td>{row.quantity || '—'}</td>{canReadPrice ? <><td>{row.unitPrice || 'Tự áp giá'}</td><td>{discountModeLabel(row.discountMode)} · {row.discountValue}</td><td>{row.taxRate}%</td></> : null}<td className={messages.length ? localStyles.previewError : localStyles.previewSuccess}>{messages.length ? messages.join(' ') : `Hợp lệ: ${row.option?.sku ?? ''}`}</td></tr>; })}</tbody></table></div> : null}
              </div> : null}
            </section>

            <section className={localStyles.section} aria-labelledby="po-lines-title">
              <div className={localStyles.sectionTitle}><h4 id="po-lines-title">Dòng mua hàng</h4><span>{lines.length} SKU trong bản nháp</span></div>
              <div className={localStyles.lineList}>{lines.length === 0 ? <p className={localStyles.empty}>Chưa có SKU trong đơn mua hàng.</p> : lines.map((line, index) => <article key={line.key} className={localStyles.lineCard}>
                <div className={localStyles.lineHeading}><div><strong>{line.sku}</strong><span>{line.name}</span></div><button type="button" className={styles.secondaryButton} onClick={() => { markChanged(); setLines((current) => current.filter((item) => item.key !== line.key)); }}>Xóa dòng</button></div>
                <div className={localStyles.lineFields}>
                  <label>Số lượng<input value={line.quantity} inputMode="decimal" onChange={(event) => updateDecimalLine(line.key, 'quantity', event.target.value)} onBlur={() => handleQuantityBlur(line)} /></label>
                  <label>Đơn vị<input value={line.unitCode} readOnly /></label>
                  <label>Quy đổi<input value={line.conversionToBase} readOnly /></label>
                  {canReadPrice ? <div className={priceStyles.priceRow}>
                    <label>Đơn giá mua<input value={line.unitPrice} inputMode="decimal" readOnly={!line.manualOverride} onChange={(event) => updateDecimalLine(line.key, 'unitPrice', event.target.value)} onBlur={() => formatLineDecimal(line.key, 'unitPrice', '')} /></label>
                    <div className={priceStyles.priceStatus}><span className={sourceClass(line)}>{line.resolvingPrice ? 'Đang kiểm tra…' : sourceLabel(line)}</span><strong>{line.priceStatus === 'RESOLVED' || line.manualOverride ? formatPurchaseOrderAmount(line.unitPrice, purchaseOrder?.currency || 'VND') : 'Chưa có giá'}</strong></div>
                    <div className={priceStyles.priceActions}>{canOverridePrice && !line.manualOverride ? <button type="button" className={styles.secondaryButton} onClick={() => enableManualOverride(line)}>Nhập thủ công</button> : null}{line.manualOverride ? <button type="button" className={styles.secondaryButton} onClick={() => void useSupplierPrice(line)}>Dùng giá nhà cung cấp</button> : <button type="button" className={styles.secondaryButton} onClick={() => void refreshLinePrice(line.key)}>Áp lại giá</button>}</div>
                    <p className={priceStyles.priceHelp}>{line.manualOverride ? 'Giá này chỉ áp dụng cho đơn mua hàng hiện tại và không sửa bảng giá mua.' : 'Giá được xác định theo nhà cung cấp, SKU, đơn vị, số lượng và ngày đặt.'}</p>
                  </div> : <div className={priceStyles.quantityOnly}><span>Giá mua được xử lý theo quyền của bộ phận mua hàng và không được gửi về trình duyệt này.</span><strong className={line.priceStatus === 'RESOLVED' ? priceStyles.resolved : priceStyles.notFound}>{line.resolvingPrice ? 'Đang kiểm tra' : line.priceStatus === 'RESOLVED' ? 'Đã áp dụng giá mua' : 'Chưa có giá mua'}</strong></div>}
                  {canReadPrice && line.manualOverride ? <>
                    <label>Kiểu chiết khấu<select value={line.discountMode} onChange={(event) => updateLine(line.key, { discountMode: event.target.value as PurchaseOrderDiscountMode })}><option value="PERCENT">% tiền hàng</option><option value="PER_UNIT">Giảm mỗi đơn vị</option><option value="TOTAL_AMOUNT">Giảm tổng dòng</option></select></label>
                    <label>Giá trị chiết khấu<input value={line.discountValue} inputMode="decimal" onChange={(event) => updateDecimalLine(line.key, 'discountValue', event.target.value)} onBlur={() => formatLineDecimal(line.key, 'discountValue', '0')} /></label>
                    <label>Thuế suất %<input value={line.taxRate} inputMode="decimal" onChange={(event) => updateDecimalLine(line.key, 'taxRate', event.target.value)} onBlur={() => formatLineDecimal(line.key, 'taxRate', '0')} /></label>
                    <label className={priceStyles.overrideReason}>Lý do nhập giá thủ công<input value={line.priceOverrideReason} maxLength={1000} onChange={(event) => updateLine(line.key, { priceOverrideReason: event.target.value })} placeholder="Bắt buộc: nêu báo giá hoặc thỏa thuận áp dụng cho đơn này" /></label>
                  </> : null}
                  {canReadPrice ? <div className={localStyles.amountField}><span>Thành tiền dự kiến</span><strong>{formatPurchaseOrderAmount(totals.lineTotals[index], purchaseOrder?.currency || 'VND')}</strong></div> : null}
                  <label className={localStyles.lineNote}>Ghi chú dòng<input value={line.note} maxLength={2000} onChange={(event) => updateLine(line.key, { note: event.target.value })} /></label>
                </div>
              </article>)}</div>
            </section>

            {canReadPrice ? <section className={localStyles.totals} aria-label="Tổng tiền đơn mua hàng"><div><span>Tiền hàng</span><strong>{formatPurchaseOrderAmount(totals.subtotal, purchaseOrder?.currency || 'VND')}</strong></div><div><span>Chiết khấu</span><strong>{formatPurchaseOrderAmount(totals.discountTotal, purchaseOrder?.currency || 'VND')}</strong></div><div><span>Thuế</span><strong>{formatPurchaseOrderAmount(totals.taxTotal, purchaseOrder?.currency || 'VND')}</strong></div><div><span>Tổng cộng</span><strong>{formatPurchaseOrderAmount(totals.total, purchaseOrder?.currency || 'VND')}</strong></div></section> : null}
          </div>

          <footer className={localStyles.dialogFooter}><button type="button" className={styles.secondaryButton} onClick={requestClose} disabled={busy}>Hủy thao tác</button><button type="submit" data-testid="purchase-order-save" className={styles.primaryButton} disabled={busy}>{busy ? 'Đang lưu…' : mode === 'create' ? 'Lưu đơn nháp' : 'Lưu thay đổi'}</button></footer>
        </form>
      </section>
    </div>
  );
}
