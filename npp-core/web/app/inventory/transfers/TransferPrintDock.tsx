'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import { formatDate, formatQuantity } from '../../../lib/inventory-types';
import type { InventoryTransfer } from './transfer-workspace';

const STATUS_LABEL: Record<InventoryTransfer['status'], string> = { draft: 'Nháp', approved: 'Đã duyệt', dispatched: 'Đã xuất kho nguồn', cancelled: 'Đã hủy' };
export default function TransferPrintDock({ transfer }: { transfer: InventoryTransfer | null }) {
  if (!transfer?.documentNumber || transfer.status === 'draft') return null;
  return <BusinessDocumentPrint
    id={`inventory-transfer-${transfer.id}`} actionLabel="In" title="PHIẾU CHUYỂN KHO" subtitle="Chứng từ điều chuyển tồn kho"
    number={transfer.documentNumber} status={STATUS_LABEL[transfer.status]}
    meta={[
      { label: 'Kho xuất', value: `${transfer.sourceWarehouseCode} — ${transfer.sourceWarehouseName}` }, { label: 'Kho nhận', value: `${transfer.destinationWarehouseCode} — ${transfer.destinationWarehouseName}` },
      { label: 'Ngày chuyển', value: formatDate(transfer.transferDate) }, { label: 'Ngày duyệt', value: formatDate(transfer.approvedAt) }, { label: 'Ngày xuất', value: formatDate(transfer.dispatchedAt) }, { label: 'Số dòng', value: transfer.lineCount },
    ]}
    columns={[{ key: 'no', label: 'STT', align: 'center' }, { key: 'item', label: 'Sản phẩm / SKU' }, { key: 'location', label: 'Vị trí / Lô' }, { key: 'qty', label: 'Số lượng', align: 'right' }, { key: 'unit', label: 'ĐVT', align: 'center' }, { key: 'base', label: 'SL cơ sở', align: 'right' }]}
    rows={(transfer.lines ?? []).map((line) => ({ id: line.id, cells: { no: line.lineNumber, item: <><strong>{line.itemName}</strong><br />{line.sourceSku}</>, location: `${line.sourceLocationId || '—'} / ${line.lotCode || '—'}`, qty: formatQuantity(line.sourceQuantity), unit: line.sourceUnitCode, base: formatQuantity(line.baseQuantity) } }))}
    totals={[{ label: 'Tổng SL cơ sở', value: formatQuantity(transfer.baseQuantityTotal), emphasis: true }]}
    note={transfer.status === 'cancelled' ? `ĐÃ HỦY${transfer.cancellationReason ? ` — ${transfer.cancellationReason}` : ''}` : transfer.note || undefined}
    signatures={['Người lập', 'Thủ kho xuất', 'Thủ kho nhận']} testId="inventory-transfer-print-sheet" />;
}
