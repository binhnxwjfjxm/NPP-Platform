import type { Metadata, Viewport } from 'next';
import DeliveryAppFrame from './DeliveryAppFrame';
import PwaRegister from './PwaRegister';
import './globals.css';
import './hung-phat-mobile.css';
import './delivery-app-experience.css';
import './delivery-mobile-app.css';
import './delivery-account-menu.css';
import './delivery-viewport-fix.css';

export const metadata: Metadata = {
  applicationName: 'Hưng Phát Giao hàng',
  title: 'Hưng Phát Giao hàng',
  description: 'Danh sách chuyến và điểm giao dành cho tài xế Hưng Phát.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HP Giao hàng',
  },
  icons: {
    icon: [
      { url: '/icons/delivery-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/delivery-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/delivery-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#3f2818',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <PwaRegister />
        <DeliveryAppFrame>{children}</DeliveryAppFrame>
      </body>
    </html>
  );
}
