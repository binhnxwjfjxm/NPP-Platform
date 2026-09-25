'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { CustomerRefund } from '../../../lib/customer-return-credit-types';

function money(value: string, currencyCode: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return `${value || '—'} ${currencyCode}`;
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}
function methodLabel(value: string) {
  return value === 'BANK_TRANSFER' ? 'Chuyển khoản' : value === 'CASH' ? 'Tiền mặt' : value;
}
function dateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

export default function CustomerRefundPrintDock({ refund }: { refund: CustomerRefund }) {
  return <BusinessDocumentPrint
    id={`customer-refund-print-${refund.id}`}
    documentType="CUSTOMER_REFUND"
    actionLabel="In / PDF"
    title="PHIẾU HOÀN TIỀN KHÁCH HÀNG"
    subtitle="Chứng từ hoàn tiền từ khoản giảm công nợ"
    showNumber={Boolean(refund.refundNumber)}
    number={refund.refundNumber || '—'}
    status={refund.reversalId ? 'Đã đảo' : 'Đã hoàn'}
    size="A5"
    meta={[
      { key: 'customer', label: 'Khách hàng', value: `${refund.customerCode || '—'} — ${refund.customerName || '—'}`, full: true },
      { key: 'warehouse', label: 'Đơn vị hoàn', value: `${refund.warehouseCode || '—'} — ${refund.warehouseName || '—'}` },
      { key: 'source_credit', label: 'Khoản giảm công nợ nguồn', value: refund.sourceCreditNumber || '—' },
      { key: 'refund_date', label: 'Ngày hoàn', value: dateTime(refund.postedAt) },
      { key: 'refund_method', label: 'Phương thức hoàn', value: methodLabel(refund.refundMethod) },
      { key: 'destination', label: 'Nơi nhận / tài khoản nhận', value: refund.destinationReference, full: true },
      { key: 'transaction_reference', label: 'Tham chiếu giao dịch', value: refund.externalReference || '—' },
    ]}
    totals={[{ key: 'total_refund', label: 'SỐ TIỀN HOÀN', value: money(refund.amount, refund.currencyCode), emphasis: true }]}
    note={[refund.reason, refund.reversalId ? `ĐÃ ĐẢO${refund.reversalReason ? ` — ${refund.reversalReason}` : ''}` : ''].filter(Boolean).join(' — ')}
    signatures={['Người lập phiếu', 'Kế toán / Thủ quỹ', 'Khách hàng / Người nhận']}
    testId="customer-refund-print-sheet"
  />;
}
