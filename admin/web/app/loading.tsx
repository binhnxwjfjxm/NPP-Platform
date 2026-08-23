import { AdminShell } from './admin-shell';

export default function Loading() {
  return (
    <AdminShell activeSection={null} title="Đang tải" subtitle="Hệ thống đang chuẩn bị nội dung quản trị.">
      <section className="card adminRouteState" role="status" aria-live="polite">
        <h2>Đang tải dữ liệu</h2>
        <p>Vui lòng chờ trong giây lát.</p>
      </section>
    </AdminShell>
  );
}
