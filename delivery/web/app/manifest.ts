import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Hưng Phát Giao hàng',
    short_name: 'HP Giao hàng',
    description: 'Chuyến, điểm giao, kết quả giao hàng và COD dành cho tài xế Hưng Phát.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f1e8',
    theme_color: '#3f2818',
    orientation: 'portrait',
    icons: [
      {
        src: '/icons/delivery-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/delivery-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/delivery-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
