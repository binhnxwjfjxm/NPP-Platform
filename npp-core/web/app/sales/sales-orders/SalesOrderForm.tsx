'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, CustomerAddress } from '../../../lib/customer-types';
import type { Product } from '../../../lib/product-types';
import type { Warehouse } from '../../../lib/organization-types';
import type {
  SalesOrder,
  SalesOrderCollectionPolicy,
  SalesOrderCustomerMode,
  SalesOrderDraftPayload,
  SalesOrderSkuSearchOption,
  SalesOrderTaxMode,
  SalesOrderVersion,
  SalesPriceResolution,
  SalesPriceStep,
} from '../../../lib/sales-order-types';
import { apiRequest, mutationKey } from './sales-order-ui';
import styles from './sales-orders.module.css';

export type SalesOrderFormMode = 'create' | 'draft' | 'amendment';

const WALK_IN_CUSTOMER_CODE = 'SYS_WALK_IN';
const SEARCH_DELAY_MS = 260;
const SEARCH_PAGE_SIZE = 30;
const SCALE = 1_000_000n;
const HUNDRED = 100n * SCALE;

type DiscountMode = 'TOTAL_AMOUNT' | 'PER_UNIT' | 'PERCENT';

type LineDraft = {
  variantId: string;
  sku: string;
  name: string;
  unitCode: string;
  quantity: string;
  discountMode: DiscountMode;
  discountValue: string;
  baseUnitPriceMinor: string;
  finalUnitPriceMinor: string;
  priceSteps: SalesPriceStep[];
  resolvingPrice: boolean;
  priceError: string | null;
};

type QuickCustomerDraft = {
  code: string;
  name: string;
  phone: string;
  addressLine1: string;
};

type Props = {
  mode: SalesOrderFormMode;
  orderId?: string;
  version?: SalesOrderVersion | null;
  customers: Customer[];
  warehouses: Warehouse[];
  products: Product[];
  canConfirm: boolean;
  canQuickCreateCustomer: boolean;
  onClose: () => void;
  onSaved: (order: SalesOrder) => void;
  onError: (message: string) => void;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

function parseScaled(value: string, allowZero = true): bigint | null {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  return !allowZero && scaled === 0n ? null : scaled;
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function vnd(value: string | bigint): string {
  try {
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(value))} ₫`;
  } catch {
    return '—';
  }
}

function localTodayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function autoCustomerCode(): string {
  return `KH${Date.now().toString(36).toUpperCase()}`.slice(0, 64);
}

function versionLines(version?: SalesOrderVersion | null): LineDraft[] {
  return (version?.lines ?? []).map((line) => ({
    variantId: line.variantId,
    sku: line.sku,
    name: line.itemName,
    unitCode: line.unitCode,
    quantity: line.quantity,
    discountMode: line.discountMode,
    discountValue: line.discountValue,
    baseUnitPriceMinor: line.unitPrice,
    finalUnitPriceMinor: line.unitPrice,
    priceSteps: [],
    resolvingPrice: false,
    priceError: null,
  }));
}

function lineAmounts(line: LineDraft, taxMode: SalesOrderTaxMode, taxRateText: string) {
  const quantity = parseScaled(line.quantity, false) ?? 0n;
  const price = /^\d+$/.test(line.finalUnitPriceMinor) ? BigInt(line.finalUnitPriceMinor) : 0n;
  const gross = halfUp(quantity * price, SCALE);
  const discountInput = parseScaled(line.discountValue || '0', true) ?? 0n;
  let discount = 0n;
  if (line.discountMode === 'PERCENT') discount = halfUp(gross * discountInput, HUNDRED);
  else if (line.discountMode === 'PER_UNIT') discount = halfUp(quantity * (discountInput / SCALE), SCALE);
  else discount = discountInput / SCALE;
  if (discount > gross) discount = gross;
  const discounted = gross - discount;
  const taxRate = parseScaled(taxRateText || '0', true) ?? 0n;
  const tax = taxMode === 'INCLUSIVE'
    ? (taxRate === 0n ? 0n : halfUp(discounted * taxRate, HUNDRED + taxRate))
    : halfUp(discounted * taxRate, HUNDRED);
  const subtotal = taxMode === 'INCLUSIVE' ? gross - tax : gross;
  const total = taxMode === 'INCLUSIVE' ? discounted : discounted + tax;
  return { gross, discount, tax, subtotal, total };
}

function pricingLabel(step: SalesPriceStep): string {
  if (step.kind === 'BASE') return `Giá nền · ${step.priceListCode ?? 'BASE'}`;
  if (step.kind === 'MANUAL_OVERRIDE') return 'Giá ghi đè thủ công';
  if (step.kind === 'SKIPPED') return `Không áp dụng · ${step.priceListCode ?? 'quy tắc thấp hơn'}`;
  const adjustment = {
    FIXED_PRICE: 'Giá cố định',
    PERCENT_DISCOUNT: 'Giảm %',
    AMOUNT_DISCOUNT: 'Giảm tiền',
    PERCENT_MARKUP: 'Tăng %',
    AMOUNT_MARKUP: 'Tăng tiền',
  }[step.adjustmentType ?? ''] ?? step.adjustmentType ?? 'Điều chỉnh';
  return `${step.priceListCode ?? step.priceListType ?? 'Chương trình'} · ${adjustment}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Yêu cầu không thành công');
  }
  return payload.data;
}

export default function SalesOrderForm(props: Props) {
  const { version, products: _products } = props;
  const initialWalkIn = version?.customerCode === WALK_IN_CUSTOMER_CODE;
  const initialTaxMode = version?.lines?.[0]?.taxMode ?? 'EXCLUSIVE';
  const initialTaxRate = version?.lines?.[0]?.taxRate ?? '0';
  const [saveKey] = useState(() => mutationKey(`sales-${props.mode}-save`));
  const [confirmKey] = useState(() => mutationKey(`sales-${props.mode}-confirm`));
  const [customerMode, setCustomerMode] = useState<SalesOrderCustomerMode>(initialWalkIn ? 'WALK_IN' : 'EXISTING');
  const [customerRows, setCustomerRows] = useState(props.customers);
  const [customerId, setCustomerId] = useState(initialWalkIn ? '' : (version?.customerId ?? ''));
  const [customerSearch, setCustomerSearch] = useState('');
  const [addressId, setAddressId] = useState(version?.customerAddressId ?? '');
  const [warehouseId, setWarehouseId] = useState(version?.warehouseId ?? '');
  const [deliveryMode, setDeliveryMode] = useState(version?.deliveryMode ?? 'DELIVERY');
  const [collectionPolicy, setCollectionPolicy] = useState<SalesOrderCollectionPolicy>(version?.collectionPolicy ?? 'COLLECT_ON_DELIVERY');
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(version?.requestedDeliveryDate ?? '');
  const [note, setNote] = useState(version?.note ?? '');
  const [showMore, setShowMore] = useState(Boolean(version?.note));
  const [lines, setLines] = useState<LineDraft[]>(versionLines(version));
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [taxMode, setTaxMode] = useState<SalesOrderTaxMode>(initialTaxMode);
  const [taxRate, setTaxRate] = useState(initialTaxRate);
  const [skuTerm, setSkuTerm] = useState('');
  const [skuResults, setSkuResults] = useState<SalesOrderSkuSearchOption[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [activeSkuIndex, setActiveSkuIndex] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState<QuickCustomerDraft>(() => ({
    code: autoCustomerCode(), name: '', phone: '', addressLine1: '',
  }));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeCustomers = useMemo(() => customerRows
    .filter((item) => item.is_active && item.code !== WALK_IN_CUSTOMER_CODE)
    .filter((item) => {
      const term = customerSearch.trim().toLocaleLowerCase('vi');
      return !term || [item.code, item.name, item.phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('vi').includes(term));
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [customerRows, customerSearch]);

  const mixedTax = useMemo(() => (version?.lines ?? []).some(
    (line) => line.taxMode !== initialTaxMode || line.taxRate !== initialTaxRate,
  ), [initialTaxMode, initialTaxRate, version]);

  const totals = useMemo(() => lines.reduce((current, line) => {
    const amount = lineAmounts(line, taxMode, taxRate);
    return {
      subtotal: current.subtotal + amount.subtotal,
      discount: current.discount + amount.discount,
      tax: current.tax + amount.tax,
      total: current.total + amount.total,
    };
  }, { subtotal: 0n, discount: 0n, tax: 0n, total: 0n }), [lines, taxMode, taxRate]);

  const selectedCustomer = customerRows.find((item) => item.id === customerId) ?? null;

  const markDirty = useCallback(() => {
    setDirty(true);
    props.onError('');
  }, [props]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('Đơn bán hàng có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return;
    props.onClose();
  }, [busy, dirty, props]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  useEffect(() => {
    if (customerMode === 'WALK_IN') {
      setCustomerId('');
      setAddressId('');
      setAddresses([]);
      setDeliveryMode('PICKUP');
      if (!['PREPAID', 'COLLECT_ON_DELIVERY'].includes(collectionPolicy)) {
        setCollectionPolicy('COLLECT_ON_DELIVERY');
      }
      return;
    }
    if (!customerId) {
      setAddresses([]);
      setAddressId('');
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
  }, [collectionPolicy, customerId, customerMode]);

  useEffect(() => {
    const term = skuTerm.trim();
    setActiveSkuIndex(0);
    if (term.length < 2) {
      setSkuResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSkuLoading(true);
      try {
        const query = new URLSearchParams({ search: term, limit: String(SEARCH_PAGE_SIZE), offset: '0' });
        const rows = await requestJson<SalesOrderSkuSearchOption[]>(`/api/sales-orders/sku-search?${query}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSkuResults(rows);
      } catch (error) {
        if (!controller.signal.aborted) props.onError(error instanceof Error ? error.message : 'Không tìm được hàng hóa');
      } finally {
        if (!controller.signal.aborted) setSkuLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [props, skuTerm]);

  async function priceFor(option: SalesOrderSkuSearchOption, quantity: string): Promise<SalesPriceResolution> {
    return apiRequest<SalesPriceResolution>('/api/pricing/resolve', {
      method: 'POST',
      body: JSON.stringify({
        variantId: option.id,
        quantity,
        currencyCode: 'VND',
        priceAt: new Date().toISOString(),
        ...(customerMode === 'EXISTING' && customerId ? { customerId } : {}),
      }),
    });
  }

  async function addSku(option: SalesOrderSkuSearchOption) {
    if (!option.eligibility.selectable) return props.onError(option.eligibility.message);
    if (lines.some((line) => line.variantId === option.id)) return props.onError('SKU này đã có trong đơn');
    const pending: LineDraft = {
      variantId: option.id,
      sku: option.sku,
      name: option.variantName,
      unitCode: option.unitCode ?? '',
      quantity: '1',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      baseUnitPriceMinor: '0',
      finalUnitPriceMinor: '0',
      priceSteps: [],
      resolvingPrice: true,
      priceError: null,
    };
    setLines((current) => [...current, pending]);
    setSkuTerm('');
    setSkuResults([]);
    markDirty();
    try {
      const resolution = await priceFor(option, '1');
      setLines((current) => current.map((line) => line.variantId === option.id ? {
        ...line,
        baseUnitPriceMinor: resolution.baseUnitPriceMinor,
        finalUnitPriceMinor: resolution.finalUnitPriceMinor,
        priceSteps: resolution.steps,
        resolvingPrice: false,
        priceError: null,
      } : line));
    } catch (error) {
      setLines((current) => current.map((line) => line.variantId === option.id ? {
        ...line,
        resolvingPrice: false,
        priceError: error instanceof Error ? error.message : 'Không phân giải được giá',
      } : line));
    } finally {
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }

  async function refreshLinePrice(index: number) {
    const line = lines[index];
    if (!line || !parseScaled(line.quantity, false)) return;
    const option: SalesOrderSkuSearchOption = {
      id: line.variantId,
      productId: '', productCode: '', productName: '', sku: line.sku,
      variantName: line.name, barcode: null, unitId: '', unitCode: line.unitCode,
      unitName: null, conversionToBase: null, allowsFractional: null,
      eligibility: { selectable: true, code: 'ELIGIBLE', message: '' },
    };
    setLines((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, resolvingPrice: true, priceError: null }
      : item));
    try {
      const resolution = await priceFor(option, line.quantity);
      setLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        baseUnitPriceMinor: resolution.baseUnitPriceMinor,
        finalUnitPriceMinor: resolution.finalUnitPriceMinor,
        priceSteps: resolution.steps,
        resolvingPrice: false,
        priceError: null,
      } : item));
    } catch (error) {
      setLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        resolvingPrice: false,
        priceError: error instanceof Error ? error.message : 'Không phân giải được giá',
      } : item));
    }
  }

  async function refreshAllPrices() {
    await Promise.all(lines.map((_, index) => refreshLinePrice(index)));
  }

  function handleSkuKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSkuIndex((current) => Math.min(current + 1, Math.max(0, skuResults.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSkuIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && skuResults[activeSkuIndex]) {
      event.preventDefault();
      void addSku(skuResults[activeSkuIndex]);
    }
  }

  async function createQuickCustomer() {
    if (!quickCustomer.name.trim()) return props.onError('Hãy nhập tên khách hàng');
    if (deliveryMode === 'DELIVERY' && !quickCustomer.addressLine1.trim()) {
      return props.onError('Khách giao hàng cần địa chỉ');
    }
    setBusy(true);
    try {
      const created = await requestJson<Customer>('/api/customers', {
        method: 'POST',
        headers: { 'Idempotency-Key': mutationKey('sales-quick-customer') },
        body: JSON.stringify({
          code: quickCustomer.code,
          name: quickCustomer.name.trim(),
          groupId: null,
          responsibleEmployeeId: null,
          phone: quickCustomer.phone.trim() || null,
          email: null,
          taxCode: null,
          paymentTermsDays: 0,
          creditLimit: '0',
          notes: 'Tạo nhanh từ màn hình đơn bán hàng.',
        }),
      });
      let createdAddress: CustomerAddress | null = null;
      if (deliveryMode === 'DELIVERY') {
        createdAddress = await requestJson<CustomerAddress>(`/api/customers/${created.id}/addresses`, {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey('sales-quick-address') },
          body: JSON.stringify({
            label: 'Địa chỉ giao hàng',
            recipientName: created.name,
            phone: quickCustomer.phone.trim() || null,
            addressLine1: quickCustomer.addressLine1.trim(),
            addressLine2: null,
            ward: null,
            district: null,
            province: null,
            postalCode: null,
            countryCode: 'VN',
            isDefault: true,
          }),
        });
      }
      setCustomerRows((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setCustomerMode('EXISTING');
      setCustomerId(created.id);
      if (createdAddress) {
        setAddresses([createdAddress]);
        setAddressId(createdAddress.id);
      }
      setQuickOpen(false);
      setQuickCustomer({ code: autoCustomerCode(), name: '', phone: '', addressLine1: '' });
      markDirty();
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Không tạo nhanh được khách hàng');
    } finally {
      setBusy(false);
    }
  }

  function validate(): string | null {
    if (customerMode === 'EXISTING' && !customerId) return 'Hãy chọn khách hàng';
    if (!warehouseId) return 'Hãy chọn kho xuất';
    if (customerMode === 'WALK_IN' && deliveryMode !== 'PICKUP') return 'Khách vãng lai chỉ nhận tại kho';
    if (customerMode === 'WALK_IN' && !['PREPAID', 'COLLECT_ON_DELIVERY'].includes(collectionPolicy)) {
      return 'Khách vãng lai không được bán chịu hoặc giao trước thu sau';
    }
    if (deliveryMode === 'DELIVERY' && !addressId) return 'Hãy chọn địa chỉ giao hàng';
    if (lines.length === 0) return 'Đơn bán hàng phải có ít nhất một SKU';
    if (lines.some((line) => !parseScaled(line.quantity, false))) return 'Số lượng hàng hóa chưa hợp lệ';
    if (lines.some((line) => line.resolvingPrice)) return 'Hệ thống đang tính giá, hãy đợi hoàn tất';
    if (lines.some((line) => line.priceError || line.finalUnitPriceMinor === '0')) return 'Có dòng hàng chưa phân giải được giá bán';
    const rate = parseScaled(taxRate || '0', true);
    if (rate === null || rate > HUNDRED) return 'Thuế suất phải từ 0 đến 100';
    return null;
  }

  function payload(): SalesOrderDraftPayload {
    return {
      sourceType: 'MANUAL',
      customerMode,
      ...(customerMode === 'EXISTING' ? { customerId } : {}),
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
        taxMode,
        taxRate: taxRate || '0',
      })),
    };
  }

  async function save(confirmAfter: boolean) {
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
      let order = await apiRequest<SalesOrder>(path, {
        method,
        headers: { 'Idempotency-Key': saveKey },
        body: JSON.stringify(payload()),
      });
      if (confirmAfter) {
        const confirmPath = props.mode === 'amendment'
          ? `/api/sales-orders/${order.id}/amendments/${version?.versionNumber}/confirm`
          : `/api/sales-orders/${order.id}/confirm`;
        order = await apiRequest<SalesOrder>(confirmPath, {
          method: 'POST',
          headers: { 'Idempotency-Key': confirmKey },
          body: JSON.stringify({}),
        });
      }
      setDirty(false);
      props.onSaved(order);
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Không lưu được đơn bán hàng');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section className={styles.orderEditorModal} role="dialog" aria-modal="true" aria-label="Biểu mẫu đơn bán hàng">
        <header className={styles.modalHeader}>
          <div><p className={styles.eyebrow}>Bán hàng</p><h2>{props.mode === 'create' ? 'Tạo đơn bán hàng' : props.mode === 'amendment' ? `Sửa bản điều chỉnh ${version?.versionNumber}` : 'Sửa đơn bán hàng nháp'}</h2></div>
          <button type="button" className={styles.closeButton} onClick={requestClose} aria-label="Đóng">×</button>
        </header>

        <div className={styles.orderEditorBody}>
          <section className={styles.compactHeader} aria-label="Thông tin đơn hàng">
            <div className={styles.customerModeRow}>
              <button type="button" className={customerMode === 'EXISTING' ? styles.segmentActive : styles.segment} onClick={() => { setCustomerMode('EXISTING'); markDirty(); }}>Khách đã có</button>
              <button type="button" className={customerMode === 'WALK_IN' ? styles.segmentActive : styles.segment} onClick={() => { setCustomerMode('WALK_IN'); markDirty(); }}>Khách vãng lai</button>
              {props.canQuickCreateCustomer && <button type="button" className={styles.linkButton} onClick={() => setQuickOpen((value) => !value)}>+ Tạo nhanh khách mới</button>}
            </div>

            {customerMode === 'EXISTING' ? (
              <label className={styles.customerField}><span>Khách hàng *</span><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tìm mã, tên hoặc số điện thoại" /><select value={customerId} onChange={(event) => { setCustomerId(event.target.value); markDirty(); void refreshAllPrices(); }}><option value="">Chọn khách hàng</option>{activeCustomers.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}{item.phone ? ` · ${item.phone}` : ''}</option>)}</select></label>
            ) : (
              <div className={styles.walkInNotice}><strong>Khách vãng lai</strong><span>Nhận tại kho, không bán chịu; hệ thống dùng khách chuẩn theo installation.</span></div>
            )}

            <label><span>Kho xuất *</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); markDirty(); }}><option value="">Chọn kho</option>{props.warehouses.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
            <label><span>Nhận hàng</span><select value={deliveryMode} disabled={customerMode === 'WALK_IN'} onChange={(event) => { setDeliveryMode(event.target.value as 'DELIVERY' | 'PICKUP'); markDirty(); }}><option value="DELIVERY">Giao đến khách</option><option value="PICKUP">Nhận tại kho</option></select></label>
            <label><span>Thu tiền</span><select value={collectionPolicy} onChange={(event) => { setCollectionPolicy(event.target.value as SalesOrderCollectionPolicy); markDirty(); }}><option value="COLLECT_ON_DELIVERY">Thu khi giao/nhận</option><option value="PREPAID">Đã trả trước</option>{customerMode === 'EXISTING' && <><option value="COLLECT_AFTER_DELIVERY">Giao trước, thu sau</option><option value="CREDIT_TERMS">Bán chịu theo hạn mức</option></>}</select></label>
            <label><span>Ngày cần hàng</span><input type="date" value={requestedDeliveryDate} onChange={(event) => { setRequestedDeliveryDate(event.target.value); markDirty(); }} /></label>
            {deliveryMode === 'DELIVERY' && customerMode === 'EXISTING' && <label className={styles.addressField}><span>Địa chỉ giao hàng *</span><select value={addressId} onChange={(event) => { setAddressId(event.target.value); markDirty(); }}><option value="">Chọn địa chỉ</option>{addresses.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.address_line1}, {item.ward ?? ''}, {item.province ?? ''}</option>)}</select></label>}
            <button type="button" className={styles.moreButton} onClick={() => setShowMore((value) => !value)}>{showMore ? 'Ẩn thông tin thêm' : 'Thông tin thêm'}</button>
            {showMore && <label className={styles.noteField}><span>Ghi chú</span><textarea rows={2} value={note} onChange={(event) => { setNote(event.target.value); markDirty(); }} /></label>}
          </section>

          {quickOpen && props.canQuickCreateCustomer && (
            <section className={styles.quickCustomerPanel} aria-label="Tạo nhanh khách hàng">
              <header><div><strong>Tạo nhanh khách chính thức</strong><span>Khách được tạo và chọn ngay, không phải rời đơn hàng.</span></div><button type="button" onClick={() => setQuickOpen(false)}>Đóng</button></header>
              <label><span>Mã khách</span><input value={quickCustomer.code} onChange={(event) => setQuickCustomer((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></label>
              <label><span>Tên khách *</span><input value={quickCustomer.name} onChange={(event) => setQuickCustomer((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>Số điện thoại</span><input value={quickCustomer.phone} onChange={(event) => setQuickCustomer((current) => ({ ...current, phone: event.target.value }))} /></label>
              {deliveryMode === 'DELIVERY' && <label className={styles.quickAddress}><span>Địa chỉ giao hàng *</span><input value={quickCustomer.addressLine1} onChange={(event) => setQuickCustomer((current) => ({ ...current, addressLine1: event.target.value }))} /></label>}
              <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void createQuickCustomer()}>Tạo và chọn khách</button>
            </section>
          )}

          <section className={styles.productEntry} aria-label="Nhập hàng hóa">
            <div className={styles.productSearchBox}>
              <label><span>Tìm hàng nhanh</span><input ref={searchRef} value={skuTerm} onChange={(event) => setSkuTerm(event.target.value)} onKeyDown={handleSkuKeyDown} placeholder="Tên sản phẩm, mã hàng, SKU hoặc barcode" autoComplete="off" /></label>
              {skuLoading && <span className={styles.searchStatus}>Đang tìm…</span>}
              {skuResults.length > 0 && (
                <div className={styles.skuResults} role="listbox">
                  {skuResults.map((option, index) => (
                    <button type="button" key={option.id} className={index === activeSkuIndex ? styles.skuResultActive : styles.skuResult} disabled={!option.eligibility.selectable} onMouseDown={(event) => event.preventDefault()} onClick={() => void addSku(option)}>
                      <div><strong>{option.sku} — {option.variantName}</strong><span>{option.productCode} · {option.productName}</span></div>
                      <div><b>{option.unitCode ?? 'Chưa có ĐVT'}</b>{option.barcode && <small>{option.barcode}</small>}<small className={option.eligibility.selectable ? styles.eligible : styles.ineligible}>{option.eligibility.message}</small></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className={styles.keyboardHint}>Gõ để tìm, ↑↓ để chọn, Enter để thêm. Giá được Core phân giải ngay khi chọn.</p>
          </section>

          <section className={styles.orderLines} aria-label="Hàng hóa trong đơn">
            <header className={styles.lineTableHeader}><span>Hàng hóa</span><span>Số lượng</span><span>Giá nền</span><span>Giá bán</span><span>Thành tiền</span><span /></header>
            {lines.map((line, index) => {
              const amount = lineAmounts(line, taxMode, taxRate);
              const applied = line.priceSteps.filter((step) => step.kind === 'RULE');
              return (
                <article className={styles.orderLineCard} key={line.variantId}>
                  <div className={styles.lineIdentity}><strong>{line.sku} — {line.name}</strong><span>ĐVT {line.unitCode || '—'}</span>{line.priceError && <small className={styles.ineligible}>{line.priceError}</small>}</div>
                  <label><span>SL</span><input inputMode="decimal" value={line.quantity} onChange={(event) => { const value = event.target.value; setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: value } : item)); markDirty(); }} onBlur={() => void refreshLinePrice(index)} /></label>
                  <div className={styles.priceCell}><span>Giá nền</span><strong>{line.resolvingPrice ? 'Đang tính…' : vnd(line.baseUnitPriceMinor)}</strong></div>
                  <div className={styles.priceCell}><span>Giá bán cuối</span><strong>{line.resolvingPrice ? 'Đang tính…' : vnd(line.finalUnitPriceMinor)}</strong>{applied.length > 0 && <small>{applied.length} chương trình/quy tắc</small>}</div>
                  <div className={styles.priceCell}><span>Thành tiền</span><strong>{vnd(amount.total)}</strong></div>
                  <button type="button" className={styles.removeLineButton} onClick={() => { setLines((current) => current.filter((_, itemIndex) => itemIndex !== index)); markDirty(); }}>Xóa</button>
                  <details className={styles.lineDetails}>
                    <summary>Xem cách tính giá và chiết khấu thêm</summary>
                    <div className={styles.priceTrace}>
                      {line.priceSteps.length === 0 && <span>Giá snapshot hiện tại; lưu lại để Core tái phân giải.</span>}
                      {line.priceSteps.map((step, stepIndex) => <div key={`${step.kind}-${stepIndex}`}><span>{pricingLabel(step)}</span><b>{step.afterUnitPriceMinor ? vnd(step.afterUnitPriceMinor) : '—'}</b></div>)}
                    </div>
                    <div className={styles.discountEditor}>
                      <label><span>Kiểu CK thêm</span><select value={line.discountMode} onChange={(event) => { const value = event.target.value as DiscountMode; setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountMode: value } : item)); markDirty(); }}><option value="TOTAL_AMOUNT">Giảm tổng dòng</option><option value="PER_UNIT">Giảm mỗi đơn vị</option><option value="PERCENT">Giảm phần trăm</option></select></label>
                      <label><span>Giá trị CK</span><input value={line.discountValue} onChange={(event) => { const value = event.target.value; setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountValue: value } : item)); markDirty(); }} /></label>
                    </div>
                  </details>
                </article>
              );
            })}
            {lines.length === 0 && <p className={styles.empty}>Chưa có hàng hóa. Dùng ô tìm nhanh phía trên để thêm hàng.</p>}
          </section>
        </div>

        <footer className={styles.orderEditorFooter}>
          <section className={styles.taxSummary} aria-label="Tổng kết thuế và thanh toán">
            <label><span>Chính sách thuế</span><select value={taxMode} onChange={(event) => { setTaxMode(event.target.value as SalesOrderTaxMode); markDirty(); }}><option value="EXCLUSIVE">Giá chưa gồm thuế</option><option value="INCLUSIVE">Giá đã gồm thuế</option></select></label>
            <label><span>Thuế suất chung</span><div className={styles.percentInput}><input inputMode="decimal" value={taxRate} onChange={(event) => { setTaxRate(event.target.value); markDirty(); }} /><b>%</b></div></label>
            {mixedTax && <span className={styles.taxWarning}>Đơn cũ có nhiều mức thuế; lưu sẽ chuẩn hóa theo mức đang chọn.</span>}
            <div><span>Tiền hàng</span><strong>{vnd(totals.subtotal)}</strong></div>
            <div><span>Chiết khấu</span><strong>- {vnd(totals.discount)}</strong></div>
            <div><span>Tiền thuế</span><strong>{vnd(totals.tax)}</strong></div>
            <div className={styles.grandTotal}><span>Tổng thanh toán</span><strong>{vnd(totals.total)}</strong></div>
          </section>
          <div className={styles.footerActions}>
            <button type="button" onClick={requestClose}>Đóng</button>
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save(false)}>{busy ? 'Đang lưu…' : 'Lưu nháp'}</button>
            {props.canConfirm && <button type="button" className={styles.confirmButton} disabled={busy} onClick={() => void save(true)}>{busy ? 'Đang xử lý…' : 'Lưu và xác nhận'}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
