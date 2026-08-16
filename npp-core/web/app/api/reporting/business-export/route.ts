import { NextRequest, NextResponse } from 'next/server';
import {
  getBusinessDataExport,
  normalizeBusinessDataExportGatewayError,
  resolveBusinessDataExportRequestId,
} from '../../../../lib/business-data-export-gateway';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = resolveBusinessDataExportRequestId(request.headers.get('x-request-id'));
  try {
    const response = await getBusinessDataExport(requestId);
    return new Response(response.body, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': response.headers.get('content-type')
          ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': response.headers.get('content-disposition')
          ?? 'attachment; filename="So-lieu-doanh-nghiep.xlsx"',
        ...(response.headers.get('content-length')
          ? { 'Content-Length': response.headers.get('content-length') as string }
          : {}),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const normalized = normalizeBusinessDataExportGatewayError(error);
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
