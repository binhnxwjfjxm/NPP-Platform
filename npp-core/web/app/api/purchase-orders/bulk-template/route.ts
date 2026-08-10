import {
  PURCHASE_ORDER_XLSX_FILENAME,
  PURCHASE_ORDER_XLSX_MIME,
  createPurchaseOrderXlsxTemplate,
} from '../../../../lib/purchase-order-xlsx.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const workbook = createPurchaseOrderXlsxTemplate();
  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      'Content-Type': PURCHASE_ORDER_XLSX_MIME,
      'Content-Disposition': `attachment; filename="${PURCHASE_ORDER_XLSX_FILENAME}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
