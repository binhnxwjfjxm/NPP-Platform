"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import type { OrderDetailDto, OrderDto } from "@/lib/api/api.types";
import styles from "./OrderDetailDrawer.module.css";

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});
const quantity = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

function statusLabel(status: string) {
  if (status === "draft") return "Nháp";
  if (status === "confirmed") return "Đã chốt";
  if (status === "delivered") return "Đã giao";
  if (status === "cancelled") return "Đã hủy";
  return status || "Chưa xác định";
}

function statusClass(status: string) {
  if (status === "draft") return `${styles.status} ${styles.draft}`;
  if (status === "confirmed") return `${styles.status} ${styles.confirmed}`;
  if (status === "delivered") return `${styles.status} ${styles.delivered}`;
  return `${styles.status} ${styles.cancelled}`;
}

function sourceLabel(source: string) {
  if (source === "orders_tab") return "Tạo tại mục Đơn hàng";
  if (source === "mcp_session_customer") return "Tạo khi đi tuyến";
  if (source === "mcp") return "MCP";
  if (source === "phone") return "Điện thoại";
  return source || "Chưa xác định";
}

function xlsxHref(orderId: string) {
  return `/api/backend/exports/orders.csv?orderId=${encodeURIComponent(orderId)}`;
}

function pdfHref(orderId: string) {
  return `/api/pdf/order?orderId=${encodeURIComponent(orderId)}`;
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as {
    error?: string | { code?: string; message?: string };
    detail?: string;
    message?: string;
  };
  const code = typeof value.error === "object" ? value.error.code : "";
  if (code === "order_not_found") return "Không tìm thấy đơn hàng này.";
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message?.trim()) return value.error.message;
  return value.detail || value.message || fallback;
}

function itemDescription(item: OrderDetailDto["items"][number]) {
  return Array.from(new Set([item.sku, item.unit, item.note].map((value) => String(value || "").trim()).filter(Boolean))).join(" · ");
}

type OrderDetailDrawerProps = {
  open: boolean;
  order: OrderDto | null;
  possibleDuplicate: boolean;
  onClose: () => void;
};

export function OrderDetailDrawer({ open, order, possibleDuplicate, onClose }: OrderDetailDrawerProps) {
  const searchParams = useSearchParams();
  const routedOrderId = searchParams.get("detail") || order?.id || "";
  const [mounted, setMounted] = useState(false);
  const [detail, setDetail] = useState<OrderDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !routedOrderId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    void fetch(`/api/backend/orders/${encodeURIComponent(routedOrderId)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { data?: OrderDetailDto };
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được chi tiết đơn hàng."));
      if (!payload.data || payload.data.id !== routedOrderId) throw new Error("Dữ liệu đơn hàng không hợp lệ.");
      setDetail(payload.data);
    }).catch((caught) => {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Không tải được chi tiết đơn hàng.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [open, reloadKey, routedOrderId]);

  useEffect(() => {
    if (!mounted || !open) return;

    const body = document.body;
    const html = document.documentElement;
    const scrollRegion = document.querySelector<HTMLElement>("[data-app-scroll-region='true']");
    const scrollTop = scrollRegion?.scrollTop ?? 0;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      regionOverflow: scrollRegion?.style.overflow ?? "",
      regionOverscroll: scrollRegion?.style.overscrollBehavior ?? ""
    };

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "contain";
    if (scrollRegion) {
      scrollRegion.style.overflow = "hidden";
      scrollRegion.style.overscrollBehavior = "contain";
    }

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      if (scrollRegion) {
        scrollRegion.style.overflow = previous.regionOverflow;
        scrollRegion.style.overscrollBehavior = previous.regionOverscroll;
        scrollRegion.scrollTop = scrollTop;
      }
    };
  }, [mounted, open]);

  if (!mounted || !open) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onCloseRef.current();
  }

  const displayOrder = detail || order;
  const showInitialLoading = Boolean(routedOrderId && !detail && !error);

  return createPortal(
    <div className={styles.backdrop} role="presentation" onClick={handleBackdropClick} data-order-detail-surface="backdrop">
      <aside
        ref={panelRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-order-detail-surface="drawer"
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span>Chi tiết đơn hàng</span>
            <h2 id={titleId}>{displayOrder?.code || "Đang tải đơn hàng"}</h2>
            <p id={descriptionId}>{displayOrder ? `${displayOrder.accountName} · ${displayOrder.date}` : "Thông tin đơn hàng"}</p>
          </div>
          <div className={styles.headerActions}>
            {displayOrder ? <strong className={statusClass(displayOrder.status)}>{statusLabel(displayOrder.status)}</strong> : null}
            <button ref={closeButtonRef} className={styles.closeButton} type="button" aria-label="Đóng chi tiết đơn" onClick={() => onCloseRef.current()}>×</button>
          </div>
        </header>

        <div className={styles.body}>
          {showInitialLoading || loading ? (
            <section className={styles.loadingCard} aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <strong>Đang tải chi tiết đơn hàng</strong>
            </section>
          ) : error ? (
            <section className={styles.errorCard} role="alert">
              <strong>{error}</strong>
              <span>Kiểm tra kết nối rồi tải lại.</span>
              <button className="button primary" type="button" onClick={() => setReloadKey((value) => value + 1)}>Tải lại</button>
            </section>
          ) : detail ? (
            <>
              <section className={styles.totalCard} aria-label="Tổng tiền đơn hàng">
                <span>Tổng cộng</span>
                <strong>{money.format(detail.totalAmount)}</strong>
                <small>{detail.items.length} dòng hàng · {quantity.format(detail.quantity)} sản phẩm</small>
              </section>

              {possibleDuplicate ? (
                <section className={styles.warning} aria-label="Cảnh báo đơn nghi trùng">
                  <strong>Đơn này có thể bị nhập trùng</strong>
                  <span>Hãy đối chiếu với đơn cùng khách và cùng ngày trước khi xử lý tiếp.</span>
                </section>
              ) : null}

              <section className={styles.section}>
                <header>
                  <h3>Sản phẩm</h3>
                  <small>{detail.items.length} dòng</small>
                </header>
                {detail.items.length ? (
                  <div className={styles.itemList}>
                    {detail.items.map((item) => (
                      <article className={styles.itemRow} key={item.id}>
                        <div className={styles.itemMain}>
                          <strong>{item.productName}</strong>
                          {itemDescription(item) ? <span>{itemDescription(item)}</span> : null}
                        </div>
                        <div className={styles.itemPrice}>
                          <span>{quantity.format(item.quantity)}{item.unit ? ` ${item.unit}` : ""} × {money.format(item.unitPrice)}</span>
                          {item.discount > 0 ? <small>Giảm {money.format(item.discount)}</small> : null}
                          <strong>{money.format(item.lineTotal)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <p className={styles.emptyItems}>Đơn này chưa có sản phẩm.</p>}
                <dl className={styles.totalBreakdown}>
                  <div><dt>Tạm tính</dt><dd>{money.format(detail.subtotal)}</dd></div>
                  {detail.discountTotal > 0 ? <div><dt>Giảm giá</dt><dd>-{money.format(detail.discountTotal)}</dd></div> : null}
                  <div className={styles.grandTotal}><dt>Tổng cộng</dt><dd>{money.format(detail.totalAmount)}</dd></div>
                </dl>
              </section>

              <section className={styles.section}>
                <header><h3>Khách hàng và giao hàng</h3></header>
                <dl className={styles.detailGrid}>
                  <div><dt>Khách hàng</dt><dd>{detail.accountName}</dd></div>
                  <div><dt>Số điện thoại</dt><dd>{detail.customerPhone || "Chưa có"}</dd></div>
                  <div><dt>Tuyến / khu vực</dt><dd>{detail.routeName || detail.area || "Chưa có"}</dd></div>
                  <div><dt>Địa chỉ giao hàng</dt><dd>{detail.deliveryAddress || "Chưa có"}</dd></div>
                </dl>
              </section>

              <section className={styles.section}>
                <header><h3>Thông tin đơn</h3></header>
                <dl className={styles.detailGrid}>
                  <div><dt>Ngày đơn</dt><dd>{detail.date}</dd></div>
                  <div><dt>Nhân viên</dt><dd>{detail.owner || "Chưa có"}</dd></div>
                  <div><dt>Nguồn đơn</dt><dd>{sourceLabel(detail.source)}</dd></div>
                  <div><dt>Trạng thái</dt><dd>{statusLabel(detail.status)}</dd></div>
                  {detail.note ? <div className={styles.fullRow}><dt>Ghi chú</dt><dd>{detail.note}</dd></div> : null}
                </dl>
              </section>
            </>
          ) : (
            <section className={styles.errorCard}>
              <strong>Không tìm thấy đơn hàng này.</strong>
              <span>Đóng cửa sổ và chọn lại đơn từ danh sách.</span>
            </section>
          )}
        </div>

        <footer className={styles.footer}>
          {displayOrder ? <a className="button primary" href={pdfHref(displayOrder.id)} target="_blank" rel="noreferrer">PDF A5</a> : null}
          {displayOrder ? <a className="button" href={xlsxHref(displayOrder.id)}>XLSX</a> : null}
          <button className="button" type="button" onClick={() => onCloseRef.current()}>Đóng</button>
        </footer>
      </aside>
    </div>,
    document.body
  );
}
