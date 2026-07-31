import { NextRequest } from 'next/server';
import { getSalesOrderEntrySettings } from '../../../../lib/sales-order-gateway';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

type EntrySettings = {
  walkInConfigured: boolean;
  walkInBootstrapSupported: boolean;
  defaultTaxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  defaultTaxRate: string;
};

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const data = await getSalesOrderEntrySettings<EntrySettings>(requestId);
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
