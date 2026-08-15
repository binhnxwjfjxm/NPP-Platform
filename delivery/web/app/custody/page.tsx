import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../lib/delivery-capabilities';
import { listMyTrips } from '../../lib/core-api';
import { getMyCodOverview } from '../../lib/cod-api';
import { safeErrorMessage } from '../../lib/presentation';
import CodHandoverPanel from '../trips/[tripId]/cod-handover-panel';

export const dynamic = 'force-dynamic';

export default async function CustodyPage() {
  if (deliverySetupPending()) {
    return (
      <main className="pageShell">
        <section className="stateCard">
          <strong>Chưa mở dữ liệu tiền đang giữ</strong>
          <p>Ứng dụng đang chờ hồ sơ tài xế thật được liên kết.</p>
        </section>
      </main>
    );
  }

  const headerStore = headers();
  const user = authenticateDeliveryUser(headerStore.get('authorization'));
  const capabilities = deliveryCapabilitiesFromHeaders(headerStore);
  if (!user) {
    return (
      <main className="pageShell">
        <section className="stateCard errorCard">
          <strong>Không xác định được tài xế</strong>
          <p>Vui lòng tải lại trang và đăng nhập lại.</p>
        </section>
      </main>
    );
  }
  if (!capabilities.canViewTrips || !capabilities.canViewCustody) {
    return (
      <main className="pageShell">
        <section className="stateCard errorCard">
          <strong>Không có quyền xem tiền đang giữ</strong>
          <p>Quyền COD được lấy trực tiếp từ phiên NPP Core hiện tại.</p>
        </section>
      </main>
    );
  }

  try {
    const trips = await listMyTrips(user);
    const overviews = await Promise.all(
      trips.trips.map((trip) => getMyCodOverview(user, trip.id)),
    );
    return (
      <main className="pageShell">
        <header className="appHeader deliveryPageHeader">
          <div>
            <p className="eyebrow">Custody canonical</p>
            <h1>Tiền đang giữ</h1>
            <p className="welcome">Tiền mặt COD còn nằm trong custody của tài xế theo từng chuyến.</p>
          </div>
        </header>

        {overviews.length ? (
          <div className="tripList">
            {overviews.map((overview) => (
              <section className="tripOverview compactTripOverview" key={overview.trip.id}>
                <div className="deliverySectionHeading compact">
                  <div>
                    <p className="eyebrow">Chuyến</p>
                    <h2>{overview.trip.number}</h2>
                  </div>
                  <Link href={`/trips/${overview.trip.id}`}>Mở chuyến</Link>
                </div>
                <CodHandoverPanel
                  tripId={overview.trip.id}
                  overview={overview}
                  canCreateHandover={capabilities.canCreateCodHandover}
                />
              </section>
            ))}
          </div>
        ) : (
          <section className="stateCard">
            <strong>Chưa có chuyến đang giữ tiền</strong>
            <p>Khi có chuyến được giao cho tài xế, custody COD sẽ hiển thị tại đây.</p>
          </section>
        )}
      </main>
    );
  } catch (error) {
    return (
      <main className="pageShell">
        <section className="stateCard errorCard">
          <strong>Không tải được tiền đang giữ</strong>
          <p>{safeErrorMessage(error)}</p>
        </section>
      </main>
    );
  }
}
