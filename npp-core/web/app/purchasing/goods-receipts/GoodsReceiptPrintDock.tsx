'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { GoodsReceipt } from '../../../lib/goods-receipt-types';
import { GOODS_RECEIPT_STATUS_LABELS, formatGoodsReceiptDate } from '../../../lib/goods-receipt-types';
import { formatDecimalString } from '../../../lib/purchase-order-types';

export default function GoodsReceiptPrintDock({ receipt }: { receipt: GoodsReceipt | null }) {
  if (!receipt?.documentNumber || receipt.status === 'draft') return null;
  return (
    <BusinessDocumentPrint
      id={`goods-receipt-${receipt.id}`}
      documentType="GOODS_RECEIPT"
      actionLabel="In"
      title="PHIẾU NHẬN HÀNG"
      subtitle="Chứng từ nhập hàng"
      number={receipt.documentNumber}
      status={GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
      meta={[
        { key: 'supplier', label: 'Nhà cung cấp', value: `${receipt.supplierCode} — ${receipt.supplierName}` },
        { key: 'purchase_order', label: 'Đơn mua hàng', value: receipt.purchaseOrderNumber || '—' },
        { key: 'warehouse', label: 'Kho nhận', value: `${receipt.warehouseCode} — ${receipt.warehouseName}` },
        { key: 'receipt_date', label: 'Ngày nhận', value: formatGoodsReceiptDate(receipt.receiptDate) },
        { key: 'delivery_reference', label: 'Tham chiếu giao', value: receipt.supplierDeliveryReference || '—' },
        { key: 'line_count', label: 'Số dòng', value: formatDecimalString(String(receipt.lineCount)) },
      ]}
      columns={[
        { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
        { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
        { key: 'received', fieldKey: 'line_received', label: 'Thực nhận', align: 'right' },
        { key: 'accepted', fieldKey: 'line_accepted', label: 'Chấp nhận', align: 'right' },
        { key: 'rejected', fieldKey: 'line_rejected', label: 'Loại', align: 'right' },
        { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' },
        { key: 'lot', fieldKey: 'line_lot', label: 'Lô / HSD' },
      ]}
      rows={(receipt.lines ?? []).map((line) => ({
        id: line.id,
        cells: {
          no: line.lineNumber,
          item: <><strong>{line.itemName}</strong><br />{line.skuCode}</>,
          received: formatDecimalString(line.receivedQuantity),
          accepted: formatDecimalString(line.acceptedQuantity),
          rejected: formatDecimalString(line.rejectedQuantity),
          unit: line.unitCode,
          lot: `${line.lotCode || '—'}${line.expiryDate ? ` · HSD ${line.expiryDate}` : ''}`,
        },
      }))}
      totals={[
        { key: 'total_received', label: 'Tổng thực nhận', value: formatDecimalString(receipt.receivedQuantityTotal) },
        { key: 'total_accepted', label: 'Tổng chấp nhận', value: formatDecimalString(receipt.acceptedQuantityTotal), emphasis: true },
        { key: 'total_rejected', label: 'Tổng loại', value: formatDecimalString(receipt.rejectedQuantityTotal) },
        { key: 'total_shortage', label: 'Chốt thiếu', value: formatDecimalString(receipt.shortageClosedQuantityTotal) },
      ]}
      note={receipt.note || undefined}
      signatures={['Người giao', 'Thủ kho', 'Người kiểm nhận']}
      testId="goods-receipt-print-sheet"
    />
  );
}
