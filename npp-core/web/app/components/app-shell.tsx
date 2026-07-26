'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import styles from './app-shell.module.css';

type AppShellProps = {
  title: string;
  subtitle?: string;
  kicker?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

type IconName =
  | 'dashboard'
  | 'organization'
  | 'branches'
  | 'warehouses'
  | 'locations'
  | 'chevron'
  | 'panel'
  | 'user';

const organizationItems = [
  { href: '/organization', label: 'Tổng quan cơ cấu', icon: 'organization' as const, testId: 'nav-organization-overview' },
  { href: '/organization/branches', label: 'Chi nhánh', icon: 'branches' as const, testId: 'nav-branches' },
  { href: '/organization/warehouses', label: 'Kho hàng', icon: 'warehouses' as const, testId: 'nav-warehouses' },
  { href: '/organization/locations', label: 'Vị trí kho', icon: 'locations' as const, testId: 'nav-locations' },
];

const accessItems = [
  { href: '/access/roles', label: 'Vai trò & phân quyền', icon: 'panel' as const, testId: 'nav-roles' },
  { href: '/access/employees', label: 'Danh mục nhân sự', icon: 'user' as const, testId: 'nav-employees' },
  { href: '/access/users', label: 'Người dùng', icon: 'user' as const, testId: 'nav-users' },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="4" rx="1.5" />
        <rect x="14" y="11" width="7" height="10" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    organization: (
      <>
        <rect x="4" y="3" width="16" height="6" rx="2" />
        <path d="M8 9v4m8-4v4M5 13h6v7H5zM13 13h6v7h-6z" />
      </>
    ),
    branches: (
      <>
        <path d="M5 4h7v6H5zM12 7h4a3 3 0 0 1 3 3v2" />
        <path d="M8.5 10v4a3 3 0 0 0 3 3H15" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
    warehouses: (
      <>
        <path d="M3 9 12 4l9 5v11H3z" />
        <path d="M7 20v-7h10v7M7 10h10" />
      </>
    ),
    locations: (
      <>
        <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    panel: <path d="M4 5h16M4 12h16M4 19h16" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/organization') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function persistCollapsed(value: boolean) {
  window.localStorage.setItem('npp-core-sidebar-collapsed', value ? '1' : '0');
}

export function AppShell({
  title,
  subtitle,
  kicker = 'Hệ thống quản trị doanh nghiệp',
  children,
  actions,
}: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(pathname.startsWith('/organization'));
  const [accessOpen, setAccessOpen] = useState(pathname.startsWith('/access'));

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('npp-core-sidebar-collapsed') === '1');
  }, []);

  useEffect(() => {
    if (pathname.startsWith('/organization')) setOrganizationOpen(true);
    if (pathname.startsWith('/access')) setAccessOpen(true);
    setMobileOpen(false);
  }, [pathname]);

  const organizationActive = pathname.startsWith('/organization');
  const accessActive = pathname.startsWith('/access');
  const logoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/logo-transparent.png';

  const organizationChildren = useMemo(
    () => organizationItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
    [pathname],
  );
  const accessChildren = useMemo(
    () => accessItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
    [pathname],
  );

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      persistCollapsed(next);
      return next;
    });
  }

  function openGroup(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
    if (collapsed) {
      setCollapsed(false);
      persistCollapsed(false);
      setOpen(true);
      return;
    }
    setOpen((current) => !current);
  }

  return (
    <div className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ''}`} data-collapsed={collapsed ? 'true' : 'false'}>
      <aside
        className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}
        aria-label="Điều hướng chính"
        data-testid="app-sidebar"
      >
        <div className={styles.brandRow}>
          <Link href="/dashboard" className={styles.brand} aria-label="Hưng Phát Company - Trang tổng quan">
            <span className={styles.logoFrame}>
              <img src={logoUrl} alt="Logo Hưng Phát Company" className={styles.logo} />
            </span>
            <span className={styles.brandText}>
              <strong>Hưng Phát Company</strong>
              <small>NPP Core</small>
            </span>
          </Link>
          <button
            type="button"
            className={styles.collapseButton}
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            data-testid="sidebar-collapse-button"
          >
            <Icon name="panel" />
          </button>
        </div>

        <div className={styles.navScroll}>
          <nav className={styles.nav}>
            <p className={styles.navLabel}>Điều hành</p>
            <Link
              href="/dashboard"
              className={`${styles.navItem} ${pathname === '/dashboard' ? styles.navItemActive : ''}`}
              data-testid="nav-dashboard"
              title={collapsed ? 'Tổng quan điều hành' : undefined}
            >
              <span className={styles.navIcon}><Icon name="dashboard" /></span>
              <span className={styles.navCopy}>
                <span className={styles.navTitle}>Tổng quan điều hành</span>
                <span className={styles.navHint}>Số liệu và tình trạng hệ thống</span>
              </span>
            </Link>

            <p className={styles.navLabel}>Danh mục nền tảng</p>
            <div className={`${styles.navGroup} ${organizationActive ? styles.navGroupActive : ''}`}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupButton}`}
                onClick={() => openGroup(setOrganizationOpen)}
                aria-expanded={organizationOpen}
                data-testid="organization-menu-toggle"
                title={collapsed ? 'Tổ chức và kho hàng' : undefined}
              >
                <span className={styles.navIcon}><Icon name="organization" /></span>
                <span className={styles.navCopy}>
                  <span className={styles.navTitle}>Tổ chức &amp; kho hàng</span>
                  <span className={styles.navHint}>Cơ cấu đơn vị và địa điểm lưu trữ</span>
                </span>
                <span className={`${styles.chevron} ${organizationOpen ? styles.chevronOpen : ''}`}>
                  <Icon name="chevron" />
                </span>
              </button>

              <div className={`${styles.subnav} ${organizationOpen && !collapsed ? styles.subnavOpen : ''}`}>
                {organizationChildren.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    className={`${styles.subnavItem} ${item.active ? styles.subnavItemActive : ''}`}
                    data-testid={item.testId}
                  >
                    <span className={styles.subnavRail} aria-hidden="true" />
                    <span className={styles.subnavIcon}><Icon name={item.icon} /></span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            <p className={styles.navLabel}>Quản trị hệ thống</p>
            <div className={`${styles.navGroup} ${accessActive ? styles.navGroupActive : ''}`}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupButton}`}
                onClick={() => openGroup(setAccessOpen)}
                aria-expanded={accessOpen}
                data-testid="access-menu-toggle"
                title={collapsed ? 'Nhân sự và phân quyền' : undefined}
              >
                <span className={styles.navIcon}><Icon name="user" /></span>
                <span className={styles.navCopy}>
                  <span className={styles.navTitle}>Nhân sự &amp; phân quyền</span>
                  <span className={styles.navHint}>Hồ sơ, tài khoản và phạm vi truy cập</span>
                </span>
                <span className={`${styles.chevron} ${accessOpen ? styles.chevronOpen : ''}`}>
                  <Icon name="chevron" />
                </span>
              </button>

              <div className={`${styles.subnav} ${accessOpen && !collapsed ? styles.subnavOpen : ''}`}>
                {accessChildren.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    className={`${styles.subnavItem} ${item.active ? styles.subnavItemActive : ''}`}
                    data-testid={item.testId}
                  >
                    <span className={styles.subnavRail} aria-hidden="true" />
                    <span className={styles.subnavIcon}><Icon name={item.icon} /></span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </nav>
        </div>

        <div className={styles.sidebarFooter}>
          <div className={styles.userPlaceholder} title={collapsed ? 'Tài khoản người dùng' : undefined}>
            <span className={styles.userAvatar}><Icon name="user" /></span>
            <span className={styles.userCopy}>
              <strong>Tài khoản người dùng</strong>
              <small>Đăng nhập sẽ được bổ sung</small>
            </span>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className={`${styles.backdrop} ${mobileOpen ? '' : styles.backdropHidden}`}
        onClick={() => setMobileOpen(false)}
        aria-label="Đóng thanh điều hướng"
      />

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.mobileMenuButton}
              onClick={() => setMobileOpen((value) => !value)}
              aria-label="Mở thanh điều hướng"
              aria-expanded={mobileOpen}
            >
              <Icon name="panel" />
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
              Hệ thống trực tuyến
            </span>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
