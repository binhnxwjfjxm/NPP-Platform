import Link from 'next/link';
import { AdminIcon } from '../admin-icons';
import { AdminShell } from '../admin-shell';

export const dynamic = 'force-dynamic';

export default function CustomerExceptionBoundaryPage() {
  return (
    <AdminShell
      activeSection="exceptions"
      kicker="Theo dõi và phê duyệt ngoại lệ"
      title="Ngoại lệ cấp quản lý"
      subtitle="Chỉ các tình huống vượt quy tắc mới được đưa lên cấp quản lý; không xử lý thay việc hằng ngày của Sales Admin."
    >
      <section className="noticePanel" aria-label="Phạm vi ngoại lệ">
        <span className="noticeIcon"><AdminIcon name="info" size={24} /></span>
        <p>
          <strong>Các việc hằng ngày vẫn nằm ở NPP Operations.</strong>
          <span>Trang này chỉ hiển thị ngoại lệ cần cấp quản lý xem xét.</span>
        </p>
      </section>

      <div className="filterBar" aria-label="Nhóm ngoại lệ">
        <span className="filterChip isActive"><AdminIcon name="clipboard" size={18} />Tất cả</span>
        <span className="filterChip"><AdminIcon name="tag" size={18} />Giá</span>
        <span className="filterChip"><AdminIcon name="user" size={18} />Khách hàng</span>
        <span className="filterChip"><AdminIcon name="coin" size={18} />Công nợ</span>
        <span className="filterChip"><AdminIcon name="lock" size={18} />Tạm khóa</span>
      </div>

      <section className="exceptionWorkspace">
        <article className="card exceptionListCard">
          <header className="cardHeader">
            <div className="cardHeading">
              <span className="smallIconBubble"><AdminIcon name="clipboard" size={20} /></span>
              <div><h2>Danh sách ngoại lệ</h2><p>Hàng đợi chỉ xuất hiện khi có nguồn dữ liệu phân loại riêng.</p></div>
            </div>
          </header>

          <div className="exceptionTableHeader" aria-hidden="true">
            <span>Loại</span><span>Điều kiện đưa lên quản lý</span><span>Trạng thái</span>
          </div>
          <div className="boundaryRows">
            <div className="boundaryRow">
              <span className="rowIcon"><AdminIcon name="tag" size={20} /></span>
              <span><strong>Ngoại lệ giá</strong><small>Giá hoặc chiết khấu vượt chính sách đã khóa.</small></span>
              <span className="statusPill isPending">Chờ nguồn dữ liệu</span>
            </div>
            <div className="boundaryRow">
              <span className="rowIcon"><AdminIcon name="user" size={20} /></span>
              <span><strong>Ngoại lệ khách hàng</strong><small>Trùng khách, khách bị khóa hoặc hồ sơ vượt quyền xử lý.</small></span>
              <span className="statusPill isPending">Chờ nguồn dữ liệu</span>
            </div>
            <div className="boundaryRow">
              <span className="rowIcon"><AdminIcon name="coin" size={20} /></span>
              <span><strong>Ngoại lệ công nợ</strong><small>Hạn mức, tuổi nợ hoặc rủi ro vượt ngưỡng quản lý.</small></span>
              <span className="statusPill isPending">Chờ nguồn dữ liệu</span>
            </div>
            <div className="boundaryRow">
              <span className="rowIcon"><AdminIcon name="lock" size={20} /></span>
              <span><strong>Yêu cầu mở lại hoặc tạm khóa</strong><small>Chỉ hiển thị khi có lý do, người gửi và lịch sử kiểm soát.</small></span>
              <span className="statusPill isPending">Chờ nguồn dữ liệu</span>
            </div>
          </div>

          <div className="emptyState">
            <span className="emptyStateIcon"><AdminIcon name="exception" size={28} /></span>
            <div>
              <h3>Chưa có hàng đợi ngoại lệ riêng</h3>
              <p>Admin không hiển thị nút duyệt giả khi backend chưa trả đúng loại ngoại lệ, lý do đẩy lên, ngưỡng vượt và audit log.</p>
            </div>
          </div>
        </article>

        <aside className="exceptionSide">
          <article className="card detailCard">
            <header className="cardHeader">
              <div className="cardHeading">
                <span className="smallIconBubble"><AdminIcon name="exception" size={20} /></span>
                <div><h2>Ranh giới duyệt ngoại lệ</h2><p>Điều kiện bắt buộc trước khi mở thao tác.</p></div>
              </div>
            </header>
            <dl className="detailList">
              <div><dt>Nguồn dữ liệu</dt><dd>Backend phân loại ngoại lệ riêng</dd></div>
              <div><dt>Lý do đưa lên</dt><dd>Hiển thị rõ quy tắc hoặc ngưỡng bị vượt</dd></div>
              <div><dt>Người gửi</dt><dd>Có danh tính và thời điểm đề nghị</dd></div>
              <div><dt>Lịch sử</dt><dd>Có audit log trước và sau quyết định</dd></div>
            </dl>
          </article>

          <article className="card guardCard">
            <header className="cardHeader">
              <div className="cardHeading">
                <span className="smallIconBubble"><AdminIcon name="check" size={20} /></span>
                <div><h2>Giữ đúng phân quyền</h2><p>Không đưa công việc hằng ngày lên Admin.</p></div>
              </div>
            </header>
            <ul className="guardList">
              <li><AdminIcon name="check" size={18} /><span>Không tạo hoặc liên kết mã khách tại Admin.</span></li>
              <li><AdminIcon name="check" size={18} /><span>Không xác nhận đơn bán hàng thông thường.</span></li>
              <li><AdminIcon name="check" size={18} /><span>Không mở nút duyệt khi thiếu dữ liệu kiểm soát.</span></li>
            </ul>
            <Link className="secondaryAction" href="/"><AdminIcon name="back" size={18} />Quay lại tổng hợp</Link>
          </article>
        </aside>
      </section>
    </AdminShell>
  );
}
