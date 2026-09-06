'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import type {
  Product,
  ProductBarcode,
  ProductBrand,
  ProductCategory,
  ProductVariant,
  UnitOfMeasure,
  VariantUnitForm,
} from '../../lib/product-types';
import type { InventoryBalance } from '../../lib/inventory-types';
import type { PriceList, PriceListItem } from '../../lib/pricing-types';
import ProductImageControl from './product-image-control';
import styles from './product-quick-setup.module.css';

type Props = {
  products: Product[];
  categories: ProductCategory[];
  brands: ProductBrand[];
  units: UnitOfMeasure[];
  onProductsChanged: (products: Product[]) => void;
  imageBaseUrl: string;
  imageCodes: Set<string> | null;
  onImageStatusChange: (productCode: string, hasImage: boolean) => void;
};

type ProductDraft = {
  code: string;
  name: string;
  catalogName: string;
  categoryId: string;
  brandId: string;
  description: string;
  notes: string;
  isCatalogVisible: boolean;
  isOrderable: boolean;
  isInventoryManaged: boolean;
  isActive: boolean;
};

type VariantDraft = {
  sku: string;
  name: string;
  variantKind: ProductVariant['variant_kind'];
  isInventoryBase: boolean;
  isSellable: boolean;
  isCatalogVisible: boolean;
  isActive: boolean;
  weightValue: string;
  weightUomCode: 'G' | 'KG';
};

const EMPTY_PRODUCT: ProductDraft = {
  code: '',
  name: '',
  catalogName: '',
  categoryId: '',
  brandId: '',
  description: '',
  notes: '',
  isCatalogVisible: false,
  isOrderable: false,
  isInventoryManaged: true,
  isActive: true,
};

const EMPTY_VARIANT: VariantDraft = {
  sku: '',
  name: '',
  variantKind: 'BASE',
  isInventoryBase: false,
  isSellable: true,
  isCatalogVisible: false,
  isActive: true,
  weightValue: '',
  weightUomCode: 'G',
};

const EMPTY_UNIT: VariantUnitForm = {
  unitId: '',
  conversionToBase: '',
  isPurchasable: true,
  netContentValue: '',
  netContentUnitCode: 'G',
  sourceUnitLabel: '',
  sourcePackageDescription: '',
};

const PRICE_LIST_LABELS: Record<PriceList['list_type'], string> = {
  BASE: 'Giá nền',
  CHANNEL: 'Theo kênh bán',
  CUSTOMER_GROUP: 'Theo nhóm khách',
  CUSTOMER: 'Theo khách hàng',
  PROMOTION: 'Khuyến mãi',
  CUSTOM: 'Quy tắc khác',
};

const VARIANT_KIND_LABELS: Record<ProductVariant['variant_kind'], string> = {
  BASE: 'Đơn vị lẻ',
  CARTON: 'Thùng',
  OTHER: 'Quy cách khác',
};

function productToDraft(product: Product): ProductDraft {
  return {
    code: product.code,
    name: product.name,
    catalogName: product.catalog_name ?? '',
    categoryId: product.category_id ?? '',
    brandId: product.brand_id ?? '',
    description: product.description ?? '',
    notes: product.notes ?? '',
    isCatalogVisible: product.is_catalog_visible,
    isOrderable: product.is_orderable,
    isInventoryManaged: product.is_inventory_managed !== false,
    isActive: product.is_active,
  };
}

function variantToDraft(variant: ProductVariant): VariantDraft {
  return {
    sku: variant.sku,
    name: variant.name,
    variantKind: variant.variant_kind,
    isInventoryBase: variant.is_inventory_base,
    isSellable: variant.is_sellable,
    isCatalogVisible: variant.is_catalog_visible,
    isActive: variant.is_active,
    weightValue: variant.weight_value ?? '',
    weightUomCode: variant.weight_uom_code ?? 'G',
  };
}

function variantToUnitDraft(variant: ProductVariant): VariantUnitForm {
  return {
    unitId: variant.unit_id ?? '',
    conversionToBase: variant.is_inventory_base ? '1' : (variant.conversion_to_base ?? ''),
    isPurchasable: variant.is_purchasable,
    netContentValue: variant.net_content_value ?? '',
    netContentUnitCode: (variant.net_content_uom_code as VariantUnitForm['netContentUnitCode']) ?? 'G',
    sourceUnitLabel: variant.source_unit_label ?? '',
    sourcePackageDescription: variant.source_package_description ?? '',
  };
}

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();
}

function isZeroQuantity(value: string | null | undefined) {
  return /^0+(?:\.0+)?$/.test(String(value ?? '').trim());
}

function isPositiveDecimal(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return false;
  return /[1-9]/.test(normalized);
}

function isPositiveInteger(value: string) {
  return /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
}

function money(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(value))} đ`;
  } catch {
    return `${value} đ`;
  }
}

function quantity(value: string | null | undefined) {
  if (!value) return '0';
  const normalized = value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return normalized || '0';
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as {
    data?: T;
    error?: { message?: string; code?: string };
  };
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || 'Yêu cầu không thành công.');
  }
  return payload.data as T;
}

export default function ProductQuickSetupWorkspace({
  products,
  categories,
  brands,
  units,
  onProductsChanged,
  imageBaseUrl,
  imageCodes,
  onImageStatusChange,
}: Props) {
  const pendingPostKeys = useRef(new Map<string, string>());
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [productDraft, setProductDraft] = useState<ProductDraft>(EMPTY_PRODUCT);

  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState('');
  const [creatingVariant, setCreatingVariant] = useState(false);
  const [variantDraft, setVariantDraft] = useState<VariantDraft>(EMPTY_VARIANT);
  const [unitDraft, setUnitDraft] = useState<VariantUnitForm>(EMPTY_UNIT);

  const [barcodes, setBarcodes] = useState<ProductBarcode[]>([]);
  const [barcodeDraft, setBarcodeDraft] = useState('');

  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListId, setPriceListId] = useState('');
  const [priceItems, setPriceItems] = useState<PriceListItem[]>([]);
  const [priceAmount, setPriceAmount] = useState('');

  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingSideData, setLoadingSideData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedProduct = products.find((item) => item.id === productId) ?? null;
  const selectedVariant = variants.find((item) => item.id === variantId) ?? null;
  const selectedPriceList = priceLists.find((item) => item.id === priceListId) ?? null;
  const inventoryBaseVariant = variants.find((item) => item.is_inventory_base && item.is_active)
    ?? variants.find((item) => item.is_inventory_base)
    ?? null;

  const visibleProducts = useMemo(() => {
    const term = normalizeSearch(search);
    if (!term) return products;
    return products.filter((item) =>
      [item.code, item.name, item.catalog_name, item.category_name, item.brand_name]
        .some((value) => normalizeSearch(value).includes(term)),
    );
  }, [products, search]);

  const directPriceItems = priceItems.filter((item) =>
    item.variant_id === variantId
      && item.adjustment_type === 'FIXED_PRICE'
      && item.is_active
      && isZeroQuantity(item.min_quantity)
      && !item.max_quantity,
  );
  const simplePriceItem = directPriceItems.length === 1 ? directPriceItems[0] : null;
  const directPriceIds = new Set(directPriceItems.map((item) => item.id));
  const complexPriceItems = priceItems.filter((item) =>
    item.variant_id === variantId && item.is_active && !directPriceIds.has(item.id),
  );
  const canEnableOrderable = variants.some((item) =>
    item.is_active && item.is_sellable && Boolean(item.unit_id) && Boolean(item.conversion_to_base),
  );

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function postKey(operation: string, url: string, body: unknown) {
    const fingerprint = `${operation}\n${url}\n${JSON.stringify(body)}`;
    const existing = pendingPostKeys.current.get(fingerprint);
    if (existing) return { fingerprint, key: existing };
    const key = createIdempotencyKey(operation);
    pendingPostKeys.current.set(fingerprint, key);
    return { fingerprint, key };
  }

  async function postJson<T>(operation: string, url: string, body: unknown): Promise<T> {
    const pending = postKey(operation, url, body);
    const result = await requestJson<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
      body: JSON.stringify(body),
    });
    pendingPostKeys.current.delete(pending.fingerprint);
    return result;
  }

  async function loadVariants(nextProductId: string, preferredVariantId = '') {
    setVariants([]);
    setVariantId('');
    setCreatingVariant(false);
    setBarcodes([]);
    setBalances([]);
    if (!nextProductId) return;

    setLoadingSideData(true);
    try {
      const next = await requestJson<ProductVariant[]>(`/api/products/${nextProductId}/variants`);
      setVariants(next);
      const preferred = next.find((item) => item.id === preferredVariantId);
      setVariantId(preferred?.id ?? next[0]?.id ?? '');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể tải SKU.');
    } finally {
      setLoadingSideData(false);
    }
  }

  function chooseProduct(nextProductId: string) {
    clearFeedback();
    setCreatingProduct(false);
    setProductId(nextProductId);
    const product = products.find((item) => item.id === nextProductId);
    setProductDraft(product ? productToDraft(product) : EMPTY_PRODUCT);
    void loadVariants(nextProductId);
  }

  function startProductCreate() {
    clearFeedback();
    setCreatingProduct(true);
    setProductId('');
    setProductDraft(EMPTY_PRODUCT);
    setVariants([]);
    setVariantId('');
    setCreatingVariant(false);
    setBarcodes([]);
    setBalances([]);
  }

  function startVariantCreate() {
    if (!selectedProduct) return;
    clearFeedback();
    setCreatingVariant(true);
    setVariantId('');
    setBarcodeDraft('');
    setBarcodes([]);
    setPriceAmount('');
    setVariantDraft({
      ...EMPTY_VARIANT,
      variantKind: variants.length === 0 ? 'BASE' : 'CARTON',
      isInventoryBase: variants.length === 0,
    });
    setUnitDraft({
      ...EMPTY_UNIT,
      conversionToBase: variants.length === 0 ? '1' : '',
    });
  }

  useEffect(() => {
    if (!selectedProduct || creatingProduct) return;
    setProductDraft(productToDraft(selectedProduct));
  }, [selectedProduct?.id, selectedProduct?.updated_at, creatingProduct]);

  useEffect(() => {
    let cancelled = false;
    requestJson<PriceList[]>('/api/price-lists?limit=1000')
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((item) => item.is_active && item.currency_code === 'VND');
        setPriceLists(active);
        const preferred = active.find((item) => item.list_type === 'BASE') ?? active[0] ?? null;
        setPriceListId((current) => current || preferred?.id || '');
      })
      .catch((errorValue) => {
        if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : 'Không thể tải bảng giá.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedVariant || creatingVariant) {
      if (!creatingVariant) {
        setVariantDraft(EMPTY_VARIANT);
        setUnitDraft(EMPTY_UNIT);
      }
      return;
    }
    setVariantDraft(variantToDraft(selectedVariant));
    setUnitDraft(variantToUnitDraft(selectedVariant));
  }, [selectedVariant?.id, selectedVariant?.updated_at, creatingVariant]);

  useEffect(() => {
    let cancelled = false;
    setBarcodes([]);
    if (!selectedProduct || !selectedVariant || creatingVariant) return () => { cancelled = true; };

    requestJson<ProductBarcode[]>(`/api/products/${selectedProduct.id}/variants/${selectedVariant.id}/barcodes`)
      .then((rows) => { if (!cancelled) setBarcodes(rows); })
      .catch((errorValue) => {
        if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : 'Không thể tải mã vạch.');
      });
    return () => { cancelled = true; };
  }, [selectedProduct?.id, selectedVariant?.id, creatingVariant]);

  useEffect(() => {
    let cancelled = false;
    setPriceItems([]);
    if (!priceListId) return () => { cancelled = true; };

    requestJson<PriceListItem[]>(`/api/price-lists/${priceListId}/items?limit=2000`)
      .then((rows) => { if (!cancelled) setPriceItems(rows); })
      .catch((errorValue) => {
        if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : 'Không thể tải giá theo SKU.');
      });
    return () => { cancelled = true; };
  }, [priceListId]);

  useEffect(() => {
    if (!variantId) {
      setPriceAmount('');
      return;
    }
    const item = priceItems.find((row) =>
      row.variant_id === variantId
        && row.adjustment_type === 'FIXED_PRICE'
        && row.is_active
        && isZeroQuantity(row.min_quantity)
        && !row.max_quantity,
    );
    setPriceAmount(item?.amount_minor ?? '');
  }, [variantId, priceItems]);

  useEffect(() => {
    let cancelled = false;
    setBalances([]);
    if (!inventoryBaseVariant?.id) return () => { cancelled = true; };

    const params = new URLSearchParams({ baseVariantId: inventoryBaseVariant.id });
    requestJson<InventoryBalance[]>(`/api/inventory/balances?${params.toString()}`)
      .then((rows) => { if (!cancelled) setBalances(rows); })
      .catch(() => {
        if (!cancelled) setBalances([]);
      });
    return () => { cancelled = true; };
  }, [inventoryBaseVariant?.id]);

  async function saveProduct() {
    clearFeedback();
    if (!productDraft.code.trim() || !productDraft.name.trim()) {
      setError('Cần nhập mã sản phẩm và tên sản phẩm.');
      return;
    }

    setBusy(true);
    try {
      const body = {
        ...productDraft,
        code: productDraft.code.trim().toUpperCase(),
        name: productDraft.name.trim(),
        categoryId: productDraft.categoryId || null,
        brandId: productDraft.brandId || null,
        ...(selectedProduct && !creatingProduct
          ? { expectedUpdatedAt: selectedProduct.updated_at }
          : { isOrderable: false }),
      };

      const saved = selectedProduct && !creatingProduct
        ? await requestJson<Product>(`/api/products/${selectedProduct.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await postJson<Product>('product.quick.product.create', '/api/products', body);

      const nextProducts = selectedProduct && !creatingProduct
        ? products.map((item) => item.id === saved.id ? saved : item)
        : [...products, saved].sort((left, right) => left.code.localeCompare(right.code));
      onProductsChanged(nextProducts);
      setProductId(saved.id);
      setCreatingProduct(false);
      setProductDraft(productToDraft(saved));
      if (!selectedProduct || creatingProduct) await loadVariants(saved.id);
      setNotice(selectedProduct && !creatingProduct ? 'Đã cập nhật sản phẩm.' : 'Đã tạo sản phẩm. Tiếp tục tạo SKU ngay bên dưới.');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể lưu sản phẩm.');
    } finally {
      setBusy(false);
    }
  }

  async function saveVariant() {
    if (!selectedProduct) return;
    clearFeedback();
    if (!variantDraft.sku.trim() || !variantDraft.name.trim()) {
      setError('Cần nhập mã SKU và tên SKU.');
      return;
    }

    setBusy(true);
    try {
      const weightValue = variantDraft.weightValue.trim().replace(',', '.');
      if (weightValue && !isPositiveDecimal(weightValue)) {
        throw new Error('Khối lượng phải lớn hơn 0.');
      }
      const body = {
        sku: variantDraft.sku.trim().toUpperCase(),
        name: variantDraft.name.trim(),
        variantKind: variantDraft.variantKind,
        isInventoryBase: variantDraft.isInventoryBase,
        isSellable: variantDraft.isSellable,
        isCatalogVisible: variantDraft.isCatalogVisible,
        isActive: variantDraft.isActive,
        weightValue: weightValue || null,
        weightUomCode: weightValue ? variantDraft.weightUomCode : null,
        ...(selectedVariant && !creatingVariant ? { expectedUpdatedAt: selectedVariant.updated_at } : {}),
      };

      const saved = selectedVariant && !creatingVariant
        ? await requestJson<ProductVariant>(`/api/products/${selectedProduct.id}/variants/${selectedVariant.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await postJson<ProductVariant>(
            'product.quick.variant.create',
            `/api/products/${selectedProduct.id}/variants`,
            body,
          );

      const nextVariants = selectedVariant && !creatingVariant
        ? variants.map((item) => item.id === saved.id ? saved : item)
        : [...variants, saved].sort((left, right) => left.sku.localeCompare(right.sku));
      setVariants(nextVariants);
      setVariantId(saved.id);
      setCreatingVariant(false);
      setVariantDraft(variantToDraft(saved));
      setUnitDraft(variantToUnitDraft(saved));
      setNotice(selectedVariant && !creatingVariant ? 'Đã cập nhật SKU.' : 'Đã tạo SKU. Tiếp tục gắn đơn vị, quy đổi và giá.');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể lưu SKU.');
    } finally {
      setBusy(false);
    }
  }

  async function saveUnit() {
    if (!selectedProduct || !selectedVariant) return;
    clearFeedback();
    const conversion = selectedVariant.is_inventory_base ? '1' : unitDraft.conversionToBase.trim().replace(',', '.');
    if (!unitDraft.unitId) {
      setError('Chọn đơn vị tính cho SKU.');
      return;
    }
    if (!isPositiveDecimal(conversion)) {
      setError('Hệ số quy đổi phải lớn hơn 0.');
      return;
    }

    setBusy(true);
    try {
      const netContent = unitDraft.netContentValue.trim().replace(',', '.');
      if (netContent && !isPositiveDecimal(netContent)) {
        throw new Error('Khối lượng/dung tích mô tả phải lớn hơn 0.');
      }
      const saved = await requestJson<ProductVariant>(
        `/api/products/${selectedProduct.id}/variants/${selectedVariant.id}/unit`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unitId: unitDraft.unitId,
            conversionToBase: conversion,
            isPurchasable: unitDraft.isPurchasable,
            netContent: netContent ? { value: netContent, unitCode: unitDraft.netContentUnitCode } : null,
            sourceUnitLabel: unitDraft.sourceUnitLabel || null,
            sourcePackageDescription: unitDraft.sourcePackageDescription || null,
            expectedUpdatedAt: selectedVariant.updated_at,
          }),
        },
      );
      setVariants((current) => current.map((item) => item.id === saved.id ? saved : item));
      setUnitDraft(variantToUnitDraft(saved));
      setNotice('Đã lưu đơn vị và hệ số quy đổi.');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể lưu quy đổi.');
    } finally {
      setBusy(false);
    }
  }

  async function addBarcode() {
    if (!selectedProduct || !selectedVariant || !barcodeDraft.trim()) return;
    clearFeedback();
    setBusy(true);
    try {
      const body = {
        barcode: barcodeDraft.trim(),
        barcodeType: 'INTERNAL',
        isPrimary: barcodes.every((item) => !item.is_active),
      };
      const saved = await postJson<ProductBarcode>(
        'product.quick.barcode.create',
        `/api/products/${selectedProduct.id}/variants/${selectedVariant.id}/barcodes`,
        body,
      );
      setBarcodes((current) => [...current, saved]);
      setBarcodeDraft('');
      setNotice('Đã thêm mã vạch.');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể thêm mã vạch.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBarcode(item: ProductBarcode) {
    if (!selectedProduct || !selectedVariant) return;
    clearFeedback();
    setBusy(true);
    try {
      const saved = await requestJson<ProductBarcode>(
        `/api/products/${selectedProduct.id}/variants/${selectedVariant.id}/barcodes/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isActive: !item.is_active,
            isPrimary: item.is_primary && !item.is_active,
            expectedUpdatedAt: item.updated_at,
          }),
        },
      );
      setBarcodes((current) => current.map((row) => row.id === saved.id ? saved : row));
      setNotice(saved.is_active ? 'Đã đưa mã vạch vào sử dụng.' : 'Đã ngừng sử dụng mã vạch.');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể đổi trạng thái mã vạch.');
    } finally {
      setBusy(false);
    }
  }

  async function savePrice() {
    if (!selectedVariant || !selectedPriceList) return;
    clearFeedback();
    if (directPriceItems.length > 1) {
      setError('Bảng giá này có nhiều mức giá trực tiếp cùng áp dụng cho SKU. Mở quản lý giá đầy đủ để chọn đúng dòng cần sửa.');
      return;
    }
    const normalizedPrice = priceAmount.trim();
    if (!isPositiveInteger(normalizedPrice)) {
      setError('Giá phải là số nguyên VND lớn hơn 0.');
      return;
    }

    setBusy(true);
    try {
      const saved = simplePriceItem
        ? await requestJson<PriceListItem>(
            `/api/price-lists/${selectedPriceList.id}/items/${simplePriceItem.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amountMinor: normalizedPrice,
                expectedUpdatedAt: simplePriceItem.updated_at,
              }),
            },
          )
        : await postJson<PriceListItem>(
            'product.quick.price-item.create',
            `/api/price-lists/${selectedPriceList.id}/items`,
            {
              variantId: selectedVariant.id,
              adjustmentType: 'FIXED_PRICE',
              amountMinor: normalizedPrice,
              rateBps: null,
              minQuantity: '0',
              maxQuantity: null,
              effectiveFrom: null,
              effectiveTo: null,
              externalRuleCode: null,
              note: 'Thiết lập nhanh theo SKU',
              sourceKind: 'ADMIN',
              isActive: true,
            },
          );

      setPriceItems((current) => simplePriceItem
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved]);
      setPriceAmount(saved.amount_minor ?? normalizedPrice);
      setNotice(simplePriceItem ? 'Đã cập nhật giá SKU.' : 'Đã thêm giá cho SKU.');
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Không thể lưu giá SKU.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.workspace} data-testid="product-quick-setup">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Thao tác nhanh</span>
          <h2>Thiết lập nhanh sản phẩm &amp; SKU</h2>
          <p>Tạo sản phẩm → tạo SKU → gắn đơn vị/quy đổi → mã vạch → giá, dùng nguyên dữ liệu nghiệp vụ hiện có.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={startProductCreate} disabled={busy}>
          + Tạo sản phẩm
        </button>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <label className={styles.searchLabel}>
            Tìm sản phẩm
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Mã, tên, loại, nhãn hàng..."
              data-testid="quick-product-search"
            />
          </label>
          <div className={styles.productList}>
            {visibleProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                className={product.id === productId ? styles.productActive : styles.productButton}
                onClick={() => chooseProduct(product.id)}
                data-testid={`quick-product-${product.code}`}
              >
                <strong>{product.name}</strong>
                <span>{product.code}</span>
                <small>{product.category_name || 'Chưa phân loại'} · {product.brand_name || 'Chưa có nhãn hàng'}</small>
              </button>
            ))}
            {visibleProducts.length === 0 ? <p className={styles.empty}>Không có sản phẩm phù hợp.</p> : null}
          </div>
        </aside>

        <div className={styles.content}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.step}>1</span>
                <div><h3>Sản phẩm</h3><p>Thông tin chung dùng lại đúng danh mục hiện có.</p></div>
              </div>
              {selectedProduct ? <span className={styles.statusPill}>{selectedProduct.is_active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</span> : null}
            </div>

            <div className={styles.productTop}>
              <ProductImageControl
                product={selectedProduct}
                imageBaseUrl={imageBaseUrl}
                hasImage={Boolean(selectedProduct && imageCodes?.has(selectedProduct.code))}
                imageStatusKnown={imageCodes !== null}
                onImageStatusChange={onImageStatusChange}
              />
              <div className={styles.productFields}>
                <label>Mã sản phẩm<input value={productDraft.code} disabled={Boolean(selectedProduct) && !creatingProduct} onChange={(event) => setProductDraft({ ...productDraft, code: event.target.value.toUpperCase() })} /></label>
                <label>Tên sản phẩm<input value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label>
                <label>Loại sản phẩm<select value={productDraft.categoryId} onChange={(event) => setProductDraft({ ...productDraft, categoryId: event.target.value })}><option value="">Chưa phân loại</option>{categories.filter((item) => item.is_active || item.id === selectedProduct?.category_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Nhãn hàng<select value={productDraft.brandId} onChange={(event) => setProductDraft({ ...productDraft, brandId: event.target.value })}><option value="">Chưa có nhãn hàng</option>{brands.filter((item) => item.is_active || item.id === selectedProduct?.brand_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              </div>
            </div>

            <div className={styles.wideFields}>
              <label>Tên hiển thị bán hàng<input value={productDraft.catalogName} onChange={(event) => setProductDraft({ ...productDraft, catalogName: event.target.value })} /></label>
              <label>Mô tả<input value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label>
            </div>
            <div className={styles.checks}>
              <label><input type="checkbox" checked={productDraft.isCatalogVisible} onChange={(event) => setProductDraft({ ...productDraft, isCatalogVisible: event.target.checked })} /> Hiển thị bán hàng</label>
              <label><input type="checkbox" checked={productDraft.isInventoryManaged} onChange={(event) => setProductDraft({ ...productDraft, isInventoryManaged: event.target.checked })} /> Quản lý tồn kho</label>
              <label><input type="checkbox" checked={productDraft.isActive} onChange={(event) => setProductDraft({ ...productDraft, isActive: event.target.checked })} /> Đang sử dụng</label>
              <label title={!selectedProduct ? 'Tạo sản phẩm xong rồi mới bật đặt hàng.' : (!canEnableOrderable && !productDraft.isOrderable ? 'Cần ít nhất một SKU đang sử dụng, được phép bán và đã gắn đơn vị/quy đổi.' : undefined)}><input type="checkbox" checked={productDraft.isOrderable} disabled={!selectedProduct || creatingProduct || (!productDraft.isOrderable && !canEnableOrderable)} onChange={(event) => setProductDraft({ ...productDraft, isOrderable: event.target.checked })} /> Cho phép đặt hàng</label>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryButton} onClick={() => void saveProduct()} disabled={busy}>
                {busy ? 'Đang lưu…' : selectedProduct && !creatingProduct ? 'Lưu sản phẩm' : 'Tạo sản phẩm'}
              </button>
            </div>
          </section>

          {selectedProduct ? (
            <>
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <span className={styles.step}>2</span>
                    <div><h3>SKU &amp; quy cách</h3><p>Mỗi quy cách bán là một SKU riêng; SKU đã tạo không đổi mã.</p></div>
                  </div>
                  <button type="button" className={styles.secondaryButton} onClick={startVariantCreate} disabled={busy}>+ Thêm SKU</button>
                </div>

                <div className={styles.variantStrip}>
                  {variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      className={variant.id === variantId ? styles.variantActive : styles.variantButton}
                      onClick={() => { setCreatingVariant(false); setVariantId(variant.id); clearFeedback(); }}
                    >
                      <strong>{variant.name}</strong>
                      <span>{variant.sku}</span>
                      <small>{variant.unit_name || 'Chưa có ĐVT'} · {variant.conversion_to_base ? `x${quantity(variant.conversion_to_base)}` : 'Chưa quy đổi'}</small>
                    </button>
                  ))}
                  {variants.length === 0 && !creatingVariant ? <p className={styles.empty}>Chưa có SKU. Bấm “Thêm SKU”.</p> : null}
                </div>

                {(selectedVariant || creatingVariant) ? (
                  <>
                    <div className={styles.grid4}>
                      <label>Mã SKU<input value={variantDraft.sku} disabled={Boolean(selectedVariant) && !creatingVariant} onChange={(event) => setVariantDraft({ ...variantDraft, sku: event.target.value.toUpperCase() })} /></label>
                      <label>Tên SKU<input value={variantDraft.name} onChange={(event) => setVariantDraft({ ...variantDraft, name: event.target.value })} /></label>
                      <label>Loại quy cách<select value={variantDraft.variantKind} onChange={(event) => setVariantDraft({ ...variantDraft, variantKind: event.target.value as VariantDraft['variantKind'] })}><option value="BASE">Đơn vị lẻ</option><option value="CARTON">Thùng</option><option value="OTHER">Quy cách khác</option></select></label>
                      <label>Khối lượng<div className={styles.inlineInput}><input inputMode="decimal" value={variantDraft.weightValue} onChange={(event) => setVariantDraft({ ...variantDraft, weightValue: event.target.value.replace(',', '.') })} /><select value={variantDraft.weightUomCode} onChange={(event) => setVariantDraft({ ...variantDraft, weightUomCode: event.target.value as 'G' | 'KG' })}><option value="G">G</option><option value="KG">KG</option></select></div></label>
                    </div>
                    <div className={styles.checks}>
                      <label><input type="checkbox" checked={variantDraft.isInventoryBase} onChange={(event) => setVariantDraft({ ...variantDraft, isInventoryBase: event.target.checked, variantKind: event.target.checked ? 'BASE' : variantDraft.variantKind })} /> SKU tồn chuẩn</label>
                      <label><input type="checkbox" checked={variantDraft.isSellable} onChange={(event) => setVariantDraft({ ...variantDraft, isSellable: event.target.checked })} /> Được phép bán</label>
                      <label><input type="checkbox" checked={variantDraft.isCatalogVisible} onChange={(event) => setVariantDraft({ ...variantDraft, isCatalogVisible: event.target.checked })} /> Hiển thị bán hàng</label>
                      <label><input type="checkbox" checked={variantDraft.isActive} onChange={(event) => setVariantDraft({ ...variantDraft, isActive: event.target.checked })} /> Đang sử dụng</label>
                    </div>
                    <div className={styles.actions}>
                      <button type="button" className={styles.primaryButton} onClick={() => void saveVariant()} disabled={busy}>
                        {selectedVariant && !creatingVariant ? 'Lưu SKU' : 'Tạo SKU'}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>

              {selectedVariant && !creatingVariant ? (
                <div className={styles.twoColumns}>
                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <span className={styles.step}>3</span>
                        <div><h3>Đơn vị &amp; quy đổi</h3><p>Dùng đúng danh mục đơn vị và hệ số của SKU hiện tại.</p></div>
                      </div>
                    </div>
                    <div className={styles.grid2}>
                      <label>Đơn vị tính<select value={unitDraft.unitId} onChange={(event) => setUnitDraft({ ...unitDraft, unitId: event.target.value })}><option value="">Chọn đơn vị</option>{units.filter((unit) => unit.is_active || unit.id === selectedVariant.unit_id).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>)}</select></label>
                      <label>Hệ số về tồn chuẩn<input inputMode="decimal" value={selectedVariant.is_inventory_base ? '1' : unitDraft.conversionToBase} disabled={selectedVariant.is_inventory_base} onChange={(event) => setUnitDraft({ ...unitDraft, conversionToBase: event.target.value.replace(',', '.') })} /></label>
                      <label>Khối lượng/dung tích mô tả<input inputMode="decimal" value={unitDraft.netContentValue} onChange={(event) => setUnitDraft({ ...unitDraft, netContentValue: event.target.value.replace(',', '.') })} /></label>
                      <label>Đơn vị mô tả<select value={unitDraft.netContentUnitCode} onChange={(event) => setUnitDraft({ ...unitDraft, netContentUnitCode: event.target.value as VariantUnitForm['netContentUnitCode'] })}><option value="G">Gam</option><option value="KG">Kilôgam</option><option value="ML">Mililít</option><option value="L">Lít</option><option value="EA">Cái</option><option value="OTHER">Khác</option></select></label>
                    </div>
                    <div className={styles.checks}>
                      <label><input type="checkbox" checked={unitDraft.isPurchasable} onChange={(event) => setUnitDraft({ ...unitDraft, isPurchasable: event.target.checked })} /> Được phép mua</label>
                    </div>
                    <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={() => void saveUnit()} disabled={busy}>Lưu quy đổi</button></div>

                    <div className={styles.divider} />
                    <div className={styles.subHeader}><div><h4>Mã vạch</h4><p>Một SKU có thể có nhiều mã vạch; không tạo mã SKU mới.</p></div></div>
                    <div className={styles.barcodeEntry}>
                      <input value={barcodeDraft} onChange={(event) => setBarcodeDraft(event.target.value)} placeholder="Mã vạch hoặc mã nội bộ" />
                      <button type="button" className={styles.secondaryButton} onClick={() => void addBarcode()} disabled={busy || !barcodeDraft.trim()}>Thêm</button>
                    </div>
                    <div className={styles.chips}>
                      {barcodes.map((item) => (
                        <button key={item.id} type="button" className={item.is_active ? styles.chipActive : styles.chipInactive} onClick={() => void toggleBarcode(item)} disabled={busy} title={item.is_active ? 'Bấm để ngừng sử dụng' : 'Bấm để đưa vào sử dụng'}>
                          {item.barcode}{item.is_primary ? ' · chính' : ''}
                        </button>
                      ))}
                      {barcodes.length === 0 ? <span className={styles.muted}>Chưa có mã vạch.</span> : null}
                    </div>
                  </section>

                  <section className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div>
                        <span className={styles.step}>4</span>
                        <div><h3>Giá bán</h3><p>Chọn bảng giá đã có; màn này không tạo một hệ giá riêng.</p></div>
                      </div>
                      <a className={styles.textLink} href="/pricing">Quản lý giá đầy đủ</a>
                    </div>
                    <div className={styles.grid2}>
                      <label>Bảng giá<select value={priceListId} onChange={(event) => setPriceListId(event.target.value)}><option value="">Chọn bảng giá</option>{priceLists.map((list) => <option key={list.id} value={list.id}>{PRICE_LIST_LABELS[list.list_type]} — {list.name}</option>)}</select></label>
                      <label>Giá SKU (VND)<input inputMode="numeric" value={priceAmount} onChange={(event) => setPriceAmount(event.target.value.replace(/\D/g, ''))} placeholder="Ví dụ: 125000" /></label>
                    </div>
                    {selectedPriceList ? (
                      <div className={styles.priceSummary}>
                        <span>{PRICE_LIST_LABELS[selectedPriceList.list_type]}</span>
                        <strong>{simplePriceItem ? money(simplePriceItem.amount_minor) : 'Chưa có giá trực tiếp'}</strong>
                      </div>
                    ) : null}
                    {directPriceItems.length > 1 ? (
                      <div className={styles.warning}>
                        Có {directPriceItems.length} mức giá trực tiếp cùng áp dụng cho SKU trong bảng này. Thiết lập nhanh không tự chọn một dòng để tránh sửa nhầm.
                      </div>
                    ) : null}
                    {complexPriceItems.length > 0 ? (
                      <div className={styles.warning}>
                        SKU này còn {complexPriceItems.length} quy tắc giá nâng cao trong bảng đã chọn. Thiết lập nhanh chỉ sửa giá trực tiếp; quy tắc khác giữ nguyên.
                      </div>
                    ) : null}
                    {priceLists.length === 0 ? (
                      <div className={styles.warning}>Chưa có bảng giá VND đang hoạt động. Tạo bảng giá tại “Giá bán và khuyến mãi” trước.</div>
                    ) : null}
                    <div className={styles.actions}>
                      <button type="button" className={styles.primaryButton} onClick={() => void savePrice()} disabled={busy || !priceListId || directPriceItems.length > 1}>Lưu giá</button>
                    </div>
                  </section>
                </div>
              ) : null}

              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <span className={styles.step}>5</span>
                    <div><h3>Tồn kho</h3><p>Chỉ xem dữ liệu tồn chuẩn hiện có; không sửa tồn từ màn thiết lập SKU.</p></div>
                  </div>
                  <a className={styles.textLink} href="/inventory/balances">Mở tra cứu tồn kho</a>
                </div>
                {!inventoryBaseVariant ? (
                  <p className={styles.empty}>Sản phẩm chưa có SKU tồn chuẩn nên chưa thể đối chiếu tồn kho.</p>
                ) : balances.length === 0 ? (
                  <p className={styles.empty}>Chưa có số lượng tồn cho SKU tồn chuẩn {inventoryBaseVariant.sku}.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table>
                      <thead><tr><th>Kho</th><th>Vị trí</th><th>Tồn</th><th>Đã giữ</th><th>Có thể xuất</th></tr></thead>
                      <tbody>
                        {balances.slice(0, 8).map((row, index) => (
                          <tr key={`${row.warehouse_id}-${row.location_id ?? 'none'}-${row.lot_id ?? 'none'}-${index}`}>
                            <td>{row.warehouse_name}</td>
                            <td>{row.location_name || row.location_code || '—'}</td>
                            <td>{quantity(row.on_hand_quantity)} {row.base_unit_name || row.base_unit_code || ''}</td>
                            <td>{quantity(row.reserved_quantity)}</td>
                            <td><strong>{quantity(row.available_quantity)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {balances.length > 8 ? <p className={styles.muted}>Đang xem 8 dòng đầu; mở Tra cứu tồn kho để xem đầy đủ.</p> : null}
                  </div>
                )}
              </section>
            </>
          ) : creatingProduct ? null : (
            <div className={styles.emptyState}>
              <strong>Chọn một sản phẩm hoặc tạo sản phẩm mới.</strong>
              <span>Sau đó hệ thống mới mở phần SKU, quy đổi, mã vạch và giá theo đúng thứ tự.</span>
            </div>
          )}
        </div>
      </div>

      {loadingSideData ? <div className={styles.loadingBar}>Đang tải dữ liệu SKU…</div> : null}
    </section>
  );
}
