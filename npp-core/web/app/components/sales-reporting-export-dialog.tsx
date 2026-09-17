'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SalesBreakdownKey } from '../../lib/sales-reporting-types';
import styles from './sales-reporting-export-dialog.module.css';

type Filters = Readonly<{
  from: string;
  to: string;
  warehouseId: string;
  productGroupId: string;
  customerGroupId: string;
  includeZeroProducts: boolean;
}>;

type SalesExportDimension = SalesBreakdownKey;
type ExportMode = 'list' | 'matrix';
type MatrixDimension = 'products' | 'customerGroups' | 'channels' | 'productGroups';
type MatrixColumnDimension = MatrixDimension;
type MatrixMetric = 'revenue' | 'quantity';

type ColumnOption = Readonly<{
  key: string;
  label: string;
}>;

type Props = Readonly<{
  dimension: SalesExportDimension;
  filters: Filters;
  disabled?: boolean;
  buttonLabel?: string;
}>;

const DIMENSION_LABELS: Readonly<Record<SalesExportDimension, string>> = Object.freeze({
  customers: 'Khách hàng',
  customerGroups: 'Loại khách',
  channels: 'Kênh bán',
  products: 'Sản phẩm',
  productGroups: 'Nhóm hàng',
  employees: 'Nhân viên bán hàng',
});

const MATRIX_DIMENSION_LABELS: Readonly<Record<MatrixDimension, string>> = Object.freeze({
  products: 'Sản phẩm',
  customerGroups: 'Loại khách',
  channels: 'Kênh bán',
  productGroups: 'Nhóm hàng',
});

const MATRIX_DIMENSIONS: readonly MatrixDimension[] = Object.freeze([
  'products',
  'customerGroups',
  'channels',
  'productGroups',
]);

const MATRIX_COLUMN_DIMENSIONS: readonly MatrixColumnDimension[] = MATRIX_DIMENSIONS;

const COLUMN_LABELS = Object.freeze({
  code: 'Mã',
  name: 'Tên',
  currencyCode: 'Tiền tệ',
  unitCode: 'Mã ĐVT',
  unitName: 'ĐVT',
  revenue: 'Doanh thu',
  quantity: 'Sản lượng',
  documentCount: 'Số đơn',
  customerCount: 'Số khách',
  productCount: 'Số sản phẩm',
  sharePercent: 'Tỷ trọng (%)',
  previousRevenue: 'Doanh thu kỳ trước',
  previousQuantity: 'Sản lượng kỳ trước',
  changePercent: 'Thay đổi doanh thu (%)',
  source: 'Nguồn dữ liệu',
} as const);

type ColumnKey = keyof typeof COLUMN_LABELS;

function columns(keys: readonly ColumnKey[]): readonly ColumnOption[] {
  return Object.freeze(keys.map((key) => Object.freeze({ key, label: COLUMN_LABELS[key] })));
}

const COLUMN_OPTIONS: Readonly<Record<SalesExportDimension, readonly ColumnOption[]>> = Object.freeze({
  customers: columns(['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source']),
  customerGroups: columns(['code', 'name', 'currencyCode', 'revenue', 'customerCount', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source']),
  channels: columns(['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source']),
  products: columns(['code', 'name', 'currencyCode', 'unitCode', 'unitName', 'quantity', 'revenue', 'sharePercent', 'previousRevenue', 'previousQuantity', 'changePercent', 'source']),
  productGroups: columns(['code', 'name', 'currencyCode', 'revenue', 'productCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source']),
  employees: columns(['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source']),
});

const DEFAULT_COLUMNS: Readonly<Record<SalesExportDimension, readonly string[]>> = Object.freeze({
  customers: Object.freeze(['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent']),
  customerGroups: Object.freeze(['code', 'name', 'currencyCode', 'revenue', 'customerCount', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent']),
  channels: Object.freeze(['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent']),
  products: Object.freeze(['code', 'name', 'currencyCode', 'unitName', 'quantity', 'revenue', 'sharePercent', 'previousRevenue', 'previousQuantity', 'changePercent']),
  productGroups: Object.freeze(['code', 'name', 'currencyCode', 'revenue', 'productCount', 'sharePercent', 'previousRevenue', 'changePercent']),
  employees: Object.freeze(['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent']),
});

function isMatrixDimension(value: SalesExportDimension): value is MatrixDimension {
  return MATRIX_DIMENSIONS.some((item) => item === value);
}

function defaultMatrixRow(dimension: SalesExportDimension): MatrixDimension {
  return isMatrixDimension(dimension) ? dimension : 'products';
}

function defaultMatrixColumn(row: MatrixDimension): MatrixColumnDimension {
  return MATRIX_COLUMN_DIMENSIONS.find((item) => item !== row) ?? 'customerGroups';
}

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = /filename="([^"\r\n]+)"/i.exec(value ?? '');
  return match?.[1] || fallback;
}

export function SalesReportingExportDialog({
  dimension,
  filters,
  disabled = false,
  buttonLabel = 'Xuất báo cáo',
}: Props) {
  const initialMatrixRow = defaultMatrixRow(dimension);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ExportMode>('list');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [selectedColumns, setSelectedColumns] = useState<readonly string[]>(DEFAULT_COLUMNS[dimension]);
  const [matrixRow, setMatrixRow] = useState<MatrixDimension>(initialMatrixRow);
  const [matrixColumn, setMatrixColumn] = useState<MatrixColumnDimension>(defaultMatrixColumn(initialMatrixRow));
  const [matrixMetric, setMatrixMetric] = useState<MatrixMetric>('revenue');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const options = COLUMN_OPTIONS[dimension];
  const selected = useMemo(() => new Set(selectedColumns), [selectedColumns]);
  const matrixColumnOptions = useMemo(
    () => MATRIX_COLUMN_DIMENSIONS.filter((item) => item !== matrixRow),
    [matrixRow],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, exporting]);

  useEffect(() => {
    const nextRow = defaultMatrixRow(dimension);
    setSelectedColumns(DEFAULT_COLUMNS[dimension]);
    setMatrixRow(nextRow);
    setMatrixColumn(defaultMatrixColumn(nextRow));
    setMatrixMetric('revenue');
    setError('');
  }, [dimension]);

  function openDialog() {
    const nextRow = defaultMatrixRow(dimension);
    setMode('list');
    setFormat('xlsx');
    setSelectedColumns(DEFAULT_COLUMNS[dimension]);
    setMatrixRow(nextRow);
    setMatrixColumn(defaultMatrixColumn(nextRow));
    setMatrixMetric('revenue');
    setError('');
    setOpen(true);
  }

  function toggleColumn(key: string) {
    setSelectedColumns((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  }

  function changeMatrixRow(value: MatrixDimension) {
    setMatrixRow(value);
    if (matrixColumn === value) setMatrixColumn(defaultMatrixColumn(value));
  }

  function changeMatrixMetric(value: MatrixMetric) {
    setMatrixMetric(value);
  }

  async function exportReport() {
    if ((mode === 'list' && !selectedColumns.length) || exporting) return;
    setExporting(true);
    setError('');
    try {
      const requestedFormat = mode === 'matrix' ? 'xlsx' : format;
      const exportDimension = mode === 'matrix'
        ? `matrix.${matrixRow}.${matrixColumn}.${matrixMetric}`
        : dimension;
      const query = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        dimension: exportDimension,
        format: requestedFormat,
      });
      if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);

      if (mode === 'matrix') {
        if (filters.productGroupId) query.set('productGroupId', filters.productGroupId);
        if (filters.customerGroupId) query.set('customerGroupId', filters.customerGroupId);
      } else {
        if (dimension === 'products') {
          if (filters.productGroupId) query.set('productGroupId', filters.productGroupId);
          if (filters.includeZeroProducts) query.set('includeZeroProducts', 'true');
        }
        if (dimension === 'customers' && filters.customerGroupId) {
          query.set('customerGroupId', filters.customerGroupId);
        }
        for (const key of selectedColumns) query.append('column', key);
      }

      const response = await fetch(`/api/reporting/sales/export?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || 'Không xuất được Báo cáo bán hàng.');
      }

      const blob = await response.blob();
      const fallback = `Bao-cao-ban-hang-${exportDimension.replaceAll('.', '-')}.${requestedFormat}`;
      const filename = filenameFromDisposition(response.headers.get('content-disposition'), fallback);
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
      setError(exportError instanceof Error ? exportError.message : 'Không xuất được Báo cáo bán hàng.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.openButton} onClick={openDialog} disabled={disabled}>
        {buttonLabel}
      </button>
      {open ? createPortal(
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !exporting) setOpen(false);
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="sales-export-title">
            <div className={styles.heading}>
              <div>
                <p>Xuất Báo cáo bán hàng</p>
                <h2 id="sales-export-title">{DIMENSION_LABELS[dimension]}</h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} disabled={exporting} aria-label="Đóng cửa sổ xuất báo cáo">×</button>
            </div>

            <p className={styles.description}>
              {mode === 'matrix'
                ? 'Xuất ma trận từ toàn bộ dữ liệu phát sinh trong kỳ và bộ lọc đang áp dụng. File Excel có dòng Tổng, Tỷ lệ và khung bảng đầy đủ.'
                : 'Xuất toàn bộ dữ liệu theo kỳ, kho và bộ lọc của mục đang xem, không phụ thuộc số dòng đang hiển thị trên màn hình.'}
            </p>

            <fieldset className={styles.formatGroup}>
              <legend>Kiểu báo cáo</legend>
              <label><input type="radio" name="sales-export-mode" value="list" checked={mode === 'list'} onChange={() => setMode('list')} /> Danh sách</label>
              <label><input type="radio" name="sales-export-mode" value="matrix" checked={mode === 'matrix'} onChange={() => { setMode('matrix'); setFormat('xlsx'); }} /> Ma trận</label>
            </fieldset>

            {mode === 'matrix' ? (
              <div className={styles.matrixPanel}>
                <div className={styles.matrixGrid}>
                  <label className={styles.matrixField}>
                    <span>Tiêu chí dòng</span>
                    <select value={matrixRow} onChange={(event) => changeMatrixRow(event.target.value as MatrixDimension)} disabled={exporting}>
                      {MATRIX_DIMENSIONS.map((item) => <option key={item} value={item}>{MATRIX_DIMENSION_LABELS[item]}</option>)}
                    </select>
                  </label>
                  <label className={styles.matrixField}>
                    <span>Tiêu chí cột</span>
                    <select value={matrixColumn} onChange={(event) => setMatrixColumn(event.target.value as MatrixColumnDimension)} disabled={exporting}>
                      {matrixColumnOptions.map((item) => <option key={item} value={item}>{MATRIX_DIMENSION_LABELS[item]}</option>)}
                    </select>
                  </label>
                  <label className={styles.matrixField}>
                    <span>Chỉ tiêu</span>
                    <select value={matrixMetric} onChange={(event) => changeMatrixMetric(event.target.value as MatrixMetric)} disabled={exporting}>
                      <option value="revenue">Doanh thu</option>
                      <option value="quantity">Sản lượng</option>
                    </select>
                  </label>
                </div>
                <p className={styles.matrixHint}>
                  Sản lượng được tách riêng theo ĐVT để không cộng lẫn thùng, cái, kg hoặc các đơn vị khác. Ma trận xuất Excel (.xlsx).
                </p>
              </div>
            ) : (
              <>
                <fieldset className={styles.formatGroup}>
                  <legend>Định dạng file</legend>
                  <label><input type="radio" name="sales-export-format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (.xlsx)</label>
                  <label><input type="radio" name="sales-export-format" value="csv" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV (.csv)</label>
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
                  {options.map((option) => (
                    <label key={option.key}>
                      <input type="checkbox" checked={selected.has(option.key)} onChange={() => toggleColumn(option.key)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {error ? <div className={styles.error} role="alert">{error}</div> : null}

            <div className={styles.footer}>
              <button type="button" className={styles.cancelButton} onClick={() => setOpen(false)} disabled={exporting}>Hủy</button>
              <button type="button" className={styles.exportButton} onClick={exportReport} disabled={exporting || (mode === 'list' && selectedColumns.length === 0)}>
                {exporting ? 'Đang tạo file…' : mode === 'matrix' ? 'Xuất Excel ma trận' : `Xuất ${format === 'xlsx' ? 'Excel' : 'CSV'}`}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
