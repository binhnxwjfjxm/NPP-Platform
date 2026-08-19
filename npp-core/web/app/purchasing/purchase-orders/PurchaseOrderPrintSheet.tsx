'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
  formatPurchaseOrderDate,
  PURCHASE_ORDER_STATUS_LABELS,
} from '../../../lib/purchase-order-types';

function isZeroAmount(value: string | number | null | undefined) {
  const normalized = String(value ?? '').trim();
  return /^[-+]?0+(?:\.0+)?$/.test(normalized);
}

export default function PurchaseOrderPrintSheet({ purchaseOrder }: { purchaseOrder: PurchaseOrder }) {
  const printId = `purchase-order-${purchaseOrder.id}`;
  const lines = purchaseOrder.lines ?? [];
  const showDiscount = !isZeroAmount(purchaseOrder.discountTotal)
    || lines.some((line) => !isZeroAmount(line.discountAmount));
  const showTax = !isZeroAmount(purchaseOrder.taxTotal)
    || lines.some((line) => !isZeroAmount(line.taxAmount));

  return (
    <BusinessDocumentPrint
      id={printId}
      documentType="PURCHASE_ORDER"
      actionLabel="In"
      title="ĐƠN MUA HÀNG"
      subtitle="Chứng từ mua hàng"
      number={purchaseOrder.number || 'CHƯA CẤP SỐ'}
      status={PURCHASE_ORDER_STATUS_LABELS[purchaseOrder.status]}
      meta={[
        { key: 'supplier', label: 'Nhà cung cấp', value: `${purchaseOrder.supplierCode} — ${purchaseOrder.supplierName}` },
        { key: 'warehouse', label: 'Kho nhận', value: `${purchaseOrder.warehouseCode} — ${purchaseOrder.warehouseName}` },
        { key: 'ordered_date', label: 'Ngày đặt', value: formatPurchaseOrderDate(purchaseOrder.placedAt) },
        { key: 'expected_date', label: 'Dự kiến nhận', value: formatPurchaseOrderDate(purchaseOrder.expectedAt) },
        { key: 'supplier_reference', label: 'Tham chiếu nhà cung cấp', value: purchaseOrder.supplierReference || '—' },
        { key: 'currency', label: 'Tiền tệ', value: purchaseOrder.currency },
      ]}
      columns={[
        { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
        { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
        { key: 'qty', fieldKey: 'line_quantity', label: 'Số lượng', align: 'right' },
        { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' },
        { key: 'price', fieldKey: 'line_unit_price', label: 'Đơn giá', align: 'right' },
        ...(showDiscount ? [{ key: 'discount', fieldKey: 'line_discount', label: 'CK', align: 'right' as const }] : []),
        ...(showTax ? [{ key: 'tax', fieldKey: 'line_tax', label: 'Thuế', align: 'right' as const }] : []),
        { key: 'total', fieldKey: 'line_total', label: 'Thành tiền', align: 'right' },
      ]}
      rows={lines.map((line) => ({
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
        { key: 'total_subtotal', label: 'Tiền hàng', value: formatPurchaseOrderAmount(purchaseOrder.subtotal, purchaseOrder.currency) },
        ...(showDiscount ? [{ key: 'total_discount', label: 'Chiết khấu', value: formatPurchaseOrderAmount(purchaseOrder.discountTotal, purchaseOrder.currency) }] : []),
        ...(showTax ? [{ key: 'total_tax', label: 'Thuế', value: formatPurchaseOrderAmount(purchaseOrder.taxTotal, purchaseOrder.currency) }] : []),
        { key: 'total_total', label: 'TỔNG CỘNG', value: formatPurchaseOrderAmount(purchaseOrder.total, purchaseOrder.currency), emphasis: true },
      ]}
      note={purchaseOrder.note || undefined}
      signatures={['Người lập', 'Người duyệt', 'Nhà cung cấp']}
      testId="purchase-order-print-sheet"
    />
  );
}
