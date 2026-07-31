'use client';

import { useEffect, useState } from 'react';
import type { Customer, CustomerAddress } from '../../../lib/customer-types';
import type { Product, ProductVariant } from '../../../lib/product-types';
import type { Warehouse } from '../../../lib/organization-types';
import type {
  SalesOrder,
  SalesOrderCollectionPolicy,
  SalesOrderDeliveryMode,
  SalesOrderDraftPayload,
  SalesOrderVersion,
} from '../../../lib/sales-order-types';
import { apiRequest, mutationKey } from './sales-order-ui';
import styles from './sales-orders.module.css';

export type SalesOrderFormMode = 'create' | 'draft' | 'amendment';

type LineDraft = {
  variantId: string;
  label: string;
  quantity: string;
  discountMode: 'TOTAL_AMOUNT' | 'PER_UNIT' | 'PERCENT';
  discountValue: string;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  taxRate: string;
};

type Props = {
  mode: SalesOrderFormMode;
  orderId?: string;
  version?: SalesOrderVersion | null;
  customers: Customer[];
  warehouses: Warehouse[];
  products: Product[];
  onClose: () => void;
  onSaved: (order: SalesOrder) => void;
  onError: (message: string) => void;
};

function versionLines(version?: SalesOrderVersion | null): LineDraft[] {
  return (version?.lines ?? []).map((line) => ({
    variantId: line.variantId,
    label: `${line.sku} — ${line.itemName}`,
    quantity: line.quantity,
    discountMode: line.discountMode,
    discountValue: line.discountValue,
    taxMode: line.taxMode,
    taxRate: line.taxRate,
  }));
}

export default function SalesOrderForm(props: Props) {
  const { version } = props;
  const [saveKey] = useState(() => mutationKey(`sales-${props.mode}-save`));
  const [customerId, setCustomerId] = useState(version?.customerId ?? '');
  const [addressId, setAddressId] = useState(version?.customerAddressId ?? '');
  const [warehouseId, setWarehouseId] = useState(version?.warehouseId ?? '');
  const [deliveryMode, setDeliveryMode] = useState<SalesOrderDeliveryMode>(version?.deliveryMode ?? 'DELIVERY');
  const [collectionPolicy, setCollectionPolicy] = useState<SalesOrderCollectionPolicy>(version?.collectionPolicy ?? 'COLLECT_ON_DELIVERY');
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(version?.requestedDeliveryDate ?? '');
  const [note, setNote] = useState(version?.note ?? '');
  const [lines, setLines] = useState<LineDraft[]>(versionLines(version));
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [discountMode, setDiscountMode] = useState<LineDraft['discountMode']>('TOTAL_AMOUNT');
  const [discountValue, setDiscountValue] = useState('0');
  const [taxMode, setTaxMode] = useState<LineDraft['taxMode']>('EXCLUSIVE');
  const [taxRate, setTaxRate] = useState('0');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setAddresses([]);
      return;
    }
    apiRequest<CustomerAddress[]>(`/api/customers/${customerId}/addresses`)
      .then((rows) => {
        const active = rows.filter((item) => item.is_active);
        setAddresses(active);
        setAddressId((current) => current && active.some((item) => item.id === current)
          ? current
          : active.find((item) => item.is_default)?.id ?? active[0]?.id ?? '');
      })
      .catch((error) => props.onError(error instanceof Error ? error.message : 'Không tải được địa chỉ khách hàng'));
  }, [customerId]);

  async function loadVariants(nextProductId: string) {
    setProductId(nextProductId);
    setVariantId('');
    setVariants([]);
    if (!nextProductId) return;
    try {
      const rows = await apiRequest<ProductVariant[]>(`/api/products/${nextProductId}/variants`);
      setVariants(rows.filter((item) => item.is_active && item.is_sellable && Boolean(item.unit_id)));
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Không tải được SKU bán hàng');
    }
  }

  function addLine() {
    const variant = variants.find((item) => item.id === variantId);
    if (!variant) return props.onError('Hãy chọn SKU hợp lệ');
    if (!quantity || Number(quantity) <= 0) return props.onError('Số lượng phải lớn hơn 0');
    if (lines.some((line) => line.variantId === variant.id)) return props.onError('SKU này đã có trong đơn');
    setLines((current) => [...current, {
      variantId: variant.id,
      label: `${variant.sku} — ${variant.name} (${variant.unit_code ?? 'chưa có đơn vị'})`,
      quantity,
      discountMode,
      discountValue: discountValue || '0',
      taxMode,
      taxRate: taxRate || '0',
    }]);
    setProductId('');
    setVariants([]);
    setVariantId('');
    setQuantity('1');
    setDiscountMode('TOTAL_AMOUNT');
    setDiscountValue('0');
    setTaxMode('EXCLUSIVE');
    setTaxRate('0');
  }

  function validate(): string | null {
    if (!customerId) return 'Hãy chọn khách hàng';
    if (!warehouseId) return 'Hãy chọn kho xuất';
    if (deliveryMode === 'DELIVERY' && !addressId) return 'Hãy chọn địa chỉ giao hàng';
    if (lines.length === 0) return 'Đơn bán hàng phải có ít nhất một SKU';
    if (lines.some((line) => Number(line.quantity) <= 0)) return 'Số lượng hàng hóa chưa hợp lệ';
    return null;
  }

  function payload(): SalesOrderDraftPayload {
    return {
      sourceType: 'MANUAL',
      customerId,
      ...(deliveryMode === 'DELIVERY' ? { customerAddressId: addressId } : {}),
      warehouseId,
      deliveryMode,
      collectionPolicy,
      currency: 'VND',
      ...(requestedDeliveryDate ? { requestedDeliveryDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(props.mode === 'create' ? {} : { expectedRevision: version?.revision }),
      lines: lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        discountMode: line.discountMode,
        discountValue: line.discountValue || '0',
        taxMode: line.taxMode,
        taxRate: line.taxRate || '0',
      })),
    };
  }

  async function save() {
    const issue = validate();
    if (issue) return props.onError(issue);
    setBusy(true);
    try {
      let path = '/api/sales-orders';
      let method = 'POST';
      if (props.mode === 'draft') {
        path = `/api/sales-orders/${props.orderId}/draft`;
        method = 'PUT';
      }
      if (props.mode === 'amendment') {
        path = `/api/sales-orders/${props.orderId}/amendments/${version?.versionNumber}/draft`;
        method = 'PUT';
      }
      const order = await apiRequest<SalesOrder>(path, {
        method,
        headers: { 'Idempotency-Key': saveKey },
        body: JSON.stringify(payload()),
      });
      props.onSaved(order);
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Không lưu được đơn bán hàng');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Biểu mẫu đơn bán hàng">
        <header className={styles.modalHeader}>
          <div><p className={styles.eyebrow}>Bán hàng</p><h2>{props.mode === 'create' ? 'Tạo đơn bán hàng nháp' : props.mode === 'amendment' ? `Sửa bản điều chỉnh ${version?.versionNumber}` : 'Sửa đơn bán hàng nháp'}</h2></div>
          <button type="button" className={styles.closeButton} onClick={props.onClose} aria-label="Đóng">×</button>
        </header>

        <div className={styles.formGrid}>
          <label><span>Khách hàng *</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Chọn khách hàng</option>{props.customers.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label><span>Kho xuất *</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho</option>{props.warehouses.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label><span>Hình thức nhận hàng</span><select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as SalesOrderDeliveryMode)}><option value="DELIVERY">Giao đến khách</option><option value="PICKUP">Khách nhận tại kho</option></select></label>
          <label><span>Chính sách thu tiền</span><select value={collectionPolicy} onChange={(event) => setCollectionPolicy(event.target.value as SalesOrderCollectionPolicy)}><option value="COLLECT_ON_DELIVERY">Thu khi giao</option><option value="COLLECT_AFTER_DELIVERY">Giao trước, chuyển khoản sau</option><option value="PREPAID">Đã trả trước</option><option value="CREDIT_TERMS">Bán chịu theo hạn mức</option></select></label>
          {deliveryMode === 'DELIVERY' && <label className={styles.spanTwo}><span>Địa chỉ giao hàng *</span><select value={addressId} onChange={(event) => setAddressId(event.target.value)}><option value="">Chọn địa chỉ</option>{addresses.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.address_line1}, {item.ward ?? ''}, {item.province ?? ''}</option>)}</select></label>}
          <label><span>Ngày khách cần hàng</span><input type="date" value={requestedDeliveryDate} onChange={(event) => setRequestedDeliveryDate(event.target.value)} /></label>
          <label className={styles.spanTwo}><span>Ghi chú</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>

        <section className={styles.lineEditor}>
          <h3>Hàng hóa</h3>
          <div className={styles.lineEntryGrid}>
            <label><span>Sản phẩm</span><select value={productId} onChange={(event) => loadVariants(event.target.value)}><option value="">Chọn sản phẩm</option>{props.products.filter((item) => item.is_active && item.is_orderable).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
            <label><span>SKU</span><select value={variantId} onChange={(event) => setVariantId(event.target.value)}><option value="">Chọn SKU</option>{variants.map((item) => <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>)}</select></label>
            <label><span>Số lượng</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <label><span>Kiểu CK</span><select value={discountMode} onChange={(event) => setDiscountMode(event.target.value as LineDraft['discountMode'])}><option value="TOTAL_AMOUNT">Tổng tiền</option><option value="PER_UNIT">Theo đơn vị</option><option value="PERCENT">Phần trăm</option></select></label>
            <label><span>Chiết khấu</span><input value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} /></label>
            <label><span>Cách tính thuế</span><select value={taxMode} onChange={(event) => setTaxMode(event.target.value as LineDraft['taxMode'])}><option value="EXCLUSIVE">Chưa gồm thuế</option><option value="INCLUSIVE">Đã gồm thuế</option></select></label>
            <label><span>Thuế %</span><input value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label>
            <button type="button" className={styles.addLineButton} onClick={addLine}>Thêm dòng</button>
          </div>
          <div className={styles.draftLines}>
            {lines.map((line, index) => <div className={styles.draftLine} key={line.variantId}><div><strong>{line.label}</strong><small>Giá do Core tự phân giải khi lưu</small></div><label><span>SL</span><input value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label><label><span>CK</span><input value={line.discountValue} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountValue: event.target.value } : item))} /></label><label><span>Thuế %</span><input value={line.taxRate} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, taxRate: event.target.value } : item))} /></label><button type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Xóa</button></div>)}
            {lines.length === 0 && <p className={styles.empty}>Chưa có hàng hóa trong đơn.</p>}
          </div>
        </section>

        <footer className={styles.modalFooter}><button type="button" onClick={props.onClose}>Đóng</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu bản nháp'}</button></footer>
      </section>
    </div>
  );
}
