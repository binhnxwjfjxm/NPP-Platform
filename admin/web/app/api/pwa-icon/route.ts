import { createElement } from 'react';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const SUPPORTED_SIZES = new Set([192, 512]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedSize = Number(url.searchParams.get('size') || 512);
  const size = SUPPORTED_SIZES.has(requestedSize) ? requestedSize : 512;
  const maskable = url.searchParams.get('maskable') === '1';
  const outerPadding = maskable ? Math.round(size * 0.18) : Math.round(size * 0.08);
  const borderWidth = Math.max(3, Math.round(size * 0.018));
  const monogramSize = Math.round(size * 0.32);

  const image = createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: outerPadding,
        background: 'linear-gradient(145deg, #1f1208 0%, #3b240f 58%, #6a4318 100%)',
      },
    },
    createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `${borderWidth}px solid #d9a441`,
          borderRadius: maskable ? Math.round(size * 0.1) : Math.round(size * 0.18),
          background: 'linear-gradient(145deg, rgba(255,255,255,0.06), rgba(0,0,0,0.08))',
          color: '#f3c76d',
          fontFamily: 'Georgia, Times New Roman, serif',
          fontSize: monogramSize,
          fontWeight: 700,
          letterSpacing: '-0.08em',
          textShadow: '0 3px 12px rgba(0,0,0,0.35)',
        },
      },
      'HP',
    ),
  );

  return new ImageResponse(image, {
    width: size,
    height: size,
    headers: {
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
