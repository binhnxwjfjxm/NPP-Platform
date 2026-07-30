import { NextRequest, NextResponse } from 'next/server';
import {
  getOrganizationResource,
  isOrganizationResource,
  normalizeOrganizationGatewayError,
  patchOrganizationResource,
  resolveOrganizationRequestId,
} from '../../../../../lib/organization-gateway';
import { formatDeactivateConflictMessage } from '../../../../../lib/deactivate-conflict-message';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return {
    'Cache-Control': 'no-store',
    'x-request-id': requestId,
  };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeOrganizationGatewayError(error);
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: formatDeactivateConflictMessage(normalized.publicMessage, normalized.details),
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    { status: normalized.statusCode, headers: responseHeaders(requestId) },
  );
}

function missingResource(requestId: string) {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Organization resource not found', retryable: false }, requestId },
    { status: 404, headers: responseHeaders(requestId) },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: { resource: string; id: string } },
) {
  const requestId = resolveOrganizationRequestId(request.headers.get('x-request-id'));
  if (!isOrganizationResource(params.resource)) return missingResource(requestId);

  try {
    const data = await getOrganizationResource(params.resource, params.id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { resource: string; id: string } },
) {
  const requestId = resolveOrganizationRequestId(request.headers.get('x-request-id'));
  if (!isOrganizationResource(params.resource)) return missingResource(requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Request body must be valid JSON', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = await patchOrganizationResource(params.resource, params.id, requestId, body);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
