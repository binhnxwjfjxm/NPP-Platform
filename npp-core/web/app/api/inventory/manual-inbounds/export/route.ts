import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeManualInboundOperatorGatewayError,
  resolveManualInboundOperatorRequestId,
  searchManualInboundOperatorHistory,
} from '../../../../../lib/manual-inbound-operator-gateway';
import {
  MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS,
  isManualInboundExportColumnKey,
  isManualInboundExportType,
  manualInboundExportHeaders,
  manualInboundExportRow,
  type ManualInboundExportColumnKey,
  type ManualInboundExportDocument,
  type ManualInboundExportType,
} from '../../../../../lib/manual-inbound-export-model';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularXlsx,
  tabularXlsxErrorMessage,
} from '../../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = Math.min(2000, TABULAR_XLSX_LIMITS.maxRows - 1);
const MAX_SCAN_ROWS = 5000;

type ExportFormat = 'xlsx' | 'csv';

class ManualInboundExportError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly statusCode = 400,
    readonly retryable = false,
  ) {
    super(publicMessage);
    this.name = 'ManualInboundExportError';
  }
}

function parseFormat(value: string | null): ExportFormat {
  const format = (value || 'xlsx').trim().toLowerCase();
  if (format === 'xlsx' || format === 'csv') return format;
  throw new ManualInboundExportError('MANUAL_INBOUND_EXPORT_FORMAT_INVALID', 'Định dạng file không hợp lệ.');
}

function parseInboundType(value: string | null): ManualInboundExportType | undefined {
  const inboundType = String(value ?? '').trim();
  if (!inboundType) return undefined;
  if (!isManualInboundExportType(inboundType)) {
    throw new ManualInboundExportError('MANUAL_INBOUND_EXPORT_TYPE_INVALID', 'Loại nhập kho không hợp lệ.');
  }
  return inboundType;
}

function parseReferenceNumber(value: string | null): string {
  const referenceNumber = String(value ?? '').trim();
  if (referenceNumber.length > 160) {
    throw new ManualInboundExportError(
      'MANUAL_INBOUND_EXPORT_REFERENCE_INVALID',
      'Số chứng từ tham chiếu không được vượt quá 160 ký tự.',
    );
  }
  return referenceNumber;
}

function parseColumns(searchParams: URLSearchParams): readonly ManualInboundExportColumnKey[] {
  const requested = searchParams.getAll('column').map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) return MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS;
  if (requested.some((value) => !isManualInboundExportColumnKey(value))) {
    throw new ManualInboundExportError('MANUAL_INBOUND_EXPORT_COLUMN_INVALID', 'Có cột xuất dữ liệu không hợp lệ.');
  }
  const unique = [...new Set(requested)] as ManualInboundExportColumnKey[];
  if (unique.length === 0) {
    throw new ManualInboundExportError('MANUAL_INBOUND_EXPORT_COLUMN_REQUIRED', 'Vui lòng chọn ít nhất một cột để xuất.');
  }
  return unique;
}

async function loadCanonicalRows(
  requestId: string,
  inboundType: ManualInboundExportType | undefined,
  referenceNumber: string,
): Promise<ManualInboundExportDocument[]> {
  const rows: ManualInboundExportDocument[] = [];
  let offset = 0;
  let scanned = 0;

  while (true) {
    const batch = await searchManualInboundOperatorHistory<ManualInboundExportDocument[]>({
      inboundType,
      referenceNumber,
      limit: PAGE_SIZE,
      offset,
      requestId,
    });
    scanned += batch.length;
    rows.push(...batch);
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new ManualInboundExportError(
        'MANUAL_INBOUND_EXPORT_ROW_LIMIT_EXCEEDED',
        `Có hơn ${MAX_EXPORT_ROWS.toLocaleString('vi-VN')} chứng từ phù hợp. Hãy thu hẹp loại nhập hoặc số chứng từ tham chiếu trước khi xuất.`,
        413,
      );
    }
    if (batch.length < PAGE_SIZE) break;
    offset += batch.length;
    if (scanned >= MAX_SCAN_ROWS) {
      throw new ManualInboundExportError(
        'MANUAL_INBOUND_EXPORT_SCAN_LIMIT_EXCEEDED',
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
  return `Nhap-kho-thu-cong-${new Date().toISOString().slice(0, 10)}.${format}`;
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
  const requestId = resolveManualInboundOperatorRequestId(request.headers.get('x-request-id'));
  try {
    const format = parseFormat(request.nextUrl.searchParams.get('format'));
    const inboundType = parseInboundType(request.nextUrl.searchParams.get('inboundType'));
    const referenceNumber = parseReferenceNumber(request.nextUrl.searchParams.get('referenceNumber'));
    const columns = parseColumns(request.nextUrl.searchParams);
    const documents = await loadCanonicalRows(requestId, inboundType, referenceNumber);
    const headers = manualInboundExportHeaders(columns);
    const rows = documents.map((document) => manualInboundExportRow(document, columns));

    if (format === 'csv') {
      return new Response(createCsv(headers, rows), {
        status: 200,
        headers: responseHeaders(requestId, format),
      });
    }

    let workbook;
    try {
      workbook = createTabularXlsx({ sheetName: 'Nhập kho thủ công', headers, rows });
    } catch (error) {
      throw new ManualInboundExportError(
        'MANUAL_INBOUND_EXPORT_XLSX_FAILED',
        tabularXlsxErrorMessage(error),
        400,
      );
    }
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: responseHeaders(requestId, format),
    });
  } catch (error) {
    if (error instanceof ManualInboundExportError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.publicMessage, retryable: error.retryable }, requestId },
        { status: error.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      );
    }
    const normalized = normalizeManualInboundOperatorGatewayError(error);
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
