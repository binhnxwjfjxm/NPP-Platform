import { NextRequest } from 'next/server';
import { listDocumentPrintTemplates } from '../../../lib/document-print-template-gateway';
import { documentPrintTemplateError, documentPrintTemplateRequestId, documentPrintTemplateSuccess } from '../../../lib/document-print-template-route';

export async function GET(request: NextRequest) {
  const requestId = documentPrintTemplateRequestId(request);
  try {
    return documentPrintTemplateSuccess(await listDocumentPrintTemplates(requestId), requestId);
  } catch (error) {
    return documentPrintTemplateError(error, requestId);
  }
}
