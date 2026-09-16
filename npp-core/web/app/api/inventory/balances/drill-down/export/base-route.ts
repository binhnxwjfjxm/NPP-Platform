import { NextRequest, NextResponse } from 'next/server';
import { listInventoryBalanceDrillDown, normalizeInventoryGatewayError, resolveInventoryRequestId } from '../../../../../../lib/inventory-gateway';
import { inventoryMovementTypeLabel } from '../../../../../../lib/inventory-movement-labels';
import { withInventoryPage } from '../../../../../../lib/inventory-pagination';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularXlsx,
  tabularXlsxErrorMessage,
} from '../../../../../../lib/tabular-xlsx.js';

type MovementRow = Readonly<{
  movement_id?: string;
  movement_type: string;
  source_document_type: string | null;
  source_document_number: string | null;
  document_number: string | null;
  document_date: string | null;
  posted_at: string;
  direction: 'IN' | 'OUT';
  base_quantity_delta: string;
  lot_code: string | null;
  source_line_reference: string | null;
}>;

type Format = 'xlsx' | 'csv';
const PAGE_SIZE = 1000;
const MAX_EXPORT_ROWS = Math.min(100_000, TABULAR_XLSX_LIMITS.maxRows - 1);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCALE = 1_000_000_000_000n;
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d{1,12}))?$/;

class MovementExportError extends Error {
  constructor(readonly code: string, readonly publicMessage: string, readonly statusCode = 400) {
    super(publicMessage);
    this.name = 'MovementExportError';
  }
}

function parseFormat(value: string | null): Format {
  const normalized = String(value ?? 'xlsx').trim().toLowerCase();
  if (normalized === 'xlsx' || normalized === 'csv') return normalized;
  throw new MovementExportError('INVENTORY_MOVEMENT_EXPORT_FORMAT_INVALID', 'Định dạng file không hợp lệ.');
}

function requiredUuid(params: URLSearchParams, name: string, message: string): string {
  const value = String(params.get(name) ?? '').trim();
  if (!UUID_PATTERN.test(value)) throw new MovementExportError('INVENTORY_MOVEMENT_EXPORT_SCOPE_INVALID', message);
  return value;
}

function optionalUuid(params: URLSearchParams, name: string): string | null {
  const value = String(params.get(name) ?? '').trim();
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) throw new MovementExportError('INVENTORY_MOVEMENT_EXPORT_SCOPE_INVALID', 'Phạm vi biến động kho không hợp lệ.');
  return value;
}

function scaled(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(String(value ?? '').trim());
  if (!match) throw new MovementExportError('INVENTORY_MOVEMENT_EXPORT_QUANTITY_INVALID', 'Dữ liệu số lượng biến động kho không hợp lệ.', 502);
  const sign = match[1] === '-' ? -1n : 1n;
  return sign * (BigInt(match[2]) * SCALE + BigInt((match[3] ?? '').padEnd(12, '0')));
}

function decimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(12, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

function rowsWithStock(rows: readonly MovementRow[]) {
  let running = rows.reduce((sum, row) => sum + scaled(row.base_quantity_delta), 0n);
  return rows.map((row) => {
    const stockAfter = running;
    running -= scaled(row.base_quantity_delta);
    return [
      formatDateTime(row.posted_at),
      row.source_document_number || row.document_number || row.source_document_type || '',
      inventoryMovementTypeLabel(row.movement_type),
      row.direction === 'IN' ? 'Nhập' : 'Xuất',
      decimal(scaled(row.base_quantity_delta)),
      decimal(stockAfter),
      row.lot_code || '',
      row.source_line_reference || '',
    ];
  });
}

function guardCsvFormula(value: string): string {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function csvCell(value: string): string {
  return `"${guardCsvFormula(value).replace(/"/g, '""')}"`;
}

function createCsv(headers: readonly string[], rows: readonly string[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = resolveInventoryRequestId(request.headers.get('x-request-id'));
  try {
    const format = parseFormat(request.nextUrl.searchParams.get('format'));
    const warehouseId = requiredUuid(request.nextUrl.searchParams, 'warehouseId', 'Kho cần xuất không hợp lệ.');
    const baseVariantId = requiredUuid(request.nextUrl.searchParams, 'baseVariantId', 'SKU tồn chuẩn cần xuất không hợp lệ.');
    const locationId = optionalUuid(request.nextUrl.searchParams, 'locationId');
    const lotId = optionalUuid(request.nextUrl.searchParams, 'lotId');
    const scope = new URLSearchParams({ warehouseId, baseVariantId });
    if (locationId) scope.set('locationId', locationId);
    if (lotId) scope.set('lotId', lotId);

    const rows: MovementRow[] = [];
    let offset = 0;
    while (true) {
      const batch = await listInventoryBalanceDrillDown<MovementRow[]>(
        requestId,
        withInventoryPage(scope, { limit: PAGE_SIZE, offset }),
      );
      rows.push(...batch);
      if (rows.length > MAX_EXPORT_ROWS) {
        throw new MovementExportError(
          'INVENTORY_MOVEMENT_EXPORT_TOO_LARGE',
          'Biến động kho vượt giới hạn xuất file. Hãy thu hẹp phạm vi lô hoặc vị trí trước khi xuất.',
          413,
        );
      }
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (offset > MAX_EXPORT_ROWS) {
        throw new MovementExportError(
          'INVENTORY_MOVEMENT_EXPORT_TOO_LARGE',
          'Biến động kho vượt giới hạn xuất file. Hãy thu hẹp phạm vi lô hoặc vị trí trước khi xuất.',
          413,
        );
      }
    }

    const headers = ['Thời gian', 'Chứng từ', 'Loại nghiệp vụ', 'Chiều', 'Biến động', 'Tồn sau', 'Mã lô', 'Tham chiếu dòng'];
    const data = rowsWithStock(rows);
    const filename = `Bien-dong-kho-${new Date().toISOString().slice(0, 10)}.${format}`;
    const headersOut = {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': format === 'xlsx' ? TABULAR_XLSX_MIME : 'text/csv; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'x-request-id': requestId,
    };
    if (format === 'csv') return new Response(createCsv(headers, data), { status: 200, headers: headersOut });

    let workbook;
    try {
      workbook = createTabularXlsx({ sheetName: 'Biến động kho', headers, rows: data });
    } catch (error) {
      throw new MovementExportError('INVENTORY_MOVEMENT_EXPORT_XLSX_FAILED', tabularXlsxErrorMessage(error));
    }
    return new Response(new Uint8Array(workbook), { status: 200, headers: headersOut });
  } catch (error) {
    if (error instanceof MovementExportError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.publicMessage, retryable: false }, requestId },
        { status: error.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      );
    }
    const normalized = normalizeInventoryGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
      { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }
}
