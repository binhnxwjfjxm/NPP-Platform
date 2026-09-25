'use client';

import { useEffect } from 'react';

type RetailAuthMe = {
  data?: {
    userId?: string;
    isOwner?: boolean;
  };
};

type OneSignalSdk = {
  init(options: {
    appId: string;
    serviceWorkerPath: string;
    serviceWorkerParam: { scope: string };
  }): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalSdk) => void | Promise<void>>;
  }
}

const ONESIGNAL_SCRIPT_ID = 'retail-onesignal-sdk';
const ONESIGNAL_SCRIPT_SRC = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
let runtimeQueued = false;

function loadSdkScript() {
  const existing = document.getElementById(ONESIGNAL_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) return;
  const script = document.createElement('script');
  script.id = ONESIGNAL_SCRIPT_ID;
  script.src = ONESIGNAL_SCRIPT_SRC;
  script.defer = true;
  document.head.appendChild(script);
}

async function currentIdentity(): Promise<{ userId: string; isOwner: boolean }> {
  try {
    const response = await fetch('/api/auth/me', { method: 'GET', cache: 'no-store' });
    const payload = await response.json().catch(() => null) as RetailAuthMe | null;
    if (!response.ok || !payload?.data) return { userId: '', isOwner: false };
    return {
      userId: String(payload.data.userId ?? '').trim(),
      isOwner: payload.data.isOwner === true,
    };
  } catch {
    return { userId: '', isOwner: false };
  }
}

export function RetailNotificationRuntime() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_RETAIL_ONESIGNAL_APP_ID?.trim();
    if (!appId || runtimeQueued) return;
    runtimeQueued = true;

    void currentIdentity().then((identity) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId,
            serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/onesignal/' },
          });
          if (identity.isOwner && identity.userId) {
            await OneSignal.login(identity.userId);
          } else {
            await OneSignal.logout();
          }
        } catch {
          // Thông báo là kênh bổ trợ; lỗi provider không được chặn nghiệp vụ bán hàng.
        }
      });
      loadSdkScript();
    });
  }, []);

  return null;
}
