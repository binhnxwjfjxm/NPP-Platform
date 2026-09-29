import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeInventoryGatewayError,
  resolveInventoryRequestId,
} from '../../../../lib/inventory-gateway';
import {
  listAllInventoryBalances,
  listAllInventoryLots,
  listAllInventoryTrackingPolicies,
} from '../../../../lib/inventory-list-loaders';
import { listInventoryTrackingPolicyCandidates } from '../../../../lib/inventory-policy-candidates';
import {
  INVENTORY_EXPORT_DEFAULT_COLUMNS,
  INVENTORY_EXPORT_SCOPE_LABELS,
  inventoryBalanceExportRow,
  inventoryExportHeaders,
  inventoryLotExportRow,
  inventoryPolicyExportRow,
  isDisplayableInventoryBalance,
  isInventoryExportColumn,
  isInventoryExportScope,
  matchesInventoryBalanceExport,
  matchesInventoryLotExport,
  matchesInventoryPolicyExport,
  type InventoryExportFormat,
  type InventoryExportScope,
  type InventoryPolicyExportRecord,
} from '../../../../lib/inventory-data-export-model';
import type { InventoryTrackingPolicy } from '../../../../lib/inventory-types';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularXlsx,
  tabularXlsxErrorMessage,
} from '../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_EXPORT_ROWS = Math.min(10_000, TABULAR_XLSX_LIMITS.maxRows - 1);
const MAX_SEARCH_LENGTH = 128;

class InventoryDataExportError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly statusCode = 400,
    readonly retryable = false,
  ) {
    super(publicMessage);
    this.name = 'InventoryDataExportError';
  }
}

function parseFormat(value: string | null): InventoryExportFormat {
  const normalized = String(value ?? 'xlsx').trim().toLowerCase();
  if (normalized === 'xlsx' || normalized === 'csv') return normalized;
  throw new InventoryDataExportError('INVENTORY_EXPORT_FORMAT_INVALID', 'Định dạng file không hợp lệ.');
}

function parseScope(value: string | null): InventoryExportScope {
  const normalized = String(value ?? '').trim();
  if (isInventoryExportScope(normalized)) return normalized;
  throw new InventoryDataExportError('INVENTORY_EXPORT_SCOPE_INVALID', 'Nội dung xuất dữ liệu không hợp lệ.');
}

function parseSearch(value: string | null): string {
  const search = String(value ?? '').trim();
  if (search.length > MAX_SEARCH_LENGTH) {
    throw new InventoryDataExportError('INVENTORY_EXPORT_SEARCH_TOO_LONG', `Nội dung tìm kiếm tối đa ${MAX_SEARCH_LENGTH} ký tự.`);
  }
  return search;
}

function parseColumns(searchParams: URLSearchParams, scope: InventoryExportScope): readonly string[] {
  const requested = searchParams.getAll('column').map((value) => value.trim()).filter(Boolean);
  const columns = requested.length ? requested : [...INVENTORY_EXPORT_DEFAULT_COLUMNS[scope]];
  if (columns.some((value) => !isInventoryExportColumn(scope, value))) {
    throw new InventoryDataExportError('INVENTORY_EXPORT_COLUMN_INVALID', 'Có cột xuất dữ liệu không hợp lệ.');
  }
  const unique = [...new Set(columns)];
  if (!unique.length) {
    throw new InventoryDataExportError('INVENTORY_EXPORT_COLUMN_REQUIRED', 'Vui lòng chọn ít nhất một cột để xuất.');
  }
  return unique;
}

function ensureRowLimit(rowCount: number) {
  if (rowCount > MAX_EXPORT_ROWS) {
    throw new InventoryDataExportError(
      'INVENTORY_EXPORT_ROW_LIMIT_EXCEEDED',
      `Có hơn ${MAX_EXPORT_ROWS.toLocaleString('vi-VN')} dòng phù hợp. Hãy thu hẹp nội dung tìm kiếm trước khi xuất.`,
      413,
    );
  }
}

async function loadRows(scope: InventoryExportScope, requestId: string, search: string, columns: readonly string[]): Promise<string[][]> {
  if (scope === 'balances') {
    const rows = (await listAllInventoryBalances(requestId))
      .filter(isDisplayableInventoryBalance)
      .filter((row) => matchesInventoryBalanceExport(row, search));
    ensureRowLimit(rows.length);
    return rows.map((row) => inventoryBalanceExportRow(row, columns));
  }

  if (scope === 'lots') {
    const rows = (await listAllInventoryLots(requestId))
      .filter((row) => matchesInventoryLotExport(row, search));
    ensureRowLimit(rows.length);
    return rows.map((row) => inventoryLotExportRow(row, columns));
  }

  const [candidates, policies] = await Promise.all([
    listInventoryTrackingPolicyCandidates(requestId),
    listAllInventoryTrackingPolicies(requestId),
  ]);
  const policyByVariantId = new Map<string, InventoryTrackingPolicy>(
    policies.map((policy) => [policy.base_variant_id, policy]),
  );
  const rows: InventoryPolicyExportRecord[] = candidates
    .map((candidate) => ({ candidate, policy: policyByVariantId.get(candidate.base_variant_id) ?? null }))
    .filter((row) => matchesInventoryPolicyExport(row, search));
  ensureRowLimit(rows.length);
  return rows.map((row) => inventoryPolicyExportRow(row, columns));
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

function fileStem(scope: InventoryExportScope): string {
  if (scope === 'balances') return 'Ton-kho';
  if (scope === 'lots') return 'Lo-hang';
  return 'Chinh-sach-lo';
}

function filename(scope: InventoryExportScope, format: InventoryExportFormat): string {
  return `${fileStem(scope)}-${new Date().toISOString().slice(0, 10)}.${format}`;
}

function responseHeaders(requestId: string, scope: InventoryExportScope, format: InventoryExportFormat) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Disposition': `attachment; filename="${filename(scope, format)}"`,
    'Content-Type': format === 'xlsx' ? TABULAR_XLSX_MIME : 'text/csv; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'x-request-id': requestId,
  };
}

export async function GET(request: NextRequest) {
  const requestId = resolveInventoryRequestId(request.headers.get('x-request-id'));
  try {
    const scope = parseScope(request.nextUrl.searchParams.get('scope'));
    const format = parseFormat(request.nextUrl.searchParams.get('format'));
    const search = parseSearch(request.nextUrl.searchParams.get('search'));
    const columns = parseColumns(request.nextUrl.searchParams, scope);
    const headers = inventoryExportHeaders(scope, columns);
    const rows = await loadRows(scope, requestId, search, columns);

    if (format === 'csv') {
      return new Response(createCsv(headers, rows), {
        status: 200,
        headers: responseHeaders(requestId, scope, format),
      });
    }

    let workbook;
    try {
      workbook = createTabularXlsx({ sheetName: INVENTORY_EXPORT_SCOPE_LABELS[scope], headers, rows });
    } catch (error) {
      throw new InventoryDataExportError('INVENTORY_EXPORT_XLSX_FAILED', tabularXlsxErrorMessage(error));
    }
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: responseHeaders(requestId, scope, format),
    });
  } catch (error) {
    if (error instanceof InventoryDataExportError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.publicMessage, retryable: error.retryable }, requestId },
        { status: error.statusCode, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
      );
    }
    const normalized = normalizeInventoryGatewayError(error);
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
