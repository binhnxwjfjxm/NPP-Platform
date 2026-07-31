'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import styles from './app-shell.module.css';

const organizationItems = [
  {
    href: '/organization',
    label: 'Tổng quan cơ cấu',
    hint: 'Cây tổ chức và truy cập nhanh',
    icon: '⌂',
  },
  {
    href: '/organization/branches',
    label: 'Chi nhánh',
    hint: 'Đơn vị vận hành và địa chỉ',
    icon: '▥',
  },
  {
    href: '/organization/warehouses',
    label: 'Kho hàng',
    hint: 'Kho vật lý theo chi nhánh',
    icon: '▣',
  },
  {
    href: '/organization/locations',
    label: 'Vị trí lưu trữ',
    hint: 'Kệ, khu và ô chứa hàng',
    icon: '⌗',
  },
];

const accessItems = [
  {
    href: '/access',
    label: 'Tổng quan truy cập',
    hint: 'Tình trạng tài khoản và phân quyền',
    icon: '◎',
  },
  {
    href: '/access/employees',
    label: 'Nhân viên',
    hint: 'Hồ sơ và phạm vi làm việc',
    icon: '♙',
  },
  {
    href: '/access/users',
    label: 'Tài khoản',
    hint: 'Đăng nhập và trạng thái sử dụng',
    icon: '◉',
  },
  {
    href: '/access/roles',
    label: 'Vai trò & quyền',
    hint: 'Bộ quyền dùng chung trong hệ thống',
    icon: '◇',
  },
  {
    href: '/access/assignments',
    label: 'Gán vai trò',
    hint: 'Vai trò theo chi nhánh, kho và địa bàn',
    icon: '↳',
  },
];

const masterDataItems = [
  {
    href: '/master-data',
    label: 'Tổng quan danh mục',
    hint: 'Theo dõi dữ liệu nền toàn hệ thống',
    icon: '◫',
  },
  {
    href: '/master-data/customers',
    label: 'Khách hàng',
    hint: 'Hồ sơ, địa chỉ và điều khoản thương mại',
    icon: '♧',
  },
  {
    href: '/master-data/suppliers',
    label: 'Nhà cung cấp',
    hint: 'Đối tác mua hàng và điều khoản thanh toán',
    icon: '♙',
  },
  {
    href: '/master-data/products',
    label: 'Sản phẩm',
    hint: 'Hàng hóa và thuộc tính nghiệp vụ',
    icon: '▤',
  },
  {
    href: '/master-data/units',
    label: 'Đơn vị tính',
    hint: 'Đơn vị chuẩn và quy đổi',
    icon: '⇄',
  },
  {
    href: '/master-data/skus',
    label: 'SKU & mã vạch',
    hint: 'Biến thể, mã bán và nhận dạng quét',
    icon: '▦',
  },
  {
    href: '/master-data/pricing',
    label: 'Giá bán & khuyến mãi',
    hint: 'Kênh bán, bảng giá và quy tắc áp dụng',
    icon: '₫',
  },
  {
    href: '/master-data/numbering',
    label: 'Số chứng từ',
    hint: 'Mẫu số và cấp số theo kỳ',
    icon: '#',
  },
];

const inventoryItems = [
  {
    href: '/inventory',
    label: 'Tra cứu tồn kho',
    hint: 'Số lượng hiện tại theo kho và vị trí',
    icon: '▦',
  },
  {
    href: '/inventory/opening-balances',
    label: 'Thiết lập tồn đầu kỳ',
    hint: 'Ghi nhận tồn kho ban đầu khi bắt đầu sử dụng',
    icon: '⊕',
  },
  {
    href: '/inventory/tracking-policies',
    label: 'Chính sách theo dõi lô',
    hint: 'Quản lý lô, hạn dùng và vị trí bắt buộc',
    icon: '◫',
  },
  {
    href: '/inventory/lots',
    label: 'Danh mục lô',
    hint: 'Mã lô, ngày sản xuất và hạn sử dụng',
    icon: '⌗',
  },
];

const salesItems = [
  {
    href: '/sales/sales-orders',
    label: 'Đơn bán hàng',
    hint: 'Tạo, xác nhận, điều chỉnh và theo dõi trạng thái đơn',
    icon: '▤',
  },
];

const purchasingItems = [
  {
    href: '/purchasing/purchase-orders',
    label: 'Đơn đặt hàng',
    hint: 'Lập, duyệt và theo dõi đơn mua hàng',
    icon: '▤',
  },
  {
    href: '/purchasing/goods-receipts',
    label: 'Phiếu nhận hàng',
    hint: 'Ghi nhận hàng nhận thực tế từ nhà cung cấp',
    icon: '⇩',
  },
  {
    href: '/purchasing/supplier-returns',
    label: 'Trả hàng nhà cung cấp',
    hint: 'Lập, duyệt và ghi nhận hàng trả lại',
    icon: '↶',
  },
  {
    href: '/purchasing/supplier-pricing',
    label: 'Bảng giá mua',
    hint: 'Quản lý giá nhập theo nhà cung cấp và SKU',
    icon: '₫',
  },
];

const accountingItems = [
  {
    href: '/accounting/payables',
    label: 'Công nợ phải trả',
    hint: 'Theo dõi chứng từ và số dư nhà cung cấp',
    icon: '≋',
  },
  {
    href: '/accounting/supplier-payments',
    label: 'Thanh toán nhà cung cấp',
    hint: 'Ghi nhận, phân bổ và đảo phiếu chi',
    icon: '₫',
  },
];

function isItemActive(pathname: string, href: string) {
  if (href === '/organization') return pathname === href;
  if (href === '/access') return pathname === href;
  if (href === '/master-data') return pathname === href;
  if (href === '/inventory') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGroup({
  title,
  items,
  pathname,
  open,
  onToggle,
}: {
  title: string;
  items: typeof organizationItems;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const active = items.some((item) => isItemActive(pathname, item.href));

  return (
    <div className={styles.navGroup}>
      <button
        type="button"
        className={`${styles.navGroupButton} ${active ? styles.navGroupButtonActive : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className={styles.navGroupItems}>
          {items.map((item) => {
            const itemActive = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${itemActive ? styles.navItemActive : ''}`}
              >
                <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
                <span className={styles.navCopy}>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const organizationActive = pathname.startsWith('/organization');
  const accessActive = pathname.startsWith('/access');
  const masterDataActive = pathname.startsWith('/master-data');
  const inventoryActive = pathname.startsWith('/inventory');
  const salesActive = pathname.startsWith('/sales');
  const purchasingActive = pathname.startsWith('/purchasing');
  const accountingActive = pathname.startsWith('/accounting');
  const [organizationOpen, setOrganizationOpen] = useState(organizationActive);
  const [accessOpen, setAccessOpen] = useState(accessActive);
  const [masterDataOpen, setMasterDataOpen] = useState(masterDataActive);
  const [inventoryOpen, setInventoryOpen] = useState(inventoryActive);
  const [salesOpen, setSalesOpen] = useState(salesActive);
  const [purchasingOpen, setPurchasingOpen] = useState(purchasingActive);
  const [accountingOpen, setAccountingOpen] = useState(accountingActive);

  useEffect(() => {
    if (organizationActive) setOrganizationOpen(true);
    if (accessActive) setAccessOpen(true);
    if (masterDataActive) setMasterDataOpen(true);
    if (inventoryActive) setInventoryOpen(true);
    if (salesActive) setSalesOpen(true);
    if (purchasingActive) setPurchasingOpen(true);
    if (accountingActive) setAccountingOpen(true);
  }, [
    organizationActive,
    accessActive,
    masterDataActive,
    inventoryActive,
    salesActive,
    purchasingActive,
    accountingActive,
  ]);

  return (
    <>
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brandBlock}>
          <Link href="/dashboard" className={styles.brandLink} onClick={onClose}>
            <span className={styles.brandMark} aria-hidden="true">HP</span>
            <span>
              <strong>NPP Core</strong>
              <small>Hưng Phát</small>
            </span>
          </Link>
          <button type="button" className={styles.mobileClose} onClick={onClose} aria-label="Đóng menu">×</button>
        </div>

        <nav className={styles.nav} aria-label="Điều hướng chính">
          <Link
            href="/dashboard"
            className={`${styles.navItem} ${pathname === '/dashboard' ? styles.navItemActive : ''}`}
            onClick={onClose}
          >
            <span className={styles.navIcon} aria-hidden="true">◈</span>
            <span className={styles.navCopy}>
              <strong>Tổng quan</strong>
              <small>Tình hình vận hành hệ thống</small>
            </span>
          </Link>

          <NavGroup
            title="Tổ chức"
            items={organizationItems}
            pathname={pathname}
            open={organizationOpen}
            onToggle={() => setOrganizationOpen((value) => !value)}
          />
          <NavGroup
            title="Nhân sự & phân quyền"
            items={accessItems}
            pathname={pathname}
            open={accessOpen}
            onToggle={() => setAccessOpen((value) => !value)}
          />
          <NavGroup
            title="Danh mục dùng chung"
            items={masterDataItems}
            pathname={pathname}
            open={masterDataOpen}
            onToggle={() => setMasterDataOpen((value) => !value)}
          />
          <NavGroup
            title="Tồn kho"
            items={inventoryItems}
            pathname={pathname}
            open={inventoryOpen}
            onToggle={() => setInventoryOpen((value) => !value)}
          />
          <NavGroup
            title="Bán hàng"
            items={salesItems}
            pathname={pathname}
            open={salesOpen}
            onToggle={() => setSalesOpen((value) => !value)}
          />
          <NavGroup
            title="Mua hàng"
            items={purchasingItems}
            pathname={pathname}
            open={purchasingOpen}
            onToggle={() => setPurchasingOpen((value) => !value)}
          />
          <NavGroup
            title="Kế toán"
            items={accountingItems}
            pathname={pathname}
            open={accountingOpen}
            onToggle={() => setAccountingOpen((value) => !value)}
          />
        </nav>

        <div className={styles.sidebarFooter}>
          <span className={styles.statusDot} aria-hidden="true" />
          <span>
            <strong>Kết nối hệ thống</strong>
            <small>Core API nội bộ</small>
          </span>
        </div>
      </aside>
      {mobileOpen ? <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Đóng menu" /> : null}
    </>
  );
}

export function AppShell({
  title,
  subtitle,
  kicker,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  kicker?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.mobileMenu}
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu"
          >
            ☰
          </button>
          <div className={styles.headingBlock}>
            {kicker ? <p>{kicker}</p> : null}
            <h1>{title}</h1>
            <span>{subtitle}</span>
          </div>
          {actions ? <div className={styles.topbarActions}>{actions}</div> : null}
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
