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
  | 'accounting'
  | 'user';

const organizationItems = [
  { href: '/organization', label: 'Tổng quan cơ cấu', icon: 'organization' as const, testId: 'nav-organization-overview' },
  { href: '/organization/branches', label: 'Chi nhánh', icon: 'branches' as const, testId: 'nav-branches' },
  { href: '/organization/warehouses', label: 'Kho hàng', icon: 'warehouses' as const, testId: 'nav-warehouses' },
  { href: '/organization/locations', label: 'Vị trí kho', icon: 'locations' as const, testId: 'nav-locations' },
  { href: '/customers', label: 'Khách hàng', icon: 'user' as const, testId: 'nav-customers' },
  { href: '/suppliers', label: 'Nhà cung cấp', icon: 'user' as const, testId: 'nav-suppliers' },
  { href: '/products', label: 'Danh mục sản phẩm', icon: 'panel' as const, testId: 'nav-products' },
  { href: '/pricing', label: 'Giá bán & khuyến mãi', icon: 'panel' as const, testId: 'nav-pricing' },
  { href: '/document-numbering', label: 'Số chứng từ', icon: 'panel' as const, testId: 'nav-document-numbering' },
];

const accessItems = [
  { href: '/access/roles', label: 'Vai trò & phân quyền', icon: 'panel' as const, testId: 'nav-roles' },
  { href: '/access/employees', label: 'Danh mục nhân sự', icon: 'user' as const, testId: 'nav-employees' },
  { href: '/access/users', label: 'Người dùng', icon: 'user' as const, testId: 'nav-users' },
];

const inventoryItems = [
  { href: '/inventory/balances', label: 'Tra cứu tồn kho', icon: 'panel' as const, testId: 'nav-inventory-balances' },
  { href: '/inventory/tracking-policies', label: 'Chính sách lô', icon: 'panel' as const, testId: 'nav-inventory-policies' },
  { href: '/inventory/lots', label: 'Lô hàng', icon: 'panel' as const, testId: 'nav-inventory-lots' },
  { href: '/inventory/opening-balances', label: 'Thiết lập tồn đầu kỳ', icon: 'panel' as const, testId: 'nav-inventory-opening' },
];

const purchasingItems = [
  { href: '/purchasing/purchase-orders', label: 'Đơn đặt hàng', icon: 'panel' as const, testId: 'nav-purchase-orders' },
  { href: '/purchasing/purchase-prices', label: 'Bảng giá mua', icon: 'panel' as const, testId: 'nav-purchase-prices' },
  { href: '/purchasing/goods-receipts', label: 'Phiếu nhận hàng', icon: 'panel' as const, testId: 'nav-goods-receipts' },
  { href: '/purchasing/supplier-returns', label: 'Phiếu trả NCC', icon: 'panel' as const, testId: 'nav-supplier-returns' },
];

const accountingItems = [
  { href: '/accounting/payables', label: 'Công nợ phải trả', icon: 'accounting' as const, testId: 'nav-payables' },
  { href: '/accounting/supplier-payments', label: 'Thanh toán nhà cung cấp', icon: 'accounting' as const, testId: 'nav-supplier-payments' },
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
    accounting: (
      <>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M8 8h8M8 12h6M8 16h4" />
        <circle cx="16" cy="12" r="1.25" />
      </>
    ),
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

function isOrganizationPath(pathname: string): boolean {
  return pathname.startsWith('/organization')
    || pathname.startsWith('/customers')
    || pathname.startsWith('/suppliers')
    || pathname.startsWith('/products')
    || pathname.startsWith('/pricing')
    || pathname.startsWith('/document-numbering');
}

function isInventoryPath(pathname: string): boolean {
  return pathname.startsWith('/inventory');
}

function isPurchasingPath(pathname: string): boolean {
  return pathname.startsWith('/purchasing');
}

function isAccountingPath(pathname: string): boolean {
  return pathname.startsWith('/accounting');
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
  const [organizationOpen, setOrganizationOpen] = useState(isOrganizationPath(pathname));
  const [accessOpen, setAccessOpen] = useState(pathname.startsWith('/access'));
  const [inventoryOpen, setInventoryOpen] = useState(isInventoryPath(pathname));
  const [purchasingOpen, setPurchasingOpen] = useState(isPurchasingPath(pathname));
  const [accountingOpen, setAccountingOpen] = useState(isAccountingPath(pathname));

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('npp-core-sidebar-collapsed') === '1');
  }, []);

  useEffect(() => {
    if (isOrganizationPath(pathname)) setOrganizationOpen(true);
    if (pathname.startsWith('/access')) setAccessOpen(true);
    if (isInventoryPath(pathname)) setInventoryOpen(true);
    if (isPurchasingPath(pathname)) setPurchasingOpen(true);
    if (isAccountingPath(pathname)) setAccountingOpen(true);
    setMobileOpen(false);
  }, [pathname]);

  const organizationActive = isOrganizationPath(pathname);
  const accessActive = pathname.startsWith('/access');
  const inventoryActive = isInventoryPath(pathname);
  const purchasingActive = pathname.startsWith('/purchasing');
  const accountingActive = isAccountingPath(pathname);
  const logoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/logo-transparent.png';

  const organizationChildren = useMemo(
    () => organizationItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
    [pathname],
  );
  const accessChildren = useMemo(
    () => accessItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
    [pathname],
  );
  const inventoryChildren = useMemo(
    () => inventoryItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
    [pathname],
  );
  const purchasingChildren = useMemo(
    () => purchasingItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
    [pathname],
  );
  const accountingChildren = useMemo(
    () => accountingItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })),
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
                <span className={styles.navHint}>Thông tin tổng hợp phục vụ điều hành</span>
              </span>
            </Link>

            <p className={styles.navLabel}>Danh mục quản lý</p>
            <div className={`${styles.navGroup} ${organizationActive ? styles.navGroupActive : ''}`}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupButton}`}
                onClick={() => openGroup(setOrganizationOpen)}
                aria-expanded={organizationOpen}
                data-testid="organization-menu-toggle"
                title={collapsed ? 'Danh mục nghiệp vụ' : undefined}
              >
                <span className={styles.navIcon}><Icon name="organization" /></span>
                <span className={styles.navCopy}>
                  <span className={styles.navTitle}>Danh mục nghiệp vụ</span>
                  <span className={styles.navHint}>Tổ chức, đối tác, hàng hóa, giá và chứng từ</span>
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

            <p className={styles.navLabel}>Tồn kho &amp; lô hàng</p>
            <div className={`${styles.navGroup} ${inventoryActive ? styles.navGroupActive : ''}`}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupButton}`}
                onClick={() => openGroup(setInventoryOpen)}
                aria-expanded={inventoryOpen}
                data-testid="inventory-menu-toggle"
                title={collapsed ? 'Tồn kho và lô hàng' : undefined}
              >
                <span className={styles.navIcon}><Icon name="panel" /></span>
                <span className={styles.navCopy}>
                  <span className={styles.navTitle}>Tồn kho &amp; lô hàng</span>
                  <span className={styles.navHint}>Số lượng tồn, lô hàng, hạn dùng và tồn đầu kỳ</span>
                </span>
                <span className={`${styles.chevron} ${inventoryOpen ? styles.chevronOpen : ''}`}>
                  <Icon name="chevron" />
                </span>
              </button>

              <div className={`${styles.subnav} ${inventoryOpen && !collapsed ? styles.subnavOpen : ''}`}>
                {inventoryChildren.map((item) => (
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

            <p className={styles.navLabel}>Mua hàng</p>
            <div className={`${styles.navGroup} ${purchasingActive ? styles.navGroupActive : ''}`}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupButton}`}
                onClick={() => openGroup(setPurchasingOpen)}
                aria-expanded={purchasingOpen}
                data-testid="purchasing-menu-toggle"
                title={collapsed ? 'Mua hàng' : undefined}
              >
                <span className={styles.navIcon}><Icon name="panel" /></span>
                <span className={styles.navCopy}>
                  <span className={styles.navTitle}>Mua hàng</span>
                  <span className={styles.navHint}>Đơn đặt hàng và phiếu nhận hàng</span>
                </span>
                <span className={`${styles.chevron} ${purchasingOpen ? styles.chevronOpen : ''}`}>
                  <Icon name="chevron" />
                </span>
              </button>

              <div className={`${styles.subnav} ${purchasingOpen && !collapsed ? styles.subnavOpen : ''}`}>
                {purchasingChildren.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    className={`${styles.subnavItem} ${item.active ? styles.subnavItemActive : ''}`}
                    data-testid={item.testId}
                  >
                    <span className={styles.subnavRail} aria-hidden="true" />
                    <span className={styles.subnavIcon}><Icon name="panel" /></span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>

            <p className={styles.navLabel}>Kế toán &amp; công nợ</p>
            <div className={`${styles.navGroup} ${accountingActive ? styles.navGroupActive : ''}`}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupButton}`}
                onClick={() => openGroup(setAccountingOpen)}
                aria-expanded={accountingOpen}
                data-testid="accounting-menu-toggle"
                title={collapsed ? 'Kế toán và công nợ' : undefined}
              >
                <span className={styles.navIcon}><Icon name="accounting" /></span>
                <span className={styles.navCopy}>
                  <span className={styles.navTitle}>Kế toán &amp; công nợ</span>
                  <span className={styles.navHint}>Công nợ phải trả và thanh toán nhà cung cấp</span>
                </span>
                <span className={`${styles.chevron} ${accountingOpen ? styles.chevronOpen : ''}`}>
                  <Icon name="chevron" />
                </span>
              </button>

              <div className={`${styles.subnav} ${accountingOpen && !collapsed ? styles.subnavOpen : ''}`}>
                {accountingChildren.map((item) => (
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
              <small>Quản lý tài khoản và quyền truy cập</small>
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
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
