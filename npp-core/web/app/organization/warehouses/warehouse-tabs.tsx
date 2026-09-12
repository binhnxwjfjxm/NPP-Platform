import Link from 'next/link';
import styles from './warehouse-workspace.module.css';

export type WarehouseTab = 'list' | 'quick' | 'layout' | 'history';

const TABS: ReadonlyArray<{ id: WarehouseTab; label: string; href: string }> = [
  { id: 'list', label: 'Kho hàng', href: '/organization/warehouses' },
  { id: 'quick', label: 'Thiết lập nhanh', href: '/organization/warehouses?tab=quick' },
  { id: 'layout', label: 'Sơ đồ kho', href: '/organization/warehouses?tab=layout' },
  { id: 'history', label: 'Lịch sử', href: '/organization/warehouses/location-mode-history' },
];

export default function WarehouseTabs({ active }: Readonly<{ active: WarehouseTab }>) {
  return (
    <nav className={styles.tabs} aria-label="Kho hàng" data-testid="warehouse-tabs">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={tab.id === active ? styles.tabActive : styles.tab}
          aria-current={tab.id === active ? 'page' : undefined}
          data-testid={`warehouse-tab-${tab.id}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
