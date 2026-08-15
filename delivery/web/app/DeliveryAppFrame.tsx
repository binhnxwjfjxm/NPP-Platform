'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { DeliveryCapabilities } from '../lib/delivery-capabilities';
import { DeliveryIcon, type DeliveryIconName } from './DeliveryIcon';

type DockLink = Readonly<{
  href: string;
  icon: DeliveryIconName;
  label: string;
  active?: boolean;
}>;

function DockLinkItem({ href, icon, label, active = false }: DockLink) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={active ? 'deliveryDockItem active' : 'deliveryDockItem'}
      href={href}
    >
      <DeliveryIcon name={icon} size={22} />
      <span>{label}</span>
    </Link>
  );
}

export default function DeliveryAppFrame({
  children,
  capabilities,
}: Readonly<{ children: ReactNode; capabilities: DeliveryCapabilities }>) {
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === '/login';
  const onTrip = pathname.startsWith('/trips/');
  const onCustody = pathname.startsWith('/custody');
  const onPicking = pathname.startsWith('/picking');
  const onPickingDetail = /^\/picking\/[^/]+$/.test(pathname);
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
    || '/logo-transparent.png';

  if (onLogin) return children;

  const routeMode = onTrip ? 'trip' : onCustody ? 'custody' : onPicking ? 'picking' : 'home';
  const pageTitle = onTrip
    ? 'Chi tiết chuyến'
    : onCustody
      ? 'Tiền đang giữ'
      : onPicking
        ? 'Soạn hàng'
        : 'Chuyến hôm nay';

  return (
    <div className="deliveryAppFrame" data-delivery-app-frame data-route-mode={routeMode}>
      <header className="deliveryAppTopBar">
        <div className="deliveryAppIdentity">
          {onTrip || onPickingDetail ? (
            <Link
              className="deliveryTopButton deliveryBackButton"
              href={onPickingDetail ? '/picking' : '/'}
              aria-label={onPickingDetail ? 'Về danh sách soạn hàng' : 'Về danh sách chuyến'}
            >
              <DeliveryIcon name="back" size={22} />
            </Link>
          ) : (
            <span className="deliveryAppMark" aria-hidden="true">
              <img className="deliveryAppLogo" src={appLogoUrl} alt="" />
            </span>
          )}
          <span className="deliveryAppTitle">
            <small>Hưng Phát Delivery</small>
            <strong>{pageTitle}</strong>
          </span>
        </div>
        <div className="deliveryTopActions">
          <button
            className="deliveryTopButton"
            type="button"
            onClick={() => router.refresh()}
            aria-label="Đồng bộ dữ liệu"
          >
            <DeliveryIcon name="sync" size={21} />
          </button>
        </div>
      </header>

      <div className="deliveryAppContent">{children}</div>

      <nav className="deliveryAppDock" aria-label="Điều hướng chính">
        {capabilities.canViewTrips ? (
          <DockLinkItem href="/" icon="route" label="Chuyến" active={!onCustody && !onPicking} />
        ) : null}
        {capabilities.canPickWithWarehouse ? (
          <DockLinkItem href="/picking" icon="box" label="Soạn hàng" active={onPicking} />
        ) : null}
        {capabilities.canViewTrips && capabilities.canViewCustody ? (
          <DockLinkItem href="/custody" icon="wallet" label="Tiền đang giữ" active={onCustody} />
        ) : null}
        <details className="deliveryDockAccount">
          <summary className="deliveryDockItem deliveryDockAccountTrigger" aria-label="Mở menu tài khoản">
            <DeliveryIcon name="user" size={22} />
            <span>Tài khoản</span>
          </summary>
          <div className="deliveryAccountPanel">
            <div className="deliveryAccountHeading">
              <span className="deliveryAccountIcon" aria-hidden="true">
                <DeliveryIcon name="user" size={20} />
              </span>
              <span>
                <small>Tài khoản giao hàng</small>
                <strong>Phiên làm việc hiện tại</strong>
              </span>
            </div>
            <form className="deliveryLogoutForm" action="/api/auth/logout" method="post">
              <button className="deliveryLogoutButton" type="submit">
                <span className="deliveryLogoutIcon" aria-hidden="true">
                  <DeliveryIcon name="logout" size={20} />
                </span>
                <span>
                  <strong>Đăng xuất</strong>
                  <small>Kết thúc phiên trên thiết bị này</small>
                </span>
              </button>
            </form>
          </div>
        </details>
      </nav>
    </div>
  );
}
