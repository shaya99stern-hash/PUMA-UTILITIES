'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const VERSION_STORAGE_KEY = 'puma-app-version';
const UPDATE_CONFIRM_KEY = 'puma-update-confirm-version';
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

type VersionPayload = { version?: string };
type UpdateState = 'idle' | 'available' | 'updating' | 'updated' | 'current';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

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

function markUpdateForConfirmation(version: string) {
  try {
    window.sessionStorage.setItem(UPDATE_CONFIRM_KEY, version);
  } catch {
    // The reload still works even if session storage is unavailable.
  }
}

function takePendingConfirmation() {
  try {
    const version = window.sessionStorage.getItem(UPDATE_CONFIRM_KEY) ?? '';
    window.sessionStorage.removeItem(UPDATE_CONFIRM_KEY);
    return version;
  } catch {
    return '';
  }
}

function isInstalledPwa() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as NavigatorWithStandalone).standalone === true;
}

async function fetchVersion() {
  const response = await fetch(`/api/version?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return '';
  const payload = await response.json() as VersionPayload;
  return payload.version?.trim() ?? '';
}

async function prepareLatestWorker(registration?: ServiceWorkerRegistration) {
  const activeRegistration = registration ?? await navigator.serviceWorker.getRegistration('/');
  activeRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  activeRegistration?.active?.postMessage({ type: 'CLEAR_STALE_PUMA_CACHES' });
  await activeRegistration?.update();
}

export default function PwaUpdateManager() {
  const [state, setState] = useState<UpdateState>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [standalone, setStandalone] = useState(false);
  const reloadRequested = useRef(false);

  const showTransientState = useCallback((nextState: 'updated' | 'current') => {
    setState(nextState);
    window.setTimeout(() => setState('idle'), 4200);
  }, []);

  const reloadOnce = useCallback(() => {
    if (reloadRequested.current) return;
    reloadRequested.current = true;
    window.location.reload();
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!navigator.onLine) return '';

    try {
      const version = await fetchVersion();
      if (!version) return '';

      setLatestVersion(version);
      const previous = storedVersion();
      if (!previous) {
        rememberVersion(version);
        return '';
      }

      if (previous !== version) {
        setState('available');
        return version;
      }
    } catch {
      // Update checks must never block normal app use.
    }
    return '';
  }, []);

  useEffect(() => {
    setStandalone(isInstalledPwa());

    const pendingConfirmation = takePendingConfirmation();
    if (pendingConfirmation) {
      void fetchVersion().then((version) => {
        if (version && version === pendingConfirmation) {
          rememberVersion(version);
          setLatestVersion(version);
          showTransientState('updated');
        }
      }).catch(() => undefined);
    }

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

    const takeLatestInstalledVersion = async (version: string) => {
      if (!version || !isInstalledPwa() || cancelled) return;
      setState('updating');
      rememberVersion(version);
      markUpdateForConfirmation(version);
      try {
        await prepareLatestWorker(registration);
      } finally {
        if (!cancelled) reloadOnce();
      }
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
      const version = await checkForUpdate();
      await takeLatestInstalledVersion(version);
    };

    const checkWhenVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await registration?.update();
      } catch {
        // The deployment-version check below still provides a refresh path.
      }
      const version = await checkForUpdate();
      await takeLatestInstalledVersion(version);
    };

    const handleControllerChange = () => {
      if (!cancelled && state === 'updating') reloadOnce();
    };

    const timer = window.setInterval(() => void checkWhenVisible(), UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('online', checkWhenVisible);
    window.addEventListener('focus', checkWhenVisible);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    void register();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('online', checkWhenVisible);
      window.removeEventListener('focus', checkWhenVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, [checkForUpdate, reloadOnce, showTransientState, state]);

  const applyUpdate = async () => {
    setState('updating');
    let version = latestVersion;

    try {
      if (!version) version = await fetchVersion();
      if (version) {
        rememberVersion(version);
        markUpdateForConfirmation(version);
      }
      await prepareLatestWorker();
    } catch {
      // A network-first reload below is still the safest fallback.
    }

    reloadOnce();
  };

  const refreshApp = async () => {
    setState('updating');
    try {
      const before = storedVersion();
      const version = await fetchVersion();
      await prepareLatestWorker();

      if (version && before && version === before) {
        setLatestVersion(version);
        showTransientState('current');
        return;
      }

      if (version) {
        rememberVersion(version);
        markUpdateForConfirmation(version);
      }
      reloadOnce();
    } catch {
      setState('idle');
    }
  };

  if (state === 'idle' && standalone) {
    return (
      <button className="puma-refresh-button" type="button" onClick={() => void refreshApp()} aria-label="Refresh app and check for updates">
        Update app
        <style jsx>{`
          .puma-refresh-button {
            position: fixed;
            z-index: 79;
            right: max(14px, env(safe-area-inset-right));
            bottom: calc(92px + env(safe-area-inset-bottom));
            min-height: 38px;
            padding: 0 13px;
            border: 1px solid rgba(255,255,255,.11);
            border-radius: 11px;
            background: rgba(14,16,18,.94);
            color: #b8bcc0;
            box-shadow: 0 14px 34px rgba(0,0,0,.28);
            font: inherit;
            font-size: 11px;
            font-weight: 650;
          }
          @media (min-width: 900px) { .puma-refresh-button { bottom: 20px; } }
        `}</style>
      </button>
    );
  }

  if (state === 'idle') return null;

  const title = state === 'updating'
    ? 'Updating Puma Utilities…'
    : state === 'updated'
      ? 'Updated successfully'
      : state === 'current'
        ? 'Puma is already up to date'
        : 'Puma Utilities update ready';
  const detail = state === 'updating'
    ? 'Installing the newest deployed version.'
    : state === 'updated'
      ? `You are now running ${latestVersion || 'the newest build'}.`
      : state === 'current'
        ? `Current build ${latestVersion || 'is already the newest version'}.`
        : 'Get the latest version without deleting or re-adding the app.';

  return (
    <aside className="puma-update-card" role="status" aria-live="polite">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {state === 'available' && <button type="button" aria-label="Update app" onClick={() => void applyUpdate()}>Update &amp; refresh</button>}
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
