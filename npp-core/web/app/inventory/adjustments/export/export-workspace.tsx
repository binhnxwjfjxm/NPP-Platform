'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../../components/app-shell-core';
import {
  INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS,
  INVENTORY_ADJUSTMENT_EXPORT_DEFAULT_COLUMNS,
  type InventoryAdjustmentExportColumnKey,
} from '../../../../lib/inventory-adjustment-export-model';
import { adjustmentKindLabels, adjustmentStatusLabels } from '../../../../lib/inventory-adjustment-types';
import { InventoryAdjustmentTabs } from '../adjustment-tabs';
import styles from '../workspace.module.css';

type ExportFormat = 'xlsx' | 'csv';

type ErrorEnvelope = {
  error?: { message?: string };
};

function filenameFrom(response: Response, format: ExportFormat): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/i.exec(disposition);
  return match?.[1] || `Dieu-chinh-ton.${format}`;
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

export default function InventoryAdjustmentExportWorkspace() {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [status, setStatus] = useState('');
  const [documentKind, setDocumentKind] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<Set<InventoryAdjustmentExportColumnKey>>(
    () => new Set(INVENTORY_ADJUSTMENT_EXPORT_DEFAULT_COLUMNS),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedCount = selectedColumns.size;
  const allSelected = selectedCount === INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS.length;
  const orderedColumns = useMemo(
    () => INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS.filter((item) => selectedColumns.has(item.key)).map((item) => item.key),
    [selectedColumns],
  );

  function toggleColumn(key: InventoryAdjustmentExportColumnKey) {
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
      const params = new URLSearchParams({ format });
      if (status) params.set('status', status);
      if (documentKind) params.set('documentKind', documentKind);
      for (const column of orderedColumns) params.append('column', column);
      const response = await fetch(`/api/inventory/adjustments/export?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as ErrorEnvelope | null;
        throw new Error(payload?.error?.message || 'Không xuất được dữ liệu điều chỉnh tồn.');
      }
      downloadBlob(await response.blob(), filenameFrom(response, format));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xuất được dữ liệu điều chỉnh tồn.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Điều chỉnh tồn"
      kicker="Tồn kho & lô hàng"
      subtitle="Xuất danh sách phiếu điều chỉnh theo đúng bộ lọc và thông tin cần đối chiếu."
    >
      <InventoryAdjustmentTabs active="export" />
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <section className={styles.panel} data-testid="inventory-adjustment-export-workspace">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Xuất dữ liệu</p>
            <h2>Phiếu điều chỉnh tồn</h2>
            <p>Dữ liệu được lấy từ server theo phạm vi kho được cấp, không lấy riêng danh sách đang hiển thị trên trình duyệt.</p>
          </div>
        </div>

        <div className={styles.formGrid}>
          <label>
            Trạng thái
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Tất cả</option>
              {Object.entries(adjustmentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Loại phiếu
            <select value={documentKind} onChange={(event) => setDocumentKind(event.target.value)}>
              <option value="">Tất cả</option>
              {Object.entries(adjustmentKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Định dạng
            <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
            </select>
          </label>
        </div>

        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Thông tin muốn xuất</h2>
              <p>Đã chọn {selectedCount}/{INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS.length} cột.</p>
            </div>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedColumns(new Set(INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS.map((item) => item.key)))}
                disabled={allSelected}
              >
                Chọn tất cả
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedColumns(new Set())}
                disabled={!selectedCount}
              >
                Bỏ chọn
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedColumns(new Set(INVENTORY_ADJUSTMENT_EXPORT_DEFAULT_COLUMNS))}
              >
                Cột mặc định
              </button>
            </div>
          </div>
          <div className={styles.formGrid}>
            {INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS.map((item) => (
              <label key={item.key}>
                <span>
                  <input
                    type="checkbox"
                    checked={selectedColumns.has(item.key)}
                    onChange={() => toggleColumn(item.key)}
                  />{' '}
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.actionRow}>
          <button type="button" className={styles.primaryButton} onClick={() => void exportData()} disabled={busy || !selectedCount}>
            {busy ? 'Đang tạo file…' : 'Xuất dữ liệu'}
          </button>
        </div>
      </section>
    </AppShell>
  );
}
