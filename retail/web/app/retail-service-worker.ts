let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export function ensureRetailServiceWorkerRegistration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.reject(new Error('service_worker_unavailable'));
  }
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
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

    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    void registration.update().catch(() => undefined);
    return navigator.serviceWorker.ready;
  })().catch((error) => {
    registrationPromise = null;
    throw error;
  });

  return registrationPromise;
}
