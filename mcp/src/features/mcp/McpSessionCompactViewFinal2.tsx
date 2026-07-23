"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/ui/shell/AppShell";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import type { McpDayData, McpDayLine } from "@/features/mcp-day/mcp-day.types";
import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { RoutesData } from "@/features/routes/routes.types";
import { McpLineCard } from "./McpLineCard";
import { mcpCustomerActionDescription, type McpCustomerAction } from "./mcp-customer-actions";
import { McpMarketReportFields, buildMarketReportContent, emptyMarketReportDraft, marketReportHasInput, type MarketReportDraft } from "./McpMarketReportFields";
import popupStyles from "./McpSessionPopupCompact.module.css";

type SessionTab = "all" | "pending" | "visited" | "skipped" | "added" | "followups";
type ProductCatalogItem = { productId: string; variantId: string; name: string; brand?: string | null; category?: string | null; rawCategory?: string | null; sku?: string | null; variantName?: string | null; sizeLabel?: string | null; sellUnit?: string | null; packUnit?: string | null; packQuantity?: number | null; price?: number | null };
type ProductSearchState = { q: string; category: string; loading: boolean; variantsLoading: boolean; results: ProductCatalogItem[]; variants: ProductCatalogItem[]; selectedProductId: string; error: string | null };
type PickerEntry = { variant: ProductCatalogItem; quantity: number };
type PickerMap = Record<string, PickerEntry>;
type OrderDraftItem = ProductCatalogItem & { quantity: number; unit: string; unitPrice: number; lineTotal: number };
type ActionDraft = { productName: string; note: string; skipReason: string; dueDate: string; priority: string; owner: string; testStatus: string; followupType: string };

const DEFAULT_FILTERS = ["Trà", "Sữa", "Siro", "Bột", "Topping", "Đường & ngọt", "Sinh tố", "Trái cây / mứt", "Kem / Milk foam", "Phụ gia", "Bao bì", "Mì cay", "Đông lạnh", "Bánh tráng"];
const TEST_NOTE_CHIPS = ["Khách muốn thử", "Gửi mẫu", "Test vị mới", "Đạt", "Chưa đạt", "Báo giá sau khi thử"];
const TEST_STATUS_OPTIONS = [{ value: "tested", label: "Đã thử" }, { value: "ok", label: "Đạt" }, { value: "interested", label: "Quan tâm" }, { value: "sample", label: "Đã gửi mẫu" }, { value: "follow", label: "Cần theo dõi" }, { value: "retry", label: "Thử lại" }, { value: "bad", label: "Chưa đạt" }];
const FOLLOWUP_CHIPS = ["Gửi báo giá", "Gọi lại", "Mang mẫu thử", "Chốt đơn sau", "Kiểm tra tồn", "Nhắc công nợ"];
const SKIP_REASONS = [
  { value: "closed", label: "Đóng cửa" },
  { value: "busy", label: "Khách bận" },
  { value: "no_demand", label: "Không nhu cầu" },
  { value: "price", label: "Chê giá" },
  { value: "competitor", label: "Đang dùng đối thủ" },
  { value: "stock_enough", label: "Còn tồn hàng" },
  { value: "other", label: "Khác" }
];

function emptyDraft(owner = ""): ActionDraft {
  return { productName: "", note: "", skipReason: "", dueDate: "", priority: "medium", owner, testStatus: "tested", followupType: "general" };
}

function emptyProductSearchState(): ProductSearchState {
  return { q: "", category: "", loading: false, variantsLoading: false, results: [], variants: [], selectedProductId: "", error: null };
}

function sourceLabel(source: McpDayLine["source"]) {
  return source === "planned" ? "Tuyến gốc" : source === "added" ? "Phát sinh" : "Đồng bộ";
}

function statusLabel(status: McpDayLine["status"]) {
  return status === "pending" ? "Chờ ghé" : status === "visited" ? "Đã ghé" : status === "skipped" ? "Bỏ qua / không mua" : "Hủy";
}

function actionTitle(action: McpCustomerAction) {
  return action === "order" ? "Tạo đơn hàng" : action === "test" ? "Ghi kết quả thử sản phẩm" : action === "market_report" ? "Ghi quan sát thị trường" : action === "skip" ? "Bỏ qua / không mua" : "Tạo việc cần theo dõi";
}

function actionSaveLabel(action?: McpCustomerAction) {
  return action === "order" ? "Lưu đơn hàng" : action === "test" ? "Lưu kết quả thử" : action === "market_report" ? "Lưu quan sát" : action === "skip" ? "Lưu lý do bỏ qua" : action === "follow_up" ? "Lưu việc theo dõi" : "Lưu kết quả";
}

function toNumber(value: string | number | null | undefined, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value: number) {
  return `${Math.round(value || 0).toLocaleString("vi-VN")}đ`;
}

function variantLabel(item: ProductCatalogItem) {
  return [item.variantName, item.sizeLabel, item.packUnit && item.packQuantity ? `${item.packUnit} ${item.packQuantity}` : ""].filter(Boolean).join(" · ") || item.sku || item.variantId;
}

function normalizeCatalogItems(value: unknown): ProductCatalogItem[] {
  return Array.isArray(value)
    ? value
        .map((item) => item as Partial<ProductCatalogItem>)
        .filter((item) => item.productId && item.variantId && item.name)
        .map((item) => ({
          productId: String(item.productId),
          variantId: String(item.variantId),
          name: String(item.name),
          brand: item.brand ?? null,
          category: item.category ?? null,
          rawCategory: item.rawCategory ?? null,
          sku: item.sku ?? null,
          variantName: item.variantName ?? null,
          sizeLabel: item.sizeLabel ?? null,
          sellUnit: item.sellUnit ?? null,
          packUnit: item.packUnit ?? null,
          packQuantity: item.packQuantity ?? null,
          price: Number(item.price || 0)
        }))
    : [];
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string | { message?: string }; detail?: string; message?: string };
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message?.trim()) return value.error.message;
  return value.detail || value.message || fallback;
}

function appendToken(current: string, token: string) {
  const parts = current.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  return parts.includes(token) ? parts.filter((item) => item !== token).join(", ") : [...parts, token].join(", ");
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function mutationOperation(path: string) {
  if (path === "/api/backend/mcp-day/session-customer/order") return "session-customer.order.create";
  if (path === "/api/backend/mcp-day/session-customer/test") return "session-customer.test.create";
  if (path === "/api/backend/mcp-day/session-customer/report") return "session-customer.report.create";
  if (path === "/api/backend/mcp-day/session-customer/followup") return "session-customer.followup.create";
  if (path === "/api/backend/mcp-day/session-customer/status") return "session-customer.status.update";
  throw new Error(`unsupported_mutation_operation:${path}`);
}

async function postJson(path: string, body: unknown) {
  const response = await idempotentMutationFetch(path, { method: "POST", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }, { operation: mutationOperation(path) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không lưu được hành động MCP"));
  return payload;
}

async function searchProducts(q: string, category = "") {
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", "100");
  if (category) params.set("category", category);
  const response = await fetch(`/api/products/search?${params.toString()}`, { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tìm được sản phẩm"));
  return normalizeCatalogItems((payload as { data?: unknown }).data);
}

async function getVariants(productId: string) {
  const response = await fetch(`/api/products/${encodeURIComponent(productId)}/variants`, { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được quy cách sản phẩm"));
  return normalizeCatalogItems((payload as { data?: unknown }).data);
}

type CheckinNotice = { kind: "success" | "error"; message: string };

function currentSalesPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Thiết bị hoặc trình duyệt không hỗ trợ định vị."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  });
}

function geolocationMessage(error: unknown) {
  const geolocationError = error as Partial<GeolocationPositionError>;
  if (typeof geolocationError?.code === "number") {
    if (geolocationError.code === 1) return "Chưa được cấp quyền định vị. Hãy bật quyền vị trí rồi bấm check-in lại.";
    if (geolocationError.code === 2) return "Thiết bị chưa lấy được vị trí hiện tại. Hãy đứng nơi thoáng và thử lại.";
    if (geolocationError.code === 3) return "Lấy vị trí quá thời gian. Hãy thử lại tại điểm bán.";
  }
  return error instanceof Error ? error.message : "Không lấy được vị trí hiện tại.";
}

async function saveManualCheckin(line: McpDayLine, checkedIn: boolean, position?: GeolocationPosition) {
  const sessionCustomerId = line.sessionCustomerId || line.id;
  const response = await idempotentMutationFetch(
    "/api/backend/mcp-day/session-customer/checkin",
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(checkedIn ? {
        sessionCustomerId,
        checkedIn: true,
        geoLat: position?.coords.latitude,
        geoLng: position?.coords.longitude,
        geoAccuracy: position?.coords.accuracy,
        geoSource: "browser_manual"
      } : {
        sessionCustomerId,
        checkedIn: false
      })
    },
    { operation: "session-customer.checkin.set" }
  );
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; detail?: string };
  if (!response.ok) throw new Error(payload.error?.message || payload.detail || "Không lưu được check-in.");
  return payload;
}

function LineList({ lines, onOpen, onAction, onToggleCheckin, checkinBusyIds }: { lines: McpDayLine[]; onOpen: (line: McpDayLine) => void; onAction: (line: McpDayLine, action: McpCustomerAction) => void; onToggleCheckin: (line: McpDayLine) => void; checkinBusyIds: Set<string> }) {
  if (lines.length === 0) return <div className="empty-inline"><strong>Chưa có dữ liệu</strong><p className="page-subtitle">Tab này chưa có khách phù hợp.</p></div>;
  return <div className="mcp-line-list">{lines.map((line) => <McpLineCard key={line.id} line={line} onOpen={onOpen} onAction={onAction} onToggleCheckin={onToggleCheckin} checkinBusy={checkinBusyIds.has(line.sessionCustomerId || line.id)} />)}</div>;
}

function CustomerSheet({ line, onClose, onAction }: { line: McpDayLine | null; onClose: () => void; onAction: (line: McpDayLine, action: McpCustomerAction) => void }) {
  if (!line) return null;
  return (
    <BottomSheet variant="compact" open={Boolean(line)} onClose={onClose} title={line.accountName} description={`${line.area} · ${sourceLabel(line.source)}`} footer={<div className={popupStyles.customerFooter}><button className="button primary" type="button" onClick={() => onAction(line, "order")}>Tạo đơn</button><button className="button" type="button" onClick={() => onAction(line, "test")}>Thử sản phẩm</button><button className="button" type="button" onClick={() => onAction(line, "market_report")}>Quan sát</button><button className="button" type="button" onClick={() => onAction(line, "follow_up")}>Theo dõi</button><button className="button" type="button" onClick={() => onAction(line, "skip")}>Bỏ qua</button><button className="button" type="button" onClick={onClose}>Đóng</button></div>}>
      <div className={`visit-sheet-content ${popupStyles.content}`}><div className="visit-focus-card"><span>Trạng thái</span><strong>{statusLabel(line.status)}</strong><small>{line.note || "Chưa ghi kết quả chi tiết"}</small></div></div>
    </BottomSheet>
  );
}

function ProductPickerPanel({ productSearch, selected, saving, onSelectedChange, onSearchChange, onCategoryChange, onRunSearch, onPickProduct, onCommit, onClose }: { productSearch: ProductSearchState; selected: PickerMap; saving: boolean; onSelectedChange: (value: PickerMap) => void; onSearchChange: (value: string) => void; onCategoryChange: (category: string) => void; onRunSearch: () => void; onPickProduct: (productId: string) => void; onCommit: (entries: PickerEntry[]) => void; onClose: () => void }) {
  const products = useMemo(() => productSearch.results.filter((item, index, values) => values.findIndex((candidate) => candidate.productId === item.productId) === index), [productSearch.results]);
  const categories = useMemo(() => Array.from(new Set([...DEFAULT_FILTERS, ...productSearch.results.map((item) => item.category || "").filter(Boolean)])), [productSearch.results]);
  const selectedEntries = useMemo(() => Object.values(selected), [selected]);
  const selectedByProduct = useMemo(() => selectedEntries.reduce<Record<string, number>>((acc, entry) => { acc[entry.variant.productId] = (acc[entry.variant.productId] || 0) + 1; return acc; }, {}), [selectedEntries]);
  const variantsForProduct = (productId: string) => productSearch.results.filter((variant) => variant.productId === productId);
  const toggleVariant = (variant: ProductCatalogItem) => { const next = { ...selected }; if (next[variant.variantId]) delete next[variant.variantId]; else next[variant.variantId] = { variant, quantity: 1 }; onSelectedChange(next); };
  const adjustQty = (variant: ProductCatalogItem, delta: number) => { const existed = selected[variant.variantId] || { variant, quantity: 0 }; onSelectedChange({ ...selected, [variant.variantId]: { variant, quantity: Math.max(1, existed.quantity + delta) } }); };
  const removeSelected = (variantId: string) => { const next = { ...selected }; delete next[variantId]; onSelectedChange(next); };
  const handleProductClick = (item: ProductCatalogItem) => { const variants = variantsForProduct(item.productId); if (variants.length <= 1) toggleVariant(variants[0] || item); else onPickProduct(item.productId); };
  const renderVariant = (variant: ProductCatalogItem) => { const entry = selected[variant.variantId]; return <article className={entry ? "mcp-picker-variant selected" : "mcp-picker-variant"} key={variant.variantId}><button type="button" onClick={() => toggleVariant(variant)} disabled={saving}><b>{entry ? "☑" : "□"} {variantLabel(variant)}</b><small>{variant.sellUnit || "đv"} · {formatMoney(Number(variant.price || 0))}</small></button><div className="mcp-picker-qty"><button type="button" onClick={() => adjustQty(variant, -1)} disabled={saving}>−</button><span>{entry?.quantity || 1}</span><button type="button" onClick={() => adjustQty(variant, 1)} disabled={saving}>+</button></div></article>; };

  return (
    <div className="mcp-order-picker-panel" role="dialog" aria-modal="true" aria-label="Chọn sản phẩm">
      <div className="mcp-order-picker-head"><strong>Chọn sản phẩm</strong><button className="button" type="button" onClick={onClose}>Đóng</button></div>
      <div className="mcp-order-picker-tools"><div className="order-picker-head"><label className="form-field order-search-field"><small>Tìm tên / SKU</small><input value={productSearch.q} onChange={(event) => onSearchChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onRunSearch(); } }} placeholder="Tìm tên sản phẩm, vị, SKU" disabled={saving || productSearch.loading} /></label><button className="button primary order-search-button" type="button" onClick={onRunSearch} disabled={saving || productSearch.loading}>{productSearch.loading ? "Tải..." : "Lọc"}</button></div><div className="mcp-order-picker-filters"><button className={!productSearch.category ? "active" : ""} type="button" onClick={() => onCategoryChange("")} disabled={saving || productSearch.loading}>Tất cả</button>{categories.map((category) => <button className={productSearch.category === category ? "active" : ""} type="button" key={category} onClick={() => onCategoryChange(category)} disabled={saving || productSearch.loading}>{category}</button>)}</div></div>
      {productSearch.error ? <p className="page-subtitle order-message">{productSearch.error}</p> : null}
      <div className="mcp-order-picker-body inline-product-picker"><section className="mcp-picker-products"><div className="order-section-title"><strong>Loại sản phẩm / hãng</strong><span>{productSearch.loading ? "Đang tải..." : `${products.length} mục`}</span></div><div className="product-card-list compact">{products.length === 0 && !productSearch.loading ? <small className="page-subtitle">Không có sản phẩm phù hợp.</small> : null}{products.map((item) => { const variants = variantsForProduct(item.productId); const variantCount = variants.length; const pickedCount = selectedByProduct[item.productId] || 0; const expanded = productSearch.selectedProductId === item.productId && variantCount > 1; const className = [expanded ? "active" : "", pickedCount ? "selected" : ""].filter(Boolean).join(" "); return <div className="mcp-picker-product-row" key={item.productId}><button className={`product-card ${className}`} type="button" onClick={() => handleProductClick(item)} disabled={saving || productSearch.variantsLoading}><strong>{item.name}</strong><span>{item.brand || "Chưa brand"} · {item.category || "Chưa nhóm"}</span><small>{variantCount} quy cách · {item.sku}</small><em className="mcp-picker-product-badge">{pickedCount ? `Đã chọn ${pickedCount}` : variantCount <= 1 ? "+ Chọn" : expanded ? "Đang mở" : "Chọn vị"}</em></button>{expanded ? <div className="mcp-picker-inline-variants"><div className="order-section-title"><strong>Tick vị / quy cách</strong><span>{productSearch.variantsLoading ? "Đang tải..." : `${productSearch.variants.length}`}</span></div><div className="variant-grid compact">{productSearch.variants.map(renderVariant)}</div></div> : null}</div>; })}</div></section></div>
      <div className="mcp-picker-selected-strip">{selectedEntries.length === 0 ? <small>Chưa chọn mã nào</small> : selectedEntries.map((entry) => <span key={entry.variant.variantId}><b>{entry.quantity}×</b> {entry.variant.name} · {variantLabel(entry.variant)} <button type="button" onClick={() => removeSelected(entry.variant.variantId)} disabled={saving}>×</button></span>)}</div>
      <div className="mcp-order-picker-foot"><span>Đã chọn: <strong>{selectedEntries.length}</strong> mã</span><button className="button primary" type="button" onClick={() => onCommit(selectedEntries)} disabled={saving || selectedEntries.length === 0}>Thêm {selectedEntries.length} mã vào đơn</button></div>
    </div>
  );
}

function OrderFields({ draft, productSearch, orderItems, orderTotal, saving, onChange, onSearchChange, onCategoryChange, onRunSearch, onPickProduct, onCommitPickerItems, onRemoveItem, onChangeItemQuantity }: { draft: ActionDraft; productSearch: ProductSearchState; orderItems: OrderDraftItem[]; orderTotal: number; saving: boolean; onChange: (field: keyof ActionDraft, value: string) => void; onSearchChange: (value: string) => void; onCategoryChange: (category: string) => void; onRunSearch: () => void; onPickProduct: (productId: string) => void; onCommitPickerItems: (entries: PickerEntry[]) => void; onRemoveItem: (variantId: string) => void; onChangeItemQuantity: (variantId: string, quantity: number) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<PickerMap>({});
  return <div className="order-builder order-builder-report-style"><button className="button primary mcp-order-open-picker" type="button" onClick={() => setPickerOpen(true)} disabled={saving}>+ Chọn sản phẩm</button><div className="order-summary-list report-style">{orderItems.length === 0 ? <small className="page-subtitle">Chưa có item trong đơn. Bấm + Chọn sản phẩm để thêm nhiều mã một lần.</small> : null}{orderItems.map((item) => <div className="order-summary-row" key={item.variantId}><div><strong>{item.name}</strong><small>{variantLabel(item)} · {item.sku || item.variantId}</small></div><label><small>SL</small><input inputMode="decimal" value={item.quantity} onChange={(event) => onChangeItemQuantity(item.variantId, toNumber(event.target.value, item.quantity))} disabled={saving} /></label><span>{item.unit || item.sellUnit || "đv"} × {formatMoney(item.unitPrice)}</span><b>{formatMoney(item.lineTotal)}</b><button className="button" type="button" onClick={() => onRemoveItem(item.variantId)} disabled={saving}>Xóa</button></div>)}</div><label className="form-field order-note-field"><small>Ghi chú giao hàng</small><textarea value={draft.note} onChange={(event) => onChange("note", event.target.value)} placeholder="Giao hàng / công nợ / thời gian giao" /></label><div className="order-total-row"><span>Tổng</span><strong>{formatMoney(orderTotal)}</strong></div>{pickerOpen ? <ProductPickerPanel productSearch={productSearch} selected={pickerSelected} saving={saving} onSelectedChange={setPickerSelected} onSearchChange={onSearchChange} onCategoryChange={onCategoryChange} onRunSearch={onRunSearch} onPickProduct={onPickProduct} onCommit={(entries) => { onCommitPickerItems(entries); setPickerSelected({}); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} /> : null}</div>;
}

function QuickChip({ active, children, onClick, disabled }: { active?: boolean; children: string; onClick: () => void; disabled?: boolean }) {
  return <button className={active ? "report-chip selected" : "report-chip"} type="button" onClick={onClick} disabled={disabled}>{children}</button>;
}

function TestFields({ draft, saving, onChange }: { draft: ActionDraft; saving: boolean; onChange: (field: keyof ActionDraft, value: string) => void }) {
  return <div className="report-popup-grid"><section className="report-quick-panel"><div className="report-section-head"><strong>Kết quả thử sản phẩm</strong><small>Chọn sản phẩm, kết quả thử và ghi chú thực tế.</small></div><label className="form-field report-field"><small>Sản phẩm được thử</small><input value={draft.productName} onChange={(event) => onChange("productName", event.target.value)} disabled={saving} placeholder="Nhập tên sản phẩm" /></label><div className="report-quick-group"><strong>Kết quả</strong><div className="report-chip-grid">{TEST_STATUS_OPTIONS.map((item) => <QuickChip key={item.value} active={draft.testStatus === item.value} disabled={saving} onClick={() => onChange("testStatus", item.value)}>{item.label}</QuickChip>)}</div></div><div className="report-quick-group"><strong>Ghi chú nhanh</strong><div className="report-chip-grid">{TEST_NOTE_CHIPS.map((label) => <QuickChip key={label} active={draft.note.includes(label)} disabled={saving} onClick={() => onChange("note", appendToken(draft.note, label))}>{label}</QuickChip>)}</div></div><label className="form-field report-field"><small>Ghi chú</small><textarea value={draft.note} onChange={(event) => onChange("note", event.target.value)} disabled={saving} /></label></section></div>;
}

function FollowUpFields({ draft, saving, onChange }: { draft: ActionDraft; saving: boolean; onChange: (field: keyof ActionDraft, value: string) => void }) {
  return <div className="report-popup-grid"><section className="report-quick-panel"><div className="report-section-head"><strong>Theo dõi</strong><small>Lưu đủ việc, ngày hẹn, người phụ trách, ưu tiên và loại công việc.</small></div><div className="report-quick-group"><strong>Việc cần làm</strong><div className="report-chip-grid">{FOLLOWUP_CHIPS.map((label) => <QuickChip key={label} active={draft.productName === label} disabled={saving} onClick={() => onChange("productName", draft.productName === label ? "" : label)}>{label}</QuickChip>)}</div></div><label className="form-field report-field"><small>Tiêu đề</small><input value={draft.productName} onChange={(event) => onChange("productName", event.target.value)} disabled={saving} placeholder="Nhập nội dung cần theo dõi" /></label><div className="report-quick-group"><strong>Ngày hẹn nhanh</strong><div className="report-chip-grid"><QuickChip active={draft.dueDate === addDays(1)} disabled={saving} onClick={() => onChange("dueDate", addDays(1))}>Mai</QuickChip><QuickChip active={draft.dueDate === addDays(3)} disabled={saving} onClick={() => onChange("dueDate", addDays(3))}>3 ngày</QuickChip><QuickChip active={draft.dueDate === addDays(7)} disabled={saving} onClick={() => onChange("dueDate", addDays(7))}>Tuần sau</QuickChip></div></div><label className="form-field report-field"><small>Ngày hẹn</small><input type="date" value={draft.dueDate} onChange={(event) => onChange("dueDate", event.target.value)} disabled={saving} /></label><label className="form-field report-field"><small>Người phụ trách</small><input value={draft.owner} onChange={(event) => onChange("owner", event.target.value)} disabled={saving} placeholder="Nhân viên phụ trách" /></label><label className="form-field report-field"><small>Ưu tiên</small><select value={draft.priority} onChange={(event) => onChange("priority", event.target.value)} disabled={saving}><option value="low">Thấp</option><option value="medium">Trung bình</option><option value="high">Cao</option><option value="urgent">Khẩn</option></select></label><label className="form-field report-field"><small>Loại công việc</small><select value={draft.followupType} onChange={(event) => onChange("followupType", event.target.value)} disabled={saving}><option value="general">Chung</option><option value="order">Đơn hàng</option><option value="test">Sau khi thử sản phẩm</option><option value="report">Báo cáo</option><option value="debt">Công nợ</option><option value="delivery">Giao hàng</option></select></label><label className="form-field report-field"><small>Ghi chú</small><textarea value={draft.note} onChange={(event) => onChange("note", event.target.value)} disabled={saving} /></label></section></div>;
}

function SkipFields({ draft, saving, onChange }: { draft: ActionDraft; saving: boolean; onChange: (field: keyof ActionDraft, value: string) => void }) {
  return <div className="report-popup-grid"><section className="report-quick-panel"><div className="report-section-head"><strong>Lý do bỏ qua</strong><small>Tick lý do chính, ghi chú thêm khi cần.</small></div><div className="report-chip-grid">{SKIP_REASONS.map((item) => <QuickChip key={item.value} active={draft.skipReason === item.value} disabled={saving} onClick={() => onChange("skipReason", draft.skipReason === item.value ? "" : item.value)}>{item.label}</QuickChip>)}</div><label className="form-field report-field"><small>Ghi chú</small><textarea value={draft.note} onChange={(event) => onChange("note", event.target.value)} disabled={saving} placeholder="VD: khách còn tồn nhiều, hẹn tuần sau quay lại" /></label></section></div>;
}

function ActionFields({ action, draft, marketReport, productSearch, orderItems, orderTotal, saving, onChange, onMarketReportChange, onSearchChange, onCategoryChange, onRunSearch, onPickProduct, onCommitPickerItems, onRemoveOrderItem, onChangeItemQuantity }: { action: McpCustomerAction; draft: ActionDraft; marketReport: MarketReportDraft; productSearch: ProductSearchState; orderItems: OrderDraftItem[]; orderTotal: number; saving: boolean; onChange: (field: keyof ActionDraft, value: string) => void; onMarketReportChange: (value: MarketReportDraft) => void; onSearchChange: (value: string) => void; onCategoryChange: (category: string) => void; onRunSearch: () => void; onPickProduct: (productId: string) => void; onCommitPickerItems: (entries: PickerEntry[]) => void; onRemoveOrderItem: (variantId: string) => void; onChangeItemQuantity: (variantId: string, quantity: number) => void }) {
  if (action === "order") return <OrderFields draft={draft} productSearch={productSearch} orderItems={orderItems} orderTotal={orderTotal} saving={saving} onChange={onChange} onSearchChange={onSearchChange} onCategoryChange={onCategoryChange} onRunSearch={onRunSearch} onPickProduct={onPickProduct} onCommitPickerItems={onCommitPickerItems} onRemoveItem={onRemoveOrderItem} onChangeItemQuantity={onChangeItemQuantity} />;
  if (action === "market_report") return <McpMarketReportFields value={marketReport} onChange={onMarketReportChange} saving={saving} />;
  if (action === "test") return <TestFields draft={draft} saving={saving} onChange={onChange} />;
  if (action === "follow_up") return <FollowUpFields draft={draft} saving={saving} onChange={onChange} />;
  if (action === "skip") return <SkipFields draft={draft} saving={saving} onChange={onChange} />;
  return null;
}

function CustomerActionSheet({ selection, draft, marketReport, productSearch, orderItems, orderTotal, saving, message, onChange, onMarketReportChange, onSearchChange, onCategoryChange, onRunSearch, onPickProduct, onCommitPickerItems, onRemoveOrderItem, onChangeItemQuantity, onClose, onSubmit }: { selection: { line: McpDayLine; action: McpCustomerAction } | null; draft: ActionDraft; marketReport: MarketReportDraft; productSearch: ProductSearchState; orderItems: OrderDraftItem[]; orderTotal: number; saving: boolean; message: string | null; onChange: (field: keyof ActionDraft, value: string) => void; onMarketReportChange: (value: MarketReportDraft) => void; onSearchChange: (value: string) => void; onCategoryChange: (category: string) => void; onRunSearch: () => void; onPickProduct: (productId: string) => void; onCommitPickerItems: (entries: PickerEntry[]) => void; onRemoveOrderItem: (variantId: string) => void; onChangeItemQuantity: (variantId: string, quantity: number) => void; onClose: () => void; onSubmit: () => void }) {
  const isOrder = selection?.action === "order";
  return <BottomSheet variant={isOrder ? "default" : "compact"} open={Boolean(selection)} onClose={onClose} title={selection ? actionTitle(selection.action) : "Thao tác tại điểm bán"} description={selection ? selection.line.accountName : undefined} footer={<div className={isOrder ? "sheet-action-grid order-sheet-footer" : popupStyles.footer}>{isOrder ? <div className="order-footer-total">Tổng: <strong>{formatMoney(orderTotal)}</strong></div> : null}<button className="button primary" type="button" onClick={onSubmit} disabled={saving}>{saving ? "Đang lưu..." : actionSaveLabel(selection?.action)}</button><button className="button" type="button" onClick={onClose} disabled={saving}>Đóng</button></div>}>{selection ? <div className={isOrder ? "visit-sheet-content order-action-content" : `visit-sheet-content ${popupStyles.content}`}><div className="visit-focus-card"><span>Khách</span><strong>{selection.line.accountName}</strong><small>{mcpCustomerActionDescription(selection.action)}</small></div><ActionFields action={selection.action} draft={draft} marketReport={marketReport} productSearch={productSearch} orderItems={orderItems} orderTotal={orderTotal} saving={saving} onChange={onChange} onMarketReportChange={onMarketReportChange} onSearchChange={onSearchChange} onCategoryChange={onCategoryChange} onRunSearch={onRunSearch} onPickProduct={onPickProduct} onCommitPickerItems={onCommitPickerItems} onRemoveOrderItem={onRemoveOrderItem} onChangeItemQuantity={onChangeItemQuantity} />{message ? <p className="page-subtitle order-message">{message}</p> : null}</div> : null}</BottomSheet>;
}

export function McpSessionCompactView({ activeHref = "/visits", mcpDayData }: { activeHref?: string; routesData: RoutesData; mcpDayData: McpDayData; routeCustomersData: RouteCustomersData }) {
  const [tab, setTab] = useState<SessionTab>("all");
  const [selectedLine, setSelectedLine] = useState<McpDayLine | null>(null);
  const [selectedAction, setSelectedAction] = useState<{ line: McpDayLine; action: McpCustomerAction } | null>(null);
  const [draft, setDraft] = useState<ActionDraft>(emptyDraft());
  const [marketReport, setMarketReport] = useState<MarketReportDraft>(emptyMarketReportDraft());
  const [productSearch, setProductSearch] = useState<ProductSearchState>(emptyProductSearchState());
  const [orderItems, setOrderItems] = useState<OrderDraftItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [checkinBusyIds, setCheckinBusyIds] = useState<Set<string>>(new Set());
  const [checkinNotice, setCheckinNotice] = useState<CheckinNotice | null>(null);
  const [saving, startSaving] = useTransition();
  const router = useRouter();
  const run = mcpDayData.run;
  const allLines = mcpDayData.lines;
  const pendingLines = allLines.filter((line) => line.status === "pending");
  const visitedLines = allLines.filter((line) => line.status === "visited");
  const skippedLines = allLines.filter((line) => line.status === "skipped");
  const addedLines = allLines.filter((line) => line.source === "added");
  const followupLines = allLines.filter((line) => Number(line.followupCount || 0) > 0);
  const counters = { all: allLines.length, pending: pendingLines.length, visited: visitedLines.length, skipped: skippedLines.length, added: addedLines.length, followups: followupLines.length };
  const linesByTab: Record<SessionTab, McpDayLine[]> = { all: allLines, pending: pendingLines, visited: visitedLines, skipped: skippedLines, added: addedLines, followups: followupLines };
  const orderTotal = orderItems.reduce((total, item) => total + item.lineTotal, 0);

  function updateDraft(field: keyof ActionDraft, value: string) { setDraft((current) => ({ ...current, [field]: value })); }
  async function loadProducts(q: string, category: string) { setMessage(null); setProductSearch((current) => ({ ...current, q, category, loading: true, error: null, results: [], variants: [], selectedProductId: "" })); try { const results = await searchProducts(q.trim(), category); setProductSearch((current) => ({ ...current, q, category, loading: false, results, error: null })); } catch (error) { setProductSearch((current) => ({ ...current, q, category, loading: false, error: error instanceof Error ? error.message : "Không tìm được sản phẩm" })); } }
  async function runProductSearch() { await loadProducts(productSearch.q, productSearch.category); }
  function changeProductCategory(category: string) { void loadProducts(productSearch.q, category); }
  async function pickProduct(productId: string) { const fallbackVariants = productSearch.results.filter((item) => item.productId === productId); setMessage(null); setProductSearch((current) => ({ ...current, selectedProductId: productId, variants: fallbackVariants, variantsLoading: true, error: null })); try { const variants = await getVariants(productId); setProductSearch((current) => ({ ...current, variantsLoading: false, variants: variants.length ? variants : fallbackVariants })); } catch (error) { setProductSearch((current) => ({ ...current, variantsLoading: false, error: error instanceof Error ? error.message : "Không tải được quy cách sản phẩm" })); } }
  function commitPickerItems(entries: PickerEntry[]) { if (entries.length === 0) return; setOrderItems((current) => { const next = [...current]; entries.forEach(({ variant, quantity }) => { const unitPrice = Number(variant.price || 0); const existed = next.find((item) => item.variantId === variant.variantId && item.unitPrice === unitPrice); if (existed) { existed.quantity += quantity; existed.lineTotal = existed.quantity * existed.unitPrice; } else next.push({ ...variant, quantity, unit: variant.sellUnit || "", unitPrice, lineTotal: quantity * unitPrice }); }); return next; }); setMessage(`Đã thêm ${entries.length} mã vào đơn`); }
  function removeOrderItem(variantId: string) { setOrderItems((current) => current.filter((item) => item.variantId !== variantId)); }
  function changeItemQuantity(variantId: string, quantity: number) { const nextQuantity = Math.max(1, quantity || 1); setOrderItems((current) => current.map((item) => item.variantId === variantId ? { ...item, quantity: nextQuantity, lineTotal: nextQuantity * item.unitPrice } : item)); }
  function openCustomerAction(line: McpDayLine, action: McpCustomerAction) { setMessage(null); setSelectedLine(null); setDraft(emptyDraft(run.owner || "")); setMarketReport(emptyMarketReportDraft()); setProductSearch(emptyProductSearchState()); setOrderItems([]); setSelectedAction({ line, action }); if (action === "order") void loadProducts("", ""); }

  async function toggleCustomerCheckin(line: McpDayLine) {
    const sessionCustomerId = line.sessionCustomerId || line.id;
    if (checkinBusyIds.has(sessionCustomerId)) return;
    setCheckinNotice(null);
    setCheckinBusyIds((current) => new Set(current).add(sessionCustomerId));
    try {
      if (line.checkedIn) {
        await saveManualCheckin(line, false);
        setCheckinNotice({ kind: "success", message: `Đã bỏ check-in của ${line.accountName}.` });
      } else {
        const position = await currentSalesPosition();
        await saveManualCheckin(line, true, position);
        setCheckinNotice({ kind: "success", message: `Đã check-in vị trí hiện tại tại ${line.accountName} · sai số khoảng ${Math.round(position.coords.accuracy)}m.` });
      }
      router.refresh();
    } catch (error) {
      setCheckinNotice({ kind: "error", message: geolocationMessage(error) });
    } finally {
      setCheckinBusyIds((current) => { const next = new Set(current); next.delete(sessionCustomerId); return next; });
    }
  }

  function submitAction() {
    if (!selectedAction) return;
    const sessionCustomerId = selectedAction.line.sessionCustomerId || selectedAction.line.id;
    startSaving(() => {
      void (async () => {
        try {
          setMessage(null);
          if (selectedAction.action === "order") {
            if (orderItems.length === 0) throw new Error("Cần thêm ít nhất 1 sản phẩm vào đơn");
            await postJson("/api/backend/mcp-day/session-customer/order", { sessionCustomerId, items: orderItems.map((item) => ({ productId: item.productId, variantId: item.variantId, productName: item.name, sku: item.sku, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, note: variantLabel(item) })), note: draft.note, status: "confirmed" });
          } else if (selectedAction.action === "test") {
            if (!draft.productName.trim()) throw new Error("Cần chọn hoặc nhập sản phẩm test");
            await postJson("/api/backend/mcp-day/session-customer/test", { sessionCustomerId, fileTitle: "Kết quả thử sản phẩm trong phiên", results: [{ productName: draft.productName, status: draft.testStatus || "tested", note: draft.note }], note: draft.note, customerStatus: "tested" });
          } else if (selectedAction.action === "market_report") {
            if (!marketReportHasInput(marketReport)) throw new Error("Cần tick hoặc nhập ít nhất 1 nội dung quan sát");
            await postJson("/api/backend/mcp-day/session-customer/report", { sessionCustomerId, reportType: "market_report", content: buildMarketReportContent(marketReport), fields: marketReport.fields, selected: { competitors: marketReport.selectedCompetitors, usedProducts: marketReport.selectedUsedProducts, settingItems: marketReport.selectedSettingItems }, context: { routeId: run.routeId || null, routeName: run.routeName, sessionDate: run.date, sales: run.owner, customerName: selectedAction.line.accountName, area: selectedAction.line.area, routeCustomerId: selectedAction.line.routeCustomerId || null } });
          } else if (selectedAction.action === "follow_up") {
            await postJson("/api/backend/mcp-day/session-customer/followup", { sessionCustomerId, title: draft.productName || "Theo dõi khách", dueDate: draft.dueDate || undefined, priority: draft.priority, owner: draft.owner, note: draft.note, followupType: draft.followupType || "general" });
          } else if (selectedAction.action === "skip") {
            await postJson("/api/backend/mcp-day/session-customer/status", { sessionCustomerId, visitStatus: "skipped", statusReason: draft.skipReason || "other", note: draft.note || draft.skipReason });
          }
          setSelectedAction(null);
          setSelectedLine(null);
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Không lưu được hành động MCP");
        }
      })();
    });
  }

  return <AppShell activeHref={activeHref}><PageHeader eyebrow="Phiên đi tuyến" title="Phiên đi tuyến" subtitle={`Tuyến: ${run.routeName} · Ngày: ${run.date} · Phụ trách: ${run.owner}`} /><section className="mcp-gate-banner mcp-session-compact-head"><strong>{counters.pending} chờ ghé</strong><span>{counters.visited} đã ghé · {counters.skipped} bỏ qua · {counters.added} phát sinh · {counters.followups} việc theo dõi · mở lúc {run.openedAt}</span></section><div className="mcp-status-chips" role="tablist" aria-label="Phiên đi tuyến"><button className={tab === "all" ? "active" : ""} type="button" onClick={() => setTab("all")}>Tất cả điểm bán <b>{counters.all}</b></button><button className={tab === "pending" ? "active" : ""} type="button" onClick={() => setTab("pending")}>Chờ ghé <b>{counters.pending}</b></button><button className={tab === "visited" ? "active" : ""} type="button" onClick={() => setTab("visited")}>Đã ghé <b>{counters.visited}</b></button><button className={tab === "skipped" ? "active" : ""} type="button" onClick={() => setTab("skipped")}>Bỏ qua <b>{counters.skipped}</b></button><button className={tab === "added" ? "active" : ""} type="button" onClick={() => setTab("added")}>Phát sinh <b>{counters.added}</b></button><button className={tab === "followups" ? "active" : ""} type="button" onClick={() => setTab("followups")}>Có việc theo dõi <b>{counters.followups}</b></button></div>{checkinNotice ? <p className={`${popupStyles.notice} ${checkinNotice.kind === "error" ? popupStyles.noticeError : ""}`}>{checkinNotice.message}</p> : null}<LineList lines={linesByTab[tab]} onOpen={setSelectedLine} onAction={openCustomerAction} onToggleCheckin={toggleCustomerCheckin} checkinBusyIds={checkinBusyIds} /><CustomerSheet line={selectedLine} onClose={() => setSelectedLine(null)} onAction={openCustomerAction} /><CustomerActionSheet selection={selectedAction} draft={draft} marketReport={marketReport} productSearch={productSearch} orderItems={orderItems} orderTotal={orderTotal} saving={saving} message={message} onChange={updateDraft} onMarketReportChange={setMarketReport} onSearchChange={(value) => setProductSearch((current) => ({ ...current, q: value }))} onCategoryChange={changeProductCategory} onRunSearch={runProductSearch} onPickProduct={pickProduct} onCommitPickerItems={commitPickerItems} onRemoveOrderItem={removeOrderItem} onChangeItemQuantity={changeItemQuantity} onClose={() => { if (!saving) setSelectedAction(null); }} onSubmit={submitAction} /></AppShell>;
}

