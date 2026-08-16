import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../lib/delivery-capabilities';
import { getMyCodOverview, listMyCodCustodyTripIds } from '../../lib/cod-api';
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
          <p>Quyền COD được lấy trực tiếp từ phiên Công Ty hiện tại.</p>
        </section>
      </main>
    );
  }

  try {
    const tripIds = await listMyCodCustodyTripIds(user);
    const overviews = await Promise.all(tripIds.map((tripId) => getMyCodOverview(user, tripId)));
    return (
      <main className="pageShell">
        <header className="appHeader deliveryPageHeader">
          <div>
            <p className="eyebrow">Tiền COD</p>
            <h1>Tiền đang giữ</h1>
            <p className="welcome">Các khoản tiền mặt tài xế còn giữ vẫn hiển thị tại đây kể cả khi chuyến đã kết thúc.</p>
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
                  <span>{overview.trip.warehouseName || overview.trip.warehouseCode || 'Kho giao hàng'}</span>
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
            <strong>Không còn tiền COD cần bàn giao</strong>
            <p>Khi tài xế còn giữ tiền mặt COD, khoản tiền sẽ nằm ở đây cho tới khi bàn giao cho Công Ty.</p>
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
