'use client';

import { useEffect, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';

type DeliveryOrderStatus = 'draft' | 'ready_to_dispatch' | 'dispatched' | 'handed_over' | 'cancelled';
type PrintVariant = 'DELIVERY_ORDER' | 'PACKING_LIST';

type DeliveryOrderLine = {
  id: string;
  lineNumber: number;
  locationCode: string | null;
  lotCode: string | null;
  expiryDate?: string | null;
  sku: string;
  itemName: string;
  unitCode: string;
  deliveryBaseQuantity: string;
};

type DeliveryOrder = {
  id: string;
  number: string | null;
  salesOrderNumber: string | null;
  customerCode: string;
  customerName: string;
  warehouseCode: string;
  warehouseName: string;
  handoverMode: 'DELIVERY' | 'PICKUP';
  destination?: Record<string, unknown> | null;
  requestedDeliveryDate?: string | null;
  collectionPolicy?: string | null;
  status: DeliveryOrderStatus;
  note?: string | null;
  lineCount?: number;
  totalBaseQuantity?: string;
  confirmedAt?: string | null;
  lines?: DeliveryOrderLine[];
};

type Envelope<T> = { data?: T };

const STATUS_LABEL: Record<DeliveryOrderStatus, string> = {
  draft: 'Nháp',
  ready_to_dispatch: 'Sẵn sàng bàn giao',
  dispatched: 'Đã xuất theo chuyến',
  handed_over: 'Đã bàn giao',
  cancelled: 'Đã hủy',
};

function quantity(value: string | null | undefined) {
  const normalized = String(value ?? '0');
  return normalized.includes('.') ? normalized.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') : normalized;
}

function dateText(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('vi-VN').format(parsed);
}

function destinationText(value: Record<string, unknown> | null | undefined) {
  if (!value) return '—';
  return [value.addressLine1, value.addressLine2, value.ward, value.district, value.province]
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .join(', ') || '—';
}

async function readData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error('Không tải được dữ liệu in');
  return payload.data;
}

export default function DeliveryOrderPrintDock() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<DeliveryOrder | null>(null);
  const [variant, setVariant] = useState<PrintVariant>('DELIVERY_ORDER');
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<DeliveryOrder[]>('/api/delivery-orders?limit=500'))
        .filter((item) => Boolean(item.number) && item.status !== 'draft');
      setOrders(next);
      const nextId = next.some((item) => item.id === selectedId) ? selectedId : next[0]?.id ?? '';
      setSelectedId(nextId);
      if (nextId) setDetail(await readData<DeliveryOrder>(`/api/delivery-orders/${nextId}`));
      else setDetail(null);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selectedId || detail?.id === selectedId) return;
    let active = true;
    void readData<DeliveryOrder>(`/api/delivery-orders/${selectedId}`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId, detail?.id]);

  if (!orders.length) return null;
  const current = detail?.id === selectedId ? detail : null;
  const isPacking = variant === 'PACKING_LIST';

  return (
    <DocumentPrintDock
      label="Chứng từ giao nhận"
      value={selectedId}
      options={orders.map((item) => ({ id: item.id, label: `${item.number} · ${item.customerName}` }))}
      onChange={(id) => { setSelectedId(id); setDetail(null); }}
      secondaryLabel="Mẫu in"
      secondaryValue={variant}
      secondaryOptions={[
        { id: 'DELIVERY_ORDER', label: 'Phiếu giao hàng' },
        { id: 'PACKING_LIST', label: 'Packing List' },
      ]}
      onSecondaryChange={(id) => setVariant(id as PrintVariant)}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`delivery-order-${current.id}-${variant}`}
          actionLabel="In"
          title={isPacking ? 'PACKING LIST' : 'PHIẾU GIAO HÀNG'}
          subtitle={isPacking ? 'Danh sách đóng gói' : 'Chứng từ giao nhận'}
          number={current.number || '—'}
          status={STATUS_LABEL[current.status]}
          meta={[
            { label: 'Đơn bán hàng', value: current.salesOrderNumber || '—' },
            { label: 'Khách hàng', value: `${current.customerCode} — ${current.customerName}` },
            { label: 'Kho xuất', value: `${current.warehouseCode} — ${current.warehouseName}` },
            { label: 'Hình thức', value: current.handoverMode === 'PICKUP' ? 'Khách nhận tại kho' : 'Giao đến khách' },
            { label: 'Ngày giao dự kiến', value: dateText(current.requestedDeliveryDate) },
            { label: 'Chính sách thu', value: current.collectionPolicy || '—' },
            { label: 'Địa chỉ giao', value: destinationText(current.destination), full: true },
          ]}
          columns={[
            { key: 'no', label: 'STT', align: 'center' },
            { key: 'item', label: 'Sản phẩm / SKU' },
            { key: 'qty', label: 'Số lượng', align: 'right' },
            { key: 'unit', label: 'ĐVT', align: 'center' },
            { key: 'lot', label: 'Lô / HSD' },
            { key: 'location', label: 'Vị trí' },
          ]}
          rows={(current.lines ?? []).map((line) => ({
            id: line.id,
            cells: {
              no: line.lineNumber,
              item: <><strong>{line.itemName}</strong><br />{line.sku}</>,
              qty: quantity(line.deliveryBaseQuantity),
              unit: line.unitCode,
              lot: `${line.lotCode || '—'}${line.expiryDate ? ` · ${line.expiryDate}` : ''}`,
              location: line.locationCode || '—',
            },
          }))}
          totals={[{ label: isPacking ? 'Tổng SL đóng gói' : 'Tổng SL giao', value: quantity(current.totalBaseQuantity), emphasis: true }]}
          note={current.status === 'cancelled' ? 'ĐÃ HỦY' : current.note || undefined}
          signatures={isPacking ? ['Người đóng gói', 'Thủ kho', 'Người kiểm'] : ['Người giao', 'Khách hàng', 'Thủ kho']}
          testId={isPacking ? 'packing-list-print-sheet' : 'delivery-order-print-sheet'}
        />
      ) : null}
    </DocumentPrintDock>
  );
}
