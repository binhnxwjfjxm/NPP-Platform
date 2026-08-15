"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CustomerOnboardingQueueItem } from "@/features/accounts/customer-onboarding.types";
import { createIdempotencyKey, idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import {
  catalogFamilyLabel,
  compareCatalogProducts,
  groupCatalogCategories
} from "./order-catalog-priority";
import styles from "./OrderCreateSheet.module.css";

type MobilePanel = "customer" | "catalog" | "cart";

type ProductCatalogItem = {
  productId: string;
  variantId: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  sku?: string | null;
  variantName?: string | null;
  sizeLabel?: string | null;
  sellUnit?: string | null;
  packUnit?: string | null;
  packQuantity?: number | null;
  price?: number | null;
};

type ProductGroup = {
  productId: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  variants: ProductCatalogItem[];
};

type OrderDraftItem = ProductCatalogItem & { quantity: number };
type SubmissionRef = { fingerprint: string; key: string };

type CoreOrderResult = {
  id?: string | null;
  number?: string | null;
};

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string | { message?: string }; detail?: string; message?: string };
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message?.trim()) return value.error.message;
  return value.detail || value.message || fallback;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function catalogPrice(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function catalogPriceLabel(value?: number | null) {
  return value === null || value === undefined ? "Core phân giải giá" : money.format(value);
}

function normalizeCatalogItems(value: unknown): ProductCatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Partial<ProductCatalogItem>)
    .filter((item) => item.productId && item.variantId && item.name)
    .map((item) => ({
      productId: String(item.productId),
      variantId: String(item.variantId),
      name: String(item.name),
      brand: item.brand ?? null,
      category: item.category ?? null,
      sku: item.sku ?? null,
      variantName: item.variantName ?? null,
      sizeLabel: item.sizeLabel ?? null,
      sellUnit: item.sellUnit ?? null,
      packUnit: item.packUnit ?? null,
      packQuantity: item.packQuantity ?? null,
      price: catalogPrice(item.price)
    }));
}

function variantPrimaryLabel(item: ProductCatalogItem) {
  const rawVariant = String(item.variantName || "").trim();
  const variant = normalizeText(rawVariant) === "mac dinh" ? "" : rawVariant;
  const size = String(item.sizeLabel || "").trim();
  if (variant && size && normalizeText(variant) !== normalizeText(size)) return `${variant} · ${size}`;
  return variant || size || item.sellUnit || item.sku || "Quy cách chuẩn";
}

function variantSecondaryLabel(item: ProductCatalogItem) {
  const primary = normalizeText(variantPrimaryLabel(item));
  const pack = item.packUnit && item.packQuantity ? `${item.packUnit} ${item.packQuantity}` : "";
  const values = [item.sellUnit, pack, item.sku]
    .map((value) => String(value || "").trim())
    .filter((value) => value && normalizeText(value) !== primary);
  return Array.from(new Set(values)).join(" · ") || "Chạm để thêm vào đơn";
}

function variantLabel(item: ProductCatalogItem) {
  return [variantPrimaryLabel(item), variantSecondaryLabel(item)].filter(Boolean).join(" · ");
}

function mergeOptions(current: string[], next: Array<string | null | undefined>) {
  return Array.from(new Set([
    ...current,
    ...next.map((value) => String(value || "").trim()).filter(Boolean)
  ])).sort((left, right) => left.localeCompare(right, "vi"));
}

function groupCatalog(products: ProductCatalogItem[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  products.forEach((product) => {
    const current = groups.get(product.productId);
    if (current) {
      if (!current.variants.some((variant) => variant.variantId === product.variantId)) current.variants.push(product);
      return;
    }
    groups.set(product.productId, {
      productId: product.productId,
      name: product.name,
      brand: product.brand,
      category: product.category,
      variants: [product]
    });
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      variants: [...group.variants].sort((left, right) => variantPrimaryLabel(left).localeCompare(variantPrimaryLabel(right), "vi"))
    }))
    .sort(compareCatalogProducts);
}

function uniqueLinkedCustomers(customers: CustomerOnboardingQueueItem[]) {
  const unique = new Map<string, CustomerOnboardingQueueItem>();
  for (const customer of customers) {
    if (!customer.coreCustomerId || !customer.coreCustomerAddressId) continue;
    const key = `${customer.coreCustomerId}:${customer.coreCustomerAddressId}`;
    if (!unique.has(key)) unique.set(key, customer);
  }
  return [...unique.values()];
}

export function CoreOrderCreateSheet({
  open,
  linkedCustomers,
  onClose,
  onCreated
}: {
  open: boolean;
  linkedCustomers: CustomerOnboardingQueueItem[];
  onClose: () => void;
  onCreated: (orderCode: string) => void;
}) {
  const productRequestRef = useRef(0);
  const addedNoticeTimerRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const submissionRef = useRef<SubmissionRef | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("customer");
  const [customerSearch, setCustomerSearch] = useState("");
  const [routeCustomerId, setRouteCustomerId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [productBrand, setProductBrand] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [items, setItems] = useState<OrderDraftItem[]>([]);
  const [note, setNote] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [addedNotice, setAddedNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const customers = useMemo(() => uniqueLinkedCustomers(linkedCustomers), [linkedCustomers]);
  const filteredCustomers = useMemo(() => {
    const query = normalizeText(customerSearch);
    if (!query) return customers;
    return customers.filter((customer) => normalizeText(
      `${customer.customerName} ${customer.phone || ""} ${customer.area || ""} ${customer.routeName || ""} ${customer.coreCustomerCode || ""}`
    ).includes(query));
  }, [customerSearch, customers]);
  const selectedCustomer = customers.find((customer) => customer.routeCustomerId === routeCustomerId) || null;
  const customerReady = Boolean(selectedCustomer?.coreCustomerId && selectedCustomer.coreCustomerAddressId);
  const productGroups = useMemo(() => groupCatalog(products), [products]);
  const categorySections = useMemo(() => groupCatalogCategories(categoryOptions), [categoryOptions]);
  const selectedQuantityByVariant = useMemo(() => new Map(items.map((item) => [item.variantId, item.quantity])), [items]);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const hasUnknownPrice = items.some((item) => item.price === null || item.price === undefined);
  const estimatedTotal = items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  const totalLabel = items.length === 0
    ? money.format(0)
    : hasUnknownPrice
      ? "Giá do Core quyết định"
      : `Tham khảo ${money.format(estimatedTotal)}`;
  const readyToSubmit = customerReady && items.length > 0 && mobilePanel === "cart";

  const loadProducts = useCallback(async (query: string, category: string, brand: string) => {
    const requestId = ++productRequestRef.current;
    setLoadingProducts(true);
    setProductError(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: "100" });
      if (category) params.set("category", category);
      if (brand) params.set("brand", brand);
      const response = await fetch(`/api/products/search?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được sản phẩm Core"));
      const nextProducts = normalizeCatalogItems((payload as { data?: unknown }).data);
      if (requestId !== productRequestRef.current) return;
      setProducts(nextProducts);
      setCategoryOptions((current) => mergeOptions(current, nextProducts.map((item) => item.category)));
      setBrandOptions((current) => mergeOptions(current, nextProducts.map((item) => item.brand)));
    } catch (error) {
      if (requestId !== productRequestRef.current) return;
      setProducts([]);
      setProductError(error instanceof Error ? error.message : "Không tải được sản phẩm Core");
    } finally {
      if (requestId === productRequestRef.current) setLoadingProducts(false);
    }
  }, []);

  useEffect(() => () => {
    if (addedNoticeTimerRef.current !== null) window.clearTimeout(addedNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      productRequestRef.current += 1;
      submitInFlightRef.current = false;
      return;
    }
    setMobilePanel("customer");
    setCustomerSearch("");
    setRouteCustomerId("");
    setProductSearch("");
    setProductCategory("");
    setProductBrand("");
    setCategoryOptions([]);
    setBrandOptions([]);
    setProducts([]);
    setItems([]);
    setNote("");
    setProductError(null);
    setAddedNotice("");
    setMessage(null);
    submissionRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadProducts(productSearch, productCategory, productBrand);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadProducts, open, productBrand, productCategory, productSearch]);

  function announceQuantity(product: ProductCatalogItem, nextQuantity: number) {
    setAddedNotice(nextQuantity > 0
      ? `${product.name} · ${variantPrimaryLabel(product)}: ${nextQuantity} trong đơn`
      : `${product.name} · ${variantPrimaryLabel(product)}: đã bỏ khỏi đơn`);
    if (addedNoticeTimerRef.current !== null) window.clearTimeout(addedNoticeTimerRef.current);
    addedNoticeTimerRef.current = window.setTimeout(() => setAddedNotice(""), 1800);
  }

  function addProduct(product: ProductCatalogItem) {
    if (!customerReady) {
      setMessage("Chọn khách công ty trước khi thêm sản phẩm.");
      setMobilePanel("customer");
      return;
    }
    const nextQuantity = (selectedQuantityByVariant.get(product.variantId) || 0) + 1;
    setMessage(null);
    setItems((current) => {
      const existed = current.find((item) => item.variantId === product.variantId);
      if (existed) return current.map((item) => item.variantId === product.variantId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { ...product, quantity: 1 }];
    });
    announceQuantity(product, nextQuantity);
  }

  function decreaseProduct(variantId: string) {
    setItems((current) => current.flatMap((item) => {
      if (item.variantId !== variantId) return [item];
      if (item.quantity <= 1) return [];
      return [{ ...item, quantity: item.quantity - 1 }];
    }));
  }

  function toggleCatalogProduct(product: ProductCatalogItem) {
    const selectedQuantity = selectedQuantityByVariant.get(product.variantId) || 0;
    if (selectedQuantity > 0) {
      decreaseProduct(product.variantId);
      announceQuantity(product, selectedQuantity - 1);
      return;
    }
    addProduct(product);
  }

  function updateQuantity(variantId: string, value: number) {
    setItems((current) => current.map((item) => item.variantId === variantId
      ? { ...item, quantity: Math.max(1, Math.trunc(value) || 1) }
      : item));
  }

  function clearProductFilters() {
    setProductSearch("");
    setProductCategory("");
    setProductBrand("");
  }

  function requestPanel(nextPanel: MobilePanel) {
    if (nextPanel === "catalog" && !customerReady) {
      setMessage("Bước 1: chọn một khách công ty đã mở mã.");
      setMobilePanel("customer");
      return;
    }
    if (nextPanel === "cart" && !customerReady) {
      setMessage("Bước 1: chọn khách trước khi xem đơn.");
      setMobilePanel("customer");
      return;
    }
    if (nextPanel === "cart" && items.length === 0) {
      setMessage("Bước 2: chọn ít nhất một sản phẩm.");
      setMobilePanel("catalog");
      return;
    }
    setMessage(null);
    setMobilePanel(nextPanel);
  }

  function requestClose() {
    if (saving) return;
    const hasDraft = Boolean(routeCustomerId || items.length || note.trim());
    if (hasDraft && !window.confirm("Đơn đang nhập chưa lưu. Đóng và bỏ nội dung này?")) return;
    onClose();
  }

  async function submit() {
    if (saving || submitInFlightRef.current) return;
    if (!selectedCustomer?.coreCustomerId || !selectedCustomer.coreCustomerAddressId) {
      setMessage("Chỉ tạo đơn cho khách đã mở / liên kết mã công ty.");
      setMobilePanel("customer");
      return;
    }
    if (items.length === 0) {
      setMessage("Chọn ít nhất một sản phẩm.");
      setMobilePanel("catalog");
      return;
    }
    if (mobilePanel !== "cart") {
      setMessage("Xem lại đơn trước khi tạo.");
      setMobilePanel("cart");
      return;
    }

    const body = {
      customerId: selectedCustomer.coreCustomerId,
      customerAddressId: selectedCustomer.coreCustomerAddressId,
      note: note.trim() || undefined,
      lines: items.map((item) => ({
        variantId: item.variantId,
        quantity: String(item.quantity),
        note: [item.name, variantLabel(item)].filter(Boolean).join(" · ") || undefined
      }))
    };
    const fingerprint = JSON.stringify(body);
    if (!submissionRef.current || submissionRef.current.fingerprint !== fingerprint) {
      submissionRef.current = {
        fingerprint,
        key: createIdempotencyKey("mcp.sales-order.create")
      };
    }

    submitInFlightRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await idempotentMutationFetch(
        "/api/backend/core-sales/orders",
        {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body)
        },
        {
          operation: "mcp.sales-order.create",
          key: submissionRef.current.key
        }
      );
      const payload = await response.json().catch(() => ({})) as { data?: CoreOrderResult; error?: unknown; detail?: string };
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tạo được đơn bán hàng Core"));
      const orderCode = payload.data?.number || payload.data?.id || "đơn Core";
      submissionRef.current = null;
      setItems([]);
      setNote("");
      onCreated(orderCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tạo được đơn bán hàng Core");
      setMobilePanel("cart");
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
    }
  }

  function runPrimaryAction() {
    if (!customerReady) {
      setMessage("Bước 1: chọn một khách công ty đã mở mã.");
      setMobilePanel("customer");
      return;
    }
    if (items.length === 0) {
      setMessage("Bước 2: chọn sản phẩm.");
      setMobilePanel("catalog");
      return;
    }
    if (mobilePanel !== "cart") {
      setMessage(null);
      setMobilePanel("cart");
      return;
    }
    void submit();
  }

  const customerDescription = selectedCustomer?.customerName || "Chưa chọn khách";
  const primaryLabel = !customerReady
    ? "Chọn khách"
    : items.length === 0
      ? "Chọn sản phẩm"
      : mobilePanel === "cart"
        ? "Tạo đơn"
        : "Xem lại đơn";
  const footerHint = message || (!customerReady
    ? "Chỉ chọn khách công ty đã mở mã"
    : items.length === 0
      ? "Đã chọn khách · chọn sản phẩm"
      : `${items.length} dòng · ${totalQuantity} sản phẩm`);

  return (
    <BottomSheet
      open={open}
      onClose={requestClose}
      title="Tạo đơn hàng"
      description={`${customerDescription} · ${totalQuantity} sản phẩm`}
      variant="workspace"
      footer={(
        <div className={styles.footer}>
          <div className={styles.footerSummary} aria-live="polite">
            <small>{footerHint}</small>
            <strong>{totalLabel}</strong>
          </div>
          <button className={`${styles.cartButton} button`} type="button" onClick={() => requestPanel("cart")} disabled={saving || items.length === 0}>
            Đơn ({totalQuantity})
          </button>
          <button className={`${styles.primaryAction} button primary`} type="button" onClick={runPrimaryAction} disabled={saving} data-ready={readyToSubmit ? "true" : "false"}>
            {saving ? "Đang tạo..." : primaryLabel}
          </button>
          <button className={`${styles.desktopClose} button`} type="button" onClick={requestClose} disabled={saving}>Đóng</button>
        </div>
      )}
    >
      <div className={styles.workspace} data-mobile-panel={mobilePanel}>
        <nav className={styles.mobileTabs} aria-label="Các bước tạo đơn">
          <button type="button" data-active={mobilePanel === "customer" ? "true" : "false"} onClick={() => requestPanel("customer")} disabled={saving}>
            <span>1. Khách</span><small>{customerReady ? "Đã chọn" : "Bắt buộc"}</small>
          </button>
          <button type="button" data-active={mobilePanel === "catalog" ? "true" : "false"} onClick={() => requestPanel("catalog")} disabled={!customerReady || saving}>
            <span>2. Sản phẩm</span><small>{productGroups.length} nhãn · {products.length} vị</small>
          </button>
          <button type="button" data-active={mobilePanel === "cart" ? "true" : "false"} onClick={() => requestPanel("cart")} disabled={!customerReady || items.length === 0 || saving}>
            <span>3. Đơn</span><small>{totalQuantity} sản phẩm</small>
          </button>
        </nav>

        <div className={styles.leftPane}>
          <section className={`${styles.section} ${styles.customerSection}`}>
            <div className={styles.sectionHead}>
              <div><strong>1. Chọn khách công ty</strong><small>Chỉ khách đã mở hoặc liên kết mã mới được tạo đơn</small></div>
              {customerReady ? <span className={styles.selectionBadge}>Đã chọn</span> : null}
            </div>

            <div className={styles.customerPicker}>
              <label className={styles.compactField}>
                <span>Tìm khách công ty</span>
                <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tên, SĐT, khu vực hoặc mã khách" disabled={saving} />
              </label>

              {selectedCustomer ? (
                <div className={styles.selectedCustomerSummary} aria-live="polite">
                  <span aria-hidden="true">✓</span>
                  <div><strong>{selectedCustomer.customerName}</strong><small>{selectedCustomer.coreCustomerCode || "Đã liên kết"} · {selectedCustomer.routeName || "MCP"}</small></div>
                  <button type="button" onClick={() => setRouteCustomerId("")} disabled={saving}>Đổi</button>
                </div>
              ) : null}

              <div className={styles.customerList} role="radiogroup" aria-label="Chọn một khách công ty" data-order-customer-list>
                {customers.length === 0 ? <p className={styles.emptyState}>Chưa có khách công ty. Mở / liên kết mã ở tab Khách trước khi tạo đơn.</p> : null}
                {customers.length > 0 && filteredCustomers.length === 0 ? <p className={styles.emptyState}>Không có khách phù hợp với từ khóa.</p> : null}
                {filteredCustomers.map((customer) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={routeCustomerId === customer.routeCustomerId}
                    key={customer.routeCustomerId}
                    className={routeCustomerId === customer.routeCustomerId ? styles.selectedCustomer : ""}
                    onClick={() => {
                      setRouteCustomerId(customer.routeCustomerId);
                      setMessage(null);
                      submissionRef.current = null;
                    }}
                    disabled={saving}
                  >
                    <span className={styles.customerRadio} aria-hidden="true">{routeCustomerId === customer.routeCustomerId ? "✓" : ""}</span>
                    <span className={styles.customerCopy}>
                      <strong>{customer.customerName}</strong>
                      <span>{customer.phone || "Chưa có SĐT"} · {customer.area || "Chưa có khu vực"}</span>
                      <small>{customer.coreCustomerCode || "Đã liên kết"} · {customer.routeName || "MCP"}</small>
                    </span>
                  </button>
                ))}
              </div>

              <div className={styles.customerPickerFooter} data-order-customer-footer>
                <button className={`${styles.customerContinue} button primary`} type="button" onClick={() => requestPanel("catalog")} disabled={!customerReady || saving}>
                  Tiếp tục với {selectedCustomer?.customerName || "khách đã chọn"}
                </button>
              </div>
            </div>
            {message && mobilePanel === "customer" ? <p className={styles.message}>{message}</p> : null}
          </section>

          <section className={`${styles.section} ${styles.catalogSection}`}>
            <div className={styles.sectionHead}>
              <div><strong>2. Chọn sản phẩm và vị</strong><small>Giữ cách chọn sản phẩm cũ; giá hiển thị chỉ để tham khảo</small></div>
              <span className={styles.resultCount} aria-live="polite">{loadingProducts ? "Đang tìm..." : `${productGroups.length} sản phẩm · ${products.length} vị`}</span>
            </div>

            <div className={styles.searchToolbar}>
              <label className={`${styles.compactField} ${styles.searchField}`}>
                <span>Tìm sản phẩm</span>
                <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Tên, nhãn, SKU, vị, dung tích..." disabled={saving} />
              </label>
              <button className={styles.toolButton} type="button" onClick={() => void loadProducts(productSearch, productCategory, productBrand)} disabled={saving || loadingProducts}>Lọc</button>
              <button className={styles.toolButton} type="button" onClick={clearProductFilters} disabled={saving || (!productSearch && !productCategory && !productBrand)}>Xóa</button>
            </div>

            <div className={styles.filterRow}>
              <label className={styles.compactField}>
                <span>Nhóm hàng</span>
                <select value={productCategory} onChange={(event) => setProductCategory(event.target.value)} disabled={saving}>
                  <option value="">Tất cả nhóm</option>
                  {categorySections.map((section) => (
                    <optgroup key={section.key} label={section.label}>
                      {section.categories.map((category) => <option key={category} value={category}>{category}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className={styles.compactField}>
                <span>Nhãn hàng</span>
                <select value={productBrand} onChange={(event) => setProductBrand(event.target.value)} disabled={saving}>
                  <option value="">Tất cả nhãn</option>
                  {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </label>
            </div>

            {addedNotice ? <p className={styles.addedNotice} aria-live="assertive">✓ {addedNotice}</p> : null}
            {message && mobilePanel === "catalog" ? <p className={styles.message}>{message}</p> : null}
            {productError ? <p className={styles.message}>{productError}</p> : null}

            <div className={styles.productResults} aria-label="Kết quả tìm sản phẩm" data-order-product-list>
              {loadingProducts && products.length === 0 ? <p className={styles.emptyState}>Đang tải danh mục sản phẩm...</p> : null}
              {!loadingProducts && products.length === 0 && !productError ? <p className={styles.emptyState}>Không tìm thấy sản phẩm. Thử xóa bớt bộ lọc hoặc tìm bằng SKU.</p> : null}
              {productGroups.map((group) => {
                const groupQuantity = group.variants.reduce((sum, variant) => sum + (selectedQuantityByVariant.get(variant.variantId) || 0), 0);
                const family = catalogFamilyLabel(group.productId, group.category);
                const choiceCount = group.variants.length > 1 ? `${group.variants.length} vị / quy cách` : "1 quy cách";
                return (
                  <article key={group.productId} className={`${styles.productCard} ${groupQuantity ? styles.productCardSelected : ""}`} data-family={family}>
                    <header className={styles.productHeader}>
                      <div className={styles.productIdentity}>
                        <small>{[family, group.category, group.brand].filter(Boolean).join(" · ")}</small>
                        <strong>{group.name}</strong>
                      </div>
                      <span>{groupQuantity ? `${groupQuantity} đã chọn` : choiceCount}</span>
                    </header>
                    <div className={styles.variantGrid}>
                      {group.variants.map((product) => {
                        const selectedQuantity = selectedQuantityByVariant.get(product.variantId) || 0;
                        const primaryLabel = variantPrimaryLabel(product);
                        const secondaryLabel = variantSecondaryLabel(product);
                        return (
                          <button
                            type="button"
                            key={product.variantId}
                            className={`${styles.variantButton} ${selectedQuantity ? styles.variantSelected : ""}`}
                            onClick={() => toggleCatalogProduct(product)}
                            disabled={!customerReady || saving}
                            aria-label={selectedQuantity ? `Giảm ${product.name}, ${primaryLabel} trong đơn` : `Thêm ${product.name}, ${primaryLabel} vào đơn`}
                            title={`${product.name} · ${primaryLabel} · ${secondaryLabel}`}
                          >
                            <span className={styles.variantName}>{primaryLabel}</span>
                            <small>{secondaryLabel}</small>
                            <span className={styles.variantFooter}>
                              <strong>{catalogPriceLabel(product.price)}</strong>
                              <em>{selectedQuantity ? `${selectedQuantity} trong đơn · chạm để giảm` : "+ Thêm"}</em>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <aside className={styles.rightPane}>
          <section className={`${styles.section} ${styles.cartSection}`}>
            <div className={styles.sectionHead}>
              <div><strong>Đơn đang lên</strong><small>{items.length} dòng · {totalQuantity} sản phẩm</small></div>
              <b className={styles.cartTotal}>{totalLabel}</b>
            </div>
            <div className={styles.itemList}>
              {items.length === 0 ? <p className={styles.emptyState}>Chưa có sản phẩm. Mở tab Sản phẩm và chọn vị ngay trong card.</p> : null}
              {items.map((item) => (
                <article key={item.variantId} className={styles.cartItem}>
                  <div className={styles.itemHead}>
                    <div className={styles.itemIdentity}>
                      <small>{[item.brand, item.category].filter(Boolean).join(" · ") || "Sản phẩm"}</small>
                      <strong>{item.name}</strong>
                      <span className={styles.variantBadge}>{variantPrimaryLabel(item)}</span>
                    </div>
                    <button className={styles.removeItem} type="button" onClick={() => setItems((current) => current.filter((candidate) => candidate.variantId !== item.variantId))} disabled={saving} aria-label={`Xóa ${item.name}, ${variantPrimaryLabel(item)}`}>×</button>
                  </div>
                  <div className={styles.itemControls}>
                    <div className={styles.quantityBlock}>
                      <span>Số lượng</span>
                      <div className={styles.quantityControl}>
                        <button type="button" onClick={() => decreaseProduct(item.variantId)} disabled={saving} aria-label={`Giảm ${item.name}`}>−</button>
                        <input type="number" min="1" inputMode="numeric" value={item.quantity} onChange={(event) => updateQuantity(item.variantId, Number(event.target.value))} disabled={saving} />
                        <button type="button" onClick={() => addProduct(item)} disabled={saving} aria-label={`Tăng ${item.name}`}>+</button>
                      </div>
                    </div>
                    <div className={styles.lineTotal}><span>Giá tham khảo</span><strong>{catalogPriceLabel(item.price)}</strong></div>
                    <div className={styles.lineTotal}><span>Tạm tính</span><strong>{item.price === null || item.price === undefined ? "Core quyết định" : money.format(item.price * item.quantity)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={`${styles.section} ${styles.finalSection}`}>
            <div className={styles.sectionHead}><div><strong>3. Hoàn tất</strong><small>Core tự quyết định giá và chính sách thương mại</small></div></div>
            <label className={styles.compactField}><span>Ghi chú đơn</span><textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={saving} /></label>
            {message && mobilePanel === "cart" ? <p className={styles.message}>{message}</p> : null}
          </section>
        </aside>
      </div>
    </BottomSheet>
  );
}
