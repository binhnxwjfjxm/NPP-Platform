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
  normalizeDecimalForApi,
  parsePurchaseOrderPasteGrid,
} from '../../../../lib/purchase-order-line-entry';
import { shouldShowPurchaseOrderSkuCatalogLink } from '../../../../lib/purchase-order-products-link';
import styles from '../../../organization/organization.module.css';
import localStyles from '../purchase-orders.module.css';

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

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
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
  const [skuSearchFailed, setSkuSearchFailed] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<ReturnType<typeof parsePurchaseOrderPasteGrid>>([]);
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
      setSkuSearchFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingSkuSearch(true);
      setSkuSearchFailed(false);
      try {
        const query = new URLSearchParams({ search: term, limit: '20', offset: '0' });
        const results = await requestJson<PurchaseOrderSkuSearchOption[]>(`/api/purchase-orders/sku-search?${query.toString()}`, { signal: controller.signal });
        setSkuResults(results);
      } catch (searchError) {
        if (controller.signal.aborted) return;
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
  const showProductsCatalogLink = shouldShowPurchaseOrderSkuCatalogLink({
    loadingVariants: loadingSkuSearch,
    variantLookupFailed: skuSearchFailed,
    skuIssue: selectedSku?.eligibility.selectable === false ? selectedSku.eligibility.message : null,
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

  function formatLineDecimal(key: string, field: keyof PurchaseOrderDraftLine, fallback = '0') {
    setLines((current) => current.map((line) => (
      line.key === key ? { ...line, [field]: cleanDecimal(String(line[field] ?? ''), fallback) } : line
    )));
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
  }

  function removeLine(key: string) {
    changed();
    setLines((current) => current.filter((line) => line.key !== key));
  }

  function previewBulk() {
    const preview = parsePurchaseOrderPasteGrid(bulkText);
    setBulkPreview(preview);
    if (preview.length === 0) setError('Chưa có dữ liệu dán để xem trước.');
  }

  function addPreviewRows() {
    let added = 0;
    for (const row of bulkPreview) {
      if (row.errors.length > 0) continue;
      const match = skuResults.find((option) => (
        option.eligibility.selectable
        && (option.sku.localeCompare(row.sku, undefined, { sensitivity: 'accent' }) === 0 || option.barcode === row.sku)
      ));
      if (!match || lines.some((line) => line.variantId === match.id)) continue;
      setLines((current) => [...current, {
        key: crypto.randomUUID(),
        variantId: match.id,
        sku: match.sku,
        name: match.variantName,
        unitCode: match.unitCode ?? '',
        conversionToBase: cleanDecimal(match.conversionToBase, '1'),
        quantity: toApiDecimal(row.quantity, '1'),
        unitPrice: toApiDecimal(row.unitPrice, '0'),
        discountMode: row.discountMode,
        discountValue: toApiDecimal(row.discountValue, '0'),
        discountAmount: '0',
        taxRate: toApiDecimal(row.taxRate, '0'),
        taxAmount: '0',
        note: row.note,
      }]);
      added += 1;
    }
    if (added === 0) setError('Không có dòng hợp lệ khớp SKU đang tìm kiếm để thêm. Hãy tìm SKU trước rồi thêm từ preview.');
    else { changed(); setBulkText(''); setBulkPreview([]); }
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
            Mở <Link href="/products" className={localStyles.contextualLink} data-testid="purchase-order-products-link">Danh mục sản phẩm</Link> để bổ sung SKU mua hàng hợp lệ.
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
                placeholder="Nhập mã sản phẩm, tên, SKU hoặc barcode"
                value={skuSearch}
                onChange={(event) => { changed(); setSkuSearch(event.target.value); }}
              />
            </label>
            <button type="button" className={styles.primaryButton} onClick={() => addSku()} disabled={!selectedSku || !selectedSku.eligibility.selectable}>Thêm dòng</button>
          </div>
          <ul id="purchase-order-sku-results" role="listbox" className={localStyles.lookupResults} data-testid="purchase-order-sku-results">
            {loadingSkuSearch ? <li>Đang tìm SKU...</li> : null}
            {skuResults.map((option) => (
              <li key={option.id} role="option" aria-selected={selectedSku?.id === option.id}>
                <button type="button" className={styles.secondaryButton} onClick={() => setSelectedSku(option)} disabled={!option.eligibility.selectable}>
                  {option.productCode} / {option.sku} - {option.variantName} {option.unitCode ? `(${option.unitCode})` : ''}
                </button>
                <span>{option.eligibility.message}</span>
              </li>
            ))}
          </ul>

          <details className={localStyles.contextualHelp}>
            <summary>Nhập nhanh bằng paste-grid</summary>
            <p>Định dạng: SKU, số lượng, đơn giá, chế độ chiết khấu TOTAL_AMOUNT/PERCENT, giá trị chiết khấu, thuế suất %, ghi chú.</p>
            <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={4} />
            <div className={localStyles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={previewBulk}>Xem trước</button>
              <button type="button" className={styles.secondaryButton} onClick={addPreviewRows} disabled={bulkPreview.length === 0}>Thêm dòng hợp lệ</button>
            </div>
            {bulkPreview.length ? <ul>{bulkPreview.map((row) => <li key={row.rowNumber}>Dòng {row.rowNumber}: {row.sku || 'thiếu SKU'} - {row.errors.length ? row.errors.join(' ') : 'Hợp lệ để khớp SKU đang tìm kiếm'}</li>)}</ul> : null}
          </details>

          <div className={localStyles.linesWrap}>
            <table className={localStyles.linesTable} data-testid="purchase-order-lines">
              <thead><tr><th>SKU</th><th>Số lượng</th><th>Đơn vị</th><th>Quy đổi</th><th>Đơn giá</th><th>CK kiểu</th><th>CK giá trị</th><th>Thuế %</th><th>Thành tiền</th><th>Ghi chú</th><th /></tr></thead>
              <tbody>
                {lines.length ? lines.map((line, index) => (
                  <tr key={line.key}>
                    <td><div className={localStyles.lineIdentity}><strong>{line.sku}</strong><span>{line.name}</span></div></td>
                    <td><input value={line.quantity} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'quantity', '1')} onChange={(event) => updateLine(line.key, 'quantity', event.target.value)} /></td>
                    <td>{line.unitCode}</td>
                    <td>{line.conversionToBase}</td>
                    <td><input value={line.unitPrice} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'unitPrice', '0')} onChange={(event) => updateLine(line.key, 'unitPrice', event.target.value)} /></td>
                    <td><select value={line.discountMode ?? 'TOTAL_AMOUNT'} onChange={(event) => updateLine(line.key, 'discountMode', event.target.value as PurchaseOrderDiscountMode)}><option value="TOTAL_AMOUNT">Số tiền dòng</option><option value="PERCENT">%</option></select></td>
                    <td><input value={line.discountValue ?? '0'} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'discountValue', '0')} onChange={(event) => updateLine(line.key, 'discountValue', event.target.value)} /></td>
                    <td><input value={line.taxRate ?? '0'} inputMode="decimal" onBlur={() => formatLineDecimal(line.key, 'taxRate', '0')} onChange={(event) => updateLine(line.key, 'taxRate', event.target.value)} /></td>
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
