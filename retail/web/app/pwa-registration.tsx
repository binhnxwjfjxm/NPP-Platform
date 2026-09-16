'use client';

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PwaRegistration() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [installMessage, setInstallMessage] = useState('Mở nhanh như ứng dụng, không cần tìm trong trình duyệt.');

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);

    const android = /Android/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (!android || standalone) return;

    setShowInstall(true);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallMessage('Mở nhanh như ứng dụng, không cần tìm trong trình duyệt.');
      setShowInstall(true);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setShowInstall(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  async function installRetail() {
    if (!installPrompt) {
      setInstallMessage('Mở Retail bằng Chrome trên Android rồi bấm lại Cài Retail.');
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') {
      setShowInstall(false);
      return;
    }
    setInstallMessage('Chưa cài ứng dụng. Có thể bấm Cài Retail lại khi cần.');
  }

  if (!showInstall) return null;

  return <aside aria-label="Cài ứng dụng Retail" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #cfe3d6', background: '#f2faf5', color: '#183d29', fontFamily: 'inherit' }}>
    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
      <strong style={{ display: 'block', fontSize: 13, lineHeight: 1.25 }}>Cài Retail trên Android</strong>
      <small style={{ display: 'block', marginTop: 2, color: '#526158', fontSize: 11, lineHeight: 1.3 }}>{installMessage}</small>
    </div>
    <button type="button" onClick={() => void installRetail()} style={{ minHeight: 38, flex: '0 0 auto', border: 0, borderRadius: 12, padding: '0 14px', background: '#18864c', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 800 }}>Cài Retail</button>
    <button type="button" aria-label="Để sau" onClick={() => setShowInstall(false)} style={{ width: 36, height: 36, flex: '0 0 36px', border: 0, borderRadius: 12, background: 'transparent', color: '#526158', font: 'inherit', fontSize: 22, lineHeight: 1 }}>×</button>
  </aside>;
}
