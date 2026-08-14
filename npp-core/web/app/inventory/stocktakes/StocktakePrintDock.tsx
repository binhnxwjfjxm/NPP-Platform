'use client';

import { useEffect, useMemo, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';
import { formatDate, formatQuantity } from '../../../lib/inventory-types';
import type { Stocktake } from '../../../lib/stocktake-types';
import { STOCKTAKE_STATUS_LABELS } from '../../../lib/stocktake-types';

type Envelope<T> = { data?: T };

async function readData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error('Không tải được dữ liệu in');
  return payload.data;
}

export default function StocktakePrintDock({ initialStocktakes }: { initialStocktakes: Stocktake[] }) {
  const printable = useMemo(() => initialStocktakes.filter((item) => item.status !== 'draft'), [initialStocktakes]);
  const [stocktakes, setStocktakes] = useState(printable);
  const [selectedId, setSelectedId] = useState(printable[0]?.id ?? '');
  const [detail, setDetail] = useState<Stocktake | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void readData<Stocktake>(`/api/inventory/stocktakes/${selectedId}`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<Stocktake[]>('/api/inventory/stocktakes?limit=500'))
        .filter((item) => item.status !== 'draft');
      setStocktakes(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
    } finally {
      setRefreshing(false);
    }
  }

  if (!stocktakes.length) return null;
  const current = detail?.id === selectedId ? detail : null;

  return (
    <DocumentPrintDock
      label="Phiếu kiểm kê"
      value={selectedId}
      options={stocktakes.map((item) => ({ id: item.id, label: `${item.stocktakeNumber} · ${item.warehouseCode}` }))}
      onChange={setSelectedId}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`stocktake-${current.id}`}
          actionLabel="In"
          title="PHIẾU KIỂM KÊ"
          subtitle="Chứng từ kiểm kê kho"
          number={current.stocktakeNumber}
          status={STOCKTAKE_STATUS_LABELS[current.status]}
          meta={[
            { label: 'Kho', value: `${current.warehouseCode} — ${current.warehouseName}` },
            { label: 'Vòng đếm', value: current.currentRound },
            { label: 'Số dòng', value: current.lineCount },
            { label: 'Ngày tạo', value: formatDate(current.createdAt) },
            { label: 'Ngày duyệt', value: formatDate(current.approvedAt) },
            { label: 'Ngày ghi sổ', value: formatDate(current.postedAt) },
          ]}
          columns={[
            { key: 'no', label: 'STT', align: 'center' },
            { key: 'sku', label: 'SKU' },
            { key: 'location', label: 'Vị trí / Lô' },
            { key: 'expected', label: 'Theo sổ', align: 'right' },
            { key: 'counted', label: 'Thực đếm', align: 'right' },
            { key: 'delta', label: 'Chênh lệch', align: 'right' },
            { key: 'unit', label: 'ĐVT', align: 'center' },
          ]}
          rows={(current.lines ?? []).map((line) => ({
            id: line.id,
            cells: {
              no: line.lineNumber,
              sku: line.sourceSku,
              location: `${line.locationCode || '—'} / ${line.lotCode || '—'}`,
              expected: formatQuantity(line.expectedBaseQuantity ?? '0'),
              counted: line.countedBaseQuantity == null ? '—' : formatQuantity(line.countedBaseQuantity),
              delta: line.finalDelta == null ? '—' : formatQuantity(line.finalDelta),
              unit: line.sourceUnitCode,
            },
          }))}
          note={current.status === 'reversed'
            ? `ĐÃ ĐẢO${current.reversalReason ? ` — ${current.reversalReason}` : ''}`
            : current.status === 'cancelled'
              ? `ĐÃ HỦY${current.cancelReason ? ` — ${current.cancelReason}` : ''}`
              : current.note || undefined}
          signatures={['Người kiểm kê', 'Thủ kho', 'Người duyệt']}
          testId="stocktake-print-sheet"
        />
      ) : null}
    </DocumentPrintDock>
  );
}
