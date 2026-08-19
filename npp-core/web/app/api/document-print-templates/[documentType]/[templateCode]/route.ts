import { NextRequest } from 'next/server';
import { patchDocumentPrintTemplate } from '../../../../../lib/document-print-template-gateway';
import { documentPrintTemplateBody, documentPrintTemplateError, documentPrintTemplateRequestId, documentPrintTemplateSuccess } from '../../../../../lib/document-print-template-route';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ documentType: string; templateCode: string }> }) {
  const requestId = documentPrintTemplateRequestId(request);
  const parsed = await documentPrintTemplateBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  const { documentType, templateCode } = await params;
  try {
    return documentPrintTemplateSuccess(
      await patchDocumentPrintTemplate(documentType, templateCode, requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined),
      requestId,
    );
  } catch (error) {
    return documentPrintTemplateError(error, requestId);
  }
}
