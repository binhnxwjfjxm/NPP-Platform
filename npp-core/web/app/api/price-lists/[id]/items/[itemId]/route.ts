import { NextRequest } from 'next/server';
import { patchPriceListItem } from '../../../../../../lib/pricing-gateway';
import { pricingBody, pricingError, pricingRequestId, pricingSuccess } from '../../../../../../lib/pricing-route';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const requestId = pricingRequestId(request);
  const parsed = await pricingBody(request, requestId); if (!parsed.ok) return parsed.response;
  try {
    const values = await params;
    return pricingSuccess(await patchPriceListItem(values.id, values.itemId, requestId, parsed.body), requestId);
  } catch (error) { return pricingError(error, requestId); }
}
