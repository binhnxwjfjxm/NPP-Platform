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
  | 'truck'
  | 'user';

type NavItem = { href: string; label: string; icon: IconName; testId: string };
type CurrentUser = Readonly<{ employeeFullName: string | null; loginName: string | null }>;
type CurrentUserEnvelope = Readonly<{ data?: CurrentUser }>;

let currentUserRequest: Promise<CurrentUser | null> | null = null;

function loadCurrentUser(): Promise<CurrentUser | null> {
  if (!currentUserRequest) {
    currentUserRequest = fetch('/api/auth/me', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as CurrentUserEnvelope | null;
        return response.ok && payload?.data ? payload.data : null;
      })
      .catch(() => null)
      .finally(() => {
        currentUserRequest = null;
      });
  }
  return currentUserRequest;
}

const organizationItems: NavItem[] = [
  { href: '/organization', label: 'Tổng quan cơ cấu', icon: 'organization', testId: 'nav-organization-overview' },
  { href: '/organization/branches', label: 'Chi nhánh', icon: 'branches', testId: 'nav-branches' },
  { href: '/organization/warehouses', label: 'Kho hàng', icon: 'warehouses', testId: 'nav-warehouses' },
  { href: '/organization/locations', label: 'Vị trí kho', icon: 'locations', testId: 'nav-locations' },
  { href: '/customers', label: 'Khách hàng', icon: 'user', testId: 'nav-customers' },
  { href: '/suppliers', label: 'Nhà cung cấp', icon: 'user', testId: 'nav-suppliers' },
  { href: '/products', label: 'Danh mục sản phẩm', icon: 'panel', testId: 'nav-products' },
  { href: '/pricing', label: 'Giá bán & khuyến mãi', icon: 'panel', testId: 'nav-pricing' },
  { href: '/document-numbering', label: 'Số chứng từ', icon: 'panel', testId: 'nav-document-numbering' },
];

const accessItems: NavItem[] = [
  { href: '/access/roles', label: 'Vai trò & phân quyền', icon: 'panel', testId: 'nav-roles' },
  { href: '/access/employees', label: 'Danh mục nhân sự', icon: 'user', testId: 'nav-employees' },
  { href: '/access/employees/performance', label: 'Hiệu suất nhân viên / MCP', icon: 'dashboard', testId: 'nav-employee-mcp-reporting' },
  { href: '/access/users', label: 'Người dùng', icon: 'user', testId: 'nav-users' },
];

const inventoryItems: NavItem[] = [
  { href: '/inventory/reporting', label: 'Báo cáo tồn kho', icon: 'dashboard', testId: 'nav-inventory-reporting' },
  { href: '/inventory/fulfillment', label: 'Chuẩn bị hàng', icon: 'panel', testId: 'nav-inventory-fulfillment' },
  { href: '/inventory/transfers', label: 'Chuyển kho', icon: 'panel', testId: 'nav-inventory-transfers' },
  { href: '/inventory/stocktakes', label: 'Kiểm kê kho', icon: 'panel', testId: 'nav-inventory-stocktakes' },
  { href: '/inventory/adjustments', label: 'Điều chỉnh & xử lý tồn', icon: 'panel', testId: 'nav-inventory-adjustments' },
  { href: '/inventory/costing', label: 'Giá vốn tồn kho', icon: 'accounting', testId: 'nav-inventory-costing' },
  { href: '/inventory/balances', label: 'Tra cứu tồn kho', icon: 'panel', testId: 'nav-inventory-balances' },
  { href: '/inventory/tracking-policies', label: 'Chính sách lô', icon: 'panel', testId: 'nav-inventory-policies' },
  { href: '/inventory/lots', label: 'Lô hàng', icon: 'panel', testId: 'nav-inventory-lots' },
  { href: '/inventory/opening-balances', label: 'Thiết lập tồn đầu kỳ', icon: 'panel', testId: 'nav-inventory-opening' },
];

const logisticsItems: NavItem[] = [
  { href: '/logistics/reporting', label: 'Hiệu suất giao hàng', icon: 'dashboard', testId: 'nav-logistics-reporting' },
  { href: '/inventory/delivery-orders', label: 'Phiếu giao hàng', icon: 'truck', testId: 'nav-delivery-orders' },
  { href: '/logistics/trips', label: 'Lập & xếp chuyến', icon: 'truck', testId: 'nav-logistics-trips' },
  { href: '/logistics/dispatch', label: 'Bàn giao & xuất phát', icon: 'truck', testId: 'nav-logistics-dispatch' },
  { href: '/logistics/delivery-attempts', label: 'Kết quả lần giao', icon: 'truck', testId: 'nav-logistics-delivery-attempts' },
  { href: '/logistics/trip-reconciliation', label: 'Đối soát cuối chuyến', icon: 'truck', testId: 'nav-logistics-trip-reconciliation' },
  { href: '/inventory/customer-returns', label: 'Hàng khách trả', icon: 'truck', testId: 'nav-customer-returns' },
];

const salesItems: NavItem[] = [
  { href: '/sales/reporting', label: 'Báo cáo bán hàng', icon: 'dashboard', testId: 'nav-sales-reporting' },
  { href: '/sales/gross-margin', label: 'Lãi gộp', icon: 'accounting', testId: 'nav-gross-margin-reporting' },
  { href: '/management', label: 'Điều hành bán hàng', icon: 'panel', testId: 'nav-sales-operations' },
  { href: '/sales/sales-orders', label: 'Đơn bán hàng', icon: 'panel', testId: 'nav-sales-orders' },
  { href: '/management/customer-onboarding', label: 'Mở / liên kết mã khách', icon: 'user', testId: 'nav-customer-onboarding' },
];

const purchasingItems: NavItem[] = [
  { href: '/purchasing/reporting', label: 'Báo cáo mua hàng', icon: 'dashboard', testId: 'nav-purchasing-reporting' },
  { href: '/purchasing/purchase-orders', label: 'Đơn đặt hàng', icon: 'panel', testId: 'nav-purchase-orders' },
  { href: '/purchasing/purchase-prices', label: 'Bảng giá mua', icon: 'panel', testId: 'nav-purchase-prices' },
  { href: '/purchasing/goods-receipts', label: 'Phiếu nhận hàng', icon: 'panel', testId: 'nav-goods-receipts' },
  { href: '/purchasing/supplier-returns', label: 'Phiếu trả NCC', icon: 'panel', testId: 'nav-supplier-returns' },
];

const accountingItems: NavItem[] = [
  { href: '/accounting/aging', label: 'Tuổi nợ', icon: 'dashboard', testId: 'nav-aging-reporting' },
  { href: '/accounting/cod-reporting', label: 'COD & đối soát', icon: 'dashboard', testId: 'nav-cod-reporting' },
  { href: '/accounting/receivables', label: 'Công nợ phải thu', icon: 'accounting', testId: 'nav-receivables' },
  { href: '/accounting/customer-payments', label: 'Thu tiền khách hàng', icon: 'accounting', testId: 'nav-customer-payments' },
  { href: '/accounting/customer-return-credits', label: 'Điều chỉnh công nợ hàng trả', icon: 'accounting', testId: 'nav-customer-return-credits' },
  { href: '/accounting/payables', label: 'Công nợ phải trả', icon: 'accounting', testId: 'nav-payables' },
  { href: '/accounting/supplier-payments', label: 'Thanh toán nhà cung cấp', icon: 'accounting', testId: 'nav-supplier-payments' },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="4" rx="1.5" /><rect x="14" y="11" width="7" height="10" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    organization: <><rect x="4" y="3" width="16" height="6" rx="2" /><path d="M8 9v4m8-4v4M5 13h6v7H5zM13 13h6v7h-6z" /></>,
    branches: <><path d="M5 4h7v6H5zM12 7h4a3 3 0 0 1 3 3v2" /><path d="M8.5 10v4a3 3 0 0 0 3 3H15" /><circle cx="18" cy="16" r="3" /></>,
    warehouses: <><path d="M3 9 12 4l9 5v11H3z" /><path d="M7 20v-7h10v7M7 10h10" /></>,
    locations: <><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    panel: <path d="M4 5h16M4 12h16M4 19h16" />,
    accounting: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8M8 12h6M8 16h4" /><circle cx="16" cy="12" r="1.25" /></>,
    truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/organization' || href === '/management') return pathname === href;
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
function isInventoryPath(pathname: string): boolean { return pathname.startsWith('/inventory') && !pathname.startsWith('/inventory/delivery-orders') && !pathname.startsWith('/inventory/customer-returns'); }
function isLogisticsPath(pathname: string): boolean { return pathname.startsWith('/logistics') || pathname.startsWith('/inventory/delivery-orders') || pathname.startsWith('/inventory/customer-returns'); }
function isSalesPath(pathname: string): boolean { return pathname.startsWith('/sales') || pathname.startsWith('/management'); }
function persistCollapsed(value: boolean) { window.localStorage.setItem('npp-core-sidebar-collapsed', value ? '1' : '0'); }

export function AppShell({ title, subtitle, kicker = 'Hệ thống quản trị doanh nghiệp', children, actions }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [organizationOpen, setOrganizationOpen] = useState(isOrganizationPath(pathname));
  const [inventoryOpen, setInventoryOpen] = useState(isInventoryPath(pathname));
  const [logisticsOpen, setLogisticsOpen] = useState(isLogisticsPath(pathname));
  const [salesOpen, setSalesOpen] = useState(isSalesPath(pathname));
  const [purchasingOpen, setPurchasingOpen] = useState(pathname.startsWith('/purchasing'));
  const [accountingOpen, setAccountingOpen] = useState(pathname.startsWith('/accounting'));
  const [accessOpen, setAccessOpen] = useState(pathname.startsWith('/access'));

  useEffect(() => { setCollapsed(window.localStorage.getItem('npp-core-sidebar-collapsed') === '1'); }, []);
  useEffect(() => {
    let active = true;
    void loadCurrentUser().then((user) => { if (active) setCurrentUser(user); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (isOrganizationPath(pathname)) setOrganizationOpen(true);
    if (isInventoryPath(pathname)) setInventoryOpen(true);
    if (isLogisticsPath(pathname)) setLogisticsOpen(true);
    if (isSalesPath(pathname)) setSalesOpen(true);
    if (pathname.startsWith('/purchasing')) setPurchasingOpen(true);
    if (pathname.startsWith('/accounting')) setAccountingOpen(true);
    if (pathname.startsWith('/access')) setAccessOpen(true);
    setMobileOpen(false);
  }, [pathname]);

  const organizationChildren = useMemo(() => organizationItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const inventoryChildren = useMemo(() => inventoryItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const logisticsChildren = useMemo(() => logisticsItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const salesChildren = useMemo(() => salesItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const purchasingChildren = useMemo(() => purchasingItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const accountingChildren = useMemo(() => accountingItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const accessChildren = useMemo(() => accessItems.map((item) => ({ ...item, active: isActive(pathname, item.href) })), [pathname]);
  const logoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/logo-transparent.png';
  const currentUserName = currentUser?.employeeFullName?.trim() || currentUser?.loginName?.trim() || 'Tài khoản người dùng';
  const currentUserLogin = currentUser?.loginName?.trim() || null;

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

  function renderGroup({ sectionLabel, title: groupTitle, hint, icon, active, open, setOpen, testId, children: groupChildren }: { sectionLabel: string; title: string; hint: string; icon: IconName; active: boolean; open: boolean; setOpen: React.Dispatch<React.SetStateAction<boolean>>; testId: string; children: Array<NavItem & { active: boolean }> }) {
    const childrenVisible = open && !collapsed;
    return <>
      <p className={styles.navLabel}>{sectionLabel}</p>
      <div className={`${styles.navGroup} ${active ? styles.navGroupActive : ''}`}>
        <button type="button" className={`${styles.navItem} ${styles.navGroupButton}`} onClick={() => openGroup(setOpen)} aria-expanded={childrenVisible} data-testid={testId} title={collapsed ? groupTitle : undefined}>
          <span className={styles.navIcon}><Icon name={icon} /></span>
          <span className={styles.navCopy}><span className={styles.navTitle}>{groupTitle}</span><span className={styles.navHint}>{hint}</span></span>
          <span className={`${styles.chevron} ${childrenVisible ? styles.chevronOpen : ''}`}><Icon name="chevron" /></span>
        </button>
        <div className={`${styles.subnav} ${childrenVisible ? styles.subnavOpen : ''}`} aria-hidden={!childrenVisible}>
          <div className={styles.subnavInner}>
            {groupChildren.map((item) => <Link key={item.href} href={item.href} prefetch className={`${styles.subnavItem} ${item.active ? styles.subnavItemActive : ''}`} data-testid={item.testId} tabIndex={childrenVisible ? undefined : -1}><span className={styles.subnavRail} aria-hidden="true" /><span className={styles.subnavIcon}><Icon name={item.icon} /></span><span>{item.label}</span></Link>)}
          </div>
        </div>
      </div>
    </>;
  }

  return <div className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ''}`} data-collapsed={collapsed ? 'true' : 'false'}>
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`} aria-label="Điều hướng chính" data-testid="app-sidebar">
      <div className={styles.brandRow}>
        <Link href="/dashboard" className={styles.brand} aria-label="Hưng Phát Company - Trang tổng quan"><span className={styles.logoFrame}><img src={logoUrl} alt="Logo Hưng Phát Company" className={styles.logo} /></span><span className={styles.brandText}><strong>Hưng Phát Company</strong><small>NPP Operations</small></span></Link>
        <button type="button" className={styles.collapseButton} onClick={toggleCollapsed} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} data-testid="sidebar-collapse-button"><Icon name="panel" /></button>
      </div>
      <div className={styles.navScroll} data-testid="sidebar-nav-scroll"><nav className={styles.nav}>
        <p className={styles.navLabel}>Điều hành</p><Link href="/dashboard" className={`${styles.navItem} ${pathname === '/dashboard' ? styles.navItemActive : ''}`} data-testid="nav-dashboard" title={collapsed ? 'Tổng quan điều hành' : undefined}><span className={styles.navIcon}><Icon name="dashboard" /></span><span className={styles.navCopy}><span className={styles.navTitle}>Tổng quan điều hành</span><span className={styles.navHint}>Thông tin tổng hợp phục vụ điều hành</span></span></Link>
        {renderGroup({ sectionLabel: 'Danh mục quản lý', title: 'Danh mục nghiệp vụ', hint: 'Tổ chức, đối tác, hàng hóa, giá và chứng từ', icon: 'organization', active: isOrganizationPath(pathname), open: organizationOpen, setOpen: setOrganizationOpen, testId: 'organization-menu-toggle', children: organizationChildren })}
        {renderGroup({ sectionLabel: 'Tồn kho & lô hàng', title: 'Tồn kho & lô hàng', hint: 'Chuẩn bị hàng, chuyển kho, số lượng tồn, lô, hạn dùng và tồn đầu kỳ', icon: 'panel', active: isInventoryPath(pathname), open: inventoryOpen, setOpen: setInventoryOpen, testId: 'inventory-menu-toggle', children: inventoryChildren })}
        {renderGroup({ sectionLabel: 'Giao nhận & điều phối', title: 'Giao nhận & điều phối', hint: 'Phiếu giao, chuyến xe, kết quả giao, đối soát và hàng trả', icon: 'truck', active: isLogisticsPath(pathname), open: logisticsOpen, setOpen: setLogisticsOpen, testId: 'logistics-menu-toggle', children: logisticsChildren })}
        {renderGroup({ sectionLabel: 'Bán hàng', title: 'Bán hàng', hint: 'Đơn nhiều nguồn, mã khách và vòng đời thương mại', icon: 'panel', active: isSalesPath(pathname), open: salesOpen, setOpen: setSalesOpen, testId: 'sales-menu-toggle', children: salesChildren })}
        {renderGroup({ sectionLabel: 'Mua hàng', title: 'Mua hàng', hint: 'Đơn đặt hàng và phiếu nhận hàng', icon: 'panel', active: pathname.startsWith('/purchasing'), open: purchasingOpen, setOpen: setPurchasingOpen, testId: 'purchasing-menu-toggle', children: purchasingChildren })}
        {renderGroup({ sectionLabel: 'Kế toán & công nợ', title: 'Kế toán & công nợ', hint: 'Tuổi nợ, phải thu, thu tiền, hàng trả, phải trả và thanh toán nhà cung cấp', icon: 'accounting', active: pathname.startsWith('/accounting'), open: accountingOpen, setOpen: setAccountingOpen, testId: 'accounting-menu-toggle', children: accountingChildren })}
        <p className={styles.navLabel}>Vận hành hệ thống</p><Link href="/operations/audit-history" className={`${styles.navItem} ${pathname === '/operations/audit-history' ? styles.navItemActive : ''}`} data-testid="nav-audit-history" title={collapsed ? 'Lịch sử audit' : undefined}><span className={styles.navIcon}><Icon name="dashboard" /></span><span className={styles.navCopy}><span className={styles.navTitle}>Lịch sử audit</span><span className={styles.navHint}>Tra cứu thay đổi và dấu vết vận hành</span></span></Link>
        <Link href="/operations/import-export-history" className={`${styles.navItem} ${pathname === '/operations/import-export-history' ? styles.navItemActive : ''}`} data-testid="nav-import-export-history" title={collapsed ? 'Lịch sử import / export' : undefined}><span className={styles.navIcon}><Icon name="panel" /></span><span className={styles.navCopy}><span className={styles.navTitle}>Lịch sử import / export</span><span className={styles.navHint}>Theo dõi các lượt trao đổi dữ liệu canonical</span></span></Link>
        {renderGroup({ sectionLabel: 'Quản trị hệ thống', title: 'Nhân sự & phân quyền', hint: 'Hồ sơ, hiệu suất field, tài khoản và phạm vi truy cập', icon: 'user', active: pathname.startsWith('/access'), open: accessOpen, setOpen: setAccessOpen, testId: 'access-menu-toggle', children: accessChildren })}
      </nav></div>
      <div className={styles.sidebarFooter}>
        <div className={styles.userPlaceholder} title={collapsed ? currentUserName : undefined} data-testid="sidebar-current-user">
          <span className={styles.userAvatar}><img src={logoUrl} alt="" className={styles.userAvatarImage} /></span>
          <span className={styles.userCopy}>
            <strong data-testid="sidebar-current-user-name">{currentUserName}</strong>
            <small>{currentUserLogin && currentUserLogin !== currentUserName ? `@${currentUserLogin}` : 'Đang đăng nhập'}</small>
          </span>
        </div>
      </div>
    </aside>
    <button type="button" className={`${styles.backdrop} ${mobileOpen ? '' : styles.backdropHidden}`} onClick={() => setMobileOpen(false)} aria-label="Đóng thanh điều hướng" />
    <div className={styles.main}>
      <header className={styles.topbar}><div className={styles.topbarLeft}><button type="button" className={styles.mobileMenuButton} onClick={() => setMobileOpen((value) => !value)} aria-label="Mở thanh điều hướng" aria-expanded={mobileOpen}><Icon name="panel" /></button><div className={styles.titleBlock}><p className={styles.kicker}>{kicker}</p><h1 className={styles.title}>{title}</h1>{subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}</div></div><div className={styles.topbarActions}>{actions}</div></header>
      <main key={pathname} className={styles.content} data-testid="app-content">{children}</main>
    </div>
  </div>;
}
