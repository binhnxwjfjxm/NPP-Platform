'use client';

import BusinessDocumentPrint from '../../components/business-document-print';

type InboundType = 'MANUAL_RECEIPT' | 'OFF_DOCUMENT_CUSTOMER_RETURN' | 'RECOVERY' | 'OTHER';
type HistoryDocument = {
  id: string;
  inboundType: InboundType;
  warehouseCode: string;
  warehouseName: string;
  documentDate: string;
  referenceNumber: string | null;
  documentNumber: string | null;
  note: string | null;
  status: 'POSTED' | 'REVERSED';
  reversalNote: string | null;
};
type Detail = {
  documentId: string;
  documentDate: string;
  referenceNumber: string | null;
  documentNumber: string | null;
  warehouseCode: string;
  warehouseName: string;
  receiptLines?: Array<{
    lineNumber: number;
    sku: string;
    productName: string | null;
    unitCode: string;
    quantity: string;
    lotCode: string | null;
  }>;
  lines: Array<{
    baseVariantId: string;
    sku: string;
    productName: string | null;
    baseUnitCode: string | null;
    quantityDelta: string;
  }>;
};

const TYPE_LABELS: Record<InboundType, string> = {
  MANUAL_RECEIPT: 'Nhập kho thủ công',
  OFF_DOCUMENT_CUSTOMER_RETURN: 'Hàng khách trả ngoài chứng từ',
  RECOVERY: 'Nhập khôi phục',
  OTHER: 'Nhập khác',
};

function dateText(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}
function quantity(value: string) {
  return String(value ?? '0').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

export default function ManualInboundPrintDock({ document, detail }: { document: HistoryDocument | null; detail: Detail | null }) {
  if (!document || !detail || document.id !== detail.documentId) return null;
  // Prefer immutable source receipt lines to aggregated stock movement rows.
  // Fallback keeps older backend/frontend rollout combinations printable.
  const printLines = detail.receiptLines?.length ? detail.receiptLines : detail.lines.map((line, index) => ({
    lineNumber: index + 1,
    sku: line.sku,
    productName: line.productName,
    unitCode: line.baseUnitCode,
    quantity: line.quantityDelta,
    lotCode: null,
  }));
  return <BusinessDocumentPrint
    id={`manual-inbound-print-${document.id}`}
    documentType="MANUAL_INBOUND"
    actionLabel="In / PDF"
    title="PHIẾU NHẬP KHO"
    subtitle="Chứng từ nhập kho thủ công"
    showNumber={Boolean(document.documentNumber)}
    number={document.documentNumber || '—'}
    status={document.status === 'POSTED' ? 'Đã nhập kho' : 'Đã đảo'}
    meta={[
      { key: 'inbound_type', label: 'Loại nhập', value: TYPE_LABELS[document.inboundType] },
      { key: 'warehouse', label: 'Kho nhập', value: `${document.warehouseCode} — ${document.warehouseName}` },
      { key: 'document_date', label: 'Ngày chứng từ', value: dateText(document.documentDate) },
      { key: 'reference_number', label: 'Số tham chiếu', value: document.referenceNumber || '—' },
    ]}
    columns={[
      { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
      { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
      { key: 'quantity', fieldKey: 'line_quantity', label: 'Số lượng nhập', align: 'right' },
      { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center' },
    ]}
    rows={printLines.map((line) => ({
      id: `${line.lineNumber}-${line.sku}`,
      cells: {
        no: line.lineNumber,
        item: <><strong>{line.productName || line.sku}</strong><br />{line.sku}{line.lotCode ? ` · Lô: ${line.lotCode}` : ''}</>,
        quantity: quantity(line.quantity),
        unit: line.unitCode || '—',
      },
    }))}
    note={[document.note, document.status === 'REVERSED' ? `ĐÃ ĐẢO${document.reversalNote ? ` — ${document.reversalNote}` : ''}` : ''].filter(Boolean).join(' — ') || undefined}
    signatures={['Người lập phiếu', 'Thủ kho', 'Người giao hàng']}
    testId="manual-inbound-print-sheet"
  />;
}
