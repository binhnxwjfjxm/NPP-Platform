'use client';

import { useEffect, useState } from 'react';
import RetailWorkspace from './retail-workspace';
import { RetailInventoryPanel, type RetailInventoryWarehouse } from './retail-inventory-panel';
import styles from './retail-inventory.module.css';

type InventoryAccessPayload = {
  warehouses: RetailInventoryWarehouse[];
};

type InventoryAccessResponse = {
  data?: InventoryAccessPayload;
};

type RetailMode = 'sales' | 'inventory';
type RetailSalesTab = 'home' | 'entry' | 'orders' | 'settings';

export default function RetailRoot() {
  const [mode, setMode] = useState<RetailMode>('sales');
  const [salesTab, setSalesTab] = useState<RetailSalesTab>('home');
  const [inventoryAccess, setInventoryAccess] = useState<InventoryAccessPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/retail/inventory', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null) as InventoryAccessResponse | null;
      return payload?.data ?? null;
    }).then((access) => {
      if (!controller.signal.aborted && access?.warehouses) setInventoryAccess(access);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  function openSales(tab: RetailSalesTab) {
    setSalesTab(tab);
    setMode('sales');
  }

  if (mode === 'inventory' && inventoryAccess) {
    return <div className={`${styles.root} retail-lot7 retail-issue675`}>
      <RetailInventoryPanel warehouses={inventoryAccess.warehouses} />
      <nav className="bottom-nav" aria-label="Điều hướng Retail">
        <button type="button" onClick={() => openSales('home')}><span>⌂</span>Trang chủ</button>
        <button type="button" onClick={() => openSales('entry')}><span>＋</span>Lên đơn</button>
        <button type="button" onClick={() => openSales('orders')}><span>▤</span>Đơn hàng</button>
        <button type="button" className="active" aria-current="page"><span>▣</span>Tồn kho</button>
        <button type="button" onClick={() => openSales('settings')}><span>⚙</span>Cài đặt</button>
      </nav>
    </div>;
  }

  return <RetailWorkspace
    initialTab={salesTab}
    inventoryAvailable={Boolean(inventoryAccess)}
    onOpenInventory={() => setMode('inventory')}
    onTabChange={setSalesTab}
  />;
}
