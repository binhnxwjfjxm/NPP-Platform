'use client';

import { useEffect, useMemo, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';
import type { CustomerPayment } from '../../../lib/customer-payment-types';

type Envelope<T> = { data?: T };

function money(value: string, currencyCode: string) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return `${normalized || '—'} ${currencyCode}`;
  const sign = match[1];
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}

function dateText(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

function statusLabel(status: CustomerPayment['status']) {
  return {
    open: 'Chưa phân bổ',
    partially_allocated: 'Đã phân bổ một phần',
    settled: 'Đã phân bổ hết',
    reversed: 'Đã đảo',
  }[status];
}

async function readData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error('Không tải được dữ liệu in');
  return payload.data;
}

export default function CustomerPaymentPrintDock({ initialPayments }: { initialPayments: CustomerPayment[] }) {
  const printable = useMemo(() => initialPayments.filter((item) => Boolean(item.documentNumber)), [initialPayments]);
  const [payments, setPayments] = useState(printable);
  const [selectedId, setSelectedId] = useState(printable[0]?.id ?? '');
  const [detail, setDetail] = useState<CustomerPayment | null>(printable[0] ?? null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!selectedId || detail?.id === selectedId) return;
    let active = true;
    void readData<CustomerPayment>(`/api/customer-payments/${selectedId}`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId, detail?.id]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<CustomerPayment[]>('/api/customer-payments?limit=1000'))
        .filter((item) => Boolean(item.documentNumber));
      setPayments(next);
      const nextId = next.some((item) => item.id === selectedId) ? selectedId : next[0]?.id ?? '';
      setSelectedId(nextId);
      if (nextId) setDetail(await readData<CustomerPayment>(`/api/customer-payments/${nextId}`));
    } finally {
      setRefreshing(false);
    }
  }

  if (!payments.length) return null;
  const current = detail?.id === selectedId ? detail : null;

  return (
    <DocumentPrintDock
      label="Phiếu thu khách hàng"
      value={selectedId}
      options={payments.map((item) => ({ id: item.id, label: `${item.documentNumber} · ${item.customerName || item.customerCode || 'Khách hàng'}` }))}
      onChange={(id) => { setSelectedId(id); setDetail(null); }}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`customer-payment-${current.id}`}
          actionLabel="In"
          title="PHIẾU THU"
          subtitle="Chứng từ thu tiền khách hàng"
          number={current.documentNumber}
          status={statusLabel(current.status)}
          size="A5"
          meta={[
            { label: 'Khách hàng', value: `${current.customerCode || '—'} — ${current.customerName || '—'}`, full: true },
            { label: 'Kho nhận tiền', value: `${current.warehouseCode || '—'} — ${current.warehouseName || '—'}` },
            { label: 'Ngày thu', value: dateText(current.paymentDate) },
            { label: 'Phương thức', value: current.paymentMethod },
            { label: 'Tham chiếu', value: current.externalReference || '—' },
            { label: 'Người ghi nhận', value: current.postedBy || '—' },
          ]}
          totals={[
            { label: 'SỐ TIỀN ĐÃ NHẬN', value: money(current.originalAmount, current.currencyCode), emphasis: true },
            { label: 'Đã phân bổ', value: money(current.allocatedAmount, current.currencyCode) },
            { label: 'Còn chưa phân bổ', value: money(current.remainingAmount, current.currencyCode) },
          ]}
          note={current.status === 'reversed'
            ? `ĐÃ ĐẢO${current.reversalReason ? ` — ${current.reversalReason}` : ''}`
            : current.note || undefined}
          signatures={['Người nộp tiền', 'Người lập phiếu', 'Thủ quỹ / Kế toán']}
          testId="customer-payment-print-sheet"
        />
      ) : null}
    </DocumentPrintDock>
  );
}
