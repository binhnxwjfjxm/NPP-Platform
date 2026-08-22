import Link from "next/link";

const QUICK_LINKS = [
  { href: "/routes", icon: "⌖", label: "Tuyến" },
  { href: "/mcp/sessions", icon: "◷", label: "Phiên" },
  { href: "/orders", icon: "＋", label: "Đơn" },
  { href: "/reports", icon: "▣", label: "Báo cáo" },
  { href: "/plans", icon: "✓", label: "Việc" }
];

export function MobileHomeLaunchpad() {
  return (
    <section className="mobile-home-launchpad" aria-label="Tác nghiệp nhanh hôm nay">
      <div className="mobile-home-launchpad-actions">
        <a className="mobile-home-primary-action" data-document-navigation="true" href="/visits">
          <span aria-hidden="true">◎</span>
          <span><strong>Đi tuyến hôm nay</strong><small>Mở danh sách điểm bán và tiếp tục phiên</small></span>
          <b aria-hidden="true">›</b>
        </a>
        <nav className="mobile-home-quick-grid" aria-label="Lối tắt tổng quan">
          {QUICK_LINKS.map((item) => (
            <Link href={item.href} key={item.href} prefetch={false}>
              <span aria-hidden="true">{item.icon}</span>
              <strong>{item.label}</strong>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
