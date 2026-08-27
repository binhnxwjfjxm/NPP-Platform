'use client';

import type { ReactNode } from 'react';
import styles from './print-document.module.css';

export type PrintPageSize = 'A4' | 'A5';

function clearPrintState() {
  document.body.removeAttribute('data-printing');
  document.querySelectorAll('[data-print-root="true"]').forEach((element) => element.remove());
  document.querySelectorAll('[data-print-active="true"]').forEach((element) => {
    element.removeAttribute('data-print-active');
  });
}

export function PrintAction({
  label = 'In',
  targetId,
  onPrint,
}: {
  label?: string;
  targetId?: string;
  onPrint?: () => void;
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
    const printable = target.cloneNode(true) as HTMLElement;
    printable.setAttribute('data-print-active', 'true');
    printRoot.appendChild(printable);
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
      className={styles.printAction}
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
}: {
  children: ReactNode;
  id?: string;
  size?: PrintPageSize;
  suppressBrowserHeaders?: boolean;
}) {
  return (
    <section
      className={styles.printSurface}
      data-print-surface
      data-print-id={id}
      data-print-size={size}
      data-print-suppress-browser-headers={suppressBrowserHeaders ? 'true' : undefined}
    >
      {children}
    </section>
  );
}
