import { CoreDownloadError, requestCoreReportDownload } from '../../../lib/core-download';

const REPORTS = new Set(['executive', 'sales-profit', 'debt', 'inventory', 'delivery-cod', 'mcp', 'people', 'decisions']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const report = String(incoming.searchParams.get('report') ?? '').trim();
  if (!REPORTS.has(report)) return Response.json({ error: { message: 'Nhóm báo cáo không hợp lệ' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

  const query = new URLSearchParams({ report });
  if (report !== 'debt') {
    const from = String(incoming.searchParams.get('from') ?? '').trim();
    const to = String(incoming.searchParams.get('to') ?? '').trim();
    if (!DATE.test(from) || !DATE.test(to)) return Response.json({ error: { message: 'Phạm vi thời gian không hợp lệ' } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    query.set('from', from); query.set('to', to);
  }
  const warehouseId = String(incoming.searchParams.get('warehouseId') ?? '').trim();
  if (warehouseId) query.set('warehouseId', warehouseId);

  try {
    const upstream = await requestCoreReportDownload(`/api/reporting/management-export?${query.toString()}`);
    const headers = new Headers({
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': upstream.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': upstream.headers.get('content-disposition') || 'attachment; filename="Bao-cao-quan-tri.xlsx"',
      'X-Content-Type-Options': 'nosniff',
    });
    const length = upstream.headers.get('content-length'); if (length) headers.set('Content-Length', length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const status = error instanceof CoreDownloadError ? error.statusCode : 503;
    const message = error instanceof CoreDownloadError ? error.publicMessage : 'Không xuất được báo cáo quản trị';
    return Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
