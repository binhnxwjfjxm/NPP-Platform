"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RouteCustomerItem } from "@/features/mcp/route-customers.types";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import type { OrderSessionOption } from "./order-create.types";
import {
  catalogFamilyLabel,
  compareCatalogProducts,
  groupCatalogCategories
} from "./order-catalog-priority";
import styles from "./OrderCreateSheet.module.css";

type CustomerMode = "existing" | "manual";
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

type OrderDraftItem = ProductCatalogItem & {
  quantity: number;
  unitPrice: number;
};

type ManualCustomer = {
  name: string;
  phone: string;
  area: string;
  address: string;
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
      price: Number(item.price || 0)
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

function emptyManualCustomer(): ManualCustomer {
  return { name: "", phone: "", area: "", address: "" };
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

function sessionLabel(session: OrderSessionOption) {
  return `${session.routeName} · ${session.sessionDate}${session.status === "active" ? " · Đang chạy" : ""}`;
}

export function OrderCreateSheet({
  open,
  customers,
  sessions,
  onClose,
  onCreated
}: {
  open: boolean;
  customers: RouteCustomerItem[];
  sessions: OrderSessionOption[];
  onClose: () => void;
  onCreated: (orderCode: string) => void;
}) {
  const router = useRouter();
  const productRequestRef = useRef(0);
  const addedNoticeTimerRef = useRef<number | null>(null);
  const submitInFlightRef = useRef(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("customer");
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [routeCustomerId, setRouteCustomerId] = useState("");
  const [manualCustomer, setManualCustomer] = useState<ManualCustomer>(emptyManualCustomer());
  const [sales, setSales] = useState("Sale");
  const [status, setStatus] = useState<"draft" | "confirmed">("confirmed");
  const [note, setNote] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [productBrand, setProductBrand] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [items, setItems] = useState<OrderDraftItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [addedNotice, setAddedNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sessionOptions = useMemo(() => [...sessions].sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return `${right.sessionDate}-${right.routeName}`.localeCompare(`${left.sessionDate}-${left.routeName}`, "vi");
  }), [sessions]);
  const activeSessions = useMemo(() => sessionOptions.filter((session) => session.status === "active"), [sessionOptions]);
  const doneSessions = useMemo(() => sessionOptions.filter((session) => session.status === "done"), [sessionOptions]);
  const selectedSession = sessionOptions.find((session) => session.id === selectedSessionId) || null;
  const activeCustomers = useMemo(() => customers.filter((customer) => customer.status !== "hidden"), [customers]);
  const scopedCustomers = useMemo(() => {
    if (selectedSession) return activeCustomers.filter((customer) => customer.routeId === selectedSession.routeId);
    return sessionOptions.length === 0 ? activeCustomers : [];
  }, [activeCustomers, selectedSession, sessionOptions.length]);
  const filteredCustomers = useMemo(() => {
    const query = normalizeText(customerSearch);
    if (!query) return scopedCustomers;
    return scopedCustomers.filter((customer) => normalizeText(
      `${customer.accountName} ${customer.contactName} ${customer.area} ${customer.routeName}`
    ).includes(query));
  }, [customerSearch, scopedCustomers]);
  const selectedCustomer = activeCustomers.find((customer) => customer.id === routeCustomerId) || null;
  const productGroups = useMemo(() => groupCatalog(products), [products]);
  const categorySections = useMemo(() => groupCatalogCategories(categoryOptions), [categoryOptions]);
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const selectedQuantityByVariant = useMemo(() => new Map(items.map((item) => [item.variantId, item.quantity])), [items]);
  const customerReady = customerMode === "existing" ? Boolean(routeCustomerId) : Boolean(manualCustomer.name.trim());
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
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được sản phẩm"));
      const nextProducts = normalizeCatalogItems((payload as { data?: unknown }).data);
      if (requestId !== productRequestRef.current) return;
      setProducts(nextProducts);
      setCategoryOptions((current) => mergeOptions(current, nextProducts.map((item) => item.category)));
      setBrandOptions((current) => mergeOptions(current, nextProducts.map((item) => item.brand)));
    } catch (error) {
      if (requestId !== productRequestRef.current) return;
      setProducts([]);
      setProductError(error instanceof Error ? error.message : "Không tải được sản phẩm");
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
    const preferredSession = sessionOptions.find((session) => session.status === "active") || sessionOptions[0] || null;
    setMobilePanel("customer");
    setCustomerMode("existing");
    setSelectedSessionId(preferredSession?.id || "");
    setCustomerSearch("");
    setRouteCustomerId("");
    setManualCustomer(emptyManualCustomer());
    setSales("Sale");
    setStatus("confirmed");
    setNote("");
    setProductSearch("");
    setProductCategory("");
    setProductBrand("");
    setCategoryOptions([]);
    setBrandOptions([]);
    setProducts([]);
    setItems([]);
    setProductError(null);
    setAddedNotice("");
    setMessage(null);
  }, [open, sessionOptions]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadProducts(productSearch, productCategory, productBrand);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadProducts, open, productBrand, productCategory, productSearch]);

  useEffect(() => {
    if (!routeCustomerId) return;
    const current = activeCustomers.find((customer) => customer.id === routeCustomerId);
    if (!current || (selectedSession && current.routeId !== selectedSession.routeId)) setRouteCustomerId("");
  }, [activeCustomers, routeCustomerId, selectedSession]);

  function announceAdded(product: ProductCatalogItem, nextQuantity: number) {
    setAddedNotice(`${product.name} · ${variantPrimaryLabel(product)}: ${nextQuantity} trong đơn`);
    if (addedNoticeTimerRef.current !== null) window.clearTimeout(addedNoticeTimerRef.current);
    addedNoticeTimerRef.current = window.setTimeout(() => setAddedNotice(""), 1800);
  }

  function addProduct(product: ProductCatalogItem) {
    if (!customerReady) {
      setMessage("Chọn đúng một khách trước khi thêm sản phẩm vào đơn.");
      setMobilePanel("customer");
      return;
    }
    const nextQuantity = (selectedQuantityByVariant.get(product.variantId) || 0) + 1;
    setMessage(null);
    setItems((current) => {
      const existed = current.find((item) => item.variantId === product.variantId);
      if (existed) return current.map((item) => item.variantId === product.variantId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { ...product, quantity: 1, unitPrice: Number(product.price || 0) }];
    });
    announceAdded(product, nextQuantity);
  }

  function decreaseProduct(variantId: string) {
    setItems((current) => current.flatMap((item) => {
      if (item.variantId !== variantId) return [item];
      if (item.quantity <= 1) return [];
      return [{ ...item, quantity: item.quantity - 1 }];
    }));
  }

  function updateItem(variantId: string, field: "quantity" | "unitPrice", value: number) {
    setItems((current) => current.map((item) => {
      if (item.variantId !== variantId) return item;
      if (field === "quantity") return { ...item, quantity: Math.max(1, value || 1) };
      return { ...item, unitPrice: Math.max(0, value || 0) };
    }));
  }

  function chooseCustomerMode(mode: CustomerMode) {
    setCustomerMode(mode);
    setMessage(null);
  }

  function selectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setRouteCustomerId("");
    setCustomerSearch("");
    setMessage(null);
  }

  function selectCustomer(customerId: string) {
    setRouteCustomerId(customerId);
    setMessage(null);
  }

  function updateManualCustomer(field: keyof ManualCustomer, value: string) {
    setManualCustomer((current) => ({ ...current, [field]: value }));
    setMessage(null);
  }

  function clearProductFilters() {
    setProductSearch("");
    setProductCategory("");
    setProductBrand("");
  }

  function requestPanel(nextPanel: MobilePanel) {
    if (nextPanel === "catalog" && !customerReady) {
      setMessage("Bước 1: chọn đúng một khách hoặc nhập khách thủ công.");
      setMobilePanel("customer");
      return;
    }
    if (nextPanel === "cart" && !customerReady) {
      setMessage("Bước 1: chọn khách trước khi xem đơn.");
      setMobilePanel("customer");
      return;
    }
    if (nextPanel === "cart" && items.length === 0) {
      setMessage("Bước 2: chọn ít nhất một vị hoặc quy cách sản phẩm.");
      setMobilePanel("catalog");
      return;
    }
    setMessage(null);
    setMobilePanel(nextPanel);
  }

  function requestClose() {
    if (saving) return;
    const hasDraft = Boolean(
      routeCustomerId
      || manualCustomer.name.trim()
      || manualCustomer.phone.trim()
      || manualCustomer.area.trim()
      || manualCustomer.address.trim()
      || items.length
      || note.trim()
    );
    if (hasDraft && !window.confirm("Đơn đang nhập chưa lưu. Đóng và bỏ nội dung này?")) return;
    onClose();
  }

  async function submit() {
    if (saving || submitInFlightRef.current) return;
    if (!customerReady) {
      setMessage("Chọn khách hoặc nhập tên khách trước khi tạo đơn.");
      setMobilePanel("customer");
      return;
    }
    if (items.length === 0) {
      setMessage("Chọn ít nhất một vị hoặc quy cách sản phẩm.");
      setMobilePanel("catalog");
      return;
    }
    if (mobilePanel !== "cart") {
      setMessage("Kiểm tra số lượng và đơn giá, sau đó bấm Tạo đơn.");
      setMobilePanel("cart");
      return;
    }

    submitInFlightRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await idempotentMutationFetch(
        "/api/backend/orders",
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            customerMode,
            routeCustomerId: customerMode === "existing" ? routeCustomerId : undefined,
            customer: customerMode === "manual" ? manualCustomer : undefined,
            sales,
            status,
            note,
            items: items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              productName: item.name,
              sku: item.sku,
              unit: item.sellUnit || "",
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              note: variantLabel(item)
            }))
          })
        },
        { operation: "order.create" }
      );
      const payload = await response.json().catch(() => ({})) as { data?: { orderCode?: string }; error?: unknown; detail?: string };
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tạo được đơn hàng"));
      const orderCode = payload.data?.orderCode || "Đơn mới";
      router.refresh();
      onCreated(orderCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tạo được đơn hàng");
      setMobilePanel("cart");
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
    }
  }

  function runPrimaryAction() {
    if (!customerReady) {
      setMessage("Bước 1: chọn đúng một khách hoặc nhập khách thủ công.");
      setMobilePanel("customer");
      return;
    }
    if (items.length === 0) {
      setMessage("Bước 2: chọn vị hoặc quy cách ngay trong card sản phẩm.");
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

  const customerDescription = customerMode === "existing"
    ? selectedCustomer?.accountName || "Chưa chọn khách"
    : manualCustomer.name || "Khách nhập tay";
  const primaryLabel = !customerReady
    ? "Chọn khách"
    : items.length === 0
      ? "Chọn sản phẩm"
      : mobilePanel === "cart"
        ? "Tạo đơn"
        : "Xem lại đơn";
  const footerHint = message || (!customerReady
    ? "Chọn một khách để bắt đầu"
    : items.length === 0
      ? "Đã chọn khách · chọn vị sản phẩm"
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
            <strong>{money.format(total)}</strong>
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
              <div><strong>1. Chọn một khách</strong><small>Chọn phiên để lọc đúng tuyến, hoặc nhập khách thủ công</small></div>
              {customerReady ? <span className={styles.selectionBadge}>Đã chọn</span> : null}
            </div>

            <div className={styles.modeTabs} role="tablist" aria-label="Nguồn khách của đơn">
              <button type="button" className={customerMode === "existing" ? styles.activeTab : ""} onClick={() => chooseCustomerMode("existing")} disabled={saving}>
                <strong>Khách trong phiên</strong><small>Chọn phiên → chọn khách</small>
              </button>
              <button type="button" className={customerMode === "manual" ? styles.activeTab : ""} onClick={() => chooseCustomerMode("manual")} disabled={saving}>
                <strong>Khách nhập tay</strong><small>Khách mới hoặc vãng lai</small>
              </button>
            </div>

            {customerMode === "existing" ? (
              <div className={styles.customerPicker}>
                <label className={`${styles.compactField} ${styles.sessionField}`}>
                  <span>Phiên / tuyến *</span>
                  <select value={selectedSessionId} onChange={(event) => selectSession(event.target.value)} disabled={saving || sessionOptions.length === 0}>
                    {sessionOptions.length === 0 ? <option value="">Không có phiên gần đây · hiển thị toàn bộ khách</option> : null}
                    {activeSessions.length ? <optgroup label="Đang chạy">{activeSessions.map((session) => <option key={session.id} value={session.id}>{sessionLabel(session)}</option>)}</optgroup> : null}
                    {doneSessions.length ? <optgroup label="Đã chốt gần đây">{doneSessions.map((session) => <option key={session.id} value={session.id}>{sessionLabel(session)}</option>)}</optgroup> : null}
                  </select>
                </label>

                {selectedSession ? (
                  <div className={styles.sessionSummary}>
                    <div><strong>{selectedSession.routeName}</strong><span>{selectedSession.sessionDate} · {selectedSession.status === "active" ? "Đang chạy" : "Đã chốt"}</span></div>
                    <b>{selectedSession.visitedCustomers}/{selectedSession.plannedCustomers} đã ghé</b>
                  </div>
                ) : null}

                <label className={styles.compactField}>
                  <span>Tìm trong {selectedSession ? selectedSession.routeName : "danh sách khách"}</span>
                  <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tên, SĐT hoặc khu vực" disabled={saving || (sessionOptions.length > 0 && !selectedSession)} />
                </label>

                {selectedCustomer ? (
                  <div className={styles.selectedCustomerSummary} aria-live="polite">
                    <span aria-hidden="true">✓</span>
                    <div><strong>{selectedCustomer.accountName}</strong><small>{selectedCustomer.contactName} · {selectedCustomer.area}</small></div>
                    <button type="button" onClick={() => setRouteCustomerId("")} disabled={saving}>Đổi</button>
                  </div>
                ) : null}

                <div className={styles.customerList} role="radiogroup" aria-label="Chọn một khách" data-order-customer-list>
                  {sessionOptions.length > 0 && !selectedSession ? <p className={styles.emptyState}>Chọn phiên trước để tải đúng khách của tuyến.</p> : null}
                  {selectedSession && scopedCustomers.length === 0 ? <p className={styles.emptyState}>Phiên này chưa có khách tuyến phù hợp.</p> : null}
                  {filteredCustomers.length === 0 && scopedCustomers.length > 0 ? <p className={styles.emptyState}>Không có khách phù hợp với từ khóa.</p> : null}
                  {filteredCustomers.map((customer) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={routeCustomerId === customer.id}
                      key={customer.id}
                      className={routeCustomerId === customer.id ? styles.selectedCustomer : ""}
                      onClick={() => selectCustomer(customer.id)}
                      disabled={saving}
                    >
                      <span className={styles.customerRadio} aria-hidden="true">{routeCustomerId === customer.id ? "✓" : ""}</span>
                      <span className={styles.customerCopy}>
                        <strong>{customer.accountName}</strong>
                        <span>{customer.contactName} · {customer.area}</span>
                        <small>#{customer.sortOrder} · {customer.routeName}</small>
                      </span>
                    </button>
                  ))}
                </div>

                <div className={styles.customerPickerFooter} data-order-customer-footer>
                  <button className={`${styles.customerContinue} button primary`} type="button" onClick={() => requestPanel("catalog")} disabled={!routeCustomerId || saving}>
                    Tiếp tục với {selectedCustomer?.accountName || "khách đã chọn"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.manualGrid}>
                <label className={styles.compactField}><span>Tên khách *</span><input autoFocus value={manualCustomer.name} onChange={(event) => updateManualCustomer("name", event.target.value)} placeholder="Tên cửa hàng / người mua" disabled={saving} /></label>
                <label className={styles.compactField}><span>Số điện thoại</span><input inputMode="tel" value={manualCustomer.phone} onChange={(event) => updateManualCustomer("phone", event.target.value)} placeholder="Số liên hệ" disabled={saving} /></label>
                <label className={styles.compactField}><span>Khu vực</span><input value={manualCustomer.area} onChange={(event) => updateManualCustomer("area", event.target.value)} placeholder="Ấp / xã / huyện" disabled={saving} /></label>
                <label className={styles.compactField}><span>Địa chỉ giao hàng</span><input value={manualCustomer.address} onChange={(event) => updateManualCustomer("address", event.target.value)} placeholder="Địa chỉ nhận hàng" disabled={saving} /></label>
                <p className={styles.hint}>Khách nhập tay được lưu trong đơn như một snapshot độc lập, không tự thêm vào tuyến.</p>
                <div className={styles.customerPickerFooter}>
                  <button className={`${styles.customerContinue} button primary`} type="button" onClick={() => requestPanel("catalog")} disabled={!manualCustomer.name.trim() || saving}>
                    Tiếp tục chọn sản phẩm
                  </button>
                </div>
              </div>
            )}
            {message && mobilePanel === "customer" ? <p className={styles.message}>{message}</p> : null}
          </section>

          <section className={`${styles.section} ${styles.catalogSection}`}>
            <div className={styles.sectionHead}>
              <div><strong>2. Chọn sản phẩm và vị</strong><small>Ưu tiên trà sữa, sau đó mì cay; vị và quy cách nằm ngay trong card</small></div>
              <span className={styles.resultCount} aria-live="polite">{loadingProducts ? "Đang tìm..." : `${productGroups.length} sản phẩm · ${products.length} vị`}</span>
            </div>

            <div className={styles.searchToolbar}>
              <label className={`${styles.compactField} ${styles.searchField}`}>
                <span>Tìm sản phẩm</span>
                <input
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void loadProducts(productSearch, productCategory, productBrand);
                    }
                  }}
                  placeholder="Tên, nhãn, SKU, vị, dung tích..."
                  disabled={saving}
                />
              </label>
              <button className={styles.toolButton} type="button" onClick={() => void loadProducts(productSearch, productCategory, productBrand)} disabled={saving || loadingProducts}>Lọc</button>
              <button className={styles.toolButton} type="button" onClick={clearProductFilters} disabled={saving || (!productSearch && !productCategory && !productBrand)}>Xóa</button>
            </div>

            <div className={styles.filterRow}>
              <label className={styles.compactField}>
                <span>Nhóm hàng · ưu tiên theo ngành</span>
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

            <div className={styles.productResults} aria-label="Kết quả tìm sản phẩm theo nhãn và vị" data-order-product-list>
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
                            onClick={() => addProduct(product)}
                            disabled={!customerReady || saving}
                            aria-label={`Thêm ${product.name}, ${primaryLabel} vào đơn`}
                            title={`${product.name} · ${primaryLabel} · ${secondaryLabel}`}
                          >
                            <span className={styles.variantName}>{primaryLabel}</span>
                            <small>{secondaryLabel}</small>
                            <span className={styles.variantFooter}>
                              <strong>{money.format(Number(product.price || 0))}</strong>
                              <em>{selectedQuantity ? `${selectedQuantity} trong đơn` : "+ Thêm"}</em>
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
              <b className={styles.cartTotal}>{money.format(total)}</b>
            </div>
            <div className={styles.itemList}>
              {items.length === 0 ? <p className={styles.emptyState}>Chưa có sản phẩm. Mở tab Sản phẩm và chọn vị ngay trong card nhãn hàng.</p> : null}
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
                        <input type="number" min="1" inputMode="decimal" value={item.quantity} onChange={(event) => updateItem(item.variantId, "quantity", Number(event.target.value))} disabled={saving} />
                        <button type="button" onClick={() => addProduct(item)} disabled={saving} aria-label={`Tăng ${item.name}`}>+</button>
                      </div>
                    </div>
                    <label className={styles.priceField}><span>Đơn giá</span><input type="number" min="0" inputMode="decimal" value={item.unitPrice} onChange={(event) => updateItem(item.variantId, "unitPrice", Number(event.target.value))} disabled={saving} /></label>
                    <div className={styles.lineTotal}><span>Thành tiền</span><strong>{money.format(item.quantity * item.unitPrice)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={`${styles.section} ${styles.finalSection}`}>
            <div className={styles.sectionHead}><div><strong>3. Hoàn tất</strong><small>Thông tin xử lý đơn</small></div></div>
            <div className={styles.finalGrid}>
              <label className={styles.compactField}><span>Nhân viên phụ trách</span><input value={sales} onChange={(event) => setSales(event.target.value)} disabled={saving} /></label>
              <label className={styles.compactField}><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value as "draft" | "confirmed")} disabled={saving}><option value="confirmed">Đã chốt</option><option value="draft">Nháp</option></select></label>
            </div>
            <label className={styles.compactField}><span>Ghi chú giao hàng / công nợ</span><textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={saving} /></label>
            {message && mobilePanel === "cart" ? <p className={styles.message}>{message}</p> : null}
          </section>
        </aside>
      </div>
    </BottomSheet>
  );
}
