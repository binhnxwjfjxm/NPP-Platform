'use client';

import type { ReactNode } from 'react';
import styles from './print-document.module.css';

export type PrintPageSize = 'A4' | 'A5';
export type PrintActionVariant = 'button' | 'text';

function clearPrintState() {
  document.body.removeAttribute('data-printing');
  document.querySelectorAll('[data-print-root="true"]').forEach((element) => element.remove());
  document.querySelectorAll('[data-print-active="true"]').forEach((element) => {
    element.removeAttribute('data-print-active');
  });
  document.querySelectorAll('style[data-print-page-style]').forEach((element) => element.remove());
}

// Page identity belongs to the paper geometry, not the order ID. In particular,
// the root and its first in-flow sheet must share a named page: Chromium can
// otherwise emit an empty default page before the named page.
function pageNameFor(printable: HTMLElement): string {
  const size = printable.dataset.printSize === 'A5' ? 'a5' : 'a4';
  const footer = printable.dataset.printFooter?.trim() ? '-footer' : '';
  const clean = printable.dataset.printSuppressBrowserHeaders === 'true' ? '-clean' : '';
  return `document-${size}${footer}${clean}`;
}

function dynamicPageStyle(printable: HTMLElement): HTMLStyleElement | null {
  if (!printable.dataset.printFooter?.trim()) return null;

  const size: PrintPageSize = printable.dataset.printSize === 'A5' ? 'A5' : 'A4';
  const suppressBrowserHeaders = printable.dataset.printSuppressBrowserHeaders === 'true';
  const pageName = pageNameFor(printable);
  const margin = suppressBrowserHeaders
    ? '0 0 7mm 0'
    : size === 'A5' ? '9mm 8mm 10mm' : '11mm 10mm 12mm';

  if (document.querySelector(`style[data-print-page-style="${pageName}"]`)) return null;
  const style = document.createElement('style');
  style.setAttribute('data-print-page-style', pageName);
  style.textContent = `@media print { @page ${pageName} { size: ${size} portrait; margin: ${margin}; @bottom-right { content: counter(page) "/" counter(pages); font-family: Arial, Helvetica, sans-serif; font-size: 8px; font-weight: 400; line-height: 1; color: #555; } } }`;
  return style;
}

function anchorFirstPage(printable: HTMLElement) {
  const pageName = pageNameFor(printable);
  const style = document.createElement('style');
  style.setAttribute('data-print-page-style', 'root');
  // Scope the page name to print media; normal screen layout is untouched.
  style.textContent = `@media print { body[data-printing='true'] { page: ${pageName}; } }`;
  document.head.appendChild(style);
}

function appendFixedFooterFallback(printRoot: HTMLElement, footerText: string | undefined) {
  const normalizedFooter = footerText?.trim();
  if (!normalizedFooter) return;
  const footer = document.createElement('div');
  footer.className = styles.printFooterFallback;
  footer.setAttribute('data-print-footer-fallback', 'true');
  footer.setAttribute('aria-hidden', 'true');
  footer.textContent = normalizedFooter;
  printRoot.appendChild(footer);
}

function clonePrintSurfaceForOutput(target: HTMLElement): HTMLElement {
  const printable = target.cloneNode(true) as HTMLElement;
  printable.setAttribute('data-print-active', 'true');
  printable.style.setProperty('page', pageNameFor(printable));
  const pageStyle = dynamicPageStyle(printable);
  if (pageStyle) document.head.appendChild(pageStyle);
  return printable;
}

let activePrintCleanup: (() => void) | null = null;

function runPrint(targets: HTMLElement[], documentTitle?: string): boolean {
  if (!targets.length) return false;
  activePrintCleanup?.();
  clearPrintState();
  const previousTitle = document.title;
  const nextTitle = documentTitle?.trim();
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    if (activePrintCleanup !== cleanup) return;
    activePrintCleanup = null;
    clearPrintState();
    if (nextTitle) document.title = previousTitle;
  };
  activePrintCleanup = cleanup;

  try {
    if (nextTitle) document.title = nextTitle;
    const printRoot = document.createElement('div');
    printRoot.setAttribute('data-print-root', 'true');
    anchorFirstPage(targets[0]);
    targets.forEach((target, index) => {
      const printable = clonePrintSurfaceForOutput(target);
      if (index < targets.length - 1) {
        printable.style.breakAfter = 'page';
        printable.style.pageBreakAfter = 'always';
      }
      printRoot.appendChild(printable);
    });
    if (targets.length === 1) {
      const target = targets[0];
      appendFixedFooterFallback(printRoot, target.dataset.printFooter);
    }
    document.body.appendChild(printRoot);
    document.body.setAttribute('data-printing', 'true');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    return true;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function originalPrintSurfaces(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-print-surface]:not([data-print-active])'));
}

export function printSurfacesForOutput(targetIds: string[]): boolean {
  const requested = [...new Set(targetIds.filter(Boolean))];
  if (!requested.length) return false;
  const byId = new Map(originalPrintSurfaces().map((surface) => [surface.dataset.printId ?? '', surface]));
  const targets = requested.map((id) => byId.get(id));
  // Never silently print only a subset of a batch.
  if (targets.some((target) => !target)) return false;
  return runPrint(targets as HTMLElement[]);
}

export function PrintAction({
  label = 'In',
  targetId,
  onPrint,
  variant = 'button',
  documentTitle,
}: {
  label?: string;
  targetId?: string;
  onPrint?: () => void;
  variant?: PrintActionVariant;
  documentTitle?: string;
}) {
  function print() {
    const surfaces = originalPrintSurfaces();
    const target = targetId
      ? surfaces.find((surface) => surface.dataset.printId === targetId)
      : surfaces.length === 1 ? surfaces[0] : null;
    if (target && runPrint([target], documentTitle)) onPrint?.();
  }

  return (
    <button
      type="button"
      className={variant === 'text' ? styles.printActionText : styles.printAction}
      onClick={print}
      data-testid="print-document-action"
      aria-label={label}
    >
      <span aria-hidden="true">⎙</span>
      <span>{label}</span>
    </button>
  );
}

export function PrintSurface({
  children,
  id,
  size = 'A4',
  suppressBrowserHeaders = false,
  narrowMargins = false,
  footerText,
}: {
  children: ReactNode;
  id?: string;
  size?: PrintPageSize;
  suppressBrowserHeaders?: boolean;
  narrowMargins?: boolean;
  footerText?: string;
}) {
  return (
    <section
      className={styles.printSurface}
      data-print-surface
      data-print-id={id}
      data-print-size={size}
      data-print-suppress-browser-headers={suppressBrowserHeaders ? 'true' : undefined}
      data-print-narrow-margins={narrowMargins ? 'true' : undefined}
      data-print-footer={footerText?.trim() || undefined}
    >
      {children}
    </section>
  );
}
