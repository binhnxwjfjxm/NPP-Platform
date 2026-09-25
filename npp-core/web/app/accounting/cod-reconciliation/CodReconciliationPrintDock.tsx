'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import type { CodHandover } from '../../../lib/cod-reconciliation-types';

function money(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return `${value || '—'} VND`;
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} VND`;
}
function dateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}
function statusLabel(status: CodHandover['status']) {
  return { submitted: 'Chờ xác nhận', reconciled: 'Đã khớp', discrepancy: 'Có chênh lệch', reversed: 'Đã đảo bàn giao', acceptance_reversed: 'Đã đảo xác nhận' }[status];
}

export default function CodReconciliationPrintDock({ handover }: { handover: CodHandover | null }) {
  if (!handover) return null;
  const accepted = handover.acceptance && !handover.acceptance.reversalId ? handover.acceptance.acceptedAmount : null;
  const acceptedDifference = handover.acceptance && !handover.acceptance.reversalId ? handover.acceptance.differenceAmount : handover.differenceAmount;
  return <BusinessDocumentPrint
    id={`cod-reconciliation-print-${handover.id}`}
    documentType="COD_RECONCILIATION"
    actionLabel="In / PDF"
    title="BIÊN BẢN ĐỐI SOÁT COD"
    subtitle="Đối chiếu tiền thu hộ bàn giao về Công Ty"
    showNumber={false}
    number="—"
    status={statusLabel(handover.status)}
    meta={[
      { key: 'trip', label: 'Chuyến giao', value: handover.tripNumber || 'Chưa có số chuyến' },
      { key: 'warehouse', label: 'Kho', value: `${handover.warehouseCode || '—'} — ${handover.warehouseName || '—'}` },
      { key: 'driver', label: 'Tài xế', value: `${handover.driverCode || '—'} — ${handover.driverName || '—'}` },
      { key: 'handover_at', label: 'Thời điểm bàn giao', value: dateTime(handover.handedOverAt) },
    ]}
    columns={[
      { key: 'order', fieldKey: 'line_delivery_order', label: 'Phiếu giao' },
      { key: 'customer', fieldKey: 'line_customer', label: 'Khách hàng' },
      { key: 'expected', fieldKey: 'line_expected', label: 'Đang giữ', align: 'right' },
      { key: 'handed', fieldKey: 'line_handed_over', label: 'Bàn giao', align: 'right' },
    ]}
    rows={handover.lines.map((line) => ({
      id: line.id,
      cells: { order: line.deliveryOrderNumber || '—', customer: `${line.customerCode || '—'} — ${line.customerName || '—'}`, expected: money(line.expectedAmount), handed: money(line.handedOverAmount) },
    }))}
    totals={[
      { key: 'expected_total', label: 'Tổng phải bàn giao', value: money(handover.expectedTotal) },
      { key: 'handed_over_total', label: 'Tổng đã bàn giao', value: money(handover.handedOverTotal) },
      { key: 'accepted_total', label: 'Công Ty thực nhận', value: accepted ? money(accepted) : 'Chưa xác nhận', emphasis: true },
      { key: 'difference_total', label: 'Chênh lệch', value: money(acceptedDifference) },
    ]}
    note={[handover.reason, handover.note, handover.status === 'reversed' && handover.reversalReason ? `ĐÃ ĐẢO — ${handover.reversalReason}` : ''].filter(Boolean).join(' — ') || undefined}
    signatures={['Tài xế / Người bàn giao', 'Người nhận tiền', 'Kế toán']}
    testId="cod-reconciliation-print-sheet"
  />;
}
