'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Product = { id: string; productCode: string; imageKey?: string | null; productName: string; sku: string; barcode?: string | null; unitCode: string; allowsFractional: boolean | null };
type OrderLine = { id: string; variantId: string; sku: string; itemName: string; unitCode: string; quantity: string; unitPrice: string; lineTotal: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Order = { id: string; number: string | null; status: 'draft' | 'confirmed' | 'closed' | 'cancelled'; currentVersionNumber: string; deliveryMode: string; fulfillmentStatus: string; settlementStatus: string; collectionPolicy: string; customerMode: 'WALK_IN' | 'EXISTING'; customerId: string; customerName: string; total: string; revision: string; warehouseId: string; warehouseName: string; salesChannelCode?: string | null; salesChannelName?: string | null; updatedAt: string; receivableRemainingAmount?: string; versions?: { versionNumber: string; revision: string; status?: string; lines?: OrderLine[] }[] };
type CartLine = Product & { quantity: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; taxRate: string };
type Availability = { variantId: string; availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE'; availableQuantity: string | null };
type Bootstrap = { settings: { defaultTaxMode: 'EXCLUSIVE' | 'INCLUSIVE'; defaultTaxRate: string }; warehouses: { id: string; code: string; name: string }[]; customers: { id: string; code: string; name: string }[]; categories: { id: string; code: string; name: string }[]; orders: Order[] };
type PricePreview = { finalUnitPriceMinor: string; lineTotalMinor: string; resolutionFingerprint?: string; channelCode?: string };
type CachedPricePreview = PricePreview & { inputKey: string };
type RetailTab = 'home' | 'entry' | 'orders' | 'settings';
type OrderFilter = 'all' | 'draft' | 'confirmed' | 'issued' | 'closed' | 'cancelled';
type PaymentMethod = 'CASH' | 'BANK_TRANSFER';
type PrintPaper = 'A4' | 'A5' | '80mm' | '58mm';
type PrintTemplate = { documentType: string; templateCode: string; name: string; pageSize: 'A4' | 'A5'; visibleFieldKeys: string[]; fields?: { key: string; label: string; defaultSelected: boolean }[]; heading?: string | null; title?: string | null; subtitle?: string | null; isCustomized?: boolean; updatedAt?: string | null };
type ApiErrorShape = { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> };

declare global { interface Window { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> }; } }

class RetailApiError extends Error {
  readonly code: string; readonly retryable: boolean; readonly details: Record<string, unknown>; readonly status: number;
  constructor(error: ApiErrorShape | undefined, status: number) {
    super(error?.message ?? 'Không thể thực hiện thao tác');
    this.name = 'RetailApiError';
    this.code = error?.code ?? 'RETAIL_REQUEST_FAILED';
    this.retryable = error?.retryable === true;
    this.details = error?.details ?? {};
    this.status = status;
  }
}

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const quantityNumber = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 });
const PRODUCT_IMAGE_BASE = 'https://pub-7d2987fab97d4e3ebb2021a823973862.r2.dev/app-customer/products';
const PRINT_PAPER_STORAGE_KEY = 'retail.print.paper';
const PRINT_TEMPLATE_STORAGE_KEY = 'retail.print.template';
const STOCK_ISSUED_FULFILLMENT_STATUSES = new Set(['partially_issued', 'issued', 'partially_fulfilled', 'fulfilled']);
const linesOf = (order: Order | null) => order?.versions?.find((item) => item.versionNumber === order.currentVersionNumber)?.lines ?? order?.versions?.find((item) => item.status === 'draft')?.lines ?? order?.versions?.[0]?.lines ?? [];
const cartFromOrder = (order: Order): CartLine[] => linesOf(order).map((line) => ({ id: line.variantId, productCode: line.sku, imageKey: null, productName: line.itemName, sku: line.sku, unitCode: line.unitCode, allowsFractional: null, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate }));

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null) as { data?: T; error?: ApiErrorShape } | null;
  if (!response.ok || payload?.error) throw new RetailApiError(payload?.error, response.status);
  return payload?.data as T;
}

function normalizedQuantity(value: string, fractional: boolean | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return fractional ? String(Math.min(n, 999999)) : String(Math.max(1, Math.trunc(n)));
}
function productImage(key?: string | null) { const value = String(key ?? '').trim(); return value ? `${PRODUCT_IMAGE_BASE}/${encodeURIComponent(value)}.webp` : ''; }
function orderLabel(order: Order) { if (order.status === 'closed') return order.settlementStatus === 'paid' ? 'Đã hoàn thành · Đã thu đủ' : 'Đã hoàn thành · Còn phải thu'; if (order.status === 'confirmed') return STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus) ? 'Đã xuất kho' : 'Đã chốt'; if (order.status === 'cancelled') return 'Đã hủy'; return 'Đang lập'; }
function formatQuantity(value: string | number | null | undefined) { const number = Number(value); return Number.isFinite(number) ? quantityNumber.format(number) : '—'; }
function availabilityLabel(row: Availability | undefined, loading = false) { if (loading) return 'Đang tính'; if (!row) return 'Đang tải'; if (row.availabilityStatus === 'NOT_APPLICABLE') return 'Không áp dụng'; if (row.availabilityStatus === 'UNAVAILABLE') return 'Không đủ'; return formatQuantity(row.availableQuantity); }
function progressStage(order: Order | null) { if (!order) return 0; if (order.status === 'closed') return 3; if (order.status === 'confirmed' && STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus)) return 2; if (order.status === 'confirmed') return 1; return 0; }
function dateLabel(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }); }
function errorMessage(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback; }
function isRevisionConflict(reason: unknown) { return reason instanceof RetailApiError && (reason.code.includes('CONFLICT') || typeof reason.details.currentRevision === 'string'); }
function isShortage(row: Availability | undefined, requested: string) { if (!row || row.availabilityStatus === 'NOT_APPLICABLE') return false; if (row.availabilityStatus === 'UNAVAILABLE') return true; const available = Number(row.availableQuantity); const quantity = Number(requested); return Number.isFinite(available) && Number.isFinite(quantity) && available < quantity; }
function safePaper(value: string | null): PrintPaper | null { return value === 'A4' || value === 'A5' || value === '80mm' || value === '58mm' ? value : null; }

export default function RetailWorkspace() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [available, setAvailable] = useState<Availability[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
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
  const [activeTab, setActiveTab] = useState<RetailTab>('home');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [editPickup, setEditPickup] = useState(false);
  const [prices, setPrices] = useState<Record<string, CachedPricePreview>>({});
  const [lineImages, setLineImages] = useState<Record<string, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [printTemplates, setPrintTemplates] = useState<PrintTemplate[]>([]);
  const [printTemplate, setPrintTemplate] = useState<PrintTemplate | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printPaper, setPrintPaper] = useState<PrintPaper>('A4');
  const [templateHeading, setTemplateHeading] = useState('');
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateSubtitle, setTemplateSubtitle] = useState('');
  const filterTabs = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState({ left: 0, width: 0 });
  const keys = useRef(new Map<string, string>());
  const operationKeys = useRef(new Map<string, string>());
  const lastDraftFingerprint = useRef('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const keyFor = useCallback((action: string, fingerprint = '') => {
    const slot = `${action}:${order?.id ?? 'new'}:${order?.revision ?? 'draft'}:${fingerprint}`;
    const current = keys.current.get(slot);
    if (current) return current;
    const next = createIdempotencyKey(`retail-${action}`);
    keys.current.set(slot, next);
    return next;
  }, [order?.id, order?.revision]);
  const operationKeyFor = useCallback((action: string, intent = 'default') => {
    const slot = `${action}:${order?.id ?? 'new'}:${intent}`;
    const current = operationKeys.current.get(slot);
    if (current) return current;
    const next = createIdempotencyKey(`retail-${action}`);
    operationKeys.current.set(slot, next);
    return next;
  }, [order?.id]);
  const forgetOperationKey = useCallback((action: string, intent = 'default') => { operationKeys.current.delete(`${action}:${order?.id ?? 'new'}:${intent}`); }, [order?.id]);
  const refreshOrders = useCallback(async () => { const list = await api<Order[]>('/api/retail/orders?limit=100&offset=0'); setOrders(list.filter((item) => item.deliveryMode === 'PICKUP')); }, []);
  const loadPrintTemplates = useCallback(async () => { const templates = await api<PrintTemplate[]>('/api/retail/print-templates'); setPrintTemplates(templates); return templates; }, []);

  function priceInputKey(variantId: string, quantity: string) { return [customerMode, customerMode === 'EXISTING' ? customerId : '', variantId, quantity].join(':'); }
  function orderPayload(revision = order?.revision) {
    if (!warehouseId) throw new Error('Hãy chọn kho bán.');
    if (!cart.length) throw new Error('Hãy chọn ít nhất một sản phẩm.');
    return {
      sourceType: 'MANUAL', customerMode, ...(customerMode === 'EXISTING' ? { customerId } : {}), warehouseId,
      deliveryMode: 'PICKUP', collectionPolicy: policy, currency: 'VND', ...(revision ? { expectedRevision: revision } : {}),
      lines: cart.map((line) => {
        const preview = prices[line.id];
        return { variantId: line.id, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate, ...(preview?.inputKey === priceInputKey(line.id, line.quantity) ? { expectedSystemUnitPriceMinor: preview.finalUnitPriceMinor } : {}) };
      }),
    };
  }

  useEffect(() => {
    const storedPaper = safePaper(window.localStorage.getItem(PRINT_PAPER_STORAGE_KEY));
    if (storedPaper) setPrintPaper(storedPaper);
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
      void api<Product[]>(`/api/retail/products?${params}`, { signal: controller.signal }).then(setProducts).catch((reason: Error) => !controller.signal.aborted && setError(reason.message));
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        ? api<Order>(`/api/retail/orders/${currentOrder.id}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('draft-sync', fingerprint) }, body: JSON.stringify(orderPayload(currentOrder.revision)) })
        : api<Order>('/api/retail/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('create-draft', fingerprint) }, body: JSON.stringify(orderPayload(undefined)) });
      void request.then((next) => { lastDraftFingerprint.current = fingerprint; setOrder(next); void refreshOrders().catch(() => undefined); }).catch((reason: Error) => setError(reason.message)).finally(() => setBusy((value) => value === 'draft-sync' ? null : value));
    }, 360);
    return () => window.clearTimeout(timer);
  }, [cart, customerId, customerMode, editPickup, keyFor, order, policy, prices, refreshOrders, warehouseId]);
  useEffect(() => {
    if (!order?.id || ['closed', 'cancelled'].includes(order.status) || editPickup) return;
    setAvailabilityLoading(true);
    void api<Availability[]>(`/api/retail/orders/${order.id}/availability`).then(setAvailable).catch((reason: Error) => setError(reason.message)).finally(() => setAvailabilityLoading(false));
  }, [editPickup, order?.id, order?.revision, order?.status]);
  useEffect(() => {
    if (!editPickup || !order?.id || !warehouseId || !cart.length) return;
    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailable([]);
    const timer = window.setTimeout(() => {
      const variantIds = cart.map((line) => line.id);
      void api<Availability[]>('/api/retail/availability', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salesOrderId: order.id, warehouseId, variantIds }) }).then(setAvailable).catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason, 'Chưa thể tính Khả dụng.')); }).finally(() => { if (!controller.signal.aborted) setAvailabilityLoading(false); });
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [cart, editPickup, order?.id, warehouseId]);
  useEffect(() => {
    const lines = linesOf(order);
    if (!lines.length) return;
    let cancelled = false;
    void Promise.all(lines.map(async (line) => {
      const params = new URLSearchParams({ search: line.sku, limit: '5', offset: '0' });
      const options = await api<Product[]>(`/api/retail/products?${params}`).catch(() => []);
      const match = options.find((item) => item.sku.toUpperCase() === line.sku.toUpperCase()) ?? options[0];
      return [line.variantId, match?.imageKey ?? match?.productCode ?? ''] as const;
    })).then((pairs) => { if (!cancelled) setLineImages(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [order?.id, order?.revision]);
  useEffect(() => {
    if (!open) return;
    const syncMarker = () => { const active = filterTabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]'); if (active) setMarker({ left: active.offsetLeft, width: active.offsetWidth }); };
    const frame = requestAnimationFrame(syncMarker);
    window.addEventListener('resize', syncMarker);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', syncMarker); };
  }, [open, categoryId, boot?.categories.length]);
  useEffect(() => {
    if (!scannerOpen) return;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;
    const stop = () => { if (timer !== null) window.clearInterval(timer); stream?.getTracks().forEach((track) => track.stop()); };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.BarcodeDetector) { setScannerMessage('Thiết bị chưa hỗ trợ quét mã trong trình duyệt này. Hãy dùng ô tìm kiếm SKU.'); return; }
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
      } catch { setScannerMessage('Không thể mở camera. Hãy kiểm tra quyền camera hoặc tìm theo SKU.'); }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [scannerOpen]);

  const byVariant = useMemo(() => new Map(available.map((item) => [item.variantId, item])), [available]);
  const lineItems = linesOf(order);
  const editable = !order || order.status === 'draft' || editPickup;
  const editingDraft = editable && (!order || order.status === 'draft' || editPickup);
  const total = order ? Number(order.total || 0) : 0;
  const cartTotal = cart.reduce((sum, line) => { const preview = prices[line.id]; return sum + (preview?.inputKey === priceInputKey(line.id, line.quantity) ? Number(preview.lineTotalMinor || 0) : 0); }, 0);
  const totalLabel = cart.length ? money.format(cartTotal || total) : money.format(total);
  const stage = progressStage(order);
  const canEditPickup = order?.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus);
  const filteredOrders = orders.filter((item) => orderFilter === 'all' ? true : orderFilter === 'issued' ? item.status === 'confirmed' && STOCK_ISSUED_FULFILLMENT_STATUSES.has(item.fulfillmentStatus) : orderFilter === 'confirmed' ? item.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(item.fulfillmentStatus) : item.status === orderFilter);
  const stockRows = editingDraft ? cart.map((line) => ({ variantId: line.id, quantity: line.quantity, name: line.productName })) : lineItems.map((line) => ({ variantId: line.variantId, quantity: line.quantity, name: line.itemName }));
  const shortageRows = stockRows.filter((line) => isShortage(byVariant.get(line.variantId), line.quantity));
  const stockGatePending = Boolean(order && !['closed', 'cancelled'].includes(order.status) && (availabilityLoading || stockRows.some((line) => !byVariant.has(line.variantId))));
  const stockBlocked = shortageRows.length > 0;
  const stockGateText = stockBlocked ? `Chưa đủ Khả dụng: ${shortageRows.map((line) => line.name).join(', ')}.` : stockGatePending ? 'Đang kiểm tra Khả dụng trước khi xử lý.' : null;
  const visiblePrintFields = new Set(printTemplate?.visibleFieldKeys ?? ['line_no', 'line_item', 'line_quantity', 'line_unit_price', 'line_total', 'total_total']);

  function removeCartLine(id: string) {
    lastDraftFingerprint.current = '';
    setSelected((current) => { const next = new Map(current); next.delete(id); return next; });
    setCart((rows) => rows.filter((row) => row.id !== id));
  }
  function updateCartQuantity(id: string, value: string, fractional: boolean | null) {
    const normalized = normalizedQuantity(value, fractional);
    if (normalized === '0') { removeCartLine(id); return; }
    lastDraftFingerprint.current = '';
    setCart((rows) => rows.map((row) => row.id === id ? { ...row, quantity: normalized } : row));
  }
  function toggleProduct(product: Product) { setSelected((current) => { const next = new Map(current); if (next.has(product.id)) next.delete(product.id); else next.set(product.id, { product, quantity: '1' }); return next; }); }
  function adjustSelected(product: Product, direction: -1 | 1) { setSelected((current) => { const next = new Map(current); const row = next.get(product.id); if (!row && direction > 0) next.set(product.id, { product, quantity: '1' }); else if (row) { const value = Number(row.quantity) + direction; if (value <= 0) next.delete(product.id); else next.set(product.id, { ...row, quantity: normalizedQuantity(String(value), product.allowsFractional) }); } return next; }); }
  function addSelected() {
    lastDraftFingerprint.current = '';
    setCart((current) => {
      const next = new Map(current.map((line) => [line.id, line]));
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
  function assertStockGate(actionLabel: string) {
    if (stockGatePending) { setError(`Chưa thể ${actionLabel.toLowerCase()}. Hệ thống đang kiểm tra Khả dụng.`); return false; }
    if (stockBlocked) { setError(`${stockGateText} Hãy giảm số lượng hoặc chọn SKU khác trước khi ${actionLabel.toLowerCase()}.`); return false; }
    return true;
  }

  async function savePickupEdit() {
    if (!order || !editPickup) return;
    if (!assertStockGate('Lưu thay đổi')) return;
    setBusy('save'); setError(null);
    try {
      const fingerprint = JSON.stringify(cart.map((line) => [line.id, line.quantity]));
      const next = await api<Order>(`/api/retail/orders/${order.id}/pickup-edit`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('pickup-edit', fingerprint) }, body: JSON.stringify(orderPayload(order.revision)) });
      setOrder(next); setCart([]); setPrices({}); setEditPickup(false); setNotice('Đã lưu thay đổi đơn và giữ nguyên trạng thái Đã chốt.');
      void api<Order>(`/api/retail/orders/${next.id}`).then(setOrder).catch(() => undefined);
      void refreshOrders().catch(() => undefined);
    } catch (reason) {
      if (isRevisionConflict(reason)) void api<Order>(`/api/retail/orders/${order.id}`).then((next) => { setOrder(next); setCart(cartFromOrder(next)); setNotice('Đơn vừa thay đổi ở nơi khác. Đã nạp dữ liệu mới nhất để kiểm tra lại.'); }).catch(() => undefined);
      setError(errorMessage(reason, 'Chưa thể lưu đơn.'));
    } finally { setBusy(null); }
  }
  async function action(kind: 'confirm' | 'issue-stock' | 'complete') {
    if (!order) return;
    if ((kind === 'confirm' || kind === 'issue-stock') && !assertStockGate(kind === 'confirm' ? 'Chốt đơn' : 'Xuất kho')) return;
    setBusy(kind); setError(null);
    try {
      let source = order;
      let idempotencyKey = keyFor(kind);
      if (kind === 'issue-stock') {
        idempotencyKey = operationKeyFor('issue-stock', 'current-order');
        const latest = await api<Order>(`/api/retail/orders/${order.id}`);
        setOrder(latest);
        if (latest.revision !== order.revision) { setNotice('Đơn vừa có thay đổi mới. Đã đồng bộ dữ liệu; kiểm tra lại rồi bấm Xuất kho.'); return; }
        source = latest;
      }
      const body = kind === 'confirm' ? {} : { expectedRevision: source.revision };
      const next = await api<Order>(`/api/retail/orders/${source.id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) });
      setOrder(next);
      if (kind === 'confirm') setCart([]);
      if (kind === 'issue-stock') forgetOperationKey('issue-stock', 'current-order');
      setNotice(kind === 'confirm' ? 'Đơn đã được chốt.' : kind === 'issue-stock' ? 'Đã xuất kho.' : 'Đơn đã hoàn thành.');
      void refreshOrders().catch(() => undefined);
    } catch (reason) {
      if (kind === 'issue-stock' && isRevisionConflict(reason)) void api<Order>(`/api/retail/orders/${order.id}`).then((next) => { setOrder(next); setNotice('Đơn vừa thay đổi. Đã nạp dữ liệu mới nhất; kiểm tra lại rồi bấm Xuất kho.'); }).catch(() => undefined);
      setError(errorMessage(reason, 'Chưa thể thực hiện thao tác.'));
    } finally { setBusy(null); }
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
    } catch (reason) { setError(errorMessage(reason, 'Chưa thể ghi nhận thanh toán.')); } finally { setBusy(null); }
  }
  async function openOrder(id: string) {
    setError(null);
    try {
      const next = await api<Order>(`/api/retail/orders/${id}`);
      setOrder(next); setCustomerMode(next.customerMode); setCustomerId(next.customerId); setWarehouseId(next.warehouseId); setPolicy(next.collectionPolicy); setCart(next.status === 'draft' ? cartFromOrder(next) : []); setEditPickup(false); setActiveTab('entry'); lastDraftFingerprint.current = '';
    } catch (reason) { setError(errorMessage(reason, 'Không thể tải đơn.')); }
  }
  function beginPickupEdit() { if (!order) return; setCart(cartFromOrder(order)); setCustomerMode(order.customerMode); setCustomerId(order.customerId); setWarehouseId(order.warehouseId); setPolicy(order.collectionPolicy); setEditPickup(true); setNotice('Có thể sửa đơn đến trước khi xuất kho.'); }
  function resetEntry() { setOrder(null); setCart([]); setPrices({}); setEditPickup(false); setAvailable([]); setNotice(null); setError(null); setActiveTab('entry'); lastDraftFingerprint.current = ''; }
  function applyTemplate(template: PrintTemplate) {
    setPrintTemplate(template);
    setTemplateHeading(template.heading ?? '');
    setTemplateTitle(template.title ?? template.name);
    setTemplateSubtitle(template.subtitle ?? '');
  }
  async function openPrintPreview() {
    if (!order) return;
    setError(null);
    try {
      const templates = printTemplates.length ? printTemplates : await loadPrintTemplates();
      const savedCode = window.localStorage.getItem(PRINT_TEMPLATE_STORAGE_KEY);
      const template = templates.find((item) => item.templateCode === savedCode && item.documentType === 'SALES_ORDER')
        ?? templates.find((item) => item.documentType === 'SALES_ORDER')
        ?? templates[0]
        ?? null;
      if (template) applyTemplate(template);
      setPrintOpen(true);
    } catch (reason) { setError(errorMessage(reason, 'Chưa thể tải cấu hình Mẫu phiếu.')); }
  }
  function changePaper(value: PrintPaper) { setPrintPaper(value); window.localStorage.setItem(PRINT_PAPER_STORAGE_KEY, value); }
  async function savePrintTemplate() {
    if (!printTemplate) return;
    setBusy('print-template'); setError(null);
    try {
      const next = await api<PrintTemplate>(`/api/retail/print-templates/${printTemplate.documentType}/${printTemplate.templateCode}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('print-template', `${printTemplate.documentType}-${printTemplate.templateCode}-${printTemplate.updatedAt ?? 'default'}`) },
        body: JSON.stringify({ pageSize: printTemplate.pageSize, visibleFieldKeys: printTemplate.visibleFieldKeys, heading: templateHeading.trim() || null, title: templateTitle.trim() || null, subtitle: templateSubtitle.trim() || null, expectedUpdatedAt: printTemplate.updatedAt ?? null }),
      });
      setPrintTemplates((current) => current.map((item) => item.documentType === next.documentType && item.templateCode === next.templateCode ? next : item));
      applyTemplate(next);
      window.localStorage.setItem(PRINT_TEMPLATE_STORAGE_KEY, next.templateCode);
      setNotice('Đã lưu Mẫu phiếu dùng chung cho Công Ty.');
    } catch (reason) { setError(errorMessage(reason, 'Chưa thể lưu Mẫu phiếu.')); } finally { setBusy(null); }
  }
  function togglePrintField(key: string) {
    if (!printTemplate) return;
    const current = new Set(printTemplate.visibleFieldKeys);
    if (current.has(key)) current.delete(key); else current.add(key);
    setPrintTemplate({ ...printTemplate, visibleFieldKeys: [...current] });
  }
  function printNow() {
    const style = document.createElement('style');
    style.dataset.retailPrintPage = 'true';
    style.textContent = `@page { size: ${printPaper === '80mm' ? '80mm auto' : printPaper === '58mm' ? '58mm auto' : printPaper}; margin: ${printPaper === '80mm' || printPaper === '58mm' ? '4mm' : '10mm'}; }`;
    document.head.appendChild(style); window.print(); window.setTimeout(() => style.remove(), 0);
  }
  const productPicture = (imageKey: string | undefined, label: string) => <span className="product-visual"><span className="product-symbol product-symbol-large product-fallback" aria-hidden="true">{label.slice(0, 1)}</span>{imageKey ? <img className="product-photo" src={productImage(imageKey)} alt="" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}</span>;

  const title = activeTab === 'home' ? 'Trang chủ' : activeTab === 'orders' ? 'Đơn hàng' : activeTab === 'settings' ? 'Cài đặt' : order ? 'Chi tiết đơn' : 'Lên đơn';
  return <main className="retail-shell retail-lot7 retail-issue675">
    <header className="retail-header retail-topbar">
      <button className="round-icon" type="button" aria-label="Quay lại" onClick={() => setActiveTab(activeTab === 'entry' && order ? 'orders' : 'home')}>‹</button>
      <div className="retail-title"><h1>{title}</h1></div>
      <span className="topbar-spacer" aria-hidden="true" />
    </header>
    {error ? <p className="notice error" role="alert">{error}</p> : null}{notice ? <p className="notice" role="status">{notice}</p> : null}

    {activeTab === 'home' ? <section className="retail-home compact-home">
      <header className="compact-home-heading"><p className="section-kicker">BÁN TẠI QUẦY</p><h2>Thao tác nhanh</h2></header>
      <div className="home-actions compact-home-actions">
        <button type="button" onClick={() => { resetEntry(); setActiveTab('entry'); }}><span aria-hidden="true">＋</span><strong>Lên đơn</strong><small>Tạo đơn mới</small></button>
        <button type="button" onClick={() => { setActiveTab('orders'); void refreshOrders(); }}><span aria-hidden="true">▤</span><strong>Đơn hàng</strong><small>Theo dõi xử lý</small></button>
        <button type="button" onClick={() => { setActiveTab('settings'); void loadPrintTemplates().catch(() => undefined); }}><span aria-hidden="true">⚙</span><strong>Cài đặt</strong><small>In và tài khoản</small></button>
      </div>
    </section> : null}

    {activeTab === 'orders' ? <section className="orders-workspace" aria-label="Đơn Giao tại quầy">
      <header className="orders-heading"><div><p className="section-kicker">GIAO TẠI QUẦY</p><h2>Đơn đã lập</h2></div><button className="text-action" type="button" onClick={() => void refreshOrders()}>Tải lại</button></header>
      <div className="status-filter" role="tablist" aria-label="Lọc trạng thái đơn">{([{ id: 'all', label: 'Tất cả' }, { id: 'draft', label: 'Đang lập' }, { id: 'confirmed', label: 'Đã chốt' }, { id: 'issued', label: 'Đã xuất kho' }, { id: 'closed', label: 'Hoàn thành' }, { id: 'cancelled', label: 'Đã hủy' }] as { id: OrderFilter; label: string }[]).map((item) => <button type="button" role="tab" aria-selected={orderFilter === item.id} className={orderFilter === item.id ? 'active' : ''} key={item.id} onClick={() => setOrderFilter(item.id)}>{item.label}</button>)}</div>
      <div className="order-history">{filteredOrders.map((item) => <button className="history-row" type="button" key={item.id} onClick={() => void openOrder(item.id)}><span className="history-icon">▤</span><span><strong>{item.number ?? 'Đơn nháp'}</strong><small>{item.customerName} · {item.warehouseName}</small><em>{dateLabel(item.updatedAt)}</em></span><b>{orderLabel(item)} ›</b></button>)}{filteredOrders.length === 0 ? <p className="empty-cart">Chưa có đơn phù hợp.</p> : null}</div>
    </section> : null}

    {activeTab === 'settings' ? <section className="settings-workspace">
      <header className="settings-heading"><p className="section-kicker">CÀI ĐẶT</p><h2>Thiết lập bán tại quầy</h2></header>
      <div className="settings-list">
        <section className="settings-card"><div><span className="settings-icon" aria-hidden="true">◎</span><div><h3>Tài khoản</h3><p>Phiên đăng nhập dùng quyền nhân sự của Công Ty.</p></div></div></section>
        <section className="settings-card"><div><span className="settings-icon" aria-hidden="true">▣</span><div><h3>Máy in</h3><p>Chọn khổ mặc định trên thiết bị này. Máy in Wi-Fi được chọn trong hộp thoại in của thiết bị.</p></div></div><label className="settings-control">Khổ in mặc định<select value={printPaper} onChange={(event) => changePaper(event.target.value as PrintPaper)}><option value="A4">A4</option><option value="A5">A5</option><option value="80mm">80 mm</option><option value="58mm">58 mm</option></select></label></section>
        <section className="settings-card print-template-settings"><div><span className="settings-icon" aria-hidden="true">≡</span><div><h3>Mẫu phiếu</h3><p>Tiêu đề và các mục in được lưu theo Công Ty; khổ in mặc định lưu trên thiết bị.</p></div></div>
          <label className="settings-control">Mẫu<select value={printTemplate?.templateCode ?? ''} onFocus={() => { if (!printTemplates.length) void loadPrintTemplates().then((templates) => { const sales = templates.find((item) => item.documentType === 'SALES_ORDER'); if (sales) applyTemplate(sales); }).catch(() => undefined); }} onChange={(event) => { const next = printTemplates.find((item) => item.documentType === 'SALES_ORDER' && item.templateCode === event.target.value); if (next) applyTemplate(next); }}><option value="">Chọn mẫu</option>{printTemplates.filter((item) => item.documentType === 'SALES_ORDER').map((item) => <option key={`${item.documentType}-${item.templateCode}`} value={item.templateCode}>{item.name}</option>)}</select></label>
          {printTemplate ? <div className="template-editor"><label>Tiêu đề đầu phiếu<input value={templateHeading} maxLength={160} placeholder="Ví dụ: NGUYÊN LIỆU TRÀ SỮA" onChange={(event) => setTemplateHeading(event.target.value)} /></label><label>Tên chứng từ<input value={templateTitle} maxLength={160} placeholder={printTemplate.name} onChange={(event) => setTemplateTitle(event.target.value)} /></label><label>Dòng phụ<input value={templateSubtitle} maxLength={240} placeholder="Không bắt buộc" onChange={(event) => setTemplateSubtitle(event.target.value)} /></label><fieldset><legend>Mục hiển thị</legend><div className="field-checks">{printTemplate.fields?.map((field) => <label key={field.key}><input type="checkbox" checked={printTemplate.visibleFieldKeys.includes(field.key)} onChange={() => togglePrintField(field.key)} />{field.label}</label>)}</div></fieldset><div className="settings-actions"><button className="secondary-action" type="button" onClick={() => void openPrintPreview()} disabled={!order}>Xem trước đơn đang mở</button><button className="primary-action" type="button" disabled={busy === 'print-template' || !printTemplate.visibleFieldKeys.length} onClick={() => void savePrintTemplate()}>{busy === 'print-template' ? 'Đang lưu…' : 'Lưu Mẫu phiếu'}</button></div></div> : <button className="secondary-action" type="button" onClick={() => void loadPrintTemplates().then((templates) => { const sales = templates.find((item) => item.documentType === 'SALES_ORDER'); if (sales) applyTemplate(sales); }).catch((reason) => setError(errorMessage(reason, 'Chưa thể tải Mẫu phiếu.')))}>Tải Mẫu phiếu</button>}
        </section>
        <section className="settings-card danger-card"><div><span className="settings-icon" aria-hidden="true">↪</span><div><h3>Đăng xuất</h3><p>Kết thúc phiên làm việc trên thiết bị này.</p></div></div><form action="/api/auth/logout" method="post"><button className="secondary-action logout-action" type="submit">Đăng xuất</button></form></section>
      </div>
    </section> : null}

    {activeTab === 'entry' ? <>
      <section className="order-card retail-order-card">
        {order ? <div className="order-identity"><span className="order-document">▤</span><div><p className="section-kicker">ĐƠN BÁN HÀNG</p><h2>{order.number ?? 'Đơn đang lập'}</h2><p>{orderLabel(order)} · {dateLabel(order.updatedAt)}</p></div><div className="order-badges"><span className="mode-pill">{order.salesChannelName ?? order.salesChannelCode ?? 'Retail'}</span><span className="mode-pill">Giao tại quầy</span></div></div> : null}
        {order && order.status !== 'cancelled' ? <ol className="order-timeline">{['Lên đơn', 'Đã chốt', 'Xuất kho', 'Hoàn thành'].map((step, index) => <li className={index <= stage ? 'complete' : ''} key={step}><span>{index < stage ? '✓' : index + 1}</span><strong>{step}</strong></li>)}</ol> : null}
        {editable ? <div className="order-fields order-choice-cards compact-choice-cards"><label><span>Khách hàng</span><select value={customerMode} onChange={(event) => { lastDraftFingerprint.current = ''; setCustomerMode(event.target.value as 'WALK_IN' | 'EXISTING'); }}><option value="WALK_IN">Khách lẻ</option><option value="EXISTING">Khách hàng Công Ty</option></select></label><label><span>Kho bán</span><select value={warehouseId} onChange={(event) => { lastDraftFingerprint.current = ''; setWarehouseId(event.target.value); }}><option value="">Chọn kho</option>{boot?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>{customerMode === 'EXISTING' ? <label className="wide-choice"><span>Chọn khách hàng</span><select value={customerId} onChange={(event) => { lastDraftFingerprint.current = ''; setCustomerId(event.target.value); }}><option value="">Chọn khách hàng</option>{boot?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label> : null}</div> : <div className="order-facts"><span>Khách hàng <strong>{order?.customerName}</strong></span><span>Kho bán <strong>{order?.warehouseName}</strong></span></div>}
        {editable ? <button className="choose-products" type="button" onClick={() => setOpen(true)}><span>＋</span><strong>Chọn sản phẩm</strong><b>›</b></button> : null}
        {editPickup ? <p className="edit-hint">Đơn đang được điều chỉnh. Lưu thay đổi sẽ giữ trạng thái Đã chốt.</p> : null}
        {stockGateText ? <p className={`stock-gate ${stockBlocked ? 'blocked' : ''}`} role={stockBlocked ? 'alert' : 'status'}>{stockGateText}</p> : null}
        <div className="cart-list" aria-live="polite">
          {order && !editingDraft ? lineItems.map((line) => {
            const availability = byVariant.get(line.variantId);
            return <article className={`cart-row cart-row-saved compact-product-card ${isShortage(availability, line.quantity) ? 'stock-shortage' : ''}`} key={line.id}>{productPicture(lineImages[line.variantId], line.itemName)}<div className="line-main"><strong>{line.itemName}</strong><span>SKU: {line.sku}</span><em>{line.unitCode}</em><small>Khả dụng {availabilityLabel(availability, availabilityLoading)}</small>{isShortage(availability, line.quantity) ? <small className="shortage-text">Cần {formatQuantity(line.quantity)} · hiện có {availabilityLabel(availability)}</small> : null}</div><dl><div><dt>SL</dt><dd>{formatQuantity(line.quantity)}</dd></div><div><dt>Đơn giá</dt><dd>{money.format(Number(line.unitPrice))}</dd></div><div><dt>Thành tiền</dt><dd>{money.format(Number(line.lineTotal))}</dd></div></dl></article>;
          }) : cart.map((line) => {
            const availability = byVariant.get(line.id);
            return <article className={`cart-row editable compact-product-card ${isShortage(availability, line.quantity) ? 'stock-shortage' : ''}`} key={line.id}>{productPicture(line.imageKey ?? line.productCode, line.productName)}<div className="line-main"><strong>{line.productName}</strong><span>SKU: {line.sku}</span><em>{line.unitCode}</em><small>Khả dụng {order ? availabilityLabel(availability, availabilityLoading) : 'Đang chuẩn bị'}</small>{isShortage(availability, line.quantity) ? <small className="shortage-text">Cần {formatQuantity(line.quantity)} · hiện có {availabilityLabel(availability)}</small> : null}</div><div className="quantity-stepper"><button type="button" aria-label={`Giảm ${line.productName}`} onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) - 1), line.allowsFractional)}>−</button><input inputMode="decimal" aria-label={`Nhập số lượng ${line.productName}`} value={line.quantity} onChange={(event) => updateCartQuantity(line.id, event.target.value, line.allowsFractional)} /><button type="button" aria-label={`Tăng ${line.productName}`} onClick={() => updateCartQuantity(line.id, String(Number(line.quantity) + 1), line.allowsFractional)}>+</button></div><dl><div><dt>Đơn giá</dt><dd>{prices[line.id]?.inputKey === priceInputKey(line.id, line.quantity) ? money.format(Number(prices[line.id].finalUnitPriceMinor)) : 'Đang tính'}</dd></div><div><dt>Thành tiền</dt><dd>{prices[line.id]?.inputKey === priceInputKey(line.id, line.quantity) ? money.format(Number(prices[line.id].lineTotalMinor)) : '—'}</dd></div></dl><button className="remove-line" type="button" aria-label={`Xóa ${line.productName} khỏi đơn`} onClick={() => removeCartLine(line.id)}>Xóa</button></article>;
          })}
          {editingDraft && !cart.length ? <p className="empty-cart">Chưa có sản phẩm. Chọn sản phẩm để tiếp tục.</p> : null}
        </div>
        <footer className="order-total lot7-total"><div><span>Tạm tính</span><strong>{totalLabel}</strong></div><div><span>Giảm giá</span><strong>0 ₫</strong></div><div className="grand-total"><span>Tổng cộng</span><strong>{totalLabel}</strong></div></footer>
      </section>
      <section className="order-action-bar" aria-label="Thao tác đơn">
        {editPickup ? <button className="secondary-action" type="button" disabled={busy !== null || stockBlocked || stockGatePending || !cart.length} onClick={() => void savePickupEdit()}>{busy === 'save' ? 'Đang lưu…' : 'Lưu thay đổi'}</button> : order ? <>{canEditPickup ? <button className="secondary-action" type="button" disabled={busy !== null} onClick={beginPickupEdit}>Sửa đơn</button> : null}<button className="secondary-action" type="button" onClick={() => void openPrintPreview()}>In phiếu</button>{order.status === 'draft' ? <button className="primary-action" disabled={busy !== null || !cart.length || stockBlocked || stockGatePending} onClick={() => void action('confirm')}>Chốt đơn</button> : null}{order.status === 'confirmed' && !STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null || stockBlocked || stockGatePending} onClick={() => void action('issue-stock')}>Xuất kho</button> : null}{order.status === 'confirmed' && STOCK_ISSUED_FULFILLMENT_STATUSES.has(order.fulfillmentStatus) ? <button className="primary-action" disabled={busy !== null} onClick={() => void action('complete')}>Hoàn thành</button> : null}{order.status === 'closed' && order.settlementStatus !== 'paid' ? <button className="primary-action" disabled={busy !== null} onClick={() => { setPaid(order.receivableRemainingAmount ?? order.total); setPayment(true); }}>Thu tiền / Nợ</button> : null}</> : cart.length ? <button className="primary-action" type="button" disabled>Đang chuẩn bị đơn…</button> : null}
      </section>
    </> : null}

    <nav className="bottom-nav" aria-label="Điều hướng Retail"><button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')}><span>⌂</span>Trang chủ</button><button type="button" className={activeTab === 'entry' ? 'active' : ''} onClick={() => setActiveTab('entry')}><span>＋</span>Lên đơn</button><button type="button" className={activeTab === 'orders' ? 'active' : ''} onClick={() => { setActiveTab('orders'); void refreshOrders(); }}><span>▤</span>Đơn hàng</button><button type="button" className={activeTab === 'settings' ? 'active' : ''} onClick={() => { setActiveTab('settings'); void loadPrintTemplates().then((templates) => { if (!printTemplate) { const sales = templates.find((item) => item.documentType === 'SALES_ORDER'); if (sales) applyTemplate(sales); } }).catch(() => undefined); }}><span>⚙</span>Cài đặt</button></nav>

    {open ? <section className="product-sheet sheet-enter" role="dialog" aria-modal="true" aria-label="Chọn sản phẩm"><header className="sheet-header"><button className="round-icon" type="button" onClick={() => setOpen(false)}>‹</button><div><h2>Chọn sản phẩm</h2></div><button className="text-action scan-action" type="button" onClick={() => { setScannerMessage(null); setScannerOpen(true); }}>Quét mã</button></header><div className="search-box"><span>⌕</span><input className="product-search" autoFocus placeholder="Tìm tên, SKU, quy cách" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="filter-tabs" ref={filterTabs} role="tablist" aria-label="Nhóm sản phẩm"><span className="filter-highlight" aria-hidden="true" style={{ transform: `translateX(${marker.left}px)`, width: marker.width }} />{[{ id: '', name: 'Tất cả' }, ...(boot?.categories ?? [])].map((category) => <button key={category.id || 'all'} className={categoryId === category.id ? 'active' : ''} type="button" role="tab" aria-selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div><div className="product-list">{products.map((product) => { const row = selected.get(product.id); const preview = prices[product.id]; const expectedKey = priceInputKey(product.id, row?.quantity ?? '1'); const price = preview?.inputKey === expectedKey ? preview : null; return <article className={`product-row lot7-product-row ${row ? 'selected' : ''}`} key={product.id}>{productPicture(product.imageKey ?? product.productCode, product.productName)}<div className="product-copy"><strong>{product.productName}</strong><small>SKU: {product.sku}</small><em>{product.unitCode}</em><b>{price ? money.format(Number(price.finalUnitPriceMinor)) : 'Đang tính giá'}</b></div>{row ? <div className="quantity-stepper"><button type="button" onClick={() => adjustSelected(product, -1)}>−</button><output>{row.quantity}</output><button type="button" onClick={() => adjustSelected(product, 1)}>+</button></div> : <button className="add-product" type="button" onClick={() => toggleProduct(product)}>+</button>}</article>; })}</div><button className="sheet-submit primary-action" type="button" disabled={!selected.size} onClick={addSelected}><span className="selection-count">{selected.size}</span> Thêm {selected.size} sản phẩm vào đơn <b>›</b></button></section> : null}
    {scannerOpen ? <section className="dialog-backdrop" role="dialog" aria-modal="true"><div className="scanner-dialog sheet-enter"><header><div><p className="section-kicker">QUÉT MÃ</p><h2>Đưa mã vào khung hình</h2></div><button className="text-action" type="button" onClick={() => setScannerOpen(false)}>Đóng</button></header>{scannerMessage ? <p className="notice error">{scannerMessage}</p> : <video className="scanner-video" ref={videoRef} autoPlay muted playsInline />}</div></section> : null}
    {payment ? <section className="dialog-backdrop payment-screen" role="dialog" aria-modal="true"><div className="payment-dialog sheet-enter lot7-payment"><header><button className="round-icon" type="button" onClick={() => setPayment(false)}>‹</button><div><p className="section-kicker">THANH TOÁN</p><h2>Thu tiền / Nợ</h2></div><span /></header><div className="payment-summary"><span>Tổng thanh toán</span><strong>{money.format(Number(order?.receivableRemainingAmount ?? total))}</strong><div className="payment-balance"><span>Đã thu</span><b>{money.format(Math.max(0, total - Number(order?.receivableRemainingAmount ?? total)))}</b><span>Còn lại</span><b>{money.format(Number(order?.receivableRemainingAmount ?? total))}</b></div></div><div className="payment-methods"><button type="button" className={paymentMethod === 'CASH' ? 'active' : ''} onClick={() => setPaymentMethod('CASH')}>Tiền mặt</button><button type="button" className={paymentMethod === 'BANK_TRANSFER' ? 'active' : ''} onClick={() => setPaymentMethod('BANK_TRANSFER')}>Chuyển khoản</button></div><label>Nhập số tiền nhận<input inputMode="numeric" value={paid} onChange={(event) => setPaid(event.target.value)} /></label><div className="payment-footer"><button className="secondary-action" type="button" disabled={busy === 'settlement'} onClick={() => void settle('0')}>Ghi nợ</button><button className="primary-action" type="button" disabled={busy === 'settlement' || !paid.trim()} onClick={() => void settle()}>{busy === 'settlement' ? 'Đang ghi nhận…' : 'Hoàn tất thu tiền'}</button></div></div></section> : null}
    {printOpen && order ? <section className={`print-screen paper-${printPaper === 'A4' ? 'a4' : printPaper === 'A5' ? 'a5' : printPaper === '80mm' ? '80' : '58'}`} role="dialog" aria-modal="true"><div className="print-toolbar"><button className="round-icon" type="button" onClick={() => setPrintOpen(false)}>‹</button><div><h2>Xem trước phiếu</h2><small>{printTemplate?.name ?? 'Mẫu phiếu'}</small></div><button className="primary-action" type="button" onClick={printNow}>In</button></div><div className="print-paper-picker"><label>Khổ in<select value={printPaper} onChange={(event) => changePaper(event.target.value as PrintPaper)}><option value="A4">A4</option><option value="A5">A5</option><option value="80mm">80 mm</option><option value="58mm">58 mm</option></select></label><p>Máy in Wi-Fi được chọn trong hộp thoại in của thiết bị.</p></div><article className="print-document"><header>{printTemplate?.heading ? <p>{printTemplate.heading}</p> : null}<h1>{printTemplate?.title ?? printTemplate?.name ?? 'Đơn bán hàng'}</h1>{printTemplate?.subtitle ? <p>{printTemplate.subtitle}</p> : null}<small>{order.number ?? 'Đơn bán hàng'}</small></header><div className="print-meta">{visiblePrintFields.has('customer') ? <p><span>Khách hàng</span><strong>{order.customerName}</strong></p> : null}{visiblePrintFields.has('warehouse') ? <p><span>Kho bán</span><strong>{order.warehouseName}</strong></p> : null}{visiblePrintFields.has('document_date') ? <p><span>Ngày</span><strong>{dateLabel(order.updatedAt)}</strong></p> : null}</div>{visiblePrintFields.has('line_item') ? <table><thead><tr>{visiblePrintFields.has('line_no') ? <th>STT</th> : null}<th>Sản phẩm</th>{visiblePrintFields.has('line_quantity') ? <th>SL</th> : null}<th>ĐVT</th>{visiblePrintFields.has('line_unit_price') ? <th>Đơn giá</th> : null}{visiblePrintFields.has('line_total') ? <th>Thành tiền</th> : null}</tr></thead><tbody>{lineItems.map((line, index) => <tr key={line.id}>{visiblePrintFields.has('line_no') ? <td>{index + 1}</td> : null}<td><strong>{line.itemName}</strong><small>{line.sku}</small></td>{visiblePrintFields.has('line_quantity') ? <td>{formatQuantity(line.quantity)}</td> : null}<td>{line.unitCode}</td>{visiblePrintFields.has('line_unit_price') ? <td>{money.format(Number(line.unitPrice))}</td> : null}{visiblePrintFields.has('line_total') ? <td>{money.format(Number(line.lineTotal))}</td> : null}</tr>)}</tbody></table> : null}<footer>{visiblePrintFields.has('total_total') ? <p className="print-grand-total"><span>Tổng cộng</span><strong>{money.format(Number(order.total))}</strong></p> : null}{visiblePrintFields.has('note') ? <p className="print-note"><span>Ghi chú</span><strong>—</strong></p> : null}{visiblePrintFields.has('signatures') ? <div className="print-signatures"><span>Người lập</span><span>Khách hàng</span></div> : null}</footer></article></section> : null}
  </main>;
}
