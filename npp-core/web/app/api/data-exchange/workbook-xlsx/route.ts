import { NextRequest } from 'next/server';
import {
  TABULAR_WORKBOOK_XLSX_MIME,
  createTabularWorkbookXlsx,
  workbookXlsxErrorMessage,
} from '../../../../lib/tabular-workbook-xlsx.js';

export const dynamic = 'force-dynamic';

type SheetPayload = { sheetName?: unknown; headers?: unknown; rows?: unknown };

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as { sheets?: unknown };
    if (!Array.isArray(payload.sheets)) throw new Error('WORKBOOK_SHEET_INVALID');
    const sheets = payload.sheets.map((sheet) => {
      if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) throw new Error('WORKBOOK_SHEET_INVALID');
      const value = sheet as SheetPayload;
      if (!Array.isArray(value.headers) || !Array.isArray(value.rows)) throw new Error('WORKBOOK_SHEET_INVALID');
      return {
        sheetName: value.sheetName === undefined ? undefined : String(value.sheetName ?? ''),
        headers: value.headers.map((item) => String(item ?? '')),
        rows: value.rows as Array<Array<string | number | boolean | null | undefined>>,
      };
    });
    const workbook = createTabularWorkbookXlsx(sheets);
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        'Content-Type': TABULAR_WORKBOOK_XLSX_MIME,
        'Content-Disposition': 'attachment; filename="data-exchange-workbook.xlsx"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json({
      error: { code: 'TABULAR_WORKBOOK_XLSX_INVALID', message: workbookXlsxErrorMessage(error), retryable: false },
    }, { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
}
