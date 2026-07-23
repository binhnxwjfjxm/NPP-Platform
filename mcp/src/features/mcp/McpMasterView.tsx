"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildGoogleMapsUrl } from "@/features/mcp/route-customers.types";
import type { RouteCustomersData, RouteCustomerItem, RouteCustomerStatus } from "@/features/mcp/route-customers.types";
import type { RoutesData, RouteItem, RouteStatus } from "@/features/routes/routes.types";
import { createIdempotencyKey, idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { userFacingError } from "@/lib/ui/user-facing-error";
import { OperationalListCard } from "@/ui/cards/OperationalListCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import { OutletPhotoManager } from "./OutletPhotoManager";
import { RouteCustomerMediaPreview } from "./RouteCustomerMediaPreview";

type MasterTab = "routes" | "customers" | "gps" | "open";
type RouteEditorMode = "create" | "edit" | "delete";
type CustomerEditorMode = "create" | "edit" | "delete";
type RouteDraft = { routeName: string; area: string; weekday: string; note: string; active: boolean };
type CustomerDraft = { customerName: string; phone: string; area: string; address: string; sortOrder: string; note: string; active: boolean; geoLat: string; geoLng: string; geoAccuracy: string };
type ActiveSessionRow = { id?: string; routeId?: string; routeName?: string; sessionDate?: string; status?: string };
type ActiveSessionPrompt = { id: string; routeName: string; sessionDate: string };
type CustomerIntentChoice = { includeActiveSession: boolean; activeSessionId?: string };
type RouteCustomerAddResult = {
  routeCustomerId?: string;
  sessionCustomerId?: string | null;
  includedActiveSession?: boolean;
  createdRouteCustomer?: boolean;
  createdSessionCustomer?: boolean;
  reusedRouteCustomer?: boolean;
  reusedSessionCustomer?: boolean;
};

function todayDateOnly() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyRouteDraft(): RouteDraft {
  return { routeName: "", area: "", weekday: "", note: "", active: true };
}

function emptyCustomerDraft(route?: RouteItem | null): CustomerDraft {
  return { customerName: "", phone: "", area: route?.area === "-" ? "" : route?.area || "", address: "", sortOrder: "0", note: "", active: true, geoLat: "", geoLng: "", geoAccuracy: "" };
}

function routeToDraft(route: RouteItem): RouteDraft {
  return { routeName: route.name, area: route.area === "-" ? "" : route.area, weekday: "", note: "", active: route.status !== "paused" };
}

function customerToDraft(customer: RouteCustomerItem): CustomerDraft {
  return { customerName: customer.accountName, phone: customer.contactName === "Chưa có SĐT" ? "" : customer.contactName, area: customer.area === "-" ? "" : customer.area, address: "", sortOrder: String(customer.sortOrder || 0), note: customer.note || "", active: customer.status !== "hidden", geoLat: customer.gps ? String(customer.gps.lat) : "", geoLng: customer.gps ? String(customer.gps.lng) : "", geoAccuracy: customer.gps?.accuracyMeters ? String(customer.gps.accuracyMeters) : "" };
}

function routeStatusLabel(status: RouteStatus) {
  if (status === "active") return "Đang chạy";
  if (status === "watch") return "Theo dõi";
  return "Tạm dừng";
}

function routeStatusClass(status: RouteStatus) {
  if (status === "active") return "dashboard-status status-good";
  if (status === "watch") return "dashboard-status status-watch";
  return "dashboard-status status-risk";
}

function routeCustomerStatusLabel(status: RouteCustomerStatus) {
  if (status === "active") return "Đang trong tuyến";
  if (status === "needs_gps") return "Cần định vị";
  return "Đang ẩn";
}

function routeCustomerStatusClass(status: RouteCustomerStatus) {
  if (status === "active") return "dashboard-status status-good";
  if (status === "needs_gps") return "dashboard-status status-watch";
  return "dashboard-status status-risk";
}

function routeCompletion(route: RouteItem) {
  if (route.plannedCustomers === 0) return "-";
  return `${Math.round((route.visitedCustomers / route.plannedCustomers) * 100)}%`;
}

function gpsLabel(customer: RouteCustomerItem) {
  if (!customer.gps) return "Chưa có GPS";
  return `${customer.gps.lat.toFixed(5)}, ${customer.gps.lng.toFixed(5)}`;
}

function apiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string | { message?: string }; message?: string };
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message) return value.error.message;
  return value.message || fallback;
}

function EmptyPanel({ title, hint }: { title: string; hint: string }) {
  return <div className="empty-inline"><strong>{title}</strong><p className="page-subtitle">{hint}</p></div>;
}

function CustomerSheet({ customer, onClose }: { customer: RouteCustomerItem | null; onClose: () => void }) {
  const mapsUrl = customer ? buildGoogleMapsUrl(customer) : undefined;
  return <BottomSheet open={Boolean(customer)} onClose={onClose} title={customer ? customer.accountName : "Điểm bán"} description={customer ? `${customer.routeName} - STT ${customer.sortOrder}` : undefined} footer={<div className="sheet-action-grid">{mapsUrl ? <a className="button primary" href={mapsUrl} target="_blank" rel="noreferrer">Mở Google Maps</a> : null}<button className="button" type="button" onClick={onClose}>Đóng</button></div>}>
    {customer ? <div className="outlet-sheet-content"><div className="outlet-focus-card"><span>Trạng thái điểm bán</span><strong>{routeCustomerStatusLabel(customer.status)}</strong><small>{gpsLabel(customer)}</small></div><div className="grid"><div className="metric-row"><span>Liên hệ</span><strong>{customer.contactName}</strong></div><div className="metric-row"><span>Khu vực</span><strong>{customer.area}</strong></div><div className="metric-row"><span>Thứ tự ghé</span><strong>{customer.sortOrder}</strong></div><div className="metric-row"><span>Cập nhật vị trí</span><strong>{customer.gps?.updatedAt ?? "Chưa có"}</strong></div></div><RouteCustomerMediaPreview key={customer.id} routeCustomerId={customer.id} customerName={customer.accountName} /></div> : null}
  </BottomSheet>;
}

function RouteEditSheet({ mode, route, draft, saving, message, onDraftChange, onClose, onSubmit }: { mode: RouteEditorMode | null; route: RouteItem | null; draft: RouteDraft; saving: boolean; message: string | null; onDraftChange: (field: keyof RouteDraft, value: string | boolean) => void; onClose: () => void; onSubmit: () => void }) {
  const open = Boolean(mode);
  const isDelete = mode === "delete";
  const title = mode === "create" ? "Tạo tuyến bán hàng" : mode === "edit" ? "Sửa tuyến bán hàng" : "Xóa tuyến bán hàng";
  const submitLabel = saving ? "Đang lưu..." : isDelete ? "Xóa" : mode === "create" ? "Tạo tuyến" : "Lưu tuyến";
  return <BottomSheet open={open} onClose={onClose} title={title} description={isDelete && route ? `${route.name} · xóa toàn bộ dữ liệu liên quan` : "Tuyến bán hàng dùng để quản lý danh sách điểm bán và mở phiên theo ngày."} footer={<div className="sheet-action-grid"><button className="button primary" type="button" onClick={onSubmit} disabled={saving}>{submitLabel}</button><button className="button" type="button" onClick={onClose} disabled={saving}>Đóng</button></div>}>
    {isDelete ? <div className="visit-sheet-content"><div className="visit-focus-card"><span>Cảnh báo</span><strong>Xóa khỏi hệ thống</strong><small>Tuyến, danh sách điểm bán và toàn bộ dữ liệu phát sinh liên quan sẽ bị xóa. Dữ liệu đã xóa không thể khôi phục.</small></div><div className="metric-row"><span>Tuyến</span><strong>{route?.name}</strong></div><div className="metric-row"><span>Khu vực</span><strong>{route?.area}</strong></div>{message ? <p className="page-subtitle">{message}</p> : null}</div> : <div className="visit-sheet-content"><label className="form-field"><small>Tên tuyến</small><input value={draft.routeName} onChange={(event) => onDraftChange("routeName", event.target.value)} placeholder="VD: Tuyến Quận 5" /></label><label className="form-field"><small>Khu vực</small><input value={draft.area} onChange={(event) => onDraftChange("area", event.target.value)} placeholder="VD: Quận 5" /></label><label className="form-field"><small>Thứ trong tuần</small><select value={draft.weekday} onChange={(event) => onDraftChange("weekday", event.target.value)}><option value="">Chưa chọn</option><option value="1">Thứ 2</option><option value="2">Thứ 3</option><option value="3">Thứ 4</option><option value="4">Thứ 5</option><option value="5">Thứ 6</option><option value="6">Thứ 7</option><option value="0">Chủ nhật</option></select></label>{mode === "edit" ? <label className="form-field"><small>Trạng thái</small><select value={draft.active ? "active" : "paused"} onChange={(event) => onDraftChange("active", event.target.value === "active")}><option value="active">Đang chạy</option><option value="paused">Tạm dừng</option></select></label> : null}<label className="form-field"><small>Ghi chú</small><textarea value={draft.note} onChange={(event) => onDraftChange("note", event.target.value)} placeholder="Ghi chú tuyến" /></label>{message ? <p className="page-subtitle">{message}</p> : null}</div>}
  </BottomSheet>;
}

function CustomerEditSheet({ mode, customer, route, draft, saving, message, activeSessionPrompt, onDraftChange, onUseCurrentLocation, onClose, onSubmit, onIncludeActiveSession, onRouteOnly, onCancelActiveSessionPrompt }: { mode: CustomerEditorMode | null; customer: RouteCustomerItem | null; route: RouteItem | null; draft: CustomerDraft; saving: boolean; message: string | null; activeSessionPrompt: ActiveSessionPrompt | null; onDraftChange: (field: keyof CustomerDraft, value: string | boolean) => void; onUseCurrentLocation: () => void; onClose: () => void; onSubmit: () => void; onIncludeActiveSession: () => void; onRouteOnly: () => void; onCancelActiveSessionPrompt: () => void }) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const open = Boolean(mode);
  const isDelete = mode === "delete";
  const locked = saving || mediaBusy;
  const title = activeSessionPrompt ? "Thêm điểm bán vào phiên hiện tại?" : mode === "create" ? "Thêm điểm bán vào tuyến" : mode === "edit" ? "Sửa điểm bán" : "Xóa điểm bán";
  const submitLabel = saving ? "Đang lưu..." : isDelete ? "Xóa" : mode === "create" ? "Thêm điểm bán" : "Lưu điểm bán";
  const routeName = route?.name || customer?.routeName || "Tuyến bán hàng";
  const mapsHref = draft.geoLat && draft.geoLng ? `https://www.google.com/maps/search/?api=1&query=${draft.geoLat},${draft.geoLng}` : "";
  const lat = Number(draft.geoLat);
  const lng = Number(draft.geoLng);
  const accuracy = Number(draft.geoAccuracy);
  const mediaLocation = draft.geoLat.trim() && draft.geoLng.trim() && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, accuracy: draft.geoAccuracy.trim() && Number.isFinite(accuracy) ? accuracy : null }
    : null;
  const close = () => { if (!locked) onClose(); };
  const footer = activeSessionPrompt
    ? <div className="sheet-action-grid"><button className="button primary" type="button" onClick={onIncludeActiveSession} disabled={locked}>Thêm vào tuyến và phiên</button><button className="button" type="button" onClick={onRouteOnly} disabled={locked}>Chỉ thêm vào tuyến</button></div>
    : <div className="sheet-action-grid"><button className="button primary" type="button" onClick={onSubmit} disabled={locked}>{submitLabel}</button><button className="button" type="button" onClick={close} disabled={locked}>Đóng</button></div>;

  return <BottomSheet open={open} onClose={activeSessionPrompt ? onCancelActiveSessionPrompt : close} title={title} description={activeSessionPrompt ? `Tuyến: ${activeSessionPrompt.routeName}` : isDelete ? `${customer?.accountName || "Điểm bán"} · xóa khỏi tuyến và dữ liệu liên quan` : `Tuyến: ${routeName}`} footer={footer}>
    {activeSessionPrompt ? <div className="visit-sheet-content"><div className="visit-focus-card"><span>Phiên đang hoạt động</span><strong>Tuyến này đang có phiên hoạt động. Thêm khách vào phiên hiện tại luôn?</strong><small>Phiên ngày {activeSessionPrompt.sessionDate}. Lựa chọn mặc định sẽ thêm điểm bán vào cả tuyến cố định và phiên đang chạy.</small></div>{message ? <p className="page-subtitle">{message}</p> : null}</div> : isDelete ? <div className="visit-sheet-content"><div className="visit-focus-card"><span>Cảnh báo</span><strong>Xóa khỏi hệ thống</strong><small>Điểm bán và các dữ liệu liên quan trong những phiên trước sẽ bị xóa. Dữ liệu đã xóa không thể khôi phục.</small></div><div className="metric-row"><span>Điểm bán</span><strong>{customer?.accountName}</strong></div><div className="metric-row"><span>Tuyến</span><strong>{customer?.routeName}</strong></div>{message ? <p className="page-subtitle">{message}</p> : null}</div> : <div className="visit-sheet-content"><label className="form-field"><small>Tên điểm bán</small><input value={draft.customerName} onChange={(event) => onDraftChange("customerName", event.target.value)} placeholder="Nhập tên điểm bán" /></label><label className="form-field"><small>Số điện thoại</small><input value={draft.phone} onChange={(event) => onDraftChange("phone", event.target.value)} placeholder="Số điện thoại" /></label><label className="form-field"><small>Khu vực</small><input value={draft.area} onChange={(event) => onDraftChange("area", event.target.value)} placeholder="Khu vực" /></label><label className="form-field"><small>Địa chỉ</small><input value={draft.address} onChange={(event) => onDraftChange("address", event.target.value)} placeholder="Địa chỉ" /></label><label className="form-field"><small>Thứ tự ghé</small><input inputMode="numeric" value={draft.sortOrder} onChange={(event) => onDraftChange("sortOrder", event.target.value)} /></label>{mode === "edit" ? <label className="form-field"><small>Trạng thái</small><select value={draft.active ? "active" : "hidden"} onChange={(event) => onDraftChange("active", event.target.value === "active")}><option value="active">Đang trong tuyến</option><option value="hidden">Ẩn khỏi tuyến</option></select></label> : null}<div className="mcp-gate-banner"><strong>Định vị điểm bán</strong><span>Bấm lấy định vị trên điện thoại, chờ trình duyệt cấp quyền rồi bấm Lưu điểm bán.</span></div><div className="sheet-action-grid"><button className="button primary" type="button" onClick={onUseCurrentLocation} disabled={locked}>Lấy định vị hiện tại</button>{mapsHref ? <a className="button" href={mapsHref} target="_blank" rel="noreferrer">Mở Maps</a> : null}</div><label className="form-field"><small>Vĩ độ</small><input inputMode="decimal" value={draft.geoLat} onChange={(event) => onDraftChange("geoLat", event.target.value)} placeholder="10.762622" /></label><label className="form-field"><small>Kinh độ</small><input inputMode="decimal" value={draft.geoLng} onChange={(event) => onDraftChange("geoLng", event.target.value)} placeholder="106.660172" /></label><label className="form-field"><small>Độ chính xác GPS, mét</small><input inputMode="decimal" value={draft.geoAccuracy} onChange={(event) => onDraftChange("geoAccuracy", event.target.value)} placeholder="VD: 15" /></label>{mode === "edit" && customer ? <OutletPhotoManager key={customer.id} routeCustomerId={customer.id} active={open && mode === "edit"} location={mediaLocation} onBusyChange={setMediaBusy} /> : null}<label className="form-field"><small>Ghi chú</small><textarea value={draft.note} onChange={(event) => onDraftChange("note", event.target.value)} placeholder="Ghi chú khách tuyến" /></label>{message ? <p className="page-subtitle">{message}</p> : null}</div>}
  </BottomSheet>;
}

function RouteCard({ route, selected, saving, onSelect, onOpenSession, onEdit, onDelete }: { route: RouteItem; selected: boolean; saving: boolean; onSelect: (route: RouteItem) => void; onOpenSession: (route: RouteItem) => void; onEdit: (route: RouteItem) => void; onDelete: (route: RouteItem) => void }) {
  return <OperationalListCard leading={<span>{routeCompletion(route)}</span>} eyebrow={`${route.area} - ${route.salesOwner}`} title={route.name} description={`${route.plannedCustomers} điểm bán - ${route.orderCount} đơn`} badge={<span className={routeStatusClass(route.status)}>{selected ? "Đã chọn" : routeStatusLabel(route.status)}</span>} meta={[`Đã ghé ${route.visitedCustomers}/${route.plannedCustomers}`, `Lần cuối ${route.lastVisitDate}`]} actions={[{ label: selected ? "Xem điểm bán" : "Chọn tuyến", tone: "primary", onClick: () => onSelect(route) }, { label: saving && selected ? "Đang mở..." : "Mở phiên hôm nay", tone: "primary", onClick: () => onOpenSession(route) }, { label: "Sửa", onClick: () => onEdit(route) }, { label: "Xóa", onClick: () => onDelete(route) }]} />;
}

function CustomerCard({ customer, onSelect, onEdit, onDelete }: { customer: RouteCustomerItem; onSelect: (customer: RouteCustomerItem) => void; onEdit: (customer: RouteCustomerItem) => void; onDelete: (customer: RouteCustomerItem) => void }) {
  return <OperationalListCard leading={<span>#{customer.sortOrder}</span>} eyebrow={`${customer.area} - ${customer.contactName}`} title={customer.accountName} description={customer.note || gpsLabel(customer)} badge={<span className={routeCustomerStatusClass(customer.status)}>{routeCustomerStatusLabel(customer.status)}</span>} meta={[gpsLabel(customer)]} actions={[{ label: "Xem điểm bán", tone: "primary", onClick: () => onSelect(customer) }, { label: customer.gps ? "Cập nhật vị trí" : "Lấy vị trí", tone: customer.gps ? undefined : "primary", onClick: () => onEdit(customer) }, { label: "Sửa", onClick: () => onEdit(customer) }, { label: "Xóa", onClick: () => onDelete(customer) }]} />;
}

export function McpMasterView({ activeHref, routesData, routeCustomersData }: { activeHref: string; routesData: RoutesData; routeCustomersData: RouteCustomersData }) {
  const router = useRouter();
  const customerIntentKeyRef = useRef<string | null>(null);
  const customerIntentChoiceRef = useRef<CustomerIntentChoice | null>(null);
  const [tab, setTab] = useState<MasterTab>("routes");
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<RouteCustomerItem | null>(null);
  const [routeEditorMode, setRouteEditorMode] = useState<RouteEditorMode | null>(null);
  const [routeEditorRoute, setRouteEditorRoute] = useState<RouteItem | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft>(emptyRouteDraft());
  const [customerEditorMode, setCustomerEditorMode] = useState<CustomerEditorMode | null>(null);
  const [customerEditorCustomer, setCustomerEditorCustomer] = useState<RouteCustomerItem | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(emptyCustomerDraft());
  const [activeSessionPrompt, setActiveSessionPrompt] = useState<ActiveSessionPrompt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const selectedCustomers = useMemo(() => selectedRoute ? routeCustomersData.customers.filter((customer) => customer.routeId === selectedRoute.id) : [], [routeCustomersData.customers, selectedRoute]);
  const gpsCustomers = useMemo(() => selectedCustomers.filter((customer) => customer.status === "needs_gps" || !customer.gps), [selectedCustomers]);
  const openRoutes = routesData.routes.filter((route) => route.status === "active" || route.status === "watch");

  function resetCustomerIntent() {
    customerIntentKeyRef.current = null;
    customerIntentChoiceRef.current = null;
  }

  function chooseRoute(route: RouteItem) { setSelectedRoute(route); setSelectedCustomer(null); setMessage(null); setTab("customers"); }
  function openRouteCreate() { setRouteEditorMode("create"); setRouteEditorRoute(null); setRouteDraft(emptyRouteDraft()); setMessage(null); }
  function openRouteEdit(route: RouteItem) { setRouteEditorMode("edit"); setRouteEditorRoute(route); setRouteDraft(routeToDraft(route)); setMessage(null); }
  function openRouteDelete(route: RouteItem) { setRouteEditorMode("delete"); setRouteEditorRoute(route); setRouteDraft(routeToDraft(route)); setMessage(null); }
  function closeRouteEditor() { if (saving) return; setRouteEditorMode(null); setRouteEditorRoute(null); setMessage(null); }
  function updateRouteDraft(field: keyof RouteDraft, value: string | boolean) { setRouteDraft((current) => ({ ...current, [field]: value })); }
  function openCustomerCreate() { if (!selectedRoute) { setMessage("Cần chọn tuyến gốc trước khi thêm khách"); return; } resetCustomerIntent(); setActiveSessionPrompt(null); setCustomerEditorMode("create"); setCustomerEditorCustomer(null); setCustomerDraft(emptyCustomerDraft(selectedRoute)); setSelectedCustomer(null); setMessage(null); }
  function openCustomerEdit(customer: RouteCustomerItem) { resetCustomerIntent(); setActiveSessionPrompt(null); setCustomerEditorMode("edit"); setCustomerEditorCustomer(customer); setCustomerDraft(customerToDraft(customer)); setSelectedCustomer(null); setMessage(null); }
  function openCustomerDelete(customer: RouteCustomerItem) { resetCustomerIntent(); setActiveSessionPrompt(null); setCustomerEditorMode("delete"); setCustomerEditorCustomer(customer); setCustomerDraft(customerToDraft(customer)); setSelectedCustomer(null); setMessage(null); }
  function closeCustomerEditor() { if (saving) return; resetCustomerIntent(); setActiveSessionPrompt(null); setCustomerEditorMode(null); setCustomerEditorCustomer(null); setMessage(null); }
  function updateCustomerDraft(field: keyof CustomerDraft, value: string | boolean) { if (customerEditorMode === "create") resetCustomerIntent(); setCustomerDraft((current) => ({ ...current, [field]: value })); }
  function useCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setMessage("Trình duyệt không hỗ trợ lấy định vị"); return; }
    setMessage("Đang lấy định vị, vui lòng cấp quyền định vị cho trình duyệt...");
    navigator.geolocation.getCurrentPosition((pos) => { const lat = pos.coords.latitude; const lng = pos.coords.longitude; const accuracy = pos.coords.accuracy; resetCustomerIntent(); setCustomerDraft((current) => ({ ...current, geoLat: String(lat), geoLng: String(lng), geoAccuracy: Number.isFinite(accuracy) ? String(Math.round(accuracy)) : current.geoAccuracy })); setMessage(`Đã lấy định vị: ${lat.toFixed(6)}, ${lng.toFixed(6)}. Bấm Lưu điểm bán để ghi vào tuyến.`); }, (error) => { setMessage(error.message || "Không lấy được vị trí. Vui lòng kiểm tra quyền định vị của trình duyệt."); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function submitRouteEditor() { if (!routeEditorMode) return; startSaving(async () => { try { setMessage(null); if (routeEditorMode === "create") { if (!routeDraft.routeName.trim()) throw new Error("Cần nhập tên tuyến"); const response = await idempotentMutationFetch("/api/routes", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(routeDraft) }, { operation: "route.create" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(apiError(payload, "Không tạo được tuyến")); } else if (routeEditorMode === "edit" && routeEditorRoute) { if (!routeDraft.routeName.trim()) throw new Error("Cần nhập tên tuyến"); const response = await idempotentMutationFetch(`/api/routes/${encodeURIComponent(routeEditorRoute.id)}`, { method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(routeDraft) }, { operation: "route.update" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(apiError(payload, "Không sửa được tuyến")); } else if (routeEditorMode === "delete" && routeEditorRoute) { const response = await fetch(`/api/routes/${encodeURIComponent(routeEditorRoute.id)}/archive`, { method: "POST", headers: { Accept: "application/json" } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(apiError(payload, "Không xóa được tuyến")); if (selectedRoute?.id === routeEditorRoute.id) setSelectedRoute(null); } setRouteEditorMode(null); setRouteEditorRoute(null); router.refresh(); } catch (error) { setMessage(userFacingError(error, "Không lưu được tuyến. Vui lòng thử lại.")); } }); }

  async function persistNewRouteCustomer(choice: CustomerIntentChoice) {
    if (!selectedRoute) throw new Error("Cần chọn tuyến gốc");
    const key = customerIntentKeyRef.current || createIdempotencyKey("route-customer.add");
    customerIntentKeyRef.current = key;
    customerIntentChoiceRef.current = choice;

    const response = await idempotentMutationFetch(
      "/api/route-customers",
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customerDraft,
          geoSource: customerDraft.geoLat && customerDraft.geoLng ? "browser" : undefined,
          routeId: selectedRoute.id,
          includeActiveSession: choice.includeActiveSession,
          activeSessionId: choice.includeActiveSession ? choice.activeSessionId : undefined
        })
      },
      { operation: "route-customer.add", key }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiError(payload, "Không thêm được khách tuyến"));
    const result = ((payload as { data?: RouteCustomerAddResult }).data || payload) as RouteCustomerAddResult;

    if (result.reusedRouteCustomer || result.reusedSessionCustomer) {
      setMessage(choice.includeActiveSession ? "Điểm bán đã tồn tại và được dùng lại trong tuyến và phiên hiện tại." : "Điểm bán đã tồn tại và được dùng lại trong tuyến cố định.");
    } else if (choice.includeActiveSession) {
      setMessage("Đã thêm điểm bán vào tuyến và phiên hiện tại.");
    } else {
      setMessage("Đã thêm điểm bán vào tuyến, áp dụng từ phiên sau.");
    }

    resetCustomerIntent();
    setActiveSessionPrompt(null);
    setCustomerEditorMode(null);
    setCustomerEditorCustomer(null);
    router.refresh();
  }

  function runCustomerCreate(choice: CustomerIntentChoice) {
    setActiveSessionPrompt(null);
    startSaving(async () => {
      try {
        setMessage(null);
        await persistNewRouteCustomer(choice);
      } catch (error) {
        setMessage(userFacingError(error, "Không lưu được điểm bán. Vui lòng thử lại."));
      }
    });
  }

  function submitCustomerEditor() {
    if (!customerEditorMode) return;
    if (customerEditorMode === "create") {
      startSaving(async () => {
        try {
          setMessage(null);
          if (!selectedRoute) throw new Error("Cần chọn tuyến gốc");
          if (!customerDraft.customerName.trim()) throw new Error("Cần nhập tên khách");

          if (!customerIntentKeyRef.current) customerIntentKeyRef.current = createIdempotencyKey("route-customer.add");
          if (customerIntentChoiceRef.current) {
            await persistNewRouteCustomer(customerIntentChoiceRef.current);
            return;
          }

          const statusResponse = await fetch(`/api/backend/mcp-settings/session-status?routeId=${encodeURIComponent(selectedRoute.id)}`, { cache: "no-store", headers: { Accept: "application/json" } });
          const statusPayload = await statusResponse.json().catch(() => ({}));
          if (!statusResponse.ok) throw new Error(apiError(statusPayload, "Không kiểm tra được phiên đang hoạt động"));
          const statusData = (statusPayload as { data?: { sessions?: ActiveSessionRow[] }; sessions?: ActiveSessionRow[] }).data || statusPayload as { sessions?: ActiveSessionRow[] };
          const sessions = Array.isArray(statusData.sessions) ? statusData.sessions : [];
          const activeSessions = sessions.filter((session) => session.status === "active");

          if (activeSessions.length > 1) throw new Error("Tuyến đang có nhiều hơn một phiên hoạt động. Cần xử lý trạng thái phiên trước khi thêm điểm bán.");
          if (activeSessions.length === 1) {
            const activeSession = activeSessions[0];
            if (!activeSession.id) throw new Error("Không xác định được phiên đang hoạt động");
            setActiveSessionPrompt({ id: activeSession.id, routeName: activeSession.routeName || selectedRoute.name, sessionDate: activeSession.sessionDate || "-" });
            return;
          }

          const choice = { includeActiveSession: false };
          customerIntentChoiceRef.current = choice;
          await persistNewRouteCustomer(choice);
        } catch (error) {
          setMessage(userFacingError(error, "Không lưu được điểm bán. Vui lòng thử lại."));
        }
      });
      return;
    }

    startSaving(async () => {
      try {
        setMessage(null);
        if (customerEditorMode === "edit" && customerEditorCustomer) {
          if (!customerDraft.customerName.trim()) throw new Error("Cần nhập tên khách");
          const response = await idempotentMutationFetch(`/api/route-customers/${encodeURIComponent(customerEditorCustomer.id)}`, { method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ ...customerDraft, geoSource: customerDraft.geoLat && customerDraft.geoLng ? "browser" : undefined }) }, { operation: "route-customer.update" });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(apiError(payload, "Không sửa được khách tuyến"));
        } else if (customerEditorMode === "delete" && customerEditorCustomer) {
          const response = await fetch(`/api/route-customers/${encodeURIComponent(customerEditorCustomer.id)}/archive`, { method: "POST", headers: { Accept: "application/json" } });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(apiError(payload, "Không xóa được khách tuyến"));
          if (selectedCustomer?.id === customerEditorCustomer.id) setSelectedCustomer(null);
        }
        setCustomerEditorMode(null);
        setCustomerEditorCustomer(null);
        router.refresh();
      } catch (error) {
        setMessage(userFacingError(error, "Không lưu được điểm bán. Vui lòng thử lại."));
      }
    });
  }

  function includeActiveSession() {
    if (!activeSessionPrompt) return;
    runCustomerCreate({ includeActiveSession: true, activeSessionId: activeSessionPrompt.id });
  }

  function routeOnly() {
    runCustomerCreate({ includeActiveSession: false });
  }

  function openSession(route: RouteItem) { const sessionDate = todayDateOnly(); setSelectedRoute(route); setMessage(null); startSaving(async () => { try { const response = await idempotentMutationFetch("/api/backend/mcp-day/open-session", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ routeId: route.id, sessionDate, owner: route.salesOwner || "Sale" }) }, { operation: "route-session.open" }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(apiError(payload, "Không mở được phiên MCP")); router.push(`/visits?routeId=${encodeURIComponent(route.id)}&date=${encodeURIComponent(sessionDate)}`); } catch (error) { setMessage(userFacingError(error, "Không mở được phiên đi tuyến. Vui lòng thử lại.")); } }); }

  return <AppShell activeHref={activeHref}><PageHeader eyebrow="Tuyến bán hàng" title="Tuyến bán hàng" subtitle="Quản lý tuyến bán hàng, điểm bán trong tuyến và mở phiên đi thị trường theo ngày."><button className="button primary" type="button" onClick={openRouteCreate}>Tạo tuyến</button></PageHeader><FilterBar filters={[{ label: "Tuyến", value: String(routesData.routes.length) }, { label: "Đang chọn", value: selectedRoute?.name ?? "Chưa chọn" }, { label: "Điểm bán", value: selectedRoute ? String(selectedCustomers.length) : "-" }, { label: "Cần định vị", value: selectedRoute ? String(gpsCustomers.length) : "-" }]} />{message && !routeEditorMode && !customerEditorMode ? <section className="empty-inline"><strong>{message}</strong></section> : null}<section className="dashboard-section"><div className="dashboard-section-head"><h2>Tuyến bán hàng</h2><span>{selectedRoute ? `Đã chọn: ${selectedRoute.name}` : "Chưa chọn tuyến"}</span></div><div className="mcp-status-chips" role="tablist" aria-label="Tuyến bán hàng"><button className={tab === "routes" ? "active" : ""} type="button" onClick={() => setTab("routes")}>Tuyến <b>{routesData.routes.length}</b></button><button className={tab === "customers" ? "active" : ""} type="button" onClick={() => setTab("customers")}>Điểm bán <b>{selectedRoute ? selectedCustomers.length : 0}</b></button><button className={tab === "gps" ? "active" : ""} type="button" onClick={() => setTab("gps")}>Cần định vị <b>{selectedRoute ? gpsCustomers.length : 0}</b></button><button className={tab === "open" ? "active" : ""} type="button" onClick={() => setTab("open")}>Chuẩn bị phiên <b>{openRoutes.length}</b></button></div></section>{tab === "routes" ? routesData.routes.length > 0 ? <div className="mcp-line-list">{routesData.routes.map((route) => <RouteCard key={route.id} route={route} selected={selectedRoute?.id === route.id} saving={saving} onSelect={chooseRoute} onOpenSession={openSession} onEdit={openRouteEdit} onDelete={openRouteDelete} />)}</div> : <EmptyPanel title="Chưa có tuyến" hint="Bấm Tạo tuyến để thêm tuyến gốc mới." /> : null}{tab === "customers" ? !selectedRoute ? <EmptyPanel title="Chọn một tuyến" hint="Vui lòng chọn tuyến để xem các điểm bán thuộc tuyến." /> : <div className="mcp-line-list"><button className="button primary" type="button" onClick={openCustomerCreate} disabled={saving}>Thêm điểm bán vào tuyến</button>{selectedCustomers.length > 0 ? selectedCustomers.map((customer) => <CustomerCard key={customer.id} customer={customer} onSelect={setSelectedCustomer} onEdit={openCustomerEdit} onDelete={openCustomerDelete} />) : <EmptyPanel title="Tuyến chưa có khách" hint="Bấm Thêm điểm bán vào tuyến để tạo khách gốc." />}<button className="button primary" type="button" disabled={saving} onClick={() => openSession(selectedRoute)}>{saving ? "Đang mở phiên..." : "Mở phiên hôm nay"}</button></div> : null}{tab === "gps" ? !selectedRoute ? <EmptyPanel title="Chọn một tuyến" hint="Vui lòng chọn tuyến để xem các điểm bán cần bổ sung vị trí." /> : gpsCustomers.length > 0 ? <div className="mcp-line-list">{gpsCustomers.map((customer) => <CustomerCard key={customer.id} customer={customer} onSelect={setSelectedCustomer} onEdit={openCustomerEdit} onDelete={openCustomerDelete} />)}</div> : <EmptyPanel title="Vị trí đã đầy đủ" hint="Tuyến đang chọn không có điểm bán cần bổ sung vị trí." /> : null}{tab === "open" ? openRoutes.length > 0 ? <div className="mcp-line-list">{openRoutes.map((route) => <RouteCard key={route.id} route={route} selected={selectedRoute?.id === route.id} saving={saving} onSelect={chooseRoute} onOpenSession={openSession} onEdit={openRouteEdit} onDelete={openRouteDelete} />)}</div> : <EmptyPanel title="Không có tuyến đang chạy" hint="Chỉ tuyến đang chạy hoặc cần theo dõi mới dùng để chuẩn bị phiên." /> : null}<CustomerSheet customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} /><RouteEditSheet mode={routeEditorMode} route={routeEditorRoute} draft={routeDraft} saving={saving} message={message} onDraftChange={updateRouteDraft} onClose={closeRouteEditor} onSubmit={submitRouteEditor} /><CustomerEditSheet mode={customerEditorMode} customer={customerEditorCustomer} route={selectedRoute} draft={customerDraft} saving={saving} message={message} activeSessionPrompt={activeSessionPrompt} onDraftChange={updateCustomerDraft} onUseCurrentLocation={useCurrentLocation} onClose={closeCustomerEditor} onSubmit={submitCustomerEditor} onIncludeActiveSession={includeActiveSession} onRouteOnly={routeOnly} onCancelActiveSessionPrompt={() => setActiveSessionPrompt(null)} /></AppShell>;
}
