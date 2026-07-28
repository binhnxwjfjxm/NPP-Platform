export async function GET(request: Request) {
  const logoUrl = new URL('/logo-transparent.png', request.url);
  const logoResponse = await fetch(logoUrl, { cache: 'force-cache' });

  if (!logoResponse.ok) {
    return new Response(null, { status: 404 });
  }

  return new Response(await logoResponse.arrayBuffer(), {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Type': logoResponse.headers.get('content-type') || 'image/png',
    },
  });
}
