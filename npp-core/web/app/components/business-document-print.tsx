'use client';

import type { ReactNode } from 'react';
import { PrintAction, PrintSurface, type PrintPageSize } from './print-document';
import styles from './business-document-print.module.css';

export type BusinessDocumentMeta = {
  label: string;
  value: ReactNode;
  full?: boolean;
};

export type BusinessDocumentColumn = {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
};

export type BusinessDocumentRow = {
  id: string;
  cells: Record<string, ReactNode>;
};

export type BusinessDocumentTotal = {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
};

export default function BusinessDocumentPrint({
  id,
  actionLabel = 'In',
  title,
  subtitle = 'Chứng từ nghiệp vụ',
  number,
  status,
  meta,
  columns = [],
  rows = [],
  totals = [],
  note,
  signatures = ['Người lập', 'Bộ phận liên quan', 'Đối tác / Khách hàng'],
  size = 'A4',
  testId,
}: {
  id: string;
  actionLabel?: string;
  title: string;
  subtitle?: string;
  number: ReactNode;
  status?: ReactNode;
  meta: BusinessDocumentMeta[];
  columns?: BusinessDocumentColumn[];
  rows?: BusinessDocumentRow[];
  totals?: BusinessDocumentTotal[];
  note?: ReactNode;
  signatures?: string[];
  size?: PrintPageSize;
  testId?: string;
}) {
  return (
    <>
      <PrintAction label={actionLabel} targetId={id} />
      <PrintSurface id={id} size={size}>
        <article className={styles.sheet} data-testid={testId}>
          <header className={styles.header}>
            <div className={styles.brandBlock}>
              <strong className={styles.brand}>HƯNG PHÁT</strong>
              <p>{subtitle}</p>
            </div>
            <div className={styles.titleBlock}>
              <h1>{title}</h1>
              <p>Số: <strong>{number}</strong></p>
              {status ? <span className={styles.status}>{status}</span> : null}
            </div>
          </header>

          <section className={styles.metaGrid}>
            {meta.map((item, index) => (
              <div key={`${item.label}-${index}`} className={`${styles.metaItem} ${item.full ? styles.full : ''}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </section>

          {columns.length && rows.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={column.align === 'right' ? styles.right : column.align === 'center' ? styles.center : undefined}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.align === 'right' ? styles.right : column.align === 'center' ? styles.center : undefined}
                      >
                        {row.cells[column.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {totals.length ? (
            <section className={styles.summary}>
              {totals.map((total, index) => (
                <div key={`${total.label}-${index}`} className={`${styles.summaryRow} ${total.emphasis ? styles.emphasis : ''}`}>
                  <span>{total.label}</span>
                  <strong>{total.value}</strong>
                </div>
              ))}
            </section>
          ) : null}

          {note ? <section className={styles.note}><strong>Ghi chú:</strong> {note}</section> : null}

          <footer className={styles.signatures}>
            {signatures.map((signature) => (
              <div key={signature}>
                <strong>{signature}</strong>
                <span>(Ký, ghi rõ họ tên)</span>
              </div>
            ))}
          </footer>

          <p className={styles.footer}>Bản in từ Hệ thống Công Ty — dữ liệu theo chứng từ đang hiển thị; thao tác in không làm thay đổi nghiệp vụ.</p>
        </article>
      </PrintSurface>
    </>
  );
}
