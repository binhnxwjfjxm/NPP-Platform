'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './sales-reporting-export-dialog.module.css';

export type InventoryExportDimension = 'overview' | 'positions' | 'movement' | 'slow-moving' | 'lots' | 'exceptions';

type Filters = Readonly<{ from: string; to: string; warehouseId: string | null; slowDays: number }>;
type ColumnOption = Readonly<{ key: string; label: string }>;
type Props = Readonly<{
  initialDimension: InventoryExportDimension;
  filters: Filters;
  disabled?: boolean;
}>;

const DIMENSION_LABELS: Readonly<Record<InventoryExportDimension, string>> = Object.freeze({
  overview: 'Tổng quan theo kho',
  positions: 'Tồn hiện tại',
  movement: 'Nhập – xuất – tồn theo kỳ',
  'slow-moving': 'Hàng chậm luân chuyển',
  lots: 'Lô & hạn dùng',
  exceptions: 'Cần kiểm tra',
});

const COLUMN_OPTIONS: Readonly<Record<InventoryExportDimension, readonly ColumnOption[]>> = Object.freeze({
  overview: Object.freeze([
    { key: 'warehouseCode', label: 'Mã kho' }, { key: 'warehouseName', label: 'Tên kho' },
    { key: 'stockedSkuCount', label: 'Mã hàng có tồn' }, { key: 'reservedSkuCount', label: 'Mã hàng có giữ' },
    { key: 'inventoryValueVnd', label: 'Giá trị tồn (VND)' }, { key: 'costingExceptionCount', label: 'Cần kiểm tra giá vốn' },
    { key: 'quantityProjectedThrough', label: 'Cập nhật tồn đến' },
  ]),
  positions: Object.freeze([
    { key: 'warehouseCode', label: 'Mã kho' }, { key: 'warehouseName', label: 'Tên kho' },
    { key: 'productCode', label: 'Mã sản phẩm' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'sku', label: 'SKU' }, { key: 'unitName', label: 'Đơn vị tính' },
    { key: 'onHandQuantity', label: 'Tồn kho' }, { key: 'reservedQuantity', label: 'Đã giữ cho đơn' }, { key: 'availableQuantity', label: 'Có thể xuất' },
    { key: 'inventoryValue', label: 'Giá trị tồn' }, { key: 'averageUnitCost', label: 'Giá bình quân' }, { key: 'costingStatus', label: 'Tình trạng giá vốn' },
    { key: 'projectedThrough', label: 'Dữ liệu tồn đến' },
  ]),
  movement: Object.freeze([
    { key: 'warehouseCode', label: 'Mã kho' }, { key: 'warehouseName', label: 'Tên kho' },
    { key: 'productCode', label: 'Mã sản phẩm' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'sku', label: 'SKU' }, { key: 'unitName', label: 'Đơn vị tính' },
    { key: 'openingQuantity', label: 'Đầu kỳ' }, { key: 'inboundQuantity', label: 'Nhập' }, { key: 'outboundQuantity', label: 'Xuất' },
    { key: 'closingQuantity', label: 'Cuối kỳ' }, { key: 'movementLineCount', label: 'Dòng nghiệp vụ' }, { key: 'lastPostedAt', label: 'Phát sinh gần nhất' },
  ]),
  'slow-moving': Object.freeze([
    { key: 'warehouseCode', label: 'Mã kho' }, { key: 'warehouseName', label: 'Tên kho' },
    { key: 'productCode', label: 'Mã sản phẩm' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'sku', label: 'SKU' }, { key: 'unitName', label: 'Đơn vị tính' },
    { key: 'onHandQuantity', label: 'Tồn kho' }, { key: 'reservedQuantity', label: 'Đã giữ cho đơn' }, { key: 'availableQuantity', label: 'Có thể xuất' },
    { key: 'lastOutDate', label: 'Lần xuất cuối' }, { key: 'daysSinceOutbound', label: 'Số ngày chưa xuất' }, { key: 'inventoryValueVnd', label: 'Giá trị tồn (VND)' },
  ]),
  lots: Object.freeze([
    { key: 'warehouseCode', label: 'Mã kho' }, { key: 'warehouseName', label: 'Tên kho' },
    { key: 'productCode', label: 'Mã sản phẩm' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'sku', label: 'SKU' }, { key: 'unitName', label: 'Đơn vị tính' },
    { key: 'lotCode', label: 'Mã lô' }, { key: 'manufacturedDate', label: 'Ngày sản xuất' }, { key: 'expiryDate', label: 'Hạn sử dụng' },
    { key: 'onHandQuantity', label: 'Tồn kho' }, { key: 'reservedQuantity', label: 'Đã giữ cho đơn' }, { key: 'availableQuantity', label: 'Có thể xuất' },
    { key: 'manufacturedAgeDays', label: 'Tuổi lô (ngày)' }, { key: 'daysToExpiry', label: 'Còn lại đến hạn (ngày)' }, { key: 'expiryStatus', label: 'Trạng thái hạn dùng' },
  ]),
  exceptions: Object.freeze([
    { key: 'warehouseCode', label: 'Mã kho' }, { key: 'warehouseName', label: 'Tên kho' },
    { key: 'productCode', label: 'Mã sản phẩm' }, { key: 'productName', label: 'Tên sản phẩm' }, { key: 'sku', label: 'SKU' }, { key: 'unitName', label: 'Đơn vị tính' },
    { key: 'ledgerQuantity', label: 'Số lượng sổ kho' }, { key: 'costingQuantity', label: 'Số lượng tính giá' }, { key: 'quantityDifference', label: 'Chênh lệch' },
    { key: 'inventoryValueVnd', label: 'Giá trị tồn (VND)' }, { key: 'averageUnitCost', label: 'Giá bình quân' }, { key: 'costingStatus', label: 'Tình trạng giá vốn' },
    { key: 'anomalyCount', label: 'Số cảnh báo' }, { key: 'reconciliationStatus', label: 'Trạng thái đối soát' },
  ]),
});

const DEFAULT_COLUMNS: Readonly<Record<InventoryExportDimension, readonly string[]>> = Object.freeze({
  overview: Object.freeze(['warehouseCode', 'warehouseName', 'stockedSkuCount', 'reservedSkuCount', 'inventoryValueVnd', 'costingExceptionCount', 'quantityProjectedThrough']),
  positions: Object.freeze(['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'onHandQuantity', 'reservedQuantity', 'availableQuantity', 'inventoryValue', 'averageUnitCost', 'costingStatus']),
  movement: Object.freeze(['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'openingQuantity', 'inboundQuantity', 'outboundQuantity', 'closingQuantity', 'movementLineCount']),
  'slow-moving': Object.freeze(['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'onHandQuantity', 'availableQuantity', 'lastOutDate', 'daysSinceOutbound', 'inventoryValueVnd']),
  lots: Object.freeze(['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'lotCode', 'manufacturedDate', 'expiryDate', 'onHandQuantity', 'availableQuantity', 'expiryStatus']),
  exceptions: Object.freeze(['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'ledgerQuantity', 'costingQuantity', 'quantityDifference', 'costingStatus', 'anomalyCount', 'reconciliationStatus']),
});

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = /filename="([^"\r\n]+)"/i.exec(value ?? '');
  return match?.[1] || fallback;
}

export function InventoryReportingExportDialog({ initialDimension, filters, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState<InventoryExportDimension>(initialDimension);
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

  function changeDimension(next: InventoryExportDimension) {
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
      const query = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        slowDays: String(filters.slowDays),
        dimension,
        format,
      });
      if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
      for (const key of selectedColumns) query.append('column', key);
      const response = await fetch(`/api/reporting/inventory/export?${query.toString()}`, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || 'Không xuất được Báo cáo tồn kho.');
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('content-disposition'), `Bao-cao-ton-kho-${dimension}.${format}`);
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
      setError(exportError instanceof Error ? exportError.message : 'Không xuất được Báo cáo tồn kho.');
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
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="inventory-export-title">
            <div className={styles.heading}>
              <div><p>Xuất Báo cáo tồn kho</p><h2 id="inventory-export-title">{DIMENSION_LABELS[dimension]}</h2></div>
              <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} disabled={exporting} aria-label="Đóng cửa sổ xuất báo cáo">×</button>
            </div>
            <p className={styles.description}>Xuất theo kỳ, kho và ngưỡng chậm luân chuyển đang áp dụng. File lấy dữ liệu đầy đủ từ cùng nguồn báo cáo, không lấy riêng 100 dòng đang hiển thị.</p>

            <fieldset className={styles.formatGroup}>
              <legend>Nội dung xuất</legend>
              {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                const value = key as InventoryExportDimension;
                return <label key={key}><input type="radio" name="inventory-export-dimension" value={value} checked={dimension === value} onChange={() => changeDimension(value)} disabled={exporting} /> {label}</label>;
              })}
            </fieldset>

            <fieldset className={styles.formatGroup}>
              <legend>Định dạng file</legend>
              <label><input type="radio" name="inventory-export-format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (.xlsx)</label>
              <label><input type="radio" name="inventory-export-format" value="csv" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV (.csv)</label>
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
