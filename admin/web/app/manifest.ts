import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Admin MCP/NPP — Hưng Phát',
    short_name: 'Admin Hưng Phát',
    description: 'Ứng dụng tổng hợp và xử lý ngoại lệ dành cho chủ và quản lý Hưng Phát.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f3eb',
    theme_color: '#2b180b',
    orientation: 'any',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/api/pwa-icon?size=192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/api/pwa-icon?size=512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/api/pwa-icon?size=512&maskable=1',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
