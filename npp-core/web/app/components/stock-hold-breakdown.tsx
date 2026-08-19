'use client';

import { useState } from 'react';
import { BusinessSequenceNumber } from './business-table-sequence';

type HoldOrder = Readonly<{
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  salesSku: string;
  baseSku: string;
  baseUnitCode: string;
  deliveryMode: string | null;
  deliveryExecutionMode: string | null;
  fulfillmentStatus: string | null;
  heldBaseQuantity: string;
}>;

type HoldBreakdown = Readonly<{
  heldBaseQuantity: string;
  availableBaseQuantity: string;
  orders: readonly HoldOrder[];
}>;

type ApiEnvelope = Readonly<{
  data?: HoldBreakdown;
  error?: { message?: string };
}>;

function formatQuantity(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${match[1]}${integer}${fraction ? `,${fraction}` : ''}`;
}

function flowLabel(mode: string | null, execution: string | null) {
  if (mode === 'PICKUP') return 'Khách nhận tại kho';
  if (mode === 'DELIVERY' && execution === 'MANUAL') return 'Giao thủ công';
  if (mode === 'DELIVERY') return 'Giao theo chuyến';
  return 'Đơn bán';
}

export function StockHoldBreakdown({
  warehouseId,
  baseVariantId,
  excludeSalesOrderId = null,
  displayedHeldQuantity,
  baseUnitCode = '',
  title = 'Đơn đang giữ hàng',
}: {
  warehouseId: string;
  baseVariantId: string;
  excludeSalesOrderId?: string | null;
  displayedHeldQuantity?: string | null;
  baseUnitCode?: string | null;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<HoldBreakdown | null>(null);

  async function show() {
    setOpen(true);
    setError('');
    setBusy(true);
    try {
      const query = new URLSearchParams({ warehouseId, baseVariantId });
      if (excludeSalesOrderId) query.set('excludeSalesOrderId', excludeSalesOrderId);
      const response = await fetch(`/api/inventory/holds?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const envelope = await response.json().catch(() => ({})) as ApiEnvelope;
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message || 'Không tải được danh sách đơn đang giữ hàng.');
      }
      setData(envelope.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được danh sách đơn đang giữ hàng.');
    } finally {
      setBusy(false);
    }
  }

  const unit = String(baseUnitCode ?? '').trim();
  return (
    <>
      <button
        type="button"
        onClick={() => void show()}
        aria-label={title}
        title={title}
        style={{
          border: 0,
          background: 'transparent',
          padding: '2px 4px',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: 1,
          verticalAlign: 'middle',
        }}
      >
        👁
      </button>
      {open ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,.28)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={{
              width: 'min(720px, 100%)',
              maxHeight: '80vh',
              overflow: 'auto',
              background: 'var(--surface, #fff)',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 16px 48px rgba(0,0,0,.22)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <strong>{title}</strong>
                <div style={{ marginTop: 4, fontSize: 13, opacity: .75 }}>
                  Tổng đang giữ: {formatQuantity(data?.heldBaseQuantity ?? displayedHeldQuantity)}{unit ? ` ${unit}` : ''}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">Đóng</button>
            </div>

            {busy ? <p>Đang tải…</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {!busy && !error && data ? (
              data.orders.length ? (
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  {data.orders.map((order, index) => (
                    <article
                      key={`${order.salesOrderId}:${order.salesSku}:${index}`}
                      style={{ border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, padding: 10 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <strong><BusinessSequenceNumber rowIndex={index} /> {order.orderNumber}</strong>
                        <strong>{formatQuantity(order.heldBaseQuantity)} {order.baseUnitCode || unit}</strong>
                      </div>
                      <div style={{ marginTop: 4 }}>{order.customerName || 'Khách hàng'}</div>
                      <div style={{ marginTop: 4, fontSize: 13, opacity: .76 }}>
                        Mã hàng: {order.salesSku}{order.baseSku !== order.salesSku ? ` → ${order.baseSku}` : ''}
                        {' · '}Kho: {order.warehouseCode || order.warehouseName || '—'}
                        {' · '}{flowLabel(order.deliveryMode, order.deliveryExecutionMode)}
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p style={{ marginTop: 12 }}>Không có đơn khác đang giữ hàng.</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
