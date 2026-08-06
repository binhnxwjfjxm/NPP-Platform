import { AdminIcon } from '../admin-icons';
import { AdminShell } from '../admin-shell';

export const dynamic = 'force-dynamic';

export default function AdminMenuPage() {
  const nppOperationsUrl = (process.env.NPP_OPERATIONS_URL?.trim() || 'https://npp-platform.vercel.app').replace(/\/$/, '');

  return (
    <AdminShell
      activeSection="menu"
      kicker="Ứng dụng quản lý"
      title="Menu"
      subtitle="Ứng dụng liên quan, ranh giới sử dụng và thông tin PWA."
    >
      <section className="menuPageGrid">
        <article className="card appMenuCard">
          <header className="cardHeader">
            <div className="cardHeading">
              <span className="smallIconBubble"><AdminIcon name="operations" size={20} /></span>
              <div><h2>Ứng dụng liên quan</h2><p>Công việc hằng ngày nằm ở ứng dụng vận hành.</p></div>
            </div>
          </header>
          <div className="settingsList">
            <a className="settingsRow" href={`${nppOperationsUrl}/management`}>
              <span className="rowIcon"><AdminIcon name="operations" size={20} /></span>
              <span><strong>NPP Operations</strong><small>Xử lý đơn hàng và đề nghị mở mã khách</small></span>
              <AdminIcon name="external" size={18} />
            </a>
          </div>
        </article>

        <article className="card appMenuCard">
          <header className="cardHeader">
            <div className="cardHeading">
              <span className="smallIconBubble"><AdminIcon name="info" size={20} /></span>
              <div><h2>Giới thiệu hệ thống</h2><p>Mỗi ứng dụng giữ đúng phần việc của mình.</p></div>
            </div>
          </header>
          <div className="applicationList">
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="exception" size={20} /></span>
              <span><strong>Admin MCP/NPP</strong><small>Tổng hợp và ngoại lệ cấp quản lý</small></span>
              <span className="rolePill">Quản lý</span>
            </div>
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="operations" size={20} /></span>
              <span><strong>NPP Operations</strong><small>Xử lý nghiệp vụ hằng ngày</small></span>
              <span className="rolePill">Vận hành</span>
            </div>
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="mobile" size={20} /></span>
              <span><strong>MCP Field</strong><small>Tác nghiệp thị trường</small></span>
              <span className="rolePill">Thị trường</span>
            </div>
            <div className="applicationRow">
              <span className="rowIcon"><AdminIcon name="truck" size={20} /></span>
              <span><strong>Delivery</strong><small>Tác nghiệp giao hàng</small></span>
              <span className="rolePill">Giao nhận</span>
            </div>
          </div>
        </article>

        <article className="card appMenuCard">
          <header className="cardHeader">
            <div className="cardHeading">
              <span className="smallIconBubble"><AdminIcon name="mobile" size={20} /></span>
              <div><h2>Cài đặt ứng dụng</h2><p>Admin đã hỗ trợ PWA trên điện thoại và máy tính.</p></div>
            </div>
          </header>
          <div className="settingsList">
            <div className="settingsRow isStatic">
              <span className="rowIcon"><AdminIcon name="mobile" size={20} /></span>
              <span><strong>Thêm vào màn hình chính</strong><small>Dùng chức năng cài ứng dụng của trình duyệt.</small></span>
              <span className="statusPill">PWA</span>
            </div>
            <div className="settingsRow isStatic">
              <span className="rowIcon"><AdminIcon name="lock" size={20} /></span>
              <span><strong>Dữ liệu quản trị</strong><small>Không lưu cache trang quản trị hoặc API khi ngoại tuyến.</small></span>
              <AdminIcon name="check" size={18} />
            </div>
          </div>
        </article>

        <section className="noticePanel compactBoundaryNotice" aria-label="Ranh giới quản lý">
          <span className="noticeIcon"><AdminIcon name="info" size={24} /></span>
          <p>
            <strong>Admin không tạo mã khách và không xác nhận mọi đơn hàng.</strong>
            <span>Chỉ ngoại lệ vượt quyền mới được đưa lên hàng đợi cấp quản lý.</span>
          </p>
        </section>
      </section>
    </AdminShell>
  );
}
