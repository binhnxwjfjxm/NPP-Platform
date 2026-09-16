'use client';

import { useMemo, useState } from 'react';
import {
  INVENTORY_EXPORT_COLUMN_OPTIONS,
  INVENTORY_EXPORT_DEFAULT_COLUMNS,
  INVENTORY_EXPORT_SCOPE_LABELS,
  type InventoryExportFormat,
  type InventoryExportScope,
} from '../../lib/inventory-data-export-model';
import styles from './inventory-workspace.module.css';

type ErrorEnvelope = Readonly<{ error?: { message?: string } }>;

function currentPageSearch(scope: InventoryExportScope): string {
  if (typeof document === 'undefined') return '';
  const selector = scope === 'balances'
    ? '[data-testid="inventory-balances-search-input"]'
    : scope === 'lots'
      ? '[data-testid="inventory-lots-search-input"]'
      : 'input[placeholder="Tìm SKU bất kỳ, SKU tồn chuẩn hoặc tên hàng"]';
  return document.querySelector<HTMLInputElement>(selector)?.value?.trim() ?? '';
}

function filenameFrom(response: Response, scope: InventoryExportScope, format: InventoryExportFormat): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/i.exec(disposition);
  return match?.[1] || `${INVENTORY_EXPORT_SCOPE_LABELS[scope]}.${format}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export default function InventoryExportAction({ scope }: { scope: InventoryExportScope }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<InventoryExportFormat>('xlsx');
  const [search, setSearch] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () => new Set(INVENTORY_EXPORT_DEFAULT_COLUMNS[scope]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = INVENTORY_EXPORT_COLUMN_OPTIONS[scope];
  const orderedColumns = useMemo(
    () => options.filter((item) => selectedColumns.has(item.key)).map((item) => item.key),
    [options, selectedColumns],
  );

  function showDialog() {
    setSearch(currentPageSearch(scope));
    setError('');
    setOpen(true);
  }

  function toggleColumn(key: string) {
    setSelectedColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function exportData() {
    if (!orderedColumns.length) {
      setError('Vui lòng chọn ít nhất một cột để xuất.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({ scope, format });
      if (search.trim()) query.set('search', search.trim());
      for (const column of orderedColumns) query.append('column', column);
      const response = await fetch(`/api/inventory/export?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as ErrorEnvelope | null;
        throw new Error(payload?.error?.message || 'Không xuất được dữ liệu.');
      }
      downloadBlob(await response.blob(), filenameFrom(response, scope, format));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xuất được dữ liệu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.primaryAction} onClick={showDialog} data-testid={`inventory-export-${scope}`}>
        Xuất dữ liệu
      </button>
      {open ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
          <section className={styles.documentDialog} role="dialog" aria-modal="true" aria-labelledby={`inventory-export-title-${scope}`}>
            <div className={styles.documentDialogHeader}>
              <div>
                <div className={styles.subtle}>Xuất Excel / CSV</div>
                <h2 id={`inventory-export-title-${scope}`} className={styles.panelTitle}>Xuất {INVENTORY_EXPORT_SCOPE_LABELS[scope].toLowerCase()}</h2>
              </div>
              <button type="button" className={styles.miniButton} onClick={() => setOpen(false)} disabled={busy}>Đóng</button>
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Định dạng</span>
                <select className={styles.selectInput} value={format} onChange={(event) => setFormat(event.target.value as InventoryExportFormat)} disabled={busy}>
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Tìm kiếm áp dụng</span>
                <input className={styles.textInput} value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} placeholder="Để trống để xuất toàn bộ trong phạm vi được phép" />
              </label>
            </div>

            <div className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleBlock}>
                  <h3 className={styles.panelTitle}>Cột xuất dữ liệu</h3>
                  <p className={styles.panelCopy}>{selectedColumns.size}/{options.length} cột đang chọn.</p>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.miniButton} onClick={() => setSelectedColumns(new Set(options.map((item) => item.key)))} disabled={busy}>Chọn tất cả</button>
                  <button type="button" className={styles.miniButton} onClick={() => setSelectedColumns(new Set())} disabled={busy}>Bỏ chọn</button>
                </div>
              </div>
              <div className={styles.formGrid}>
                {options.map((item) => (
                  <label key={item.key} className={styles.switchRow}>
                    <input type="checkbox" checked={selectedColumns.has(item.key)} onChange={() => toggleColumn(item.key)} disabled={busy} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</div> : null}
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryAction} onClick={() => void exportData()} disabled={busy || selectedColumns.size === 0}>
                {busy ? 'Đang tạo file…' : 'Tải file'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
