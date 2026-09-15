import { NextRequest } from 'next/server';
import { readDeliverySessionToken, requestDeliveryInternalAuth } from '../../../../lib/internal-auth-client';

type CoreMe = Readonly<{
  employeeId?: string;
  permissions?: readonly string[];
  scopes?: Readonly<{ warehouseIds?: readonly string[] }>;
  session?: Readonly<{ loginName?: string; employeeFullName?: string }>;
}>;

export const dynamic = 'force-dynamic';

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')?.trim() || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export async function GET(request: NextRequest) {
  const token = bearerToken(request) || readDeliverySessionToken();
  if (!token) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const result = await requestDeliveryInternalAuth<CoreMe>('/api/internal-auth/me', { method: 'GET', token });
  if (!result.ok || !result.data) {
    return Response.json(
      {
        error: {
          code: result.code || 'DELIVERY_AUTH_FAILED',
          message: result.message || 'Không đọc được quyền truy cập',
          retryable: result.retryable === true,
        },
      },
      { status: result.status || 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json({ data: result.data }, { headers: { 'Cache-Control': 'no-store' } });
}
