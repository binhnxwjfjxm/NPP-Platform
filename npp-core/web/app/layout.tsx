import type { Metadata } from 'next';
import { Be_Vietnam_Pro, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import './ui-polish.css';
import './components/lot3-ui-overrides.css';
import './issue-107-purchase-order-layout.css';
import './hung-phat-warm-gold.css';
import './core-office-density.css';

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'Hưng Phát Company',
    template: '%s · Hưng Phát Company',
  },
  description: 'Hệ thống quản trị nội bộ Hưng Phát Company',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
