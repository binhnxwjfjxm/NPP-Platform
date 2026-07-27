import { NextRequest } from 'next/server';
import { importPricing } from '../../../../lib/pricing-gateway';
import { pricingBody, pricingError, pricingRequestId, pricingSuccess } from '../../../../lib/pricing-route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = pricingRequestId(request);
  const parsed = await pricingBody(request, requestId); if (!parsed.ok) return parsed.response;
  try { return pricingSuccess(await importPricing(requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined), requestId, 201); }
  catch (error) { return pricingError(error, requestId); }
}
