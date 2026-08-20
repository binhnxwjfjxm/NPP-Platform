import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { PwaRegistration } from './pwa-registration';

export const metadata: Metadata = {
  title: 'Bán tại quầy | Hưng Phát',
  description: 'Ứng dụng bán tại quầy dùng chung dữ liệu và nghiệp vụ Công Ty.',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body><PwaRegistration />{children}</body>
    </html>
  );
}
