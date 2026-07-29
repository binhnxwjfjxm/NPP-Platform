"use client";

import React, { useState } from 'react';
import type { PurchaseOrder } from '../../../lib/purchase-order-types';
import PurchaseOrderList from './components/PurchaseOrderList';

export default function PurchaseOrderWorkspace({ initialPurchaseOrders, initialError }: { initialPurchaseOrders: PurchaseOrder[]; initialError: string | null; }) {
  const [items] = useState<PurchaseOrder[]>(initialPurchaseOrders ?? []);
  const [error] = useState<string | null>(initialError ?? null);
  const [loading] = useState(false);

  return (
    <div className="purchase-orders-workspace">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Đơn đặt hàng</h1>
        <div>
          <button type="button">Tạo đơn đặt hàng</button>
        </div>
      </header>

      <section>
        <div style={{ marginBottom: 12 }}>
          <input aria-label="Tìm PO" placeholder="Tìm số, nhà cung cấp, SKU..." />
        </div>

        {loading && <div>Loading…</div>}
        {error && <div role="alert">{error}</div>}
        {!loading && !error && (
          <PurchaseOrderList purchaseOrders={items} />
        )}
      </section>
    </div>
  );
}
