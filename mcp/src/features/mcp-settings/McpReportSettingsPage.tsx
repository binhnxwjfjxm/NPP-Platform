"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AppShell } from "@/ui/shell/AppShell";
import { PageHeader } from "@/ui/layout/PageHeader";
import { userFacingError } from "@/lib/ui/user-facing-error";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import styles from "./McpReportSettingsPage.module.css";

const REPORT_SETTINGS_API = "/api/mcp-report-settings";

type SettingItem = {
  id: string;
  key: string;
  label: string;
  value: string;
  category: string;
  brandName: string;
  status: string;
  sortOrder: number;
};

type SettingGroup = {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
  items: SettingItem[];
};

type Draft = {
  label: string;
  value: string;
  category: string;
  brandName: string;
  sortOrder: string;
};

type DraftFieldsProps = {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  autoFocus?: boolean;
};

const emptyDraft: Draft = { label: "", value: "", category: "", brandName: "", sortOrder: "0" };

function draftFor(item: SettingItem): Draft {
  return {
    label: item.label,
    value: item.value,
    category: item.category,
    brandName: item.brandName,
    sortOrder: String(item.sortOrder || 0)
  };
}

function DraftFields({ draft, onChange, autoFocus = false }: DraftFieldsProps) {
  return (
    <div className={styles.formGrid}>
      <label className="form-field">
        <small>Tên mẫu</small>
        <input
          autoFocus={autoFocus}
          value={draft.label}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Nhập tên đối thủ, thương hiệu hoặc lựa chọn"
        />
      </label>
      <label className="form-field">
        <small>Giá trị lưu</small>
        <input
          value={draft.value}
          onChange={(event) => onChange({ value: event.target.value })}
          placeholder="Bỏ trống sẽ lấy theo tên mẫu"
        />
      </label>
      <label className="form-field">
        <small>Nhóm sản phẩm</small>
        <input
          value={draft.category}
          onChange={(event) => onChange({ category: event.target.value })}
          placeholder="Siro / Sinh tố / Trà / Sữa / Topping"
        />
      </label>
      <label className="form-field">
        <small>Thương hiệu</small>
        <input
          value={draft.brandName}
          onChange={(event) => onChange({ brandName: event.target.value })}
          placeholder="Mama / Vina / Berrino..."
        />
      </label>
      <label className="form-field">
        <small>Thứ tự</small>
        <input
          inputMode="numeric"
          value={draft.sortOrder}
          onChange={(event) => onChange({ sortOrder: event.target.value })}
        />
      </label>
    </div>
  );
}

function appScrollRegion() {
  const node = document.querySelector("[data-app-scroll-region]");
  return node instanceof HTMLElement ? node : null;
}

function restoreAppScroll(top: number) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const node = appScrollRegion();
      if (node) node.scrollTop = top;
    });
  });
}

async function requestJson(path: string, init?: RequestInit) {
  const method = String(init?.method || "GET").toUpperCase();
  const requestInit = {
    cache: "no-store" as const,
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) }
  };
  const response = method === "POST" || method === "PATCH"
    ? await idempotentMutationFetch(path, requestInit, { operation: `report-setting-item.${method.toLowerCase()}` })
    : await fetch(path, requestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || payload.message || "Không xử lý được cài đặt mẫu");
  return payload;
}

function statusText(status: string) {
  return status === "active" ? "Đang bật" : "Đã tắt";
}

export function McpReportSettingsPage({ activeHref = "/mcp-setting" }: { activeHref?: string }) {
  const [groups, setGroups] = useState<SettingGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft);
  const [editingItem, setEditingItem] = useState<SettingItem | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const dialogScrollTopRef = useRef(0);

  const activeGroup = useMemo(() => groups.find((group) => group.id === activeGroupId) || groups[0], [groups, activeGroupId]);
  const activeItems = activeGroup?.items || [];
  const activeCount = activeItems.filter((item) => item.status === "active").length;
  const dialogMode = creating ? "create" : editingItem ? "edit" : null;

  async function loadSettings({ showLoading = true }: { showLoading?: boolean } = {}) {
    if (showLoading) setLoading(true);
    try {
      const payload = await requestJson(`${REPORT_SETTINGS_API}?groupType=market_report&includeInactive=1`);
      const nextGroups = (payload.data?.groups || []) as SettingGroup[];
      setGroups(nextGroups);
      setActiveGroupId((current) => nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id || "");
    } catch (error) {
      setMessage(userFacingError(error, "Không tải được cài đặt báo cáo. Vui lòng thử lại."));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!dialogMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) closeDialog();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dialogMode, pending]);

  function openCreator() {
    dialogScrollTopRef.current = appScrollRegion()?.scrollTop || 0;
    setMessage(null);
    setEditingItem(null);
    setEditDraft(emptyDraft);
    setCreateDraft(emptyDraft);
    setCreating(true);
  }

  function openEditor(item: SettingItem) {
    dialogScrollTopRef.current = appScrollRegion()?.scrollTop || 0;
    setMessage(null);
    setCreating(false);
    setCreateDraft(emptyDraft);
    setEditingItem(item);
    setEditDraft(draftFor(item));
  }

  function closeDialog() {
    if (pending) return;
    const scrollTop = dialogScrollTopRef.current;
    setCreating(false);
    setEditingItem(null);
    setCreateDraft(emptyDraft);
    setEditDraft(emptyDraft);
    setMessage(null);
    restoreAppScroll(scrollTop);
  }

  function saveNewItem() {
    if (!activeGroup) return;
    const scrollTop = dialogScrollTopRef.current;
    startTransition(() => {
      void (async () => {
        try {
          setMessage(null);
          await requestJson(REPORT_SETTINGS_API, {
            method: "POST",
            body: JSON.stringify({
              groupId: activeGroup.id,
              label: createDraft.label,
              value: createDraft.value || createDraft.label,
              category: createDraft.category,
              brandName: createDraft.brandName,
              sortOrder: Number(createDraft.sortOrder || 0)
            })
          });
          await loadSettings({ showLoading: false });
          setCreating(false);
          setCreateDraft(emptyDraft);
          setMessage("Đã thêm mẫu mới.");
          restoreAppScroll(scrollTop);
        } catch (error) {
          setMessage(userFacingError(error, "Không thêm được lựa chọn. Vui lòng thử lại."));
        }
      })();
    });
  }

  function saveEditedItem() {
    if (!editingItem) return;
    const scrollTop = dialogScrollTopRef.current;
    startTransition(() => {
      void (async () => {
        try {
          setMessage(null);
          await requestJson(REPORT_SETTINGS_API, {
            method: "PATCH",
            body: JSON.stringify({
              itemId: editingItem.id,
              label: editDraft.label,
              value: editDraft.value || editDraft.label,
              category: editDraft.category,
              brandName: editDraft.brandName,
              sortOrder: Number(editDraft.sortOrder || 0)
            })
          });
          await loadSettings({ showLoading: false });
          setEditingItem(null);
          setEditDraft(emptyDraft);
          setMessage("Đã cập nhật mẫu.");
          restoreAppScroll(scrollTop);
        } catch (error) {
          setMessage(userFacingError(error, "Không cập nhật được lựa chọn. Vui lòng thử lại."));
        }
      })();
    });
  }

  function toggleItem(item: SettingItem) {
    const scrollTop = appScrollRegion()?.scrollTop || 0;
    startTransition(() => {
      void (async () => {
        try {
          setMessage(null);
          const nextStatus = item.status === "active" ? "inactive" : "active";
          await requestJson(REPORT_SETTINGS_API, {
            method: "PATCH",
            body: JSON.stringify({ itemId: item.id, status: nextStatus })
          });
          await loadSettings({ showLoading: false });
          setMessage(nextStatus === "active" ? "Đã bật lựa chọn." : "Đã tắt lựa chọn.");
          restoreAppScroll(scrollTop);
        } catch (error) {
          setMessage(userFacingError(error, "Không thay đổi được trạng thái. Vui lòng thử lại."));
        }
      })();
    });
  }

  const dialogDraft = dialogMode === "create" ? createDraft : editDraft;
  const updateDialogDraft = (patch: Partial<Draft>) => {
    if (dialogMode === "create") setCreateDraft((current) => ({ ...current, ...patch }));
    else setEditDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <AppShell activeHref={activeHref}>
      <PageHeader eyebrow="Cài đặt MCP" title="Lựa chọn nhanh cho báo cáo thị trường" />

      <section className={styles.introCard} aria-label="Hướng dẫn cài đặt mẫu báo cáo">
        <span className={styles.introIcon} aria-hidden="true">i</span>
        <div className={styles.introCopy}>
          <strong>Quản lý mẫu dùng chung</strong>
          <p>Đối thủ, sản phẩm đang dùng và nội dung ghi nhận được dùng thống nhất cho nhân viên.</p>
          <small>Các lựa chọn đang bật sẽ xuất hiện trong biểu mẫu báo cáo của mọi tuyến.</small>
        </div>
      </section>

      {!dialogMode && message ? <p className="page-subtitle order-message" role="status">{message}</p> : null}

      <div className={styles.filterRail} role="tablist" aria-label="Nhóm mẫu báo cáo">
        {groups.map((group) => {
          const count = group.items.filter((item) => item.status === "active").length;
          const selected = activeGroup?.id === group.id;
          return (
            <button
              className={`${styles.filterChip} ${selected ? styles.filterChipActive : ""}`}
              key={group.id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={group.title}
              onClick={() => setActiveGroupId(group.id)}
            >
              <span>{group.title}</span>
              <b>{count}</b>
            </button>
          );
        })}
      </div>

      <section className={styles.groupToolbar}>
        <div className={styles.groupSummary}>
          <div className={styles.groupTitleRow}>
            <strong>{activeGroup?.title || "Đang tải..."}</strong>
            <span className={styles.countPill}>{activeCount}/{activeItems.length} bật</span>
          </div>
          <p>{activeGroup?.description || "Chọn nhóm mẫu để quản lý lựa chọn."}</p>
        </div>
        <button
          className={styles.addButton}
          type="button"
          onClick={openCreator}
          disabled={pending || loading || !activeGroup}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">＋</span>
          Thêm mẫu
        </button>
      </section>

      <section className={styles.itemList}>
        {loading ? <div className="empty-inline"><strong>Đang tải mẫu...</strong></div> : null}
        {!loading && activeItems.length === 0 ? <div className="empty-inline"><strong>Chưa có mẫu</strong><p className="page-subtitle">Thêm mẫu đầu tiên cho nhóm này.</p></div> : null}
        {activeItems.map((item) => {
          const active = item.status === "active";
          return (
            <article className={styles.itemCard} key={item.id} data-setting-item>
              <div className={styles.itemHeading}>
                <strong title={item.label}>{item.label}</strong>
                <span className={`${styles.statusPill} ${active ? styles.statusActive : styles.statusInactive}`}>
                  <i aria-hidden="true" />
                  {statusText(item.status)}
                </span>
              </div>
              <p className={styles.itemMeta} title={`${item.category || "Không nhóm"} · ${item.brandName || "Chưa có thương hiệu"} · thứ tự ${item.sortOrder}`}>
                {item.category || "Không nhóm"} · {item.brandName || "Chưa có thương hiệu"} · thứ tự {item.sortOrder}
              </p>
              <div className={styles.itemActions}>
                <button className={styles.actionButton} type="button" onClick={() => openEditor(item)} disabled={pending} aria-label="Sửa" title="Sửa">
                  <span aria-hidden="true">✎</span>
                </button>
                <button
                  className={`${styles.actionButton} ${active ? styles.actionDanger : styles.actionEnable}`}
                  type="button"
                  onClick={() => toggleItem(item)}
                  disabled={pending}
                  aria-label={active ? "Tắt" : "Bật"}
                  title={active ? "Tắt" : "Bật"}
                >
                  <span aria-hidden="true">{active ? "⏻" : "✓"}</span>
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {dialogMode ? (
        <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="mcp-setting-dialog-title" aria-describedby="mcp-setting-dialog-description">
            <header className={styles.header}>
              <div>
                <h2 id="mcp-setting-dialog-title">{dialogMode === "create" ? "Thêm mẫu" : "Sửa lựa chọn"}</h2>
                <p id="mcp-setting-dialog-description">
                  {dialogMode === "create"
                    ? `Thêm lựa chọn vào nhóm “${activeGroup?.title || "đang chọn"}”.`
                    : `Chỉnh trực tiếp “${editingItem?.label || "lựa chọn"}”, không làm thay đổi vị trí đang xem.`}
                </p>
              </div>
              <button className={styles.close} type="button" onClick={closeDialog} disabled={pending} aria-label="Đóng cửa sổ">×</button>
            </header>

            <div className={styles.body}>
              {message ? <p className="page-subtitle order-message" role="status">{message}</p> : null}
              <DraftFields draft={dialogDraft} onChange={updateDialogDraft} autoFocus />
            </div>

            <footer className={styles.actions}>
              <button
                className="button primary"
                type="button"
                onClick={dialogMode === "create" ? saveNewItem : saveEditedItem}
                disabled={pending || !dialogDraft.label.trim()}
                aria-busy={pending}
              >
                {pending ? "Đang lưu..." : dialogMode === "create" ? "Thêm mẫu" : "Cập nhật"}
              </button>
              <button className="button" type="button" onClick={closeDialog} disabled={pending}>Hủy</button>
            </footer>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
