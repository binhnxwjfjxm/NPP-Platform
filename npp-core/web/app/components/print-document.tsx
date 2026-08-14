'use client';

import type { ReactNode } from 'react';
import styles from './print-document.module.css';

export type PrintPageSize = 'A4' | 'A5';

function clearPrintState() {
  document.body.removeAttribute('data-printing');
  document.querySelectorAll('[data-print-active="true"]').forEach((element) => {
    element.removeAttribute('data-print-active');
  });
}

export function PrintAction({
  label = 'In',
  targetId,
}: {
  label?: string;
  targetId?: string;
}) {
  function print() {
    clearPrintState();
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-print-surface]'));
    const target = targetId
      ? surfaces.find((surface) => surface.dataset.printId === targetId)
      : surfaces.length === 1 ? surfaces[0] : null;
    if (!target) return;

    target.setAttribute('data-print-active', 'true');
    document.body.setAttribute('data-printing', 'true');
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      clearPrintState();
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
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
}: {
  children: ReactNode;
  id?: string;
  size?: PrintPageSize;
}) {
  return (
    <section
      className={styles.printSurface}
      data-print-surface
      data-print-id={id}
      data-print-size={size}
    >
      {children}
    </section>
  );
}
