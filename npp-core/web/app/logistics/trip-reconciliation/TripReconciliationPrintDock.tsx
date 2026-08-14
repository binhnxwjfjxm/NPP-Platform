'use client';

import { useEffect, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';

type TripListItem = {
  id: string;
  number: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  licensePlate: string | null;
  driverName: string | null;
  status: 'draft' | 'planned' | 'locked' | 'dispatched' | 'closed';
};
type ReconciliationLine = {
  assignmentId: string;
  stopSequence: number;
  deliveryOrderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
  attemptResult: 'delivered_full' | 'delivered_partial' | 'failed' | 'rescheduled' | null;
  sku: string;
  itemName: string;
  unitCode: string;
  lotCode: string | null;
  issuedBaseQuantity: string;
  deliveredBaseQuantity: string;
  returnedBaseQuantity: string;
  outstandingBaseQuantity: string;
};
type Reconciliation = {
  id: string;
  number: string;
  status: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  licensePlate: string | null;
  driverName: string | null;
  canClose: boolean;
  closedAt: string | null;
  lines: ReconciliationLine[];
  receipts: Array<{ id: string; receivedAt: string }>;
};
type Envelope<T> = { data?: T };

const RESULT_LABELS: Record<NonNullable<ReconciliationLine['attemptResult']>, string> = {
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Không giao được',
  rescheduled: 'Hẹn giao lại',
};

function quantity(value: string) {
  return value.includes('.') ? value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') : value;
}

function dateTime(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

async function readData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error('Không tải được dữ liệu in');
  return payload.data;
}

export default function TripReconciliationPrintDock() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Reconciliation | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<TripListItem[]>('/api/logistics/trips?status=all'))
        .filter((trip) => trip.status === 'dispatched' || trip.status === 'closed');
      setTrips(next);
      const nextId = next.some((trip) => trip.id === selectedId) ? selectedId : next[0]?.id ?? '';
      setSelectedId(nextId);
      if (nextId) setDetail(await readData<Reconciliation>(`/api/logistics/trips/${nextId}/reconciliation`));
      else setDetail(null);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selectedId || detail?.id === selectedId) return;
    let active = true;
    void readData<Reconciliation>(`/api/logistics/trips/${selectedId}/reconciliation`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId, detail?.id]);

  if (!trips.length) return null;
  const current = detail?.id === selectedId ? detail : null;

  return (
    <DocumentPrintDock
      label="Đối soát chuyến"
      value={selectedId}
      options={trips.map((trip) => ({ id: trip.id, label: `${trip.number} · ${trip.licensePlate || 'Xe'}` }))}
      onChange={(id) => { setSelectedId(id); setDetail(null); }}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`trip-reconciliation-${current.id}`}
          actionLabel="In"
          title="BIÊN BẢN ĐỐI SOÁT CHUYẾN"
          subtitle="Đối chiếu giao hàng và hàng quay về"
          number={current.number}
          status={current.status === 'closed' ? 'Đã đóng chuyến' : 'Đang đối soát'}
          meta={[
            { label: 'Kho', value: `${current.warehouseCode || '—'} — ${current.warehouseName || '—'}` },
            { label: 'Xe', value: current.licensePlate || '—' },
            { label: 'Tài xế', value: current.driverName || '—' },
            { label: 'Số lần nhập hàng về', value: current.receipts.length },
            { label: 'Thời điểm đóng', value: dateTime(current.closedAt) },
            { label: 'Có thể đóng', value: current.canClose ? 'Có' : 'Chưa' },
          ]}
          columns={[
            { key: 'stop', label: 'Điểm', align: 'center' },
            { key: 'order', label: 'Phiếu giao' },
            { key: 'customer', label: 'Khách hàng' },
            { key: 'item', label: 'SKU / hàng hóa' },
            { key: 'result', label: 'Kết quả' },
            { key: 'issued', label: 'Xuất', align: 'right' },
            { key: 'delivered', label: 'Đã giao', align: 'right' },
            { key: 'returned', label: 'Đã về', align: 'right' },
            { key: 'outstanding', label: 'Còn trên xe', align: 'right' },
          ]}
          rows={current.lines.map((line) => ({
            id: `${line.assignmentId}-${line.sku}-${line.lotCode || ''}`,
            cells: {
              stop: line.stopSequence,
              order: line.deliveryOrderNumber || '—',
              customer: `${line.customerCode || '—'} — ${line.customerName || '—'}`,
              item: <><strong>{line.itemName}</strong><br />{line.sku}{line.lotCode ? ` · Lô ${line.lotCode}` : ''}</>,
              result: line.attemptResult ? RESULT_LABELS[line.attemptResult] : 'Chưa có kết quả',
              issued: `${quantity(line.issuedBaseQuantity)} ${line.unitCode}`,
              delivered: quantity(line.deliveredBaseQuantity),
              returned: quantity(line.returnedBaseQuantity),
              outstanding: quantity(line.outstandingBaseQuantity),
            },
          }))}
          note={current.canClose ? 'Đã đối chiếu đủ điều kiện đóng chuyến.' : 'Còn hàng/chứng từ cần đối chiếu trước khi đóng chuyến.'}
          signatures={['Điều phối', 'Thủ kho', 'Tài xế']}
          testId="trip-reconciliation-print-sheet"
        />
      ) : null}
    </DocumentPrintDock>
  );
}
