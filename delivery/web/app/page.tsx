import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../lib/delivery-auth';
import { listMyTrips } from '../lib/core-api';
import { formatDateTime, safeErrorMessage } from '../lib/presentation';

export const dynamic = 'force-dynamic';

const deliveryLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
  || 'https://office.nguyenlieuhungphat.com/logo-transparent.png';

function DeliveryHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="appHeader">
      <span className="brandLogoFrame">
        <img className="brandLogo" src={deliveryLogoUrl} alt="Logo Hưng Phát Company" />
      </span>
      <div>
        <p className="eyebrow">Hưng Phát Company</p>
        <h1>{title}</h1>
        <p className="welcome">{subtitle}</p>
      </div>
    </header>
  );
}

export default async function DeliveryHomePage() {
  if (deliverySetupPending()) {
    return (
      <main className="pageShell">
        <DeliveryHeader title="Ứng dụng Giao hàng" subtitle="Hệ thống đã được triển khai" />
        <section className="stateCard">
          <strong>Chưa có hồ sơ tài xế đang hoạt động</strong>
          <p>Tạo hồ sơ tài xế và liên kết đúng nhân viên trong NPP Operations trước khi cấp tài khoản giao hàng.</p>
        </section>
        <section className="noticeCard">
          <strong>Đang ở chế độ chờ cấu hình</strong>
          <p>Ứng dụng chưa đọc chuyến và không tạo dữ liệu giao hàng giả. Sau khi có tài xế thật, chạy lại rollout Delivery để mở danh sách chuyến.</p>
        </section>
      </main>
    );
  }

  const headerStore = headers();
  const user = authenticateDeliveryUser(headerStore.get('authorization'));
  if (!user) {
    return (
      <main className="pageShell">
        <DeliveryHeader title="Ứng dụng Giao hàng" subtitle="Dành cho tài xế và nhân viên giao nhận" />
        <section className="stateCard errorCard">
          <strong>Không xác định được tài xế</strong>
          <p>Vui lòng tải lại trang và đăng nhập bằng tài khoản đã được cấp.</p>
        </section>
      </main>
    );
  }

  let content;
  try {
    const result = await listMyTrips(user);
    content = result.trips.length === 0
      ? (
          <section className="stateCard">
            <strong>Chưa có chuyến đang giao</strong>
            <p>Chuyến sẽ xuất hiện sau khi kho hoàn tất bàn giao và cho xe xuất phát.</p>
          </section>
        )
      : (
          <section className="tripList" aria-label="Danh sách chuyến được giao">
            {result.trips.map((trip) => (
              <Link className="tripCard" href={`/trips/${trip.id}`} key={trip.id}>
                <div className="cardTopline">
                  <span className="statusPill">Đã xuất phát</span>
                  <span>{formatDateTime(trip.dispatchedAt)}</span>
                </div>
                <h2>{trip.number}</h2>
                <dl className="summaryGrid">
                  <div>
                    <dt>Xe</dt>
                    <dd>{trip.licensePlate || trip.vehicleCode || 'Chưa có'}</dd>
                  </div>
                  <div>
                    <dt>Kho</dt>
                    <dd>{trip.warehouseName || trip.warehouseCode || 'Chưa có'}</dd>
                  </div>
                  <div>
                    <dt>Điểm giao</dt>
                    <dd>{trip.stopCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Đã ghi kết quả</dt>
                    <dd>{trip.attemptCount ?? 0}/{trip.assignmentCount ?? 0}</dd>
                  </div>
                </dl>
                <span className="openHint">Mở chi tiết chuyến →</span>
              </Link>
            ))}
          </section>
        );
  } catch (error) {
    content = (
      <section className="stateCard errorCard">
        <strong>Không tải được chuyến</strong>
        <p>{safeErrorMessage(error)}</p>
      </section>
    );
  }

  return (
    <main className="pageShell">
      <DeliveryHeader title="Chuyến của tôi" subtitle={`Xin chào, ${user.displayName}`} />
      <section className="noticeCard">
        <strong>Ghi kết quả tại từng phiếu giao</strong>
        <p>Mở chuyến để ghi giao đủ, giao một phần, không giao được hoặc hẹn giao lại. Ảnh, chữ ký, GPS và thu tiền chỉ hiển thị khi được cấu hình và cấp quyền.</p>
      </section>
      {content}
    </main>
  );
}
