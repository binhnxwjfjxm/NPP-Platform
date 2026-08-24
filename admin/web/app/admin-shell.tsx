import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminIcon } from './admin-icons';

type AdminSection = 'overview' | 'approvals' | 'alerts' | 'reports';
export type AdminContentWidth = 'wide' | 'focused' | 'special';

export const ADMIN_ROUTE_ALIASES = {
  '/customer-onboarding': '/approvals',
} as const;

const primaryNav: Array<{ section: AdminSection; href: string; label: string; icon: 'overview' | 'check' | 'exception' | 'document' }> = [
  { section: 'overview', href: '/', label: 'Tổng quan', icon: 'overview' },
  { section: 'approvals', href: '/approvals', label: 'Đề xuất', icon: 'check' },
  { section: 'alerts', href: '/alerts', label: 'Cảnh báo', icon: 'exception' },
  { section: 'reports', href: '/reports', label: 'Báo cáo', icon: 'document' },
];

const contentWidthClass: Record<AdminContentWidth, string> = {
  wide: 'adminContentWide',
  focused: 'adminContentFocused',
  special: 'adminContentSpecial',
};

function PrimaryNavItem({ activeSection, item, mobile = false }: { activeSection: AdminSection | null; item: (typeof primaryNav)[number]; mobile?: boolean }) {
  const active = activeSection === item.section;
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={mobile ? (active ? 'adminBottomItem isActive' : 'adminBottomItem') : (active ? 'navLink isActive' : 'navLink')}
      href={item.href}
    >
      <AdminIcon name={item.icon} size={mobile ? 22 : 20} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AdminShell({
  activeSection,
  title,
  subtitle,
  children,
  contentWidth = 'wide',
}: {
  activeSection: AdminSection | null;
  title: string;
  subtitle: string;
  children: ReactNode;
  contentWidth?: AdminContentWidth;
}) {
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/icons/admin-192.png';
  return (
    <div className="shell adminAppShell" data-admin-app-shell data-active-section={activeSection ?? 'secondary'}>
      <header className="topbar adminAppTopbar">
        <div className="topbarInner">
          <Link className="brand" href="/" aria-label="Admin Hưng Phát - Tổng quan">
            <span className="brandLogoFrame"><img className="brandLogo" src={appLogoUrl} alt="Logo Hưng Phát" /></span>
            <span className="brandCopy">
              <strong className="brandProductName">Admin Hưng Phát</strong>
              <span className="brandDescriptor">Theo dõi và quyết định quản trị</span>
              <small className="brandMobileEyebrow">Admin Hưng Phát</small>
              <strong className="brandScreenName">{title}</strong>
            </span>
          </Link>
          <nav className="desktopNav adminPrimaryNav" aria-label="Điều hướng quản trị">
            {primaryNav.map((item) => <PrimaryNavItem key={item.section} activeSection={activeSection} item={item} />)}
          </nav>
          <details className="appMenu adminAccountMenu">
            <summary className="menuTrigger" aria-label="Mở menu tài khoản"><AdminIcon name="user" size={22} /></summary>
            <div className="menuPanel">
              <p className="menuEyebrow">Tài khoản</p>
              <Link className="menuItem" href="/menu">
                <span className="menuIcon"><AdminIcon name="info" size={20} /></span>
                <span><strong>Thông tin ứng dụng</strong><small>Cài đặt ứng dụng và phạm vi sử dụng</small></span>
              </Link>
              <form action="/api/auth/logout" method="post">
                <button className="menuItem adminLogoutItem" type="submit">
                  <span className="menuIcon"><AdminIcon name="lock" size={20} /></span>
                  <span><strong>Đăng xuất</strong><small>Kết thúc phiên quản trị hiện tại</small></span>
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <main className={`main adminAppMain ${contentWidthClass[contentWidth]}`} data-admin-content-width={contentWidth}>
        <header className="pageHeader adminPageHeader"><h1>{title}</h1><p className="pageSubtitle">{subtitle}</p></header>
        {children}
      </main>
      <nav className="adminBottomNav" aria-label="Điều hướng ứng dụng">
        {primaryNav.map((item) => <PrimaryNavItem key={item.section} activeSection={activeSection} item={item} mobile />)}
      </nav>
    </div>
  );
}
