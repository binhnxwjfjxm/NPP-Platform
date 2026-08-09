export const DELIVERY_SESSION_COOKIE = 'hp_delivery_session';

export function deliverySessionCookieOptions(expiresAt?: string) {
  const parsed = expiresAt ? new Date(expiresAt) : null;
  const expires = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  return Object.freeze({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(expires ? { expires } : {}),
  });
}

export function safeDeliveryReturnTo(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
}
