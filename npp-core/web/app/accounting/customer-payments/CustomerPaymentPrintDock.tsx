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
  return {
    open: 'Chưa gắn với đơn',
    partially_allocated: 'Đã ghi một phần',
    settled: 'Đã ghi nhận',
    reversed: 'Đã hủy',
  }[status];
}

function paymentMethodLabel(method: string) {
  return {
    CASH: 'Tiền mặt',
    BANK_TRANSFER: 'Chuyển khoản',
    OTHER: 'Khác',
  }[method] ?? 'Khác';
}

export default function CustomerPaymentPrintDock({ payment }: { payment: CustomerPayment | null }) {
  if (!payment?.documentNumber) return null;
  return (
    <BusinessDocumentPrint
      id={`customer-payment-${payment.id}`}
      documentType="CUSTOMER_PAYMENT"
      actionLabel="In"
      title="PHIẾU THU"
      subtitle="Chứng từ thu tiền khách hàng"
      number={payment.documentNumber}
      status={statusLabel(payment.status)}
      size="A5"
      meta={[
        { key: 'customer', label: 'Khách hàng', value: `${payment.customerCode || '—'} — ${payment.customerName || '—'}`, full: true },
        { key: 'receiving_unit', label: 'Đơn vị nhận tiền', value: `${payment.warehouseCode || '—'} — ${payment.warehouseName || '—'}` },
        { key: 'payment_date', label: 'Ngày thu', value: dateText(payment.paymentDate) },
        { key: 'payment_method', label: 'Hình thức nhận tiền', value: paymentMethodLabel(payment.paymentMethod) },
        { key: 'bank_reference', label: 'Mã giao dịch ngân hàng', value: payment.externalReference || '—' },
        {
          key: 'remitting_employee',
          label: 'Nhân viên nộp tiền',
          value: payment.remittingEmployeeName
            ? `${payment.remittingEmployeeCode || '—'} — ${payment.remittingEmployeeName}`
            : '—',
        },
        { key: 'recorded_by', label: 'Người ghi nhận', value: payment.postedBy || '—' },
      ]}
      totals={[
        { key: 'total_received', label: 'SỐ TIỀN ĐÃ NHẬN', value: money(payment.originalAmount, payment.currencyCode), emphasis: true },
        { key: 'total_allocated', label: 'Đã ghi vào đơn', value: money(payment.allocatedAmount, payment.currencyCode) },
        { key: 'total_unallocated', label: 'Chưa gắn với đơn', value: money(payment.remainingAmount, payment.currencyCode) },
      ]}
      note={payment.status === 'reversed' ? `ĐÃ HỦY${payment.reversalReason ? ` — ${payment.reversalReason}` : ''}` : payment.note || undefined}
      signatures={['Người nộp tiền', 'Người lập phiếu', 'Thủ quỹ / Kế toán']}
      testId="customer-payment-print-sheet"
    />
  );
}
