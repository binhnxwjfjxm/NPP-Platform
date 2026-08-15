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
      actionLabel="In"
      title="PHIẾU NHẬN HÀNG"
      subtitle="Chứng từ nhập hàng"
      number={receipt.documentNumber}
      status={GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
      meta={[
        { label: 'Nhà cung cấp', value: `${receipt.supplierCode} — ${receipt.supplierName}` },
        { label: 'Đơn mua hàng', value: receipt.purchaseOrderNumber || '—' },
        { label: 'Kho nhận', value: `${receipt.warehouseCode} — ${receipt.warehouseName}` },
        { label: 'Ngày nhận', value: formatGoodsReceiptDate(receipt.receiptDate) },
        { label: 'Tham chiếu giao', value: receipt.supplierDeliveryReference || '—' },
        { label: 'Số dòng', value: formatDecimalString(String(receipt.lineCount)) },
      ]}
      columns={[
        { key: 'no', label: 'STT', align: 'center' },
        { key: 'item', label: 'Sản phẩm / SKU' },
        { key: 'received', label: 'Thực nhận', align: 'right' },
        { key: 'accepted', label: 'Chấp nhận', align: 'right' },
        { key: 'rejected', label: 'Loại', align: 'right' },
        { key: 'unit', label: 'ĐVT', align: 'center' },
        { key: 'lot', label: 'Lô / HSD' },
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
        { label: 'Tổng thực nhận', value: formatDecimalString(receipt.receivedQuantityTotal) },
        { label: 'Tổng chấp nhận', value: formatDecimalString(receipt.acceptedQuantityTotal), emphasis: true },
        { label: 'Tổng loại', value: formatDecimalString(receipt.rejectedQuantityTotal) },
        { label: 'Chốt thiếu', value: formatDecimalString(receipt.shortageClosedQuantityTotal) },
      ]}
      note={receipt.note || undefined}
      signatures={['Người giao', 'Thủ kho', 'Người kiểm nhận']}
      testId="goods-receipt-print-sheet"
    />
  );
}
