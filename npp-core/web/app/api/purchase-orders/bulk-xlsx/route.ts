import {
  PURCHASE_ORDER_XLSX_LIMITS,
  parsePurchaseOrderXlsx,
  purchaseOrderXlsxErrorMessage,
} from '../../../../lib/purchase-order-xlsx.js';

export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: number) {
  return Response.json({
    error: {
      code: status === 413 ? 'PURCHASE_ORDER_XLSX_TOO_LARGE' : 'PURCHASE_ORDER_XLSX_INVALID',
      message,
      retryable: false,
    },
  }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > PURCHASE_ORDER_XLSX_LIMITS.maxFileBytes) {
    return errorResponse('Tệp XLSX không được vượt quá 2 MB.', 413);
  }

  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > PURCHASE_ORDER_XLSX_LIMITS.maxFileBytes) {
      return errorResponse('Tệp XLSX không được vượt quá 2 MB.', 413);
    }
    const text = parsePurchaseOrderXlsx(bytes);
    return Response.json({ data: { text } }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof Error && error.message === 'XLSX_FILE_SIZE_INVALID' ? 413 : 400;
    return errorResponse(purchaseOrderXlsxErrorMessage(error), status);
  }
}
