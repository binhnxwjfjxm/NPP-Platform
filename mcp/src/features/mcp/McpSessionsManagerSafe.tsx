"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { userFacingError } from "@/lib/ui/user-facing-error";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { ExportMenu, buildExportLink } from "@/features/exports/ExportLinks";

type SessionRow = {
  id: string;
  routeId: string;
  routeName: string;
  sessionDate: string;
  status: string;
  note?: string;
  plannedCustomers: number;
  visitedCustomers: number;
  orderCount?: number;
  testCount?: number;
  reportCount?: number;
  followupCount?: number;
};

type SessionsPayload = {
  sessions: SessionRow[];
  routes: { id: string; name: string }[];
  kpis: { label: string; value: string | number; hint: string }[];
};

type EditDraft = {
  sessionDate: string;
  status: string;
  note: string;
};

const labels: Record<string, string> = {
  active: "Đang chạy",
  done: "Đã chốt",
  completed: "Đã chốt",
  cancelled: "Đã hủy"
};

const actionUrl = (id: string) =>
  `/api/backend/mcp-session-actions/${encodeURIComponent(id)}`;
const reportExportUrl = (id: string, format: "json" | "markdown") =>
  `/api/mcp-session-report/export?sessionId=${encodeURIComponent(id)}&format=${format}`;
const sessionExcelUrl = (id: string) =>
  `/api/backend/exports/mcp-sessions.csv?sessionId=${encodeURIComponent(id)}`;
const sessionPdfUrl = (id: string) =>
  `/api/pdf/session-day?sessionId=${encodeURIComponent(id)}`;
const sessionWordUrl = (id: string) =>
  `/api/mcp-session-report/word?sessionId=${encodeURIComponent(id)}`;

function toDraft(session: SessionRow): EditDraft {
  return {
    sessionDate: session.sessionDate,
    status: session.status === "completed" ? "done" : session.status || "active",
    note: session.note || ""
  };
}

function branchSummary(session: SessionRow) {
  return `${session.orderCount || 0} đơn · ${session.testCount || 0} lượt thử · ${session.reportCount || 0} báo cáo · ${session.followupCount || 0} việc theo dõi`;
}

function isClosedSession(session: SessionRow) {
  return session.status === "done" || session.status === "completed";
}

function isEditableSession(session: SessionRow) {
  return !isClosedSession(session) && session.status !== "cancelled";
}

function friendlyError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : fallback;

  if (raw.includes("session_has_activity")) {
    return "Phiên đã có lượt ghé, đơn, lượt thử, báo cáo hoặc việc theo dõi nên không thể xóa. Hãy hủy phiên thay vì xóa.";
  }
  if (raw.includes("session_closed")) {
    return "Phiên đã chốt nên không thể xóa.";
  }
  if (raw.includes("session_not_found")) {
    return "Phiên không còn tồn tại. Danh sách sẽ được tải lại.";
  }
  if (raw.includes("missing_supabase_service_role_key")) {
    return "Hệ thống tạm thời chưa sẵn sàng. Vui lòng liên hệ quản trị.";
  }
  if (raw.includes("session_delete_not_applied")) {
    return "Không thể xóa phiên. Dữ liệu vẫn được giữ nguyên.";
  }

  return userFacingError(error, fallback);
}

async function parseApiResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || payload.message || "Không xử lý được phiên");
  }

  return payload;
}

function sessionMutationOperation(methodInput: string | undefined) {
  const method = String(methodInput || "POST").toUpperCase();
  if (method === "PATCH") return "route-session.update";
  if (method === "DELETE") return "route-session.delete-empty";
  throw new Error(`unsupported_session_mutation_method:${method}`);
}

async function callApi(path: string, init: RequestInit) {
  const response = await idempotentMutationFetch(
    path,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      ...init
    },
    { operation: sessionMutationOperation(init.method) }
  );
  return parseApiResponse(response);
}

async function callIdempotentApi(path: string, init: RequestInit, operation: string) {
  const response = await idempotentMutationFetch(
    path,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      ...init
    },
    { operation }
  );
  return parseApiResponse(response);
}

function SessionExportMenu({ session }: { session: SessionRow }) {
  const closed = isClosedSession(session);

  return (
    <ExportMenu
      label={closed ? "Xuất báo cáo" : "Xuất"}
      groups={[
        {
          title: "Xuất văn phòng",
          links: [
            buildExportLink(
              "PDF",
              sessionPdfUrl(session.id),
              "primary",
              "Xem, in hoặc gửi quản lý"
            ),
            buildExportLink(
              "Excel",
              sessionExcelUrl(session.id),
              undefined,
              "Danh sách khách và trạng thái trong phiên"
            ),
            buildExportLink(
              "Word",
              sessionWordUrl(session.id),
              undefined,
              "Bản báo cáo có thể chỉnh sửa"
            )
          ]
        },
        {
          title: "Dữ liệu AI",
          links: [
            buildExportLink(
              closed ? "Dữ liệu JSON" : "Dữ liệu JSON tạm tính",
              reportExportUrl(session.id, "json"),
              undefined,
              "Dữ liệu máy đọc có cấu trúc"
            ),
            buildExportLink(
              "Markdown",
              reportExportUrl(session.id, "markdown"),
              undefined,
              "Văn bản để dán vào AI hoặc lưu kỹ thuật"
            )
          ]
        }
      ]}
    />
  );
}

export function McpSessionsManagerSafe({
  data,
  filters
}: {
  data: SessionsPayload;
  filters: {
    dateFrom: string;
    dateTo: string;
    routeId: string;
    status: string;
  };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [deleting, setDeleting] = useState<SessionRow | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    sessionDate: "",
    status: "active",
    note: ""
  });
  const [message, setMessage] = useState<string | null>(null);
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openEdit(session: SessionRow) {
    if (!isEditableSession(session)) return;
    setDeleting(null);
    setEditing(session);
    setDraft(toDraft(session));
    setMessage(null);
  }

  function openDelete(session: SessionRow) {
    if (isClosedSession(session)) return;
    setEditing(null);
    setDeleting(session);
    setMessage(null);
  }

  function close() {
    if (pending) return;
    setEditing(null);
    setDeleting(null);
    setMessage(null);
  }

  function save() {
    if (!editing) return;

    startTransition(async () => {
      try {
        setMessage(null);
        await callApi(actionUrl(editing.id), {
          method: "PATCH",
          body: JSON.stringify(draft)
        });
        setEditing(null);
        router.refresh();
      } catch (error) {
        setMessage(friendlyError(error, "Không cập nhật được phiên"));
      }
    });
  }

  function deleteSession() {
    if (!deleting) return;

    const deletedLabel = `${deleting.routeName} · ${deleting.sessionDate}`;

    startTransition(async () => {
      try {
        setMessage(null);
        await callApi(actionUrl(deleting.id), { method: "DELETE" });
        setDeleting(null);
        setMessage(`Đã xóa phiên rỗng ${deletedLabel}.`);
        router.refresh();
      } catch (error) {
        setMessage(friendlyError(error, "Không xóa được phiên"));
      }
    });
  }

  function rebuildReport(session: SessionRow) {
    startTransition(async () => {
      try {
        setMessage(null);
        setRebuildingId(session.id);
        await callIdempotentApi(
          "/api/mcp-session-report",
          {
            method: "POST",
            body: JSON.stringify({
              sessionId: session.id,
              source: "manual_rebuild_from_sessions_page"
            })
          },
          "session-report.snapshot.create"
        );
        setMessage(`Đã tạo lại báo cáo phiên ${session.routeName} · ${session.sessionDate}`);
        router.refresh();
      } catch (error) {
        setMessage(friendlyError(error, "Không tạo lại được báo cáo phiên"));
      } finally {
        setRebuildingId(null);
      }
    });
  }

  return (
    <>
      <form className="filter-bar mcp-session-filter" action="/mcp/sessions">
        <label className="form-field">
          <small>Từ</small>
          <input name="dateFrom" type="date" defaultValue={filters.dateFrom} />
        </label>
        <label className="form-field">
          <small>Đến</small>
          <input name="dateTo" type="date" defaultValue={filters.dateTo} />
        </label>
        <label className="form-field">
          <small>Tuyến</small>
          <select name="routeId" defaultValue={filters.routeId}>
            <option value="">Tất cả tuyến</option>
            {data.routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <small>Trạng thái</small>
          <select name="status" defaultValue={filters.status}>
            <option value="">Tất cả</option>
            <option value="active">Đang chạy</option>
            <option value="done">Đã chốt</option>
            <option value="cancelled">Đã hủy</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          Lọc
        </button>
      </form>

      <div className="grid cards mcp-session-kpis">
        {data.kpis.map((item) => (
          <article className="card" key={item.label}>
            <div className="card-label">{item.label}</div>
            <div className="card-value">{item.value}</div>
            <p className="card-hint">{item.hint}</p>
          </article>
        ))}
      </div>

      {message && !editing && !deleting ? (
        <div className="empty-inline" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}

      <section className="grid mcp-session-list">
        {data.sessions.length === 0 ? (
          <div className="empty-inline">Chưa có phiên trong bộ lọc.</div>
        ) : (
          data.sessions.map((session) => {
            const closed = isClosedSession(session);
            const editable = isEditableSession(session);
            const checklistHref = `/visits?routeId=${encodeURIComponent(session.routeId)}&date=${encodeURIComponent(session.sessionDate)}`;

            return (
              <article className="action-card mcp-session-card" key={session.id}>
                <div>
                  <span className="badge">{labels[session.status] || session.status}</span>
                  <h3>{session.routeName}</h3>
                  <p>
                    {session.sessionDate} · {session.visitedCustomers}/
                    {session.plannedCustomers} khách đã ghé
                  </p>
                  <p className="page-subtitle" style={{ marginTop: 4, fontSize: 12 }}>
                    Kết quả phiên: {branchSummary(session)}
                  </p>
                </div>

                <div
                  className="mcp-session-card-actions"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr)",
                    gap: 8,
                    width: "min(100%, 360px)"
                  }}
                >
                  {closed ? (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 8
                        }}
                      >
                        <Link
                          className="button primary"
                          href={`/reports?sessionId=${encodeURIComponent(session.id)}`}
                          prefetch
                        >
                          Xem BC phiên
                        </Link>
                        <SessionExportMenu session={session} />
                      </div>
                      <button
                        className="button"
                        type="button"
                        onClick={() => rebuildReport(session)}
                        disabled={pending || rebuildingId === session.id}
                      >
                        {rebuildingId === session.id ? "Đang tạo lại..." : "Tạo lại báo cáo"}
                      </button>
                      <small className="page-subtitle">
                        Phiên đã chốt, chỉ có thể xem và xuất báo cáo
                      </small>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 8
                        }}
                      >
                        <Link className="button primary" href={checklistHref} prefetch>
                          Mở phiên
                        </Link>
                        <SessionExportMenu session={session} />
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: editable ? "1fr 1fr" : "1fr",
                          gap: 8
                        }}
                      >
                        {editable ? (
                          <button
                            className="button"
                            type="button"
                            onClick={() => openEdit(session)}
                          >
                            Sửa phiên
                          </button>
                        ) : null}
                        <button
                          className="button danger"
                          type="button"
                          onClick={() => openDelete(session)}
                        >
                          Xóa phiên
                        </button>
                      </div>

                      {session.status === "cancelled" ? (
                        <small className="page-subtitle">
                          Phiên đã hủy; chỉ xóa được khi chưa có hoạt động.
                        </small>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>

      <BottomSheet
        open={Boolean(editing)}
        onClose={close}
        title="Sửa phiên"
        description={
          editing
            ? `${editing.routeName} · chỉ sửa ngày, trạng thái và ghi chú.`
            : undefined
        }
        footer={
          <div className="sheet-action-grid">
            <button className="button" type="button" onClick={close} disabled={pending}>
              Đóng
            </button>
            <button
              className="button primary"
              type="button"
              onClick={save}
              disabled={pending}
            >
              {pending ? "Đang lưu..." : "Lưu phiên"}
            </button>
          </div>
        }
      >
        {editing ? (
          <div className="grid">
            <label className="form-field">
              <small>Ngày phiên</small>
              <input
                type="date"
                value={draft.sessionDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sessionDate: event.target.value
                  }))
                }
              />
            </label>
            <label className="form-field">
              <small>Trạng thái</small>
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    status: event.target.value
                  }))
                }
              >
                <option value="active">Đang chạy</option>
                <option value="done">Đã chốt</option>
                <option value="cancelled">Đã hủy</option>
              </select>
            </label>
            <label className="form-field">
              <small>Ghi chú</small>
              <textarea
                value={draft.note}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    note: event.target.value
                  }))
                }
              />
            </label>
            {message ? <p className="page-subtitle order-message">{message}</p> : null}
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={Boolean(deleting)}
        onClose={close}
        title="Xóa phiên"
        description={
          deleting ? `${deleting.routeName} · ${deleting.sessionDate}` : undefined
        }
        footer={
          <div className="sheet-action-grid">
            <button className="button" type="button" onClick={close} disabled={pending}>
              Đóng
            </button>
            <button
              className="button danger"
              type="button"
              onClick={deleteSession}
              disabled={pending}
            >
              {pending ? "Đang xóa..." : "Xóa phiên rỗng"}
            </button>
          </div>
        }
      >
        {deleting ? (
          <div className="visit-sheet-content">
            <div className="visit-focus-card">
              <span>Cảnh báo</span>
              <strong>Chỉ phiên chưa phát sinh hoạt động mới được xóa</strong>
              <small>
                Danh sách điểm bán chưa phát sinh hoạt động sẽ được xóa cùng phiên.
                Phiên đã có lượt ghé, đơn hàng, thử sản phẩm, báo cáo hoặc việc theo dõi sẽ được giữ lại.
              </small>
            </div>
            <div className="metric-row">
              <span>Khách đã ghé</span>
              <strong>
                {deleting.visitedCustomers}/{deleting.plannedCustomers}
              </strong>
            </div>
            <div className="metric-row">
              <span>Nhánh phát sinh</span>
              <strong style={{ whiteSpace: "normal", textAlign: "right" }}>
                {branchSummary(deleting)}
              </strong>
            </div>
            {message ? <p className="page-subtitle order-message">{message}</p> : null}
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
