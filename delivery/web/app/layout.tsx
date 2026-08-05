import type { Metadata, Viewport } from 'next';
import DeliveryAppFrame from './DeliveryAppFrame';
import './globals.css';
import './hung-phat-mobile.css';
import './delivery-app-experience.css';

export const metadata: Metadata = {
  title: 'Hưng Phát Giao hàng',
  description: 'Danh sách chuyến và điểm giao dành cho tài xế Hưng Phát.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#754706',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body><DeliveryAppFrame>{children}</DeliveryAppFrame></body>
    </html>
  );
}
