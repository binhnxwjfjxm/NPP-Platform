import Link from 'next/link';
import { AdminShell } from '../admin-shell';

export const dynamic = 'force-dynamic';

export default function CustomerExceptionBoundaryPage() {
  const nppOperationsUrl = (process.env.NPP_OPERATIONS_URL?.trim() || 'https://npp-platform.vercel.app').replace(/\/$/, '');

  return (
    <AdminShell
      kicker="Việc cần cấp quản lý"
      title="Ranh giới duyệt ngoại lệ"
      subtitle="Admin chỉ xử lý trường hợp vượt quyền; tạo mã khách và xử lý đề nghị thông thường nằm trong NPP Operations."
      action={<Link className="actionLink" href="/">Quay lại tổng hợp</Link>}
    >
      <p className="notice">
        Hàng đợi ngoại lệ riêng chưa được backend phân loại. Vì vậy màn Admin không hiển thị các nút tạo mã, liên kết khách, yêu cầu bổ sung hoặc từ chối đề nghị thông thường.
      </p>

      <section className="sectionGrid">
        <article className="card">
          <header className="sectionHeader">
            <div>
              <h2>Khách hàng thông thường</h2>
              <p>Sales Admin hoặc CS kiểm tra điểm bán, tạo mã mới hay liên kết khách đã có.</p>
            </div>
            <a href={`${nppOperationsUrl}/management/customer-onboarding`}>Mở trong NPP</a>
          </header>
          <p className="empty">Các thao tác hằng ngày được giữ nguyên trong NPP Operations.</p>
        </article>

        <article className="card">
          <header className="sectionHeader">
            <div>
              <h2>Ngoại lệ cấp quản lý</h2>
              <p>Trùng khách chưa rõ cách xử lý, rủi ro công nợ, hạn mức vượt chuẩn, giá đặc biệt hoặc yêu cầu mở lại khách bị khóa.</p>
            </div>
          </header>
          <p className="empty">Chỉ mở nút duyệt tại đây khi backend trả đúng loại ngoại lệ, lý do đẩy lên, người gửi, ngưỡng vượt và audit log.</p>
        </article>
      </section>
    </AdminShell>
  );
}
