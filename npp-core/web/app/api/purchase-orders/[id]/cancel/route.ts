import { NextRequest } from 'next/server';
import { proxyPurchaseOrderAction } from '../_action';

export const dynamic = 'force-dynamic';

export function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return proxyPurchaseOrderAction(request, params.id, 'cancel');
}
