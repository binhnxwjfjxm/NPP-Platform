'use client';

import BusinessDocumentPrint from '../../components/business-document-print';
import { formatQuantity } from '../../../lib/inventory-types';
import { formatSignedExactDecimal } from '../../../lib/decimal-display.js';
import { officeActorLabel } from '../../../lib/inventory-workflow-errors';
import { adjustmentStatusLabels, type InventoryAdjustment } from '../../../lib/inventory-adjustment-types';

function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(parsed);
}

export function inventoryAdjustmentPrintSurfaceId(id: string): string {
  return `inventory-adjustment-print-${id}`;
}

function signedDelta(document: InventoryAdjustment, quantity: string): string {
  const signed = document.adjustmentDirection === 'OUT' ? `-${quantity}` : quantity;
  return formatSignedExactDecimal(signed);
}

export default function InventoryAdjustmentPrintBundle({ documents }: { documents: InventoryAdjustment[] }) {
  return (
    <>
      {documents.map((document) => {
        const direction = document.adjustmentDirection === 'IN'
          ? 'TĂNG'
          : document.adjustmentDirection === 'OUT'
            ? 'GIẢM'
            : '';
        const notPosted = !['POSTED', 'REVERSED'].includes(document.status);
        const note = [
          notPosted ? 'CHƯA CẬP NHẬT TỒN KHO' : '',
          document.reasonNote,
        ].filter(Boolean).join(' — ');
        return (
          <BusinessDocumentPrint
            key={document.id}
            id={inventoryAdjustmentPrintSurfaceId(document.id)}
            documentType="INVENTORY_ADJUSTMENT"
            showAction={false}
            title={direction ? `PHIẾU ĐIỀU CHỈNH ${direction} TỒN` : 'PHIẾU ĐIỀU CHỈNH TỒN'}
            subtitle="Chứng từ đối chiếu tồn kho"
            number={document.adjustmentNumber}
            status={adjustmentStatusLabels[document.status]}
            meta={[
              { key: 'batch', label: 'Mã đợt đối soát', value: document.reconciliationBatchCode || '—' },
              { key: 'warehouse', label: 'Kho', value: `${document.warehouseCode ?? ''} — ${document.warehouseName ?? ''}` },
              { key: 'created_at', label: 'Ngày lập', value: dateTime(document.createdAt) },
              { key: 'created_by', label: 'Người lập', value: officeActorLabel(document.createdBy, 'Người lập') },
              { key: 'reason', label: 'Lý do', value: document.reasonLabel ?? document.reasonCode },
              { key: 'line_count', label: 'Số dòng', value: document.lineCount },
            ]}
            columns={[
              { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center', wrap: 'nowrap' },
              { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU', wrap: 'anywhere' },
              { key: 'lot', fieldKey: 'line_lot', label: 'Lô', wrap: 'anywhere' },
              { key: 'location', fieldKey: 'line_location', label: 'Vị trí', wrap: 'anywhere' },
              { key: 'system', fieldKey: 'line_system', label: 'Tồn hệ thống', align: 'right', wrap: 'nowrap' },
              { key: 'counted', fieldKey: 'line_counted', label: 'Tồn thực tế', align: 'right', wrap: 'nowrap' },
              { key: 'delta', fieldKey: 'line_delta', label: 'Chênh lệch', align: 'right', wrap: 'nowrap' },
              { key: 'unit', fieldKey: 'line_unit', label: 'ĐVT', align: 'center', wrap: 'nowrap' },
            ]}
            rows={(document.lines ?? []).map((line) => ({
              id: line.id,
              cells: {
                no: line.lineNumber,
                item: <><strong>{line.productName || line.sourceSku}</strong><br />{line.sourceSku}</>,
                lot: line.lotCode || '—',
                location: [line.sourceLocationCode, line.sourceLocationName].filter(Boolean).join(' · ') || 'Không vị trí',
                system: line.systemBaseQuantity == null ? '—' : formatQuantity(line.systemBaseQuantity),
                counted: line.countedBaseQuantity == null ? '—' : formatQuantity(line.countedBaseQuantity),
                delta: signedDelta(document, line.baseQuantity),
                unit: line.sourceUnitCode,
              },
            }))}
            note={note}
            signatures={['Người đối chiếu', 'Thủ kho', 'Người duyệt']}
            testId="inventory-adjustment-print-sheet"
          />
        );
      })}
    </>
  );
}
