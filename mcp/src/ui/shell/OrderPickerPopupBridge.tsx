"use client";

import { useEffect } from "react";

function closePicker(root: Element | null) {
  root?.classList.remove("product-picker-popup-open");
  root?.classList.remove("product-filter-open");
}

function openPicker(root: Element | null) {
  root?.classList.add("product-picker-popup-open");
  root?.classList.remove("product-filter-open");
}

function toggleFilter(root: Element | null) {
  root?.classList.toggle("product-filter-open");
}

function selectedVariantText(root: Element | null) {
  const activeVariant = root?.querySelector(".variant-chip.active strong")?.textContent?.trim();
  const activeProduct = root?.querySelector(".product-card.active strong")?.textContent?.trim();
  if (activeVariant && activeProduct) return `Đã chọn: ${activeProduct} · ${activeVariant}`;
  if (activeProduct) return `Đã chọn sản phẩm: ${activeProduct}`;
  return "Chọn sản phẩm rồi tick vị/quy cách";
}

export function OrderPickerPopupBridge() {
  useEffect(() => {
    function syncStatus(root: Element | null) {
      const status = root?.querySelector(".order-picker-selected-status");
      if (status) status.textContent = selectedVariantText(root);
    }

    function ensureControls() {
      document.querySelectorAll(".order-action-content .order-builder-compact").forEach((builder) => {
        const root = builder.closest(".order-action-content");
        if (!builder.querySelector(".order-open-picker-button")) {
          const trigger = document.createElement("button");
          trigger.type = "button";
          trigger.className = "button primary order-open-picker-button";
          trigger.textContent = "Chọn sản phẩm / vị";
          trigger.addEventListener("click", () => openPicker(root));

          const mainGrid = builder.querySelector(".order-main-grid");
          builder.insertBefore(trigger, mainGrid || builder.firstChild);
        }

        if (!builder.querySelector(".order-picker-popup-close")) {
          const close = document.createElement("button");
          close.type = "button";
          close.className = "order-picker-popup-close";
          close.setAttribute("aria-label", "Đóng chọn sản phẩm");
          close.textContent = "×";
          close.addEventListener("click", () => closePicker(root));
          builder.appendChild(close);
        }

        if (!builder.querySelector(".order-picker-filter-toggle")) {
          const filterToggle = document.createElement("button");
          filterToggle.type = "button";
          filterToggle.className = "button order-picker-filter-toggle";
          filterToggle.textContent = "Chọn nhóm ▾";
          filterToggle.addEventListener("click", () => toggleFilter(root));

          const catalogStrip = builder.querySelector(".catalog-strip");
          if (catalogStrip?.parentNode) catalogStrip.parentNode.insertBefore(filterToggle, catalogStrip);
        }

        if (!builder.querySelector(".order-picker-done-bar")) {
          const doneBar = document.createElement("div");
          doneBar.className = "order-picker-done-bar";

          const status = document.createElement("span");
          status.className = "order-picker-selected-status";
          status.textContent = selectedVariantText(root);

          const done = document.createElement("button");
          done.type = "button";
          done.className = "button primary order-picker-done-button";
          done.textContent = "Xong, nhập SL";
          done.addEventListener("click", () => closePicker(root));

          doneBar.appendChild(status);
          doneBar.appendChild(done);
          builder.appendChild(doneBar);
        }

        syncStatus(root);
      });
    }

    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      const root = target.closest(".order-action-content");
      if (!root) return;

      if (target.closest(".catalog-chip")) {
        window.setTimeout(() => root.classList.remove("product-filter-open"), 120);
      }
      if (target.closest(".product-card") || target.closest(".variant-chip")) {
        window.setTimeout(() => syncStatus(root), 120);
      }
      if (target.classList.contains("product-picker-popup-open")) {
        closePicker(root);
      }
    }

    ensureControls();
    document.addEventListener("click", onClick);
    const observer = new MutationObserver(ensureControls);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => {
      document.removeEventListener("click", onClick);
      observer.disconnect();
    };
  }, []);

  return null;
}
