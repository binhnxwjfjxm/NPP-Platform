"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import styles from "./McpCoreOrdersClient.module.css";

type CatalogItem = {
  productId: string;
  variantId: string;
  name: string;
  sku?: string | null;
  variantName?: string | null;
  sellUnit?: string | null;
  price?: number | null;
};

type CartItem = CatalogItem & { quantity: number };

type OrderCustomer = {
  customerId: string;
  customerAddressId: string;
  customerCode?: string | null;
  customerName: string;
};

type CoreOrder = {
  id: string;
  number?: string | null;
  status: "draft" | "confirmed" | "cancelled" | "closed";
  sourceType: string;
  sourceId?: string | null;
  sourceOutletId?: string | null;
  customerId: string;
  customerCode?: string | null;
  customerName?: string | null;
  salesChannelCode?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

type SubmissionRef = {
  fingerprint: string;
  key: string;
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

function normalizeCatalog(value: unknown): CatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Partial<CatalogItem>)
    .filter((item) => item.productId && item.variantId && item.name)
    .map((item) => ({
      productId: String(item.productId),
      variantId: String(item.variantId),
      name: String(item.name),
      sku: item.sku ?? null,
      variantName: item.variantName ?? null,
      sellUnit: item.sellUnit ?? null,
      price: item.price === null || item.price === undefined || !Number.isFinite(Number(item.price))
        ? null
        : Number(item.price)
    }));
}

function statusLabel(status: CoreOrder["status"]) {
  if (status === "draft") return "Nháp";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "cancelled") return "Đã hủy";
  return "Hoàn tất";
}

function customerLabel(customer: OrderCustomer) {
  const customerCode = customer.customerCode ? ` · ${customer.customerCode}` : "";
  return `${customer.customerName}${customerCode}`;
}

export function McpCoreOrdersClient({
  customers,
  initialError = null
}: {
  customers: OrderCustomer[];
  initialError?: string | null;
}) {
  const [customerKey, setCustomerKey] = useState("");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState("");
  const [orders, setOrders] = useState<CoreOrder[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(initialError);
  const submissionRef = useRef<SubmissionRef | null>(null);

  const customerOptions = useMemo(() => {
    const unique = new Map<string, OrderCustomer>();
    for (const customer of customers) {
      if (!customer.customerId || !customer.customerAddressId) continue;
      const key = `${customer.customerId}:${customer.customerAddressId}`;
      if (!unique.has(key)) unique.set(key, customer);
    }
    return [...unique.entries()];
  }, [customers]);

  const selectedCustomer = customerOptions.find(([key]) => key === customerKey)?.[1] || null;

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const response = await fetch("/api/backend/core-sales/orders", {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được đơn MCP từ Công Ty"));
      const data = (payload as { data?: unknown }).data;
      setOrders(Array.isArray(data) ? data as CoreOrder[] : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tải được đơn MCP từ Công Ty");
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const loadProducts = useCallback(async (query: string) => {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: "50" });
      const response = await fetch(`/api/products/search?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được sản phẩm Công Ty"));
      setProducts(normalizeCatalog((payload as { data?: unknown }).data));
    } catch (error) {
      setProducts([]);
      setMessage(error instanceof Error ? error.message : "Không tải được sản phẩm Công Ty");
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(search), 250);
    return () => window.clearTimeout(timer);
  }, [loadProducts, search]);

  function addProduct(product: CatalogItem) {
    setCart((current) => {
      const existing = current.find((item) => item.variantId === product.variantId);
      if (existing) {
        return current.map((item) => item.variantId === product.variantId
          ? { ...item, quantity: item.quantity + 1 }
          : item);
      }
      return [...current, { ...product, quantity: 1 }];
    });
  }

  function changeQuantity(variantId: string, quantity: number) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setCart((current) => current.filter((item) => item.variantId !== variantId));
      return;
    }
    setCart((current) => current.map((item) => item.variantId === variantId
      ? { ...item, quantity: Math.max(1, Math.trunc(quantity)) }
      : item));
  }

  async function submit() {
    if (!selectedCustomer?.customerId || !selectedCustomer.customerAddressId) {
      setMessage("Chọn khách Công Ty có địa chỉ giao hàng hợp lệ.");
      return;
    }
    if (cart.length === 0) {
      setMessage("Chọn ít nhất một sản phẩm.");
      return;
    }

    const body = {
      customerId: selectedCustomer.customerId,
      customerAddressId: selectedCustomer.customerAddressId,
      note: note.trim() || undefined,
      lines: cart.map((item) => ({
        variantId: item.variantId,
        quantity: String(item.quantity),
        note: [item.name, item.variantName, item.sku].filter(Boolean).join(" · ") || undefined
      }))
    };
    const fingerprint = JSON.stringify(body);
    if (!submissionRef.current || submissionRef.current.fingerprint !== fingerprint) {
      submissionRef.current = {
        fingerprint,
        key: createIdempotencyKey("mcp.sales-order.create")
      };
    }

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
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tạo được đơn bán hàng"));
      const order = (payload as { data?: CoreOrder }).data;
      submissionRef.current = null;
      setCart([]);
      setNote("");
      setMessage(`Đã tạo đơn Công Ty${order?.number ? ` ${order.number}` : ""}. Giá và chính sách bán hàng do Công Ty xác định.`);
      await loadOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tạo được đơn bán hàng");
    } finally {
      setSaving(false);
    }
  }

  const estimatedTotal = cart.reduce((sum, item) => (
    sum + (item.price ?? 0) * item.quantity
  ), 0);

  return (
    <AppShell activeHref="/orders">
      <PageHeader
        eyebrow="MCP → Công Ty"
        title="Đơn hàng MCP"
        subtitle="Tạo đơn chính thức cho khách Công Ty thuộc phạm vi phụ trách. Khách đã có mã Công Ty không cần mở mã lại."
      >
        <button className="button" type="button" disabled={loadingOrders} onClick={() => void loadOrders()}>
          {loadingOrders ? "Đang tải..." : "Làm mới đơn"}
        </button>
      </PageHeader>

      {message ? <section className={`card ${styles.message}`} role="status">{message}</section> : null}

      <section className={`card ${styles.createCard}`}>
        <div className={styles.sectionHeading}>
          <div>
            <span className="page-eyebrow">Tạo đơn chính thức</span>
            <h2>Khách Công Ty</h2>
          </div>
          <small>Nhân viên phụ trách lấy theo Công Ty; giá và chính sách bán hàng do Công Ty xác định.</small>
        </div>

        <label className={styles.field}>
          <span>Khách hàng</span>
          <select
            value={customerKey}
            disabled={saving}
            onChange={(event) => {
              setCustomerKey(event.target.value);
              setCart([]);
              submissionRef.current = null;
            }}
          >
            <option value="">Chọn khách Công Ty</option>
            {customerOptions.map(([key, customer]) => (
              <option key={key} value={key}>{customerLabel(customer)}</option>
            ))}
          </select>
        </label>

        {customerOptions.length === 0 ? (
          <p className={styles.empty}>Chưa có khách Công Ty đang hoạt động, có địa chỉ và thuộc phạm vi phụ trách.</p>
        ) : null}

        <div className={styles.catalogGrid}>
          <div>
            <label className={styles.field}>
              <span>Sản phẩm Công Ty</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm tên hoặc SKU"
                disabled={saving}
              />
            </label>
            <div className={styles.productList}>
              {loadingProducts ? <p>Đang tải sản phẩm...</p> : null}
              {!loadingProducts && products.map((product) => (
                <button
                  className={styles.productRow}
                  type="button"
                  key={product.variantId}
                  disabled={!selectedCustomer || saving}
                  onClick={() => addProduct(product)}
                >
                  <span>
                    <strong>{product.name}</strong>
                    <small>{[product.variantName, product.sellUnit, product.sku].filter(Boolean).join(" · ")}</small>
                  </span>
                  <b>{product.price === null || product.price === undefined ? "Công Ty sẽ xác định giá" : money.format(product.price)}</b>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.cart}>
            <div className={styles.sectionHeading}>
              <div><h3>Đơn đang tạo</h3><small>{cart.length} SKU</small></div>
              <strong>{estimatedTotal > 0 ? `Tham khảo ${money.format(estimatedTotal)}` : "Giá do Công Ty quyết định"}</strong>
            </div>
            {cart.length === 0 ? <p className={styles.empty}>Chưa chọn sản phẩm.</p> : null}
            {cart.map((item) => (
              <div className={styles.cartRow} key={item.variantId}>
                <span><strong>{item.name}</strong><small>{item.sku || item.variantName || "SKU"}</small></span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={item.quantity}
                  disabled={saving}
                  onChange={(event) => changeQuantity(item.variantId, Number(event.target.value))}
                  aria-label={`Số lượng ${item.name}`}
                />
              </div>
            ))}
            <label className={styles.field}>
              <span>Ghi chú đơn</span>
              <textarea value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} rows={3} />
            </label>
            <p className={styles.commercialNote}>
              Giá hiển thị chỉ để tham khảo. Khi tạo đơn, Công Ty tự xác nhận SKU, đơn vị, giá, thuế, kênh bán và chính sách thương mại.
            </p>
            <button className="button primary" type="button" disabled={saving || !selectedCustomer || cart.length === 0} onClick={() => void submit()}>
              {saving ? "Đang tạo đơn..." : "Tạo đơn"}
            </button>
          </div>
        </div>
      </section>

      <section className={`card ${styles.ordersCard}`}>
        <div className={styles.sectionHeading}>
          <div>
            <span className="page-eyebrow">Đơn chính thức</span>
            <h2>Đơn MCP của tôi</h2>
          </div>
          <small>Hiển thị đơn MCP theo khách Công Ty thuộc phạm vi phụ trách.</small>
        </div>
        {loadingOrders ? <p>Đang tải đơn...</p> : null}
        {!loadingOrders && orders.length === 0 ? <p className={styles.empty}>Chưa có đơn MCP chính thức.</p> : null}
        <div className={styles.orderList}>
          {orders.map((order) => (
            <article className={styles.orderRow} key={order.id}>
              <div>
                <span className={styles.sourceBadge}>MCP</span>
                <strong>{order.number || "Đơn nháp"}</strong>
                <small>{order.customerCode || order.customerName || order.customerId}</small>
              </div>
              <div>
                <b>{statusLabel(order.status)}</b>
                <small>{order.salesChannelCode ? `Kênh ${order.salesChannelCode}` : "Kênh MCP"}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
