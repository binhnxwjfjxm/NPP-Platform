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
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
    || '/logo-transparent.png';

  if (onLogin) return children;

  return (
    <div className="deliveryAppFrame" data-delivery-app-frame data-route-mode={onTrip ? 'trip' : onCustody ? 'custody' : 'home'}>
      <header className="deliveryAppTopBar">
        <div className="deliveryAppIdentity">
          {onTrip ? (
            <Link className="deliveryTopButton deliveryBackButton" href="/" aria-label="Về danh sách chuyến">
              <DeliveryIcon name="back" size={22} />
            </Link>
          ) : (
            <span className="deliveryAppMark" aria-hidden="true">
              <img className="deliveryAppLogo" src={appLogoUrl} alt="" />
            </span>
          )}
          <span className="deliveryAppTitle">
            <small>Hưng Phát Delivery</small>
            <strong>{onTrip ? 'Chi tiết chuyến' : onCustody ? 'Tiền đang giữ' : 'Chuyến hôm nay'}</strong>
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
          <DockLinkItem href="/" icon="route" label="Chuyến" active={!onCustody} />
        ) : null}
        {capabilities.canViewTrips && capabilities.canViewCustody ? (
          <DockLinkItem href="/custody" icon="wallet" label="Tiền đang giữ" active={onCustody} />
        ) : null}
        {/* Lane B owns the first real picking route. Lane A intentionally renders no dead Soạn hàng tab. */}
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
