import { NextRequest, NextResponse } from 'next/server';
import {
  getSalesReportingExport,
  normalizeSalesReportingExportGatewayError,
  resolveSalesReportingExportRequestId,
} from '../../../../../lib/sales-reporting-export-gateway';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = resolveSalesReportingExportRequestId(request.headers.get('x-request-id'));
  try {
    const response = await getSalesReportingExport(requestId, request.nextUrl.searchParams);
    const headers = new Headers({
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': response.headers.get('content-type')
        ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': response.headers.get('content-disposition')
        ?? 'attachment; filename="Bao-cao-ban-hang.xlsx"',
      'X-Content-Type-Options': 'nosniff',
    });
    const length = response.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    const normalized = normalizeSalesReportingExportGatewayError(error);
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
      {
        status: normalized.statusCode,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
