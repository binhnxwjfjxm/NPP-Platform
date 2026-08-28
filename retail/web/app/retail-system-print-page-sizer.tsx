'use client';

import { useEffect } from 'react';

const CSS_PIXELS_PER_INCH = 96;
const MILLIMETERS_PER_INCH = 25.4;
const THERMAL_HEIGHT_SAFETY_MM = 1;

function thermalWidthMm(screen: HTMLElement | null) {
  if (screen?.classList.contains('paper-80')) return 80;
  if (screen?.classList.contains('paper-58')) return 58;
  return null;
}

function sizeCurrentThermalPage() {
  const pageStyle = document.head.querySelector<HTMLStyleElement>('style[data-retail-print-page="true"]');
  const printDocument = document.querySelector<HTMLElement>('.print-screen .print-document');
  const printScreen = printDocument?.closest<HTMLElement>('.print-screen') ?? null;
  const widthMm = thermalWidthMm(printScreen);
  if (!pageStyle || !printDocument || !widthMm) return;

  const renderedHeightPx = printDocument.getBoundingClientRect().height;
  if (!Number.isFinite(renderedHeightPx) || renderedHeightPx <= 0) return;

  const heightMm = Math.ceil(
    (renderedHeightPx * MILLIMETERS_PER_INCH) / CSS_PIXELS_PER_INCH + THERMAL_HEIGHT_SAFETY_MM,
  );
  pageStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 4mm; }`;
}

export function RetailSystemPrintPageSizer() {
  useEffect(() => {
    sizeCurrentThermalPage();
    const observer = new MutationObserver(() => sizeCurrentThermalPage());
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
