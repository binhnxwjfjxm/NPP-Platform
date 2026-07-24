import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NPP Core',
  description: 'NPP Core foundation shell',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
