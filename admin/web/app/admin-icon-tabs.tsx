import Link from 'next/link';
import { AdminIcon, type AdminIconName } from './admin-icons';

export type AdminIconTab = {
  href: string;
  label: string;
  icon: AdminIconName;
  active?: boolean;
  badge?: string;
};

export function AdminIconTabs({ label, tabs }: { label: string; tabs: AdminIconTab[] }) {
  return (
    <nav className="adminIconTabs" aria-label={label} data-admin-tabs>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={tab.active ? 'adminIconTab isActive' : 'adminIconTab'}
          href={tab.href}
        >
          <span className="adminIconTabGlyph"><AdminIcon name={tab.icon} size={18} /></span>
          <span className="adminIconTabLabel">{tab.label}</span>
          {tab.badge ? <span className="adminIconTabBadge">{tab.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
