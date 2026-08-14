'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
  formatPurchaseOrderDate,
  PURCHASE_ORDER_STATUS_LABELS,
} from '../../../lib/purchase-order-types';

export default function PurchaseOrderPrintSheet({ purchaseOrder }: { purchaseOrder: PurchaseOrder }) {
  const printId = `purchase-order-${purchaseOrder.id}`;
  return (
    <BusinessDocumentPrint
      id={printId}
      actionLabel="In"
      title="ĐƠN ĐẶT HÀNG"
      subtitle="Chứng từ mua hàng"
      number={purchaseOrder.number || 'CHƯA CẤP SỐ'}
      status={PURCHASE_ORDER_STATUS_LABELS[purchaseOrder.status]}
      meta={[
        { label: 'Nhà cung cấp', value: `${purchaseOrder.supplierCode} — ${purchaseOrder.supplierName}` },
        { label: 'Kho nhận', value: `${purchaseOrder.warehouseCode} — ${purchaseOrder.warehouseName}` },
        { label: 'Ngày đặt', value: formatPurchaseOrderDate(purchaseOrder.placedAt) },
        { label: 'Dự kiến nhận', value: formatPurchaseOrderDate(purchaseOrder.expectedAt) },
        { label: 'Tham chiếu NCC', value: purchaseOrder.supplierReference || '—' },
        { label: 'Tiền tệ', value: purchaseOrder.currency },
      ]}
      columns={[
        { key: 'no', label: 'STT', align: 'center' },
        { key: 'item', label: 'Sản phẩm / SKU' },
        { key: 'qty', label: 'Số lượng', align: 'right' },
        { key: 'unit', label: 'ĐVT', align: 'center' },
        { key: 'price', label: 'Đơn giá', align: 'right' },
        { key: 'discount', label: 'CK', align: 'right' },
        { key: 'tax', label: 'Thuế', align: 'right' },
        { key: 'total', label: 'Thành tiền', align: 'right' },
      ]}
      rows={(purchaseOrder.lines ?? []).map((line) => ({
        id: line.id,
        cells: {
          no: line.lineNumber,
          item: <><strong>{line.itemName}</strong><br />{line.skuCode}</>,
          qty: formatDecimalString(line.quantity),
          unit: line.unitCode,
          price: formatPurchaseOrderAmount(line.unitPrice, purchaseOrder.currency),
          discount: formatPurchaseOrderAmount(line.discountAmount, purchaseOrder.currency),
          tax: formatPurchaseOrderAmount(line.taxAmount, purchaseOrder.currency),
          total: formatPurchaseOrderAmount(line.lineTotal, purchaseOrder.currency),
        },
      }))}
      totals={[
        { label: 'Tiền hàng', value: formatPurchaseOrderAmount(purchaseOrder.subtotal, purchaseOrder.currency) },
        { label: 'Chiết khấu', value: formatPurchaseOrderAmount(purchaseOrder.discountTotal, purchaseOrder.currency) },
        { label: 'Thuế', value: formatPurchaseOrderAmount(purchaseOrder.taxTotal, purchaseOrder.currency) },
        { label: 'TỔNG CỘNG', value: formatPurchaseOrderAmount(purchaseOrder.total, purchaseOrder.currency), emphasis: true },
      ]}
      note={purchaseOrder.note || undefined}
      signatures={['Người lập', 'Người duyệt', 'Nhà cung cấp']}
      testId="purchase-order-print-sheet"
    />
  );
}
