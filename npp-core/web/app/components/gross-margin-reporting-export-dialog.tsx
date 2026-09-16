'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './sales-reporting-export-dialog.module.css';

export type GrossMarginExportDimension = 'customers' | 'skus' | 'lines' | 'exceptions';

type Filters = Readonly<{ from: string; to: string; warehouseId: string }>;
type ColumnOption = Readonly<{ key: string; label: string }>;
type Props = Readonly<{
  initialDimension: GrossMarginExportDimension;
  filters: Filters;
  disabled?: boolean;
}>;

const DIMENSION_LABELS: Readonly<Record<GrossMarginExportDimension, string>> = Object.freeze({
  customers: 'Theo khách hàng',
  skus: 'Theo SKU',
  lines: 'Chi tiết dòng',
  exceptions: 'Ngoại lệ',
});

const COLUMN_OPTIONS: Readonly<Record<GrossMarginExportDimension, readonly ColumnOption[]>> = Object.freeze({
  customers: Object.freeze([
    { key: 'customerCode', label: 'Mã khách hàng' }, { key: 'customerName', label: 'Khách hàng' }, { key: 'lineCount', label: 'Số dòng' },
    { key: 'netRevenue', label: 'Doanh thu' }, { key: 'cogs', label: 'Giá vốn' }, { key: 'grossMargin', label: 'Lãi gộp' }, { key: 'grossMarginPercent', label: 'Tỷ lệ lãi gộp (%)' },
  ]),
  skus: Object.freeze([
    { key: 'sku', label: 'SKU' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'lineCount', label: 'Số dòng' },
    { key: 'netRevenue', label: 'Doanh thu' }, { key: 'cogs', label: 'Giá vốn' }, { key: 'grossMargin', label: 'Lãi gộp' }, { key: 'grossMarginPercent', label: 'Tỷ lệ lãi gộp (%)' },
  ]),
  lines: Object.freeze([
    { key: 'documentDate', label: 'Ngày' }, { key: 'documentNumber', label: 'Chứng từ' }, { key: 'eventKind', label: 'Loại phát sinh' },
    { key: 'customerCode', label: 'Mã khách hàng' }, { key: 'customerName', label: 'Khách hàng' }, { key: 'warehouseCode', label: 'Kho' },
    { key: 'sku', label: 'SKU' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'currencyCode', label: 'Tiền tệ' },
    { key: 'netRevenue', label: 'Doanh thu' }, { key: 'cogs', label: 'Giá vốn' }, { key: 'grossMargin', label: 'Lãi gộp' }, { key: 'grossMarginPercent', label: 'Tỷ lệ lãi gộp (%)' },
  ]),
  exceptions: Object.freeze([
    { key: 'documentDate', label: 'Ngày' }, { key: 'documentNumber', label: 'Chứng từ' }, { key: 'eventKind', label: 'Loại phát sinh' },
    { key: 'customerCode', label: 'Mã khách hàng' }, { key: 'customerName', label: 'Khách hàng' }, { key: 'warehouseCode', label: 'Kho' },
    { key: 'sku', label: 'SKU' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'currencyCode', label: 'Tiền tệ' },
    { key: 'netRevenue', label: 'Doanh thu' }, { key: 'exceptionReason', label: 'Nguyên nhân' },
  ]),
});

const DEFAULT_COLUMNS: Readonly<Record<GrossMarginExportDimension, readonly string[]>> = Object.freeze({
  customers: Object.freeze(['customerCode', 'customerName', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent']),
  skus: Object.freeze(['sku', 'productName', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent']),
  lines: Object.freeze(['documentDate', 'documentNumber', 'eventKind', 'customerCode', 'customerName', 'warehouseCode', 'sku', 'productName', 'netRevenue', 'cogs', 'grossMargin']),
  exceptions: Object.freeze(['documentDate', 'documentNumber', 'eventKind', 'customerCode', 'customerName', 'warehouseCode', 'sku', 'productName', 'netRevenue', 'exceptionReason']),
});

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = /filename="([^"\r\n]+)"/i.exec(value ?? '');
  return match?.[1] || fallback;
}

export function GrossMarginReportingExportDialog({ initialDimension, filters, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState<GrossMarginExportDimension>(initialDimension);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [selectedColumns, setSelectedColumns] = useState<readonly string[]>(DEFAULT_COLUMNS[initialDimension]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const options = COLUMN_OPTIONS[dimension];
  const selected = useMemo(() => new Set(selectedColumns), [selectedColumns]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, exporting]);

  useEffect(() => {
    if (!open) return;
    setDimension(initialDimension);
    setSelectedColumns(DEFAULT_COLUMNS[initialDimension]);
  }, [initialDimension, open]);

  function changeDimension(next: GrossMarginExportDimension) {
    setDimension(next);
    setSelectedColumns(DEFAULT_COLUMNS[next]);
    setError('');
  }

  function openDialog() {
    setDimension(initialDimension);
    setFormat('xlsx');
    setSelectedColumns(DEFAULT_COLUMNS[initialDimension]);
    setError('');
    setOpen(true);
  }

  function toggleColumn(key: string) {
    setSelectedColumns((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  async function exportReport() {
    if (!selectedColumns.length || exporting) return;
    setExporting(true);
    setError('');
    try {
      const query = new URLSearchParams({ from: filters.from, to: filters.to, dimension, format });
      if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
      for (const key of selectedColumns) query.append('column', key);
      const response = await fetch(`/api/reporting/gross-margin/export?${query.toString()}`, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || 'Không xuất được báo cáo lãi gộp.');
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('content-disposition'), `Bao-cao-lai-gop-${dimension}.${format}`);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setOpen(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Không xuất được báo cáo lãi gộp.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.openButton} onClick={openDialog} disabled={disabled}>Xuất báo cáo</button>
      {open ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !exporting) setOpen(false);
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="gross-margin-export-title">
            <div className={styles.heading}>
              <div><p>Xuất báo cáo lãi gộp</p><h2 id="gross-margin-export-title">{DIMENSION_LABELS[dimension]}</h2></div>
              <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} disabled={exporting} aria-label="Đóng cửa sổ xuất báo cáo">×</button>
            </div>
            <p className={styles.description}>Xuất theo kỳ và kho đang áp dụng. Dữ liệu lãi gộp được đối soát với cùng nguồn đang hiển thị trên màn hình.</p>

            <label className={styles.formatGroup}>
              <span>Nội dung xuất</span>
              <select value={dimension} onChange={(event) => changeDimension(event.target.value as GrossMarginExportDimension)} disabled={exporting}>
                {Object.entries(DIMENSION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>

            <fieldset className={styles.formatGroup}>
              <legend>Định dạng file</legend>
              <label><input type="radio" name="gross-margin-export-format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (.xlsx)</label>
              <label><input type="radio" name="gross-margin-export-format" value="csv" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV (.csv)</label>
            </fieldset>

            <div className={styles.columnHeader}>
              <div><strong>Cột cần xuất</strong><small>{selectedColumns.length}/{options.length} cột</small></div>
              <div className={styles.quickActions}>
                <button type="button" onClick={() => setSelectedColumns(options.map((item) => item.key))}>Chọn tất cả</button>
                <button type="button" onClick={() => setSelectedColumns([])}>Bỏ chọn</button>
                <button type="button" onClick={() => setSelectedColumns(DEFAULT_COLUMNS[dimension])}>Mặc định</button>
              </div>
            </div>
            <div className={styles.columnGrid}>
              {options.map((option) => <label key={option.key}><input type="checkbox" checked={selected.has(option.key)} onChange={() => toggleColumn(option.key)} /><span>{option.label}</span></label>)}
            </div>
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            <div className={styles.footer}>
              <button type="button" className={styles.cancelButton} onClick={() => setOpen(false)} disabled={exporting}>Hủy</button>
              <button type="button" className={styles.exportButton} onClick={exportReport} disabled={exporting || selectedColumns.length === 0}>{exporting ? 'Đang tạo file…' : `Xuất ${format === 'xlsx' ? 'Excel' : 'CSV'}`}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
