import { NextRequest } from 'next/server';
import { proxySupplierReturnAction } from '../_action';

export const dynamic = 'force-dynamic';

export function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return proxySupplierReturnAction(request, params.id, 'cancel');
}
