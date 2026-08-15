'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import { formatDate, formatQuantity } from '../../../lib/inventory-types';
import type { Stocktake } from '../../../lib/stocktake-types';
import { STOCKTAKE_STATUS_LABELS } from '../../../lib/stocktake-types';

export default function StocktakePrintDock({ stocktake }: { stocktake: Stocktake | null }) {
  if (!stocktake || stocktake.status === 'draft') return null;
  return <BusinessDocumentPrint
    id={`stocktake-${stocktake.id}`} actionLabel="In" title="PHIẾU KIỂM KÊ" subtitle="Chứng từ kiểm kê kho"
    number={stocktake.stocktakeNumber} status={STOCKTAKE_STATUS_LABELS[stocktake.status]}
    meta={[{ label: 'Kho', value: `${stocktake.warehouseCode} — ${stocktake.warehouseName}` }, { label: 'Vòng đếm', value: stocktake.currentRound }, { label: 'Số dòng', value: stocktake.lineCount }, { label: 'Ngày tạo', value: formatDate(stocktake.createdAt) }, { label: 'Ngày duyệt', value: formatDate(stocktake.approvedAt) }, { label: 'Ngày ghi sổ', value: formatDate(stocktake.postedAt) }]}
    columns={[{ key: 'no', label: 'STT', align: 'center' }, { key: 'sku', label: 'SKU' }, { key: 'location', label: 'Vị trí / Lô' }, { key: 'expected', label: 'Theo sổ', align: 'right' }, { key: 'counted', label: 'Thực đếm', align: 'right' }, { key: 'delta', label: 'Chênh lệch', align: 'right' }, { key: 'unit', label: 'ĐVT', align: 'center' }]}
    rows={(stocktake.lines ?? []).map((line) => ({ id: line.id, cells: { no: line.lineNumber, sku: line.sourceSku, location: `${line.locationCode || '—'} / ${line.lotCode || '—'}`, expected: formatQuantity(line.expectedBaseQuantity ?? '0'), counted: line.countedBaseQuantity == null ? '—' : formatQuantity(line.countedBaseQuantity), delta: line.finalDelta == null ? '—' : formatQuantity(line.finalDelta), unit: line.sourceUnitCode } }))}
    note={stocktake.status === 'reversed' ? `ĐÃ ĐẢO${stocktake.reversalReason ? ` — ${stocktake.reversalReason}` : ''}` : stocktake.status === 'cancelled' ? `ĐÃ HỦY${stocktake.cancelReason ? ` — ${stocktake.cancelReason}` : ''}` : stocktake.note || undefined}
    signatures={['Người kiểm kê', 'Thủ kho', 'Người duyệt']} testId="stocktake-print-sheet" />;
}
