'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Product = { id: string; productCode: string; imageKey?: string | null; productName: string; sku: string; barcode?: string | null; unitCode: string; allowsFractional: boolean | null };
type Warehouse = { id: string; code: string; name: string };
type Customer = { id: string; code: string; name: string };
type Category = { id: string; code: string; name: string };
type Settings = { defaultTaxMode: 'EXCLUSIVE' | 'INCLUSIVE'; defaultTaxRate: string };
type OrderLine = { id: string; variantId: string; sku: string; itemName: string; unitCode: string; quantity: string; unitPrice: string; lineTotal: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Order = { id: string; number: string | null; status: 'draft' | 'confirmed' | 'closed' | 'cancelled'; currentVersionNumber: string; deliveryMode: string; fulfillmentStatus: string; settlementStatus: string; collectionPolicy: string; customerMode: 'WALK_IN' | 'EXISTING'; customerId: string; customerName: string; total: string; revision: string; warehouseId: string; warehouseName: string; salesChannelCode?: string | null; salesChannelName?: string | null; updatedAt: string; receivableRemainingAmount?: string; versions?: { versionNumber: string; revision: string; status?: string; lines?: OrderLine[] }[] };
type CartLine = Product & { quantity: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Availability = { variantId: string; availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE'; availableQuantity: string | null };
type Bootstrap = { settings: Settings; warehouses: Warehouse[]; customers: Customer[]; categories: Category[]; orders: Order[] };
type PricePreview = { finalUnitPriceMinor: string; lineTotalMinor: string; resolutionFingerprint?: string; channelCode?: string };
type CachedPricePreview = PricePreview & { inputKey: string };
type RetailTab = 'entry' | 'orders';
type OrderFilter = 'all' | 'draft' | 'confirmed' | 'issued' | 'closed' | 'cancelled';
type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
  }
}

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const PRODUCT_IMAGE_BASE = 'https://pub-7d2987fab97d4e3ebb2021a823973862.r2.dev/app-customer/products';
const STOCK_ISSUED_FULFILLMENT_STATUSES = new Set(['partially_issued', 'issued', 'partially_fulfilled', 'fulfilled']);
const linesOf = (order: Order | null) => order?.versions?.find((item) => item.versionNumber === order.currentVersionNumber)?.lines ?? order?.versions?.find((item) => item.status === 'draft')?.lines ?? order?.versions?.[0]?.lines ?? [];
const cartFromOrder = (order: Order): CartLine[] => linesOf(order).map((line) => ({ id: line.variantId, productCode: line.sku, imageKey: null, productName: line.itemName, sku: line.sku, unitCode: line.unitCode, allowsFractional: null, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate }));

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message ?? 'Không thể thực hiện thao tác');
  return payload?.data as T;
}

function normalizedQuantity(value: string, fractional: boolean | null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '1';
  return fractional ? String(Math.min(number, 999999)) : String(Math.max(1, Math.trunc(number)));
}

function productImage(imageKey?: string | null) {
  const key = String(imageKey ?? '').trim();
  return key ? `${PRODUCT_IMAGE_BASE}/${encodeURIComponent(key)}.webp` : '';
}

function orderLabel(order: Order) {
  if (order.status === 'closed') return order.settlementStatus === 'paid' ? 'Đã hoàn thành · Đã thu đủ' : 'Đã hoàn thành · Còn phải thu';
  if (order.status === 'confirmed') return STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus) ? 'Đã xuất kho' : 'Đã chốt';
  if (order.status === 'cancelled') return 'Đã hủy';
  return 'Đang lập';
}

function availabilityLabel(row: Availability | undefined) {
  if (row?.availabilityStatus === 'NOT_APPLICABLE') return 'Không áp dụng';
  if (row?.availabilityStatus === 'UNAVAILABLE') return 'Chưa khả dụng';
  return row?.availableQuantity ?? 'Đang tải';
}

function progressStage(order: Order | null) {
  if (!order) return 0;
  if (order.status === 'closed') return 3;
  if (order.status === 'confirmed' && STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus)) return 2;
  if (order.status === 'confirmed') return 1;
  return 0;
}

function dateLabel(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export default function RetailHomePage() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [available, setAvailable] = useState<Availability[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Map<string, { product: Product; quantity: string }>>(new Map());
  const [customerMode, setCustomerMode] = useState<'WALK_IN' | 'EXISTING'>('WALK_IN');
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [policy, setPolicy] = useState('COLLECT_ON_DELIVERY');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payment, setPayment] = useState(false);
  const [paid, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [activeTab, setActiveTab] = useState<RetailTab>('entry');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [editPickup, setEditPickup] = useState(false);
  const [prices, setPrices] = useState<Record<string, CachedPricePreview>>({});
  const [lineImages, setLineImages] = useState<Record<string, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const filterTabs = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState({ left: 0, width: 0 });
  const keys = useRef(new Map<string, string>());
  const lastDraftFingerprint = useRef('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const keyFor = useCallback((action: string, fingerprint = '') => {
    const slot = `${action}:${order?.id ?? 'new'}:${order?.revision ?? 'draft'}:${fingerprint}`;
    const existing = keys.current.get(slot);
    if (existing) return existing;
    const next = createIdempotencyKey(`retail-${action}`);
    keys.current.set(slot, next);
    return next;
  }, [order?.id, order?.revision]);

  const refreshOrders = useCallback(async () => {
    const list = await api<Order[]>('/api/retail/orders?limit=100&offset=0');
    setOrders(list.filter((item) => item.deliveryMode === 'PICKUP'));
  }, []);

  function priceInputKey(variantId: string, quantity: string) {
    return [customerMode, customerMode === 'EXISTING' ? customerId : '', variantId, quantity].join(':');
  }

  function orderPayload(revision = order?.revision) {
    if (!warehouseId) throw new Error('Hãy chọn kho bán.');
    if (!cart.length) throw new Error('Hãy chọn ít nhất một sản phẩm.');
    return {
      sourceType: 'MANUAL',
      customerMode,
      ...(customerMode === 'EXISTING' ? { customerId } : {}),
      warehouseId,
      deliveryMode: 'PICKUP',
      collectionPolicy: policy,
      currency: 'VND',
      ...(revision ? { expectedRevision: revision } : {}),
      lines: cart.map((line) => {
        const preview = prices[line.id];
        return {
          variantId: line.id,
          quantity: line.quantity,
          taxMode: line.taxMode,
          taxRate: line.taxRate,
          ...(preview?.inputKey === priceInputKey(line.id, line.quantity) ? { expectedSystemUnitPriceMinor: preview.finalUnitPriceMinor } : {}),
        };
      }),
    };
  }

  useEffect(() => {
    void api<Bootstrap>('/api/retail/bootstrap').then((data) => {
      setBoot(data);
      setOrders(data.orders.filter((item) => item.deliveryMode === 'PICKUP'));
      setWarehouseId(data.warehouses[0]?.id ?? '');
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search, limit: '30', offset: '0' });
      if (categoryId) params.set('categoryId', categoryId);
      void api<Product[]>(`/api/retail/products?${params}`, { signal: controller.signal })
        .then(setProducts)
        .catch((reason: Error) => !controller.signal.aborted && setError(reason.message));
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, search, categoryId]);

  useEffect(() => {
    const wanted = new Map<string, { product: Product; quantity: string }>();
    for (const product of open ? products : []) wanted.set(product.id, { product, quantity: selected.get(product.id)?.quantity ?? '1' });
    for (const row of selected.values()) wanted.set(row.product.id, row);
    for (const row of cart) wanted.set(row.id, { product: row, quantity: row.quantity });
    for (const row of wanted.values()) {
      const inputKey = priceInputKey(row.product.id, row.quantity);
      if (prices[row.product.id]?.inputKey === inputKey) continue;
      void api<PricePreview>('/api/retail/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: row.product.id, quantity: row.quantity, ...(customerMode === 'EXISTING' && customerId ? { customerId } : {}) }),
      }).then((price) => setPrices((current) => ({ ...current, [row.product.id]: { ...price, inputKey } }))).catch(() => undefined);
    }
  }, [cart, customerId, customerMode, open, prices, products, selected]);

  useEffect(() => {
    if (!cart.length || !warehouseId || editPickup || (order && order.status !== 'draft')) return;
    const fingerprint = JSON.stringify({ customerMode, customerId: customerMode === 'EXISTING' ? customerId : '', warehouseId, policy, lines: cart.map((line) => [line.id, line.quantity, prices[line.id]?.finalUnitPriceMinor ?? '']) });
    if (lastDraftFingerprint.current === fingerprint) return;
    const timer = window.setTimeout(() => {
      setBusy('draft-sync');
      setError(null);
      const currentOrder = order;
      const request = currentOrder
        ? api<Order>(`/api/retail/orders/${currentOrder.id}/draft`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('draft-sync', fingerprint) },
            body: JSON.stringify(orderPayload(currentOrder.revision)),
          })
        : api<Order>('/api/retail/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('create-draft', fingerprint) },
            body: JSON.stringify(orderPayload(undefined)),
          });
      void request.then((next) => {
        lastDraftFingerprint.current = fingerprint;
        setOrder(next);
        void refreshOrders().catch(() => undefined);
      }).catch((reason: Error) => setError(reason.message)).finally(() => setBusy((value) => value === 'draft-sync' ? null : value));
    }, 360);
    return () => window.clearTimeout(timer);
  }, [cart, customerId, customerMode, editPickup, keyFor, order, policy, prices, refreshOrders, warehouseId]);

  useEffect(() => {
    if (!order?.id || ['closed', 'cancelled'].includes(order.status)) return;
    void api<Availability[]>(`/api/retail/orders/${order.id}/availability`).then(setAvailable).catch((reason: Error) => setError(reason.message));
  }, [order?.id, order?.revision, order?.status]);

  useEffect(() => {
    const lines = linesOf(order);
    if (!lines.length) return;
    let cancelled = false;
    void Promise.all(lines.map(async (line) => {
      const params = new URLSearchParams({ search: line.sku, limit: '5', offset: '0' });
      const options = await api<Product[]>(`/api/retail/products?${params}`).catch(() => []);
      const match = options.find((item) => item.sku.toUpperCase() === line.sku.toUpperCase()) ?? options[0];
      return [line.variantId, match?.imageKey ?? match?.productCode ?? ''] as const;
    })).then((pairs) => {
      if (!cancelled) setLineImages(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [order?.id, order?.revision]);

  useEffect(() => {
    if (!open) return;
    const syncMarker = () => {
      const active = filterTabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (active) setMarker({ left: active.offsetLeft, width: active.offsetWidth });
    };
    const frame = requestAnimationFrame(syncMarker);
    window.addEventListener('resize', syncMarker);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', syncMarker); };
  }, [open, categoryId, boot?.categories.length]);

  useEffect(() => {
    if (!scannerOpen) return;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.BarcodeDetector) {
        setScannerMessage('Thiết bị chưa hỗ trợ quét mã trong trình duyệt này. Hãy dùng ô tìm kiếm SKU.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled || !videoRef.current) return stop();
        videoRef.current.srcObject = stream;
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code'] });
        timer = window.setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          void detector.detect(video).then((codes) => {
            const value = codes[0]?.rawValue?.trim();
            if (!value) return;
            setSearch(value);
            setScannerOpen(false);
            setNotice(`Đã tìm theo mã ${value}.`);
          }).catch(() => undefined);
        }, 350);
      } catch {
        setScannerMessage('Không thể mở camera. Hãy kiểm tra quyền camera hoặc tìm theo SKU.');
      }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [scannerOpen]);

  const byVariant = useMemo(() => new Map(available.map((item) => [item.variantId, item])), [available]);
  const lineItems = linesOf(order);
  const editable = !order || order.status === 'draft' || editPickup;
  const editingDraft = editable && cart.length > 0;
  const total = order ? Number(order.total || 0) : 0;
  const cartTotal = cart.reduce((sum, line) => {
    const preview = prices[line.id];
    return sum + (preview?.inputKey === priceInputKey(line.id, line.quantity) ? Number(preview.lineTotalMinor || 0) : 0);
  }, 0);
  const totalLabel = cart.length ? money.format(cartTotal || total) : money.format(total);
  const stage = progressStage(order);
  const canEditPickup = order?.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus);
  const filteredOrders = orders.filter((item) => {
    if (orderFilter === 'all') return true;
    if (orderFilter === 'issued') return item.status === 'confirmed' && STOCK_ISSUED_FULFILLMENT_STATUSES.has(item.fulfillmentStatus);
    if (orderFilter === 'confirmed') return item.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(item.fulfillmentStatus);
    return item.status === orderFilter;
  });

  function updateCartQuantity(id: string, value: string, fractional: boolean | null) {
    lastDraftFingerprint.current = '';
    setCart((rows) => rows.map((row) => row.id === id ? { ...row, quantity: normalizedQuantity(value, fractional) } : row));
  }

  function toggleProduct(product: Product) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, { product, quantity: '1' });
      return next;
    });
  }

  function adjustSelected(product: Product, direction: -1 | 1) {
    setSelected((current) => {
      const next = new Map(current);
      const currentRow = next.get(product.id);
      if (!currentRow && direction > 0) next.set(product.id, { product, quantity: '1' });
      else if (currentRow) {
        const nextValue = Number(currentRow.quantity) + direction;
        if (nextValue <= 0) next.delete(product.id);
        else next.set(product.id, { ...currentRow, quantity: normalizedQuantity(String(nextValue), product.allowsFractional) });
      }
      return next;
    });
  }

  function addSelected() {
    lastDraftFingerprint.current = '';
    setCart((current) => {
      let seeded = current;
      if (!seeded.length && order && (order.status === 'draft' || editPickup)) seeded = cartFromOrder(order);
      const next = new Map(seeded.map((line) => [line.id, line]));
      for (const row of selected.values()) {
        const previous = next.get(row.product.id);
        next.set(row.product.id, previous
          ? { ...previous, quantity: normalizedQuantity(String(Number(previous.quantity) + Number(row.quantity)), row.product.allowsFractional) }
          : { ...row.product, quantity: row.quantity, taxMode: boot?.settings.defaultTaxMode ?? 'EXCLUSIVE', taxRate: boot?.settings.defaultTaxRate ?? '0' });
      }
      return [...next.values()];
    });
    setSelected(new Map());
    setOpen(false);
    setNotice('Đã thêm sản phẩm vào đơn. Khả dụng sẽ cập nhật theo kho đang chọn.');
  }

  async function savePickupEdit() {
    if (!order || !editPickup) return;
    setBusy('save'); setError(null);
    try {
      const next = await api<Order>(`/api/retail/orders/${order.id}/pickup-edit`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('pickup-edit', JSON.stringify(cart.map((line) => [line.id, line.quantity]))) }, body: JSON.stringify(orderPayload(order.revision)) });
      setOrder(next); setCart([]); setPrices({}); setEditPickup(false); setNotice('Đã lưu thay đổi đơn và giữ nguyên trạng thái Đã chốt.');
      void refreshOrders().catch(() => undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể lưu đơn.'); }
    finally { setBusy(null); }
  }

  async function action(kind: 'confirm' | 'issue-stock' | 'complete') {
    if (!order) return;
    setBusy(kind); setError(null);
    try {
      const body = kind === 'confirm' ? {} : { expectedRevision: order.revision };
      const next = await api<Order>(`/api/retail/orders/${order.id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor(kind) }, body: JSON.stringify(body) });
      setOrder(next);
      if (kind === 'confirm') setCart([]);
      setNotice(kind === 'confirm' ? 'Đơn đã được chốt.' : kind === 'issue-stock' ? 'Đã xuất kho.' : 'Đơn đã hoàn thành.');
      void refreshOrders().catch(() => undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể thực hiện thao tác.'); }
    finally { setBusy(null); }
  }

  async function settle(amount = paid) {
    if (!order) return;
    setBusy('settlement'); setError(null);
    try {
      const normalizedAmount = String(amount).trim();
      const debtOnly = /^0(?:\.0+)?$/.test(normalizedAmount);
      const next = await api<Order>(`/api/retail/orders/${order.id}/settlement`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('settlement', `${normalizedAmount}-${paymentMethod}`) }, body: JSON.stringify({ expectedRevision: order.revision, paidAmount: normalizedAmount, ...(debtOnly ? {} : { paymentMethod }) }) });
      setOrder(next); setPayment(false); setNotice(debtOnly ? 'Đã ghi nhận nợ.' : 'Đã ghi nhận tiền thu và cập nhật công nợ.');
      void refreshOrders().catch(() => undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể ghi nhận thanh toán.'); }
    finally { setBusy(null); }
  }

  async function openOrder(id: string) {
    setError(null);
    try {
      const next = await api<Order>(`/api/retail/orders/${id}`);
      setOrder(next); setCustomerMode(next.customerMode); setCustomerId(next.customerId); setWarehouseId(next.warehouseId); setPolicy(next.collectionPolicy); setCart(next.status === 'draft' ? cartFromOrder(next) : []); setEditPickup(false); setActiveTab('entry'); lastDraftFingerprint.current = '';
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tải đơn.'); }
  }

  function beginPickupEdit() {
    if (!order) return;
    setCart(cartFromOrder(order));
    setCustomerMode(order.customerMode);
    setCustomerId(order.customerId);
    setWarehouseId(order.warehouseId);
    setPolicy(order.collectionPolicy);
    setEditPickup(true);
    setNotice('Có thể sửa đơn đến trước khi xuất kho.');
  }

  function resetEntry() {
    setOrder(null); setCart([]); setPrices({}); setEditPickup(false); setAvailable([]); setNotice(null); setError(null); setActiveTab('entry'); lastDraftFingerprint.current = '';
  }

  const productPicture = (imageKey: string | undefined, label: string) => imageKey
    ? <img className="product-photo" src={productImage(imageKey)} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
    : <span className="product-symbol product-symbol-large" aria-hidden="true">{label.slice(0, 1)}</span>;

  return (
    <main className="retail-shell retail-lot7">
      <header className="retail-header retail-topbar">
        <button className="round-icon" type="button" aria-label="Quay lại" onClick={() => activeTab === 'orders' ? setActiveTab('entry') : window.history.back()}>‹</button>
        <div className="retail-title"><p className="brand-kicker">HƯNG PHÁT</p><h1>{activeTab === 'orders' ? 'Đơn hàng' : order ? 'Chi tiết đơn' : 'Lên đơn'}</h1></div>
        <button className="round-icon scanner-button" type="button" aria-label="Quét mã sản phẩm" onClick={() => { setOpen(true); setScannerMessage(null); setScannerOpen(true); }}>⌗</button>
      </header>
      {error ? <p className="notice error" role="alert">{error}</p> : null}{notice ? <p className="notice" role="status">{notice}</p> : null}

      {activeTab === 'orders' ? <section className="orders-workspace" aria-label="Đơn Giao tại quầy">
        <header className="orders-heading"><div><p className="section-kicker">GIAO TẠI QUẦY</p><h2>Đơn đã lập</h2></div><button className="text-action" type="button" onClick={() => void refreshOrders()}>Tải lại</button></header>
        <div className="status-filter" role="tablist" aria-label="Lọc trạng thái đơn">{([{ id: 'all', label: 'Tất cả' }, { id: 'draft', label: 'Đang lập' }, { id: 'confirmed', label: 'Đã chốt' }, { id: 'issued', label: 'Đã xuất kho' }, { id: 'closed', label: 'Hoàn thành' }, { id: 'cancelled', label: 'Đã hủy' }] as { id: OrderFilter; label: string }[]).map((item) => <button type="button" role="tab" aria-selected={orderFilter === item.id} className={orderFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setOrderFilter(item.id)}>{item.label}</button>)}</div>
        <div className="order-history">{filteredOrders.map((item) => <button className="history-row" type="button" key={item.id} onClick={() => void openOrder(item.id)}><span className="history-icon">▤</span><span><strong>{item.number ?? 'Đơn nháp'}</strong><small>{item.customerName} · {item.warehouseName}</small><em>{dateLabel(item.updatedAt)}</em></span><b>{orderLabel(item)} ›</b></button>)}{filteredOrders.length === 0 ? <p className="empty-cart">Chưa có đơn phù hợp.</p> : null}</div>
      </section> : <>
        <section className="order-card retail-order-card">
          {order ? <div className="order-identity"><span className="order-document" aria-hidden="true">▤</span><div><p className="section-kicker">ĐƠN BÁN HÀNG</p><h2>{order.number ?? 'Đơn đang lập'}</h2><p>{orderLabel(order)} · {dateLabel(order.updatedAt)}</p></div><div className="order-badges"><span className="mode-pill">{order.salesChannelName ?? order.salesChannelCode ?? 'Retail'}</span><span className="mode-pill">Giao tại quầy</span></div></div> : null}
          {order && order.status !== 'cancelled' ? <ol className="order-timeline" aria-label="Tiến trình đơn hàng">{['Lên đơn', 'Đã chốt', 'Xuất kho', 'Hoàn thành'].map((step, index) => <li className={index <= stage ? 'complete' : ''} key={step}><span>{index < stage ? '✓' : index + 1}</span><strong>{step}</strong></li>)}</ol> : null}
          {editable ? <div className="order-fields order-choice-cards compact-choice-cards"><label><span>Khách hàng</span><select value={customerMode} onChange={(event) => { lastDraftFingerprint.current = ''; setCustomerMode(event.target.value as 'WALK_IN' | 'EXISTING'); }}><option value="WALK_IN">Khách lẻ</option><option value="EXISTING">Khách hàng Công Ty</option></select></label><label><span>Kho bán</span><select value={warehouseId} onChange={(event) => { lastDraftFingerprint.current = ''; setWarehouseId(event.target.value); }}><option value="">Chọn kho</option>{boot?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>{customerMode === 'EXISTING' ? <label className="wide-choice"><span>Chọn khách hàng</span><select value={customerId} onChange={(event) => { lastDraftFingerprint.current = ''; setCustomerId(event.target.value); }}><option value="">Chọn khách hàng</option>{boot?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label> : null}</div> : <div className="order-facts"><span>Khách hàng <strong>{order?.customerName}</strong></span><span>Kho bán <strong>{order?.warehouseName}</strong></span></div>}
          {editable ? <button className="choose-products" type="button" onClick={() => setOpen(true)}><span aria-hidden="true">＋</span><strong>Chọn sản phẩm</strong><b aria-hidden="true">›</b></button> : null}
          {editPickup ? <p className="edit-hint">Đơn đang được điều chỉnh. Lưu thay đổi sẽ tạo bản điều chỉnh và giữ trạng thái Đã chốt.</p> : null}
          <div className="cart-list" aria-live="polite">{order && !editingDraft ? lineItems.map((line) => <article className="cart-row cart-row-saved compact-product-card" key={line.id}>{productPicture(lineImages[line.variantId], line.itemName)}<div className="line-main"><strong>{line.itemName}</strong><span>SKU: {line.sku}</span><em>{line.unitCode}</em><small>Khả dụng {availabilityLabel(byVariant.get(line.variantId))}</small></div><dl><div><dt>SL</dt><dd>{line.quantity}</dd></div><div><dt>Đơn giá</dt><dd>{money.format(Number(line.unitPrice))}</dd></div><div><dt>Thành tiền</dt><dd>{money.format(Number(line.lineTotal))}</dd></div></dl></article>) : cart.map((line) => <article className="cart-row editable compact-product-card" key={line.id}>{productPicture(line.imageKey ?? line.productCode, line.productName)}<div className="line-main"><strong>{line.productName}</strong><span>SKU: {line.sku}</span><em>{line.unitCode}</em><small>Khả dụng {order ? availabilityLabel(byVariant.get(line.id)) : 'Đang chuẩn bị'}</small></div><div className="quantity-stepper" aria-label={`Số lượng ${line.productName}`}><button type="button" onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) - 1), line.allowsFractional)}>−</button><input inputMode="decimal" aria-label={`Nhập số lượng ${line.productName}`} value={line.quantity} onChange={(event) => updateCartQuantity(line.id, event.target.value, line.allowsFractional)} /><button type="button" onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) + 1), line.allowsFractional)}>+</button></div><dl><div><dt>Đơn giá</dt><dd>{prices[line.id]?.inputKey === priceInputKey(line.id, line.quantity) ? money.format(Number(prices[line.id].finalUnitPriceMinor)) : 'Đang tính'}</dd></div><div><dt>Thành tiền</dt><dd>{prices[line.id]?.inputKey === priceInputKey(line.id, line.quantity) ? money.format(Number(prices[line.id].lineTotalMinor)) : '—'}</dd></div></dl><button className="remove-line" type="button" onClick={() => { lastDraftFingerprint.current = ''; setCart((rows) => rows.filter((row) => row.id !== line.id)); }} aria-label={`Xóa ${line.productName}`}>⌫</button></article>)}{(!order || editingDraft) && !cart.length ? <p className="empty-cart">Chưa có sản phẩm. Chọn nhiều sản phẩm rồi thêm vào đơn trong một lần.</p> : null}</div>
          <footer className="order-total lot7-total"><div><span>Tạm tính</span><strong>{totalLabel}</strong></div><div><span>Giảm giá</span><strong>0 ₫</strong></div><div className="grand-total"><span>Tổng cộng</span><strong>{totalLabel}</strong></div></footer>
        </section>
        <section className="order-action-bar" aria-label="Thao tác đơn">{editPickup ? <button className="secondary-action" type="button" disabled={busy !== null} onClick={() => void savePickupEdit()}>{busy === 'save' ? 'Đang lưu…' : 'Lưu thay đổi'}</button> : null}{order ? <><button className="secondary-action" type="button" onClick={() => { window.print(); setNotice('Đã mở bản in. Việc in không thay đổi trạng thái đơn.'); }}>▣ In phiếu</button>{canEditPickup && !editPickup ? <button className="secondary-action" type="button" disabled={busy !== null} onClick={beginPickupEdit}>✎ Sửa đơn</button> : null}{order.status === 'draft' ? <button className="primary-action" disabled={busy !== null || !cart.length} onClick={() => void action('confirm')}>✓ Chốt đơn</button> : null}{order.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('issue-stock')}>⌑ Xuất kho</button> : null}{order.status === 'confirmed' && STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('complete')}>✓ Hoàn thành</button> : null}{order.status === 'closed' && order.settlementStatus !== 'paid' ? <button className="primary-action" disabled={busy !== null} onClick={() => { setPaid(order.receivableRemainingAmount ?? order.total); setPayment(true); }}>₫ Thu tiền / Nợ</button> : null}</> : cart.length ? <button className="primary-action" type="button" disabled>Đang chuẩn bị đơn…</button> : null}</section>
      </>}

      <nav className="bottom-nav" aria-label="Điều hướng Retail"><button type="button" className={activeTab === 'entry' ? 'active' : ''} onClick={() => setActiveTab('entry')}><span>＋</span>Lên đơn</button><button type="button" className={activeTab === 'orders' ? 'active' : ''} onClick={() => setActiveTab('orders')}><span>▤</span>Đơn hàng</button>{order ? <button type="button" className="nav-new" onClick={resetEntry}><span>＋</span>Đơn mới</button> : null}</nav>

      {open ? <section className="product-sheet sheet-enter" role="dialog" aria-modal="true" aria-label="Chọn sản phẩm"><header className="sheet-header"><button className="round-icon" type="button" onClick={() => setOpen(false)} aria-label="Đóng">‹</button><div><h2>Chọn sản phẩm</h2></div><button className="round-icon scanner-button" type="button" aria-label="Quét mã sản phẩm" onClick={() => { setScannerMessage(null); setScannerOpen(true); }}>⌗</button></header><div className="search-box"><span aria-hidden="true">⌕</span><input className="product-search" autoFocus placeholder="Tìm tên, SKU, quy cách" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-tabs" ref={filterTabs} role="tablist" aria-label="Nhóm sản phẩm"><span className="filter-highlight" aria-hidden="true" style={{ transform: `translateX(${marker.left}px)`, width: marker.width }} />{[{ id: '', name: 'Tất cả' }, ...(boot?.categories ?? [])].map((category) => <button key={category.id || 'all'} className={categoryId === category.id ? 'active' : ''} type="button" role="tab" aria-selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div><div className="product-list">{products.map((product) => { const row = selected.get(product.id); const preview = prices[product.id]; const expectedKey = priceInputKey(product.id, row?.quantity ?? '1'); const price = preview?.inputKey === expectedKey ? preview : null; return <article className={`product-row lot7-product-row ${row ? 'selected' : ''}`} key={product.id}>{productPicture(product.imageKey ?? product.productCode, product.productName)}<div className="product-copy"><strong>{product.productName}</strong><small>SKU: {product.sku}</small><em>{product.unitCode}</em><b>{price ? money.format(Number(price.finalUnitPriceMinor)) : 'Đang tính giá'}</b></div>{row ? <div className="quantity-stepper"><button type="button" aria-label={`Giảm ${product.productName}`} onClick={() => adjustSelected(product, -1)}>−</button><output aria-label={`Số lượng tạm ${product.productName}`}>{row.quantity}</output><button type="button" aria-label={`Tăng ${product.productName}`} onClick={() => adjustSelected(product, 1)}>+</button></div> : <button className="add-product" type="button" aria-label={`Thêm ${product.productName}`} onClick={() => toggleProduct(product)}>+</button>}</article>; })}</div><button className="sheet-submit primary-action" type="button" disabled={!selected.size} onClick={addSelected}><span className="selection-count">{selected.size}</span> Thêm {selected.size} sản phẩm vào đơn <b aria-hidden="true">›</b></button></section> : null}
      {scannerOpen ? <section className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Quét mã sản phẩm"><div className="scanner-dialog sheet-enter"><header><div><p className="section-kicker">QUÉT MÃ</p><h2>Đưa mã vào khung hình</h2></div><button className="text-action" type="button" onClick={() => setScannerOpen(false)}>Đóng</button></header>{scannerMessage ? <p className="notice error">{scannerMessage}</p> : <video className="scanner-video" ref={videoRef} autoPlay muted playsInline />}</div></section> : null}
      {payment ? <section className="dialog-backdrop payment-screen" role="dialog" aria-modal="true" aria-label="Thu tiền"><div className="payment-dialog sheet-enter lot7-payment"><header><button className="round-icon" type="button" onClick={() => setPayment(false)} aria-label="Quay lại">‹</button><div><p className="section-kicker">THANH TOÁN</p><h2>Thu tiền / Nợ</h2></div><span /></header><div className="payment-summary"><span>Tổng thanh toán</span><strong>{money.format(Number(order?.receivableRemainingAmount ?? total))}</strong><div className="payment-balance"><span>Đã thu</span><b>{money.format(Math.max(0, total - Number(order?.receivableRemainingAmount ?? total)))}</b><span>Còn lại</span><b>{money.format(Number(order?.receivableRemainingAmount ?? total))}</b></div></div><div className="payment-methods"><button type="button" className={paymentMethod === 'CASH' ? 'active' : ''} onClick={() => setPaymentMethod('CASH')}>Tiền mặt</button><button type="button" className={paymentMethod === 'BANK_TRANSFER' ? 'active' : ''} onClick={() => setPaymentMethod('BANK_TRANSFER')}>Chuyển khoản</button></div><label>Nhập số tiền nhận<input inputMode="numeric" value={paid} onChange={(event) => setPaid(event.target.value)} /></label><div className="payment-presets">{[100000, Number(order?.receivableRemainingAmount ?? total), 150000, 200000].filter((value, index, values) => value > 0 && values.indexOf(value) === index).map((value) => <button type="button" key={value} onClick={() => setPaid(String(value))}>{money.format(value)}</button>)}</div><button className="debt-action" type="button" disabled={busy === 'settlement'} onClick={() => { setPaid('0'); void settle('0'); }}><span>Còn nợ</span><strong>{money.format(Number(order?.receivableRemainingAmount ?? total))}</strong><b>›</b></button><div className="payment-footer"><button className="secondary-action" type="button" disabled={busy === 'settlement'} onClick={() => { setPaid('0'); void settle('0'); }}>Ghi nợ</button><button className="primary-action" type="button" disabled={busy === 'settlement' || !paid.trim()} onClick={() => void settle()}>{busy === 'settlement' ? 'Đang ghi nhận…' : '✓ Hoàn tất thu tiền'}</button></div></div></section> : null}
    </main>
  );
}
