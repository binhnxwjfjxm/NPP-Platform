import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hưng Phát Giao hàng',
    short_name: 'HP Delivery',
    description: 'Chuyến và điểm giao được phân công cho tài xế Hưng Phát.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f7f5',
    theme_color: '#153c2f',
    orientation: 'portrait',
  };
}
