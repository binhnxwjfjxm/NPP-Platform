import { AdminIcon } from '../admin-icons';
import { AdminShell } from '../admin-shell';

export default function AdminMenuPage() {
  return (
    <AdminShell activeSection={null} title="Thông tin ứng dụng" subtitle="Cài đặt PWA, phiên đăng nhập và phạm vi sử dụng Admin.">
      <section className="menuPageGrid">
        <article className="card appMenuCard">
          <header className="cardHeader"><div className="cardHeading"><span className="smallIconBubble"><AdminIcon name="mobile" size={20} /></span><div><h2>Cài đặt ứng dụng</h2><p>Admin hỗ trợ PWA trên điện thoại và máy tính.</p></div></div></header>
          <div className="settingsList">
            <div className="settingsRow isStatic"><span className="rowIcon"><AdminIcon name="mobile" size={20} /></span><span><strong>Thêm vào màn hình chính</strong><small>Dùng chức năng cài ứng dụng của trình duyệt.</small></span><span className="statusPill">PWA</span></div>
            <div className="settingsRow isStatic"><span className="rowIcon"><AdminIcon name="lock" size={20} /></span><span><strong>Phiên quản trị</strong><small>Danh tính và hiệu lực phiên được xác minh bởi hệ thống Core.</small></span><AdminIcon name="check" size={18} /></div>
          </div>
        </article>
        <section className="noticePanel compactBoundaryNotice" aria-label="Phạm vi Admin"><span className="noticeIcon"><AdminIcon name="info" size={24} /></span><p><strong>Admin dành cho giám sát, cảnh báo, báo cáo và quyết định quản trị.</strong><span>Nghiệp vụ vận hành hằng ngày vẫn thuộc các ứng dụng chuyên trách.</span></p></section>
      </section>
    </AdminShell>
  );
}
