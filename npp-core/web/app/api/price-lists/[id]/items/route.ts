import { NextRequest } from 'next/server';
import { createPriceListItem, listPriceListItems } from '../../../../../lib/pricing-gateway';
import { pricingBody, pricingError, pricingRequestId, pricingSuccess } from '../../../../../lib/pricing-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = pricingRequestId(request);
  try { return pricingSuccess(await listPriceListItems<unknown>((await params).id, requestId, request.nextUrl.searchParams), requestId); }
  catch (error) { return pricingError(error, requestId); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = pricingRequestId(request);
  const parsed = await pricingBody(request, requestId); if (!parsed.ok) return parsed.response;
  try { return pricingSuccess(await createPriceListItem((await params).id, requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined), requestId, 201); }
  catch (error) { return pricingError(error, requestId); }
}
