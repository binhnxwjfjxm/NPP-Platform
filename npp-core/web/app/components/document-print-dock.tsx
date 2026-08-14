'use client';

import type { ReactNode } from 'react';
import styles from './document-print-dock.module.css';

export type DocumentPrintOption = {
  id: string;
  label: string;
};

export default function DocumentPrintDock({
  label,
  value,
  options,
  onChange,
  onRefresh,
  refreshing = false,
  children,
}: {
  label: string;
  value: string;
  options: DocumentPrintOption[];
  onChange: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  if (!options.length) return null;

  return (
    <aside className={styles.dock} data-testid="document-print-dock" aria-label="In chứng từ">
      <label className={styles.selector}>
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {onRefresh ? (
        <button
          type="button"
          className={styles.refresh}
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Cập nhật danh sách in"
          title="Cập nhật danh sách in"
        >
          ↻
        </button>
      ) : null}
      {children}
    </aside>
  );
}
