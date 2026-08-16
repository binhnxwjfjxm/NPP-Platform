import { NextResponse } from 'next/server';
import { readNppWorkforceSessionToken, requestNppInternalAuth } from '../../../../lib/internal-auth-client';

export const dynamic = 'force-dynamic';

const OWNER_ROLES = new Set(['system:security-owner', 'system:implementation-owner']);

type MeData = Readonly<{
  roles?: string[];
  permissions?: string[];
}>;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET() {
  const token = readNppWorkforceSessionToken();
  if (!token) {
    return noStoreJson({ error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập', retryable: false } }, 401);
  }

  const result = await requestNppInternalAuth<MeData>('/api/internal-auth/me', {
    method: 'GET',
    token,
  });
  if (!result.ok) {
    return noStoreJson({
      error: {
        code: result.code ?? 'BACKUP_ACCESS_FAILED',
        message: result.message ?? 'Không tải được quyền sao lưu',
        retryable: result.retryable === true,
      },
    }, result.status);
  }

  const roles = Array.isArray(result.data?.roles) ? result.data.roles : [];
  const permissions = Array.isArray(result.data?.permissions) ? result.data.permissions : [];
  const isOwner = roles.some((role) => OWNER_ROLES.has(role));

  return noStoreJson({
    data: {
      canReadBackup: isOwner && permissions.includes('core.backup.read'),
      canCreateBackup: isOwner && permissions.includes('core.backup.create'),
      canDownloadBackup: isOwner && permissions.includes('core.backup.download'),
      canAuthorizeDeletion: isOwner && permissions.includes('core.data-deletion.authorize'),
    },
  });
}
