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

function safePageSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'print';
}

function dynamicPageStyle(printable: HTMLElement, suffix: string): HTMLStyleElement | null {
  const footerText = printable.dataset.printFooter?.trim();
  if (!footerText) return null;

  const size: PrintPageSize = printable.dataset.printSize === 'A5' ? 'A5' : 'A4';
  const suppressBrowserHeaders = printable.dataset.printSuppressBrowserHeaders === 'true';
  const pageName = `document-${size.toLowerCase()}-${safePageSuffix(suffix)}`;
  const margin = suppressBrowserHeaders
    ? '0 0 7mm 0'
    : size === 'A5' ? '9mm 8mm 10mm' : '11mm 10mm 12mm';

  printable.style.setProperty('page', pageName);
  const style = document.createElement('style');
  style.setAttribute('data-print-page-style', pageName);
  style.textContent = `@media print { @page ${pageName} { size: ${size} portrait; margin: ${margin}; @bottom-right { content: counter(page) "/" counter(pages); font-family: Arial, Helvetica, sans-serif; font-size: 8px; font-weight: 400; line-height: 1; color: #555; } } }`;
  return style;
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

export function clonePrintSurfaceForOutput(target: HTMLElement, suffix = crypto.randomUUID()): HTMLElement {
  const printable = target.cloneNode(true) as HTMLElement;
  printable.setAttribute('data-print-active', 'true');
  const pageStyle = dynamicPageStyle(printable, suffix);
  if (pageStyle) document.head.appendChild(pageStyle);
  return printable;
}

export function PrintAction({
  label = 'In',
  targetId,
  onPrint,
  variant = 'button',
}: {
  label?: string;
  targetId?: string;
  onPrint?: () => void;
  variant?: PrintActionVariant;
}) {
  function print() {
    clearPrintState();
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-print-surface]'));
    const target = targetId
      ? surfaces.find((surface) => surface.dataset.printId === targetId)
      : surfaces.length === 1 ? surfaces[0] : null;
    if (!target) return;

    const printRoot = document.createElement('div');
    printRoot.setAttribute('data-print-root', 'true');
    const printable = clonePrintSurfaceForOutput(target);
    printRoot.appendChild(printable);
    appendFixedFooterFallback(printRoot, target.dataset.printFooter);
    document.body.appendChild(printRoot);
    document.body.setAttribute('data-printing', 'true');

    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      clearPrintState();
    };
    window.addEventListener('afterprint', cleanup, { once: true });

    try {
      window.print();
      onPrint?.();
    } catch (error) {
      cleanup();
      throw error;
    }
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
