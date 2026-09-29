'use client';

import { useEffect, useState } from 'react';
import RetailWorkspace, { type RetailTab } from './retail-workspace';
import { RetailInventoryPanel, type RetailInventoryWarehouse } from './retail-inventory-panel';
import styles from './retail-inventory.module.css';

type InventoryAccessPayload = {
  warehouses: RetailInventoryWarehouse[];
};

type InventoryAccessResponse = {
  data?: InventoryAccessPayload;
};

type RetailMode = 'sales' | 'inventory';

type RetailBottomNavProps = {
  mode: RetailMode;
  salesTab: RetailTab;
  inventoryAvailable: boolean;
  onOpenSales: (tab: RetailTab) => void;
  onOpenInventory: () => void;
};

function RetailBottomNav({
  mode,
  salesTab,
  inventoryAvailable,
  onOpenSales,
  onOpenInventory,
}: RetailBottomNavProps) {
  return <nav className="retail-bottom-nav" aria-label="Điều hướng Retail">
    <button type="button" className={mode === 'sales' && salesTab === 'home' ? 'active' : ''} onClick={() => onOpenSales('home')}><span>⌂</span>Trang chủ</button>
    <button type="button" className={mode === 'sales' && salesTab === 'entry' ? 'active' : ''} onClick={() => onOpenSales('entry')}><span>＋</span>Lên đơn</button>
    <button type="button" className={mode === 'sales' && salesTab === 'orders' ? 'active' : ''} onClick={() => onOpenSales('orders')}><span>▤</span>Đơn hàng</button>
    {inventoryAvailable ? <button type="button" className={mode === 'inventory' ? 'active' : ''} aria-current={mode === 'inventory' ? 'page' : undefined} onClick={onOpenInventory}><span>▣</span>Tồn kho</button> : null}
    <button type="button" className={mode === 'sales' && salesTab === 'settings' ? 'active' : ''} onClick={() => onOpenSales('settings')}><span>⚙</span>Cài đặt</button>
  </nav>;
}

export default function RetailRoot() {
  const [mode, setMode] = useState<RetailMode>('sales');
  const [salesTab, setSalesTab] = useState<RetailTab>('home');
  const [inventoryAccess, setInventoryAccess] = useState<InventoryAccessPayload | null>(null);
  const [inventoryAccessResolved, setInventoryAccessResolved] = useState(false);

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
      if (controller.signal.aborted) return;
      if (access?.warehouses) setInventoryAccess(access);
      setInventoryAccessResolved(true);
    }).catch(() => {
      if (!controller.signal.aborted) setInventoryAccessResolved(true);
    });
    return () => controller.abort();
  }, []);

  function openSales(tab: RetailTab) {
    setSalesTab(tab);
    setMode('sales');
  }

  const inventoryAvailable = Boolean(inventoryAccess);

  return <>
    {mode === 'inventory' && inventoryAccess
      ? <div className={`${styles.root} retail-lot7 retail-issue675`}><RetailInventoryPanel warehouses={inventoryAccess.warehouses} /></div>
      : <RetailWorkspace activeTab={salesTab} onTabChange={setSalesTab} />}
    {inventoryAccessResolved ? <RetailBottomNav
      mode={mode}
      salesTab={salesTab}
      inventoryAvailable={inventoryAvailable}
      onOpenSales={openSales}
      onOpenInventory={() => setMode('inventory')}
    /> : null}
  </>;
}
