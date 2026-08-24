import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PwaRegister } from './pwa-register';
import './globals.css';
import './hung-phat-warm-gold.css';
import './admin-mobile-app.css';
import './admin-management-shell.css';
import './admin-foundation.css';
import './admin-closeout.css';
import './admin-mobile-interaction.css';

export const metadata: Metadata = {
  title: 'Admin MCP/NPP — Hưng Phát',
  description: 'Trung tâm điều hành dành cho chủ và quản lý Hưng Phát',
  applicationName: 'Admin MCP/NPP',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/admin-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/admin-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/icons/admin-192.png',
    apple: [{ url: '/icons/admin-180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'black', title: 'Admin Hưng Phát' },
  other: { 'mobile-web-app-capable': 'yes' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  colorScheme: 'light',
  themeColor: '#2b180b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="vi"><body><PwaRegister />{children}</body></html>;
}
