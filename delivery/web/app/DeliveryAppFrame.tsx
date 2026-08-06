'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
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

export default function DeliveryAppFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === '/login';
  const onTrip = pathname.startsWith('/trips/');

  if (onLogin) return children;

  return (
    <div className="deliveryAppFrame" data-delivery-app-frame data-route-mode={onTrip ? 'trip' : 'home'}>
      <header className="deliveryAppTopBar">
        <div className="deliveryAppIdentity">
          {onTrip ? (
            <Link className="deliveryTopButton deliveryBackButton" href="/" aria-label="Về danh sách chuyến">
              <DeliveryIcon name="back" size={22} />
            </Link>
          ) : (
            <span className="deliveryAppMark" aria-hidden="true">
              <DeliveryIcon name="truck" size={23} />
            </span>
          )}
          <span className="deliveryAppTitle">
            <small>Hưng Phát Delivery</small>
            <strong>{onTrip ? 'Chi tiết chuyến' : 'Chuyến hôm nay'}</strong>
          </span>
        </div>
        <button
          className="deliveryTopButton"
          type="button"
          onClick={() => router.refresh()}
          aria-label="Đồng bộ dữ liệu"
        >
          <DeliveryIcon name="sync" size={21} />
        </button>
      </header>

      <div className="deliveryAppContent">{children}</div>

      <nav className="deliveryAppDock" aria-label="Điều hướng chính">
        <DockLinkItem href="/" icon="home" label="Hôm nay" active={!onTrip} />
        <DockLinkItem
          href={onTrip ? '#route-section' : '#active-trip'}
          icon="route"
          label={onTrip ? 'Điểm giao' : 'Chuyến'}
          active={onTrip}
        />
        <DockLinkItem
          href={onTrip ? '#cod-section' : '#delivery-guide'}
          icon={onTrip ? 'wallet' : 'guide'}
          label={onTrip ? 'COD' : 'Hướng dẫn'}
        />
        <button className="deliveryDockItem" type="button" onClick={() => router.refresh()}>
          <DeliveryIcon name="sync" size={22} />
          <span>Đồng bộ</span>
        </button>
      </nav>
    </div>
  );
}
