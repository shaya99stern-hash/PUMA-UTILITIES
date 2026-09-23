'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'updating' | 'current' | 'error' | 'unsupported';

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

function statusMessage(status: UpdateStatus) {
  switch (status) {
    case 'checking':
      return 'Checking for the newest Puma release…';
    case 'available':
      return 'A newer version is ready to install.';
    case 'updating':
      return 'Applying the update…';
    case 'current':
      return 'You’re on the latest version.';
    case 'error':
      return 'Update check failed. Try again.';
    case 'unsupported':
      return 'Updates are handled by this browser.';
    default:
      return 'Check for the newest Puma release.';
  }
}

export default function PwaUpdateManager() {
  const pathname = usePathname();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const lastCheckRef = useRef(0);
  const reloadOnControllerChangeRef = useRef(false);
  const hasReloadedRef = useRef(false);

  const checkForUpdates = useCallback(async (announce = true) => {
    const registration = registrationRef.current;
    if (!registration) {
      if (announce) setStatus('unsupported');
      return;
    }

    if (announce) setStatus('checking');

    try {
      const updatedRegistration = await registration.update();
      lastCheckRef.current = Date.now();

      if (updatedRegistration.waiting) {
        setStatus('available');
      } else if (updatedRegistration.installing) {
        if (announce) setStatus('checking');
      } else if (announce) {
        setStatus('current');
      }
    } catch {
      if (announce) setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setStatus('unsupported');
      return;
    }

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;

    const handleInstallingState = () => {
      if (disposed || !installingWorker) return;
      if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
        setStatus('available');
      }
    };

    const handleUpdateFound = () => {
      if (!registration) return;
      if (installingWorker) installingWorker.removeEventListener('statechange', handleInstallingState);
      installingWorker = registration.installing;
      installingWorker?.addEventListener('statechange', handleInstallingState);
    };

    const handleControllerChange = () => {
      if (!reloadOnControllerChangeRef.current || hasReloadedRef.current) return;
      hasReloadedRef.current = true;
      window.location.reload();
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckRef.current < UPDATE_CHECK_INTERVAL_MS) return;
      void checkForUpdates(false);
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    document.addEventListener('visibilitychange', handleVisibility);

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        registrationRef.current = nextRegistration;
        nextRegistration.addEventListener('updatefound', handleUpdateFound);

        if (nextRegistration.waiting) {
          setStatus('available');
          return;
        }

        void checkForUpdates(false);
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      registration?.removeEventListener('updatefound', handleUpdateFound);
      installingWorker?.removeEventListener('statechange', handleInstallingState);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkForUpdates]);

  const applyUpdate = useCallback(async () => {
    const registration = registrationRef.current;
    if (!registration) {
      setStatus('unsupported');
      return;
    }

    if (!registration.waiting) {
      await checkForUpdates(true);
      return;
    }

    setStatus('updating');
    reloadOnControllerChangeRef.current = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [checkForUpdates]);

  const showSettingsCard = pathname === '/settings';
  const showGlobalPrompt = status === 'available' || status === 'updating';
  if (!showSettingsCard && !showGlobalPrompt) return null;

  const isBusy = status === 'checking' || status === 'updating';
  const buttonLabel = status === 'available' ? 'Update app' : status === 'updating' ? 'Updating…' : status === 'checking' ? 'Checking…' : 'Check for updates';

  return (
    <aside className="puma-update-card" aria-live="polite" aria-label="Puma app updates">
      <div className="puma-update-copy">
        <strong>App updates</strong>
        <span>{statusMessage(status)}</span>
      </div>
      <button
        className="puma-update-button"
        type="button"
        disabled={isBusy || status === 'unsupported'}
        onClick={status === 'available' ? applyUpdate : () => void checkForUpdates(true)}
      >
        {buttonLabel}
      </button>
    </aside>
  );
}
