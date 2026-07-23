"use client";

import { useEffect } from "react";

function setValue(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function inputByLabel(labelText: string) {
  return Array.from(document.querySelectorAll<HTMLLabelElement>("label.form-field"))
    .find((label) => label.querySelector("small")?.textContent?.trim() === labelText)
    ?.querySelector("input") as HTMLInputElement | null;
}

function addGpsButton() {
  const lat = inputByLabel("GPS Lat");
  const lng = inputByLabel("GPS Lng");
  const box = lat?.closest(".visit-sheet-content");
  if (!lat || !lng || !box || box.querySelector(".route-gps-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "button primary route-gps-btn";
  btn.textContent = "Lấy định vị hiện tại";
  btn.onclick = () => {
    if (!navigator.geolocation) { btn.textContent = "Không hỗ trợ GPS"; return; }
    btn.textContent = "Đang lấy GPS...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValue(lat, String(pos.coords.latitude));
        setValue(lng, String(pos.coords.longitude));
        btn.textContent = `Đã lấy GPS ±${Math.round(pos.coords.accuracy)}m`;
      },
      () => { btn.textContent = "Không lấy được GPS"; },
      { enableHighAccuracy: true }
    );
  };
  box.insertBefore(btn, lat.closest("label"));
}

function addMapLinks() {
  document.querySelectorAll<HTMLElement>(".operational-list-card").forEach((card) => {
    const actions = card.querySelector(".operational-list-actions");
    if (!actions || actions.querySelector(".route-map-link")) return;
    const buttons = Array.from(actions.querySelectorAll("button")).map((b) => b.textContent?.trim());
    if (!buttons.includes("Xem khách") || !buttons.includes("Sửa")) return;
    const title = card.querySelector("h3")?.textContent?.trim() || "";
    const meta = Array.from(card.querySelectorAll(".operational-list-meta small")).map((s) => s.textContent?.trim() || "");
    const gps = meta.find((v) => /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(v));
    const query = gps || title;
    if (!query) return;
    const link = document.createElement("a");
    link.className = "button route-map-link";
    link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Map";
    actions.insertBefore(link, actions.firstChild);
  });
}

export function RouteCustomerLocationEnhancer() {
  useEffect(() => {
    const run = () => { addGpsButton(); addMapLinks(); };
    run();
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
