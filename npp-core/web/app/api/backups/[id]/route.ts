import { NextRequest } from 'next/server';
import { requestBackupApi } from '../../../../lib/backup-gateway';
import { backupData, backupFailure, backupRequestId } from '../../../../lib/backup-route-helpers';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { return backupData(await requestBackupApi({ path: `/api/backups/${params.id}`, method: 'GET', requestId: backupRequestId(request) })); }
  catch (error) { return backupFailure(error); }
}
