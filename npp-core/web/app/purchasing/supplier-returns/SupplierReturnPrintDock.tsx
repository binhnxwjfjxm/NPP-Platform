'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { SupplierReturn } from '../../../lib/supplier-return-types';
import { formatSupplierReturnDate, SUPPLIER_RETURN_STATUS_LABELS } from '../../../lib/supplier-return-types';
import { formatDecimalString } from '../../../lib/purchase-order-types';

export default function SupplierReturnPrintDock({ supplierReturn }: { supplierReturn: SupplierReturn | null }) {
  if (!supplierReturn?.documentNumber || supplierReturn.status === 'draft') return null;
  const sourceReceipts = [...new Set((supplierReturn.lines ?? []).map((line) => line.sourceGoodsReceiptNumber).filter(Boolean))].join(', ') || '—';
  const note = supplierReturn.status === 'reversed'
    ? `ĐÃ ĐẢO${supplierReturn.reversalReason ? ` — ${supplierReturn.reversalReason}` : ''}`
    : supplierReturn.status === 'cancelled'
      ? `ĐÃ HỦY${supplierReturn.cancellationReason ? ` — ${supplierReturn.cancellationReason}` : ''}`
      : supplierReturn.note || undefined;
  return <BusinessDocumentPrint
    id={`supplier-return-print-${supplierReturn.id}`}
    documentType="SUPPLIER_RETURN"
    actionLabel="In / PDF"
    title="PHIẾU TRẢ HÀNG NHÀ CUNG CẤP"
    subtitle="Chứng từ xuất trả hàng"
    number={supplierReturn.documentNumber}
    status={SUPPLIER_RETURN_STATUS_LABELS[supplierReturn.status]}
    meta={[
      { key: 'supplier', label: 'Nhà cung cấp', value: `${supplierReturn.supplierCode} — ${supplierReturn.supplierName}`, full: true },
      { key: 'warehouse', label: 'Kho xuất trả', value: `${supplierReturn.warehouseCode} — ${supplierReturn.warehouseName}` },
      { key: 'return_date', label: 'Ngày trả', value: formatSupplierReturnDate(supplierReturn.returnDate) },
      { key: 'source_receipt', label: 'Phiếu nhận nguồn', value: sourceReceipts, full: true },
    ]}
    columns={[
      { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
      { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
      { key: 'reason', fieldKey: 'line_reason', label: 'Lý do trả' },
      { key: 'quantity', fieldKey: 'line_quantity', label: 'SL trả', align: 'right' },
      { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' },
      { key: 'lot', fieldKey: 'line_lot', label: 'Lô' },
    ]}
    rows={(supplierReturn.lines ?? []).map((line) => ({
      id: line.id,
      cells: {
        no: line.lineNumber,
        item: <><strong>{line.sourceItemName}</strong><br />{line.sourceSku}</>,
        reason: <><strong>{line.reasonCode}</strong>{line.reasonNote ? <><br />{line.reasonNote}</> : null}</>,
        quantity: formatDecimalString(line.returnQuantity),
        unit: line.sourceUnitCode,
        lot: line.lotCode || '—',
      },
    }))}
    totals={[{ key: 'total_quantity', label: 'Tổng số lượng trả', value: formatDecimalString(supplierReturn.returnQuantityTotal), emphasis: true }]}
    note={note}
    signatures={['Người lập phiếu', 'Thủ kho', 'Nhà cung cấp / Người nhận']}
    testId="supplier-return-print-sheet"
  />;
}
