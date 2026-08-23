'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="adminRouteStatePage">
      <section className="card adminRouteState" role="alert">
        <h2>Không thể mở nội dung</h2>
        <p>Dữ liệu đang không sẵn sàng. Anh/chị có thể thử lại hoặc về Tổng quan.</p>
        <div className="adminRouteStateActions">
          <button className="adminRouteStateAction" type="button" onClick={() => reset()}>Thử lại</button>
          <Link className="adminRouteStateAction" href="/">Về Tổng quan</Link>
        </div>
      </section>
    </main>
  );
}
