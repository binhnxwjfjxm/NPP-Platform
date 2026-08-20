import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hưng Phát - Bán tại quầy',
    short_name: 'Bán tại quầy',
    description: 'Ứng dụng bán tại quầy của Công Ty.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7fb',
    theme_color: '#10233f',
    lang: 'vi',
  };
}
