'use client';

import { useMemo, useRef, useState } from 'react';
import { readSpreadsheetMatrix } from '../../lib/spreadsheet-matrix';
import ProductImportWorkspace from './product-import-workspace';
import styles from './products.module.css';

type Mapping =
  | 'SKU'
  | 'IGNORE'
  | 'PRODUCT_NAME'
  | 'CATALOG_NAME'
  | 'CATEGORY_CODE'
  | 'BRAND_CODE'
  | 'DESCRIPTION'
  | 'NOTES'
  | 'PRODUCT_CATALOG_VISIBLE'
  | 'PRODUCT_ORDERABLE'
  | 'PRODUCT_INVENTORY_MANAGED'
  | 'PRODUCT_ACTIVE'
  | 'VARIANT_NAME'
  | 'VARIANT_KIND'
  | 'INVENTORY_BASE'
  | 'SELLABLE'
  | 'VARIANT_CATALOG_VISIBLE'
  | 'VARIANT_ACTIVE'
  | 'UNIT_CODE'
  | 'CONVERSION_TO_BASE'
  | 'PURCHASABLE'
  | 'NET_CONTENT_VALUE'
  | 'NET_CONTENT_UOM'
  | 'SOURCE_UNIT_LABEL'
  | 'SOURCE_PACKAGE_DESCRIPTION'
  | 'WEIGHT_VALUE'
  | 'WEIGHT_UOM';

type SourceRow = { rowNumber: number; cells: string[] };
type PreviewChange = { field: string; label: string; oldValue: string; newValue: string };
type PreviewError = { code: string; message: string };
type PreviewRow = {
  rowNumber: number;
  sku: string;
  status: 'ready' | 'updated' | 'unchanged' | 'error';
  errors: PreviewError[];
  changes: PreviewChange[];
  cells: unknown[];
};
type PreviewResult = {
  updated: number;
  skipped: number;
  ready?: number;
  unchanged?: number;
  rows: PreviewRow[];
  operationKey?: string;
};
type IdentificationRow = {
  rowNumber: number;
  sku: string;
  productName: string;
  variantName: string;
  status: 'identified' | 'error';
  errors: PreviewError[];
  cells: unknown[];
};
type IdentificationResult = {
  identified: number;
  skipped: number;
  rows: IdentificationRow[];
};
type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string; code?: string };
};
type WorkspaceMode = 'import' | 'update';

type Props = {
  onImported?: () => Promise<void> | void;
};

const OPTIONS: Array<{ value: Mapping; label: string }> = [
  { value: 'IGNORE', label: 'Bỏ qua' },
  { value: 'PRODUCT_NAME', label: 'Tên sản phẩm' },
  { value: 'CATALOG_NAME', label: 'Tên hiển thị bán hàng' },
  { value: 'CATEGORY_CODE', label: 'Loại sản phẩm' },
  { value: 'BRAND_CODE', label: 'Nhãn hàng' },
  { value: 'DESCRIPTION', label: 'Mô tả' },
  { value: 'NOTES', label: 'Ghi chú' },
  { value: 'PRODUCT_CATALOG_VISIBLE', label: 'Hiển thị sản phẩm khi bán hàng' },
  { value: 'PRODUCT_ORDERABLE', label: 'Cho phép đặt hàng' },
  { value: 'PRODUCT_INVENTORY_MANAGED', label: 'Quản lý tồn kho' },
  { value: 'PRODUCT_ACTIVE', label: 'Sản phẩm đang sử dụng' },
  { value: 'VARIANT_NAME', label: 'Tên SKU / quy cách' },
  { value: 'VARIANT_KIND', label: 'Loại SKU' },
  { value: 'INVENTORY_BASE', label: 'SKU dùng làm đơn vị tồn chuẩn' },
  { value: 'SELLABLE', label: 'Cho phép bán SKU' },
  { value: 'VARIANT_CATALOG_VISIBLE', label: 'Hiển thị SKU khi bán hàng' },
  { value: 'VARIANT_ACTIVE', label: 'SKU đang sử dụng' },
  { value: 'UNIT_CODE', label: 'Đơn vị tính' },
  { value: 'CONVERSION_TO_BASE', label: 'Hệ số quy đổi về đơn vị tồn chuẩn' },
  { value: 'PURCHASABLE', label: 'Cho phép mua SKU' },
  { value: 'NET_CONTENT_VALUE', label: 'Định lượng quy cách' },
  { value: 'NET_CONTENT_UOM', label: 'Đơn vị định lượng' },
  { value: 'SOURCE_UNIT_LABEL', label: 'Tên đơn vị nguồn' },
  { value: 'SOURCE_PACKAGE_DESCRIPTION', label: 'Mô tả quy cách nguồn' },
  { value: 'WEIGHT_VALUE', label: 'Khối lượng' },
  { value: 'WEIGHT_UOM', label: 'Đơn vị khối lượng' },
];

const HEADER_ALIASES = new Map<string, Mapping>([
  ['TEN SAN PHAM', 'PRODUCT_NAME'], ['PRODUCTNAME', 'PRODUCT_NAME'],
  ['TEN HIEN THI BAN HANG', 'CATALOG_NAME'], ['CATALOGNAME', 'CATALOG_NAME'],
  ['LOAI SAN PHAM', 'CATEGORY_CODE'], ['MA LOAI SAN PHAM', 'CATEGORY_CODE'], ['CATEGORYCODE', 'CATEGORY_CODE'],
  ['NHAN HANG', 'BRAND_CODE'], ['MA NHAN HANG', 'BRAND_CODE'], ['BRANDCODE', 'BRAND_CODE'],
  ['MO TA', 'DESCRIPTION'], ['DESCRIPTION', 'DESCRIPTION'],
  ['GHI CHU', 'NOTES'], ['NOTES', 'NOTES'],
  ['HIEN THI SAN PHAM KHI BAN HANG', 'PRODUCT_CATALOG_VISIBLE'], ['PRODUCTISCATALOGVISIBLE', 'PRODUCT_CATALOG_VISIBLE'],
  ['CHO PHEP DAT HANG', 'PRODUCT_ORDERABLE'], ['PRODUCTISORDERABLE', 'PRODUCT_ORDERABLE'],
  ['QUAN LY TON KHO', 'PRODUCT_INVENTORY_MANAGED'], ['ISINVENTORYMANAGED', 'PRODUCT_INVENTORY_MANAGED'],
  ['SAN PHAM DANG SU DUNG', 'PRODUCT_ACTIVE'], ['PRODUCTISACTIVE', 'PRODUCT_ACTIVE'],
  ['TEN SKU', 'VARIANT_NAME'], ['TEN SKU / QUY CACH', 'VARIANT_NAME'], ['SKUNAME', 'VARIANT_NAME'],
  ['LOAI SKU', 'VARIANT_KIND'], ['VARIANTKIND', 'VARIANT_KIND'],
  ['SKU DUNG LAM DON VI TON CHUAN', 'INVENTORY_BASE'], ['TON CHUAN', 'INVENTORY_BASE'], ['ISINVENTORYBASE', 'INVENTORY_BASE'],
  ['CHO PHEP BAN SKU', 'SELLABLE'], ['ISSELLABLE', 'SELLABLE'],
  ['HIEN THI SKU KHI BAN HANG', 'VARIANT_CATALOG_VISIBLE'], ['ISCATALOGVISIBLE', 'VARIANT_CATALOG_VISIBLE'],
  ['SKU DANG SU DUNG', 'VARIANT_ACTIVE'], ['ISACTIVE', 'VARIANT_ACTIVE'],
  ['DON VI TINH', 'UNIT_CODE'], ['UNITCODE', 'UNIT_CODE'],
  ['HE SO QUY DOI VE DON VI TON CHUAN', 'CONVERSION_TO_BASE'], ['HE SO QUY DOI', 'CONVERSION_TO_BASE'], ['CONVERSIONTOBASE', 'CONVERSION_TO_BASE'],
  ['CHO PHEP MUA SKU', 'PURCHASABLE'], ['ISPURCHASABLE', 'PURCHASABLE'],
  ['DINH LUONG QUY CACH', 'NET_CONTENT_VALUE'], ['NETCONTENTVALUE', 'NET_CONTENT_VALUE'],
  ['DON VI DINH LUONG', 'NET_CONTENT_UOM'], ['NETCONTENTUOMCODE', 'NET_CONTENT_UOM'],
  ['TEN DON VI NGUON', 'SOURCE_UNIT_LABEL'], ['SOURCEUNITLABEL', 'SOURCE_UNIT_LABEL'],
  ['MO TA QUY CACH NGUON', 'SOURCE_PACKAGE_DESCRIPTION'], ['SOURCEPACKAGEDESCRIPTION', 'SOURCE_PACKAGE_DESCRIPTION'],
  ['KHOI LUONG', 'WEIGHT_VALUE'], ['WEIGHTVALUE', 'WEIGHT_VALUE'],
  ['DON VI KHOI LUONG', 'WEIGHT_UOM'], ['WEIGHTUOMCODE', 'WEIGHT_UOM'],
]);

function headerKey(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function initialMappings(columnCount: number, headers: string[] = [], useHeaders = false): Mapping[] {
  const seen = new Set<Mapping>();
  return Array.from({ length: columnCount }, (_value, index) => {
    if (index === 0) return 'SKU';
    if (!useHeaders) return 'IGNORE';
    const mapping = HEADER_ALIASES.get(headerKey(headers[index] ?? '')) ?? 'IGNORE';
    if (mapping === 'IGNORE' || seen.has(mapping)) return 'IGNORE';
    seen.add(mapping);
    return mapping;
  });
}

function sourceRowsFor(matrix: string[][], skipFirst: boolean): SourceRow[] {
  const source = skipFirst ? matrix.slice(1) : matrix;
  const start = skipFirst ? 2 : 1;
  return source.map((cells, index) => ({ rowNumber: start + index, cells }));
}

function rowStatus(row: PreviewRow, applied: boolean) {
  if (row.errors.length > 0 || row.status === 'error') return row.errors[0]?.message ?? 'Có lỗi — bỏ qua';
  if (!applied && row.changes.length > 0 && row.changes.every((change) => change.oldValue === change.newValue)) return 'Không thay đổi';
  if (!applied) return row.changes.length > 0 ? 'Sẽ cập nhật' : 'Không thay đổi';
  if (row.status === 'updated') return 'Đã cập nhật';
  return 'Không thay đổi';
}

function sourceCell(value: unknown) {
  const text = String(value ?? '');
  return text === '' ? 'Trống' : text;
}

export default function ProductBulkUpdateWorkspace({ onImported }: Props) {
  const [mode, setMode] = useState<WorkspaceMode>('update');

  return (
    <section data-testid="product-bulk-update-workspace" className={styles.bulkUpdateWorkspace}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Nhập / cập nhật sản phẩm</h2>
          <p>Làm việc với tệp sản phẩm ngay trong Danh mục sản phẩm, không cần chuyển sang màn Nhập/xuất dữ liệu.</p>
        </div>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Nhập hoặc cập nhật sản phẩm">
        <button type="button" className={mode === 'import' ? styles.tabActive : styles.tab} onClick={() => setMode('import')}>Nhập sản phẩm</button>
        <button type="button" className={mode === 'update' ? styles.tabActive : styles.tab} onClick={() => setMode('update')}>Cập nhật sản phẩm</button>
      </div>
      {mode === 'import' ? <ProductImportWorkspace onImported={onImported} /> : <UpdateExistingProductsWorkspace />}
    </section>
  );
}

function UpdateExistingProductsWorkspace() {
  const [fileName, setFileName] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [identification, setIdentification] = useState<IdentificationResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const identificationRequest = useRef(0);

  const columnCount = useMemo(() => matrix.reduce((max, row) => Math.max(max, row.length), 0), [matrix]);
  const dataRows = useMemo(() => sourceRowsFor(matrix, hasHeader), [matrix, hasHeader]);
  const headerCells = hasHeader ? (matrix[0] ?? []) : [];
  const identificationByRow = useMemo(
    () => new Map((identification?.rows ?? []).map((row) => [row.rowNumber, row])),
    [identification],
  );
  const missingSkuCount = useMemo(
    () => (identification?.rows ?? []).filter((row) => row.errors.some((item) => item.code === 'SKU_NOT_FOUND')).length,
    [identification],
  );
  const otherSkuErrorCount = Math.max(0, (identification?.skipped ?? 0) - missingSkuCount);
  const hasUpdateMapping = mappings.some((mapping, index) => index > 0 && mapping !== 'IGNORE');

  function invalidatePreview() {
    setPreview(null);
    setOperationKey(null);
    setApplied(false);
    setNotice(null);
  }

  async function identifyRows(rows: SourceRow[]) {
    const requestNumber = identificationRequest.current + 1;
    identificationRequest.current = requestNumber;
    setIdentification(null);
    invalidatePreview();
    if (rows.length === 0) {
      setIdentifying(false);
      setError('Không có dòng dữ liệu sau khi bỏ dòng đầu');
      return;
    }
    setIdentifying(true);
    setError(null);
    try {
      const response = await fetch('/api/products/variants/identify', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const envelope = await response.json() as ApiEnvelope<IdentificationResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể nhận diện SKU trong tệp');
      if (identificationRequest.current !== requestNumber) return;
      setIdentification(envelope.data);
    } catch (value) {
      if (identificationRequest.current !== requestNumber) return;
      setIdentification(null);
      setError(value instanceof Error ? value.message : 'Không thể nhận diện SKU trong tệp');
    } finally {
      if (identificationRequest.current === requestNumber) setIdentifying(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    identificationRequest.current += 1;
    setReadingFile(true);
    setError(null);
    setNotice(null);
    try {
      const rows = await readSpreadsheetMatrix(file);
      const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
      if (rows.length === 0 || columns < 2) throw new Error('Tệp cần có cột 1 là SKU và ít nhất một cột dữ liệu');
      const skipFirst = true;
      setFileName(file.name);
      setMatrix(rows);
      setHasHeader(skipFirst);
      setMappings(initialMappings(columns, rows[0] ?? [], skipFirst));
      setIdentification(null);
      setPreview(null);
      setOperationKey(null);
      setApplied(false);
      void identifyRows(sourceRowsFor(rows, skipFirst));
    } catch (value) {
      setFileName('');
      setMatrix([]);
      setMappings([]);
      setIdentification(null);
      setPreview(null);
      setOperationKey(null);
      setApplied(false);
      setError(value instanceof Error ? value.message : 'Không đọc được tệp cập nhật');
    } finally {
      setReadingFile(false);
    }
  }

  function resetFile() {
    identificationRequest.current += 1;
    setFileName('');
    setMatrix([]);
    setMappings([]);
    setIdentification(null);
    setPreview(null);
    setOperationKey(null);
    setApplied(false);
    setError(null);
    setNotice(null);
    setIdentifying(false);
    setFileInputKey((value) => value + 1);
  }

  function setMapping(index: number, value: Mapping) {
    if (index === 0) return;
    if (value !== 'IGNORE' && mappings.some((item, itemIndex) => itemIndex !== index && item === value)) {
      setError('Một thuộc tính chỉ được chọn cho một cột');
      return;
    }
    setError(null);
    setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
    invalidatePreview();
  }

  function payload(dryRun: boolean) {
    return { dryRun, mappings, rows: dataRows };
  }

  async function requestPreview() {
    if (identifying) {
      setError('Đang nhận diện SKU, vui lòng chờ hoàn tất');
      return;
    }
    if (dataRows.length === 0) {
      setError('Không có dòng dữ liệu để xem trước');
      return;
    }
    if (!hasUpdateMapping) {
      setError('Chọn ít nhất một thuộc tính cần cập nhật từ cột 2 trở đi');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/products/variants/bulk-update', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(true)),
      });
      const envelope = await response.json() as ApiEnvelope<PreviewResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể tạo bản xem trước');
      setPreview(envelope.data);
      setOperationKey(envelope.data.operationKey ?? null);
      setApplied(false);
      setNotice(`Đã đối chiếu ${envelope.data.rows.length} dòng. ${envelope.data.skipped} dòng có lỗi sẽ được bỏ qua.`);
    } catch (value) {
      setPreview(null);
      setOperationKey(null);
      setError(value instanceof Error ? value.message : 'Không thể tạo bản xem trước');
    } finally {
      setBusy(false);
    }
  }

  async function applyUpdate() {
    if (!preview || !operationKey || applied) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/products/variants/bulk-update', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify(payload(false)),
      });
      const envelope = await response.json() as ApiEnvelope<PreviewResult>;
      if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không thể cập nhật sản phẩm');
      setPreview(envelope.data);
      setApplied(true);
      setNotice(`Đã cập nhật ${envelope.data.updated} dòng. ${envelope.data.skipped} dòng có lỗi đã được bỏ qua.`);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể cập nhật sản phẩm');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="product-update-existing-workspace" className={styles.bulkUpdateWorkspace}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Cập nhật sản phẩm theo SKU</h3>
          <p>Cột 1 luôn là SKU. Từ cột 2 trở đi, mỗi cột chọn một thuộc tính cần cập nhật. SKU hoặc dòng lỗi được báo và bỏ qua; các dòng hợp lệ vẫn tiếp tục.</p>
        </div>
      </div>

      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {notice ? <div className={styles.noticeBanner}>{notice}</div> : null}

      <div className={styles.updateUploadPanel}>
        <label className={styles.updateFileField}>
          <span>Tệp Excel hoặc CSV</span>
          <input
            key={fileInputKey}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={readingFile || busy}
            onChange={(event) => void loadFile(event.target.files?.[0])}
            data-testid="product-update-file"
          />
        </label>
        <label className={styles.updateHeaderToggle}>
          <input
            type="checkbox"
            checked={hasHeader}
            disabled={readingFile || busy || matrix.length === 0}
            onChange={(event) => {
              const next = event.target.checked;
              setHasHeader(next);
              setMappings(initialMappings(columnCount, matrix[0] ?? [], next));
              void identifyRows(sourceRowsFor(matrix, next));
            }}
          />
          <span>Bỏ dòng đầu nếu là tiêu đề</span>
        </label>
        {fileName ? <div className={styles.selectedFile}>Đã chọn: <strong>{fileName}</strong></div> : null}
      </div>

      {matrix.length > 0 ? (
        <div className={styles.sourcePreviewCard} data-testid="product-update-source-preview">
          <div className={styles.updateSummaryBar}>
            <span><strong>{dataRows.length}</strong> dòng dữ liệu</span>
            <span><strong>{columnCount}</strong> cột từ tệp</span>
            <span className={styles.summarySuccess}><strong>{identification?.identified ?? 0}</strong> SKU hợp lệ</span>
            <span className={missingSkuCount > 0 ? styles.summaryError : undefined}><strong>{missingSkuCount}</strong> SKU không tồn tại</span>
            {otherSkuErrorCount > 0 ? <span className={styles.summaryError}><strong>{otherSkuErrorCount}</strong> dòng SKU khác có lỗi</span> : null}
            {identifying ? <span className={styles.summaryPending}>Đang nhận diện SKU…</span> : null}
          </div>

          <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.updateSourceTable}`}>
              <thead>
                <tr>
                  <th>
                    <div className={styles.updateColumnHeader}>
                      <strong>Cột 1 · SKU</strong>
                      <span className={styles.queryKeyBadge}>Khóa truy vấn</span>
                      {hasHeader && headerCells[0] ? <small>{headerCells[0]}</small> : null}
                    </div>
                  </th>
                  <th>
                    <div className={styles.updateColumnHeader}>
                      <strong>Tên sản phẩm</strong>
                      <small>Tự nhận diện từ SKU</small>
                    </div>
                  </th>
                  {Array.from({ length: Math.max(0, columnCount - 1) }, (_value, offset) => {
                    const index = offset + 1;
                    return (
                      <th key={index}>
                        <div className={styles.updateColumnHeader}>
                          <strong>Cột {index + 1}</strong>
                          {hasHeader && headerCells[index] ? <small>{headerCells[index]}</small> : null}
                          <select
                            value={mappings[index] ?? 'IGNORE'}
                            disabled={busy}
                            onChange={(event) => setMapping(index, event.target.value as Mapping)}
                            aria-label={`Thuộc tính cột ${index + 1}`}
                          >
                            {OPTIONS.map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                                disabled={option.value !== 'IGNORE' && mappings.some((item, itemIndex) => itemIndex !== index && item === option.value)}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </th>
                    );
                  })}
                  <th>Trạng thái nhận diện SKU</th>
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row) => {
                  const identifiedRow = identificationByRow.get(row.rowNumber);
                  const rowError = identifiedRow?.errors[0];
                  return (
                    <tr key={row.rowNumber} className={rowError ? styles.updateErrorRow : undefined}>
                      <td><strong>{sourceCell(row.cells[0])}</strong></td>
                      <td>{identifiedRow?.productName || (identifying ? 'Đang tra cứu…' : '—')}</td>
                      {Array.from({ length: Math.max(0, columnCount - 1) }, (_value, offset) => (
                        <td key={offset + 1}>{sourceCell(row.cells[offset + 1])}</td>
                      ))}
                      <td>
                        {rowError ? (
                          <span className={styles.skuStatusError}>{rowError.message}</span>
                        ) : identifiedRow?.status === 'identified' ? (
                          <span className={styles.skuStatusSuccess}>Đã nhận diện</span>
                        ) : (
                          <span className={styles.skuStatusPending}>{identifying ? 'Đang tra cứu…' : 'Chưa nhận diện'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.updateActionBar}>
            <button type="button" className={styles.secondaryButton} disabled={readingFile || busy} onClick={resetFile}>Làm mới tệp</button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={readingFile || identifying || busy || !identification || !hasUpdateMapping}
              onClick={() => void requestPreview()}
              data-testid="product-update-preview"
            >
              Xem trước thay đổi
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className={styles.changePreviewCard} data-testid="product-update-change-preview">
          <div className={styles.sectionHeader}>
            <div>
              <h3>Xem trước thay đổi</h3>
              <p>Đối chiếu dữ liệu hiện tại trong Công Ty với giá trị từ tệp trước khi cập nhật.</p>
            </div>
          </div>
          <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.changePreviewTable}`}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Tên sản phẩm</th>
                  <th>Thuộc tính</th>
                  <th>Giá trị cũ</th>
                  <th>Giá trị mới</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.flatMap((row) => {
                  const productName = identificationByRow.get(row.rowNumber)?.productName || '—';
                  if (row.errors.length > 0) {
                    return [(
                      <tr key={`${row.rowNumber}-error`} className={styles.updateErrorRow}>
                        <td>{row.sku || sourceCell(row.cells[0])}</td>
                        <td>{productName}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td><span className={styles.skuStatusError}>{row.errors[0].message}</span></td>
                      </tr>
                    )];
                  }
                  if (row.changes.length === 0) {
                    return [(
                      <tr key={`${row.rowNumber}-unchanged`}>
                        <td>{row.sku}</td>
                        <td>{productName}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td>Không thay đổi</td>
                      </tr>
                    )];
                  }
                  return row.changes.map((change) => (
                    <tr key={`${row.rowNumber}-${change.field}`}>
                      <td>{row.sku}</td>
                      <td>{productName}</td>
                      <td>{change.label}</td>
                      <td>{change.oldValue}</td>
                      <td>{change.newValue}</td>
                      <td>{rowStatus(row, applied)}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.updateActionBar}>
            <span className={styles.updateActionHint}>Chỉ các dòng hợp lệ mới được cập nhật.</span>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || !operationKey || applied || (preview.ready ?? 0) === 0}
              onClick={() => void applyUpdate()}
              data-testid="product-update-apply"
            >
              {applied ? 'Đã cập nhật' : 'Cập nhật các dòng hợp lệ'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
