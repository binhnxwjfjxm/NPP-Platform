import { NextRequest } from 'next/server';
import { requestBackupApi } from '../../../../../lib/backup-gateway';
import { backupData, backupFailure, backupIdempotencyKey, backupJsonBody, backupRequestId } from '../../../../../lib/backup-route-helpers';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const parsed = await backupJsonBody(request); if (!parsed.ok) return parsed.response;
  try { return backupData(await requestBackupApi({ path: `/api/data-deletions/${params.id}/verify`, method: 'POST', body: parsed.body, idempotencyKey: backupIdempotencyKey(request), requestId: backupRequestId(request) })); }
  catch (error) { return backupFailure(error); }
}
