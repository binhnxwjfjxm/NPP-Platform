const MOVEMENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  OPENING_BALANCE: 'Tồn đầu kỳ',
  GOODS_RECEIPT: 'Nhập hàng',
  PURCHASE_RECEIPT: 'Nhập hàng',
  SUPPLIER_RETURN: 'Trả nhà cung cấp',
  INVENTORY_TRANSFER_OUT: 'Chuyển kho đi',
  TRANSFER_ISSUE: 'Chuyển kho đi',
  INVENTORY_TRANSFER_IN: 'Nhận chuyển kho',
  TRANSFER_RECEIPT: 'Nhận chuyển kho',
  INVENTORY_ADJUSTMENT: 'Điều chỉnh kho',
  STOCKTAKE_ADJUSTMENT: 'Điều chỉnh sau kiểm kê',
  STOCKTAKE_ADJUSTMENT_REVERSAL: 'Hoàn tác điều chỉnh kiểm kê',
  FULFILLMENT_PICK: 'Soạn hàng',
  FULFILLMENT_REVERSE_PICK: 'Hoàn soạn hàng',
  DELIVERY_ISSUE: 'Xuất giao hàng',
  SALES_DELIVERY_ISSUE: 'Xuất giao hàng',
  DELIVERY_RETURN: 'Nhập hàng giao trả về',
  LOGISTICS_TRIP_RETURN: 'Nhập hàng giao trả về',
  CUSTOMER_RETURN: 'Khách trả hàng',
  PICKUP_ISSUE: 'Khách nhận tại kho',
  MANUAL_ISSUE: 'Xuất kho thủ công',
  MANUAL_RECEIPT: 'Nhập kho thủ công',
  MANUAL_INBOUND: 'Nhập kho thủ công',
  REVERSAL: 'Hoàn tác giao dịch kho',
});

export function inventoryMovementTypeLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return 'Nghiệp vụ kho';
  if (MOVEMENT_LABELS[normalized]) return MOVEMENT_LABELS[normalized];
  if (normalized.startsWith('MANUAL_ADJUSTMENT_')) return 'Điều chỉnh tồn kho';
  return 'Nghiệp vụ kho khác';
}

export { MOVEMENT_LABELS as INVENTORY_MOVEMENT_TYPE_LABELS };
