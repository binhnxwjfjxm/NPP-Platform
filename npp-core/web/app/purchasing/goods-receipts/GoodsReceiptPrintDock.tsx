'use client';

import { useEffect, useMemo, useState } from 'react';
import BusinessDocumentPrint from '../../components/business-document-print';
import DocumentPrintDock from '../../components/document-print-dock';
import type { GoodsReceipt } from '../../../lib/goods-receipt-types';
import { GOODS_RECEIPT_STATUS_LABELS, formatGoodsReceiptDate } from '../../../lib/goods-receipt-types';
import { formatDecimalString } from '../../../lib/purchase-order-types';

type Envelope<T> = { data?: T };

async function readData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error('Không tải được dữ liệu in');
  return payload.data;
}

export default function GoodsReceiptPrintDock({ initialReceipts }: { initialReceipts: GoodsReceipt[] }) {
  const printable = useMemo(() => initialReceipts.filter((item) => Boolean(item.documentNumber) && item.status !== 'draft'), [initialReceipts]);
  const [receipts, setReceipts] = useState(printable);
  const [selectedId, setSelectedId] = useState(printable[0]?.id ?? '');
  const [detail, setDetail] = useState<GoodsReceipt | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void readData<GoodsReceipt>(`/api/goods-receipts/${selectedId}`)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [selectedId]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = (await readData<GoodsReceipt[]>('/api/goods-receipts?limit=1000'))
        .filter((item) => Boolean(item.documentNumber) && item.status !== 'draft');
      setReceipts(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? '');
    } finally {
      setRefreshing(false);
    }
  }

  if (!receipts.length) return null;
  const current = detail?.id === selectedId ? detail : null;

  return (
    <DocumentPrintDock
      label="Phiếu nhận hàng"
      value={selectedId}
      options={receipts.map((item) => ({ id: item.id, label: `${item.documentNumber} · ${item.supplierName}` }))}
      onChange={setSelectedId}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {current ? (
        <BusinessDocumentPrint
          id={`goods-receipt-${current.id}`}
          actionLabel="In"
          title="PHIẾU NHẬN HÀNG"
          subtitle="Chứng từ nhập hàng"
          number={current.documentNumber || '—'}
          status={GOODS_RECEIPT_STATUS_LABELS[current.status]}
          meta={[
            { label: 'Nhà cung cấp', value: `${current.supplierCode} — ${current.supplierName}` },
            { label: 'Đơn đặt hàng', value: current.purchaseOrderNumber || '—' },
            { label: 'Kho nhận', value: `${current.warehouseCode} — ${current.warehouseName}` },
            { label: 'Ngày nhận', value: formatGoodsReceiptDate(current.receiptDate) },
            { label: 'Tham chiếu giao', value: current.supplierDeliveryReference || '—' },
            { label: 'Số dòng', value: formatDecimalString(String(current.lineCount)) },
          ]}
          columns={[
            { key: 'no', label: 'STT', align: 'center' },
            { key: 'item', label: 'Sản phẩm / SKU' },
            { key: 'received', label: 'Thực nhận', align: 'right' },
            { key: 'accepted', label: 'Chấp nhận', align: 'right' },
            { key: 'rejected', label: 'Loại', align: 'right' },
            { key: 'unit', label: 'ĐVT', align: 'center' },
            { key: 'lot', label: 'Lô / HSD' },
          ]}
          rows={(current.lines ?? []).map((line) => ({
            id: line.id,
            cells: {
              no: line.lineNumber,
              item: <><strong>{line.itemName}</strong><br />{line.skuCode}</>,
              received: formatDecimalString(line.receivedQuantity),
              accepted: formatDecimalString(line.acceptedQuantity),
              rejected: formatDecimalString(line.rejectedQuantity),
              unit: line.unitCode,
              lot: `${line.lotCode || '—'}${line.expiryDate ? ` · HSD ${line.expiryDate}` : ''}`,
            },
          }))}
          totals={[
            { label: 'Tổng thực nhận', value: formatDecimalString(current.receivedQuantityTotal) },
            { label: 'Tổng chấp nhận', value: formatDecimalString(current.acceptedQuantityTotal), emphasis: true },
            { label: 'Tổng loại', value: formatDecimalString(current.rejectedQuantityTotal) },
            { label: 'Chốt thiếu', value: formatDecimalString(current.shortageClosedQuantityTotal) },
          ]}
          note={current.note || undefined}
          signatures={['Người giao', 'Thủ kho', 'Người kiểm nhận']}
          testId="goods-receipt-print-sheet"
        />
      ) : null}
    </DocumentPrintDock>
  );
}
