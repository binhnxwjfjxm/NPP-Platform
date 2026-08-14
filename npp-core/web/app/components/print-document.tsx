'use client';

import type { ReactNode } from 'react';
import styles from './print-document.module.css';

export function PrintAction({ label = 'In' }: { label?: string }) {
  return (
    <button
      type="button"
      className={styles.printAction}
      onClick={() => window.print()}
      data-testid="print-document-action"
      aria-label={label}
    >
      <span aria-hidden="true">⎙</span>
      <span>{label}</span>
    </button>
  );
}

export function PrintSurface({ children }: { children: ReactNode }) {
  return <section className={styles.printSurface} data-print-surface>{children}</section>;
}
