import { NextRequest } from 'next/server';
import { listDocumentNumberAllocations } from '../../../../../lib/document-numbering-gateway';
import { documentNumberingError, documentNumberingRequestId, documentNumberingSuccess } from '../../../../../lib/document-numbering-route';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = documentNumberingRequestId(request);
  try {
    const { id } = await params;
    const data = await listDocumentNumberAllocations(id, requestId, request.nextUrl.searchParams);
    return documentNumberingSuccess(data, requestId);
  } catch (error) {
    return documentNumberingError(error, requestId);
  }
}
