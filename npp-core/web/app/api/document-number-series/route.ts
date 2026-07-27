import { NextRequest } from 'next/server';
import { createDocumentNumberSeries, listDocumentNumberSeries } from '../../../lib/document-numbering-gateway';
import { documentNumberingBody, documentNumberingError, documentNumberingRequestId, documentNumberingSuccess } from '../../../lib/document-numbering-route';

export async function GET(request: NextRequest) {
  const requestId = documentNumberingRequestId(request);
  try {
    const data = await listDocumentNumberSeries(requestId, request.nextUrl.searchParams);
    return documentNumberingSuccess(data, requestId);
  } catch (error) {
    return documentNumberingError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = documentNumberingRequestId(request);
  const parsed = await documentNumberingBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createDocumentNumberSeries(requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined);
    return documentNumberingSuccess(data, requestId, 201);
  } catch (error) {
    return documentNumberingError(error, requestId);
  }
}
