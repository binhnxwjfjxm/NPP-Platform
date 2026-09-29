import { NextRequest, NextResponse } from 'next/server';
import {
  listInventoryBalanceHistory,
  normalizeInventoryGatewayError,
  resolveInventoryRequestId,
} from '../../../../../../lib/inventory-gateway';
import { inventoryMovementTypeLabel } from '../../../../../../lib/inventory-movement-labels';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularWorkbookXlsx,
  tabularXlsxErrorMessage,
} from '../../../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const MAX_SKUS = 20;
const MAX_ROWS_PER_SKU = TABULAR_XLSX_LIMITS.maxRows - 1;

type HistoryRow = Readonly<{
  movement_id: string;
  movement_type: string;
  source_document_type: string | null;
  source_document_number: string | null;
  document_number: string | null;
  posted_at: string;
  posted_by_name: string | null;
  base_quantity_delta: string;
  stock_after: string;
  warehouse_code: string;
  warehouse_name: string;
  location_summary: string | null;
  lot_summary: string | null;
  customer_code: string | null;
  customer_name: string | null;
  sales_order_number: string | null;
}>;

class HistoryExportError extends Error {
  constructor(readonly code: string, readonly publicMessage: string, readonly statusCode = 400) {
    super(publicMessage);
    this.name = 'HistoryExportError';
  }
}

function documentTypeLabel(value: string | null): string {
  const labels: Record<string, string> = {
    SALES_ORDER: 'Đơn bán hàng',
    DELIVERY_ORDER: 'Phiếu giao hàng',
    PURCHASE_RECEIPT: 'Phiếu nhận hàng',
    SUPPLIER_RETURN: 'Phiếu trả nhà cung cấp',
    INVENTORY_TRANSFER: 'Phiếu chuyển kho',
    INVENTORY_TRANSFER_RECEIPT: 'Phiếu nhận chuyển kho',
    INVENTORY_ADJUSTMENT: 'Phiếu điều chỉnh tồn',
    OPENING_BALANCE_IMPORT: 'Thiết lập tồn đầu kỳ',
    MANUAL_INBOUND: 'Phiếu nhập kho',
    STOCKTAKE: 'Phiếu kiểm kê',
    INVENTORY_REVERSAL: 'Phiếu hoàn tác kho',
    CUSTOMER_RETURN: 'Phiếu khách trả hàng',
  };
  return value ? labels[value] ?? 'Chứng từ kho' : 'Chứng từ kho';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

function parseItems(params: URLSearchParams) {
  const warehouseId = String(params.get('warehouseId') ?? '').trim();
  if (!UUID_PATTERN.test(warehouseId)) throw new HistoryExportError('INVENTORY_HISTORY_EXPORT_WAREHOUSE_INVALID', 'Kho cần xuất không hợp lệ.');
  const ids = params.getAll('baseVariantId').map((value) => value.trim());
  const skus = params.getAll('sku').map((value) => value.trim());
  if (!ids.length || ids.length !== skus.length || ids.length > MAX_SKUS) {
    throw new HistoryExportError('INVENTORY_HISTORY_EXPORT_ITEMS_INVALID', 'Danh sách mã hàng cần xuất không hợp lệ.');
  }
  const seen = new Set<string>();
  const items = ids.map((baseVariantId, index) => {
    if (!UUID_PATTERN.test(baseVariantId) || !skus[index] || skus[index].length > 96) {
      throw new HistoryExportError('INVENTORY_HISTORY_EXPORT_ITEMS_INVALID', 'Danh sách mã hàng cần xuất không hợp lệ.');
    }
    if (seen.has(baseVariantId)) throw new HistoryExportError('INVENTORY_HISTORY_EXPORT_ITEMS_DUPLICATE', 'Danh sách mã hàng đang bị trùng.');
    seen.add(baseVariantId);
    return { baseVariantId, sku: skus[index] };
  });
  return { warehouseId, items };
}

async function loadHistory(requestId: string, warehouseId: string, baseVariantId: string): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      warehouseId,
      baseVariantId,
      scope: 'warehouse',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const batch = await listInventoryBalanceHistory<HistoryRow[]>(requestId, params);
    rows.push(...batch);
    if (rows.length > MAX_ROWS_PER_SKU) {
      throw new HistoryExportError(
        'INVENTORY_HISTORY_EXPORT_TOO_LARGE',
        'Một mã hàng có quá nhiều lịch sử để xuất trong một sheet. Hãy thu hẹp giai đoạn cần đối chiếu.',
        413,
      );
    }
    if (batch.length < PAGE_SIZE) return rows;
    offset += PAGE_SIZE;
  }
}

function rowValues(sku: string, row: HistoryRow): string[] {
  const documentNumber = row.source_document_number || row.document_number || '';
  return [
    formatDateTime(row.posted_at),
    sku,
    row.customer_name || '',
    row.customer_code || '',
    row.sales_order_number || '',
    documentNumber,
    documentTypeLabel(row.source_document_type),
    inventoryMovementTypeLabel(row.movement_type),
    row.base_quantity_delta,
    row.stock_after,
    row.posted_by_name || 'Hệ thống',
    [row.warehouse_code, row.warehouse_name].filter(Boolean).join(' · '),
    row.location_summary || '',
    row.lot_summary || '',
  ];
}

export async function GET(request: NextRequest) {
  const requestId = resolveInventoryRequestId(request.headers.get('x-request-id'));
  try {
    const { warehouseId, items } = parseItems(request.nextUrl.searchParams);
    const headers = ['Ngày ghi nhận', 'SKU', 'Khách hàng', 'Mã khách hàng', 'Đơn bán hàng', 'Mã chứng từ', 'Loại chứng từ', 'Thao tác', 'Số lượng thay đổi', 'Tồn kho', 'Nhân viên', 'Kho', 'Vị trí', 'Lô'];
    const sheets = [];
    for (const item of items) {
      const history = await loadHistory(requestId, warehouseId, item.baseVariantId);
      sheets.push({ sheetName: item.sku, headers, rows: history.map((row) => rowValues(item.sku, row)) });
    }
    let workbook;
    try {
      workbook = createTabularWorkbookXlsx(sheets);
    } catch (error) {
      throw new HistoryExportError('INVENTORY_HISTORY_EXPORT_XLSX_FAILED', tabularXlsxErrorMessage(error));
    }
    const filename = 'Lich-su-kho-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
        'Content-Type': TABULAR_XLSX_MIME,
        'X-Content-Type-Options': 'nosniff',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    if (error instanceof HistoryExportError) {
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
