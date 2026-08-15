'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { CustomerPayment } from '../../../lib/customer-payment-types';

function money(value: string, currencyCode: string) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return `${normalized || '—'} ${currencyCode}`;
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}

function dateText(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

function statusLabel(status: CustomerPayment['status']) {
  return { open: 'Chưa phân bổ', partially_allocated: 'Đã phân bổ một phần', settled: 'Đã phân bổ hết', reversed: 'Đã đảo' }[status];
}

export default function CustomerPaymentPrintDock({ payment }: { payment: CustomerPayment | null }) {
  if (!payment?.documentNumber) return null;
  return (
    <BusinessDocumentPrint
      id={`customer-payment-${payment.id}`}
      actionLabel="In"
      title="PHIẾU THU"
      subtitle="Chứng từ thu tiền khách hàng"
      number={payment.documentNumber}
      status={statusLabel(payment.status)}
      size="A5"
      meta={[
        { label: 'Khách hàng', value: `${payment.customerCode || '—'} — ${payment.customerName || '—'}`, full: true },
        { label: 'Kho nhận tiền', value: `${payment.warehouseCode || '—'} — ${payment.warehouseName || '—'}` },
        { label: 'Ngày thu', value: dateText(payment.paymentDate) },
        { label: 'Phương thức', value: payment.paymentMethod },
        { label: 'Tham chiếu', value: payment.externalReference || '—' },
        { label: 'Người ghi nhận', value: payment.postedBy || '—' },
      ]}
      totals={[
        { label: 'SỐ TIỀN ĐÃ NHẬN', value: money(payment.originalAmount, payment.currencyCode), emphasis: true },
        { label: 'Đã phân bổ', value: money(payment.allocatedAmount, payment.currencyCode) },
        { label: 'Còn chưa phân bổ', value: money(payment.remainingAmount, payment.currencyCode) },
      ]}
      note={payment.status === 'reversed' ? `ĐÃ ĐẢO${payment.reversalReason ? ` — ${payment.reversalReason}` : ''}` : payment.note || undefined}
      signatures={['Người nộp tiền', 'Người lập phiếu', 'Thủ quỹ / Kế toán']}
      testId="customer-payment-print-sheet"
    />
  );
}
