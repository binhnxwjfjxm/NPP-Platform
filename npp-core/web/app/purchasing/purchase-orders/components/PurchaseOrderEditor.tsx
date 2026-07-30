'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { shouldShowPurchaseOrderSkuCatalogLink } from '../../../../lib/purchase-order-products-link';
import styles from '../../../organization/organization.module.css';
import localStyles from '../purchase-orders.module.css';

const SEARCH_PAGE_SIZE = 20;
const MAX_BULK_FILE_BYTES = 2 * 1024 * 1024;

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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanDecimal(value: string | null | undefined, fallback = '0') {
  return formatDecimalForInput(value ?? fallback) || fallback;
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
    taxRate: cleanDecimal(line.taxRate ?? '0', '0'),
    taxAmount: cleanDecimal(line.taxAmount, '0'),
    note: line.note ?? '',
  }));
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
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu đơn đặt hàng');
  }
  return payload.data;
}

function toApiDecimal(value: string, fallback = '0') {
  return normalizeDecimalForApi(value) ?? fallback;
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
  return parsePurchaseOrderPasteGrid(text).map((row) => ({
    ...row,
    option: null,
    resolutionError: null,
  }));
}

export default function PurchaseOrderEditor({
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
  const [orderDate, setOrderDate] = useState(purchaseOrder?.placedAt ?? today());
  const [expectedDate, setExpectedDate] = useState(purchaseOrder?.expectedAt ?? '');
  const [supplierReference, setSupplierReference] = useState(purchaseOrder?.supplierReference ?? '');
  const [note, setNote] = useState(purchaseOrder?.note ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() => initialLines(purchaseOrder));
  const [skuSearch, setSkuSearch] = useState('');
  const [skuResults, setSkuResults] = useState<PurchaseOrderSkuSearchOption[]>([]);
  const [selectedSku, setSelectedSku] = useState<PurchaseOrderSkuSearchOption | null>(null);
  const [loadingSkuSearch, setLoadingSkuSearch] = useState(false);
  const [loadingMoreSku, setLoadingMoreSku] = useState(false);
  const [skuHasMore, setSkuHasMore] = useState(false);
  const [skuSearchFailed, setSkuSearchFailed] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => `po-${crypto.randomUUID()}`);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = skuSearch.trim();
    setSelectedSku(null);
    if (!term) {
      setSkuResults([]);
      setSkuHasMore(false);
      setSkuSearchFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingSkuSearch(true);
      setSkuSearchFailed(false);
      try {
        const query = new URLSearchParams({ search: term, limit: String(SEARCH_PAGE_SIZE), offset: '0' });
        const results = await requestJson<PurchaseOrderSkuSearchOption[]>(`/api/purchase-orders/sku-search?${query.toString()}`, { signal: controller.signal });
        setSkuResults(results);
        setSkuHasMore(results.length === SEARCH_PAGE_SIZE);
      } catch (searchError) {
        if (controller.signal.aborted) return;
        setSkuResults([]);
        setSkuHasMore(false);
        setSkuSearchFailed(true);
        setError(searchError instanceof Error ? searchError.message : 'Không tải được danh sách SKU');
      } finally {
        if (!controller.signal.aborted) setLoadingSkuSearch(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [skuSearch]);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [suppliers],
  );
  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  );
  const selectedSkuIssue = selectedSku?.eligibility.selectable === false ? selectedSku.eligibility.message : null;
  const showProductsCatalogLink = shouldShowPurchaseOrderSkuCatalogLink({
    loadingVariants: loadingSkuSearch,
    variantLookupFailed: skuSearchFailed,
    skuIssue: selectedSkuIssue,
    currentError: error,
  });
  const totals = useMemo(() => calculatePurchaseOrderDraftTotals(lines), [lines]);

  function changed() {
    setAttemptKey(`po-${crypto.randomUUID()}`);
    setError(null);
  }

  function updateLine(key: string, field: keyof PurchaseOrderDraftLine, value: string) {
    changed();
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }

  function updateDecimalLine(key: string, field: 'quantity' | 'unitPrice' | 'discountValue' | 'taxRate', value: string) {
    if (!isSafeDecimalIntermediate(value)) return;
    updateLine(key, field, value);
  }

  function formatLineDecimal(key: string, field: 'quantity' | 'unitPrice' | 'discountValue' | 'taxRate', fallback = '0') {
    setLines((current) => current.map((line) => (
      line.key === key ? { ...line, [field]: cleanDecimal(String(line[field] ?? ''), fallback) } : line
    )));
  }

  function selectSku(option: PurchaseOrderSkuSearchOption) {
    setSelectedSku(option);
    setError(option.eligibility.selectable ? null : option.eligibility.message);
  }

  function addSku(option = selectedSku) {
    if (!option) {
      setError('Vui lòng tìm và chọn một SKU mua hàng.');
      return;
    }
    if (!option.eligibility.selectable) {
      setError(option.eligibility.message);
      return;
    }
    if (lines.some((line) => line.variantId === option.id)) {
      setError('SKU này đã có trong đơn đặt hàng.');
      return;
    }
    changed();
    setLines((current) => [...current, {
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
    }]);
    setSelectedSku(null);
    setSkuSearch('');
    setSkuResults([]);
    setSkuHasMore(false);
  }

  async function loadMoreSkuResults() {
    const term = skuSearch.trim();
    if (!term || loadingMoreSku || !skuHasMore) return;
    setLoadingMoreSku(true);
    setSkuSearchFailed(false);
    try {
      const query = new URLSearchParams({
        search: term,
        limit: String(SEARCH_PAGE_SIZE),
        offset: String(skuResults.length),
      });
      const results = await requestJson<PurchaseOrderSkuSearchOption[]>(`/api/purchase-orders/sku-search?${query.toString()}`);
      setSkuResults((current) => {
        const merged = new Map(current.map((option) => [option.id, option]));
        for (const option of results) merged.set(option.id, option);
        return [...merged.values()];
      });
      setSkuHasMore(results.length === SEARCH_PAGE_SIZE);
    } catch (searchError) {
      setSkuSearchFailed(true);
      setError(searchError instanceof Error ? searchError.message : 'Không tải thêm được danh sách SKU');
    } finally {
      setLoadingMoreSku(false);
    }
  }

  function removeLine(key: string) {
    changed();
    setLines((current) => current.filter((line) => line.key !== key));
  }

  function previewBulk() {
    const preview = initialBulkPreview(bulkText);
    setBulkPreview(preview);
    if (preview.length === 0) setError('Chưa có dữ liệu dán để xem trước.');
    else setError(null);
  }

  async function handleBulkFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_BULK_FILE_BYTES) {
      setError('Tệp nhập nhanh không được vượt quá 2 MB.');
      return;
    }
    try {
      const text = await file.text();
      setBulkText(text);
      setBulkPreview(initialBulkPreview(text));
      setError(null);
    } catch {
      setError('Không đọc được tệp nhập nhanh.');
    }
  }

  async function resolveBulkRows() {
    const parsed = initialBulkPreview(bulkText);
    setBulkPreview(parsed);
    if (parsed.length === 0) {
      setError('Chưa có dữ liệu để kiểm tra.');
      return;
    }
    const candidates = parsed.filter((row) => row.errors.length === 0);
    if (candidates.length === 0) {
      setError('Tệp chưa có dòng nào đạt định dạng cơ bản.');
      return;
    }

    setBulkResolving(true);
    setError(null);
    try {
      const resolutions = await requestJson<PurchaseOrderSkuResolution[]>('/api/purchase-orders/sku-resolve', {
        method: 'POST',
        body: JSON.stringify({ identifiers: candidates.map((row) => row.sku) }),
      });
      let resolutionIndex = 0;
      const existingVariantIds = new Set(lines.map((line) => line.variantId));
      const batchVariantIds = new Set<string>();
      const next = parsed.map((row): BulkPreviewRow => {
        if (row.errors.length > 0) return row;
        const resolution = resolutions[resolutionIndex];
        resolutionIndex += 1;
        if (!resolution || resolution.error || !resolution.option) {
          return {
            ...row,
            option: null,
            resolutionError: resolution?.error?.message || 'Không phân giải được SKU hoặc mã vạch.',
          };
        }
        if (!resolution.option.eligibility.selectable) {
          return {
            ...row,
            option: resolution.option,
            resolutionError: resolution.option.eligibility.message,
          };
        }
        if (existingVariantIds.has(resolution.option.id)) {
          return {
            ...row,
            option: resolution.option,
            resolutionError: 'SKU đã có trong đơn đặt hàng hiện tại.',
          };
        }
        if (batchVariantIds.has(resolution.option.id)) {
          return {
            ...row,
            option: resolution.option,
            resolutionError: 'SKU bị lặp trong dữ liệu nhập nhanh.',
          };
        }
        batchVariantIds.add(resolution.option.id);
        return { ...row, option: resolution.option, resolutionError: null };
      });
      setBulkPreview(next);
      const validCount = next.filter((row) => row.errors.length === 0 && row.option && !row.resolutionError).length;
      setError(validCount > 0 ? null : 'Không có dòng hợp lệ để thêm vào đơn đặt hàng.');
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Không kiểm tra được dữ liệu SKU');
    } finally {
      setBulkResolving(false);
    }
  }

  function addPreviewRows() {
    const additions: EditorLine[] = bulkPreview
      .filter((row) => row.errors.length === 0 && row.option?.eligibility.selectable && !row.resolutionError)
      .map((row) => {
        const option = row.option as PurchaseOrderSkuSearchOption;
        return {
          key: crypto.randomUUID(),
          variantId: option.id,
          sku: option.sku,
          name: option.variantName,
          unitCode: option.unitCode ?? '',
          conversionToBase: cleanDecimal(option.conversionToBase, '1'),
          quantity: toApiDecimal(row.quantity, '1'),
          unitPrice: toApiDecimal(row.unitPrice, '0'),
          discountMode: row.discountMode,
          discountValue: toApiDecimal(row.discountValue, '0'),
          discountAmount: '0',
          taxRate: toApiDecimal(row.taxRate, '0'),
          taxAmount: '0',
          note: row.note,
        };
      });
    if (additions.length === 0) {
      setError('Không có dòng đã kiểm tra hợp lệ để thêm.');
      return;
    }
    changed();
    setLines((current) => [...current, ...additions]);
    setBulkText('');
    setBulkPreview([]);
    setError(null);
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
      lines: lines.map(({ variantId, quantity, unitPrice, discountMode, discountValue, taxRate, note: lineNote }) => ({
        variantId,
        quantity: toApiDecimal(quantity, quantity),
        unitPrice: toApiDecimal(unitPrice, '0'),
        discountMode: discountMode ?? 'TOTAL_AMOUNT',
        discountValue: toApiDecimal(discountValue ?? '0', '0'),
        taxRate: toApiDecimal(taxRate ?? '0', '0'),
        note: lineNote,
      })),
      ...(mode === 'edit' && purchaseOrder ? { expectedRevision: purchaseOrder.revision } : {}),
    };
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

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
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được đơn đặt hàng');
    } finally {
      setBusy(false);
    }
  }

  const validBulkCount = bulkPreview.filter((row) => row.errors.length === 0 && row.option && !row.resolutionError).length;

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}>
      <section className={`${styles.modal} ${localStyles.wideModal}`} role="dialog" aria-modal="true" aria-labelledby="purchase-order-editor-title">
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.panelKicker}>{mode === 'create' ? 'Tạo mới' : 'Chỉnh sửa bản nháp'}</p>
            <h3 id="purchase-order-editor-title">{mode === 'create' ? 'Đơn đặt hàng mới' : purchaseOrder?.number || 'Đơn chưa cấp số'}</h3>
          </div>
          <button ref={closeButtonRef} type="button" className={styles.modalClose} onClick={onClose} disabled={busy}>Đóng</button>
        </div>

        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
        {showProductsCatalogLink ? (
          <p className={localStyles.contextualHelp}>
            Mở <Link href="/products" className={localStyles.contextualLink} data-testid="purchase-order-products-link">Danh mục sản phẩm</Link> để hoàn tất đơn vị, quy đổi hoặc quyền mua của SKU.
          </p>
        ) : null}

        <form className={styles.form} onSubmit={save}>
          <div className={localStyles.headerGrid}>
            <label>Nhà cung cấp<select value={supplierId} onChange={(event) => { changed(); setSupplierId(event.target.value); }} required><option value="">Chọn nhà cung cấp</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} - {supplier.name}</option>)}</select></label>
            <label>Kho nhận<select value={warehouseId} onChange={(event) => { changed(); setWarehouseId(event.target.value); }} required><option value="">Chọn kho nhận</option>{activeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>)}</select></label>
            <label>Tiền tệ<input value={purchaseOrder?.currency || 'VND'} readOnly /></label>
            <label>Ngày đặt hàng<input type="date" value={orderDate} onChange={(event) => { changed(); setOrderDate(event.target.value); }} required /></label>
            <label>Ngày dự kiến nhận<input type="date" value={expectedDate} min={orderDate} onChange={(event) => { changed(); setExpectedDate(event.target.value); }} /></label>
            <label>Tham chiếu nhà cung cấp<input value={supplierReference} maxLength={256} onChange={(event) => { changed(); setSupplierReference(event.target.value); }} /></label>
            <label className={localStyles.spanThree}>Ghi chú<input value={note} maxLength={4000} onChange={(event) => { changed(); setNote(event.target.value); }} /></label>
          </div>

          <div className={localStyles.lookupRow}>
            <label className={localStyles.spanThree}>Tìm SKU mua hàng
              <input
                role="combobox"
                aria-expanded={skuResults.length > 0}
                aria-controls="purchase-order-sku-results"
                placeholder="Nhập mã sản phẩm, tên, SKU hoặc mã vạch"
                value={skuSearch}
                onChange={(event) => { changed(); setSkuSearch(event.target.value); }}
              />
            </label>
            <button type="button" className={styles.primaryButton} onClick={() => addSku()} disabled={!selectedSku || !selectedSku.eligibility.selectable}>Thêm dòng</button>
          </div>
          <ul id="purchase-order-sku-results" role="listbox" className={localStyles.lookupResults} data-testid="purchase-order-sku-results">
            {loadingSkuSearch ? <li>Đang tìm SKU...</li> : null}
            {!loadingSkuSearch && skuSearch.trim() && skuResults.length === 0 && !skuSearchFailed ? <li>Không tìm thấy SKU phù hợp.</li> : null}
            {skuResults.map((option) => (
              <li key={option.id} role="option" aria-selected={selectedSku?.id === option.id}>
                <button type="button" className={styles.secondaryButton} onClick={() => selectSku(option)}>
                  {option.productCode} / {option.sku} - {option.variantName} {option.unitCode ? `(${option.unitCode})` : ''}
                </button>
                <span>{option.eligibility.message}</span>
              </li>
            ))}
            {skuHasMore ? (
              <li>
                <button type="button" className={styles.secondaryButton} onClick={() => void loadMoreSkuResults()} disabled={loadingMoreSku}>
                  {loadingMoreSku ? 'Đang tải thêm...' : 'Tải thêm kết quả'}
                </button>
              </li>
            ) : null}
          </ul>

          <details className={localStyles.contextualHelp}>
            <summary>Nhập nhanh từ Excel, CSV hoặc tệp văn bản</summary>
            <p>Mỗi dòng gồm: SKU/mã vạch; số lượng; đơn giá; kiểu CK (TOTAL_AMOUNT, PER_UNIT hoặc PERCENT); giá trị CK; thuế suất %; ghi chú. Dán trực tiếp từ Excel bằng cột tab hoặc dùng dấu chấm phẩy. Số thập phân chấp nhận dấu phẩy hoặc dấu chấm.</p>
            <label>Tệp dữ liệu
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={(event) => void handleBulkFile(event.target.files?.[0] ?? null)} />
            </label>
            <textarea value={bulkText} onChange={(event) => { setBulkText(event.target.value); setBulkPreview([]); }} rows={5} placeholder={'SKU\tSố lượng\tĐơn giá\tKiểu CK\tGiá trị CK\tThuế %\tGhi chú'} />
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={previewBulk}>Xem trước định dạng</button>
              <button type="button" className={styles.secondaryButton} onClick={() => void resolveBulkRows()} disabled={bulkResolving}>{bulkResolving ? 'Đang kiểm tra...' : 'Kiểm tra SKU'}</button>
              <button type="button" className={styles.secondaryButton} onClick={addPreviewRows} disabled={validBulkCount === 0}>Thêm {validBulkCount || ''} dòng hợp lệ</button>
            </div>
            {bulkPreview.length ? (
              <ul>
                {bulkPreview.map((row) => {
                  const messages = [...row.errors, ...(row.resolutionError ? [row.resolutionError] : [])];
                  return <li key={row.rowNumber}>Dòng {row.rowNumber}: {row.sku || 'thiếu SKU'} — {messages.length ? messages.join(' ') : row.option ? `Hợp lệ: ${row.option.sku} (${row.option.unitCode ?? 'chưa có đơn vị'})` : 'Chờ kiểm tra SKU'}</li>;
                })}
              </ul>
            ) : null}
          </details>

          <div className={localStyles.linesWrap}>
            <table className={localStyles.linesTable} data-testid="purchase-order-lines">
              <thead><tr><th>SKU</th><th>Số lượng</th><th>Đơn vị</th><th>Quy đổi</th><th>Đơn giá</th><th>Kiểu CK</th><th>Giá trị CK</th><th>Thuế %</th><th>Thành tiền</th><th>Ghi chú</th><th /></tr></thead>
              <tbody>
                {lines.length ? lines.map((line, index) => (
                  <tr key={line.key}>
                    <td><div className={localStyles.lineIdentity}><strong>{line.sku}</strong><span>{line.name}</span></div></td>
                    <td><input value={line.quantity} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'quantity', '1')} onChange={(event) => updateDecimalLine(line.key, 'quantity', event.target.value)} /></td>
                    <td>{line.unitCode}</td>
                    <td>{line.conversionToBase}</td>
                    <td><input value={line.unitPrice} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'unitPrice', '0')} onChange={(event) => updateDecimalLine(line.key, 'unitPrice', event.target.value)} /></td>
                    <td><select value={line.discountMode ?? 'TOTAL_AMOUNT'} onChange={(event) => updateLine(line.key, 'discountMode', event.target.value as PurchaseOrderDiscountMode)}><option value="PERCENT">% tiền hàng</option><option value="PER_UNIT">Giảm mỗi đơn vị</option><option value="TOTAL_AMOUNT">Tổng giảm dòng</option></select></td>
                    <td><input value={line.discountValue ?? '0'} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'discountValue', '0')} onChange={(event) => updateDecimalLine(line.key, 'discountValue', event.target.value)} /></td>
                    <td><input value={line.taxRate ?? '0'} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'taxRate', '0')} onChange={(event) => updateDecimalLine(line.key, 'taxRate', event.target.value)} /></td>
                    <td>{formatPurchaseOrderAmount(totals.lineTotals[index], purchaseOrder?.currency || 'VND')}</td>
                    <td><input value={line.note} maxLength={2000} onChange={(event) => updateLine(line.key, 'note', event.target.value)} /></td>
                    <td><button type="button" className={styles.secondaryButton} onClick={() => removeLine(line.key)}>Xóa</button></td>
                  </tr>
                )) : <tr><td colSpan={11} className={styles.emptyState}>Chưa có SKU trong đơn đặt hàng.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className={localStyles.totals}>
            <div className={localStyles.totalCard}><span>Tiền hàng</span><strong>{formatPurchaseOrderAmount(totals.subtotal, purchaseOrder?.currency || 'VND')}</strong></div>
            <div className={localStyles.totalCard}><span>Chiết khấu</span><strong>{formatPurchaseOrderAmount(totals.discountTotal, purchaseOrder?.currency || 'VND')}</strong></div>
            <div className={localStyles.totalCard}><span>Thuế</span><strong>{formatPurchaseOrderAmount(totals.taxTotal, purchaseOrder?.currency || 'VND')}</strong></div>
            <div className={localStyles.totalCard}><span>Tổng cộng</span><strong>{formatPurchaseOrderAmount(totals.total, purchaseOrder?.currency || 'VND')}</strong></div>
          </div>

          <div className={localStyles.modalActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>Hủy thao tác</button>
            <button type="submit" className={styles.primaryButton} disabled={busy} data-testid="purchase-order-save">{busy ? 'Đang lưu...' : mode === 'create' ? 'Lưu đơn nháp' : 'Lưu thay đổi'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
