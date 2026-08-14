'use client';

import { useEffect, useMemo, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';
import { formatDate, formatQuantity } from '../../../lib/inventory-types';
import type { InventoryTransfer } from './transfer-workspace';

type Envelope<T> = { data?: T };

const STATUS_LABEL: Record<InventoryTransfer['status'], string> = {
  draft: 'Nháp',
  approved: 'Đã duyệt',
  dispatched: 'Đã xuất kho nguồn',
  cancelled: 'Đã hủy',
};

async function readData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error('Không tải được dữ liệu in');
  return payload.data;
}

export default function TransferPrintDock({ initialTransfers }: { initialTransfers: InventoryTransfer[] }) {
  const printable = useMemo(() => initialTransfers.filter((item) => Boolean(item.documentNumber) && item.status !== 'draft'), [initialTransfers]);
  const [transfers, setTransfers] = useState(printable);
  const [selectedId, setSelectedId] = useState(printable[0]?.id ?? '');
  const [detail, setDetail] = useState<InventoryTransfer | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void readData<InventoryTransfer>(`/api/inventory/transfers/${selectedId}`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<InventoryTransfer[]>('/api/inventory/transfers?limit=500'))
        .filter((item) => Boolean(item.documentNumber) && item.status !== 'draft');
      setTransfers(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
    } finally {
      setRefreshing(false);
    }
  }

  if (!transfers.length) return null;
  const current = detail?.id === selectedId ? detail : null;

  return (
    <DocumentPrintDock
      label="Phiếu chuyển kho"
      value={selectedId}
      options={transfers.map((item) => ({ id: item.id, label: `${item.documentNumber} · ${item.sourceWarehouseCode} → ${item.destinationWarehouseCode}` }))}
      onChange={setSelectedId}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`inventory-transfer-${current.id}`}
          actionLabel="In"
          title="PHIẾU CHUYỂN KHO"
          subtitle="Chứng từ điều chuyển tồn kho"
          number={current.documentNumber || '—'}
          status={STATUS_LABEL[current.status]}
          meta={[
            { label: 'Kho xuất', value: `${current.sourceWarehouseCode} — ${current.sourceWarehouseName}` },
            { label: 'Kho nhận', value: `${current.destinationWarehouseCode} — ${current.destinationWarehouseName}` },
            { label: 'Ngày chuyển', value: formatDate(current.transferDate) },
            { label: 'Ngày duyệt', value: formatDate(current.approvedAt) },
            { label: 'Ngày xuất', value: formatDate(current.dispatchedAt) },
            { label: 'Số dòng', value: current.lineCount },
          ]}
          columns={[
            { key: 'no', label: 'STT', align: 'center' },
            { key: 'item', label: 'Sản phẩm / SKU' },
            { key: 'location', label: 'Vị trí / Lô' },
            { key: 'qty', label: 'Số lượng', align: 'right' },
            { key: 'unit', label: 'ĐVT', align: 'center' },
            { key: 'base', label: 'SL cơ sở', align: 'right' },
          ]}
          rows={(current.lines ?? []).map((line) => ({
            id: line.id,
            cells: {
              no: line.lineNumber,
              item: <><strong>{line.itemName}</strong><br />{line.sourceSku}</>,
              location: `${line.sourceLocationId || '—'} / ${line.lotCode || '—'}`,
              qty: formatQuantity(line.sourceQuantity),
              unit: line.sourceUnitCode,
              base: formatQuantity(line.baseQuantity),
            },
          }))}
          totals={[{ label: 'Tổng SL cơ sở', value: formatQuantity(current.baseQuantityTotal), emphasis: true }]}
          note={current.status === 'cancelled'
            ? `ĐÃ HỦY${current.cancellationReason ? ` — ${current.cancellationReason}` : ''}`
            : current.note || undefined}
          signatures={['Người lập', 'Thủ kho xuất', 'Thủ kho nhận']}
          testId="inventory-transfer-print-sheet"
        />
      ) : null}
    </DocumentPrintDock>
  );
}
