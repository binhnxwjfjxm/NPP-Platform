'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MANUAL_INBOUND_EXPORT_COLUMN_OPTIONS,
  MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS,
  type ManualInboundExportColumnKey,
  type ManualInboundExportType,
} from '../../../lib/manual-inbound-export-model';
import styles from '../../components/sales-reporting-export-dialog.module.css';

type Props = Readonly<{
  inboundType: '' | ManualInboundExportType;
  referenceNumber: string;
}>;

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = /filename="([^"\r\n]+)"/i.exec(value ?? '');
  return match?.[1] || fallback;
}

export default function ManualInboundExportDialog({ inboundType, referenceNumber }: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [selectedColumns, setSelectedColumns] = useState<readonly ManualInboundExportColumnKey[]>(
    MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS,
  );
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(() => new Set(selectedColumns), [selectedColumns]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, exporting]);

  function openDialog() {
    setFormat('xlsx');
    setSelectedColumns(MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS);
    setError('');
    setOpen(true);
  }

  function toggleColumn(key: ManualInboundExportColumnKey) {
    setSelectedColumns((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  }

  async function exportData() {
    if (exporting || selectedColumns.length === 0) return;
    setExporting(true);
    setError('');
    try {
      const query = new URLSearchParams({ format });
      if (inboundType) query.set('inboundType', inboundType);
      if (referenceNumber.trim()) query.set('referenceNumber', referenceNumber.trim());
      for (const key of selectedColumns) query.append('column', key);

      const response = await fetch(`/api/inventory/manual-inbounds/export?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || 'Không xuất được lịch sử nhập kho thủ công.');
      }

      const blob = await response.blob();
      const fallback = `Nhap-kho-thu-cong.${format}`;
      const downloadName = filenameFromDisposition(response.headers.get('content-disposition'), fallback);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = downloadName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setOpen(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Không xuất được lịch sử nhập kho thủ công.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.openButton} onClick={openDialog} data-testid="manual-inbound-export-button">
        Xuất dữ liệu
      </button>
      {open ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !exporting) setOpen(false);
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="manual-inbound-export-title">
            <div className={styles.heading}>
              <div>
                <p>Xuất dữ liệu</p>
                <h2 id="manual-inbound-export-title">Lịch sử nhập kho thủ công</h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} disabled={exporting} aria-label="Đóng cửa sổ xuất dữ liệu">×</button>
            </div>

            <p className={styles.description}>
              Xuất toàn bộ chứng từ phù hợp với loại nhập và số chứng từ tham chiếu đang áp dụng, không phụ thuộc 12 dòng đang hiển thị trên màn hình.
            </p>

            <fieldset className={styles.formatGroup}>
              <legend>Định dạng file</legend>
              <label><input type="radio" name="manual-inbound-export-format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (.xlsx)</label>
              <label><input type="radio" name="manual-inbound-export-format" value="csv" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV (.csv)</label>
            </fieldset>

            <div className={styles.columnHeader}>
              <div><strong>Cột cần xuất</strong><small>{selectedColumns.length}/{MANUAL_INBOUND_EXPORT_COLUMN_OPTIONS.length} cột</small></div>
              <div className={styles.quickActions}>
                <button type="button" onClick={() => setSelectedColumns(MANUAL_INBOUND_EXPORT_COLUMN_OPTIONS.map((item) => item.key))}>Chọn tất cả</button>
                <button type="button" onClick={() => setSelectedColumns([])}>Bỏ chọn</button>
                <button type="button" onClick={() => setSelectedColumns(MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS)}>Mặc định</button>
              </div>
            </div>

            <div className={styles.columnGrid}>
              {MANUAL_INBOUND_EXPORT_COLUMN_OPTIONS.map((option) => (
                <label key={option.key}>
                  <input type="checkbox" checked={selected.has(option.key)} onChange={() => toggleColumn(option.key)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            {error ? <div className={styles.error} role="alert">{error}</div> : null}

            <div className={styles.footer}>
              <button type="button" className={styles.cancelButton} onClick={() => setOpen(false)} disabled={exporting}>Hủy</button>
              <button type="button" className={styles.exportButton} onClick={() => void exportData()} disabled={exporting || selectedColumns.length === 0}>
                {exporting ? 'Đang tạo file…' : `Xuất ${format === 'xlsx' ? 'Excel' : 'CSV'}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
