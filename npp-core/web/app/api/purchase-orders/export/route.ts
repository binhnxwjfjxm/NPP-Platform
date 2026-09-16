import { NextRequest, NextResponse } from 'next/server';
import {
  listPurchaseOrders,
  normalizePurchaseOrderGatewayError,
  resolvePurchaseOrderRequestId,
} from '../../../../lib/purchase-order-gateway';
import type { PurchaseOrder, PurchaseOrderStatus } from '../../../../lib/purchase-order-types';
import { PURCHASE_ORDER_STATUS_LABELS } from '../../../../lib/purchase-order-types';
import {
  PURCHASE_ORDER_EXPORT_DEFAULT_COLUMNS,
  isPurchaseOrderExportColumnKey,
  purchaseOrderExportHeaders,
  purchaseOrderExportRow,
  type PurchaseOrderExportColumnKey,
} from '../../../../lib/purchase-order-export-model';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularXlsx,
  tabularXlsxErrorMessage,
} from '../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 1000;
const MAX_EXPORT_ROWS = Math.min(2000, TABULAR_XLSX_LIMITS.maxRows - 1);
const MAX_SCAN_ROWS = 10000;
const VALID_STATUSES = new Set(Object.keys(PURCHASE_ORDER_STATUS_LABELS));

type ExportFormat = 'xlsx' | 'csv';

class PurchaseOrderExportError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly statusCode = 400,
    readonly retryable = false,
  ) {
    super(publicMessage);
    this.name = 'PurchaseOrderExportError';
  }
}

function parseFormat(value: string | null): ExportFormat {
  const format = (value || 'xlsx').trim().toLowerCase();
  if (format === 'xlsx' || format === 'csv') return format;
  throw new PurchaseOrderExportError('PURCHASE_ORDER_EXPORT_FORMAT_INVALID', 'Định dạng file không hợp lệ.');
}

function parseStatus(value: string | null): PurchaseOrderStatus | undefined {
  const status = String(value ?? '').trim();
  if (!status || status === 'all') return undefined;
  if (!VALID_STATUSES.has(status)) {
    throw new PurchaseOrderExportError('PURCHASE_ORDER_EXPORT_STATUS_INVALID', 'Trạng thái đơn mua hàng không hợp lệ.');
  }
  return status as PurchaseOrderStatus;
}

function parseSearch(value: string | null): string {
  const search = String(value ?? '').trim();
  if (search.length > 256) {
    throw new PurchaseOrderExportError('PURCHASE_ORDER_EXPORT_SEARCH_INVALID', 'Từ khóa tìm kiếm không được vượt quá 256 ký tự.');
  }
  return search;
}

function parseColumns(searchParams: URLSearchParams): readonly PurchaseOrderExportColumnKey[] {
  const requested = searchParams.getAll('column').map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) return PURCHASE_ORDER_EXPORT_DEFAULT_COLUMNS;
  if (requested.some((value) => !isPurchaseOrderExportColumnKey(value))) {
    throw new PurchaseOrderExportError('PURCHASE_ORDER_EXPORT_COLUMN_INVALID', 'Có cột xuất dữ liệu không hợp lệ.');
  }
  const unique = [...new Set(requested)] as PurchaseOrderExportColumnKey[];
  if (unique.length === 0) {
    throw new PurchaseOrderExportError('PURCHASE_ORDER_EXPORT_COLUMN_REQUIRED', 'Vui lòng chọn ít nhất một cột để xuất.');
  }
  return unique;
}

function matchesSearch(order: PurchaseOrder, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;
  const searchable = [
    order.number,
    order.supplierCode,
    order.supplierName,
    order.warehouseCode,
    order.warehouseName,
    order.supplierReference,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('vi-VN');
  return searchable.includes(normalizedSearch);
}

async function loadCanonicalRows(
  requestId: string,
  status: PurchaseOrderStatus | undefined,
  search: string,
): Promise<PurchaseOrder[]> {
  const normalizedSearch = search.toLocaleLowerCase('vi-VN');
  const matched: PurchaseOrder[] = [];
  let offset = 0;
  let scanned = 0;

  while (true) {
    const batch = await listPurchaseOrders<PurchaseOrder>(requestId, {
      limit: PAGE_SIZE,
      offset,
      ...(status ? { status } : {}),
    });
    scanned += batch.length;
    for (const order of batch) {
      if (matchesSearch(order, normalizedSearch)) matched.push(order);
      if (matched.length > MAX_EXPORT_ROWS) {
        throw new PurchaseOrderExportError(
          'PURCHASE_ORDER_EXPORT_ROW_LIMIT_EXCEEDED',
          `Có hơn ${MAX_EXPORT_ROWS.toLocaleString('vi-VN')} đơn phù hợp. Hãy thu hẹp trạng thái hoặc từ khóa trước khi xuất.`,
          413,
        );
      }
    }
    if (batch.length < PAGE_SIZE) break;
    offset += batch.length;
    if (scanned >= MAX_SCAN_ROWS) {
      throw new PurchaseOrderExportError(
        'PURCHASE_ORDER_EXPORT_SCAN_LIMIT_EXCEEDED',
        'Phạm vi dữ liệu quá lớn để xuất an toàn. Hãy thu hẹp trạng thái hoặc từ khóa tìm kiếm.',
        413,
      );
    }
  }

  return matched;
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

function filename(format: ExportFormat): string {
  return `Don-mua-hang-${new Date().toISOString().slice(0, 10)}.${format}`;
}

function responseHeaders(requestId: string, format: ExportFormat) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Disposition': `attachment; filename="${filename(format)}"`,
    'Content-Type': format === 'xlsx' ? TABULAR_XLSX_MIME : 'text/csv; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'x-request-id': requestId,
  };
}

export async function GET(request: NextRequest) {
  const requestId = resolvePurchaseOrderRequestId(request.headers.get('x-request-id'));
  try {
    const format = parseFormat(request.nextUrl.searchParams.get('format'));
    const status = parseStatus(request.nextUrl.searchParams.get('status'));
    const search = parseSearch(request.nextUrl.searchParams.get('search'));
    const columns = parseColumns(request.nextUrl.searchParams);
    const orders = await loadCanonicalRows(requestId, status, search);
    const headers = purchaseOrderExportHeaders(columns);
    const rows = orders.map((order) => purchaseOrderExportRow(order, columns));

    if (format === 'csv') {
      return new Response(createCsv(headers, rows), {
        status: 200,
        headers: responseHeaders(requestId, format),
      });
    }

    let workbook;
    try {
      workbook = createTabularXlsx({ sheetName: 'Đơn mua hàng', headers, rows });
    } catch (error) {
      throw new PurchaseOrderExportError(
        'PURCHASE_ORDER_EXPORT_XLSX_FAILED',
        tabularXlsxErrorMessage(error),
        400,
      );
    }
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: responseHeaders(requestId, format),
    });
  } catch (error) {
    if (error instanceof PurchaseOrderExportError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.publicMessage, retryable: error.retryable }, requestId },
        { status: error.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      );
    }
    const normalized = normalizePurchaseOrderGatewayError(error);
    return NextResponse.json(
      {
        error: {
          code: normalized.code,
          message: normalized.publicMessage,
          retryable: normalized.retryable,
          details: normalized.details,
        },
        requestId,
      },
      { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }
}
