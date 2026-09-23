'use client';

import { useCallback, useEffect, useState } from 'react';

const VERSION_STORAGE_KEY = 'puma-app-version';
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

type VersionPayload = { version?: string };
type UpdateState = 'idle' | 'available' | 'updating';

function storedVersion() {
  try {
    return window.localStorage.getItem(VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberVersion(version: string) {
  try {
    window.localStorage.setItem(VERSION_STORAGE_KEY, version);
  } catch {
    // Local storage is optional; update checks still work for this session.
  }
}

async function fetchVersion() {
  const response = await fetch(`/api/version?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return '';
  const payload = await response.json() as VersionPayload;
  return payload.version?.trim() ?? '';
}

export default function PwaUpdateManager() {
  const [state, setState] = useState<UpdateState>('idle');
  const [latestVersion, setLatestVersion] = useState('');

  const checkForUpdate = useCallback(async () => {
    if (!navigator.onLine) return;

    try {
      const version = await fetchVersion();
      if (!version) return;

      setLatestVersion(version);
      const previous = storedVersion();
      if (!previous) {
        rememberVersion(version);
        return;
      }

      if (previous !== version) setState('available');
    } catch {
      // Update checks must never block normal app use.
    }
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;

    const flagWaitingWorker = () => {
      if (!cancelled) setState('available');
    };

    const watchInstallingWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) flagWaitingWorker();
      });
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        if (registration.waiting) flagWaitingWorker();
        registration.addEventListener('updatefound', () => watchInstallingWorker(registration?.installing ?? null));
        await registration.update();
      } catch {
        // PWA update support is progressive enhancement.
      }
      await checkForUpdate();
    };

    const checkWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void registration?.update();
      void checkForUpdate();
    };

    const timer = window.setInterval(checkWhenVisible, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('online', checkWhenVisible);
    window.addEventListener('focus', checkWhenVisible);
    void register();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('online', checkWhenVisible);
      window.removeEventListener('focus', checkWhenVisible);
    };
  }, [checkForUpdate]);

  const applyUpdate = async () => {
    setState('updating');
    let version = latestVersion;

    try {
      if (!version) version = await fetchVersion();
      const registration = await navigator.serviceWorker.getRegistration('/');
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      registration?.active?.postMessage({ type: 'CLEAR_STALE_PUMA_CACHES' });
      await registration?.update();
    } catch {
      // A network-first reload below is still the safest fallback.
    }

    if (version) rememberVersion(version);
    window.location.reload();
  };

  if (state === 'idle') return null;

  return (
    <aside className="puma-update-card" role="status" aria-live="polite">
      <div>
        <strong>{state === 'updating' ? 'Updating Puma Utilities…' : 'Puma Utilities update ready'}</strong>
        <span>{state === 'updating' ? 'Loading the newest deployed version.' : 'Get the latest version without deleting or re-adding the app.'}</span>
      </div>
      {state === 'available' && <button type="button" onClick={() => void applyUpdate()}>Update app</button>}
      <style jsx>{`
        .puma-update-card {
          position: fixed;
          z-index: 80;
          right: max(14px, env(safe-area-inset-right));
          bottom: calc(92px + env(safe-area-inset-bottom));
          width: min(360px, calc(100vw - 28px));
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px 14px;
          border: 1px solid rgba(255,255,255,.11);
          border-radius: 15px;
          background: rgba(14,16,18,.97);
          box-shadow: 0 18px 50px rgba(0,0,0,.38);
          color: #f5f5f3;
          font-family: inherit;
        }
        .puma-update-card div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .puma-update-card strong { font-size: 12.5px; font-weight: 650; }
        .puma-update-card span { color: #91969b; font-size: 10.5px; line-height: 1.35; }
        .puma-update-card button {
          flex: 0 0 auto;
          min-height: 36px;
          padding: 0 12px;
          border: 1px solid rgba(255,111,36,.38);
          border-radius: 10px;
          background: rgba(255,111,36,.12);
          color: #ff762c;
          font: inherit;
          font-size: 11.5px;
          font-weight: 650;
        }
        @media (min-width: 900px) {
          .puma-update-card { bottom: 20px; }
        }
      `}</style>
    </aside>
  );
}
