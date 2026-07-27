import { NextRequest } from 'next/server';
import { getDocumentNumberSeries, patchDocumentNumberSeries } from '../../../../lib/document-numbering-gateway';
import { documentNumberingBody, documentNumberingError, documentNumberingRequestId, documentNumberingSuccess } from '../../../../lib/document-numbering-route';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = documentNumberingRequestId(request);
  try {
    const { id } = await params;
    const data = await getDocumentNumberSeries(id, requestId);
    return documentNumberingSuccess(data, requestId);
  } catch (error) {
    return documentNumberingError(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = documentNumberingRequestId(request);
  const parsed = await documentNumberingBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const { id } = await params;
    const data = await patchDocumentNumberSeries(id, requestId, parsed.body);
    return documentNumberingSuccess(data, requestId);
  } catch (error) {
    return documentNumberingError(error, requestId);
  }
}
