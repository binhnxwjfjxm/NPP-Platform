import Link from 'next/link';
import { AdminShell } from './admin-shell';

export default function NotFound() {
  return (
    <AdminShell activeSection={null} title="Không tìm thấy nội dung" subtitle="Nội dung này không tồn tại hoặc đã thay đổi.">
      <section className="card adminRouteState" role="status">
        <h2>Không tìm thấy nội dung cần xem.</h2>
        <p>Quay lại Tổng quan để tiếp tục.</p>
        <div className="adminRouteStateActions"><Link className="adminRouteStateAction" href="/">Về Tổng quan</Link></div>
      </section>
    </AdminShell>
  );
}
