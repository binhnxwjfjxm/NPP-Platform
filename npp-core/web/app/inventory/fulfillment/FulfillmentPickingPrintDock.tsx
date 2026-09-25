'use client';

import BusinessDocumentPrint from '../../components/business-document-print';

type Item = {
  fulfillmentDemandId: string; lineNumber: number; itemName: string; sku: string; baseUnitCode: string;
  orderedBaseQuantity: string; allocatedBaseQuantity: string; pickedBaseQuantity: string; packedBaseQuantity: string;
};
type Order = {
  salesOrderId: string; orderNumber: string | null; fulfillmentStatus: string; customerCode: string; customerName: string;
  warehouseCode: string; warehouseName: string; salesChannelCode: string | null; salesChannelName: string | null;
  requestedDeliveryDate: string | null; items: Item[];
};
function quantity(value: string) { return String(value ?? '0').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1'); }
function dateText(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

export default function FulfillmentPickingPrintDock({ order }: { order: Order | null }) {
  if (!order?.orderNumber || !order.items.some((item) => Number(item.allocatedBaseQuantity) > 0 || Number(item.pickedBaseQuantity) > 0 || Number(item.packedBaseQuantity) > 0)) return null;
  return <BusinessDocumentPrint
    id={`fulfillment-picking-print-${order.salesOrderId}`}
    documentType="FULFILLMENT_PICKING"
    actionLabel="In / PDF"
    title="PHIẾU SOẠN HÀNG / CẤP HÀNG"
    subtitle="Tình trạng phân bổ, soạn và đóng gói"
    number={order.orderNumber}
    status={order.fulfillmentStatus}
    meta={[
      { key: 'customer', label: 'Khách hàng', value: `${order.customerCode} — ${order.customerName}`, full: true },
      { key: 'warehouse', label: 'Kho xử lý', value: `${order.warehouseCode} — ${order.warehouseName}` },
      { key: 'sales_channel', label: 'Kênh bán', value: order.salesChannelName || order.salesChannelCode || '—' },
      { key: 'delivery_date', label: 'Ngày giao dự kiến', value: dateText(order.requestedDeliveryDate) },
    ]}
    columns={[
      { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
      { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
      { key: 'ordered', fieldKey: 'line_ordered', label: 'Cần cấp', align: 'right' },
      { key: 'allocated', fieldKey: 'line_allocated', label: 'Đã phân bổ', align: 'right' },
      { key: 'picked', fieldKey: 'line_picked', label: 'Đã soạn', align: 'right' },
      { key: 'packed', fieldKey: 'line_packed', label: 'Đã đóng gói', align: 'right' },
      { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' },
    ]}
    rows={order.items.map((item) => ({
      id: item.fulfillmentDemandId,
      cells: { no: item.lineNumber, item: <><strong>{item.itemName}</strong><br />{item.sku}</>, ordered: quantity(item.orderedBaseQuantity), allocated: quantity(item.allocatedBaseQuantity), picked: quantity(item.pickedBaseQuantity), packed: quantity(item.packedBaseQuantity), unit: item.baseUnitCode },
    }))}
    note="Phiếu phản ánh trạng thái phân bổ, soạn và đóng gói tại thời điểm in."
    signatures={['Người soạn hàng', 'Thủ kho', 'Người nhận bàn giao']}
    testId="fulfillment-picking-print-sheet"
  />;
}
