"use client";

import { useEffect, useMemo, useState } from "react";

const API = "/api/backend/mcp-report-settings";
const QUICK_NOTE_ITEMS = ["Chê giá", "Còn tồn", "Cần test", "Muốn đổi nguồn", "Cần báo giá", "Đang dùng đối thủ"];

type ApiItem = { id: string; key?: string; label: string; value?: string; category?: string; brandName?: string; productId?: string };
type ApiGroup = { id: string; key: string; title: string; items: ApiItem[] };
export type MarketReportFieldValues = { priceSummary: string; displaySummary: string; stockSummary: string; demandSummary: string; opportunitySummary: string; riskSummary: string; nextAction: string; note: string };
export type ReportSettingSelection = { id: string; key: string; label: string; value: string; groupKey: string; groupTitle: string; category: string; brandName: string; productId: string };
export type MarketReportDraft = { fields: MarketReportFieldValues; selectedCompetitors: ReportSettingSelection[]; selectedUsedProducts: ReportSettingSelection[]; selectedSettingItems: ReportSettingSelection[] };

const FIELD_DEFS: Array<{ key: keyof MarketReportFieldValues; label: string; compact?: boolean }> = [
  { key: "priceSummary", label: "Giá / lý do", compact: true },
  { key: "demandSummary", label: "Nhu cầu", compact: true },
  { key: "nextAction", label: "Việc tiếp theo", compact: true },
  { key: "note", label: "Ghi chú thêm", compact: true },
  { key: "displaySummary", label: "Trưng bày" },
  { key: "stockSummary", label: "Tồn kho" },
  { key: "opportunitySummary", label: "Cơ hội" },
  { key: "riskSummary", label: "Rủi ro" }
];
const EMPTY_FIELDS: MarketReportFieldValues = { priceSummary: "", displaySummary: "", stockSummary: "", demandSummary: "", opportunitySummary: "", riskSummary: "", nextAction: "", note: "" };
let cachedGroups: ApiGroup[] | null = null;

export function emptyMarketReportDraft(): MarketReportDraft {
  return { fields: { ...EMPTY_FIELDS }, selectedCompetitors: [], selectedUsedProducts: [], selectedSettingItems: [] };
}

function norm(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
}

function isFieldGroup(group: Pick<ApiGroup, "key" | "title">) {
  const text = norm(`${group.key} ${group.title}`);
  return text.includes("report_fields") || text.includes("field");
}

function isCompetitorGroup(group: Pick<ApiGroup, "key" | "title"> | ReportSettingSelection) {
  const text = "groupKey" in group ? norm(`${group.groupKey} ${group.groupTitle}`) : norm(`${group.key} ${group.title}`);
  return text.includes("doi thu") || text.includes("competitor");
}

function isLegacyUsedProductGroup(group: Pick<ApiGroup, "key" | "title">) {
  const text = norm(`${group.key} ${group.title}`);
  return text.includes("sp dang dung") || text.includes("used_product");
}

function selectionFrom(group: ApiGroup, item: ApiItem): ReportSettingSelection {
  return { id: item.id, key: item.key || item.id, label: item.label, value: item.value || item.label, groupKey: group.key, groupTitle: group.title, category: item.category || "", brandName: item.brandName || "", productId: item.productId || "" };
}

function groupedLabels(items: ReportSettingSelection[]) {
  return items.reduce<Record<string, string[]>>((acc, item) => {
    acc[item.groupTitle] = [...(acc[item.groupTitle] || []), item.label];
    return acc;
  }, {});
}

export function buildMarketReportContent(draft: MarketReportDraft) {
  const lines: string[] = [];
  if (draft.selectedCompetitors.length) lines.push(`Đối thủ: ${draft.selectedCompetitors.map((item) => item.label).join(", ")}`);
  Object.entries(groupedLabels(draft.selectedUsedProducts)).forEach(([group, labels]) => lines.push(`${group}: ${labels.join(", ")}`));
  FIELD_DEFS.forEach((field) => {
    const text = draft.fields[field.key].trim();
    if (text) lines.push(`${field.label}: ${text}`);
  });
  return lines.join("\n");
}

export function marketReportHasInput(draft: MarketReportDraft) {
  return buildMarketReportContent(draft).trim().length > 0;
}

async function loadGroups() {
  if (cachedGroups) return cachedGroups;
  const response = await fetch(`${API}?groupType=market_report`, { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Không tải được cài đặt báo cáo");
  cachedGroups = Array.isArray(payload.data?.groups) ? payload.data.groups : [];
  return cachedGroups;
}

function ReportChip({ active, label, disabled, onClick }: { active: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return <button className={active ? "report-chip selected" : "report-chip"} type="button" aria-pressed={active} onClick={onClick} disabled={disabled}>{active ? "✓ " : ""}{label}</button>;
}

function SelectedSummary({ draft }: { draft: MarketReportDraft }) {
  const selected = [...draft.selectedCompetitors, ...draft.selectedUsedProducts];
  const fieldCount = FIELD_DEFS.filter((field) => draft.fields[field.key].trim()).length;
  if (!selected.length && !fieldCount) return null;
  return <div className="report-selected-summary"><strong>Đã ghi nhận</strong><span>{selected.map((item) => item.label).join(", ")}{fieldCount ? `${selected.length ? " · " : ""}${fieldCount} nội dung bổ sung` : ""}</span></div>;
}

export function McpMarketReportFields({ value, onChange, saving }: { value: MarketReportDraft; onChange: (value: MarketReportDraft) => void; saving: boolean }) {
  const [groups, setGroups] = useState<ApiGroup[]>(cachedGroups || []);
  const [loading, setLoading] = useState(!cachedGroups);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadGroups()
      .then((nextGroups) => {
        if (!active) return;
        setGroups(nextGroups || []);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Không tải được lựa chọn báo cáo");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const competitorGroups = useMemo(() => groups.filter((group) => !isFieldGroup(group) && !isLegacyUsedProductGroup(group) && isCompetitorGroup(group) && group.items.length > 0), [groups]);
  const usedProductGroups = useMemo(() => groups.filter((group) => isLegacyUsedProductGroup(group) && group.items.length > 0), [groups]);
  const selectedIds = useMemo(() => new Set(value.selectedSettingItems.map((item) => item.id)), [value.selectedSettingItems]);

  function updateField(key: keyof MarketReportFieldValues, text: string) {
    onChange({ ...value, fields: { ...value.fields, [key]: text } });
  }

  function applySelection(picked: ReportSettingSelection) {
    const nextAll = selectedIds.has(picked.id) ? value.selectedSettingItems.filter((selected) => selected.id !== picked.id) : [...value.selectedSettingItems, picked];
    onChange({
      ...value,
      selectedSettingItems: nextAll,
      selectedCompetitors: nextAll.filter(isCompetitorGroup),
      selectedUsedProducts: nextAll.filter((selected) => !isCompetitorGroup(selected) && selected.groupKey !== "quick_notes")
    });
  }

  function toggle(group: ApiGroup, item: ApiItem) {
    applySelection(selectionFrom(group, item));
  }

  function toggleQuickNote(label: string) {
    const current = value.fields.note.trim();
    const exists = current.split(/[,\n]/).map((x) => x.trim()).includes(label);
    const next = exists ? current.split(/[,\n]/).map((x) => x.trim()).filter((x) => x && x !== label).join(", ") : [current, label].filter(Boolean).join(", ");
    updateField("note", next);
  }

  return <div className="report-popup-grid"><section className="report-quick-panel"><div className="report-section-head"><strong>Quan sát thị trường</strong><small>Ghi nhận nhanh theo điểm bán; Báo cáo phiên sẽ tự tổng hợp đối thủ, sản phẩm đang dùng, cơ hội và rủi ro.</small></div><SelectedSummary draft={value} />{loading ? <p className="page-subtitle">Đang tải lựa chọn...</p> : null}{error ? <p className="page-subtitle order-message">{error}</p> : null}{competitorGroups.map((group) => <div className="report-quick-group" key={group.id}><strong>{group.title || "Đối thủ"}</strong><div className="report-chip-grid">{group.items.map((item) => <ReportChip active={selectedIds.has(item.id)} disabled={saving} key={item.id} label={item.label} onClick={() => toggle(group, item)} />)}</div></div>)}<div className="report-quick-group"><strong>Thương hiệu hoặc sản phẩm điểm bán đang dùng</strong>{usedProductGroups.length ? <div className="report-used-product-groups">{usedProductGroups.map((group) => <div className="report-used-product-group" key={group.id}><span>{group.title}</span><div className="report-chip-grid">{group.items.map((item) => { const selection = selectionFrom(group, item); return <ReportChip active={selectedIds.has(selection.id)} disabled={saving} key={selection.id} label={selection.label} onClick={() => applySelection(selection)} />; })}</div></div>)}</div> : <p className="page-subtitle">Chưa có danh mục gợi ý. Có thể nhập thông tin ở phần ghi thêm quan sát.</p>}</div><div className="report-quick-group"><strong>Ghi chú nhanh</strong><div className="report-chip-grid">{QUICK_NOTE_ITEMS.map((label) => <ReportChip active={value.fields.note.split(/[,\n]/).map((x) => x.trim()).includes(label)} disabled={saving} key={label} label={label} onClick={() => toggleQuickNote(label)} />)}</div></div></section><section className="report-field-panel"><div className="report-section-head"><strong>Ghi thêm quan sát</strong><small>Chỉ nội dung đã nhập mới được lưu và tổng hợp vào báo cáo phiên.</small></div><div className="report-field-grid">{FIELD_DEFS.map((field) => <label className="form-field report-field" key={field.key}><small>{field.label}</small><textarea rows={field.compact ? 2 : 2} value={value.fields[field.key]} onChange={(event) => updateField(field.key, event.target.value)} disabled={saving} /></label>)}</div></section></div>;
}
