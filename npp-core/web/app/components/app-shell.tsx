'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import styles from './app-shell.module.css';
import { organizationNav } from '../../lib/organization-types';

type AppShellProps = {
  title: string;
  subtitle?: string;
  kicker?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

function iconFor(href: string): string {
  if (href === '/dashboard') return '◉';
  if (href === '/organization') return '⌂';
  if (href.includes('branches')) return '◫';
  if (href.includes('warehouses')) return '▣';
  if (href.includes('locations')) return '▤';
  return '•';
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/organization') {
    return pathname === '/organization' || pathname.startsWith('/organization/');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ title, subtitle, kicker = 'NPP Core · Quản trị nội bộ', children, actions }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navItems = useMemo(
    () => organizationNav.map((item) => ({ ...item, active: isActive(pathname, item.href), icon: iconFor(item.href) })),
    [pathname],
  );

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`} aria-label="Điều hướng chính">
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">N</div>
          <div className={styles.brandText}>
            <p className={styles.brandName}>NPP Core</p>
            <p className={styles.brandMeta}>Shell quản trị tiếng Việt</p>
          </div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navLabel}>Khu vực làm việc</div>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${item.active ? styles.navItemActive : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
              <span className={styles.navText}>
                <span className={styles.navTitle}>{item.label}</span>
                <span className={styles.navHint}>{item.href === '/dashboard' ? 'Tổng hợp số liệu' : 'Quản trị dữ liệu gốc'}</span>
              </span>
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.footerCard}>
            <p className={styles.footerTitle}>Luồng chính đang mở</p>
            <p className={styles.footerText}>
              Mọi mutation đều đi qua gateway server-side, có idempotency và expectedUpdatedAt.
            </p>
            <span className={styles.footerChip}>Không lộ secret ra browser</span>
          </div>
        </div>
      </aside>

      <div className={`${styles.backdrop} ${open ? '' : styles.backdropHidden}`} onClick={() => setOpen(false)} aria-hidden="true" />

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.menuButton}
              onClick={() => setOpen((value) => !value)}
              aria-label="Mở điều hướng"
              aria-expanded={open}
            >
              ☰
            </button>
            <div className={styles.titleBlock}>
              <p className={styles.kicker}>{kicker}</p>
              <h1 className={styles.title}>{title}</h1>
              {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
            </div>
          </div>

          <div className={styles.topbarActions}>
            {actions}
            <span className={styles.statusPill}>
              <span className={styles.statusDot} aria-hidden="true" />
              Đang hoạt động
            </span>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

