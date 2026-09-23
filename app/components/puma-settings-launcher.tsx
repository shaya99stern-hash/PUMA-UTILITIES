'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';

export default function PumaSettingsLauncher() {
  const pathname = usePathname();
  const active = pathname.startsWith('/settings');

  return (
    <Link
      href="/settings"
      className={`pm-settings-launcher ${active ? 'active' : ''}`}
      aria-label="Settings"
      aria-current={active ? 'page' : undefined}
    >
      <Settings size={20} />
      <span>Settings</span>
    </Link>
  );
}
