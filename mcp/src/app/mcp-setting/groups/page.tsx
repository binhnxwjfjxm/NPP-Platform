"use client";

import Link from "next/link";
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { userFacingError } from "@/lib/ui/user-facing-error";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import styles from "./page.module.css";

type Group = {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
  items: unknown[];
};

type Draft = {
  title: string;
  description: string;
  sortOrder: string;
};

type SheetMode = "create" | "edit";

const emptyDraft: Draft = { title: "", description: "", sortOrder: "0" };

async function requestJson(path: string, init?: RequestInit) {
  const method = String(init?.method || "GET").toUpperCase();
  const requestInit = {
    cache: "no-store" as const,
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  };
  const response =
    method === "POST" || method === "PATCH"
      ? await idempotentMutationFetch(path, requestInit, {
          operation: `report-setting-group.${method.toLowerCase()}`,
        })
      : await fetch(path, requestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || "Không xử lý được nhóm mẫu");
  }
  return payload;
}

export default function Page() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editId, setEditId] = useState("");
  const [sheetMode, setSheetMode] = useState<SheetMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  async function load() {
    try {
      const payload = await requestJson(
        "/api/mcp-report-settings?groupType=market_report&includeInactive=1",
      );
      setGroups(payload.data?.groups || []);
    } catch (error) {
      setMessage(userFacingError(error, "Không tải được nhóm lựa chọn. Vui lòng thử lại."));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!sheetMode) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => titleInputRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) closeSheet();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pending, sheetMode]);

  const summary = useMemo(() => {
    const active = groups.filter((group) => group.status === "active").length;
    const choices = groups.reduce(
      (total, group) => total + (Array.isArray(group.items) ? group.items.length : 0),
      0,
    );
    return { active, choices };
  }, [groups]);

  function openCreate(event: ReactMouseEvent<HTMLButtonElement>) {
    returnFocusRef.current = event.currentTarget;
    setEditId("");
    setDraft(emptyDraft);
    setSheetMode("create");
  }

  function openEdit(group: Group, event: ReactMouseEvent<HTMLButtonElement>) {
    returnFocusRef.current = event.currentTarget;
    setEditId(group.id);
    setDraft({
      title: group.title,
      description: group.description || "",
      sortOrder: String(group.sortOrder || 0),
    });
    setSheetMode("edit");
  }

  function closeSheet() {
    setSheetMode(null);
    setEditId("");
    setDraft(emptyDraft);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => {
      void (async () => {
        try {
          const body = {
            groupId: editId || undefined,
            title: draft.title.trim(),
            description: draft.description.trim(),
            sortOrder: Number(draft.sortOrder || 0),
          };
          await requestJson("/api/mcp-report-setting-groups", {
            method: editId ? "PATCH" : "POST",
            body: JSON.stringify(body),
          });
          setMessage(editId ? "Đã cập nhật nhóm mẫu." : "Đã thêm nhóm mẫu.");
          closeSheet();
          await load();
        } catch (error) {
          setMessage(userFacingError(error, "Không lưu được nhóm lựa chọn. Vui lòng thử lại."));
        }
      })();
    });
  }

  function toggle(group: Group) {
    startTransition(() => {
      void (async () => {
        try {
          await requestJson("/api/mcp-report-setting-groups", {
            method: "PATCH",
            body: JSON.stringify({
              groupId: group.id,
              status: group.status === "active" ? "inactive" : "active",
            }),
          });
          setMessage(group.status === "active" ? "Đã tắt nhóm mẫu." : "Đã bật nhóm mẫu.");
          await load();
        } catch (error) {
          setMessage(
            userFacingError(error, "Không thay đổi được trạng thái nhóm. Vui lòng thử lại."),
          );
        }
      })();
    });
  }

  function renderStatus(group: Group) {
    const active = group.status === "active";
    return (
      <span
        className={`${styles.status} ${active ? styles.statusActive : styles.statusInactive}`}
      >
        {active ? "Đang bật" : "Đã tắt"}
      </span>
    );
  }

  return (
    <AppShell activeHref="/mcp-setting">
      <PageHeader
        eyebrow="Cài đặt MCP"
        title="Nhóm lựa chọn báo cáo"
        subtitle="Quản lý nhóm dùng chung trong báo cáo thị trường."
      >
        <button className="button primary" type="button" onClick={openCreate}>
          Thêm nhóm
        </button>
        <Link className="button" href="/mcp-setting">
          Quay lại lựa chọn
        </Link>
      </PageHeader>

      <section className={styles.summaryBar} aria-label="Tóm tắt nhóm lựa chọn">
        <div className={styles.summaryCopy}>
          <strong>{groups.length} nhóm báo cáo</strong>
          <span>
            {summary.active} đang bật · {summary.choices} lựa chọn
          </span>
        </div>
        <span className={styles.summaryBadge}>{groups.length} nhóm</span>
      </section>

      {message ? (
        <section className={`empty-inline ${styles.notice}`} aria-live="polite">
          <strong>{message}</strong>
        </section>
      ) : null}

      {groups.length ? (
        <>
          <section className={styles.mobileList} aria-label="Danh sách nhóm lựa chọn">
            {groups.map((group) => (
              <article className={styles.groupCard} key={group.id}>
                <div className={styles.groupHead}>
                  <div className={styles.groupCopy}>
                    <strong>{group.title}</strong>
                    <p>{group.description || "Không có mô tả"}</p>
                  </div>
                  {renderStatus(group)}
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.metaChip}>{group.items.length} lựa chọn</span>
                  <span className={styles.metaChip}>Thứ tự {group.sortOrder}</span>
                </div>
                <div className={styles.cardActions}>
                  <button
                    className="button"
                    type="button"
                    onClick={(event) => openEdit(group, event)}
                    aria-label={`Sửa nhóm ${group.title}`}
                    disabled={pending}
                  >
                    Sửa
                  </button>
                  <button
                    className={group.status === "active" ? "button danger" : "button primary"}
                    type="button"
                    onClick={() => toggle(group)}
                    aria-label={`${group.status === "active" ? "Tắt" : "Bật"} nhóm ${group.title}`}
                    disabled={pending}
                  >
                    {group.status === "active" ? "Tắt" : "Bật"}
                  </button>
                </div>
              </article>
            ))}
          </section>

          <section className={styles.desktopTableWrap} aria-label="Bảng nhóm lựa chọn">
            <table className={styles.desktopTable}>
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th>Lựa chọn</th>
                  <th>Thứ tự</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td className={styles.tableName}>
                      <strong>{group.title}</strong>
                      <small>{group.description || "Không có mô tả"}</small>
                    </td>
                    <td>{group.items.length}</td>
                    <td>{group.sortOrder}</td>
                    <td>{renderStatus(group)}</td>
                    <td>
                      <div className={styles.tableActions}>
                        <button
                          className="button"
                          type="button"
                          onClick={(event) => openEdit(group, event)}
                          aria-label={`Sửa nhóm ${group.title}`}
                          disabled={pending}
                        >
                          Sửa
                        </button>
                        <button
                          className={
                            group.status === "active" ? "button danger" : "button primary"
                          }
                          type="button"
                          onClick={() => toggle(group)}
                          aria-label={`${group.status === "active" ? "Tắt" : "Bật"} nhóm ${group.title}`}
                          disabled={pending}
                        >
                          {group.status === "active" ? "Tắt" : "Bật"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <section className={styles.emptyState}>Chưa có nhóm lựa chọn báo cáo.</section>
      )}

      {sheetMode ? (
        <div
          className={styles.sheetBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) closeSheet();
          }}
        >
          <section
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-group-sheet-title"
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <div className={styles.sheetHeader}>
              <div>
                <strong id="report-group-sheet-title">
                  {sheetMode === "edit" ? "Sửa nhóm" : "Thêm nhóm"}
                </strong>
                <p>Tên, mô tả và thứ tự hiển thị của nhóm.</p>
              </div>
              <button
                className={styles.closeButton}
                type="button"
                onClick={closeSheet}
                aria-label="Đóng biểu mẫu nhóm"
                disabled={pending}
              >
                ×
              </button>
            </div>

            <form onSubmit={save}>
              <div className={styles.formGrid}>
                <label className={styles.formField}>
                  <span>Tên nhóm</span>
                  <input
                    ref={titleInputRef}
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="Ví dụ: Sản phẩm đang dùng · Phụ gia"
                    autoComplete="off"
                    required
                  />
                </label>
                <label className={styles.formField}>
                  <span>Mô tả</span>
                  <textarea
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Mô tả nhóm mẫu"
                  />
                </label>
                <label className={styles.formField}>
                  <span>Thứ tự</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={draft.sortOrder}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, sortOrder: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className={styles.sheetActions}>
                <button
                  className="button primary"
                  type="submit"
                  disabled={pending || !draft.title.trim()}
                >
                  {pending
                    ? "Đang lưu…"
                    : sheetMode === "edit"
                      ? "Lưu thay đổi"
                      : "Thêm nhóm"}
                </button>
                <button className="button" type="button" onClick={closeSheet} disabled={pending}>
                  Hủy
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
