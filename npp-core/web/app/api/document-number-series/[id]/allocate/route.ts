import { NextRequest } from 'next/server';
import { allocateDocumentNumber } from '../../../../../lib/document-numbering-gateway';
import { documentNumberingBody, documentNumberingError, documentNumberingRequestId, documentNumberingSuccess } from '../../../../../lib/document-numbering-route';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = documentNumberingRequestId(request);
  const parsed = await documentNumberingBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const { id } = await params;
    const data = await allocateDocumentNumber(id, requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined);
    return documentNumberingSuccess(data, requestId, data && typeof data === 'object' && 'replayed' in data && data.replayed ? 200 : 201);
  } catch (error) {
    return documentNumberingError(error, requestId);
  }
}
