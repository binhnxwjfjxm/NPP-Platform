import { NextRequest } from 'next/server';
import { patchPriceList } from '../../../../lib/pricing-gateway';
import { pricingBody, pricingError, pricingRequestId, pricingSuccess } from '../../../../lib/pricing-route';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = pricingRequestId(request);
  const parsed = await pricingBody(request, requestId); if (!parsed.ok) return parsed.response;
  try { return pricingSuccess(await patchPriceList((await params).id, requestId, parsed.body), requestId); }
  catch (error) { return pricingError(error, requestId); }
}
