'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, CustomerAddress } from '../../../lib/customer-types';
import type { Product } from '../../../lib/product-types';
import type { Warehouse } from '../../../lib/organization-types';
import type {
  SalesOrder,
  SalesOrderCollectionPolicy,
  SalesOrderCustomerMode,
  SalesOrderDocumentDiscountMode,
  SalesOrderDraftPayload,
  SalesOrderEntrySettings,
  SalesOrderSkuSearchOption,
  SalesOrderTaxMode,
  SalesOrderVersion,
  SalesPriceResolution,
  SalesPriceStep,
} from '../../../lib/sales-order-types';
import {
  apiRequest,
  draftRecoveryTarget,
  mutationKey,
  SalesOrderUiError,
} from './sales-order-ui';
import styles from './sales-orders.module.css';

export type SalesOrderFormMode = 'create' | 'draft' | 'amendment';

const SEARCH_DELAY_MS = 260;
const SEARCH_PAGE_SIZE = 30;
const REPRICE_DELAY_MS = 320;
const SCALE = 1_000_000n;
const HUNDRED = 100n * SCALE;

type LineDraft = {
  variantId: string;
  sku: string;
  name: string;
  unitCode: string;
  quantity: string;
  taxMode: SalesOrderTaxMode;
  taxRate: string;
  baseUnitPriceMinor: string;
  systemUnitPriceMinor: string;
  manualUnitPriceMinor: string;
  manualReason: string;
  pricingFingerprint: string;
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
  canPriceOverride: boolean;
  canDiscountOverride: boolean;
  onClose: () => void;
  onSaved: (order: SalesOrder) => void;
  onError: (message: string) => void;
};

type EstimatedLine = {
  gross: bigint;
  discount: bigint;
  tax: bigint;
  total: bigint;
};

function parseScaled(value: string, allowZero = true): bigint | null {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d{0,18})(?:\.(\d{1,6}))?$/.exec(normalized);
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

function normalizedPhone(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^0-9+]/g, '').trim();
}

function autoCustomerCode(): string {
  return `KH${Date.now().toString(36).toUpperCase()}`.slice(0, 64);
}

function resolutionFingerprint(steps: SalesPriceStep[]): string {
  return steps.find((step) => step.kind === 'RESOLUTION')?.resolutionFingerprint ?? '';
}

function versionLines(version?: SalesOrderVersion | null): LineDraft[] {
  return (version?.lines ?? []).map((line) => ({
    variantId: line.variantId,
    sku: line.sku,
    name: line.itemName,
    unitCode: line.unitCode,
    quantity: line.quantity,
    taxMode: line.taxMode,
    taxRate: line.taxRate,
    baseUnitPriceMinor: line.baseUnitPrice ?? line.unitPrice,
    systemUnitPriceMinor: line.systemUnitPrice ?? line.unitPrice,
    manualUnitPriceMinor: line.priceSource === 'MANUAL_OVERRIDE' ? line.unitPrice : '',
    manualReason: line.manualOverrideReason ?? '',
    pricingFingerprint: resolutionFingerprint(line.pricingTrace ?? []),
    priceSteps: line.pricingTrace ?? [],
    resolvingPrice: false,
    priceError: null,
  }));
}

function finalUnitPrice(line: LineDraft): string {
  return line.manualUnitPriceMinor.trim() || line.systemUnitPriceMinor;
}

function grossMinor(line: LineDraft): bigint {
  const quantity = parseScaled(line.quantity, false) ?? 0n;
  const price = /^\d+$/.test(finalUnitPrice(line)) ? BigInt(finalUnitPrice(line)) : 0n;
  return halfUp(quantity * price, SCALE);
}

function documentDiscountTarget(
  mode: SalesOrderDocumentDiscountMode,
  valueText: string,
  gross: bigint,
): bigint | null {
  const scaled = parseScaled(valueText || '0', true);
  if (scaled === null) return null;
  if (mode === 'NONE') return scaled === 0n ? 0n : null;
  if (mode === 'PERCENT') {
    if (scaled > HUNDRED) return null;
    return halfUp(gross * scaled, HUNDRED);
  }
  if (scaled % SCALE !== 0n) return null;
  return scaled / SCALE;
}

function largestRemainder(gross: bigint[], target: bigint): bigint[] | null {
  const total = gross.reduce((sum, value) => sum + value, 0n);
  if (target < 0n || target > total) return null;
  const allocations = gross.map(() => 0n);
  if (target === 0n || total === 0n) return allocations;
  const ranked = gross
    .map((value, index) => {
      if (value <= 0n) return null;
      const numerator = value * target;
      const floor = numerator / total;
      allocations[index] = floor;
      return { index, remainder: numerator % total };
    })
    .filter((value): value is { index: number; remainder: bigint } => value !== null)
    .sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1);
  let remaining = target - allocations.reduce((sum, value) => sum + value, 0n);
  for (const item of ranked) {
    if (remaining === 0n) break;
    if (allocations[item.index] < gross[item.index]) {
      allocations[item.index] += 1n;
      remaining -= 1n;
    }
  }
  return remaining === 0n ? allocations : null;
}

function estimateLine(line: LineDraft, discount: bigint): EstimatedLine {
  const gross = grossMinor(line);
  const discounted = gross > discount ? gross - discount : 0n;
  const taxRate = parseScaled(line.taxRate || '0', true) ?? 0n;
  const tax = line.taxMode === 'INCLUSIVE'
    ? (taxRate === 0n ? 0n : halfUp(discounted * taxRate, HUNDRED + taxRate))
    : halfUp(discounted * taxRate, HUNDRED);
  return {
    gross,
    discount,
    tax,
    total: line.taxMode === 'INCLUSIVE' ? discounted : discounted + tax,
  };
}

function pricingLabel(step: SalesPriceStep): string {
  if (step.kind === 'RESOLUTION') return 'Dấu vết giá đã khóa';
  if (step.kind === 'BASE') return `Giá nền · ${step.priceListCode ?? 'BASE'}`;
  if (step.kind === 'MANUAL_OVERRIDE') return 'Giá ngoại lệ';
  if (step.kind === 'SKIPPED') return `Bỏ qua · ${step.priceListCode ?? step.reason ?? 'quy tắc'}`;
  const adjustment = {
    FIXED_PRICE: 'Giá cố định',
    PERCENT_DISCOUNT: 'Giảm %',
    AMOUNT_DISCOUNT: 'Giảm tiền',
    PERCENT_MARKUP: 'Tăng %',
    AMOUNT_MARKUP: 'Tăng tiền',
  }[step.adjustmentType ?? ''] ?? step.adjustmentType ?? 'Điều chỉnh';
  return `${step.priceListCode ?? step.priceListType ?? 'Chính sách'} · ${adjustment}`;
}

function pricingSummary(line: LineDraft): string {
  const applied = line.priceSteps.filter((step) => step.kind === 'RULE');
  if (applied.length === 0) return 'Giá nền';
  const labels = applied
    .slice(0, 2)
    .map((step) => step.priceListCode ?? step.priceListType ?? 'Chính sách');
  return `${labels.join(' · ')}${applied.length > 2 ? ` · ${applied.length} chính sách` : ''}`;
}

export default function SalesOrderCommercialForm(props: Props) {
  const { version, onClose, onError } = props;
  const initialWalkIn = version?.customerMode === 'WALK_IN';
  const [saveKey, setSaveKey] = useState(() => mutationKey(`sales-${props.mode}-save`));
  const [confirmKey, setConfirmKey] = useState(() => mutationKey(`sales-${props.mode}-confirm`));
  const [quickCustomerKey, setQuickCustomerKey] = useState(() => mutationKey('sales-quick-customer'));
  const [quickAddressKey, setQuickAddressKey] = useState(() => mutationKey('sales-quick-address'));
  const [entrySettings, setEntrySettings] = useState<SalesOrderEntrySettings | null>(null);
  const [pricingAt, setPricingAt] = useState(() => new Date().toISOString());
  const [customerMode, setCustomerMode] = useState<SalesOrderCustomerMode>(initialWalkIn ? 'WALK_IN' : 'EXISTING');
  const [customerRows, setCustomerRows] = useState(props.customers);
  const [customerId, setCustomerId] = useState(initialWalkIn ? '' : (version?.customerId ?? ''));
  const [customerSearch, setCustomerSearch] = useState('');
  const [walkInDisplayName, setWalkInDisplayName] = useState(version?.walkInDisplayName ?? '');
  const [walkInPhone, setWalkInPhone] = useState(version?.walkInPhone ?? '');
  const [addressId, setAddressId] = useState(version?.customerAddressId ?? '');
  const [warehouseId, setWarehouseId] = useState(version?.warehouseId ?? '');
  const [salesChannelId, setSalesChannelId] = useState(version?.salesChannelId ?? '');
  const [deliveryMode, setDeliveryMode] = useState(version?.deliveryMode ?? 'DELIVERY');
  const [collectionPolicy, setCollectionPolicy] = useState<SalesOrderCollectionPolicy>(version?.collectionPolicy ?? 'COLLECT_ON_DELIVERY');
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(version?.requestedDeliveryDate ?? '');
  const [note, setNote] = useState(version?.note ?? '');
  const [showMore, setShowMore] = useState(Boolean(version?.note));
  const [lines, setLines] = useState<LineDraft[]>(versionLines(version));
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const linesRef = useRef(lines);
  const committedDraftRef = useRef<SalesOrder | null>(null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [taxReady, setTaxReady] = useState(Boolean(version?.lines?.length));
  const [skuTerm, setSkuTerm] = useState('');
  const [skuResults, setSkuResults] = useState<SalesOrderSkuSearchOption[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [activeSkuIndex, setActiveSkuIndex] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState<QuickCustomerDraft>(() => ({
    code: autoCustomerCode(), name: '', phone: '', addressLine1: '',
  }));
  const [documentDiscountMode, setDocumentDiscountMode] = useState<SalesOrderDocumentDiscountMode>(version?.documentDiscountMode ?? 'NONE');
  const [documentDiscountValue, setDocumentDiscountValue] = useState(version?.documentDiscountValue ?? '0');
  const [documentDiscountReason, setDocumentDiscountReason] = useState(version?.documentDiscountReason ?? '');
  const [pricingMismatch, setPricingMismatch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pricingContextRef = useRef('');
  const quantitySignatureRef = useRef('');
  const pricingRunRef = useRef(0);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const canPriceOverride = props.canPriceOverride
    && (entrySettings?.permissions.canPriceOverride ?? false);
  const canDiscountOverride = props.canDiscountOverride
    && (entrySettings?.permissions.canDiscountOverride ?? false);

  const activeCustomers = useMemo(() => customerRows
    .filter((item) => item.is_active)
    .filter((item) => {
      const term = customerSearch.trim().toLocaleLowerCase('vi');
      return !term || [item.code, item.name, item.phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('vi').includes(term));
    })
    .sort((left, right) => left.code.localeCompare(right.code)), [customerRows, customerSearch]);

  const estimate = useMemo(() => {
    const gross = lines.map(grossMinor);
    const grossTotal = gross.reduce((sum, value) => sum + value, 0n);
    const target = documentDiscountTarget(documentDiscountMode, documentDiscountValue, grossTotal);
    const allocations = target === null ? null : largestRemainder(gross, target);
    const details = lines.map((line, index) => estimateLine(line, allocations?.[index] ?? 0n));
    return {
      valid: target !== null && allocations !== null,
      gross: grossTotal,
      discount: allocations?.reduce((sum, value) => sum + value, 0n) ?? 0n,
      tax: details.reduce((sum, value) => sum + value.tax, 0n),
      total: details.reduce((sum, value) => sum + value.total, 0n),
      allocations,
    };
  }, [documentDiscountMode, documentDiscountValue, lines]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setPricingMismatch(null);
    onError('');
  }, [onError]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('Đơn bán hàng có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return;
    onClose();
  }, [busy, dirty, onClose]);

  const priceFor = useCallback(async ({
    variantId,
    quantity,
    mode,
    selectedCustomerId,
    channelId,
    effectiveAt,
  }: {
    variantId: string;
    quantity: string;
    mode: SalesOrderCustomerMode;
    selectedCustomerId: string;
    channelId: string;
    effectiveAt: string;
  }): Promise<SalesPriceResolution> => {
    if (!channelId) throw new Error('Hãy chọn kênh bán trước khi tính giá');
    return apiRequest<SalesPriceResolution>('/api/pricing/resolve', {
      method: 'POST',
      body: JSON.stringify({
        variantId,
        quantity,
        currencyCode: 'VND',
        priceAt: effectiveAt,
        channelId,
        ...(mode === 'EXISTING' && selectedCustomerId ? { customerId: selectedCustomerId } : {}),
      }),
    });
  }, []);

  const repriceAll = useCallback(async (
    effectiveAt: string,
    mode = customerMode,
    selectedCustomerId = customerId,
    channelId = salesChannelId,
  ) => {
    const snapshot = [...linesRef.current];
    if (snapshot.length === 0 || !channelId) return;
    const run = ++pricingRunRef.current;
    setLines((current) => current.map((line) => ({ ...line, resolvingPrice: true, priceError: null })));
    const results = await Promise.all(snapshot.map(async (line) => {
      try {
        const resolution = await priceFor({
          variantId: line.variantId,
          quantity: line.quantity,
          mode,
          selectedCustomerId,
          channelId,
          effectiveAt,
        });
        return {
          variantId: line.variantId,
          baseUnitPriceMinor: resolution.baseUnitPriceMinor,
          systemUnitPriceMinor: resolution.systemUnitPriceMinor ?? resolution.finalUnitPriceMinor,
          pricingFingerprint: resolution.resolutionFingerprint,
          priceSteps: resolution.steps,
          priceError: null,
        };
      } catch (error) {
        return {
          variantId: line.variantId,
          baseUnitPriceMinor: line.baseUnitPriceMinor,
          systemUnitPriceMinor: line.systemUnitPriceMinor,
          pricingFingerprint: line.pricingFingerprint,
          priceSteps: line.priceSteps,
          priceError: error instanceof Error ? error.message : 'Không phân giải được giá',
        };
      }
    }));
    if (run !== pricingRunRef.current) return;
    const byVariant = new Map(results.map((result) => [result.variantId, result]));
    setLines((current) => current.map((line) => {
      const result = byVariant.get(line.variantId);
      return result ? { ...line, ...result, resolvingPrice: false } : line;
    }));
  }, [customerId, customerMode, priceFor, salesChannelId]);

  useEffect(() => {
    apiRequest<SalesOrderEntrySettings>('/api/sales-orders/entry-settings')
      .then((settings) => {
        setEntrySettings(settings);
        setSalesChannelId((current) => current || settings.defaultSalesChannelId || '');
        if (linesRef.current.length === 0) setTaxReady(true);
      })
      .catch((error) => onError(error instanceof Error ? error.message : 'Không tải được cấu hình lập đơn'));
  }, [onError]);

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
      .catch((error) => onError(error instanceof Error ? error.message : 'Không tải được địa chỉ khách hàng'));
  }, [collectionPolicy, customerId, customerMode, onError]);

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
        const rows = await apiRequest<SalesOrderSkuSearchOption[]>(`/api/sales-orders/sku-search?${query}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSkuResults(rows);
      } catch (error) {
        if (!controller.signal.aborted) onError(error instanceof Error ? error.message : 'Không tìm được hàng hóa');
      } finally {
        if (!controller.signal.aborted) setSkuLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [onError, skuTerm]);

  useEffect(() => {
    if (!entrySettings || !salesChannelId) return;
    const signature = `${customerMode}:${customerId}:${salesChannelId}`;
    if (pricingContextRef.current === signature) return;
    pricingContextRef.current = signature;
    const effectiveAt = new Date().toISOString();
    setPricingAt(effectiveAt);
    void repriceAll(effectiveAt, customerMode, customerId, salesChannelId);
  }, [customerId, customerMode, entrySettings, repriceAll, salesChannelId]);

  const quantitySignature = lines.map((line) => `${line.variantId}:${line.quantity}`).join('|');
  useEffect(() => {
    if (!entrySettings || !salesChannelId) return;
    if (!quantitySignatureRef.current) {
      quantitySignatureRef.current = quantitySignature;
      return;
    }
    if (quantitySignatureRef.current === quantitySignature) return;
    quantitySignatureRef.current = quantitySignature;
    const timer = window.setTimeout(() => {
      const effectiveAt = new Date().toISOString();
      setPricingAt(effectiveAt);
      void repriceAll(effectiveAt);
    }, REPRICE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [entrySettings, quantitySignature, repriceAll, salesChannelId]);

  async function addSku(option: SalesOrderSkuSearchOption) {
    if (!option.eligibility.selectable) return onError(option.eligibility.message);
    if (!salesChannelId) return onError('Hãy chọn kênh bán trước khi thêm hàng');
    if (linesRef.current.some((line) => line.variantId === option.id)) return onError('SKU này đã có trong đơn');
    const pending: LineDraft = {
      variantId: option.id,
      sku: option.sku,
      name: option.variantName,
      unitCode: option.unitCode ?? '',
      quantity: '1',
      taxMode: option.defaultTaxMode,
      taxRate: option.defaultTaxRate,
      baseUnitPriceMinor: '0',
      systemUnitPriceMinor: '0',
      manualUnitPriceMinor: '',
      manualReason: '',
      pricingFingerprint: '',
      priceSteps: [],
      resolvingPrice: true,
      priceError: null,
    };
    setTaxReady(true);
    setLines((current) => [...current, pending]);
    setSkuTerm('');
    setSkuResults([]);
    markDirty();
    try {
      const resolution = await priceFor({
        variantId: option.id,
        quantity: '1',
        mode: customerMode,
        selectedCustomerId: customerId,
        channelId: salesChannelId,
        effectiveAt: pricingAt,
      });
      setLines((current) => current.map((line) => line.variantId === option.id ? {
        ...line,
        baseUnitPriceMinor: resolution.baseUnitPriceMinor,
        systemUnitPriceMinor: resolution.systemUnitPriceMinor ?? resolution.finalUnitPriceMinor,
        pricingFingerprint: resolution.resolutionFingerprint,
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

  function enableManualPrice(index: number) {
    if (!canPriceOverride) return;
    setLines((current) => current.map((line, itemIndex) => itemIndex === index ? {
      ...line,
      manualUnitPriceMinor: line.systemUnitPriceMinor,
      manualReason: '',
    } : line));
    markDirty();
  }

  function useSystemPrice(index: number) {
    setLines((current) => current.map((line, itemIndex) => itemIndex === index ? {
      ...line,
      manualUnitPriceMinor: '',
      manualReason: '',
    } : line));
    markDirty();
  }

  async function createQuickCustomer() {
    if (!quickCustomer.name.trim()) return onError('Hãy nhập tên khách hàng');
    if (deliveryMode === 'DELIVERY' && !quickCustomer.addressLine1.trim()) {
      return onError('Khách giao hàng cần địa chỉ');
    }
    setBusy(true);
    try {
      const phone = normalizedPhone(quickCustomer.phone);
      if (phone) {
        const query = new URLSearchParams({ search: phone, active: 'true', limit: '30', offset: '0' });
        const matches = await apiRequest<Customer[]>(`/api/customers?${query}`);
        const duplicate = matches.find((item) => normalizedPhone(item.phone) === phone);
        if (duplicate) {
          setCustomerRows((current) => [duplicate, ...current.filter((item) => item.id !== duplicate.id)]);
          setCustomerMode('EXISTING');
          setCustomerId(duplicate.id);
          setQuickOpen(false);
          markDirty();
          throw new Error(`Số điện thoại đã thuộc khách ${duplicate.code} — ${duplicate.name}; hệ thống đã chọn khách này thay vì tạo trùng.`);
        }
      }
      const created = await apiRequest<Customer>('/api/customers', {
        method: 'POST',
        headers: { 'Idempotency-Key': quickCustomerKey },
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
        createdAddress = await apiRequest<CustomerAddress>(`/api/customers/${created.id}/addresses`, {
          method: 'POST',
          headers: { 'Idempotency-Key': quickAddressKey },
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
      setQuickCustomerKey(mutationKey('sales-quick-customer'));
      setQuickAddressKey(mutationKey('sales-quick-address'));
      markDirty();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không tạo nhanh được khách hàng');
    } finally {
      setBusy(false);
    }
  }

  function validate(): string | null {
    if (!entrySettings) return 'Chưa tải được cấu hình lập đơn';
    if (!salesChannelId) return 'Hãy chọn kênh bán';
    if (!entrySettings.salesChannels.some((channel) => channel.id === salesChannelId)) return 'Kênh bán không còn hoạt động';
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
    if (lines.some((line) => line.priceError || !line.pricingFingerprint)) return 'Có dòng hàng chưa phân giải được giá bán';
    if (lines.some((line) => line.manualUnitPriceMinor && (!canPriceOverride || !/^\d+$/.test(line.manualUnitPriceMinor) || !line.manualReason.trim()))) {
      return 'Giá ngoại lệ cần đúng quyền, giá bán cuối hợp lệ và lý do riêng từng dòng';
    }
    if (!taxReady) return 'Chưa tải được chính sách thuế mặc định từ Core';
    if (!estimate.valid) return 'Chiết khấu bổ sung không hợp lệ hoặc vượt tiền hàng';
    if (estimate.discount > 0n && (!canDiscountOverride || !documentDiscountReason.trim())) {
      return 'Chiết khấu bổ sung toàn đơn cần đúng quyền và lý do';
    }
    return null;
  }

  function payload(): SalesOrderDraftPayload {
    return {
      sourceType: 'MANUAL',
      customerMode,
      ...(customerMode === 'EXISTING' ? { customerId } : {
        walkInDisplayName: walkInDisplayName.trim() || undefined,
        walkInPhone: walkInPhone.trim() || undefined,
      }),
      ...(deliveryMode === 'DELIVERY' ? { customerAddressId: addressId } : {}),
      warehouseId,
      salesChannelId,
      pricingAt,
      deliveryMode,
      collectionPolicy,
      currency: 'VND',
      ...(requestedDeliveryDate ? { requestedDeliveryDate } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(props.mode === 'create' ? {} : { expectedRevision: version?.revision }),
      documentDiscountMode,
      documentDiscountValue: documentDiscountMode === 'NONE' ? '0' : documentDiscountValue,
      ...(estimate.discount > 0n ? { documentDiscountReason: documentDiscountReason.trim() } : {}),
      lines: lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        taxMode: line.taxMode,
        taxRate: line.taxRate,
        expectedSystemUnitPriceMinor: line.systemUnitPriceMinor,
        expectedPricingFingerprint: line.pricingFingerprint,
        ...(line.manualUnitPriceMinor ? {
          manualUnitPriceMinor: line.manualUnitPriceMinor,
          manualReason: line.manualReason.trim(),
        } : {}),
      })),
    };
  }

  async function save(confirmAfter: boolean) {
    const issue = validate();
    if (issue) return onError(issue);
    setBusy(true);
    let savedOrder: SalesOrder | null = null;
    try {
      let path = '/api/sales-orders';
      let method = 'POST';
      let draftPayload = payload();
      const recovery = committedDraftRef.current
        ? draftRecoveryTarget(
          committedDraftRef.current,
          props.mode === 'amendment' ? version?.versionNumber : null,
        )
        : null;
      if (recovery) {
        path = recovery.path;
        method = 'PUT';
        draftPayload = { ...draftPayload, expectedRevision: recovery.expectedRevision };
      } else if (props.mode === 'draft') {
        path = `/api/sales-orders/${props.orderId}/draft`;
        method = 'PUT';
      } else if (props.mode === 'amendment') {
        path = `/api/sales-orders/${props.orderId}/amendments/${version?.versionNumber}/draft`;
        method = 'PUT';
      }
      savedOrder = await apiRequest<SalesOrder>(path, {
        method,
        headers: { 'Idempotency-Key': saveKey },
        body: JSON.stringify(draftPayload),
      });
      committedDraftRef.current = savedOrder;
      setSaveKey(mutationKey(`sales-${props.mode}-save`));
      if (confirmAfter) {
        const confirmPath = props.mode === 'amendment'
          ? `/api/sales-orders/${savedOrder.id}/amendments/${version?.versionNumber}/confirm`
          : `/api/sales-orders/${savedOrder.id}/confirm`;
        savedOrder = await apiRequest<SalesOrder>(confirmPath, {
          method: 'POST',
          headers: { 'Idempotency-Key': confirmKey },
          body: JSON.stringify({}),
        });
        committedDraftRef.current = null;
      }
      setDirty(false);
      props.onSaved(savedOrder);
    } catch (error) {
      if (error instanceof SalesOrderUiError && error.code === 'SALES_PRICE_CHANGED') {
        setPricingMismatch('Giá hệ thống đã thay đổi. Hệ thống đã tính lại; hãy xem từng dòng rồi lưu lại.');
        const effectiveAt = new Date().toISOString();
        setPricingAt(effectiveAt);
        setConfirmKey(mutationKey(`sales-${props.mode}-confirm`));
        await repriceAll(effectiveAt);
        onError('Giá hệ thống đã thay đổi; cần review trước khi lưu.');
      } else {
        if (error instanceof SalesOrderUiError && !error.retryable) {
          setSaveKey(mutationKey(`sales-${props.mode}-save`));
          setConfirmKey(mutationKey(`sales-${props.mode}-confirm`));
        }
        onError(error instanceof Error ? error.message : 'Không lưu được đơn bán hàng');
      }
    } finally {
      setBusy(false);
    }
  }

  function openQuickCustomerForDelivery() {
    setQuickCustomerKey(mutationKey('sales-quick-customer'));
    setQuickAddressKey(mutationKey('sales-quick-address'));
    setCustomerMode('EXISTING');
    setDeliveryMode('DELIVERY');
    setQuickOpen(true);
    markDirty();
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section className={styles.orderEditorModal} role="dialog" aria-modal="true" aria-label="Biểu mẫu đơn bán hàng">
        <header className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Bán hàng · Điều khiển thương mại</p>
            <h2>{props.mode === 'create' ? 'Tạo đơn bán hàng' : props.mode === 'amendment' ? `Sửa bản điều chỉnh ${version?.versionNumber}` : 'Sửa đơn bán hàng nháp'}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={requestClose} aria-label="Đóng">×</button>
        </header>

        <div className={styles.orderEditorBody} data-testid="sales-order-scroll-body">
          {pricingMismatch && <div className={styles.pricingMismatch} role="alert">{pricingMismatch}</div>}
          <section className={styles.compactHeader} aria-label="Thông tin đơn hàng">
            <div className={styles.customerModeRow}>
              <button type="button" className={customerMode === 'EXISTING' ? styles.segmentActive : styles.segment} onClick={() => { setCustomerMode('EXISTING'); markDirty(); }}>Khách đã có</button>
              <button type="button" className={customerMode === 'WALK_IN' ? styles.segmentActive : styles.segment} onClick={() => { setCustomerMode('WALK_IN'); markDirty(); }}>Khách vãng lai</button>
              {props.canQuickCreateCustomer && <button type="button" className={styles.linkButton} onClick={() => setQuickOpen((value) => !value)}>+ Tạo nhanh khách mới</button>}
            </div>

            {customerMode === 'EXISTING' ? (
              <label className={styles.customerField}><span>Khách hàng *</span><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tìm mã, tên hoặc số điện thoại" /><select value={customerId} onChange={(event) => { setCustomerId(event.target.value); markDirty(); }}><option value="">Chọn khách hàng</option>{activeCustomers.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}{item.phone ? ` · ${item.phone}` : ''}</option>)}</select></label>
            ) : (
              <div className={styles.walkInFields}>
                <label><span>Tên khách (tùy chọn)</span><input value={walkInDisplayName} onChange={(event) => { setWalkInDisplayName(event.target.value); markDirty(); }} placeholder="Ví dụ: Anh Nam" /></label>
                <label><span>Số điện thoại (tùy chọn)</span><input value={walkInPhone} onChange={(event) => { setWalkInPhone(event.target.value); markDirty(); }} placeholder="Dùng tra cứu lại đơn" /></label>
                <span>Nhận tại kho; vẫn áp giá theo kênh/chương trình, không áp giá nhóm hoặc riêng khách.</span>
                {props.canQuickCreateCustomer && <button type="button" className={styles.linkButton} onClick={openQuickCustomerForDelivery}>Cần giao hàng? Tạo khách chính thức</button>}
              </div>
            )}

            <label className={styles.salesChannelField}><span>Kênh bán *</span><select data-testid="sales-channel-select" value={salesChannelId} onChange={(event) => { setSalesChannelId(event.target.value); markDirty(); }}><option value="">Chọn kênh bán</option>{entrySettings?.salesChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.code} — {channel.name}</option>)}</select></label>
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
              <header><div><strong>Tạo nhanh khách chính thức</strong><span>Kiểm tra trùng điện thoại, tạo và chọn ngay trong đơn.</span></div><button type="button" onClick={() => setQuickOpen(false)}>Đóng</button></header>
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
            <p className={styles.keyboardHint}>Gõ để tìm, ↑↓ để chọn, Enter để thêm. Core tự chọn bảng giá theo khách, kênh, SKU, số lượng và hiệu lực.</p>
          </section>

          <section className={styles.orderLines} aria-label="Hàng hóa trong đơn">
            <header className={styles.lineTableHeader}><span>Hàng hóa</span><span>Số lượng</span><span>Giá nền</span><span>Giá hệ thống</span><span>Giá cuối</span><span>Thành tiền</span><span /></header>
            {lines.map((line, index) => (
              <article className={styles.orderLineCard} key={line.variantId} data-testid={`sales-order-line-${index + 1}`}>
                <div className={styles.lineIdentity}>
                  <strong>{line.sku} — {line.name}</strong>
                  <div className={styles.inlineActions}>
                    <span>ĐVT {line.unitCode || '—'}</span>
                    <button
                      type="button"
                      className={styles.linkButton}
                      aria-expanded={expandedLineId === line.variantId}
                      aria-controls={`sales-order-line-details-${index + 1}`}
                      onClick={() => setExpandedLineId((current) => current === line.variantId ? null : line.variantId)}
                    >
                      {expandedLineId === line.variantId ? 'Ẩn chi tiết' : 'Chi tiết'}
                    </button>
                  </div>
                  {line.priceError && <small className={styles.ineligible}>{line.priceError}</small>}
                </div>
                <label><span>SL</span><input inputMode="decimal" value={line.quantity} onChange={(event) => { const value = event.target.value; setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: value, priceError: null } : item)); markDirty(); }} /></label>
                <div className={styles.priceCell}><span>Giá nền</span><strong>{line.resolvingPrice ? 'Đang tính…' : vnd(line.baseUnitPriceMinor)}</strong></div>
                <div className={styles.priceCell}><span>Giá hệ thống</span><strong>{line.resolvingPrice ? 'Đang tính…' : vnd(line.systemUnitPriceMinor)}</strong><small>{pricingSummary(line)}</small></div>
                <div className={styles.priceCell}>
                  <span>Giá bán cuối</span>
                  <div className={styles.inlineActions}>
                    <strong>{line.resolvingPrice ? 'Đang tính…' : vnd(finalUnitPrice(line))}</strong>
                    {!line.manualUnitPriceMinor && canPriceOverride && (
                      <button type="button" className={styles.linkButton} aria-label={`Dùng giá ngoại lệ cho ${line.sku}`} onClick={() => enableManualPrice(index)}>Giá ngoại lệ</button>
                    )}
                    {line.manualUnitPriceMinor && (
                      <button type="button" className={styles.linkButton} aria-label={`Dùng lại giá hệ thống cho ${line.sku}`} onClick={() => useSystemPrice(index)}>Giá hệ thống</button>
                    )}
                  </div>
                  {line.manualUnitPriceMinor && <small className={styles.manualBadge}>Giá ngoại lệ</small>}
                </div>
                <div className={styles.priceCell}><span>Tiền hàng dự kiến</span><strong>{vnd(grossMinor(line))}</strong></div>
                <button type="button" className={styles.removeLineButton} onClick={() => { setLines((current) => current.filter((_, itemIndex) => itemIndex !== index)); markDirty(); }}>Xóa</button>

                {line.manualUnitPriceMinor && (
                  <div className={styles.manualPriceEditor}>
                    <label><span>Giá bán cuối *</span><input inputMode="numeric" value={line.manualUnitPriceMinor} onChange={(event) => { const value = event.target.value.replace(/\D/g, ''); setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, manualUnitPriceMinor: value } : item)); markDirty(); }} /></label>
                    <label><span>Lý do giá ngoại lệ *</span><input value={line.manualReason} maxLength={500} onChange={(event) => { const value = event.target.value; setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, manualReason: value } : item)); markDirty(); }} placeholder="Lý do riêng cho SKU này" /></label>
                    <p>Giá hệ thống để đối chiếu: <strong>{vnd(line.systemUnitPriceMinor)}</strong></p>
                  </div>
                )}
                <div
                  id={`sales-order-line-details-${index + 1}`}
                  className={styles.lineDetails}
                  hidden={expandedLineId !== line.variantId}
                >
                  <div className={styles.priceTrace}>
                    {line.priceSteps.length === 0 && <span>Core sẽ tái phân giải khi lưu.</span>}
                    {line.priceSteps.filter((step) => step.kind !== 'RESOLUTION').map((step, stepIndex) => <div key={`${step.kind}-${stepIndex}`}><span>{pricingLabel(step)}{step.reason ? ` · ${step.reason}` : ''}</span><b>{step.afterUnitPriceMinor ? vnd(step.afterUnitPriceMinor) : '—'}</b></div>)}
                    <div><span>Ngữ cảnh</span><b>{customerMode === 'WALK_IN' ? 'Khách vãng lai' : 'Khách/nhóm khách'} · {entrySettings?.salesChannels.find((channel) => channel.id === salesChannelId)?.code ?? 'Chưa chọn kênh'}</b></div>
                    <div><span>Thuế Core · {line.taxMode === 'INCLUSIVE' ? 'Giá đã gồm thuế' : 'Giá chưa gồm thuế'} · {line.taxRate}%</span><b>Tính lại sau phân bổ CK đơn</b></div>
                  </div>
                </div>
              </article>
            ))}
            {lines.length === 0 && <p className={styles.empty}>Chưa có hàng hóa. Dùng ô tìm nhanh phía trên để thêm hàng.</p>}
          </section>
          <div data-testid="sales-order-scroll-sentinel" className={styles.scrollSentinel}>Cuối danh sách hàng hóa</div>
        </div>

        <footer className={styles.orderEditorFooter}>
          <section className={styles.documentDiscountPanel} aria-label="Chiết khấu bổ sung toàn đơn">
            <div><span>Promotion/bảng giá</span><strong>Đã phản ánh trong giá hệ thống</strong></div>
            {canDiscountOverride ? (
              <>
                <label><span>Chiết khấu bổ sung toàn đơn</span><select data-testid="document-discount-mode" value={documentDiscountMode} onChange={(event) => { const mode = event.target.value as SalesOrderDocumentDiscountMode; setDocumentDiscountMode(mode); if (mode === 'NONE') { setDocumentDiscountValue('0'); setDocumentDiscountReason(''); } markDirty(); }}><option value="NONE">Không áp dụng</option><option value="PERCENT">Phần trăm</option><option value="TOTAL_AMOUNT">Tổng tiền VND</option></select></label>
                {documentDiscountMode !== 'NONE' && <label><span>{documentDiscountMode === 'PERCENT' ? 'Tỷ lệ %' : 'Số tiền VND'}</span><input inputMode="decimal" value={documentDiscountValue} onChange={(event) => { setDocumentDiscountValue(event.target.value); markDirty(); }} /></label>}
                {documentDiscountMode !== 'NONE' && <label className={styles.documentDiscountReason}><span>Lý do *</span><input value={documentDiscountReason} maxLength={1000} onChange={(event) => { setDocumentDiscountReason(event.target.value); markDirty(); }} /></label>}
              </>
            ) : (
              <p>Không có quyền nhập chiết khấu bổ sung.</p>
            )}
          </section>
          <section className={styles.taxSummary} aria-label="Tổng kết thuế và thanh toán">
            <div><span>Tiền hàng theo giá cuối</span><strong>{vnd(estimate.gross)}</strong></div>
            <div><span>Chiết khấu bổ sung toàn đơn</span><strong>- {vnd(estimate.discount)}</strong></div>
            <div><span>Thuế sau phân bổ</span><strong>{vnd(estimate.tax)}</strong></div>
            <div className={styles.grandTotal}><span>Tổng thanh toán dự kiến</span><strong>{vnd(estimate.total)}</strong></div>
          </section>
          <div className={styles.footerActions}>
            <button type="button" onClick={requestClose}>Đóng</button>
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save(false)}>{busy ? 'Đang lưu…' : 'Lưu nháp'}</button>
            {props.canConfirm && <button type="button" className={styles.confirmButton} disabled={busy} onClick={() => void save(true)}>Lưu và xác nhận</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
