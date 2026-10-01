import type { Metadata } from 'next';
import { BrandMark } from '@/app/ui/brand-mark';
import { OfflineRetry } from './retry';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main className="auth">
      <div className="auth__panel" style={{ textAlign: 'center' }}>
        <div className="auth__brand">
          <BrandMark size={56} />
          <div>
            <h1 className="auth__title">You&apos;re offline</h1>
            <p className="auth__sub">Puma needs a connection to load your workspace. We&apos;ll pick up right where you left off once you&apos;re back online.</p>
          </div>
        </div>
        <OfflineRetry />
      </div>
    </main>
  );
}
