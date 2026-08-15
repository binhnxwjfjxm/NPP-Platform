import { loadOwnedCoreCustomers } from "@/lib/api/customer-onboarding-data";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";

export async function AccountsPage() {
  const customers = await loadOwnedCoreCustomers();
  return (
    <AppShell activeHref="/customers">
      <PageHeader
        eyebrow="Khách hàng"
        title="Khách hệ thống"
        subtitle="Danh sách khách canonical Core đang giao cho nhân viên đăng nhập phụ trách."
      >
        <a className="button primary compact" href="/customers/onboarding">Mở / liên kết mã</a>
        <form action="/api/auth/logout" method="post"><button className="button compact" type="submit">Đăng xuất</button></form>
      </PageHeader>

      <section className="card route-list-card" aria-label="Khách hệ thống thuộc nhân viên phụ trách">
        <div className="route-list-heading">
          <div>
            <h2 className="panel-title">Khách của tôi</h2>
            <p className="page-subtitle">Nguồn: shared.customers qua read model MCP, lọc bằng responsible_employee_id.</p>
          </div>
          <span>{customers.length} khách</span>
        </div>
        <div className="grid">
          {customers.map((customer) => (
            <article className="card" key={customer.id}>
              <div className="mobile-summary-head">
                <div className="mobile-summary-title">
                  <span>{customer.customerCode || "Chưa có mã"}</span>
                  <h3>{customer.name}</h3>
                </div>
                <span className="mobile-summary-status summary-status-good">Đang hoạt động</span>
              </div>
              <div className="grid">
                <div className="metric-row"><span>Điện thoại</span><strong>{customer.phone || "-"}</strong></div>
                <div className="metric-row"><span>Email</span><strong>{customer.email || "-"}</strong></div>
              </div>
            </article>
          ))}
          {customers.length === 0 ? (
            <div className="empty-inline">
              <strong>Chưa có khách hệ thống được giao</strong>
              <p className="page-subtitle">Điểm bán chưa có mã có thể gửi xác minh tại “Mở / liên kết mã”.</p>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
