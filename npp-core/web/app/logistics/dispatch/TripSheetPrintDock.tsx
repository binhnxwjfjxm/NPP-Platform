'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
type TripStatus = 'draft' | 'planned' | 'locked' | 'dispatched';
type DispatchTrip = { id: string; number: string; warehouseCode: string | null; warehouseName: string | null; vehicleCode: string | null; licensePlate: string | null; driverCode: string | null; driverName: string | null; plannedStartAt: string | null; status: TripStatus; handoverReceiverName: string | null; handoverNote: string | null; dispatchedAt: string | null; stops: readonly { id: string; sequence: number; assignments: readonly { assignmentId: string; deliveryOrderNumber: string | null; customerCode: string | null; customerName: string | null }[] }[] };
const STATUS_LABEL: Record<TripStatus, string> = { draft: 'Nháp', planned: 'Đã lập kế hoạch', locked: 'Chờ bàn giao', dispatched: 'Đã xuất phát' };
function dateTime(value: string | null) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN'); }
export default function TripSheetPrintDock({ trip }: { trip: DispatchTrip | null }) {
  if (!trip || !['locked', 'dispatched'].includes(trip.status)) return null;
  const rows = trip.stops.flatMap((stop) => stop.assignments.map((assignment) => ({ id: assignment.assignmentId, cells: { stop: stop.sequence, order: assignment.deliveryOrderNumber || '—', customer: <><strong>{assignment.customerName || '—'}</strong><br />{assignment.customerCode || '—'}</> } })));
  return <BusinessDocumentPrint id={`trip-sheet-${trip.id}`} actionLabel="In" title="PHIẾU CHUYẾN GIAO HÀNG" subtitle="Danh sách bàn giao chuyến" number={trip.number} status={STATUS_LABEL[trip.status]}
    meta={[{ label: 'Kho xuất phát', value: `${trip.warehouseCode || '—'} — ${trip.warehouseName || '—'}` }, { label: 'Xe', value: trip.licensePlate || trip.vehicleCode || '—' }, { label: 'Tài xế', value: `${trip.driverCode || '—'} — ${trip.driverName || '—'}` }, { label: 'Dự kiến', value: dateTime(trip.plannedStartAt) }, { label: 'Xuất phát', value: dateTime(trip.dispatchedAt) }, { label: 'Người nhận bàn giao', value: trip.handoverReceiverName || trip.driverName || '—' }]}
    columns={[{ key: 'stop', label: 'Điểm', align: 'center' }, { key: 'order', label: 'Phiếu giao' }, { key: 'customer', label: 'Khách hàng' }]} rows={rows}
    totals={[{ label: 'Số điểm giao', value: trip.stops.length }, { label: 'Số phiếu bàn giao', value: rows.length, emphasis: true }]} note={trip.handoverNote || undefined}
    signatures={['Điều phối', 'Thủ kho', 'Tài xế / Người nhận']} testId="trip-sheet-print-sheet" />;
}
