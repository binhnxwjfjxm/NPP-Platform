'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Product = { id: string; productName: string; sku: string; unitCode: string; allowsFractional: boolean | null };
type Warehouse = { id: string; code: string; name: string };
type Customer = { id: string; code: string; name: string };
type Category = { id: string; code: string; name: string };
type Settings = { defaultSalesChannelId: string | null; defaultTaxMode: 'EXCLUSIVE' | 'INCLUSIVE'; defaultTaxRate: string };
type OrderLine = { id: string; variantId: string; sku: string; itemName: string; unitCode: string; quantity: string; unitPrice: string; lineTotal: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Order = { id: string; number: string | null; status: 'draft' | 'confirmed' | 'closed' | 'cancelled'; currentVersionNumber: string; deliveryMode: string; fulfillmentStatus: string; settlementStatus: string; collectionPolicy: string; customerMode: 'WALK_IN' | 'EXISTING'; customerId: string; total: string; revision: string; customerName: string; warehouseId: string; warehouseName: string; updatedAt: string; versions?: { versionNumber: string; revision: string; lines?: OrderLine[] }[] };
type CartLine = Product & { quantity: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Availability = { variantId: string; availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE'; availableQuantity: string | null };
type Bootstrap = { settings: Settings; warehouses: Warehouse[]; customers: Customer[]; categories: Category[]; orders: Order[] };

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const linesOf = (order: Order | null) => order?.versions?.find((item) => item.versionNumber === order.currentVersionNumber)?.lines ?? order?.versions?.[0]?.lines ?? [];
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
  if (order.status === 'confirmed') return order.fulfillmentStatus === 'issued' ? 'Đã Xuất kho' : order.fulfillmentStatus === 'fulfilled' ? 'Sẵn sàng hoàn thành' : 'Đã chốt';
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
  if (order.status === 'confirmed' && ['issued', 'fulfilled'].includes(order.fulfillmentStatus)) return 2;
  if (order.status === 'confirmed') return 1;
  return 0;
}

export default function RetailHomePage() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
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
  const [filterMarker, setFilterMarker] = useState({ left: 0, width: 0 });
  const keys = useRef(new Map<string, string>());
  const filterTabs = useRef<HTMLDivElement>(null);

  const keyFor = useCallback((action: string) => {
    const slot = `${action}:${order?.id ?? 'new'}:${order?.revision ?? 'draft'}`;
    const existing = keys.current.get(slot);
    if (existing) return existing;
    const next = createIdempotencyKey(`retail-${action}`);
    keys.current.set(slot, next);
    return next;
  }, [order?.id, order?.revision]);

  useEffect(() => {
    void api<Bootstrap>('/api/retail/bootstrap').then((data) => {
      setBoot(data);
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
      if (active) setFilterMarker({ left: active.offsetLeft, width: active.offsetWidth });
    };
    const frame = requestAnimationFrame(syncMarker);
    window.addEventListener('resize', syncMarker);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', syncMarker); };
  }, [open, categoryId, boot?.categories.length]);

  const byVariant = useMemo(() => new Map(available.map((item) => [item.variantId, item])), [available]);
  const lineItems = linesOf(order);
  const editable = !order || order.status === 'draft';
  const editingDraft = editable && cart.length > 0;
  const total = order ? Number(order.total || 0) : 0;
  const totalLabel = (!order && cart.length) || editingDraft ? 'Được tính khi lưu' : money.format(total);
  const stage = progressStage(order);

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
      const seeded = current.length ? current : order?.status === 'draft' ? cartFromOrder(order) : current;
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
    return { sourceType: 'MANUAL', customerMode, ...(customerMode === 'EXISTING' ? { customerId } : {}), warehouseId, salesChannelId: boot.settings.defaultSalesChannelId, deliveryMode: 'PICKUP', collectionPolicy: policy, currency: 'VND', ...(order ? { expectedRevision: order.revision } : {}), lines: cart.map((line) => ({ variantId: line.id, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate })) };
  }

  async function save() {
    setBusy('save'); setError(null);
    try {
      const next = order
        ? await api<Order>(`/api/retail/orders/${order.id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('save-draft') }, body: JSON.stringify(orderPayload()) })
        : await api<Order>('/api/retail/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('create-draft') }, body: JSON.stringify(orderPayload()) });
      setOrder(next); setCart([]); setNotice(order ? 'Đã lưu thay đổi đơn.' : 'Đã lập đơn tại quầy.');
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể thực hiện thao tác.'); }
    finally { setBusy(null); }
  }

  async function settle() {
    if (!order) return;
    setBusy('settlement');
    try {
      const next = await api<Order>(`/api/retail/orders/${order.id}/settlement`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('settlement') }, body: JSON.stringify({ expectedRevision: order.revision, paidAmount: paid }) });
      setOrder(next); setPayment(false); setNotice('Đã ghi nhận thanh toán theo khoản phải thu của đơn.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa thể ghi nhận thanh toán.'); }
    finally { setBusy(null); }
  }

  function printOrder() { window.print(); setNotice('Đã mở bản in. Việc in không thay đổi trạng thái đơn.'); }

  return (
    <main className="retail-shell">
      <header className="retail-header retail-topbar"><button className="round-icon" type="button" aria-label="Quay lại" onClick={() => window.history.back()}>‹</button><div className="retail-title"><p className="brand-kicker">HƯNG PHÁT</p><h1>{order ? 'Chi tiết đơn' : 'Lên đơn'}</h1></div><form action="/api/auth/logout" method="post"><button className="round-icon" aria-label="Đăng xuất">↗</button></form></header>
      {error ? <p className="notice error" role="alert">{error}</p> : null}{notice ? <p className="notice" role="status">{notice}</p> : null}
      <section className="order-card retail-order-card">
        {order ? <div className="order-identity"><span className="order-document" aria-hidden="true">▤</span><div><p className="section-kicker">ĐƠN BÁN HÀNG</p><h2>{order.number ?? 'Đơn đang lập'}</h2><p>{orderLabel(order)}</p></div><span className="mode-pill">Giao tại quầy</span></div> : <div className="section-title"><div><p className="section-kicker">ĐƠN BÁN HÀNG</p><h2>Lên đơn nhanh</h2></div><span className="mode-pill">Giao tại quầy</span></div>}
        {order ? <ol className="order-timeline" aria-label="Tiến trình đơn hàng">{['Lên đơn', 'Đã chốt', 'Xuất kho', 'Hoàn thành'].map((step, index) => <li className={index <= stage ? 'complete' : ''} key={step}><span>{index < stage ? '✓' : index + 1}</span><strong>{step}</strong></li>)}</ol> : null}
        {editable ? <div className="order-fields order-choice-cards"><label><span>Khách hàng</span><select value={customerMode} onChange={(event) => setCustomerMode(event.target.value as 'WALK_IN' | 'EXISTING')}><option value="WALK_IN">Khách lẻ</option><option value="EXISTING">Khách hàng Công Ty</option></select></label>{customerMode === 'EXISTING' ? <label><span>Chọn khách hàng</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Chọn khách hàng</option>{boot?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label> : null}<label><span>Kho bán</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Chọn kho</option>{boot?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label><label><span>Thanh toán</span><select value={policy} onChange={(event) => setPolicy(event.target.value)}><option value="COLLECT_ON_DELIVERY">Thu khi nhận hàng</option><option value="PREPAID">Đã trả trước</option>{customerMode === 'EXISTING' ? <><option value="COLLECT_AFTER_DELIVERY">Giao trước, thu sau</option><option value="CREDIT_TERMS">Bán chịu</option></> : null}</select></label></div> : null}
        {editable ? <button className="choose-products" type="button" onClick={() => setOpen(true)}><span aria-hidden="true">＋</span><strong>Chọn sản phẩm</strong><b aria-hidden="true">›</b></button> : null}
        {order?.status === 'confirmed' && stage < 2 ? <p className="edit-hint">ⓘ Anh vẫn có thể sửa đơn trước khi Xuất kho.</p> : null}
        <div className="cart-list" aria-live="polite">{order && !editingDraft ? lineItems.map((line) => <article className="cart-row cart-row-saved" key={line.id}><span className="product-symbol product-symbol-large" aria-hidden="true">{line.itemName.slice(0, 1)}</span><div className="line-main"><strong>{line.itemName}</strong><span>SKU: {line.sku}</span><em>▣ {line.unitCode}</em><small>Khả dụng {availabilityLabel(byVariant.get(line.variantId))}</small></div><dl><div><dt>Số lượng</dt><dd>{line.quantity}</dd></div><div><dt>Đơn giá</dt><dd>{money.format(Number(line.unitPrice))}</dd></div><div><dt>Thành tiền</dt><dd>{money.format(Number(line.lineTotal))}</dd></div></dl></article>) : cart.map((line) => <article className="cart-row editable" key={line.id}><span className="product-symbol product-symbol-large" aria-hidden="true">{line.productName.slice(0, 1)}</span><div className="line-main"><strong>{line.productName}</strong><span>SKU: {line.sku}</span><em>▣ {line.unitCode}</em><small>Khả dụng {order ? availabilityLabel(byVariant.get(line.id)) : '—'}</small></div><div className="quantity-stepper" aria-label={`Số lượng ${line.productName}`}><button type="button" onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) - 1), line.allowsFractional)}>−</button><input inputMode="decimal" aria-label={`Nhập số lượng ${line.productName}`} value={line.quantity} onChange={(event) => updateCartQuantity(line.id, event.target.value, line.allowsFractional)} /><button type="button" onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) + 1), line.allowsFractional)}>+</button></div><dl><div><dt>Đơn giá</dt><dd>Được tính khi lưu</dd></div></dl><button className="remove-line" type="button" onClick={() => setCart((rows) => rows.filter((row) => row.id !== line.id))} aria-label={`Xóa ${line.productName}`}>⌫</button></article>)}{(!order || editingDraft) && !cart.length ? <p className="empty-cart">Chưa có sản phẩm. Chọn nhiều sản phẩm rồi thêm vào giỏ trong một lần.</p> : null}</div>
        <footer className="order-total"><span>Tổng cộng</span><strong>{totalLabel}</strong></footer>
        <div className="actions retail-actions">{editable ? <button className="secondary-action" type="button" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Đang lưu…' : order ? 'Lưu thay đổi' : 'Lập đơn'}</button> : null}{order ? <><button className="secondary-action" type="button" onClick={printOrder}>▣ In phiếu</button>{order.status === 'draft' ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('confirm')}>✓ Chốt đơn</button> : null}{order.status === 'confirmed' && !['issued', 'fulfilled'].includes(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('issue-stock')}>⌑ Xuất kho</button> : null}{order.status === 'confirmed' && ['issued', 'fulfilled'].includes(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('complete')}>✓ Hoàn thành</button> : null}{order.status === 'closed' && order.settlementStatus !== 'paid' ? <button className="primary-action" disabled={busy !== null} onClick={() => { setPaid(order.total); setPayment(true); }}>Thu tiền / Nợ</button> : null}</> : null}</div>
      </section>
      <section className="recent-card"><div className="section-title"><div><p className="section-kicker">GẦN ĐÂY</p><h2>Đơn Giao tại quầy</h2></div></div>{boot?.orders.filter((item) => item.deliveryMode === 'PICKUP').slice(0, 6).map((item) => <button className="recent-row" type="button" key={item.id} onClick={() => { void api<Order>(`/api/retail/orders/${item.id}`).then((next) => { setOrder(next); setCustomerMode(next.customerMode); setCustomerId(next.customerId); setWarehouseId(next.warehouseId); setPolicy(next.collectionPolicy); setCart(next.status === 'draft' ? cartFromOrder(next) : []); }).catch((reason: Error) => setError(reason.message)); }}><span><strong>{item.number ?? 'Đơn nháp'}</strong><small>{item.customerName}</small></span><em>{orderLabel(item)}</em></button>)}</section>
      {open ? <section className="product-sheet sheet-enter" role="dialog" aria-modal="true" aria-label="Chọn sản phẩm"><header className="sheet-header"><button className="round-icon" type="button" onClick={() => setOpen(false)} aria-label="Đóng">‹</button><div><h2>Chọn sản phẩm</h2><p>Tìm nhanh và chọn nhiều mã trong một lần</p></div><span className="round-icon" aria-hidden="true">⌕</span></header><div className="search-box"><span aria-hidden="true">⌕</span><input className="product-search" autoFocus placeholder="Tìm tên, SKU, quy cách" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-tabs" ref={filterTabs} role="tablist" aria-label="Nhóm sản phẩm"><span className="filter-highlight" aria-hidden="true" style={{ transform: `translateX(${filterMarker.left}px)`, width: filterMarker.width }} />{[{ id: '', name: 'Tất cả' }, ...(boot?.categories ?? [])].map((category) => <button key={category.id || 'all'} className={categoryId === category.id ? 'active' : ''} type="button" role="tab" aria-selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div><div className="product-list">{products.map((product) => { const row = selected.get(product.id); return <article className={`product-row ${row ? 'selected' : ''}`} key={product.id}><span className="product-symbol product-symbol-large" aria-hidden="true">{product.productName.slice(0, 1)}</span><div className="product-copy"><strong>{product.productName}</strong><small>SKU: {product.sku}</small><em>▣ {product.unitCode}</em></div>{row ? <div className="quantity-stepper"><button type="button" aria-label={`Giảm ${product.productName}`} onClick={() => adjustSelected(product, -1)}>−</button><output aria-label={`Số lượng tạm ${product.productName}`}>{row.quantity}</output><button type="button" aria-label={`Tăng ${product.productName}`} onClick={() => adjustSelected(product, 1)}>+</button></div> : <button className="add-product" type="button" aria-label={`Thêm ${product.productName}`} onClick={() => toggleProduct(product)}>+</button>}</article>; })}</div><button className="sheet-submit primary-action" type="button" disabled={!selected.size} onClick={addSelected}><span className="selection-count">{selected.size}</span> Thêm {selected.size} sản phẩm vào đơn <b aria-hidden="true">›</b></button></section> : null}
      {payment ? <section className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Thu tiền"><div className="payment-dialog sheet-enter"><header><div><p className="section-kicker">THANH TOÁN</p><h2>Thu tiền / Nợ</h2></div><button className="text-action" type="button" onClick={() => setPayment(false)}>Đóng</button></header><div className="payment-summary"><span>Tổng thanh toán</span><strong>{money.format(total)}</strong><p>Thu tiền tách riêng khỏi Hoàn thành đơn.</p></div><label>Số tiền thực thu<input inputMode="numeric" value={paid} onChange={(event) => setPaid(event.target.value)} /></label><div className="payment-presets">{[total, Math.floor(total / 2)].filter((value, index, values) => value > 0 && values.indexOf(value) === index).map((value) => <button type="button" key={value} onClick={() => setPaid(String(value))}>{money.format(value)}</button>)}</div><div><button className="secondary-action" type="button" onClick={() => setPayment(false)}>Để sau</button><button className="primary-action" type="button" disabled={busy === 'settlement'} onClick={() => void settle()}>{busy === 'settlement' ? 'Đang ghi nhận…' : 'Ghi nhận'}</button></div></div></section> : null}
    </main>
  );
}
