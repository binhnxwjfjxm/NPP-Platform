'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import { formatDate, formatQuantity } from '../../../lib/inventory-types';
import type { InventoryTransfer } from './transfer-workspace';

const STATUS_LABEL: Record<InventoryTransfer['status'], string> = { draft: 'Nháp', approved: 'Đã duyệt', dispatched: 'Đã xuất kho nguồn', cancelled: 'Đã hủy' };
export default function TransferPrintDock({ transfer }: { transfer: InventoryTransfer | null }) {
  if (!transfer?.documentNumber || transfer.status === 'draft') return null;
  return <BusinessDocumentPrint
    id={`inventory-transfer-${transfer.id}`} documentType="INVENTORY_TRANSFER" actionLabel="In" title="PHIẾU CHUYỂN KHO" subtitle="Chứng từ điều chuyển tồn kho"
    number={transfer.documentNumber} status={STATUS_LABEL[transfer.status]}
    meta={[
      { key: 'source_warehouse', label: 'Kho xuất', value: `${transfer.sourceWarehouseCode} — ${transfer.sourceWarehouseName}` }, { key: 'destination_warehouse', label: 'Kho nhận', value: `${transfer.destinationWarehouseCode} — ${transfer.destinationWarehouseName}` },
      { key: 'transfer_date', label: 'Ngày chuyển', value: formatDate(transfer.transferDate) }, { key: 'approved_date', label: 'Ngày duyệt', value: formatDate(transfer.approvedAt) }, { key: 'dispatched_date', label: 'Ngày xuất', value: formatDate(transfer.dispatchedAt) }, { key: 'line_count', label: 'Số dòng', value: transfer.lineCount },
    ]}
    columns={[{ key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' }, { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' }, { key: 'location', fieldKey: 'line_location', label: 'Vị trí / Lô' }, { key: 'qty', fieldKey: 'line_quantity', label: 'Số lượng', align: 'right' }, { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' }, { key: 'base', fieldKey: 'line_base_quantity', label: 'SL cơ sở', align: 'right' }]}
    rows={(transfer.lines ?? []).map((line) => ({ id: line.id, cells: { no: line.lineNumber, item: <><strong>{line.itemName}</strong><br />{line.sourceSku}</>, location: `${line.sourceLocationId || '—'} / ${line.lotCode || '—'}`, qty: formatQuantity(line.sourceQuantity), unit: line.sourceUnitCode, base: formatQuantity(line.baseQuantity) } }))}
    totals={[{ key: 'total_base_quantity', label: 'Tổng SL cơ sở', value: formatQuantity(transfer.baseQuantityTotal), emphasis: true }]}
    note={transfer.status === 'cancelled' ? `ĐÃ HỦY${transfer.cancellationReason ? ` — ${transfer.cancellationReason}` : ''}` : transfer.note || undefined}
    signatures={['Người lập', 'Thủ kho xuất', 'Thủ kho nhận']} testId="inventory-transfer-print-sheet" />;
}
