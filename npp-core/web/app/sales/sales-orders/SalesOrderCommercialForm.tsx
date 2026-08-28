'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Customer, CustomerAddress } from '../../../lib/customer-types';
import type { Product } from '../../../lib/product-types';
import type { Warehouse } from '../../../lib/organization-types';
import { pricingPolicyLabel, pricingResolutionReasonLabel } from '../../../lib/business-language';
import { MIN_PRODUCT_SEARCH_LENGTH } from '../../../lib/product-search-contract';
import { BusinessSequenceNumber } from '../../components/business-table-sequence';
import type {
  SalesOrder,
  SalesOrderCollectionPolicy,
  SalesOrderCustomerMode,
  SalesOrderDeliveryExecutionMode,
  SalesOrderDocumentDiscountMode,
  SalesOrderDraftPayload,
  SalesOrderEntrySettings,
  SalesOrderLineDiscountMode,
  SalesOrderSkuSearchOption,
  SalesOrderSkuSearchPreview,
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

export type SalesOrderFormMode = 'create' | 'draft' | 'amendment' | 'manual-edit';

const SEARCH_DELAY_MS = 120;
const SEARCH_PAGE_SIZE = 30;
const REPRICE_DELAY_MS = 320;
const SCALE = 1_000_000n;
const HUNDRED = 100n * SCALE;

type LineDraft = {
  clientLineId: string;
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
  discountMode: SalesOrderLineDiscountMode;
  discountValue: string;
  pricingFingerprint: string;
  priceSteps: SalesPriceStep[];
  resolvingPrice: boolean;
  priceError: string | null;
  pricingErrorCode: string | null;
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

export function compactQuantity(value: string | number | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return normalized;
  const [whole, fraction = ''] = normalized.split('.');
  const compactFraction = fraction.replace(/0+$/, '');
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

function formatScaledQuantity(value: bigint): string {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function stepQuantity(value: string, direction: -1 | 1): string {
  const current = parseScaled(compactQuantity(value), false);
  if (current === null) return direction > 0 ? '1' : compactQuantity(value);
  const next = current + BigInt(direction) * SCALE;
  return next > 0n ? formatScaledQuantity(next) : compactQuantity(value);
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
  const documentDiscountActive = version?.documentDiscountMode !== 'NONE'
    && (parseScaled(version?.documentDiscountValue ?? '0', true) ?? 0n) > 0n;
  return (version?.lines ?? []).map((line) => ({
    clientLineId: line.id,
    variantId: line.variantId,
    sku: line.sku,
    name: line.itemName,
    unitCode: line.unitCode,
    quantity: compactQuantity(line.quantity),
    taxMode: line.taxMode,
    taxRate: line.taxRate,
    baseUnitPriceMinor: line.baseUnitPrice ?? line.unitPrice,
    systemUnitPriceMinor: line.systemUnitPrice ?? line.unitPrice,
    manualUnitPriceMinor: line.priceSource === 'MANUAL_OVERRIDE' ? line.unitPrice : '',
    discountMode: documentDiscountActive ? 'TOTAL_AMOUNT' : line.discountMode,
    discountValue: documentDiscountActive ? '0' : line.discountValue,
    pricingFingerprint: resolutionFingerprint(line.pricingTrace ?? []),
    priceSteps: line.pricingTrace ?? [],
    resolvingPrice: false,
    priceError: null,
    pricingErrorCode: null,
  }));
}

function finalUnitPrice(line: LineDraft): string {
  return line.manualUnitPriceMinor.trim() || line.systemUnitPriceMinor;
}

function hasValidManualPrice(line: LineDraft): boolean {
  return /^\d+$/.test(line.manualUnitPriceMinor.trim());
}

function automaticPriceText(line: LineDraft, value: string): string {
  if (line.resolvingPrice) return 'Đang tính…';
  if (!line.pricingFingerprint) return 'Chưa có';
  return vnd(value);
}

function pricingErrorDetails(error: unknown): { code: string | null; message: string } {
  if (error instanceof SalesOrderUiError && error.code === 'BASE_PRICE_NOT_FOUND') {
    return {
      code: error.code,
      message: 'Chưa có giá Công Ty. Nhập giá bán cho dòng này để tiếp tục.',
    };
  }
  return {
    code: error instanceof SalesOrderUiError ? error.code : null,
    message: error instanceof Error ? error.message : 'Không phân giải được giá',
  };
}

function grossMinor(line: LineDraft): bigint {
  const quantity = parseScaled(line.quantity, false) ?? 0n;
  const price = /^\d+$/.test(finalUnitPrice(line)) ? BigInt(finalUnitPrice(line)) : 0n;
  return halfUp(quantity * price, SCALE);
}

function lineDiscountMinor(line: LineDraft): bigint | null {
  const gross = grossMinor(line);
  const quantity = parseScaled(line.quantity, false);
  const scaled = parseScaled(line.discountValue || '0', true);
  if (scaled === null || quantity === null) return null;
  let discount: bigint;
  if (line.discountMode === 'PERCENT') {
    if (scaled > HUNDRED) return null;
    discount = halfUp(gross * scaled, HUNDRED);
  } else {
    if (scaled % SCALE !== 0n) return null;
    const money = scaled / SCALE;
    discount = line.discountMode === 'PER_UNIT'
      ? halfUp(quantity * money, SCALE)
      : money;
  }
  return discount <= gross ? discount : null;
}

function discountValueText(line: LineDraft): string {
  const value = line.discountValue || '0';
  if (line.discountMode === 'PERCENT') return `${value}%`;
  return line.discountMode === 'PER_UNIT' ? `${vnd(value)} / ĐVT` : vnd(value);
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
  if (step.kind === 'RESOLUTION') return 'Chi tiết hình thành giá';
  if (step.kind === 'BASE') return step.priceListCode ? `Giá nền · ${step.priceListCode}` : 'Giá nền';
  if (step.kind === 'MANUAL_OVERRIDE') return 'Giá điều chỉnh thủ công';
  if (step.kind === 'SKIPPED') {
    const reason = pricingResolutionReasonLabel(step.reason);
    return `Không áp dụng${step.priceListCode ? ` · ${step.priceListCode}` : ''}${reason ? ` · ${reason}` : ''}`;
  }
  const adjustment = {
    FIXED_PRICE: 'Giá cố định',
    PERCENT_DISCOUNT: 'Giảm %',
    AMOUNT_DISCOUNT: 'Giảm tiền',
    PERCENT_MARKUP: 'Tăng %',
    AMOUNT_MARKUP: 'Tăng tiền',
  }[step.adjustmentType ?? ''] ?? 'Điều chỉnh';
  return `${pricingPolicyLabel(step.priceListCode, step.priceListType)} · ${adjustment}`;
}

function searchPriceText(option: SalesOrderSkuSearchOption): string {
  if (option.pricePreview.status === 'PENDING') return 'Đang tính giá…';
  if (option.pricePreview.status === 'RESOLVED' && option.pricePreview.unitPriceMinor !== null) {
    return vnd(option.pricePreview.unitPriceMinor);
  }
  return option.pricePreview.status === 'MISSING' ? 'Chưa có giá' : 'Chưa tính được giá';
}

function searchInventoryPrimary(option: SalesOrderSkuSearchOption): string {
  if (option.inventoryPreview.status === 'PENDING') return 'Đang lấy tồn…';
  if (option.inventoryPreview.status === 'NOT_MANAGED') return 'Không quản lý tồn';
  if (option.inventoryPreview.status !== 'TRACKED') return 'Chưa có số liệu tồn';
  const unit = option.inventoryPreview.unitCode ? ` ${option.inventoryPreview.unitCode}` : '';
  return `Tồn ${compactQuantity(option.inventoryPreview.onHandQuantity)}${unit}`;
}

function searchInventorySecondary(option: SalesOrderSkuSearchOption): string | null {
  if (option.inventoryPreview.status !== 'TRACKED') return null;
  const unit = option.inventoryPreview.unitCode ? ` ${option.inventoryPreview.unitCode}` : '';
  return `Khả dụng ${compactQuantity(option.inventoryPreview.availableQuantity)}${unit}`;
}

function withPendingSearchPreview(option: Omit<SalesOrderSkuSearchOption, 'pricePreview' | 'inventoryPreview'>): SalesOrderSkuSearchOption {
  return {
    ...option,
    pricePreview: { status: 'PENDING', unitPriceMinor: null, message: null },
    inventoryPreview: {
      status: 'PENDING',
      onHandQuantity: null,
      availableQuantity: null,
      unitCode: null,
    },
  };
}

function pricingSummary(line: LineDraft): string {
  if (!line.pricingFingerprint) return 'Chưa có giá Công Ty';
  const applied = line.priceSteps.filter((step) => step.kind === 'RULE');
  if (applied.length === 0) return 'Giá nền';
  const labels = applied
    .slice(0, 2)
    .map((step) => pricingPolicyLabel(step.priceListCode, step.priceListType));
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
  const [deliveryExecutionMode, setDeliveryExecutionMode] = useState<SalesOrderDeliveryExecutionMode | null>(
    version?.deliveryMode === 'PICKUP' ? null : (version?.deliveryExecutionMode ?? 'TRIP'),
  );
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
  const [skuPreviewLoading, setSkuPreviewLoading] = useState(false);
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
  const quantityRefs = useRef(new Map<string, HTMLInputElement>());
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  const pricingContextRef = useRef('');
  const quantitySignatureRef = useRef('');
  const pricingRunRef = useRef(0);
  const skuSearchRunRef = useRef(0);

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
    const lineDiscounts = lines.map(lineDiscountMinor);
    const lineDiscountValid = lineDiscounts.every((value) => value !== null);
    const lineDiscountValues = lineDiscounts.map((value) => value ?? 0n);
    const lineDiscountTotal = lineDiscountValues.reduce((sum, value) => sum + value, 0n);
    const target = documentDiscountTarget(documentDiscountMode, documentDiscountValue, grossTotal);
    const documentAllocations = target === null ? null : largestRemainder(gross, target);
    const documentDiscountTotal = documentAllocations?.reduce((sum, value) => sum + value, 0n) ?? 0n;
    const mixedScope = lineDiscountTotal > 0n && documentDiscountTotal > 0n;
    const effectiveDiscounts = documentDiscountTotal > 0n
      ? (documentAllocations ?? gross.map(() => 0n))
      : lineDiscountValues;
    const details = lines.map((line, index) => estimateLine(line, effectiveDiscounts[index] ?? 0n));
    return {
      valid: target !== null && documentAllocations !== null && lineDiscountValid && !mixedScope,
      gross: grossTotal,
      discount: effectiveDiscounts.reduce((sum, value) => sum + value, 0n),
      tax: details.reduce((sum, value) => sum + value.tax, 0n),
      total: details.reduce((sum, value) => sum + value.total, 0n),
      lineDiscountTotal,
      documentDiscountTotal,
      mixedScope,
      details,
    };
  }, [documentDiscountMode, documentDiscountValue, lines]);

  const hasLineDiscount = lines.some((line) => (parseScaled(line.discountValue || '0', true) ?? 0n) > 0n);

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
    setLines((current) => current.map((line) => ({ ...line, resolvingPrice: true, priceError: null, pricingErrorCode: null })));
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
          clientLineId: line.clientLineId,
          baseUnitPriceMinor: resolution.baseUnitPriceMinor,
          systemUnitPriceMinor: resolution.systemUnitPriceMinor ?? resolution.finalUnitPriceMinor,
          pricingFingerprint: resolution.resolutionFingerprint,
          priceSteps: resolution.steps,
          priceError: null,
          pricingErrorCode: null,
        };
      } catch (error) {
        const details = pricingErrorDetails(error);
        return {
          clientLineId: line.clientLineId,
          baseUnitPriceMinor: line.baseUnitPriceMinor,
          systemUnitPriceMinor: line.systemUnitPriceMinor,
          pricingFingerprint: '',
          priceSteps: [],
          priceError: details.message,
          pricingErrorCode: details.code,
        };
      }
    }));
    if (run !== pricingRunRef.current) return;
    const byLineId = new Map(results.map((result) => [result.clientLineId, result]));
    setLines((current) => current.map((line) => {
      const result = byLineId.get(line.clientLineId);
      return result ? { ...line, ...result, resolvingPrice: false } : line;
    }));
  }, [customerId, customerMode, priceFor, salesChannelId]);

  useEffect(() => {
    apiRequest<SalesOrderEntrySettings>('/api/sales-orders/entry-settings')
      .then((settings) => {
        setEntrySettings(settings);
        setSalesChannelId((current) => current || settings.defaultSalesChannelId || '');
        setWarehouseId((current) => current || settings.defaultWarehouseId || '');
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
      setDeliveryExecutionMode(null);
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
    const run = ++skuSearchRunRef.current;
    setActiveSkuIndex(0);
    if (term.length < MIN_PRODUCT_SEARCH_LENGTH || !warehouseId || !salesChannelId) {
      setSkuResults([]);
      setSkuLoading(false);
      setSkuPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setSkuResults([]);
    setSkuPreviewLoading(false);
    const timer = window.setTimeout(async () => {
      setSkuLoading(true);
      try {
        const query = new URLSearchParams({
          search: term,
          limit: String(SEARCH_PAGE_SIZE),
          offset: '0',
        });
        const rows = await apiRequest<Omit<SalesOrderSkuSearchOption, 'pricePreview' | 'inventoryPreview'>[]>(`/api/sales-orders/sku-search?${query}`, { signal: controller.signal });
        if (controller.signal.aborted || run !== skuSearchRunRef.current) return;
        setSkuResults(rows.map(withPendingSearchPreview));
        setSkuLoading(false);
        if (rows.length === 0) return;

        setSkuPreviewLoading(true);
        const previewQuery = new URLSearchParams({ warehouseId, salesChannelId, pricingAt });
        if (customerMode === 'EXISTING' && customerId) previewQuery.set('customerId', customerId);
        for (const row of rows) previewQuery.append('variantId', row.id);
        try {
          const previews = await apiRequest<SalesOrderSkuSearchPreview[]>(`/api/sales-orders/sku-previews?${previewQuery}`, { signal: controller.signal });
          if (controller.signal.aborted || run !== skuSearchRunRef.current) return;
          const previewById = new Map(previews.map((preview) => [preview.id, preview]));
          setSkuResults((current) => current.map((option) => {
            const preview = previewById.get(option.id);
            if (!preview) return option;
            return {
              ...option,
              eligibility: option.eligibility.selectable
                ? { ...option.eligibility, message: preview.eligibilityMessage }
                : option.eligibility,
              pricePreview: preview.pricePreview,
              inventoryPreview: preview.inventoryPreview,
            };
          }));
        } finally {
          if (!controller.signal.aborted && run === skuSearchRunRef.current) setSkuPreviewLoading(false);
        }
      } catch (error) {
        if (!controller.signal.aborted) onError(error instanceof Error ? error.message : 'Không tìm được hàng hóa');
      } finally {
        if (!controller.signal.aborted && run === skuSearchRunRef.current) setSkuLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerId, customerMode, onError, pricingAt, salesChannelId, skuTerm, warehouseId]);

  useEffect(() => {
    if (!entrySettings || !salesChannelId) return;
    const signature = `${customerMode}:${customerId}:${salesChannelId}`;
    if (pricingContextRef.current === signature) return;
    pricingContextRef.current = signature;
    const effectiveAt = new Date().toISOString();
    setPricingAt(effectiveAt);
    void repriceAll(effectiveAt, customerMode, customerId, salesChannelId);
  }, [customerId, customerMode, entrySettings, repriceAll, salesChannelId]);

  const quantitySignature = lines.map((line) => `${line.clientLineId}:${line.quantity}`).join('|');
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

  function focusLineQuantity(clientLineId: string) {
    window.setTimeout(() => {
      const input = quantityRefs.current.get(clientLineId);
      input?.focus();
      input?.select();
    }, 0);
  }

  function focusLinePrice(clientLineId: string) {
    window.setTimeout(() => {
      const input = priceRefs.current.get(clientLineId);
      input?.focus();
      input?.select();
    }, 0);
  }

  async function addSku(option: SalesOrderSkuSearchOption) {
    if (!option.eligibility.selectable) return onError(option.eligibility.message);
    if (!salesChannelId) return onError('Hãy chọn kênh bán trước khi thêm hàng');
    if (linesRef.current.some((line) => line.variantId === option.id)) {
      return onError('Hàng này đã có trong đơn. Dùng Tách dòng nếu cần thêm dòng riêng.');
    }
    const pending: LineDraft = {
      clientLineId: crypto.randomUUID(),
      variantId: option.id,
      sku: option.sku,
      name: option.productName,
      unitCode: option.unitCode ?? '',
      quantity: '1',
      taxMode: option.defaultTaxMode,
      taxRate: option.defaultTaxRate,
      baseUnitPriceMinor: '0',
      systemUnitPriceMinor: '0',
      manualUnitPriceMinor: '',
      discountMode: 'PERCENT',
      discountValue: '0',
      pricingFingerprint: '',
      priceSteps: [],
      resolvingPrice: true,
      priceError: null,
      pricingErrorCode: null,
    };
    setTaxReady(true);
    setLines((current) => [...current, pending]);
    setSkuTerm('');
    setSkuResults([]);
    focusLineQuantity(pending.clientLineId);
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
      setLines((current) => current.map((line) => line.clientLineId === pending.clientLineId ? {
        ...line,
        baseUnitPriceMinor: resolution.baseUnitPriceMinor,
        systemUnitPriceMinor: resolution.systemUnitPriceMinor ?? resolution.finalUnitPriceMinor,
        pricingFingerprint: resolution.resolutionFingerprint,
        priceSteps: resolution.steps,
        resolvingPrice: false,
        priceError: null,
        pricingErrorCode: null,
      } : line));
    } catch (error) {
      const details = pricingErrorDetails(error);
      setLines((current) => current.map((line) => line.clientLineId === pending.clientLineId ? {
        ...line,
        pricingFingerprint: '',
        priceSteps: [],
        resolvingPrice: false,
        priceError: details.message,
        pricingErrorCode: details.code,
      } : line));
    }
  }

  function splitLine(sourceClientLineId: string) {
    if (!canPriceOverride) return onError('Cần quyền Sửa giá bán trên đơn để tách dòng.');
    const source = linesRef.current.find((line) => line.clientLineId === sourceClientLineId);
    if (!source || source.resolvingPrice) return;
    const split: LineDraft = {
      ...source,
      clientLineId: crypto.randomUUID(),
      quantity: '1',
      manualUnitPriceMinor: '0',
      discountMode: 'PERCENT',
      discountValue: '0',
      pricingFingerprint: '',
      priceSteps: [],
      resolvingPrice: true,
      priceError: null,
      pricingErrorCode: null,
    };
    setLines((current) => {
      const sourceIndex = current.findIndex((line) => line.clientLineId === sourceClientLineId);
      if (sourceIndex < 0) return current;
      return [...current.slice(0, sourceIndex + 1), split, ...current.slice(sourceIndex + 1)];
    });
    markDirty();
    focusLinePrice(split.clientLineId);
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

  function changeQuantity(index: number, direction: -1 | 1) {
    setLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      quantity: stepQuantity(item.quantity, direction),
      pricingFingerprint: '',
      priceSteps: [],
      priceError: null,
      pricingErrorCode: null,
      resolvingPrice: true,
    } : item));
    markDirty();
  }

  function compactLineQuantity(index: number) {
    setLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      quantity: compactQuantity(item.quantity),
    } : item));
  }

  function useSystemPrice(index: number) {
    setLines((current) => current.map((line, itemIndex) => itemIndex === index ? {
      ...line,
      manualUnitPriceMinor: '',
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
    if (customerMode === 'WALK_IN' && deliveryMode !== 'PICKUP') return 'Khách vãng lai chỉ dùng Giao tại quầy';
    if (customerMode === 'WALK_IN' && !['PREPAID', 'COLLECT_ON_DELIVERY'].includes(collectionPolicy)) {
      return 'Khách vãng lai không được bán chịu hoặc giao trước thu sau';
    }
    if (deliveryMode === 'DELIVERY' && !deliveryExecutionMode) return 'Hãy chọn hình thức giao nhận';
    if (deliveryMode === 'DELIVERY' && !addressId) return 'Hãy chọn địa chỉ giao hàng';
    if (lines.length === 0) return 'Đơn bán hàng phải có ít nhất một SKU';
    if (lines.some((line) => !parseScaled(line.quantity, false))) return 'Số lượng hàng hóa chưa hợp lệ';
    if (lines.some((line) => line.resolvingPrice)) return 'Hệ thống đang tính giá, hãy đợi hoàn tất';
    if (lines.some((line) => {
      if (line.pricingFingerprint && !line.priceError) return false;
      return line.pricingErrorCode !== 'BASE_PRICE_NOT_FOUND' || !hasValidManualPrice(line);
    })) return 'Có dòng hàng chưa có giá bán hợp lệ';
    if (lines.some((line) => line.manualUnitPriceMinor && (!canPriceOverride || !hasValidManualPrice(line)))) {
      return 'Đơn giá sửa trực tiếp cần đúng quyền và là số tiền VND hợp lệ';
    }
    if (lines.some((line) => lineDiscountMinor(line) === null)) return 'Chiết khấu từng dòng không hợp lệ hoặc vượt tiền hàng';
    if (estimate.lineDiscountTotal > 0n && !canDiscountOverride) return 'Cần quyền sửa chiết khấu bán hàng để nhập CK từng dòng';
    if (estimate.mixedScope) return 'Chỉ dùng CK từng dòng hoặc chiết khấu toàn đơn trong cùng một đơn';
    if (!taxReady) return 'Chưa tải được chính sách thuế mặc định từ Công Ty';
    if (!estimate.valid) return 'Chiết khấu không hợp lệ hoặc vượt tiền hàng';
    if (estimate.documentDiscountTotal > 0n && (!canDiscountOverride || !documentDiscountReason.trim())) {
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
      ...(deliveryMode === 'DELIVERY' ? { deliveryExecutionMode: deliveryExecutionMode ?? 'TRIP' } : {}),
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
        quantity: compactQuantity(line.quantity),
        taxMode: line.taxMode,
        taxRate: line.taxRate,
        discountMode: line.discountMode,
        discountValue: line.discountValue || '0',
        ...(line.pricingFingerprint ? {
          expectedSystemUnitPriceMinor: line.systemUnitPriceMinor,
          expectedPricingFingerprint: line.pricingFingerprint,
        } : {}),
        ...(line.manualUnitPriceMinor ? {
          manualUnitPriceMinor: line.manualUnitPriceMinor,
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
      const recovery = props.mode === 'manual-edit' ? null : committedDraftRef.current
        ? draftRecoveryTarget(
          committedDraftRef.current,
          props.mode === 'amendment' ? version?.versionNumber : null,
        )
        : null;
      if (props.mode === 'manual-edit') {
        path = `/api/sales-orders/${props.orderId}/manual-edit`;
        method = 'PUT';
      } else if (recovery) {
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
      if (props.mode !== 'manual-edit') committedDraftRef.current = savedOrder;
      setSaveKey(mutationKey(`sales-${props.mode}-save`));
      if (confirmAfter && props.mode !== 'manual-edit') {
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
        if (props.mode === 'manual-edit') {
          setSaveKey(mutationKey('sales-manual-edit-save'));
        } else {
          setConfirmKey(mutationKey(`sales-${props.mode}-confirm`));
        }
        await repriceAll(effectiveAt);
        onError('Giá hệ thống đã thay đổi; cần kiểm tra lại trước khi lưu.');
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
    setDeliveryExecutionMode('TRIP');
    setQuickOpen(true);
    markDirty();
  }

  const deliveryChoice = deliveryMode === 'PICKUP' ? 'PICKUP' : (deliveryExecutionMode ?? 'TRIP');

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section className={styles.orderEditorModal} role="dialog" aria-modal="true" aria-label="Biểu mẫu đơn bán hàng">
        <header className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Bán hàng · Chính sách thương mại</p>
            <h2>{props.mode === 'create'
              ? 'Tạo đơn bán hàng'
              : props.mode === 'manual-edit'
                ? 'Sửa đơn'
                : props.mode === 'amendment'
                  ? `Sửa bản điều chỉnh ${version?.versionNumber}`
                  : 'Sửa đơn bán hàng nháp'}</h2>
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
                <span>Giao tại quầy; vẫn áp giá theo kênh/chương trình, không áp giá nhóm hoặc riêng khách.</span>
                {props.canQuickCreateCustomer && <button type="button" className={styles.linkButton} onClick={openQuickCustomerForDelivery}>Cần giao hàng? Tạo khách chính thức</button>}
              </div>
            )}

            <label><span>Kho xuất *</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); markDirty(); }}><option value="">Chọn kho</option>{props.warehouses.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
            <label><span>Hình thức giao nhận</span><select value={deliveryChoice} disabled={customerMode === 'WALK_IN'} onChange={(event) => {
              const value = event.target.value;
              if (value === 'PICKUP') {
                setDeliveryMode('PICKUP');
                setDeliveryExecutionMode(null);
              } else {
                setDeliveryMode('DELIVERY');
                setDeliveryExecutionMode(value as SalesOrderDeliveryExecutionMode);
              }
              markDirty();
            }}><option value="TRIP">Giao theo chuyến</option><option value="MANUAL">Giao thủ công</option><option value="PICKUP">Giao tại quầy</option></select></label>
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
              <div className={styles.productSearchControls}>
                <label className={styles.salesChannelField}><span>Kênh bán / nguồn giá *</span><select data-testid="sales-channel-select" value={salesChannelId} onChange={(event) => { setSalesChannelId(event.target.value); markDirty(); }}><option value="">Chọn kênh bán</option>{entrySettings?.salesChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.code} — {channel.name}</option>)}</select></label>
                <label><span>Tìm hàng nhanh</span><input ref={searchRef} value={skuTerm} onChange={(event) => setSkuTerm(event.target.value)} onKeyDown={handleSkuKeyDown} placeholder="Tên sản phẩm, mã hàng, SKU hoặc barcode" autoComplete="off" /></label>
              </div>
              {skuLoading && <span className={styles.searchStatus}>Đang tìm…</span>}
              {!skuLoading && skuPreviewLoading && <span className={styles.searchStatus}>Đang cập nhật giá và tồn…</span>}
              {skuResults.length > 0 && (
                <div className={styles.skuResults} role="listbox">
                  {skuResults.map((option, index) => (
                    <button type="button" key={option.id} className={index === activeSkuIndex ? styles.skuResultActive : styles.skuResult} disabled={!option.eligibility.selectable} onMouseDown={(event) => event.preventDefault()} onClick={() => void addSku(option)}>
                      <div><span>{option.productName}</span><strong>SKU {option.sku}</strong><small>{option.productCode}{option.variantName ? ` · ${option.variantName}` : ''}</small></div>
                      <div><b>{searchPriceText(option)}</b><small>{searchInventoryPrimary(option)}</small>{searchInventorySecondary(option) && <small>{searchInventorySecondary(option)}</small>}{option.barcode && <small>Barcode {option.barcode}</small>}<small className={option.eligibility.selectable ? styles.eligible : styles.ineligible}>{option.eligibility.message}</small></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className={styles.keyboardHint}>Gõ để tìm, ↑↓ để chọn, Enter để thêm. Công Ty tự chọn bảng giá theo khách, kênh, SKU, số lượng và hiệu lực.</p>
          </section>

          <section className={styles.orderLines} aria-label="Hàng hóa trong đơn">
            <header className={styles.lineTableHeader}><span>STT</span><span>Hàng hóa</span><span>ĐVT</span><span>SL</span><span>Đơn giá</span><span>CK</span><span>Thành tiền</span><span /></header>
            {lines.map((line, index) => (
              <article className={styles.orderLineCard} key={line.clientLineId} data-testid={`sales-order-line-${index + 1}`}>
                <BusinessSequenceNumber rowIndex={index} className={styles.lineSequence} />
                <div className={styles.lineIdentity}>
                  <strong>{line.name}</strong>
                  <div className={styles.inlineActions}>
                    <span>SKU {line.sku}</span>
                    <button
                      type="button"
                      className={styles.linkButton}
                      aria-expanded={expandedLineId === line.clientLineId}
                      aria-controls={`sales-order-line-details-${index + 1}`}
                      onClick={() => setExpandedLineId((current) => current === line.clientLineId ? null : line.clientLineId)}
                    >
                      {expandedLineId === line.clientLineId ? 'Ẩn chi tiết' : 'Chi tiết'}
                    </button>
                    <button
                      type="button"
                      className={styles.linkButton}
                      aria-label={`Tách dòng ${line.sku}`}
                      title="Tách dòng riêng cho bù hàng, khuyến mãi hoặc hàng tặng"
                      disabled={!canPriceOverride || line.resolvingPrice}
                      onClick={() => splitLine(line.clientLineId)}
                    >↳ Tách dòng</button>
                  </div>
                  {line.priceError && (
                    <small className={line.pricingErrorCode === 'BASE_PRICE_NOT_FOUND' ? styles.priceNotice : styles.ineligible}>
                      {line.priceError}{line.pricingErrorCode === 'BASE_PRICE_NOT_FOUND' && hasValidManualPrice(line) ? ' Đang dùng giá nhập tay.' : ''}
                    </small>
                  )}
                </div>
                <div className={styles.unitCell}><span>ĐVT</span><strong>{line.unitCode || '—'}</strong></div>
                <div className={styles.quantityCell}>
                  <span>SL</span>
                  <div className={styles.quantityStepper}>
                    <button type="button" className={styles.quantityMinus} aria-label={`Giảm số lượng ${line.sku}`} onClick={() => changeQuantity(index, -1)}>−</button>
                    <input
                      ref={(node) => {
                        if (node) quantityRefs.current.set(line.clientLineId, node);
                        else quantityRefs.current.delete(line.clientLineId);
                      }}
                      aria-label={`Số lượng ${line.sku}`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => {
                        const value = event.target.value;
                        setLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
                          ...item,
                          quantity: value,
                          pricingFingerprint: '',
                          priceSteps: [],
                          priceError: null,
                          pricingErrorCode: null,
                          resolvingPrice: true,
                        } : item));
                        markDirty();
                      }}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      onBlur={() => compactLineQuantity(index)}
                    />
                    <button type="button" className={styles.quantityPlus} aria-label={`Tăng số lượng ${line.sku}`} onClick={() => changeQuantity(index, 1)}>+</button>
                  </div>
                </div>
                <div className={styles.priceCell}>
        <span>Đơn giá</span>
        {canPriceOverride ? (
          <input
            ref={(node) => {
              if (node) priceRefs.current.set(line.clientLineId, node);
              else priceRefs.current.delete(line.clientLineId);
            }}
            className={styles.directPriceInput}
            aria-label={`Đơn giá ${line.sku}`}
            inputMode="numeric"
            value={line.manualUnitPriceMinor || (line.pricingFingerprint ? line.systemUnitPriceMinor : '')}
            placeholder={line.pricingErrorCode === 'BASE_PRICE_NOT_FOUND' ? 'Nhập giá' : undefined}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, '');
              setLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
                ...item,
                manualUnitPriceMinor: value,
              } : item));
              markDirty();
            }}
          />
        ) : (
          <strong>{line.pricingFingerprint ? automaticPriceText(line, line.systemUnitPriceMinor) : '—'}</strong>
        )}
        {line.manualUnitPriceMinor && <small className={styles.manualBadge}>Giá đã sửa</small>}
        {line.manualUnitPriceMinor && line.pricingFingerprint && canPriceOverride && (
          <button type="button" className={styles.linkButton} aria-label={`Dùng lại giá hệ thống cho ${line.sku}`} onClick={() => useSystemPrice(index)}>Giá hệ thống</button>
        )}
      </div>
      <div className={styles.discountCell}>
        <span>CK</span>
        {canDiscountOverride ? (
          <div className={styles.discountControls}>
            <select
              aria-label={`Cách CK ${line.sku}`}
              value={line.discountMode}
              disabled={estimate.documentDiscountTotal > 0n}
              onChange={(event) => {
                const mode = event.target.value as SalesOrderLineDiscountMode;
                setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountMode: mode } : item));
                markDirty();
              }}
            >
              <option value="PERCENT">%</option>
              <option value="PER_UNIT">đ/ĐVT</option>
              <option value="TOTAL_AMOUNT">Tổng đ</option>
            </select>
            <input
              aria-label={`Chiết khấu ${line.sku}`}
              inputMode="decimal"
              value={line.discountValue}
              disabled={estimate.documentDiscountTotal > 0n}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const raw = event.target.value;
                const value = line.discountMode === 'PERCENT'
                  ? raw.replace(/[^0-9.]/g, '')
                  : raw.replace(/\D/g, '');
                setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountValue: value } : item));
                markDirty();
              }}
            />
          </div>
        ) : (
          <strong>{discountValueText(line)}</strong>
        )}
      </div>
      <div className={styles.priceCell}><span>Thành tiền</span><strong>{vnd(estimate.details[index]?.total ?? 0n)}</strong></div>
      <button type="button" className={styles.removeLineButton} onClick={() => { setLines((current) => current.filter((_, itemIndex) => itemIndex !== index)); markDirty(); }}>Xóa</button>
                <div
                  id={`sales-order-line-details-${index + 1}`}
                  className={styles.lineDetails}
                  hidden={expandedLineId !== line.clientLineId}
                >
                  <div className={styles.priceTrace}>
                    <div><span>Giá nền</span><b>{automaticPriceText(line, line.baseUnitPriceMinor)}</b></div>
                    <div><span>Giá hệ thống</span><b>{automaticPriceText(line, line.systemUnitPriceMinor)}</b></div>
                    {line.priceSteps.length === 0 && <span>{line.pricingErrorCode === 'BASE_PRICE_NOT_FOUND' ? 'Dòng này đang chờ giá nhập tay.' : 'Công Ty sẽ tính lại giá khi lưu.'}</span>}
                    {line.priceSteps.filter((step) => step.kind !== 'RESOLUTION').map((step, stepIndex) => <div key={`${step.kind}-${stepIndex}`}><span>{pricingLabel(step)}</span><b>{step.afterUnitPriceMinor ? vnd(step.afterUnitPriceMinor) : '—'}</b></div>)}
                    <div><span>Ngữ cảnh</span><b>{customerMode === 'WALK_IN' ? 'Khách vãng lai' : 'Khách/nhóm khách'} · {entrySettings?.salesChannels.find((channel) => channel.id === salesChannelId)?.code ?? 'Chưa chọn kênh'}</b></div>
                    <div><span>Thuế Công Ty · {line.taxMode === 'INCLUSIVE' ? 'Giá đã gồm thuế' : 'Giá chưa gồm thuế'} · {line.taxRate}%</span><b>Tính lại sau phân bổ chiết khấu đơn</b></div>
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
            <div><span>Khuyến mãi / bảng giá</span><strong>Đã phản ánh trong giá hệ thống</strong></div>
            {canDiscountOverride ? (
              <>
                <label><span>Chiết khấu bổ sung toàn đơn</span><select data-testid="document-discount-mode" value={documentDiscountMode} disabled={hasLineDiscount} onChange={(event) => { const mode = event.target.value as SalesOrderDocumentDiscountMode; setDocumentDiscountMode(mode); if (mode === 'NONE') { setDocumentDiscountValue('0'); setDocumentDiscountReason(''); } markDirty(); }}><option value="NONE">Không áp dụng</option><option value="PERCENT">Phần trăm</option><option value="TOTAL_AMOUNT">Tổng tiền VND</option></select></label>
                {documentDiscountMode !== 'NONE' && <label><span>{documentDiscountMode === 'PERCENT' ? 'Tỷ lệ %' : 'Số tiền VND'}</span><input inputMode="decimal" value={documentDiscountValue} onChange={(event) => { setDocumentDiscountValue(event.target.value); markDirty(); }} /></label>}
                {documentDiscountMode !== 'NONE' && <label className={styles.documentDiscountReason}><span>Lý do *</span><input value={documentDiscountReason} maxLength={1000} onChange={(event) => { setDocumentDiscountReason(event.target.value); markDirty(); }} /></label>}
              </>
            ) : (
              <p>Không có quyền nhập chiết khấu bổ sung.</p>
            )}
          </section>
          <section className={styles.taxSummary} aria-label="Tổng kết thuế và thanh toán">
            <div><span>Tiền hàng theo giá cuối</span><strong>{vnd(estimate.gross)}</strong></div>
            <div><span>Chiết khấu</span><strong>- {vnd(estimate.discount)}</strong></div>
            <div><span>Thuế sau phân bổ</span><strong>{vnd(estimate.tax)}</strong></div>
            <div className={styles.grandTotal}><span>Tổng thanh toán dự kiến</span><strong>{vnd(estimate.total)}</strong></div>
          </section>
          <div className={styles.footerActions}>
            <button type="button" onClick={requestClose}>Đóng</button>
            {props.mode === 'manual-edit' ? (
              <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save(false)}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
            ) : (
              <>
                <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save(false)}>{busy ? 'Đang lưu…' : 'Lưu nháp'}</button>
                {props.canConfirm && <button type="button" className={styles.confirmButton} disabled={busy} onClick={() => void save(true)}>Lưu và xác nhận</button>}
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
