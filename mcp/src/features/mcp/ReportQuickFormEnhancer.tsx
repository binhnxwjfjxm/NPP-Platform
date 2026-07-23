"use client";

import { useEffect } from "react";

type ApiItem = { label: string; value?: string; category?: string; brandName?: string };
type ApiGroup = { title: string; key: string; items: ApiItem[] };

let cachedGroups: ApiGroup[] | null = null;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function reportTextarea() {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>("label.form-field"));
  return labels.find((label) => label.querySelector("small")?.textContent?.trim() === "Nội dung báo cáo")?.querySelector("textarea") as HTMLTextAreaElement | null;
}

function buildText(panel: HTMLElement) {
  const checked = Array.from(panel.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked"));
  const grouped = new Map<string, string[]>();
  checked.forEach((input) => {
    const group = input.dataset.group || "Khác";
    const value = input.dataset.value || input.value;
    grouped.set(group, [...(grouped.get(group) || []), value]);
  });
  const notes = Array.from(panel.querySelectorAll<HTMLTextAreaElement>("textarea[data-field]"))
    .map((textarea) => ({ label: textarea.dataset.label || "Ghi chú", value: textarea.value.trim() }))
    .filter((item) => item.value);
  const lines: string[] = [];
  grouped.forEach((values, group) => lines.push(`${group}: ${values.join(", ")}`));
  notes.forEach((item) => lines.push(`${item.label}: ${item.value}`));
  return lines.join("\n");
}

function sync(panel: HTMLElement, textarea: HTMLTextAreaElement) {
  const value = buildText(panel);
  if (value) setTextareaValue(textarea, value);
}

function fieldName(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("giá")) return "Giá";
  if (lower.includes("trưng")) return "Trưng bày";
  if (lower.includes("tồn")) return "Tồn kho";
  if (lower.includes("nhu")) return "Nhu cầu";
  if (lower.includes("cơ hội")) return "Cơ hội";
  if (lower.includes("rủi")) return "Rủi ro";
  if (lower.includes("next")) return "Việc tiếp theo";
  return label;
}

function renderPanel(groups: ApiGroup[], textarea: HTMLTextAreaElement) {
  const host = textarea.closest(".visit-sheet-content");
  if (!host || host.querySelector(".report-quick-panel")) return;
  const panel = document.createElement("section");
  panel.className = "card report-quick-panel";
  panel.style.padding = "10px";
  panel.style.display = "grid";
  panel.style.gap = "10px";
  panel.innerHTML = `<div><strong>Ghi nhận nhanh</strong><p class="page-subtitle" style="margin:4px 0 0">Các lựa chọn được thiết lập dùng chung cho báo cáo thị trường.</p></div>`;
  groups.forEach((group) => {
    const box = document.createElement("div");
    box.className = "report-quick-group";
    const title = document.createElement("strong");
    title.textContent = group.title;
    box.appendChild(title);
    const isFieldGroup = group.key === "report_fields" || group.title.toLowerCase().includes("field");
    if (isFieldGroup) {
      group.items.forEach((item) => {
        const wrap = document.createElement("label");
        wrap.className = "form-field";
        wrap.innerHTML = `<small>${fieldName(item.label)}</small>`;
        const area = document.createElement("textarea");
        area.dataset.field = item.value || item.label;
        area.dataset.label = fieldName(item.label);
        area.placeholder = `Nhập ${fieldName(item.label).toLowerCase()}`;
        area.addEventListener("input", () => sync(panel, textarea));
        wrap.appendChild(area);
        box.appendChild(wrap);
      });
    } else {
      const chips = document.createElement("div");
      chips.className = "mcp-status-chips";
      group.items.forEach((item) => {
        const label = document.createElement("label");
        label.className = "button";
        label.style.display = "inline-flex";
        label.style.gap = "6px";
        label.style.alignItems = "center";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.group = group.title;
        input.dataset.value = item.label;
        input.addEventListener("change", () => sync(panel, textarea));
        label.appendChild(input);
        label.appendChild(document.createTextNode(item.label));
        chips.appendChild(label);
      });
      box.appendChild(chips);
    }
    panel.appendChild(box);
  });
  host.insertBefore(panel, textarea.closest("label.form-field"));
}

async function loadGroups(): Promise<ApiGroup[]> {
  if (cachedGroups) return cachedGroups;
  const res = await fetch("/api/mcp-report-settings?groupType=market_report", { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await res.json().catch(() => ({}));
  cachedGroups = payload.data?.groups || [];
  return cachedGroups || [];
}

async function enhanceReportForm() {
  const textarea = reportTextarea();
  if (!textarea) return;
  try {
    const groups = await loadGroups();
    renderPanel(groups, textarea);
  } catch {
    return;
  }
}

export function ReportQuickFormEnhancer() {
  useEffect(() => {
    const run = () => { void enhanceReportForm(); };
    run();
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
