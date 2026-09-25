import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  RETAIL_SESSION_COOKIE,
  companyAuthentication,
} from '../../../../lib/company-gateway';

type InternalMe = {
  actorId?: string;
  roles?: string[];
};

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = cookies().get(RETAIL_SESSION_COOKIE)?.value?.trim() ?? null;
  const result = await companyAuthentication<InternalMe>('/api/internal-auth/me', {
    method: 'GET',
    token,
  });
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: { code: result.code ?? 'UNAUTHORIZED', message: result.message ?? 'Cần đăng nhập để tiếp tục', retryable: result.retryable === true } },
      { status: result.status || 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const actorId = String(result.data.actorId ?? '');
  const userId = actorId.startsWith('user:') ? actorId.slice('user:'.length) : '';
  const roles = Array.isArray(result.data.roles) ? result.data.roles : [];
  return NextResponse.json(
    { data: { userId, isOwner: roles.includes('system:security-owner') } },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
