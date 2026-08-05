'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

export default function DeliveryAppFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const onTrip = pathname.startsWith('/trips/');

  return (
    <div className="deliveryAppFrame" data-delivery-app-frame data-route-mode={onTrip ? 'trip' : 'home'}>
      <header className="deliveryAppTopBar">
        <div className="deliveryAppIdentity">
          <span className="deliveryAppMark" aria-hidden="true">HP</span>
          <span className="deliveryAppTitle">
            <small>Hưng Phát</small>
            <strong>{onTrip ? 'Chi tiết chuyến' : 'Giao hàng'}</strong>
          </span>
        </div>
        <div className="deliveryAppTopActions">
          {onTrip ? <Link className="deliveryTopButton" href="/" aria-label="Về danh sách chuyến">‹</Link> : null}
          <button className="deliveryTopButton" type="button" onClick={() => router.refresh()} aria-label="Đồng bộ dữ liệu">↻</button>
        </div>
      </header>

      <div className="deliveryAppContent">{children}</div>

      <nav className="deliveryAppDock" aria-label="Thao tác ứng dụng">
        <Link className={!onTrip ? 'deliveryDockItem active' : 'deliveryDockItem'} href="/">
          <span aria-hidden="true">⌂</span>
          <small>Chuyến</small>
        </Link>
        <a className="deliveryDockPrimary" href={onTrip ? '#next-delivery-action' : '#active-trip'}>
          <span aria-hidden="true">{onTrip ? '✓' : '→'}</span>
          <strong>{onTrip ? 'Ghi kết quả' : 'Mở chuyến'}</strong>
        </a>
        <button className="deliveryDockItem" type="button" onClick={() => router.refresh()}>
          <span aria-hidden="true">↻</span>
          <small>Đồng bộ</small>
        </button>
      </nav>
    </div>
  );
}
