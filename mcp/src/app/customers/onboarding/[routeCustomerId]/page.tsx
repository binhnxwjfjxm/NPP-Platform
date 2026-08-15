import { CustomerOnboardingClientPage } from "@/features/accounts/CustomerOnboardingClientPage";
import { loadCustomerOnboardingQueue } from "@/lib/api/customer-onboarding-data";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";

function UnavailableCustomer() {
  return (
    <AppShell activeHref="/customers">
      <PageHeader
        eyebrow="Khách"
        title="Không thể mở điểm bán"
        subtitle="Điểm bán có thể đã bị gỡ, chuyển sang tuyến khác hoặc phân công phụ trách vừa thay đổi."
      >
        <a className="button compact" href="/customers">Về danh sách khách</a>
      </PageHeader>
      <section className="card route-list-card" aria-label="Trạng thái quyền xem điểm bán">
        <div className="empty-inline">
          <strong>Điểm bán hiện không còn trong phạm vi dữ liệu của tài khoản này.</strong>
          <p className="page-subtitle">
            Hãy quay lại danh sách khách để tải phân công mới. Nếu đây là tài khoản Owner, hãy đăng nhập lại rồi thử lại.
          </p>
        </div>
      </section>
    </AppShell>
  );
}

export default async function Page({ params }: { params: Promise<{ routeCustomerId: string }> }) {
  const { routeCustomerId } = await params;
  const items = await loadCustomerOnboardingQueue();
  const item = items.find((candidate) => candidate.routeCustomerId === routeCustomerId);
  if (!item) return <UnavailableCustomer />;
  return <CustomerOnboardingClientPage items={[item]} />;
}
