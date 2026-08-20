import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hưng Phát - Bán tại quầy',
    short_name: 'Bán tại quầy',
    description: 'Ứng dụng bán tại quầy của Công Ty.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7faf7',
    theme_color: '#047a42',
    lang: 'vi',
    icons: [{ src: '/pwa-icon-retail.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  };
}
