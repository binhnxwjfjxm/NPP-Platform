import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './retail-lot7.css';
import './retail-issue675.css';
import './retail-mobile-polish.css';
import './retail-home-polish.css';
import './retail-final-polish.css';
import './retail-print-professional.css';
import './retail-product-picker-polish.css';
import './retail-print-template-editor.css';
import './retail-printer.css';
import './retail-pos-entry.css';
import './retail-notifications.css';
import { PwaRegistration } from './pwa-registration';
import { RetailNotificationRuntime } from './retail-notification-runtime';
import { RetailProductPickerRuntime } from './retail-product-picker-runtime';
import { RetailSystemPrintPageSizer } from './retail-system-print-page-sizer';

export const metadata: Metadata = {
  title: 'Bán tại quầy',
  description: 'Ứng dụng bán tại quầy của Công Ty',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/pwa-icon-retail.png?v=2', type: 'image/png', sizes: '512x512' }],
    apple: [{ url: '/pwa-icon-retail.png?v=2', type: 'image/png', sizes: '512x512' }],
  },
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
  return <html lang="vi"><body><PwaRegistration /><RetailProductPickerRuntime /><RetailSystemPrintPageSizer /><RetailNotificationRuntime />{children}</body></html>;
}
