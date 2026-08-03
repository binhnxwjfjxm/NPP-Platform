import { NextRequest, NextResponse } from 'next/server';
import { CoreApiError, requestCore } from '@/lib/core-api';
import type { CustomerOnboardingAction, CustomerOnboardingRequestSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<CustomerOnboardingAction>(['review', 'need-more-info', 'approve', 'link-existing', 'reject']);

function sameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || request.nextUrl.host;
  try { return new URL(origin).origin === `${protocol}://${host}`; } catch { return false; }
}

export async function POST(request: NextRequest, { params }: { params: { id: string; action: string } }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: { code: 'CROSS_SITE_REQUEST_REJECTED', message: 'Yêu cầu từ trang khác không được chấp nhận', retryable: false } }, { status: 403 });
  if (!UUID_PATTERN.test(params.id) || !ACTIONS.has(params.action as CustomerOnboardingAction)) {
    return NextResponse.json({ error: { code: 'INVALID_ADMIN_ACTION', message: 'Thao tác không hợp lệ', retryable: false } }, { status: 400 });
  }
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: { code: 'JSON_CONTENT_TYPE_REQUIRED', message: 'Yêu cầu phải dùng định dạng JSON', retryable: false } }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'INVALID_JSON_BODY', message: 'Nội dung gửi lên không hợp lệ', retryable: false } }, { status: 400 });
  }
  try {
    const data = await requestCore<{ customerOnboardingRequest: CustomerOnboardingRequestSummary }>(
      `/api/customer-onboarding-requests/${params.id}/${params.action}`,
      {
        method: 'POST',
        body,
        idempotencyKey: request.headers.get('idempotency-key')?.trim() || `admin-${crypto.randomUUID()}`,
      },
    );
    return NextResponse.json({ data: data.customerOnboardingRequest }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const normalized = error instanceof CoreApiError
      ? error
      : new CoreApiError('ADMIN_ACTION_FAILED', 'Không thực hiện được thao tác', 503, true);
    return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable } }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } });
  }
}
