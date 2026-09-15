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

export default function RetailRoot() {
  const [mode, setMode] = useState<RetailMode>('sales');
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

  if (!inventoryAccess) return <RetailWorkspace />;

  return <div className={styles.root}>
    <nav className={styles.modeTabs} aria-label="Chức năng Retail">
      <button type="button" className={mode === 'sales' ? styles.activeTab : ''} aria-current={mode === 'sales' ? 'page' : undefined} onClick={() => setMode('sales')}>Bán hàng</button>
      <button type="button" className={mode === 'inventory' ? styles.activeTab : ''} aria-current={mode === 'inventory' ? 'page' : undefined} onClick={() => setMode('inventory')}>Tồn kho</button>
    </nav>
    {mode === 'inventory'
      ? <RetailInventoryPanel warehouses={inventoryAccess.warehouses} />
      : <RetailWorkspace />}
  </div>;
}
