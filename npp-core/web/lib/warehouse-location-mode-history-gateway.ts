import 'server-only';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 30_000;

type CoreEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;

export type WarehouseLocationModeRunLine = Readonly<{
  id: string;
  lineNumber: number;
  sku: string;
  lotCode: string | null;
  sourceLocationId: string | null;
  sourceLocationCode: string | null;
  sourceLocationName: string | null;
  destinationLocationId: string | null;
  destinationLocationCode: string | null;
  destinationLocationName: string | null;
  baseQuantity: string;
}>;

export type WarehouseLocationModeRun = Readonly<{
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  fromMode: 'MANAGED' | 'UNMANAGED' | null;
  targetMode: 'MANAGED' | 'UNMANAGED';
  destinationLocationCode: string | null;
  destinationLocationName: string | null;
  affectedSkuCount: number;
  affectedScopeCount: number;
  totalBaseQuantity: string;
  completedAt: string;
  completedBy: string;
  lines?: readonly WarehouseLocationModeRunLine[];
}>;

function coreBaseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new Error('Dịch vụ Công Ty chưa được cấu hình.');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('Dịch vụ Công Ty chưa được cấu hình.');
  }
  return url.toString().replace(/\/$/, '');
}

async function getCore<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${coreBaseUrl()}${path}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'x-request-id': `web-warehouse-location-history-${crypto.randomUUID()}`,
      },
    });
    const body = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!response.ok || !body || body.data === undefined) {
      throw new Error(body?.error?.message || 'Không tải được lịch sử quản lý vị trí.');
    }
    return body.data;
  } finally {
    clearTimeout(timeout);
  }
}

export function listWarehouseLocationModeRuns(warehouseId: string) {
  if (!UUID_PATTERN.test(warehouseId)) throw new Error('Kho không hợp lệ.');
  return getCore<readonly WarehouseLocationModeRun[]>(
    `/api/inventory/warehouses/${encodeURIComponent(warehouseId)}/location-mode/runs?limit=100&offset=0`,
  );
}

export function getWarehouseLocationModeRun(runId: string) {
  if (!UUID_PATTERN.test(runId)) throw new Error('Lịch sử chuyển chế độ không hợp lệ.');
  return getCore<WarehouseLocationModeRun>(
    `/api/inventory/location-mode-runs/${encodeURIComponent(runId)}`,
  );
}
