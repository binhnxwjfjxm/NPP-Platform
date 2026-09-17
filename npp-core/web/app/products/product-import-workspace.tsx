'use client';

import { useEffect, useRef, useState } from 'react';
import { DataExchangeImportPreview } from '../operations/data-exchange/data-exchange-preview';
import { buildDataExchangeImportActions } from '../operations/data-exchange/data-exchange-import-actions';
import {
  PRODUCT_COLUMNS,
  labelFor,
  type PendingImport,
  type PriceList,
  type Unit,
} from '../operations/data-exchange/data-exchange-model';
import { requestJson } from '../operations/data-exchange/data-exchange-file-utils';
import exchangeStyles from '../operations/data-exchange/data-exchange.module.css';
import styles from './products.module.css';

type Props = {
  onImported?: () => Promise<void> | void;
};

export default function ProductImportWorkspace({ onImported }: Props) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [productColumns, setProductColumns] = useState<Set<string>>(new Set(PRODUCT_COLUMNS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const importOperationKeyRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshReferenceData() {
    const nextUnits = await requestJson<Unit[]>('/api/units?limit=1000');
    setUnits(nextUnits);
    await onImported?.();
  }

  useEffect(() => {
    requestJson<Unit[]>('/api/units?limit=1000')
      .then(setUnits)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Không tải được đơn vị tính.'));
  }, []);

  function begin() {
    setBusy(true);
    setError('');
    setMessage('');
  }

  function fail(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất thao tác.');
  }

  const {
    productTemplate,
    productExport,
    prepareImport,
    confirmPendingImport,
    updatePendingRow,
  } = buildDataExchangeImportActions({
    units,
    productColumns,
    pendingImport,
    importOperationKeyRef,
    setPendingImport,
    refreshReferenceData,
    setMessage,
    setBusy,
    fail,
    begin,
    priceLists: [] as PriceList[],
    pricingPriceListId: '',
    warehouses: [],
    stocktakeWarehouse: '',
  });

  function toggleColumn(column: string) {
    setProductColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }

  return (
    <section data-testid="product-import-workspace" className={styles.bulkUpdateWorkspace}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Nhập sản phẩm</h3>
          <p>Tạo sản phẩm/SKU mới hoặc nhập chồng dữ liệu đã có ngay trong Danh mục sản phẩm. Giữ nguyên quy trình xem trước trước khi ghi.</p>
        </div>
      </div>

      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      {message ? <div className={styles.noticeBanner} role="status">{message}</div> : null}

      <div className={styles.updateUploadPanel}>
        <label className={styles.updateFileField}>
          <span>Tệp Excel hoặc CSV</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void prepareImport('products', file);
              event.currentTarget.value = '';
            }}
            data-testid="product-import-file"
          />
        </label>
        <div className={styles.updateActionBar}>
          <button type="button" className={styles.secondaryButton} onClick={() => void productTemplate('xlsx')} disabled={busy}>Tải mẫu Excel</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void productTemplate('csv')} disabled={busy}>Tải mẫu CSV</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void productExport('xlsx')} disabled={busy}>Xuất Excel</button>
          <button type="button" className={styles.secondaryButton} onClick={() => void productExport('csv')} disabled={busy}>Xuất CSV</button>
        </div>
      </div>

      <div className={styles.sourcePreviewCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>Thông tin xuất file</h3>
            <p>Chọn các cột cần lấy khi xuất danh mục sản phẩm/SKU hiện tại.</p>
          </div>
        </div>
        <div className={exchangeStyles.columnGrid}>
          {PRODUCT_COLUMNS.map((column) => (
            <label key={column}>
              <input type="checkbox" checked={productColumns.has(column)} onChange={() => toggleColumn(column)} />
              {labelFor(column)}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.sourcePreviewCard}>
        <strong>Nguyên tắc nhập</strong>
        <p>File có mã sản phẩm/SKU mới thì tạo mới; mã đã có thì cập nhật theo hợp đồng nhập hiện tại. Không chuyển sang màn Nhập/xuất dữ liệu để thao tác sản phẩm.</p>
      </div>

      <DataExchangeImportPreview
        ctx={{
          pendingImport,
          tab: 'products',
          setPendingImport,
          busy,
          confirmPendingImport,
          units,
          updatePendingRow,
        }}
      />
    </section>
  );
}
