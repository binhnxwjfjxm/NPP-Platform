'use client';

import { useEffect } from 'react';

type RetailAuthMe = {
  data?: {
    userId?: string;
    isOwner?: boolean;
  };
};

type NativePermission = 'default' | 'granted' | 'denied';
type OneSignalNotification = {
  title?: string;
  body?: string;
  additionalData?: Record<string, unknown>;
};
type OneSignalForegroundEvent = { notification?: OneSignalNotification };
type OneSignalClickEvent = { notification?: OneSignalNotification };
type OneSignalSdk = {
  init(options: {
    appId: string;
    serviceWorkerPath: string;
    serviceWorkerParam: { scope: string };
  }): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: {
    isPushSupported(): boolean;
    requestPermission(): Promise<void>;
    permission: boolean;
    permissionNative: NativePermission;
    addEventListener(event: 'permissionChange', listener: (granted: boolean) => void): void;
    addEventListener(event: 'foregroundWillDisplay', listener: (event: OneSignalForegroundEvent) => void): void;
    addEventListener(event: 'click', listener: (event: OneSignalClickEvent) => void): void;
  };
  User: {
    PushSubscription: {
      id?: string | null;
      optedIn?: boolean;
      optIn(): Promise<void>;
      optOut(): Promise<void>;
      addEventListener(event: 'change', listener: () => void): void;
    };
  };
};

export type RetailNotificationStatus =
  | 'loading'
  | 'not-owner'
  | 'not-configured'
  | 'needs-install'
  | 'unsupported'
  | 'blocked'
  | 'not-enabled'
  | 'not-subscribed'
  | 'subscribed'
  | 'error';

export type RetailNotificationState = Readonly<{
  ready: boolean;
  isOwner: boolean;
  status: RetailNotificationStatus;
  nativePermission: NativePermission;
  subscribed: boolean;
  subscriptionId: string | null;
  iosInstallRequired: boolean;
}>;

export type RetailForegroundNotification = Readonly<{
  title: string;
  body: string;
  orderId: string | null;
  orderNumber: string | null;
}>;

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalSdk) => void | Promise<void>>;
  }
}

export const RETAIL_NOTIFICATION_FOREGROUND_EVENT = 'retail:notification-foreground';
export const RETAIL_NOTIFICATION_OPEN_EVENT = 'retail:notification-open';

const ONESIGNAL_SCRIPT_ID = 'retail-onesignal-sdk';
const ONESIGNAL_SCRIPT_SRC = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let runtimeQueued = false;
let activeSdk: OneSignalSdk | null = null;
let activeIdentity = { userId: '', isOwner: false };
let state: RetailNotificationState = Object.freeze({
  ready: false,
  isOwner: false,
  status: 'loading',
  nativePermission: 'default',
  subscribed: false,
  subscriptionId: null,
  iosInstallRequired: false,
});
const listeners = new Set<(next: RetailNotificationState) => void>();

function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function emit(next: RetailNotificationState) {
  state = Object.freeze(next);
  for (const listener of listeners) listener(state);
}

function statusFromSdk(OneSignal: OneSignalSdk): RetailNotificationState {
  const nativePermission = OneSignal.Notifications.permissionNative ?? 'default';
  const iosInstallRequired = activeIdentity.isOwner && isIosDevice() && !isStandalone();
  if (!activeIdentity.isOwner) {
    return { ready: true, isOwner: false, status: 'not-owner', nativePermission, subscribed: false, subscriptionId: null, iosInstallRequired: false };
  }
  if (iosInstallRequired) {
    return { ready: true, isOwner: true, status: 'needs-install', nativePermission, subscribed: false, subscriptionId: null, iosInstallRequired: true };
  }
  if (!OneSignal.Notifications.isPushSupported()) {
    return { ready: true, isOwner: true, status: 'unsupported', nativePermission, subscribed: false, subscriptionId: null, iosInstallRequired: false };
  }
  if (nativePermission === 'denied') {
    return { ready: true, isOwner: true, status: 'blocked', nativePermission, subscribed: false, subscriptionId: null, iosInstallRequired: false };
  }
  if (nativePermission !== 'granted') {
    return { ready: true, isOwner: true, status: 'not-enabled', nativePermission, subscribed: false, subscriptionId: null, iosInstallRequired: false };
  }
  const subscriptionId = String(OneSignal.User.PushSubscription.id ?? '').trim() || null;
  const subscribed = OneSignal.User.PushSubscription.optedIn === true && Boolean(subscriptionId);
  return {
    ready: true,
    isOwner: true,
    status: subscribed ? 'subscribed' : 'not-subscribed',
    nativePermission,
    subscribed,
    subscriptionId,
    iosInstallRequired: false,
  };
}

function refreshState() {
  if (!activeSdk) return;
  emit(statusFromSdk(activeSdk));
}

function notificationDetail(notification?: OneSignalNotification): RetailForegroundNotification {
  const data = notification?.additionalData ?? {};
  const rawOrderId = String(data.salesOrderId ?? '').trim();
  return Object.freeze({
    title: String(notification?.title ?? 'Bán tại quầy').trim() || 'Bán tại quầy',
    body: String(notification?.body ?? 'Có thông báo mới.').trim() || 'Có thông báo mới.',
    orderId: UUID_PATTERN.test(rawOrderId) ? rawOrderId : null,
    orderNumber: String(data.orderNumber ?? '').trim() || null,
  });
}

function dispatchNotificationEvent(name: string, notification?: OneSignalNotification) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<RetailForegroundNotification>(name, {
    detail: notificationDetail(notification),
  }));
}

function attachSdkListeners(OneSignal: OneSignalSdk) {
  OneSignal.Notifications.addEventListener('permissionChange', () => refreshState());
  OneSignal.User.PushSubscription.addEventListener('change', () => refreshState());
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
    if (activeIdentity.isOwner) dispatchNotificationEvent(RETAIL_NOTIFICATION_FOREGROUND_EVENT, event.notification);
  });
  OneSignal.Notifications.addEventListener('click', (event) => {
    if (activeIdentity.isOwner) dispatchNotificationEvent(RETAIL_NOTIFICATION_OPEN_EVENT, event.notification);
  });
}

function loadSdkScript() {
  const existing = document.getElementById(ONESIGNAL_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) return;
  const script = document.createElement('script');
  script.id = ONESIGNAL_SCRIPT_ID;
  script.src = ONESIGNAL_SCRIPT_SRC;
  script.defer = true;
  script.addEventListener('error', () => {
    emit({ ...state, ready: true, status: activeIdentity.isOwner ? 'error' : 'not-owner' });
  }, { once: true });
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

export function getRetailNotificationState() {
  return state;
}

export function subscribeRetailNotificationState(listener: (next: RetailNotificationState) => void) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function retailNotificationStatusLabel(current: RetailNotificationState) {
  switch (current.status) {
    case 'subscribed': return 'Đã đăng ký';
    case 'blocked': return 'Bị chặn';
    case 'needs-install': return 'Cần cài ứng dụng';
    case 'unsupported': return 'Thiết bị không hỗ trợ';
    case 'not-subscribed': return 'Chưa đăng ký';
    case 'not-enabled': return 'Chưa bật';
    case 'not-configured':
    case 'error': return 'Chưa sẵn sàng';
    case 'loading': return 'Đang kiểm tra';
    default: return '';
  }
}

export async function requestRetailNotificationPermission() {
  if (!state.isOwner) throw new Error('Chỉ tài khoản Owner được bật thông báo.');
  if (state.iosInstallRequired) throw new Error('Hãy thêm Bán tại quầy vào Màn hình chính trước khi bật thông báo.');
  if (!activeSdk) throw new Error('Thông báo chưa sẵn sàng trên thiết bị này.');
  if (!activeSdk.Notifications.isPushSupported()) throw new Error('Thiết bị hoặc trình duyệt này chưa hỗ trợ thông báo.');
  if (activeSdk.Notifications.permissionNative === 'denied') {
    refreshState();
    throw new Error('Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của thiết bị.');
  }
  await activeSdk.Notifications.requestPermission();
  refreshState();
  if (state.nativePermission !== 'granted') {
    throw new Error(state.nativePermission === 'denied'
      ? 'Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của thiết bị.'
      : 'Chưa cấp quyền thông báo. Có thể bật lại khi sẵn sàng.');
  }
  await activeSdk.User.PushSubscription.optIn();
  refreshState();
  return state;
}

export async function sendRetailNotificationTest(idempotencyKey: string) {
  const key = String(idempotencyKey ?? '').trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) throw new Error('Khóa gửi thử không hợp lệ.');
  const response = await fetch('/api/notifications/test', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => null) as {
    error?: { message?: string };
    data?: { sent?: boolean };
  } | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? 'Chưa thể gửi thông báo thử.');
  }
  return payload?.data ?? {};
}

export function RetailNotificationRuntime() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_RETAIL_ONESIGNAL_APP_ID?.trim();
    if (runtimeQueued) return;
    runtimeQueued = true;

    void currentIdentity().then((identity) => {
      activeIdentity = identity;
      if (!appId) {
        emit({
          ready: true,
          isOwner: identity.isOwner,
          status: identity.isOwner ? 'not-configured' : 'not-owner',
          nativePermission: 'default',
          subscribed: false,
          subscriptionId: null,
          iosInstallRequired: identity.isOwner && isIosDevice() && !isStandalone(),
        });
        return;
      }
      if (identity.isOwner && isIosDevice() && !isStandalone()) {
        emit({
          ready: true,
          isOwner: true,
          status: 'needs-install',
          nativePermission: 'default',
          subscribed: false,
          subscriptionId: null,
          iosInstallRequired: true,
        });
        return;
      }
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId,
            serviceWorkerPath: '/onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/onesignal/' },
          });
          activeSdk = OneSignal;
          if (identity.isOwner && identity.userId) {
            await OneSignal.login(identity.userId);
          } else {
            await OneSignal.logout();
          }
          attachSdkListeners(OneSignal);
          refreshState();
        } catch {
          emit({
            ready: true,
            isOwner: identity.isOwner,
            status: identity.isOwner ? 'error' : 'not-owner',
            nativePermission: 'default',
            subscribed: false,
            subscriptionId: null,
            iosInstallRequired: identity.isOwner && isIosDevice() && !isStandalone(),
          });
        }
      });
      loadSdkScript();
    });
  }, []);

  return null;
}
