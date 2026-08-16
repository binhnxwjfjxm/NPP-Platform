import { NextRequest, NextResponse } from 'next/server';
import { requestBackupApi, TECHNICAL_BACKUP_UNLOCK_COOKIE } from '../../../../../../lib/backup-gateway';
import { backupFailure, backupIdempotencyKey, backupJsonBody, backupRequestId } from '../../../../../../lib/backup-route-helpers';

export const dynamic = 'force-dynamic';

type TechnicalUnlock = { token: string; expiresAt: string };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const parsed = await backupJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await requestBackupApi<TechnicalUnlock>({
      path: `/api/backups/technical-access/challenges/${params.id}/verify`,
      method: 'POST',
      body: parsed.body,
      idempotencyKey: backupIdempotencyKey(request),
      requestId: backupRequestId(request),
    });
    const expires = new Date(data.expiresAt);
    if (!data.token || Number.isNaN(expires.getTime())) {
      return NextResponse.json({
        error: { code: 'TECHNICAL_BACKUP_UNLOCK_RESPONSE_INVALID', message: 'Không thể mở Khu vực kỹ thuật', retryable: false },
      }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const response = NextResponse.json({
      data: { unlocked: true, expiresAt: data.expiresAt },
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(TECHNICAL_BACKUP_UNLOCK_COOKIE, data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/backups',
      expires,
    });
    return response;
  } catch (error) {
    return backupFailure(error);
  }
}
