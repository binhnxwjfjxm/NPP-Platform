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
    <header className="appHeader deliveryPageHeader">
      <span className="brandLogoFrame">
        <img className="brandLogo" src={deliveryLogoUrl} alt="Logo Hưng Phát Company" />
      </span>
      <div>
        <p className="eyebrow">Tác nghiệp hôm nay</p>
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
        <section className="stateCard" id="active-trip">
          <strong>Chưa có hồ sơ tài xế đang hoạt động</strong>
          <p>Tạo hồ sơ tài xế và liên kết đúng nhân viên trong NPP Operations trước khi cấp tài khoản giao hàng.</p>
        </section>
        <section className="noticeCard">
          <strong>Đang ở chế độ chờ cấu hình</strong>
          <p>Ứng dụng chưa đọc chuyến và không tạo dữ liệu giao hàng giả.</p>
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
        <section className="stateCard errorCard" id="active-trip">
          <strong>Không xác định được tài xế</strong>
          <p>Vui lòng tải lại trang và đăng nhập bằng tài khoản đã được cấp.</p>
        </section>
      </main>
    );
  }

  let content;
  try {
    const result = await listMyTrips(user);
    const [activeTrip, ...remainingTrips] = result.trips;

    content = !activeTrip
      ? (
          <section className="stateCard emptyTripState" id="active-trip">
            <span className="emptyTripIcon" aria-hidden="true">✓</span>
            <strong>Chưa có chuyến đang giao</strong>
            <p>Chuyến sẽ xuất hiện sau khi kho hoàn tất bàn giao và cho xe xuất phát.</p>
          </section>
        )
      : (
          <>
            <section className="activeTripSection" aria-labelledby="active-trip-heading">
              <div className="deliverySectionHeading">
                <div>
                  <p className="eyebrow">Ưu tiên lúc này</p>
                  <h2 id="active-trip-heading">Chuyến đang giao</h2>
                </div>
                <span>{activeTrip.attemptCount ?? 0}/{activeTrip.assignmentCount ?? 0} phiếu</span>
              </div>
              <Link className="tripCard primaryTripCard" href={`/trips/${activeTrip.id}`} id="active-trip">
                <div className="cardTopline">
                  <span className="statusPill">Đã xuất phát</span>
                  <span>{formatDateTime(activeTrip.dispatchedAt)}</span>
                </div>
                <div className="primaryTripTitle">
                  <div>
                    <small>Mã chuyến</small>
                    <h2>{activeTrip.number}</h2>
                  </div>
                  <span className="primaryTripArrow" aria-hidden="true">→</span>
                </div>
                <dl className="summaryGrid primaryTripSummary">
                  <div>
                    <dt>Xe</dt>
                    <dd>{activeTrip.licensePlate || activeTrip.vehicleCode || 'Chưa có'}</dd>
                  </div>
                  <div>
                    <dt>Kho</dt>
                    <dd>{activeTrip.warehouseName || activeTrip.warehouseCode || 'Chưa có'}</dd>
                  </div>
                  <div>
                    <dt>Điểm giao</dt>
                    <dd>{activeTrip.stopCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Còn lại</dt>
                    <dd>{Math.max((activeTrip.assignmentCount ?? 0) - (activeTrip.attemptCount ?? 0), 0)}</dd>
                  </div>
                </dl>
                <span className="primaryTripAction">Mở điểm tiếp theo và ghi kết quả</span>
              </Link>
            </section>

            {remainingTrips.length ? (
              <section className="otherTripsSection" aria-labelledby="other-trips-heading">
                <div className="deliverySectionHeading compact">
                  <h2 id="other-trips-heading">Chuyến khác</h2>
                  <span>{remainingTrips.length}</span>
                </div>
                <div className="tripList">
                  {remainingTrips.map((trip) => (
                    <Link className="tripCard compactTripCard" href={`/trips/${trip.id}`} key={trip.id}>
                      <div className="cardTopline">
                        <span className="statusPill">Đã xuất phát</span>
                        <span>{formatDateTime(trip.dispatchedAt)}</span>
                      </div>
                      <h2>{trip.number}</h2>
                      <div className="compactTripMeta">
                        <span>{trip.licensePlate || trip.vehicleCode || 'Chưa có xe'}</span>
                        <span>{trip.stopCount ?? 0} điểm</span>
                        <span>{trip.attemptCount ?? 0}/{trip.assignmentCount ?? 0} phiếu</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        );
  } catch (error) {
    content = (
      <section className="stateCard errorCard" id="active-trip">
        <strong>Không tải được chuyến</strong>
        <p>{safeErrorMessage(error)}</p>
      </section>
    );
  }

  return (
    <main className="pageShell">
      <DeliveryHeader title="Chuyến của tôi" subtitle={`Xin chào, ${user.displayName}`} />
      {content}
      <section className="noticeCard deliveryGuideCard">
        <strong>Giao từng điểm, ghi ngay kết quả</strong>
        <p>Mở chuyến, chọn điểm tiếp theo rồi ghi giao đủ, giao một phần, không giao được hoặc hẹn giao lại.</p>
      </section>
    </main>
  );
}
