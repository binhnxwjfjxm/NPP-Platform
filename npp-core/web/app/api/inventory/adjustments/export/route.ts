import { NextRequest, NextResponse } from 'next/server';
import {
  listInventoryAdjustments,
  normalizeInventoryAdjustmentGatewayError,
  resolveInventoryAdjustmentRequestId,
} from '../../../../../lib/inventory-adjustment-gateway';
import {
  INVENTORY_ADJUSTMENT_EXPORT_DEFAULT_COLUMNS,
  inventoryAdjustmentExportHeaders,
  inventoryAdjustmentExportRow,
  isInventoryAdjustmentExportColumnKey,
  isInventoryAdjustmentKind,
  isInventoryAdjustmentStatus,
  type InventoryAdjustmentExportColumnKey,
} from '../../../../../lib/inventory-adjustment-export-model';
import type { InventoryAdjustment } from '../../../../../lib/inventory-adjustment-types';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularXlsx,
  tabularXlsxErrorMessage,
} from '../../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = Math.min(2000, TABULAR_XLSX_LIMITS.maxRows - 1);
const MAX_SCAN_ROWS = 5000;

type ExportFormat = 'xlsx' | 'csv';

class InventoryAdjustmentExportError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly statusCode = 400,
    readonly retryable = false,
  ) {
    super(publicMessage);
    this.name = 'InventoryAdjustmentExportError';
  }
}

function parseFormat(value: string | null): ExportFormat {
  const format = String(value ?? 'xlsx').trim().toLowerCase();
  if (format === 'xlsx' || format === 'csv') return format;
  throw new InventoryAdjustmentExportError('INVENTORY_ADJUSTMENT_EXPORT_FORMAT_INVALID', 'Định dạng file không hợp lệ.');
}

function parseStatus(value: string | null): string {
  const status = String(value ?? '').trim().toUpperCase();
  if (!status) return '';
  if (!isInventoryAdjustmentStatus(status)) {
    throw new InventoryAdjustmentExportError('INVENTORY_ADJUSTMENT_EXPORT_STATUS_INVALID', 'Trạng thái phiếu không hợp lệ.');
  }
  return status;
}

function parseDocumentKind(value: string | null): string {
  const documentKind = String(value ?? '').trim().toUpperCase();
  if (!documentKind) return '';
  if (!isInventoryAdjustmentKind(documentKind)) {
    throw new InventoryAdjustmentExportError('INVENTORY_ADJUSTMENT_EXPORT_KIND_INVALID', 'Loại phiếu không hợp lệ.');
  }
  return documentKind;
}

function parseColumns(searchParams: URLSearchParams): readonly InventoryAdjustmentExportColumnKey[] {
  const requested = searchParams.getAll('column').map((value) => value.trim()).filter(Boolean);
  if (!requested.length) return INVENTORY_ADJUSTMENT_EXPORT_DEFAULT_COLUMNS;
  if (requested.some((value) => !isInventoryAdjustmentExportColumnKey(value))) {
    throw new InventoryAdjustmentExportError('INVENTORY_ADJUSTMENT_EXPORT_COLUMN_INVALID', 'Có cột xuất dữ liệu không hợp lệ.');
  }
  const unique = [...new Set(requested)] as InventoryAdjustmentExportColumnKey[];
  if (!unique.length) {
    throw new InventoryAdjustmentExportError('INVENTORY_ADJUSTMENT_EXPORT_COLUMN_REQUIRED', 'Vui lòng chọn ít nhất một cột để xuất.');
  }
  return unique;
}

async function loadCanonicalRows(requestId: string, status: string, documentKind: string): Promise<InventoryAdjustment[]> {
  const rows: InventoryAdjustment[] = [];
  let offset = 0;
  let scanned = 0;

  while (true) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (status) params.set('status', status);
    if (documentKind) params.set('documentKind', documentKind);
    const batch = await listInventoryAdjustments<InventoryAdjustment[]>(requestId, params);
    scanned += batch.length;
    rows.push(...batch);

    if (rows.length > MAX_EXPORT_ROWS) {
      throw new InventoryAdjustmentExportError(
        'INVENTORY_ADJUSTMENT_EXPORT_ROW_LIMIT_EXCEEDED',
        `Có hơn ${MAX_EXPORT_ROWS.toLocaleString('vi-VN')} phiếu phù hợp. Hãy thu hẹp Trạng thái hoặc Loại phiếu trước khi xuất.`,
        413,
      );
    }
    if (batch.length < PAGE_SIZE) break;
    offset += batch.length;
    if (scanned >= MAX_SCAN_ROWS) {
      throw new InventoryAdjustmentExportError(
        'INVENTORY_ADJUSTMENT_EXPORT_SCAN_LIMIT_EXCEEDED',
        'Phạm vi dữ liệu quá lớn để xuất an toàn. Hãy thu hẹp bộ lọc trước khi xuất.',
        413,
      );
    }
  }
  return rows;
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
  return `Dieu-chinh-ton-${new Date().toISOString().slice(0, 10)}.${format}`;
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
  const requestId = resolveInventoryAdjustmentRequestId(request.headers.get('x-request-id'));
  try {
    const format = parseFormat(request.nextUrl.searchParams.get('format'));
    const status = parseStatus(request.nextUrl.searchParams.get('status'));
    const documentKind = parseDocumentKind(request.nextUrl.searchParams.get('documentKind'));
    const columns = parseColumns(request.nextUrl.searchParams);
    const documents = await loadCanonicalRows(requestId, status, documentKind);
    const headers = inventoryAdjustmentExportHeaders(columns);
    const rows = documents.map((document) => inventoryAdjustmentExportRow(document, columns));

    if (format === 'csv') {
      return new Response(createCsv(headers, rows), {
        status: 200,
        headers: responseHeaders(requestId, format),
      });
    }

    let workbook;
    try {
      workbook = createTabularXlsx({ sheetName: 'Điều chỉnh tồn', headers, rows });
    } catch (error) {
      throw new InventoryAdjustmentExportError(
        'INVENTORY_ADJUSTMENT_EXPORT_XLSX_FAILED',
        tabularXlsxErrorMessage(error),
      );
    }
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: responseHeaders(requestId, format),
    });
  } catch (error) {
    if (error instanceof InventoryAdjustmentExportError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.publicMessage, retryable: error.retryable }, requestId },
        { status: error.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      );
    }
    const normalized = normalizeInventoryAdjustmentGatewayError(error);
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
