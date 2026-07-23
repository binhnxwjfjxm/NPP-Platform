"use client";

import { useEffect } from "react";

function fireInput(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, String(Math.max(1, value)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function enhanceOrderQuantityInputs() {
  document.querySelectorAll<HTMLInputElement>(".order-summary-row input[inputmode='decimal']").forEach((input) => {
    const label = input.closest("label");
    if (!label || label.classList.contains("order-qty-stepper-ready")) return;
    label.classList.add("order-qty-stepper-ready");

    const wrap = document.createElement("span");
    wrap.className = "order-qty-stepper-wrap";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "order-qty-stepper-btn";
    minus.textContent = "−";
    minus.addEventListener("click", () => fireInput(input, Number(input.value || 1) - 1));

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "order-qty-stepper-btn";
    plus.textContent = "+";
    plus.addEventListener("click", () => fireInput(input, Number(input.value || 1) + 1));

    label.insertBefore(wrap, input);
    wrap.appendChild(minus);
    wrap.appendChild(input);
    wrap.appendChild(plus);
  });
}

export function OrderQuantityStepperEnhancer() {
  useEffect(() => {
    enhanceOrderQuantityInputs();
    const observer = new MutationObserver(enhanceOrderQuantityInputs);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
