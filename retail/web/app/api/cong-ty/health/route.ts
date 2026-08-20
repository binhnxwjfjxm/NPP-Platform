export const dynamic = 'force-dynamic';

function resolveCompanyHealthUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) return null;

  const base = new URL(raw);
  if (base.protocol !== 'https:' && base.hostname !== '127.0.0.1' && base.hostname !== 'localhost') {
    throw new Error('invalid_company_api_url');
  }
  return new URL('/health/live', base);
}

export async function GET() {
  try {
    const url = resolveCompanyHealthUrl();
    if (!url) {
      return Response.json({ status: 'unavailable' }, { status: 503 });
    }

    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    return Response.json(
      { status: response.ok ? 'ok' : 'unavailable' },
      { status: response.ok ? 200 : 502 },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 502 });
  }
}
