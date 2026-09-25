'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { SupplierPayment } from '../../../lib/supplier-payment-types';

function money(value: string, currencyCode: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return `${value || '—'} ${currencyCode}`;
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}
function methodLabel(value: string) {
  return ({ CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', OTHER: 'Khác' } as Record<string, string>)[value] ?? value;
}
function statusLabel(value: SupplierPayment['status']) {
  return { open: 'Chưa phân bổ', partially_allocated: 'Đã phân bổ một phần', settled: 'Đã thanh toán', reversed: 'Đã đảo' }[value];
}

export default function SupplierPaymentPrintDock({ payment }: { payment: SupplierPayment | null }) {
  if (!payment?.documentNumber) return null;
  return <BusinessDocumentPrint
    id={`supplier-payment-print-${payment.id}`}
    documentType="SUPPLIER_PAYMENT"
    actionLabel="In / PDF"
    title="PHIẾU CHI / THANH TOÁN NHÀ CUNG CẤP"
    subtitle="Chứng từ thanh toán Nhà cung cấp"
    number={payment.documentNumber}
    status={statusLabel(payment.status)}
    size="A5"
    meta={[
      { key: 'supplier', label: 'Nhà cung cấp', value: `${payment.supplierCode || '—'} — ${payment.supplierName || '—'}`, full: true },
      { key: 'paying_unit', label: 'Đơn vị chi', value: `${payment.warehouseCode || '—'} — ${payment.warehouseName || '—'}` },
      { key: 'payment_date', label: 'Ngày chi', value: payment.paymentDate },
      { key: 'payment_method', label: 'Hình thức thanh toán', value: methodLabel(payment.paymentMethod) },
      { key: 'bank_reference', label: 'Mã giao dịch', value: payment.externalReference || '—' },
      { key: 'recorded_by', label: 'Người ghi nhận', value: payment.postedBy || '—' },
    ]}
    totals={[
      { key: 'total_paid', label: 'SỐ TIỀN ĐÃ CHI', value: money(payment.originalAmount, payment.currencyCode), emphasis: true },
      { key: 'total_allocated', label: 'Đã phân bổ', value: money(payment.allocatedAmount, payment.currencyCode) },
      { key: 'total_unallocated', label: 'Chưa phân bổ', value: money(payment.remainingAmount, payment.currencyCode) },
    ]}
    note={payment.status === 'reversed' ? `ĐÃ ĐẢO${payment.reversalReason ? ` — ${payment.reversalReason}` : ''}` : payment.note || undefined}
    signatures={['Người lập phiếu', 'Kế toán / Thủ quỹ', 'Nhà cung cấp / Người nhận']}
    testId="supplier-payment-print-sheet"
  />;
}
