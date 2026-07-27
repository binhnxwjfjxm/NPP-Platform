import { NextRequest } from 'next/server';
import { resolvePrice } from '../../../../lib/pricing-gateway';
import { pricingBody, pricingError, pricingRequestId, pricingSuccess } from '../../../../lib/pricing-route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = pricingRequestId(request);
  const parsed = await pricingBody(request, requestId); if (!parsed.ok) return parsed.response;
  try { return pricingSuccess(await resolvePrice(requestId, parsed.body), requestId); }
  catch (error) { return pricingError(error, requestId); }
}
