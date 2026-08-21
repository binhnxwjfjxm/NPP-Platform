import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './retail-lot7.css';
import './retail-issue675.css';
import { PwaRegistration } from './pwa-registration';

export const metadata: Metadata = {
  title: 'Bán tại quầy | Hưng Phát',
  description: 'Ứng dụng bán tại quầy dùng chung dữ liệu và nghiệp vụ Công Ty.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/pwa-icon-retail.png?v=2', type: 'image/png', sizes: '512x512' }],
    apple: [{ url: '/pwa-icon-retail.png?v=2', type: 'image/png', sizes: '512x512' }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body><PwaRegistration />{children}</body>
    </html>
  );
}
