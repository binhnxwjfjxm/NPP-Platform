import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './retail-lot7.css';
import './retail-issue675.css';
import { PwaRegistration } from './pwa-registration';

export const metadata: Metadata = {
  title: 'Bán tại quầy',
  description: 'Ứng dụng bán tại quầy của Công Ty',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Bán tại quầy' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#eff8f3',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="vi"><body><PwaRegistration />{children}</body></html>;
}
