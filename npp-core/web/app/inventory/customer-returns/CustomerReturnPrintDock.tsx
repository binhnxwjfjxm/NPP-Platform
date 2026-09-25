'use client';

import BusinessDocumentPrint from '../../components/business-document-print';

type CustomerReturnLine = {
  id: string; lineNumber: number; deliveryOrderNumber: string | null; salesOrderNumber: string | null;
  locationCode: string | null; lotCode: string | null; sku: string; itemName: string; unitCode: string;
  requestedBaseQuantity: string; acceptedBaseQuantity: string; reasonCode: string; reasonNote: string;
};
type CustomerReturn = {
  id: string; number: string | null; customerCode: string; customerName: string; warehouseCode: string; warehouseName: string;
  status: 'draft' | 'received' | 'cancelled'; note: string | null; requestedBaseQuantity?: string; acceptedBaseQuantity?: string;
  cancellationReason?: string | null; lines?: CustomerReturnLine[];
};
function quantity(value: string | null | undefined) {
  return String(value ?? '0').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
function reasonLabel(code: string) {
  return {
    DAMAGED_OR_UNWANTED: 'Hư hỏng / không nhận',
    WRONG_ITEM: 'Sai hàng',
    QUALITY_COMPLAINT: 'Khiếu nại chất lượng',
    OTHER: 'Khác',
  }[code] ?? 'Lý do khác';
}

export default function CustomerReturnPrintDock({ customerReturn }: { customerReturn: CustomerReturn | null }) {
  if (!customerReturn?.number || customerReturn.status !== 'received') return null;
  const sources = [...new Set((customerReturn.lines ?? []).flatMap((line) => [line.deliveryOrderNumber, line.salesOrderNumber]).filter(Boolean))].join(', ') || '—';
  return <BusinessDocumentPrint
    id={`customer-return-print-${customerReturn.id}`}
    documentType="CUSTOMER_RETURN"
    actionLabel="In / PDF"
    title="PHIẾU NHẬN HÀNG KHÁCH TRẢ"
    subtitle="Chứng từ thực nhận hàng trả"
    number={customerReturn.number}
    status="Đã nhận vào kho"
    meta={[
      { key: 'customer', label: 'Khách hàng', value: `${customerReturn.customerCode} — ${customerReturn.customerName}`, full: true },
      { key: 'warehouse', label: 'Kho nhận', value: `${customerReturn.warehouseCode} — ${customerReturn.warehouseName}` },
      { key: 'source_document', label: 'Chứng từ nguồn', value: sources, full: true },
    ]}
    columns={[
      { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
      { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
      { key: 'reason', fieldKey: 'line_reason', label: 'Lý do trả' },
      { key: 'requested', fieldKey: 'line_requested', label: 'Đề nghị trả', align: 'right' },
      { key: 'accepted', fieldKey: 'line_accepted', label: 'Thực nhận', align: 'right' },
      { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' },
      { key: 'lot', fieldKey: 'line_lot', label: 'Lô / vị trí' },
    ]}
    rows={(customerReturn.lines ?? []).map((line) => ({
      id: line.id,
      cells: {
        no: line.lineNumber,
        item: <><strong>{line.itemName}</strong><br />{line.sku}</>,
        reason: <><strong>{reasonLabel(line.reasonCode)}</strong>{line.reasonNote ? <><br />{line.reasonNote}</> : null}</>,
        requested: quantity(line.requestedBaseQuantity),
        accepted: quantity(line.acceptedBaseQuantity),
        unit: line.unitCode,
        lot: [line.lotCode, line.locationCode].filter(Boolean).join(' · ') || '—',
      },
    }))}
    totals={[
      { key: 'total_requested', label: 'Tổng đề nghị trả', value: quantity(customerReturn.requestedBaseQuantity) },
      { key: 'total_accepted', label: 'Tổng thực nhận', value: quantity(customerReturn.acceptedBaseQuantity), emphasis: true },
    ]}
    note={customerReturn.note || undefined}
    signatures={['Khách hàng / Người giao', 'Thủ kho', 'Người kiểm nhận']}
    testId="customer-return-print-sheet"
  />;
}
