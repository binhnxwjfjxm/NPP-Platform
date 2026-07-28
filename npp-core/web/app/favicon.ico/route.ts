export async function GET(request: Request) {
  const logoUrl = new URL('/logo-transparent.png', request.url).toString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="${logoUrl}" width="64" height="64" preserveAspectRatio="xMidYMid meet" /></svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': 'image/svg+xml; charset=utf-8',
    },
  });
}
