import 'server-only';

import { requireNppWorkforceSessionToken } from './internal-auth-client';

export async function requireInventoryMovementExportPermission(requestId: string, warehouseId: string) {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new Error('Xuất biến động kho chưa được cấu hình.');
  let base: URL;
  try { base = new URL(raw); } catch { throw new Error('Xuất biến động kho chưa được cấu hình.'); }
  if (!['http:', 'https:'].includes(base.protocol)
      || base.username
      || base.password
      || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) {
    throw new Error('Xuất biến động kho chưa được cấu hình.');
  }
  const url = new URL('/api/inventory/reporting-export', base.toString().replace(/\/$/, ''));
  url.searchParams.set('authorizeMovement', '1');
  url.searchParams.set('warehouseId', warehouseId);
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
      Accept: 'application/json',
      'x-request-id': requestId,
    },
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  throw Object.assign(new Error(payload?.error?.message || 'Không có quyền xuất biến động kho.'), { statusCode: response.status });
}
