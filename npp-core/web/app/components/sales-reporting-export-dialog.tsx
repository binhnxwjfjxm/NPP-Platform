'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  SalesBreakdownKey,
  SalesBreakdownRow,
  SalesReportingDashboard,
} from '../../lib/sales-reporting-types';
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
type ExportMode = 'list' | 'analysis';
type AnalysisDimension = 'products' | 'customerGroups' | 'channels' | 'productGroups';
type AnalysisMetric = 'revenue' | 'quantity';
type QuantityDisplay = 'sold' | 'carton' | 'base';
type AnalysisSort = 'name-asc' | 'revenue-desc' | 'revenue-asc' | 'quantity-desc' | 'quantity-asc';

type ColumnOption = Readonly<{
  key: string;
  label: string;
}>;

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: Readonly<{ message?: string }>;
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

const ANALYSIS_DIMENSION_LABELS: Readonly<Record<AnalysisDimension, string>> = Object.freeze({
  products: 'Sản phẩm',
  customerGroups: 'Loại khách',
  channels: 'Kênh bán',
  productGroups: 'Nhóm hàng',
});

const ANALYSIS_DIMENSIONS: readonly AnalysisDimension[] = Object.freeze([
  'products',
  'customerGroups',
  'channels',
  'productGroups',
]);

const ANALYSIS_METRIC_LABELS: Readonly<Record<AnalysisMetric, string>> = Object.freeze({
  revenue: 'Doanh thu',
  quantity: 'Sản lượng',
});

const QUANTITY_DISPLAY_LABELS: Readonly<Record<QuantityDisplay, string>> = Object.freeze({
  sold: 'Theo ĐVT bán',
  carton: 'Ưu tiên Thùng',
  base: 'Ưu tiên ĐVT lẻ',
});

const ANALYSIS_SORT_LABELS: Readonly<Record<AnalysisSort, string>> = Object.freeze({
  'name-asc': 'Tên A → Z',
  'revenue-desc': 'Doanh thu cao → thấp',
  'revenue-asc': 'Doanh thu thấp → cao',
  'quantity-desc': 'Sản lượng cao → thấp',
  'quantity-asc': 'Sản lượng thấp → cao',
});

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

function isAnalysisDimension(value: SalesExportDimension): value is AnalysisDimension {
  return ANALYSIS_DIMENSIONS.some((item) => item === value);
}

function defaultAnalysisDimensions(dimension: SalesExportDimension): readonly AnalysisDimension[] {
  if (dimension === 'products') return Object.freeze(['products', 'customerGroups']);
  if (isAnalysisDimension(dimension)) return Object.freeze(['products', dimension]);
  return Object.freeze(['products', 'customerGroups']);
}

function analysisIdentityPart(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? '').trim() || fallback;
  return encodeURIComponent(normalized);
}

function analysisCategoryKey(dimension: AnalysisDimension, row: SalesBreakdownRow) {
  const main = analysisIdentityPart(row.id ?? row.code ?? row.name, '__none__');
  if (dimension !== 'products') return `${dimension}:${main}`;
  const unit = analysisIdentityPart(row.unit?.id ?? row.unit?.code ?? row.unit?.name, '__none__');
  return `${dimension}:${main}:${unit}`;
}

function analysisCategoryLabel(dimension: AnalysisDimension, row: SalesBreakdownRow) {
  if (dimension !== 'products') return row.name;
  const unit = row.unit?.name || row.unit?.code;
  return unit ? `${row.name} · ${unit}` : row.name;
}

function analysisCategories(report: SalesReportingDashboard | null, dimension: AnalysisDimension) {
  const unique = new Map<string, Readonly<{ key: string; label: string }>>();
  for (const row of report?.breakdowns[dimension] ?? []) {
    const key = analysisCategoryKey(dimension, row);
    if (!unique.has(key)) unique.set(key, Object.freeze({ key, label: analysisCategoryLabel(dimension, row) }));
  }
  return Object.freeze([...unique.values()].sort((left, right) => left.label.localeCompare(right.label, 'vi')));
}

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = /filename="([^"\r\n]+)"/i.exec(value ?? '');
  return match?.[1] || fallback;
}

async function requestAnalysisReport(filters: Filters): Promise<SalesReportingDashboard> {
  const query = new URLSearchParams();
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
  if (filters.productGroupId) query.set('productGroupId', filters.productGroupId);
  if (filters.customerGroupId) query.set('customerGroupId', filters.customerGroupId);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/sales${serialized ? `?${serialized}` : ''}`, {
    method: 'GET',
    cache: 'no-store',
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<SalesReportingDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được cột báo cáo.');
  return envelope.data;
}

export function SalesReportingExportDialog({
  dimension,
  filters,
  disabled = false,
  buttonLabel = 'Xuất báo cáo',
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ExportMode>('list');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [selectedColumns, setSelectedColumns] = useState<readonly string[]>(DEFAULT_COLUMNS[dimension]);
  const [analysisDimensions, setAnalysisDimensions] = useState<readonly AnalysisDimension[]>(defaultAnalysisDimensions(dimension));
  const [analysisMetrics, setAnalysisMetrics] = useState<readonly AnalysisMetric[]>(Object.freeze(['revenue', 'quantity']));
  const [quantityDisplay, setQuantityDisplay] = useState<QuantityDisplay>('sold');
  const [analysisSort, setAnalysisSort] = useState<AnalysisSort>('name-asc');
  const [analysisSelectedColumns, setAnalysisSelectedColumns] = useState<readonly string[]>([]);
  const [analysisReport, setAnalysisReport] = useState<SalesReportingDashboard | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const options = COLUMN_OPTIONS[dimension];
  const selected = useMemo(() => new Set(selectedColumns), [selectedColumns]);
  const analysisSelected = useMemo(() => new Set(analysisSelectedColumns), [analysisSelectedColumns]);
  const analysisSortOptions = useMemo(() => {
    const result: AnalysisSort[] = ['name-asc'];
    if (analysisMetrics.includes('revenue')) result.push('revenue-desc', 'revenue-asc');
    if (analysisMetrics.includes('quantity')) result.push('quantity-desc', 'quantity-asc');
    return Object.freeze(result);
  }, [analysisMetrics]);
  const analysisRow = analysisDimensions[0];
  const analysisColumn = analysisDimensions[1];
  const categories = useMemo(
    () => analysisColumn ? analysisCategories(analysisReport, analysisColumn) : Object.freeze([]),
    [analysisReport, analysisColumn],
  );
  const currencies = useMemo(() => {
    const values = [...new Set((analysisReport?.summary.revenues ?? []).map((item) => item.currencyCode).filter(Boolean))].sort();
    return Object.freeze(values.length ? values : ['VND']);
  }, [analysisReport]);
  const analysisColumnOptions = useMemo(() => {
    if (!analysisRow || !analysisColumn || analysisDimensions.length !== 2 || !analysisReport) return Object.freeze([]) as readonly ColumnOption[];
    const result: ColumnOption[] = [];
    result.push(Object.freeze({ key: 'meta:code', label: analysisRow === 'products' ? 'Mã sản phẩm' : 'Mã' }));
    result.push(Object.freeze({ key: 'meta:name', label: ANALYSIS_DIMENSION_LABELS[analysisRow] }));
    if (analysisRow === 'products' || analysisMetrics.includes('quantity')) {
      result.push(Object.freeze({ key: 'meta:unit', label: 'ĐVT' }));
    }
    for (const category of categories) {
      if (analysisMetrics.includes('revenue')) {
        for (const currency of currencies) {
          const suffix = currencies.length > 1 ? ` (${currency})` : '';
          result.push(Object.freeze({
            key: `cat:${category.key}|revenue|${encodeURIComponent(currency)}`,
            label: `${category.label} - Doanh thu${suffix}`,
          }));
        }
      }
      if (analysisMetrics.includes('quantity')) {
        result.push(Object.freeze({
          key: `cat:${category.key}|quantity`,
          label: `${category.label} - Sản lượng`,
        }));
      }
    }
    if (analysisMetrics.includes('revenue')) {
      for (const currency of currencies) {
        const suffix = currencies.length > 1 ? ` (${currency})` : '';
        result.push(Object.freeze({ key: `total:revenue:${encodeURIComponent(currency)}`, label: `Tổng doanh thu${suffix}` }));
      }
    }
    if (analysisMetrics.includes('quantity')) {
      result.push(Object.freeze({ key: 'total:quantity', label: 'Tổng sản lượng' }));
    }
    return Object.freeze(result);
  }, [analysisRow, analysisColumn, analysisDimensions.length, analysisMetrics, analysisReport, categories, currencies]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, exporting]);

  useEffect(() => {
    setSelectedColumns(DEFAULT_COLUMNS[dimension]);
    setAnalysisDimensions(defaultAnalysisDimensions(dimension));
    setAnalysisMetrics(Object.freeze(['revenue', 'quantity']));
    setQuantityDisplay('sold');
    setAnalysisSort('name-asc');
    setAnalysisReport(null);
    setError('');
  }, [dimension]);

  useEffect(() => {
    if (!analysisSortOptions.includes(analysisSort)) setAnalysisSort('name-asc');
  }, [analysisSort, analysisSortOptions]);

  useEffect(() => {
    if (!open || mode !== 'analysis') return undefined;
    let active = true;
    setAnalysisLoading(true);
    setError('');
    void requestAnalysisReport(filters)
      .then((next) => {
        if (active) setAnalysisReport(next);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Không tải được cột báo cáo.');
      })
      .finally(() => {
        if (active) setAnalysisLoading(false);
      });
    return () => { active = false; };
  }, [open, mode, filters.from, filters.to, filters.warehouseId, filters.productGroupId, filters.customerGroupId]);

  useEffect(() => {
    setAnalysisSelectedColumns(analysisColumnOptions.map((item) => item.key));
  }, [analysisColumnOptions]);

  function openDialog() {
    setMode('list');
    setFormat('xlsx');
    setSelectedColumns(DEFAULT_COLUMNS[dimension]);
    setAnalysisDimensions(defaultAnalysisDimensions(dimension));
    setAnalysisMetrics(Object.freeze(['revenue', 'quantity']));
    setQuantityDisplay('sold');
    setAnalysisSort('name-asc');
    setAnalysisReport(null);
    setError('');
    setOpen(true);
  }

  function toggleColumn(key: string) {
    setSelectedColumns((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  }

  function toggleAnalysisDimension(value: AnalysisDimension) {
    setAnalysisDimensions((current) => {
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : current.length >= 2
          ? current
          : [...current, value];
      if (next.includes('products')) {
        return Object.freeze(['products', ...next.filter((item) => item !== 'products')]);
      }
      return Object.freeze(next);
    });
  }

  function toggleAnalysisMetric(value: AnalysisMetric) {
    setAnalysisMetrics((current) => {
      if (current.includes(value)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== value);
      }
      return Object.freeze([...current, value]);
    });
  }

  function toggleAnalysisColumn(key: string) {
    setAnalysisSelectedColumns((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  }

  async function exportReport() {
    const analysisReady = analysisDimensions.length === 2 && analysisMetrics.length > 0 && analysisSelectedColumns.length > 0 && !analysisLoading;
    if ((mode === 'list' && !selectedColumns.length) || (mode === 'analysis' && !analysisReady) || exporting) return;
    setExporting(true);
    setError('');
    try {
      const requestedFormat = mode === 'analysis' ? 'xlsx' : format;
      const metricToken = analysisMetrics.length === 2 ? 'both' : analysisMetrics[0];
      const exportDimension = mode === 'analysis'
        ? `analysis.${analysisRow}.${analysisColumn}.${metricToken}`
        : dimension;
      const query = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        dimension: exportDimension,
        format: requestedFormat,
      });
      if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);

      if (mode === 'analysis') {
        if (filters.productGroupId) query.set('productGroupId', filters.productGroupId);
        if (filters.customerGroupId) query.set('customerGroupId', filters.customerGroupId);
        if (analysisMetrics.includes('quantity')) query.set('quantityDisplay', quantityDisplay);
        query.set('sort', analysisSort);
        for (const key of analysisSelectedColumns) query.append('column', key);
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

  const analysisReady = analysisDimensions.length === 2 && analysisMetrics.length > 0 && analysisSelectedColumns.length > 0 && !analysisLoading;
  const analysisSummary = analysisDimensions.length === 2
    ? `Sẽ xuất Báo cáo ${ANALYSIS_DIMENSION_LABELS[analysisDimensions[0]]} theo ${ANALYSIS_DIMENSION_LABELS[analysisDimensions[1]]}, gồm ${analysisMetrics.map((item) => ANALYSIS_METRIC_LABELS[item]).join(' và ')}${analysisMetrics.includes('quantity') ? ` · ${QUANTITY_DISPLAY_LABELS[quantityDisplay]}` : ''} · ${ANALYSIS_SORT_LABELS[analysisSort]}.`
    : 'Chọn đúng 2 tiêu chí để tạo báo cáo phân tích.';

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
              {mode === 'analysis'
                ? 'Chọn số liệu và 2 tiêu chí cần phân tích. Danh sách cột bên dưới là đúng các cột sẽ có trong file Excel.'
                : 'Xuất toàn bộ dữ liệu theo kỳ, kho và bộ lọc của mục đang xem, không phụ thuộc số dòng đang hiển thị trên màn hình.'}
            </p>

            <fieldset className={styles.formatGroup}>
              <legend>Loại báo cáo</legend>
              <label><input type="radio" name="sales-export-mode" value="list" checked={mode === 'list'} onChange={() => setMode('list')} /> Danh sách</label>
              <label><input type="radio" name="sales-export-mode" value="analysis" checked={mode === 'analysis'} onChange={() => { setMode('analysis'); setFormat('xlsx'); }} /> Phân tích</label>
            </fieldset>

            {mode === 'analysis' ? (
              <div className={styles.matrixPanel}>
                <fieldset className={styles.formatGroup}>
                  <legend>Số liệu cần xuất</legend>
                  {(Object.keys(ANALYSIS_METRIC_LABELS) as AnalysisMetric[]).map((item) => (
                    <label key={item}>
                      <input
                        type="checkbox"
                        checked={analysisMetrics.includes(item)}
                        onChange={() => toggleAnalysisMetric(item)}
                        disabled={exporting || (analysisMetrics.length === 1 && analysisMetrics.includes(item))}
                      />
                      {ANALYSIS_METRIC_LABELS[item]}
                    </label>
                  ))}
                </fieldset>

                {analysisMetrics.includes('quantity') ? (
                  <fieldset className={styles.formatGroup}>
                    <legend>Hiển thị sản lượng</legend>
                    {(Object.keys(QUANTITY_DISPLAY_LABELS) as QuantityDisplay[]).map((item) => (
                      <label key={item}>
                        <input
                          type="radio"
                          name="sales-export-quantity-display"
                          value={item}
                          checked={quantityDisplay === item}
                          onChange={() => setQuantityDisplay(item)}
                          disabled={exporting}
                        />
                        {QUANTITY_DISPLAY_LABELS[item]}
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                <fieldset className={styles.formatGroup}>
                  <legend>Phân tích theo · chọn 2</legend>
                  {ANALYSIS_DIMENSIONS.map((item) => (
                    <label key={item}>
                      <input
                        type="checkbox"
                        checked={analysisDimensions.includes(item)}
                        onChange={() => toggleAnalysisDimension(item)}
                        disabled={exporting || (!analysisDimensions.includes(item) && analysisDimensions.length >= 2)}
                      />
                      {ANALYSIS_DIMENSION_LABELS[item]}
                    </label>
                  ))}
                </fieldset>

                <fieldset className={styles.formatGroup}>
                  <legend>Sắp xếp dòng</legend>
                  {analysisSortOptions.map((item) => (
                    <label key={item}>
                      <input
                        type="radio"
                        name="sales-export-sort"
                        value={item}
                        checked={analysisSort === item}
                        onChange={() => setAnalysisSort(item)}
                        disabled={exporting}
                      />
                      {ANALYSIS_SORT_LABELS[item]}
                    </label>
                  ))}
                </fieldset>

                <p className={styles.matrixHint}>{analysisSummary}</p>
                <p className={styles.matrixHint}>ĐVT nằm trong cùng một sheet; không tách báo cáo thành nhiều sheet theo đơn vị tính.</p>

                <div className={styles.columnHeader}>
                  <div><strong>Cột sẽ xuất</strong><small>{analysisSelectedColumns.length}/{analysisColumnOptions.length} cột</small></div>
                  <div className={styles.quickActions}>
                    <button type="button" onClick={() => setAnalysisSelectedColumns(analysisColumnOptions.map((item) => item.key))} disabled={analysisLoading}>Chọn tất cả</button>
                    <button type="button" onClick={() => setAnalysisSelectedColumns([])} disabled={analysisLoading}>Bỏ chọn</button>
                    <button type="button" onClick={() => setAnalysisSelectedColumns(analysisColumnOptions.map((item) => item.key))} disabled={analysisLoading}>Mặc định</button>
                  </div>
                </div>

                <div className={styles.columnGrid}>
                  {analysisLoading ? <span>Đang tải danh sách cột…</span> : null}
                  {!analysisLoading && analysisColumnOptions.map((option) => (
                    <label key={option.key}>
                      <input type="checkbox" checked={analysisSelected.has(option.key)} onChange={() => toggleAnalysisColumn(option.key)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  {!analysisLoading && analysisDimensions.length === 2 && analysisReport && analysisColumnOptions.length === 0 ? (
                    <span>Không có cột dữ liệu trong kỳ đang chọn.</span>
                  ) : null}
                </div>
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
              <button
                type="button"
                className={styles.exportButton}
                onClick={exportReport}
                disabled={exporting || (mode === 'list' ? selectedColumns.length === 0 : !analysisReady)}
              >
                {exporting ? 'Đang tạo file…' : mode === 'analysis' ? 'Xuất Excel' : `Xuất ${format === 'xlsx' ? 'Excel' : 'CSV'}`}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
