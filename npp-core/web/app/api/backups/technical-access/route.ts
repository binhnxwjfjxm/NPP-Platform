import { NextRequest } from 'next/server';
import { requestBackupApi } from '../../../../lib/backup-gateway';
import { backupData, backupFailure, backupIdempotencyKey, backupRequestId } from '../../../../lib/backup-route-helpers';

export const dynamic = 'force-dynamic';

type TechnicalAccess = { unlocked: boolean; expiresAt: string | null };
type TechnicalChallenge = { id: string; challengeExpiresAt: string; recipient: string };

export async function GET(request: NextRequest) {
  try {
    return backupData(await requestBackupApi<TechnicalAccess>({
      path: '/api/backups/technical-access',
      method: 'GET',
      requestId: backupRequestId(request),
    }));
  } catch (error) {
    return backupFailure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return backupData(await requestBackupApi<TechnicalChallenge>({
      path: '/api/backups/technical-access/challenges',
      method: 'POST',
      body: {},
      idempotencyKey: backupIdempotencyKey(request),
      requestId: backupRequestId(request),
    }), 201);
  } catch (error) {
    return backupFailure(error);
  }
}
