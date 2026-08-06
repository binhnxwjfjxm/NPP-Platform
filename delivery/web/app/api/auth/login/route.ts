import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../lib/delivery-auth';
import {
  DELIVERY_SESSION_COOKIE,
  createDeliverySession,
  deliverySessionCookieOptions,
  safeDeliveryReturnTo,
} from '../../../../lib/delivery-session';

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function setupCredentialsValid(username: string, password: string): boolean {
  const expectedUsername = String(process.env.DELIVERY_SETUP_USERNAME || '').trim();
  const expectedPassword = String(process.env.DELIVERY_SETUP_PASSWORD || '');
  return Boolean(expectedUsername && expectedPassword)
    && constantTimeEqual(username, expectedUsername)
    && constantTimeEqual(password, expectedPassword);
}

function redirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const returnTo = safeDeliveryReturnTo(String(form.get('returnTo') || '/'));

  const basic = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  const valid = deliverySetupPending()
    ? setupCredentialsValid(username, password)
    : Boolean(authenticateDeliveryUser(basic));

  if (!valid) {
    const search = new URLSearchParams({ error: 'invalid_credentials' });
    if (returnTo !== '/') search.set('returnTo', returnTo);
    return redirect(`/login?${search.toString()}`);
  }

  const response = redirect(returnTo);
  response.cookies.set(
    DELIVERY_SESSION_COOKIE,
    await createDeliverySession(username),
    deliverySessionCookieOptions(),
  );
  return response;
}
