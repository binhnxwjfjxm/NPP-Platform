"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/ui/overlay/BottomSheet";

type SessionRow = { id: string; routeId: string; routeName: string; sessionDate: string; status: string; note?: string; plannedCustomers: number; visitedCustomers: number };
type SessionsPayload = { sessions: SessionRow[]; routes: { id: string; name: string }[]; kpis: { label: string; value: string | number; hint: string }[] };
type EditDraft = { sessionDate: string; status: string; note: string };

const statusLabels: Record<string, string> = { active: "Đang chạy", done: "Đã chốt", completed: "Đã chốt", cancelled: "Đã hủy" };
const actionUrl = (id: string) => `/api/backend/mcp-session-actions/${encodeURIComponent(id)}`;

function toDraft(session: SessionRow): EditDraft {
  return { sessionDate: session.sessionDate, status: session.status === "completed" ? "done" : session.status || "active", note: session.note || "" };
}

async function requestJson(path: string, init: RequestInit) {
  const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || "Không xử lý được phiên");
  return payload;
}

export function McpSessionsManager({ data, filters }: { data: SessionsPayload; filters: { dateFrom: string; dateTo: string; routeId: string; status: string } }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState<SessionRow | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ sessionDate: "", status: "active", note: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openEdit(session: SessionRow) { setEditing(session); setDeleting(null); setDraft(toDraft(session)); setMessage(null); }
  function openDelete(session: SessionRow) { setDeleting(session); setEditing(null); setMessage(null); }
  function closeSheets() { if (!pending) { setEditing(null); setDeleting(null); setMessage(null); } }
  function saveEdit() { if (!editing) return; startTransition(async () => { try { setMessage(null); await requestJson(actionUrl(editing.id), { method: "PATCH", body: JSON.stringify(draft) }); setEditing(null); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Không cập nhật được phiên"); } }); }
  function deleteSession() { if (!deleting) return; startTransition(async () => { try { setMessage(null); await requestJson(actionUrl(deleting.id), { method: "DELETE" }); setDeleting(null); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Không xóa được phiên"); } }); }

  return <>
    <form className="filter-bar mcp-session-filter" action="/mcp/sessions">
      <label className="form-field"><small>Từ</small><input name="dateFrom" type="date" defaultValue={filters.dateFrom} /></label>
      <label className="form-field"><small>Đến</small><input name="dateTo" type="date" defaultValue={filters.dateTo} /></label>
      <label className="form-field"><small>Tuyến</small><select name="routeId" defaultValue={filters.routeId}><option value="">Tất cả tuyến</option>{data.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
      <label className="form-field"><small>TT</small><select name="status" defaultValue={filters.status}><option value="">Tất cả</option><option value="active">Đang chạy</option><option value="done">Đã chốt</option><option value="cancelled">Đã hủy</option></select></label>
      <button className="button primary" type="submit">Lọc</button>
    </form>
    <div className="grid cards mcp-session-kpis">{data.kpis.map((item) => <article className="card" key={item.label}><div className="card-label">{item.label}</div><div className="card-value">{item.value}</div><p className="card-hint">{item.hint}</p></article>)}</div>
    <section className="grid mcp-session-list">{data.sessions.length === 0 ? <div className="empty-inline">Chưa có phiên trong bộ lọc.</div> : data.sessions.map((session) => <article className="action-card mcp-session-card" key={session.id}><div><span className="badge">{statusLabels[session.status] || session.status}</span><h3>{session.routeName}</h3><p>{session.sessionDate} · {session.visitedCustomers}/{session.plannedCustomers} khách đã ghé</p></div><div className="mcp-session-card-actions"><Link className="button primary" href={`/visits?routeId=${encodeURIComponent(session.routeId)}&date=${encodeURIComponent(session.sessionDate)}`} prefetch>Mở checklist</Link><button className="button" type="button" onClick={() => openEdit(session)}>Sửa phiên</button><button className="button danger" type="button" onClick={() => openDelete(session)}>Xóa phiên</button></div></article>)}</section>
    <BottomSheet open={Boolean(editing)} onClose={closeSheets} title="Sửa phiên" description={editing ? `${editing.routeName} · chỉ sửa ngày/trạng thái/ghi chú.` : undefined} footer={<div className="sheet-action-grid"><button className="button" type="button" onClick={closeSheets} disabled={pending}>Đóng</button><button className="button primary" type="button" onClick={saveEdit} disabled={pending}>{pending ? "Đang lưu..." : "Lưu phiên"}</button></div>}>{editing ? <div className="grid"><label className="form-field"><small>Ngày phiên</small><input type="date" value={draft.sessionDate} onChange={(event) => setDraft((current) => ({ ...current, sessionDate: event.target.value }))} /></label><label className="form-field"><small>Trạng thái</small><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="active">Đang chạy</option><option value="done">Đã chốt</option><option value="cancelled">Đã hủy</option></select></label><label className="form-field"><small>Ghi chú</small><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>{message ? <p className="page-subtitle order-message">{message}</p> : null}</div> : null}</BottomSheet>
    <BottomSheet open={Boolean(deleting)} onClose={closeSheets} title="Xóa phiên" description={deleting ? `${deleting.routeName} · ${deleting.sessionDate}` : undefined} footer={<div className="sheet-action-grid"><button className="button" type="button" onClick={closeSheets} disabled={pending}>Đóng</button><button className="button danger" type="button" onClick={deleteSession} disabled={pending}>{pending ? "Đang xóa..." : "Xóa phiên rỗng"}</button></div>}>{deleting ? <div className="visit-sheet-content"><div className="visit-focus-card"><span>Cảnh báo</span><strong>Chỉ xóa phiên chưa phát sinh hoạt động</strong><small>Nếu phiên đã có khách ghé, đơn, test, báo cáo hoặc follow-up, hệ thống sẽ chặn xóa.</small></div><div className="metric-row"><span>Khách đã ghé</span><strong>{deleting.visitedCustomers}/{deleting.plannedCustomers}</strong></div>{message ? <p className="page-subtitle order-message">{message}</p> : null}</div> : null}</BottomSheet>
  </>;
}
