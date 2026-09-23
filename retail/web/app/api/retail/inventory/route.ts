import { NextRequest, NextResponse } from 'next/server';
import { CompanyGatewayError, companyRequest } from '../../../../lib/company-gateway';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000;
const SCALE = 12;
const SCALE_FACTOR = BigInt(10) ** BigInt(SCALE);

type Warehouse = {
  id: string;
  code: string;
  name: string;
};

type InventoryBalance = {
  base_variant_id?: unknown;
  base_sku?: unknown;
  base_variant_name?: unknown;
  product_name?: unknown;
  on_hand_quantity?: unknown;
  reserved_quantity?: unknown;
  business_held_quantity?: unknown;
};

type InventoryRow = {
  variantId: string;
  productName: string;
  sku: string;
  onHandScaled: bigint;
  reservedScaled: bigint;
  businessHeldScaled: bigint | null;
};

function requestId(request: NextRequest) {
  const value = request.headers.get('x-request-id')?.trim();
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : `retail_inventory_${crypto.randomUUID()}`;
}

function json(data: unknown, id: string, status = 200) {
  return NextResponse.json({ data, requestId: id }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': id } });
}

function errorResponse(error: unknown, id: string) {
  const source = error instanceof CompanyGatewayError
    ? error
    : new CompanyGatewayError('RETAIL_INVENTORY_UNAVAILABLE', 'Chưa thể tải tồn kho.', 503, true);
  const forbidden = source.statusCode === 401 || source.statusCode === 403;
  const normalized = forbidden
    ? new CompanyGatewayError('RETAIL_INVENTORY_FORBIDDEN', 'Tài khoản chưa có quyền xem tồn kho.', source.statusCode, false)
    : source;
  return NextResponse.json({
    error: {
      code: normalized.code,
      message: normalized.publicMessage,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    requestId: id,
  }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': id } });
}

function decimalToScaled(value: unknown) {
  const text = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(text);
  if (!match) return BigInt(0);
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(SCALE, '0') || '0');
  const scaled = whole * SCALE_FACTOR + fraction;
  return match[1] ? -scaled : scaled;
}

function scaledToDecimal(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_FACTOR;
  const fraction = String(absolute % SCALE_FACTOR).padStart(SCALE, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

async function loadWarehouses(id: string) {
  const result = await companyRequest<Warehouse[]>({ path: '/api/warehouses?active=true&limit=200', requestId: id });
  return result.data;
}

async function loadBalances(id: string, warehouseId: string) {
  const rows: InventoryBalance[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const result = await companyRequest<InventoryBalance[]>({
      path: `/api/inventory/balances?warehouseId=${encodeURIComponent(warehouseId)}&limit=${PAGE_SIZE}&offset=${offset}`,
      requestId: id,
    });
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
  throw new CompanyGatewayError('RETAIL_INVENTORY_TOO_LARGE', 'Danh sách tồn kho quá lớn để xem nhanh.', 409, false);
}

function aggregate(rows: InventoryBalance[]) {
  const grouped = new Map<string, InventoryRow>();
  for (const row of rows) {
    const variantId = String(row.base_variant_id ?? '').trim();
    if (!UUID_PATTERN.test(variantId)) continue;
    const current = grouped.get(variantId) ?? {
      variantId,
      productName: String(row.product_name ?? row.base_variant_name ?? 'Sản phẩm').trim() || 'Sản phẩm',
      sku: String(row.base_sku ?? '').trim() || '—',
      onHandScaled: BigInt(0),
      reservedScaled: BigInt(0),
      businessHeldScaled: null,
    };
    current.onHandScaled += decimalToScaled(row.on_hand_quantity);
    current.reservedScaled += decimalToScaled(row.reserved_quantity);
    if (row.business_held_quantity !== undefined && row.business_held_quantity !== null && String(row.business_held_quantity).trim() !== '')
      current.businessHeldScaled = decimalToScaled(row.business_held_quantity);
    grouped.set(variantId, current);
  }
  return [...grouped.values()]
    .sort((left, right) => left.productName.localeCompare(right.productName, 'vi') || left.sku.localeCompare(right.sku, 'vi'))
    .map((row) => ({
      variantId: row.variantId,
      productName: row.productName,
      sku: row.sku,
      onHandQuantity: scaledToDecimal(row.onHandScaled),
      reservedQuantity: scaledToDecimal(row.businessHeldScaled ?? row.reservedScaled),
    }));
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const warehouseId = request.nextUrl.searchParams.get('warehouseId')?.trim() ?? '';
    const warehouses = await loadWarehouses(id);

    if (!warehouseId) {
      await companyRequest<unknown>({ path: '/api/inventory/balances?limit=1&offset=0', requestId: id });
      return json({ warehouses }, id);
    }

    if (!UUID_PATTERN.test(warehouseId) || !warehouses.some((warehouse) => warehouse.id === warehouseId)) {
      throw new CompanyGatewayError('RETAIL_INVENTORY_WAREHOUSE_FORBIDDEN', 'Kho không thuộc phạm vi được phép xem.', 403, false);
    }

    const rows = aggregate(await loadBalances(id, warehouseId));
    return json({ rows }, id);
  } catch (error) {
    return errorResponse(error, id);
  }
}
