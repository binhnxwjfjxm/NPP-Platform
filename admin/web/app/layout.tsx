import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PwaRegister } from './pwa-register';
import './globals.css';
import './hung-phat-warm-gold.css';

export const metadata: Metadata = {
  title: 'Admin MCP/NPP — Hưng Phát',
  description: 'Trung tâm điều hành dành cho chủ và quản lý Hưng Phát',
  applicationName: 'Admin MCP/NPP',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/api/pwa-icon?size=192', sizes: '192x192', type: 'image/png' },
      { url: '/api/pwa-icon?size=512', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/api/pwa-icon?size=192',
    apple: '/api/pwa-icon?size=512',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Admin Hưng Phát',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
  themeColor: '#2b180b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
