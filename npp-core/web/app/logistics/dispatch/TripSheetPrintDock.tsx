'use client';

import { useEffect, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';

type TripStatus = 'draft' | 'planned' | 'locked' | 'dispatched';
type TripListItem = {
  id: string;
  number: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  vehicleCode: string | null;
  licensePlate: string | null;
  driverCode: string | null;
  driverName: string | null;
  plannedStartAt: string | null;
  status: TripStatus;
};
type DispatchAssignment = {
  assignmentId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
};
type DispatchStop = { id: string; sequence: number; assignments: DispatchAssignment[] };
type DispatchTrip = TripListItem & {
  handoverReceiverName: string | null;
  handoverNote: string | null;
  dispatchedAt: string | null;
  stops: DispatchStop[];
};
type Envelope<T> = { data?: T };

const STATUS_LABEL: Record<TripStatus, string> = {
  draft: 'Nháp', planned: 'Đã lập kế hoạch', locked: 'Chờ bàn giao', dispatched: 'Đã xuất phát',
};

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

export default function TripSheetPrintDock() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<DispatchTrip | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<TripListItem[]>('/api/logistics/trips?status=all'))
        .filter((trip) => trip.status === 'locked' || trip.status === 'dispatched');
      setTrips(next);
      const nextId = next.some((trip) => trip.id === selectedId) ? selectedId : next[0]?.id ?? '';
      setSelectedId(nextId);
      if (nextId) setDetail(await readData<DispatchTrip>(`/api/logistics/trips/${nextId}/dispatch`));
      else setDetail(null);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selectedId || detail?.id === selectedId) return;
    let active = true;
    void readData<DispatchTrip>(`/api/logistics/trips/${selectedId}/dispatch`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId, detail?.id]);

  if (!trips.length) return null;
  const current = detail?.id === selectedId ? detail : null;
  const rows = current?.stops.flatMap((stop) => stop.assignments.map((assignment) => ({
    id: assignment.assignmentId,
    cells: {
      stop: stop.sequence,
      order: assignment.deliveryOrderNumber || '—',
      customer: <><strong>{assignment.customerName || '—'}</strong><br />{assignment.customerCode || '—'}</>,
    },
  }))) ?? [];

  return (
    <DocumentPrintDock
      label="Chuyến giao"
      value={selectedId}
      options={trips.map((trip) => ({ id: trip.id, label: `${trip.number} · ${trip.licensePlate || trip.vehicleCode || 'Xe'}` }))}
      onChange={(id) => { setSelectedId(id); setDetail(null); }}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`trip-sheet-${current.id}`}
          actionLabel="In"
          title="PHIẾU CHUYẾN GIAO HÀNG"
          subtitle="Trip Sheet / danh sách bàn giao"
          number={current.number}
          status={STATUS_LABEL[current.status]}
          meta={[
            { label: 'Kho xuất phát', value: `${current.warehouseCode || '—'} — ${current.warehouseName || '—'}` },
            { label: 'Xe', value: current.licensePlate || current.vehicleCode || '—' },
            { label: 'Tài xế', value: `${current.driverCode || '—'} — ${current.driverName || '—'}` },
            { label: 'Dự kiến', value: dateTime(current.plannedStartAt) },
            { label: 'Xuất phát', value: dateTime(current.dispatchedAt) },
            { label: 'Người nhận bàn giao', value: current.handoverReceiverName || current.driverName || '—' },
          ]}
          columns={[
            { key: 'stop', label: 'Điểm', align: 'center' },
            { key: 'order', label: 'Phiếu giao' },
            { key: 'customer', label: 'Khách hàng' },
          ]}
          rows={rows}
          totals={[
            { label: 'Số điểm giao', value: current.stops.length },
            { label: 'Số phiếu bàn giao', value: rows.length, emphasis: true },
          ]}
          note={current.handoverNote || undefined}
          signatures={['Điều phối', 'Thủ kho', 'Tài xế / Người nhận']}
          testId="trip-sheet-print-sheet"
        />
      ) : null}
    </DocumentPrintDock>
  );
}
