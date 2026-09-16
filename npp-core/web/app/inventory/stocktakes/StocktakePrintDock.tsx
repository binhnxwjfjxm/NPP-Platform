'use client';

import Link from 'next/link';
import BusinessDocumentPrint from '../../components/business-document-print';
import { formatDate, formatQuantity } from '../../../lib/inventory-types';
import type { Stocktake } from '../../../lib/stocktake-types';
import { STOCKTAKE_STATUS_LABELS } from '../../../lib/stocktake-types';
import styles from './stocktake-workspace.module.css';

export default function StocktakePrintDock({ stocktake }: { stocktake: Stocktake | null }) {
  if (!stocktake) return null;
  return (
    <div className={styles.actionRow} style={{ marginTop: 0 }} data-testid="stocktake-data-actions">
      <Link
        href="/operations/data-exchange?tab=stocktake"
        className={styles.secondaryButton}
        style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
      >
        Nhập/xuất kiểm kê
      </Link>
      <Link
        href="/operations/import-export-history"
        className={styles.secondaryButton}
        style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
      >
        Lịch sử file
      </Link>
      {stocktake.status !== 'draft' ? (
        <BusinessDocumentPrint
          id={`stocktake-${stocktake.id}`} documentType="STOCKTAKE" actionLabel="In" title="PHIẾU KIỂM KÊ" subtitle="Chứng từ kiểm kê kho"
          number={stocktake.stocktakeNumber} status={STOCKTAKE_STATUS_LABELS[stocktake.status]}
          meta={[{ key: 'warehouse', label: 'Kho', value: `${stocktake.warehouseCode} — ${stocktake.warehouseName}` }, { key: 'round', label: 'Vòng đếm', value: stocktake.currentRound }, { key: 'line_count', label: 'Số dòng', value: stocktake.lineCount }, { key: 'created_date', label: 'Ngày tạo', value: formatDate(stocktake.createdAt) }, { key: 'approved_date', label: 'Ngày duyệt', value: formatDate(stocktake.approvedAt) }, { key: 'posted_date', label: 'Ngày ghi sổ', value: formatDate(stocktake.postedAt) }]}
          columns={[{ key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' }, { key: 'sku', fieldKey: 'line_sku', label: 'SKU' }, { key: 'location', fieldKey: 'line_location', label: 'Vị trí / Lô' }, { key: 'expected', fieldKey: 'line_expected', label: 'Theo sổ', align: 'right' }, { key: 'counted', fieldKey: 'line_counted', label: 'Thực đếm', align: 'right' }, { key: 'delta', fieldKey: 'line_delta', label: 'Chênh lệch', align: 'right' }, { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' }]}
          rows={(stocktake.lines ?? []).map((line) => ({ id: line.id, cells: { no: line.lineNumber, sku: line.sourceSku, location: `${line.locationCode || '—'} / ${line.lotCode || '—'}`, expected: formatQuantity(line.expectedBaseQuantity ?? '0'), counted: line.countedBaseQuantity == null ? '—' : formatQuantity(line.countedBaseQuantity), delta: line.finalDelta == null ? '—' : formatQuantity(line.finalDelta), unit: line.sourceUnitCode } }))}
          note={stocktake.status === 'reversed' ? `ĐÃ ĐẢO${stocktake.reversalReason ? ` — ${stocktake.reversalReason}` : ''}` : stocktake.status === 'cancelled' ? `ĐÃ HỦY${stocktake.cancelReason ? ` — ${stocktake.cancelReason}` : ''}` : stocktake.note || undefined}
          signatures={['Người kiểm kê', 'Thủ kho', 'Người duyệt']} testId="stocktake-print-sheet" />
      ) : null}
    </div>
  );
}
