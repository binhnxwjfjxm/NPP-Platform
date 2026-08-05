import Link from "next/link";

export function MobileHomeLaunchpad() {
  return (
    <section className="mobile-home-launchpad" aria-label="Tác nghiệp nhanh hôm nay">
      <div className="mobile-home-launchpad-copy">
        <span>Hôm nay ngoài thị trường</span>
        <h1>Bắt đầu từ tuyến cần đi</h1>
        <p>Mở tuyến, tiếp tục phiên và ghi kết quả tại từng điểm bán.</p>
      </div>
      <div className="mobile-home-launchpad-actions">
        <Link className="mobile-home-primary-action" href="/visits" prefetch>
          <span aria-hidden="true">◎</span>
          <span><strong>Đi tuyến hôm nay</strong><small>Mở phiên và danh sách điểm bán</small></span>
          <b aria-hidden="true">›</b>
        </Link>
        <div className="mobile-home-quick-grid">
          <Link href="/routes" prefetch><span aria-hidden="true">⌖</span><strong>Tuyến</strong></Link>
          <Link href="/orders" prefetch><span aria-hidden="true">＋</span><strong>Tạo đơn</strong></Link>
          <Link href="/reports" prefetch><span aria-hidden="true">▣</span><strong>Báo cáo</strong></Link>
        </div>
      </div>
    </section>
  );
}
