import { NextRequest } from 'next/server';
import { requestBackupApi } from '../../../lib/backup-gateway';
import { backupData, backupFailure, backupIdempotencyKey, backupJsonBody, backupRequestId } from '../../../lib/backup-route-helpers';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return backupData(await requestBackupApi({ path: '/api/backups', method: 'GET', requestId: backupRequestId(request) })); }
  catch (error) { return backupFailure(error); }
}
export async function POST(request: NextRequest) {
  const parsed = await backupJsonBody(request); if (!parsed.ok) return parsed.response;
  try { return backupData(await requestBackupApi({ path: '/api/backups', method: 'POST', body: parsed.body, idempotencyKey: backupIdempotencyKey(request), requestId: backupRequestId(request) }), 202); }
  catch (error) { return backupFailure(error); }
}
