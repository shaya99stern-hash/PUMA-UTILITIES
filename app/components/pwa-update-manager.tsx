'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'updating' | 'current' | 'error' | 'unsupported';
type VersionResponse = { deploymentId?: string };

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

export default function PwaUpdateManager({ currentDeploymentId }: { currentDeploymentId: string }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const lastCheckRef = useRef(0);
  const newerDeploymentRef = useRef(false);
  const reloadOnControllerChangeRef = useRef(false);
  const hasReloadedRef = useRef(false);

  const checkForUpdates = useCallback(async (announce = true) => {
    if (announce) setStatus('checking');

    try {
      const versionPromise = fetch('/api/version', { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) return undefined;
          return (await response.json()) as VersionResponse;
        });
      const registration = registrationRef.current;
      const registrationPromise = registration ? registration.update() : Promise.resolve(null);
      const [version, updatedRegistration] = await Promise.all([versionPromise, registrationPromise]);
      const deploymentChanged = Boolean(
        version?.deploymentId
          && version.deploymentId !== 'development'
          && version.deploymentId !== currentDeploymentId,
      );

      lastCheckRef.current = Date.now();
      newerDeploymentRef.current = deploymentChanged;

      if (updatedRegistration?.waiting || deploymentChanged) {
        setStatus('available');
      } else if (updatedRegistration?.installing) {
        if (announce) setStatus('checking');
      } else if (announce) {
        setStatus(registration ? 'current' : 'unsupported');
      }
    } catch {
      if (announce) setStatus('error');
    }
  }, [currentDeploymentId]);

  useEffect(() => {
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

    document.addEventListener('visibilitychange', handleVisibility);

    if (!('serviceWorker' in navigator)) {
      void checkForUpdates(false);
      return () => document.removeEventListener('visibilitychange', handleVisibility);
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        registrationRef.current = nextRegistration;
        nextRegistration.addEventListener('updatefound', handleUpdateFound);

        if (nextRegistration.waiting) setStatus('available');
        void checkForUpdates(false);
      })
      .catch(() => {
        if (!disposed) void checkForUpdates(false);
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

    if (registration?.waiting) {
      setStatus('updating');
      reloadOnControllerChangeRef.current = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    if (newerDeploymentRef.current) {
      setStatus('updating');
      window.location.reload();
      return;
    }

    await checkForUpdates(true);
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
        disabled={isBusy}
        onClick={status === 'available' ? applyUpdate : () => void checkForUpdates(true)}
      >
        {buttonLabel}
      </button>
    </aside>
  );
}
