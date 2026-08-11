import { NextRequest } from 'next/server';
import {
  TABULAR_XLSX_LIMITS,
  TABULAR_XLSX_MIME,
  createTabularXlsx,
  parseTabularXlsx,
  tabularXlsxErrorMessage,
} from '../../../../lib/tabular-xlsx.js';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, status = 400) {
  return Response.json({
    error: {
      code: status === 413 ? 'TABULAR_XLSX_TOO_LARGE' : 'TABULAR_XLSX_INVALID',
      message: tabularXlsxErrorMessage(error),
      retryable: false,
    },
  }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as { sheetName?: string; headers?: unknown; rows?: unknown };
    if (!Array.isArray(payload.headers) || !Array.isArray(payload.rows)) throw new Error('XLSX_HEADER_INVALID');
    const workbook = createTabularXlsx({
      sheetName: payload.sheetName,
      headers: payload.headers.map((value) => String(value ?? '')),
      rows: payload.rows as Array<Array<string | number | boolean | null | undefined>>,
    });
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        'Content-Type': TABULAR_XLSX_MIME,
        'Content-Disposition': 'attachment; filename="data-exchange.xlsx"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > TABULAR_XLSX_LIMITS.maxFileBytes) {
    return errorResponse(new Error('XLSX_FILE_SIZE_INVALID'), 413);
  }
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > TABULAR_XLSX_LIMITS.maxFileBytes) return errorResponse(new Error('XLSX_FILE_SIZE_INVALID'), 413);
    return Response.json({ data: { rows: parseTabularXlsx(bytes) } }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    const status = error instanceof Error && error.message === 'XLSX_FILE_SIZE_INVALID' ? 413 : 400;
    return errorResponse(error, status);
  }
}
