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
type RetailTab = 'home' | 'entry' | 'orders' | 'account';
type OrderFilter = 'all' | 'draft' | 'confirmed' | 'issued' | 'closed' | 'cancelled';
type PaymentMethod = 'CASH' | 'BANK_TRANSFER';
type PrintPaper = 'A4' | 'A5' | '80mm' | '58mm';
type PrintTemplate = { documentType: string; templateCode: string; name: string; pageSize: 'A4' | 'A5'; visibleFieldKeys: string[]; fields: { key: string; label: string; defaultSelected: boolean }[]; isCustomized: boolean; updatedAt: string | null };
type ApiErrorShape = { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> };

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
  }
}

class RetailApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  readonly status: number;

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
const PRODUCT_IMAGE_BASE = 'https://pub-7d2987fab97d4e3ebb2021a823973862.r2.dev/app-customer/products';
const STOCK_ISSUED_FULFILMENT_STATUSES = new Set(['partially_issued', 'issued', 'partially_fulfilled', 'fulfilled']);
const STOCK_ISSUED_FULFILLMENT_STATUSES = STOCK_ISSUED_FULFILMENT_STATUSES;
const linesOf = (order: Order | null) => order?.versions?.find((item) => item.versionNumber === order.currentVersionNumber)?.lines ?? order?.versions?.find((item) => item.status === 'draft')?.lines ?? order?.versions?.[0]?.lines ?? [];
const cartFromOrder = (order: Order): CartLine[] => linesOf(order).map((line) => ({ id: line.variantId, productCode: line.sku, imageKey: null, productName: line.itemName, sku: line.sku, unitCode: line.unitCode, allowsFractional: null, quantity: line.quantity, taxMode: line.taxMode, taxRate: line.taxRate }));

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null) as { data?: T; error?: ApiErrorShape } | null;
  if (!response.ok || payload?.error) throw new RetailApiError(payload?.error, response.status);
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

function availabilityLabel(row: Availability | undefined, loading = false) {
  if (loading) return 'Đang tính';
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

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function isRevisionConflict(reason: unknown) {
  if (!(reason instanceof RetailApiError)) return false;
  return reason.code.includes('CONFLICT') || typeof reason.details.currentRevision === 'string';
}

function paperPageRule(paper: PrintPaper) {
  if (paper === '80mm') return '80mm auto';
  if (paper === '58mm') return '58mm auto';
  return paper;
}

export default function RetailHomePage() {
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
  const [printTemplate, setPrintTemplate] = useState<PrintTemplate | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printPaper, setPrintPaper] = useState<PrintPaper>('A4');
  const filterTabs = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState({ left: 0, width: 0 });
  const keys = useRef(new Map<string, string>());
  const operationKeys = useRef(new Map<string, string>());
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

  const operationKeyFor = useCallback((action: string, intent = 'default') => {
    const slot = `${action}:${order?.id ?? 'new'}:${intent}`;
    const existing = operationKeys.current.get(slot);
    if (existing) return existing;
    const next = createIdempotencyKey(`retail-${action}`);
    operationKeys.current.set(slot, next);
    return next;
  }, [order?.id]);

  const forgetOperationKey = useCallback((action: string, intent = 'default') => {
    operationKeys.current.delete(`${action}:${order?.id ?? 'new'}:${intent}`);
  }, [order?.id]);

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
    if (!order?.id || ['closed', 'cancelled'].includes(order.status) || editPickup) return;
    void api<Availability[]>(`/api/retail/orders/${order.id}/availability`).then(setAvailable).catch((reason: Error) => setError(reason.message));
  }, [editPickup, order?.id, order?.revision, order?.status]);

  useEffect(() => {
    if (!editPickup || !order?.id || !warehouseId || !cart.length) return;
    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailable([]);
    const timer = window.setTimeout(() => {
      void api<Availability[]>('/api/retail/availability', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salesOrderId: order.id, warehouseId, variantIds: cart.map((line) => line.id) }),
      }).then(setAvailable)
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason, 'Chưa thể tính Khả dụng.')); })
        .finally(() => { if (!controller.signal.aborted) setAvailabilityLoading(false); });
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
  const visiblePrintFields = new Set(printTemplate?.visibleFieldKeys ?? []);

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
      const fingerprint = JSON.stringify(cart.map((line) => [line.id, line.quantity]));
      const next = await api<Order>(`/api/retail/orders/${order.id}/pickup-edit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor('pickup-edit', fingerprint) },
        body: JSON.stringify(orderPayload(order.revision)),
      });
      setOrder(next);
      setCart([]);
      setPrices({});
      setEditPickup(false);
      setNotice('Đã lưu thay đổi đơn và giữ nguyên trạng thái Đã chốt.');
      void api<Order>(`/api/retail/orders/${next.id}`).then(setOrder).catch(() => undefined);
      void refreshOrders().catch(() => undefined);
    } catch (reason) {
      if (isRevisionConflict(reason)) {
        void api<Order>(`/api/retail/orders/${order.id}`).then((next) => {
          setOrder(next);
          setCart(cartFromOrder(next));
          setNotice('Đơn vừa thay đổi ở nơi khác. Đã nạp dữ liệu mới nhất để anh kiểm tra lại.');
        }).catch(() => undefined);
      }
      setError(errorMessage(reason, 'Chưa thể lưu đơn.'));
    } finally { setBusy(null); }
  }

  async function action(kind: 'confirm' | 'issue-stock' | 'complete') {
    if (!order) return;
    setBusy(kind); setError(null);
    try {
      let source = order;
      let idempotencyKey = keyFor(kind);
      if (kind === 'issue-stock') {
        idempotencyKey = operationKeyFor('issue-stock', 'current-order');
        const latest = await api<Order>(`/api/retail/orders/${order.id}`);
        setOrder(latest);
        if (latest.revision !== order.revision) {
          setNotice('Đơn vừa có thay đổi mới. Đã đồng bộ dữ liệu; kiểm tra lại rồi bấm Xuất kho.');
          return;
        }
        source = latest;
      }
      const body = kind === 'confirm' ? {} : { expectedRevision: source.revision };
      const next = await api<Order>(`/api/retail/orders/${source.id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      });
      setOrder(next);
      if (kind === 'confirm') setCart([]);
      if (kind === 'issue-stock') forgetOperationKey('issue-stock', 'current-order');
      setNotice(kind === 'confirm' ? 'Đơn đã được chốt.' : kind === 'issue-stock' ? 'Đã xuất kho.' : 'Đơn đã hoàn thành.');
      void refreshOrders().catch(() => undefined);
    } catch (reason) {
      if (kind === 'issue-stock' && isRevisionConflict(reason)) {
        forgetOperationKey('issue-stock', 'current-order');
        void api<Order>(`/api/retail/orders/${order.id}`).then((next) => {
          setOrder(next);
          setNotice('Đơn vừa thay đổi. Đã nạp dữ liệu mới nhất; kiểm tra lại rồi bấm Xuất kho.');
        }).catch(() => undefined);
      }
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
    } catch (reason) { setError(errorMessage(reason, 'Chưa thể ghi nhận thanh toán.')); }
    finally { setBusy(null); }
  }

  async function openOrder(id: string) {
    setError(null);
    try {
      const next = await api<Order>(`/api/retail/orders/${id}`);
      setOrder(next); setCustomerMode(next.customerMode); setCustomerId(next.customerId); setWarehouseId(next.warehouseId); setPolicy(next.collectionPolicy); setCart(next.status === 'draft' ? cartFromOrder(next) : []); setEditPickup(false); setActiveTab('entry'); lastDraftFingerprint.current = '';
    } catch (reason) { setError(errorMessage(reason, 'Không thể tải đơn.')); }
  }

  async function openPrintPreview() {
    if (!order