import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  RETAIL_SESSION_COOKIE,
  companyAuthentication,
} from '../../../../lib/company-gateway';

type InternalMe = {
  actorId?: string;
  roles?: string[];
  session?: {
    ownerKind?: 'PERMANENT' | 'TEMPORARY' | null;
  };
};

const OWNER_ROLES = new Set(['system:security-owner', 'system:implementation-owner']);

function isRetailOwner(data: InternalMe) {
  const ownerKind = data.session?.ownerKind ?? null;
  if (ownerKind === 'PERMANENT' || ownerKind === 'TEMPORARY') return true;
  const roles = Array.isArray(data.roles) ? data.roles : [];
  return roles.some((role) => OWNER_ROLES.has(role));
}

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
  return NextResponse.json(
    { data: { userId, isOwner: isRetailOwner(result.data) } },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
