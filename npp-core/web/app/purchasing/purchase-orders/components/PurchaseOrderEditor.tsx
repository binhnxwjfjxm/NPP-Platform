'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Supplier } from '../../../../lib/supplier-types';
import type { Product, ProductVariant } from '../../../../lib/product-types';
import type { Warehouse } from '../../../../lib/organization-types';
import type {
  PurchaseOrder,
  PurchaseOrderDraft,
  PurchaseOrderDraftLine,
} from '../../../../lib/purchase-order-types';
import {
  calculatePurchaseOrderDraftTotals,
  decimalToScaled,
  formatPurchaseOrderAmount,
} from '../../../../lib/purchase-order-types';
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

type PurchasableVariant = ProductVariant & {
  unit_id: string;
  unit_code: string;
  conversion_to_base: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function initialLines(purchaseOrder: PurchaseOrder | null): EditorLine[] {
  return (purchaseOrder?.lines ?? []).map((line) => ({
    key: line.id || crypto.randomUUID(),
    variantId: line.variantId,
    sku: line.skuCode,
    name: line.itemName,
    unitCode: line.unitCode,
    conversionToBase: line.conversionToBase,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxAmount: line.taxAmount,
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
    const unitPrice = decimalToScaled(line.unitPrice || '0');
    const discount = decimalToScaled(line.discountAmount || '0');
    const tax = decimalToScaled(line.taxAmount || '0');
    if (unitPrice === null) return `Đơn giá dòng ${index + 1} không hợp lệ.`;
    if (discount === null) return `Chiết khấu dòng ${index + 1} không hợp lệ.`;
    if (tax === null) return `Thuế dòng ${index + 1} không hợp lệ.`;
  }
  return null;
}

export default function PurchaseOrderEditor({
  mode,
  purchaseOrder,
  suppliers,
  warehouses,
  products,
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
  const [selectedProductId, setSelectedProductId] = useState('');
  const [availableVariants, setAvailableVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => `po-${crypto.randomUUID()}`);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [suppliers],
  );
  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses],
  );
  const activeProducts = useMemo(
    () => products.filter((product) => product.is_active && product.is_orderable).sort((a, b) => a.code.localeCompare(b.code)),
    [products],
  );
  const purchasableVariants = useMemo(
    () => availableVariants.filter((variant): variant is PurchasableVariant => (
      variant.is_active
      && variant.is_purchasable
      && typeof variant.unit_id === 'string'
      && typeof variant.unit_code === 'string'
      && typeof variant.conversion_to_base === 'string'
    )),
    [availableVariants],
  );
  const totals = useMemo(() => calculatePurchaseOrderDraftTotals(lines), [lines]);

  function changed() {
    setAttemptKey(`po-${crypto.randomUUID()}`);
    setError(null);
  }

  function updateLine(key: string, field: keyof PurchaseOrderDraftLine, value: string) {
    changed();
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }

  async function selectProduct(productId: string) {
    changed();
    setSelectedProductId(productId);
    setSelectedVariantId('');
    setAvailableVariants([]);
    if (!productId) return;
    setLoadingVariants(true);
    try {
      const variants = await requestJson<ProductVariant[]>(`/api/products/${productId}/variants`);
      setAvailableVariants(variants);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh sách SKU');
    } finally {
      setLoadingVariants(false);
    }
  }

  function addVariant() {
    const variant = purchasableVariants.find((item) => item.id === selectedVariantId);
    if (!variant) {
      setError('Vui lòng chọn một SKU mua hàng hợp lệ.');
      return;
    }
    if (lines.some((line) => line.variantId === variant.id)) {
      setError('SKU này đã có trong đơn đặt hàng.');
      return;
    }
    changed();
    const nextLine: EditorLine = {
      key: crypto.randomUUID(),
      variantId: variant.id,
      sku: variant.sku,
      name: variant.name,
      unitCode: variant.unit_code,
      conversionToBase: variant.conversion_to_base,
      quantity: '1',
      unitPrice: '0',
      discountAmount: '0',
      taxAmount: '0',
      note: '',
    };
    setLines((current) => [...current, nextLine]);
    setSelectedVariantId('');
  }

  function removeLine(key: string) {
    changed();
    setLines((current) => current.filter((line) => line.key !== key));
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
      lines: lines.map(({ variantId, quantity, unitPrice, discountAmount, taxAmount, note: lineNote }) => ({
        variantId,
        quantity,
        unitPrice: unitPrice || '0',
        discountAmount: discountAmount || '0',
        taxAmount: taxAmount || '0',
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
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
      }}
    >
      <section
        className={`${styles.modal} ${localStyles.wideModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-order-editor-title"
      >
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.panelKicker}>{mode === 'create' ? 'Tạo mới' : 'Chỉnh sửa bản nháp'}</p>
            <h3 id="purchase-order-editor-title">
              {mode === 'create' ? 'Đơn đặt hàng mới' : purchaseOrder?.number || 'Đơn chưa cấp số'}
            </h3>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            disabled={busy}
          >
            Đóng
          </button>
        </div>

        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}

        <form className={styles.form} onSubmit={save}>
          <div className={localStyles.headerGrid}>
            <label>
              Nhà cung cấp
              <select value={supplierId} onChange={(event) => { changed(); setSupplierId(event.target.value); }} required>
                <option value="">Chọn nhà cung cấp</option>
                {activeSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>
                ))}
              </select>
            </label>
            <label>
              Kho nhận
              <select value={warehouseId} onChange={(event) => { changed(); setWarehouseId(event.target.value); }} required>
                <option value="">Chọn kho nhận</option>
                {activeWarehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
                ))}
              </select>
            </label>
            <label>
              Tiền tệ
              <input value={purchaseOrder?.currency || 'VND'} readOnly />
            </label>
            <label>
              Ngày đặt hàng
              <input type="date" value={orderDate} onChange={(event) => { changed(); setOrderDate(event.target.value); }} required />
            </label>
            <label>
              Ngày dự kiến nhận
              <input type="date" value={expectedDate} min={orderDate} onChange={(event) => { changed(); setExpectedDate(event.target.value); }} />
            </label>
            <label>
              Tham chiếu nhà cung cấp
              <input value={supplierReference} maxLength={256} onChange={(event) => { changed(); setSupplierReference(event.target.value); }} />
            </label>
            <label className={localStyles.spanThree}>
              Ghi chú
              <input value={note} maxLength={4000} onChange={(event) => { changed(); setNote(event.target.value); }} />
            </label>
          </div>

          <div className={localStyles.lookupRow}>
            <label>
              Sản phẩm
              <select value={selectedProductId} onChange={(event) => void selectProduct(event.target.value)}>
                <option value="">Chọn sản phẩm</option>
                {activeProducts.map((product) => (
                  <option key={product.id} value={product.id}>{product.code} — {product.name}</option>
                ))}
              </select>
            </label>
            <label>
              SKU mua hàng
              <select
                value={selectedVariantId}
                onChange={(event) => setSelectedVariantId(event.target.value)}
                disabled={!selectedProductId || loadingVariants}
              >
                <option value="">{loadingVariants ? 'Đang tải SKU…' : 'Chọn SKU'}</option>
                {purchasableVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.sku} — {variant.name} ({variant.unit_code})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={styles.primaryButton} onClick={addVariant} disabled={!selectedVariantId}>
              Thêm dòng
            </button>
          </div>

          <div className={localStyles.linesWrap}>
            <table className={localStyles.linesTable} data-testid="purchase-order-lines">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Số lượng</th>
                  <th>Đơn vị</th>
                  <th>Quy đổi</th>
                  <th>Đơn giá</th>
                  <th>Chiết khấu</th>
                  <th>Thuế</th>
                  <th>Thành tiền</th>
                  <th>Ghi chú</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.length ? lines.map((line, index) => (
                  <tr key={line.key}>
                    <td>
                      <div className={localStyles.lineIdentity}>
                        <strong>{line.sku}</strong>
                        <span>{line.name}</span>
                      </div>
                    </td>
                    <td><input value={line.quantity} inputMode="decimal" onChange={(event) => updateLine(line.key, 'quantity', event.target.value)} /></td>
                    <td>{line.unitCode}</td>
                    <td>{line.conversionToBase}</td>
                    <td><input value={line.unitPrice} inputMode="decimal" onChange={(event) => updateLine(line.key, 'unitPrice', event.target.value)} /></td>
                    <td><input value={line.discountAmount} inputMode="decimal" onChange={(event) => updateLine(line.key, 'discountAmount', event.target.value)} /></td>
                    <td><input value={line.taxAmount} inputMode="decimal" onChange={(event) => updateLine(line.key, 'taxAmount', event.target.value)} /></td>
                    <td>{formatPurchaseOrderAmount(totals.lineTotals[index], purchaseOrder?.currency || 'VND')}</td>
                    <td><input value={line.note} maxLength={2000} onChange={(event) => updateLine(line.key, 'note', event.target.value)} /></td>
                    <td><button type="button" className={styles.secondaryButton} onClick={() => removeLine(line.key)}>Xóa</button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={10} className={styles.emptyState}>Chưa có SKU trong đơn đặt hàng.</td></tr>
                )}
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
            <button type="submit" className={styles.primaryButton} disabled={busy} data-testid="purchase-order-save">
              {busy ? 'Đang lưu…' : mode === 'create' ? 'Lưu đơn nháp' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
