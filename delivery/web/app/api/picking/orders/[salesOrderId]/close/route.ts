import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../../../../../lib/delivery-capabilities';
import { closeFulfillmentPicking } from '../../../../../../lib/fulfillment-api';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 4096;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message, retryable: status >= 500 } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest, context: { params: { salesOrderId: string } }) {
  if (deliverySetupPending()) return errorResponse('DELIVERY_DRIVER_SETUP_PENDING', 'Ứng dụng đang chờ phiên nhân viên thật', 503);
  const user = authenticateDeliveryUser(request.headers.get('authorization'));
  if (!user) return errorResponse('UNAUTHORIZED', 'Không xác định được nhân viên', 401);
  if (!deliveryCapabilitiesFromHeaders(request.headers).canPickWithWarehouse) {
    return errorResponse('PERMISSION_DENIED', 'Tài khoản không có quyền chốt soạn hàng trong kho được cấp', 403);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return errorResponse('REQUEST_BODY_TOO_LARGE', 'Dữ liệu chốt soạn quá lớn', 413);
  let payload: { mode?: unknown };
  try {
    payload = JSON.parse(raw) as { mode?: unknown };
  } catch {
    return errorResponse('INVALID_JSON_BODY', 'Dữ liệu chốt soạn không hợp lệ', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['FULL', 'PARTIAL'].includes(String(payload.mode))) {
    return errorResponse('INVALID_PICK_CLOSE_MODE', 'Chế độ chốt soạn không hợp lệ', 400);
  }

  try {
    const data = await closeFulfillmentPicking(
      user,
      context.params.salesOrderId,
      { mode: payload.mode as 'FULL' | 'PARTIAL' },
      request.headers.get('idempotency-key')?.trim() || '',
    );
    return NextResponse.json({ data }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const details = error as Error & { status?: number; code?: string };
    return errorResponse(details.code || 'DELIVERY_PICK_CLOSE_FAILED', details.message || 'Không chốt được soạn hàng', details.status || 503);
  }
}
