'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './app-shell-shortcuts.module.css';

const BUSINESS_PATH_PREFIXES = [
  '/dashboard',
  '/organization',
  '/customers',
  '/suppliers',
  '/products',
  '/pricing',
  '/document-numbering',
  '/access',
  '/inventory',
  '/sales',
  '/purchasing',
  '/accounting',
];

export function ManagementShortcut() {
  const pathname = usePathname();
  const isBusinessScreen = BUSINESS_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isBusinessScreen || pathname.startsWith('/management')) return null;

  return (
    <Link
      href="/management"
      className={styles.managementShortcut}
      data-testid="nav-management-shortcut"
      aria-label="Mở công việc hằng ngày của Sales Admin"
    >
      Công việc hằng ngày
    </Link>
  );
}
