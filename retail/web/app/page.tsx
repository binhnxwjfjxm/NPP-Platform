'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Product = { id: string; productName: string; sku: string; barcode?: string | null; unitCode: string; allowsFractional: boolean | null };
type Warehouse = { id: string; code: string; name: string };
type Customer = { id: string; code: string; name: string };
type Category = { id: string; code: string; name: string };
type Settings = { defaultSalesChannelId: string | null; defaultTaxMode: 'EXCLUSIVE' | 'INCLUSIVE'; defaultTaxRate: string };
type OrderLine = { id: string; variantId: string; sku: string; itemName: string; unitCode: string; quantity: string; unitPrice: string; lineTotal: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Order = { id: string; number: string | null; status: 'draft' | 'confirmed' | 'closed' | 'cancelled'; currentVersionNumber: string; deliveryMode: string; fulfillmentStatus: string; settlementStatus: string; collectionPolicy: string; customerMode: 'WALK_IN' | 'EXISTING'; customerId: string; customerName: string; total: string; revision: string; warehouseId: string; warehouseName: string; updatedAt: string; receivableRemainingAmount?: string; versions?: { versionNumber: string; revision: string; status?: string; lines?: OrderLine[] }[] };
type CartLine = Product & { quantity: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Availability = { variantId: string; availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE'; availableQuantity: string | null };
type Bootstrap = { settings: Settings; warehouses: Warehouse[]; customers: Customer[]; categories: Category[]; orders: Order[] };
type PricePreview = { finalUnitPriceMinor: string; lineTotalMinor: string };
type RetailTab = 'entry' | 'orders';
type OrderFilter = 'all' | Order['status'];

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
  }
}

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const STOCK_ISSUED_FULFILLMENT_STATUSES = new Set(['partially_issued', 'issued', 'partially_fulfilled', 'fulfilled']);
const linesOf = (order: Order | null) => order?.versions?.find((item) => item.versionNumber === order.currentVersionNumber)?.lines ?? order?.versions?.find((item) => item.status === 'draft')?.lines ?? order?.versions?.[0]?.lines ?? [];
const cartFromOrder = (order: Order): CartLine[] => linesOf(order).map((line) => ({ id: line.variantId, productName: line.itemName, sku: line.sku, unitCode: line.unitCode, allowsFractional: null, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate }));

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

function orderLabel(order: Order) {
  if (order.status === 'closed') return order.settlementStatus === 'paid' ? 'Đã hoàn thành · Đã thu đủ' : 'Đã hoàn thành · Còn phải thu';
  if (order.status === 'confirmed') return order.fulfillmentStatus === 'issued' ? 'Đã Xuất kho' : order.fulfillmentStatus === 'fulfilled' ? 'Sẵn sàng hoàn thành' : order.fulfillmentStatus === 'partially_issued' ? 'Đang Xuất kho' : 'Đã chốt';
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
  const [activeTab, setActiveTab] = useState<RetailTab>('entry');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [editPickup, setEditPickup] = useState(false);
  const [prices, setPrices] = useState<Record<string, PricePreview>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const filterTabs = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState({ left: 0, width: 0 });
  const keys = useRef(new Map<string, string>());
  const videoRef = useRef<HTMLVideoElement>(null);

  const keyFor = useCallback((action: string) => {
    const slot = `${action}:${order?.id ?? 'new'}:${order?.revision ?? 'draft'}`;
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
    if (!order?.id || ['closed', 'cancelled'].includes(order.status)) return;
    void api<Availability[]>(`/api/retail/orders/${order.id}/availability`).then(setAvailable).catch((reason: Error) => setError(reason.message));
  }, [order?.id, order?.revision, order?.status]);

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
    if (!boot?.settings.defaultSalesChannelId || selected.size === 0) return;
    for (const row of selected.values()) {
      if (prices[row.product.id]) continue;
      void api<PricePreview>('/api/retail/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: row.product.id, quantity: row.quantity, currencyCode: 'VND', channelId: boot.settings.defaultSalesChannelId, ...(customerMode === 'EXISTING' && customerId ? { customerId } : {}) }),
      }).then((price) => setPrices((current) => ({ ...current, [row.product.id]: price }))).catch(() => undefined);
    }
  }, [boot?.settings.defaultSalesChannelId, customerId, customerMode, prices, selected]);

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
  const totalLabel = (!order && cart.length) || editingDraft ? 'Được tính khi lưu' : money.format(total);
  const stage = progressStage(order);
  const canEditPickup = order?.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus);
  const filteredOrders = orders.filter((item) => orderFilter === 'all' || item.status === orderFilter);

  function updateCartQuantity(id: string, value: string, fractional: boolean | null) {
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
    setNotice('Đã thêm sản phẩm vào đơn.');
  }

  function orderPayload() {
    if (!boot?.settings.defaultSalesChannelId) throw new Error('Công Ty chưa cấu hình kênh bán mặc định.');
    if (!warehouseId) throw new Error('Hãy chọn kho bán.');
    if (!cart.length) throw new Error('Hãy chọn ít nhất một sản phẩm.');
    return { sourceType: 'MANUAL', customerMode, ...(customerMode === 'EXISTING' ? { customerId } : {}), warehouseId, salesChannelId: boot.settings.defaultSalesChannelId, deliveryMode: 'PICKUP', collectionPolicy: policy, currency: 'VND', ...(order ? { expectedRevision: order.revision } : {}), lines: cart.map((line) => ({ variantId: line.id, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate, ...(prices[line.id] ? { expectedSystemUnitPriceMinor: prices[line.id].finalUnitPriceMinor } : {}) })) };
  }

  async function save() {
    setBusy('save'); setError(null);
    try {
      const payload = orderPayload();
      const next = order
        ? await api<Order>(`/api/retail/orders/${order.id}/${editPickup ? 'pickup-edit' : 'draft'}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor(editPickup ? 'pickup-edit' : 'save-draft') }, body: JSON.stringify(payload) })
        : await api<Order>('/api/retail/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('create-draft') }, body: JSON.stringify(payload) });
      setOrder(next); setCart([]); setEditPickup(false); setNotice(order ? 'Đã lưu thay đổi đơn và giữ nguyên trạng thái Đã chốt.' : 'Đã lập đơn tại quầy.');
      await refreshOrders();
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
      setNotice(kind === 'confirm' ? 'Đơn đã được chốt.' : kind === 'issue-stock' ? 'Đã Xuất kho theo luồng Giao tại quầy.' : 'Đơn đã hoàn thành.');
      await refreshOrders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể thực hiện thao tác.'); }
    finally { setBusy(null); }
  }

  async function settle(amount = paid) {
    if (!order) return;
    setBusy('settlement'); setError(null);
    try {
      const next = await api<Order>(`/api/retail/orders/${order.id}/settlement`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('settlement') }, body: JSON.stringify({ expectedRevision: order.revision, paidAmount: amount }) });
      setOrder(next); setPayment(false); setNotice('Đã ghi nhận thanh toán theo khoản phải thu của đơn.');
      await refreshOrders();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể ghi nhận thanh toán.'); }
    finally { setBusy(null); }
  }

  async function openOrder(id: string) {
    setError(null);
    try {
      const next = await api<Order>(`/api/retail/orders/${id}`);
      setOrder(next); setCustomerMode(next.customerMode); setCustomerId(next.customerId); setWarehouseId(next.warehouseId); setPolicy(next.collectionPolicy); setCart(next.status === 'draft' ? cartFromOrder(next) : []); setEditPickup(false); setActiveTab('entry');
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
    setNotice('Có thể sửa đơn đến trước khi Xuất kho.');
  }

  function resetEntry() {
    setOrder(null); setCart([]); setEditPickup(false); setAvailable([]); setNotice(null); setError(null); setActiveTab('entry');
  }

  return (
    <main className="retail-shell">
      <header className="retail-header retail-topbar">
        <button className="round-icon" type="button" aria-label="Quay lại" onClick={() => activeTab === 'orders' ? setActiveTab('entry') : window.history.back()}>‹</button>
        <div className="retail-title"><p className="brand-kicker">HƯNG PHÁT</p><h1>{activeTab === 'orders' ? 'Đơn hàng' : order ? 'Chi tiết đơn' : 'Lên đơn'}</h1></div>
        <form action="/api/auth/logout" method="post"><button className="round-icon" aria-label="Đăng xuất">↗</button></form>
      </header>
      {error ? <p className="notice error" role="alert">{error}</p> : null}{notice ? <p className="notice" role="status">{notice}</p> : null}

      {activeTab === 'orders' ? <section className="orders-workspace" aria-label="Đơn Giao tại quầy">
        <header className="orders-heading"><div><p className="section-kicker">GIAO TẠI QUẦY</p><h2>Đơn đã lập</h2></div><button className="text-action" type="button" onClick={() => void refreshOrders()}>Tải lại</button></header>
        <div className="status-filter" role="tablist" aria-label="Lọc trạng thái đơn">{([{ id: 'all', label: 'Tất cả' }, { id: 'draft', label: 'Đang lập' }, { id: 'confirmed', label: 'Đã chốt' }, { id: 'closed', label: 'Hoàn thành' }, { id: 'cancelled', label: 'Đã hủy' }] as { id: OrderFilter; label: string }[]).map((item) => <button type="button" role="tab" aria-selected={orderFilter === item.id} className={orderFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setOrderFilter(item.id)}>{item.label}</button>)}</div>
        <div className="order-history">{filteredOrders.map((item) => <button className="history-row" type="button" key={item.id} onClick={() => void openOrder(item.id)}><span className="history-icon">▤</span><span><strong>{item.number ?? 'Đơn nháp'}</strong><small>{item.customerName} · {item.warehouseName}</small><em>{dateLabel(item.updatedAt)}</em></span><b>{orderLabel(item)} ›</b></button>)}{filteredOrders.length === 0 ? <p className="empty-cart">Chưa có đơn phù hợp.</p> : null}</div>
      </section> : <>
        <section className="order-card retail-order-card">
          {order ? <div className="order-identity"><span className="order-document" aria-hidden="true">▤</span><div><p className="section-kicker">ĐƠN BÁN HÀNG</p><h2>{order.number ?? 'Đơn đang lập'}</h2><p>{orderLabel(order)} · {dateLabel(order.updatedAt)}</p></div><span className="mode-pill">Giao tại quầy</span></div> : <div className="section-title"><div><p className="section-kicker">ĐƠN BÁN HÀNG</p><h2>Lên đơn nhanh</h2></div><span className="mode-pill">Giao tại quầy</span></div>}
          {order ? <div className="order-facts"><span>Khách hàng <strong>{order.customerName}</strong></span><span>Kho bán <strong>{order.warehouseName}</strong></span></div> : null}
          {order && order.status !== 'cancelled' ? <ol className="order-timeline" aria-label="Tiến trình đơn hàng">{['Lên đơn', 'Đã chốt', 'Xuất kho', 'Hoàn thành'].map((step, index) => <li className={index <= stage ? 'complete' : ''} key={step}><span>{index < stage ? '✓' : index + 1}</span><strong>{step}</strong></li>)}</ol> : null}
          {editable ? <div className="order-fields order-choice-cards"><label><span>Khách hàng</span><select value={customerMode} onChange={(event) => setCustomerMode(event.target.value as 'WALK_IN' | 'EXISTING')}><option value="WALK_IN">Khách lẻ</option><option value="EXISTING">Khách hàng Công Ty</option></select></label>{customerMode === 'EXISTING' ? <label><span>Chọn khách hàng</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Chọn khách hàng</option>{boot?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label> : null}<label><span>Kho bán</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho</option>{boot?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label><label><span>Thanh toán</span><select value={policy} onChange={(event) => setPolicy(event.target.value)}><option value="COLLECT_ON_DELIVERY">Thu khi nhận hàng</option><option value="PREPAID">Đã trả trước</option>{customerMode === 'EXISTING' ? <><option value="COLLECT_AFTER_DELIVERY">Giao trước, thu sau</option><option value="CREDIT_TERMS">Bán chịu</option></> : null}</select></label></div> : null}
          {editable ? <button className="choose-products" type="button" onClick={() => setOpen(true)}><span aria-hidden="true">＋</span><strong>Chọn sản phẩm</strong><b aria-hidden="true">›</b></button> : null}
          {editPickup ? <p className="edit-hint">Đơn đang được điều chỉnh. Lưu thay đổi sẽ tạo bản điều chỉnh và giữ lại trạng thái Đã chốt.</p> : null}
          <div className="cart-list" aria-live="polite">{order && !editingDraft ? lineItems.map((line) => <article className="cart-row cart-row-saved" key={line.id}><span className="product-symbol product-symbol-large" aria-hidden="true">{line.itemName.slice(0, 1)}</span><div className="line-main"><strong>{line.itemName}</strong><span>SKU: {line.sku}</span><em>▣ {line.unitCode}</em><small>Khả dụng {availabilityLabel(byVariant.get(line.variantId))}</small></div><dl><div><dt>Số lượng</dt><dd>{line.quantity}</dd></div><div><dt>Đơn giá</dt><dd>{money.format(Number(line.unitPrice))}</dd></div><div><dt>Thành tiền</dt><dd>{money.format(Number(line.lineTotal))}</dd></div></dl></article>) : cart.map((line) => <article className="cart-row editable" key={line.id}><span className="product-symbol product-symbol-large" aria-hidden="true">{line.productName.slice(0, 1)}</span><div className="line-main"><strong>{line.productName}</strong><span>SKU: {line.sku}</span><em>▣ {line.unitCode}</em><small>Khả dụng {order ? availabilityLabel(byVariant.get(line.id)) : '—'}</small></div><div className="quantity-stepper" aria-label={`Số lượng ${line.productName}`}><button type="button" onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) - 1), line.allowsFractional)}>−</button><input inputMode="decimal" aria-label={`Nhập số lượng ${line.productName}`} value={line.quantity} onChange={(event) => updateCartQuantity(line.id, event.target.value, line.allowsFractional)} /><button type="button" onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) + 1), line.allowsFractional)}>+</button></div><dl><div><dt>Đơn giá</dt><dd>{prices[line.id] ? money.format(Number(prices[line.id].finalUnitPriceMinor)) : 'Tính khi lưu'}</dd></div></dl><button className="remove-line" type="button" onClick={() => setCart((rows) => rows.filter((row) => row.id !== line.id))} aria-label={`Xóa ${line.productName}`}>⌫</button></article>)}{(!order || editingDraft) && !cart.length ? <p className="empty-cart">Chưa có sản phẩm. Chọn nhiều sản phẩm rồi thêm vào giỏ trong một lần.</p> : null}</div>
          <footer className="order-total"><span>Tổng cộng</span><strong>{totalLabel}</strong></footer>
        </section>
        <section className="order-action-bar" aria-label="Thao tác đơn">{editable ? <button className="secondary-action" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Đang lưu…' : editPickup ? 'Lưu thay đổi' : order ? 'Lưu thay đổi' : 'Lập đơn'}</button> : null}{order ? <><button className="secondary-action" type="button" onClick={() => { window.print(); setNotice('Đã mở bản in. Việc in không thay đổi trạng thái đơn.'); }}>▣ In phiếu</button>{canEditPickup && !editPickup ? <button className="secondary-action" type="button" disabled={busy !== null} onClick={beginPickupEdit}>✎ Sửa đơn</button> : null}{order.status === 'draft' ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('confirm')}>✓ Chốt đơn</button> : null}{order.status === 'confirmed' && !['issued', 'fulfilled'].includes(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('issue-stock')}>⌑ Xuất kho</button> : null}{order.status === 'confirmed' && ['issued', 'fulfilled'].includes(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('complete')}>✓ Hoàn thành</button> : null}{order.status === 'closed' && order.settlementStatus !== 'paid' ? <button className="primary-action" disabled={busy !== null} onClick={() => { setPaid(order.receivableRemainingAmount ?? order.total); setPayment(true); }}>₫ Thu tiền / Nợ</button> : null}</> : null}</section>
      </>}

      <nav className="bottom-nav" aria-label="Điều hướng Retail"><button type="button" className={activeTab === 'entry' ? 'active' : ''} onClick={() => setActiveTab('entry')}><span>＋</span>Lên đơn</button><button type="button" className={activeTab === 'orders' ? 'active' : ''} onClick={() => setActiveTab('orders')}><span>▤</span>Đơn hàng</button>{order ? <button type="button" className="nav-new" onClick={resetEntry}><span>＋</span>Đơn mới</button> : null}</nav>

      {open ? <section className="product-sheet sheet-enter" role="dialog" aria-modal="true" aria-label="Chọn sản phẩm"><header className="sheet-header"><button className="round-icon" type="button" onClick={() => setOpen(false)} aria-label="Đóng">‹</button><div><h2>Chọn sản phẩm</h2><p>Tìm nhanh và chọn nhiều mã trong một lần</p></div><button className="round-icon scanner-button" type="button" aria-label="Quét mã sản phẩm" onClick={() => { setScannerMessage(null); setScannerOpen(true); }}>⌗</button></header><div className="search-box"><span aria-hidden="true">⌕</span><input className="product-search" autoFocus placeholder="Tìm tên, SKU, quy cách" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-tabs" ref={filterTabs} role="tablist" aria-label="Nhóm sản phẩm"><span className="filter-highlight" aria-hidden="true" style={{ transform: `translateX(${marker.left}px)`, width: marker.width }} />{[{ id: '', name: 'Tất cả' }, ...(boot?.categories ?? [])].map((category) => <button key={category.id || 'all'} className={categoryId === category.id ? 'active' : ''} type="button" role="tab" aria-selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div><div className="product-list">{products.map((product) => { const row = selected.get(product.id); const price = prices[product.id]; return <article className={`product-row ${row ? 'selected' : ''}`} key={product.id}><span className="product-symbol product-symbol-large" aria-hidden="true">{product.productName.slice(0, 1)}</span><div className="product-copy"><strong>{product.productName}</strong><small>SKU: {product.sku}</small><em>▣ {product.unitCode}</em>{price ? <b>{money.format(Number(price.finalUnitPriceMinor))}</b> : null}</div>{row ? <div className="quantity-stepper"><button type="button" aria-label={`Giảm ${product.productName}`} onClick={() => adjustSelected(product, -1)}>−</button><output aria-label={`Số lượng tạm ${product.productName}`}>{row.quantity}</output><button type="button" aria-label={`Tăng ${product.productName}`} onClick={() => adjustSelected(product, 1)}>+</button></div> : <button className="add-product" type="button" aria-label={`Thêm ${product.productName}`} onClick={() => toggleProduct(product)}>+</button>}</article>; })}</div><button className="sheet-submit primary-action" type="button" disabled={!selected.size} onClick={addSelected}><span className="selection-count">{selected.size}</span> Thêm {selected.size} sản phẩm vào đơn <b aria-hidden="true">›</b></button></section> : null}
      {scannerOpen ? <section className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Quét mã sản phẩm"><div className="scanner-dialog sheet-enter"><header><div><p className="section-kicker">QUÉT MÃ</p><h2>Đưa mã vào khung hình</h2></div><button className="text-action" type="button" onClick={() => setScannerOpen(false)}>Đóng</button></header>{scannerMessage ? <p className="notice error">{scannerMessage}</p> : <video className="scanner-video" ref={videoRef} autoPlay muted playsInline />}</div></section> : null}
      {payment ? <section className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Thu tiền"><div className="payment-dialog sheet-enter"><header><div><p className="section-kicker">THANH TOÁN</p><h2>Thu tiền / Nợ</h2></div><button className="text-action" type="button" onClick={() => setPayment(false)}>Đóng</button></header><div className="payment-summary"><span>Tổng thanh toán</span><strong>{money.format(total)}</strong><p>Nhập số tiền thực thu. Nhập thấp hơn tổng tiền sẽ giữ phần còn lại là khoản phải thu.</p></div><label>Số tiền thực thu<input inputMode="numeric" value={paid} onChange={(event) => setPaid(event.target.value)} /></label><div className="payment-presets">{[Number(order?.receivableRemainingAmount ?? total), total, Math.floor(total / 2)].filter((value, index, values) => value > 0 && values.indexOf(value) === index).map((value) => <button type="button" key={value} onClick={() => setPaid(String(value))}>{money.format(value)}</button>)}</div><div><button className="secondary-action" type="button" onClick={() => { setPaid('0'); void settle('0'); }}>Ghi nợ</button><button className="primary-action" type="button" disabled={busy === 'settlement'} onClick={() => void settle()}>{busy === 'settlement' ? 'Đang ghi nhận…' : 'Hoàn tất thu tiền'}</button></div></div></section> : null}
    </main>
  );
}
