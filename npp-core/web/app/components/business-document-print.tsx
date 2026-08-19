'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PrintAction, PrintSurface, type PrintPageSize } from './print-document';
import type { DocumentPrintTemplate } from '../../lib/document-print-template-types';
import styles from './business-document-print.module.css';

export type BusinessDocumentMeta = {
  key: string;
  label: string;
  value: ReactNode;
  full?: boolean;
};

export type BusinessDocumentColumn = {
  key: string;
  fieldKey?: string;
  label: string;
  align?: 'left' | 'center' | 'right';
};

export type BusinessDocumentRow = {
  id: string;
  cells: Record<string, ReactNode>;
};

export type BusinessDocumentTotal = {
  key: string;
  label: string;
  value: ReactNode;
  emphasis?: boolean;
};

export default function BusinessDocumentPrint({
  id,
  documentType,
  templateCode = 'standard',
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
  onPrint,
}: {
  id: string;
  documentType?: string;
  templateCode?: string;
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
  onPrint?: () => void;
}) {
  const [template, setTemplate] = useState<DocumentPrintTemplate | null>(null);
  const defaultKeys = new Set(['status', ...meta.map((item) => item.key), ...columns.map((item) => item.fieldKey ?? item.key), ...totals.map((item) => item.key), 'note', 'signatures']);

  useEffect(() => {
    setTemplate(null);
    if (!documentType) return undefined;
    let active = true;
    void fetch('/api/document-print-templates', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { data?: DocumentPrintTemplate[] };
        return payload.data?.find((item) => item.documentType === documentType && item.templateCode === templateCode) ?? null;
      })
      .then((next) => { if (active) setTemplate(next); })
      .catch(() => { if (active) setTemplate(null); });
    return () => { active = false; };
  }, [documentType, templateCode]);

  const visibleKeys = template ? new Set(template.visibleFieldKeys) : defaultKeys;
  const visibleMeta = meta.filter((item) => visibleKeys.has(item.key));
  const visibleColumns = columns.filter((item) => visibleKeys.has(item.fieldKey ?? item.key));
  const visibleTotals = totals.filter((item) => visibleKeys.has(item.key));

  return (
    <>
      <PrintAction label={actionLabel} targetId={id} onPrint={onPrint} />
      <PrintSurface id={id} size={template?.pageSize ?? size}>
        <article className={styles.sheet} data-testid={testId}>
          <header className={styles.header}>
            <div className={styles.brandBlock}>
              <strong className={styles.brand}>HƯNG PHÁT</strong>
              <p>{subtitle}</p>
            </div>
            <div className={styles.titleBlock}>
              <h1>{title}</h1>
              <p>Số: <strong>{number}</strong></p>
              {status && visibleKeys.has('status') ? <span className={styles.status}>{status}</span> : null}
            </div>
          </header>

          <section className={styles.metaGrid}>
            {visibleMeta.map((item) => (
              <div key={item.key} className={`${styles.metaItem} ${item.full ? styles.full : ''}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </section>

          {visibleColumns.length && rows.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
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
                    {visibleColumns.map((column) => (
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

          {visibleTotals.length ? (
            <section className={styles.summary}>
              {visibleTotals.map((total) => (
                <div key={total.key} className={`${styles.summaryRow} ${total.emphasis ? styles.emphasis : ''}`}>
                  <span>{total.label}</span>
                  <strong>{total.value}</strong>
                </div>
              ))}
            </section>
          ) : null}

          {note && visibleKeys.has('note') ? <section className={styles.note}><strong>Ghi chú:</strong> {note}</section> : null}

          {visibleKeys.has('signatures') ? <footer className={styles.signatures}>
            {signatures.map((signature) => (
              <div key={signature}>
                <strong>{signature}</strong>
                <span>(Ký, ghi rõ họ tên)</span>
              </div>
            ))}
          </footer> : null}

          <p className={styles.footer}>Bản in từ Hệ thống Công Ty — dữ liệu theo chứng từ đang hiển thị; thao tác in không làm thay đổi nghiệp vụ.</p>
        </article>
      </PrintSurface>
    </>
  );
}
