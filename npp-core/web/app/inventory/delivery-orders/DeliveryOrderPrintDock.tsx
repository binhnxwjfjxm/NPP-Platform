'use client';

import { useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';

type DeliveryOrderStatus = 'draft' | 'ready_to_dispatch' | 'dispatched' | 'handed_over' | 'cancelled';
type PrintVariant = 'DELIVERY_ORDER' | 'PACKING_LIST';
type DeliveryOrder = {
  id: string; number: string | null; salesOrderNumber: string | null; customerCode: string; customerName: string;
  warehouseCode: string; warehouseName: string; handoverMode: 'DELIVERY' | 'PICKUP'; status: DeliveryOrderStatus;
  destination?: Record<string, unknown> | null; requestedDeliveryDate?: string | null; collectionPolicy?: string | null; note?: string | null;
  totalBaseQuantity?: string; lines?: Array<{ id: string; lineNumber?: number; locationCode: string | null; lotCode: string | null; expiryDate?: string | null; sku: string; itemName: string; unitCode: string; deliveryBaseQuantity: string }>;
};
const STATUS_LABEL: Record<DeliveryOrderStatus, string> = { draft: 'Nháp', ready_to_dispatch: 'Sẵn sàng bàn giao', dispatched: 'Đã xuất theo chuyến', handed_over: 'Đã bàn giao', cancelled: 'Đã hủy' };
const quantity = (value: string | null | undefined) => String(value ?? '0').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
function dateText(value: string | null | undefined) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN').format(parsed); }
function destinationText(value: Record<string, unknown> | null | undefined) { if (!value) return '—'; return [value.addressLine1, value.addressLine2, value.ward, value.district, value.province].map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean).join(', ') || '—'; }

export default function DeliveryOrderPrintDock({ order }: { order: DeliveryOrder | null }) {
  const [variant, setVariant] = useState<PrintVariant>('DELIVERY_ORDER');
  if (!order?.number || order.status === 'draft') return null;
  const isPacking = variant === 'PACKING_LIST';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}>
        Mẫu
        <select aria-label="Mẫu in giao nhận" value={variant} onChange={(event) => setVariant(event.target.value as PrintVariant)}>
          <option value="DELIVERY_ORDER">Phiếu giao hàng</option>
          <option value="PACKING_LIST">Phiếu đóng gói</option>
        </select>
      </label>
      <BusinessDocumentPrint
        id={`delivery-order-${order.id}-${variant}`}
        actionLabel="In"
        title={isPacking ? 'PHIẾU ĐÓNG GÓI' : 'PHIẾU GIAO HÀNG'}
        subtitle={isPacking ? 'Danh sách đóng gói' : 'Chứng từ giao nhận'}
        number={order.number}
        status={STATUS_LABEL[order.status]}
        meta={[
          { label: 'Đơn bán hàng', value: order.salesOrderNumber || '—' },
          { label: 'Khách hàng', value: `${order.customerCode} — ${order.customerName}` },
          { label: 'Kho xuất', value: `${order.warehouseCode} — ${order.warehouseName}` },
          { label: 'Hình thức', value: order.handoverMode === 'PICKUP' ? 'Khách nhận tại kho' : 'Giao đến khách' },
          { label: 'Ngày giao dự kiến', value: dateText(order.requestedDeliveryDate) },
          { label: 'Chính sách thu', value: order.collectionPolicy || '—' },
          { label: 'Địa chỉ giao', value: destinationText(order.destination), full: true },
        ]}
        columns={[
          { key: 'no', label: 'STT', align: 'center' }, { key: 'item', label: 'Sản phẩm / SKU' },
          { key: 'qty', label: 'Số lượng', align: 'right' }, { key: 'unit', label: 'ĐVT', align: 'center' },
          { key: 'lot', label: 'Lô / HSD' }, { key: 'location', label: 'Vị trí' },
        ]}
        rows={(order.lines ?? []).map((line, index) => ({ id: line.id, cells: { no: line.lineNumber ?? index + 1, item: <><strong>{line.itemName}</strong><br />{line.sku}</>, qty: quantity(line.deliveryBaseQuantity), unit: line.unitCode, lot: `${line.lotCode || '—'}${line.expiryDate ? ` · ${line.expiryDate}` : ''}`, location: line.locationCode || '—' } }))}
        totals={[{ label: isPacking ? 'Tổng SL đóng gói' : 'Tổng SL giao', value: quantity(order.totalBaseQuantity), emphasis: true }]}
        note={order.status === 'cancelled' ? 'ĐÃ HỦY' : order.note || undefined}
        signatures={isPacking ? ['Người đóng gói', 'Thủ kho', 'Người kiểm'] : ['Người giao', 'Khách hàng', 'Thủ kho']}
        testId={isPacking ? 'packing-list-print-sheet' : 'delivery-order-print-sheet'}
      />
    </span>
  );
}
