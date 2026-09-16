import Link from 'next/link';
import styles from './workspace.module.css';

export type InventoryAdjustmentTab = 'documents' | 'manual' | 'bulk' | 'export';

const tabs: Array<{ key: InventoryAdjustmentTab; href: string; label: string }> = [
  { key: 'documents', href: '/inventory/adjustments', label: 'Phiếu điều chỉnh' },
  { key: 'manual', href: '/inventory/adjustments?tab=manual', label: 'Điều chỉnh thủ công' },
  { key: 'bulk', href: '/inventory/adjustments/bulk', label: 'Điều chỉnh hàng loạt' },
  { key: 'export', href: '/inventory/adjustments/export', label: 'Xuất dữ liệu' },
];

export function InventoryAdjustmentTabs({ active }: { active: InventoryAdjustmentTab }) {
  return (
    <nav className={styles.adjustmentTabs} aria-label="Chức năng Điều chỉnh tồn">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`${styles.adjustmentTab} ${active === tab.key ? styles.adjustmentTabActive : ''}`}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
