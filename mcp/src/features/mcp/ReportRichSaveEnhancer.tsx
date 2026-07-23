"use client";

import { useEffect } from "react";

function reportTextarea(panel: HTMLElement) {
  return panel.parentElement?.querySelector("label.form-field textarea") as HTMLTextAreaElement | null;
}

function syncText(panel: HTMLElement, textarea: HTMLTextAreaElement) {
  const grouped = new Map<string, string[]>();
  Array.from(panel.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")).forEach((input) => {
    const group = input.dataset.group || "Khác";
    const value = input.dataset.value || input.value;
    grouped.set(group, [...(grouped.get(group) || []), value]);
  });
  const lines: string[] = [];
  grouped.forEach((values, group) => lines.push(`${group}: ${values.join(", ")}`));
  Array.from(panel.querySelectorAll<HTMLTextAreaElement>("textarea[data-field]")).forEach((area) => {
    const value = area.value.trim();
    if (value) lines.push(`${area.dataset.label || area.dataset.field || "Ghi chú"}: ${value}`);
  });
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, lines.join("\n"));
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function selected(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")).map((input) => ({
    groupTitle: input.dataset.group || "Khác",
    label: input.dataset.value || input.value
  }));
}

function fields(panel: HTMLElement) {
  const out: Record<string, string> = {};
  Array.from(panel.querySelectorAll<HTMLTextAreaElement>("textarea[data-field]")).forEach((area) => {
    const value = area.value.trim();
    if (value) out[String(area.dataset.field || area.dataset.label || "note")] = value;
  });
  return out;
}

function enhance() {
  document.querySelectorAll<HTMLElement>(".report-quick-panel").forEach((panel) => {
    if (panel.querySelector(".report-rich-save-btn")) return;
    const textarea = reportTextarea(panel);
    if (!textarea) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button primary report-rich-save-btn";
    button.textContent = "Lưu BC đầy đủ";
    button.onclick = async () => {
      syncText(panel, textarea);
      button.disabled = true;
      button.textContent = "Đang lưu BC...";
      try {
        const res = await fetch("/api/mcp-market-reports", {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ reportType: "market_report", content: textarea.value, selected: selected(panel), fields: fields(panel) })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "Không lưu được BC đầy đủ");
        button.textContent = "Đã lưu BC đầy đủ";
      } catch (error) {
        button.disabled = false;
        button.textContent = error instanceof Error ? error.message : "Lỗi lưu BC";
      }
    };
    panel.appendChild(button);
  });
}

export function ReportRichSaveEnhancer() {
  useEffect(() => {
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
