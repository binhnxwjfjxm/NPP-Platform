'use client';

import { useCallback, useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const RETAIL_PWA_INSTALL_EVENT = 'retail:pwa-install';

function isIosDevice() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function requestRetailPwaInstall() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(RETAIL_PWA_INSTALL_EVENT));
}

export function PwaRegistration() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [platform, setPlatform] = useState<'android' | 'ios' | 'other'>('other');
  const [installMessage, setInstallMessage] = useState('Mở nhanh như ứng dụng, không cần tìm trong trình duyệt.');

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);

    const android = /Android/i.test(navigator.userAgent);
    const ios = isIosDevice();
    const standalone = isStandalone();
    setPlatform(android ? 'android' : ios ? 'ios' : 'other');
    if (standalone || (!android && !ios)) return;

    setShowInstall(true);
    setInstallMessage(
      ios
        ? 'Trên iPhone/iPad, thêm Bán tại quầy vào Màn hình chính để nhận thông báo khi khóa màn hình.'
        : 'Mở nhanh như ứng dụng và nhận thông báo thuận tiện hơn.',
    );

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setPlatform('android');
      setInstallMessage('Mở nhanh như ứng dụng và nhận thông báo thuận tiện hơn.');
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

  const installRetail = useCallback(async () => {
    const android = /Android/i.test(navigator.userAgent);
    const ios = isIosDevice();

    if (isStandalone()) {
      setInstallMessage('Bán tại quầy đã được cài trên thiết bị này.');
      setShowInstall(true);
      return;
    }

    if (ios) {
      setPlatform('ios');
      setInstallMessage('Mở bằng Safari → bấm Chia sẻ → chọn Thêm vào Màn hình chính. Sau đó mở Bán tại quầy từ biểu tượng vừa tạo.');
      setShowInstall(true);
      return;
    }

    if (!android) {
      setPlatform('other');
      setInstallMessage('Dùng chức năng Thêm vào màn hình chính hoặc Cài ứng dụng của trình duyệt nếu thiết bị hỗ trợ.');
      setShowInstall(true);
      return;
    }

    setPlatform('android');
    if (!installPrompt) {
      setInstallMessage('Trong Chrome Android, mở menu ⋮ rồi chọn Cài ứng dụng hoặc Thêm vào màn hình chính.');
      setShowInstall(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') {
      setShowInstall(false);
      return;
    }
    setInstallMessage('Chưa cài ứng dụng. Có thể bấm Cài ứng dụng lại khi cần.');
    setShowInstall(true);
  }, [installPrompt]);

  useEffect(() => {
    const handleInstallRequest = () => {
      void installRetail();
    };
    window.addEventListener(RETAIL_PWA_INSTALL_EVENT, handleInstallRequest);
    return () => window.removeEventListener(RETAIL_PWA_INSTALL_EVENT, handleInstallRequest);
  }, [installRetail]);

  if (!showInstall) return null;

  const heading = platform === 'ios'
    ? 'Cài Bán tại quầy trên iPhone'
    : platform === 'android'
      ? 'Cài Bán tại quầy trên Android'
      : 'Cài Bán tại quầy';

  return <aside aria-label="Cài ứng dụng Bán tại quầy" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #cfe3d6', background: '#f2faf5', color: '#183d29', fontFamily: 'inherit' }}>
    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
      <strong style={{ display: 'block', fontSize: 13, lineHeight: 1.25 }}>{heading}</strong>
      <small style={{ display: 'block', marginTop: 2, color: '#526158', fontSize: 11, lineHeight: 1.3 }}>{installMessage}</small>
    </div>
    <button type="button" onClick={() => void installRetail()} style={{ minHeight: 38, flex: '0 0 auto', border: 0, borderRadius: 12, padding: '0 14px', background: '#18864c', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 800 }}>{platform === 'ios' ? 'Cách cài' : 'Cài ứng dụng'}</button>
    <button type="button" aria-label="Để sau" onClick={() => setShowInstall(false)} style={{ width: 36, height: 36, flex: '0 0 36px', border: 0, borderRadius: 12, background: 'transparent', color: '#526158', font: 'inherit', fontSize: 22, lineHeight: 1 }}>×</button>
  </aside>;
}
