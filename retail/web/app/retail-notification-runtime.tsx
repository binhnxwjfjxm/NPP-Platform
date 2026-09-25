'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect } from 'react';

type RetailAuthMe = {
  data?: {
    userId?: string;
    isOwner?: boolean;
  };
};

type NativePermission = 'default' | 'granted' | 'denied';

type PushConfigEnvelope = {
  data?: {
    configured?: boolean;
    publicKey?: string | null;
  };
  error?: {
    message?: string;
  };
};

type MutationEnvelope = {
  data?: unknown;
  error?: {
    message?: string;
  };
};

type ServiceWorkerNotificationMessage = {
  type?: string;
  notification?: {
    title?: string;
    body?: string;
    salesOrderId?: string | null;
    orderNumber?: string | null;
    url?: string | null;
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

export const RETAIL_NOTIFICATION_FOREGROUND_EVENT = 'retail:notification-foreground';
export const RETAIL_NOTIFICATION_OPEN_EVENT = 'retail:notification-open';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let runtimeQueued = false;
let activeIdentity = { userId: '', isOwner: false };
let activeRegistration: ServiceWorkerRegistration | null = null;
let vapidPublicKey = '';
let serverRegistered = false;
let pendingRegisterKey: string | null = null;
let pendingRemoveKey: string | null = null;
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

function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function nativePermission(): NativePermission {
  if (typeof Notification === 'undefined') return 'default';
  return Notification.permission;
}

function emit(next: RetailNotificationState) {
  state = Object.freeze(next);
  for (const listener of listeners) listener(state);
}

function notificationDetail(input?: ServiceWorkerNotificationMessage['notification']): RetailForegroundNotification {
  const rawOrderId = String(input?.salesOrderId ?? '').trim();
  return Object.freeze({
    title: String(input?.title ?? 'Bán tại quầy').trim() || 'Bán tại quầy',
    body: String(input?.body ?? 'Có thông báo mới.').trim() || 'Có thông báo mới.',
    orderId: UUID_PATTERN.test(rawOrderId) ? rawOrderId : null,
    orderNumber: String(input?.orderNumber ?? '').trim() || null,
  });
}

function dispatchNotificationEvent(name: string, input?: ServiceWorkerNotificationMessage['notification']) {
  window.dispatchEvent(new CustomEvent<RetailForegroundNotification>(name, {
    detail: notificationDetail(input),
  }));
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function ensureRootServiceWorker() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations
    .filter((registration) => {
      try {
        return new URL(registration.scope).origin === window.location.origin
          && new URL(registration.scope).pathname !== '/';
      } catch {
        return false;
      }
    })
    .map((registration) => registration.unregister().catch(() => false)));
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
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

async function loadPushConfig() {
  const response = await fetch('/api/notifications/config', { method: 'GET', cache: 'no-store' });
  const payload = await response.json().catch(() => null) as PushConfigEnvelope | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? 'Kênh thông báo chưa sẵn sàng.');
  }
  const publicKey = String(payload?.data?.publicKey ?? '').trim();
  return {
    configured: payload?.data?.configured === true && Boolean(publicKey),
    publicKey,
  };
}

async function postMutation(path: string, body: unknown, key: string) {
  const response = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as MutationEnvelope | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? 'Không thể cập nhật thiết bị nhận thông báo.');
  }
  return payload?.data;
}

async function registerSubscription(subscription: PushSubscription) {
  const key = pendingRegisterKey ?? createIdempotencyKey('retail-web-push-subscribe');
  pendingRegisterKey = key;
  await postMutation('/api/notifications/subscriptions', {
    subscription: subscription.toJSON(),
  }, key);
  pendingRegisterKey = null;
  serverRegistered = true;
}

async function removeSubscription(subscription: PushSubscription) {
  const key = pendingRemoveKey ?? createIdempotencyKey('retail-web-push-unsubscribe');
  pendingRemoveKey = key;
  await postMutation('/api/notifications/subscriptions/remove', {
    endpoint: subscription.endpoint,
  }, key);
  pendingRemoveKey = null;
}

async function currentSubscription() {
  return activeRegistration ? activeRegistration.pushManager.getSubscription() : null;
}

async function refreshState() {
  const permission = nativePermission();
  const iosInstallRequired = activeIdentity.isOwner && isIosDevice() && !isStandalone();

  if (!activeIdentity.isOwner) {
    emit({ ready: true, isOwner: false, status: 'not-owner', nativePermission: permission, subscribed: false, subscriptionId: null, iosInstallRequired: false });
    return state;
  }
  if (iosInstallRequired) {
    emit({ ready: true, isOwner: true, status: 'needs-install', nativePermission: permission, subscribed: false, subscriptionId: null, iosInstallRequired: true });
    return state;
  }
  if (!pushSupported()) {
    emit({ ready: true, isOwner: true, status: 'unsupported', nativePermission: permission, subscribed: false, subscriptionId: null, iosInstallRequired: false });
    return state;
  }
  if (!vapidPublicKey) {
    emit({ ready: true, isOwner: true, status: 'not-configured', nativePermission: permission, subscribed: false, subscriptionId: null, iosInstallRequired: false });
    return state;
  }
  if (permission === 'denied') {
    emit({ ready: true, isOwner: true, status: 'blocked', nativePermission: permission, subscribed: false, subscriptionId: null, iosInstallRequired: false });
    return state;
  }
  if (permission !== 'granted') {
    emit({ ready: true, isOwner: true, status: 'not-enabled', nativePermission: permission, subscribed: false, subscriptionId: null, iosInstallRequired: false });
    return state;
  }

  const subscription = await currentSubscription();
  const subscribed = Boolean(subscription && serverRegistered);
  emit({
    ready: true,
    isOwner: true,
    status: subscribed ? 'subscribed' : 'not-subscribed',
    nativePermission: permission,
    subscribed,
    subscriptionId: subscribed ? subscription?.endpoint ?? null : null,
    iosInstallRequired: false,
  });
  return state;
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
  if (!pushSupported() || !activeRegistration || !vapidPublicKey) {
    throw new Error('Thông báo chưa sẵn sàng trên thiết bị này.');
  }
  if (Notification.permission === 'denied') {
    await refreshState();
    throw new Error('Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của thiết bị.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    await refreshState();
    throw new Error(permission === 'denied'
      ? 'Quyền thông báo đang bị chặn. Hãy bật lại trong Cài đặt của thiết bị.'
      : 'Chưa cấp quyền thông báo. Có thể bật lại khi sẵn sàng.');
  }

  let subscription = await activeRegistration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await activeRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });
  }
  await registerSubscription(subscription);
  return refreshState();
}

export async function unregisterRetailNotificationForLogout() {
  if (!activeRegistration || !activeIdentity.isOwner) return;
  const subscription = await activeRegistration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await removeSubscription(subscription);
  } finally {
    await subscription.unsubscribe().catch(() => false);
    serverRegistered = false;
    await refreshState().catch(() => undefined);
  }
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
    data?: { sentCount?: number };
  } | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? 'Chưa thể gửi thông báo thử.');
  }
  return payload?.data ?? {};
}

export function RetailNotificationRuntime() {
  useEffect(() => {
    if (runtimeQueued) return;
    runtimeQueued = true;

    const handleWorkerMessage = (event: MessageEvent<ServiceWorkerNotificationMessage>) => {
      if (!activeIdentity.isOwner) return;
      if (event.data?.type === 'retail:notification-foreground') {
        dispatchNotificationEvent(RETAIL_NOTIFICATION_FOREGROUND_EVENT, event.data.notification);
      }
      if (event.data?.type === 'retail:notification-open') {
        dispatchNotificationEvent(RETAIL_NOTIFICATION_OPEN_EVENT, event.data.notification);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleWorkerMessage);

    void currentIdentity().then(async (identity) => {
      activeIdentity = identity;
      if (!identity.isOwner) {
        await refreshState();
        return;
      }
      if (isIosDevice() && !isStandalone()) {
        await refreshState();
        return;
      }
      if (!pushSupported()) {
        await refreshState();
        return;
      }
      try {
        const config = await loadPushConfig();
        if (!config.configured) {
          await refreshState();
          return;
        }
        vapidPublicKey = config.publicKey;
        activeRegistration = await ensureRootServiceWorker();
        const subscription = await activeRegistration.pushManager.getSubscription();
        if (Notification.permission === 'granted' && subscription) {
          await registerSubscription(subscription);
        }
        await refreshState();
      } catch {
        emit({
          ready: true,
          isOwner: identity.isOwner,
          status: 'error',
          nativePermission: nativePermission(),
          subscribed: false,
          subscriptionId: null,
          iosInstallRequired: identity.isOwner && isIosDevice() && !isStandalone(),
        });
      }
    });

    return () => navigator.serviceWorker?.removeEventListener('message', handleWorkerMessage);
  }, []);

  return null;
}
