import { NextRequest, NextResponse } from 'next/server';
import { resolveInventoryRequestId } from '../../../../../../lib/inventory-gateway';
import { requireInventoryMovementExportPermission } from '../../../../../../lib/inventory-movement-export-permission';
import { GET as exportMovementFile } from './base-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = resolveInventoryRequestId(request.headers.get('x-request-id'));
  const warehouseId = String(request.nextUrl.searchParams.get('warehouseId') ?? '').trim();
  if (!warehouseId) {
    return NextResponse.json(
      { error: { code: 'INVENTORY_MOVEMENT_EXPORT_SCOPE_INVALID', message: 'Kho cần xuất không hợp lệ.', retryable: false }, requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }
  try {
    await requireInventoryMovementExportPermission(requestId, warehouseId);
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode) || 503;
    return NextResponse.json(
      { error: { code: statusCode === 403 ? 'FORBIDDEN' : 'INVENTORY_MOVEMENT_EXPORT_PERMISSION_FAILED', message: error instanceof Error ? error.message : 'Không có quyền xuất biến động kho.', retryable: statusCode >= 500 }, requestId },
      { status: statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }
  return exportMovementFile(request);
}
