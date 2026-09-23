import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bell, Building2, House, Search, Settings } from 'lucide-react';
import { PRIMARY_NAV, SETTINGS_ROUTE, type PumaPrimaryRouteId, type PumaShellRouteId } from '@/lib/puma-navigation';
import PumaBrandMark from './puma-brand-mark';

const NAV_ICONS: Record<PumaPrimaryRouteId, typeof House> = {
  home: House,
  clients: Building2,
  engine: Search,
  monitor: Bell,
};

type PumaAppShellProps = {
  currentRoute: PumaShellRouteId;
  pageLabel: string;
  headerAction?: ReactNode;
  children: ReactNode;
};

export default function PumaAppShell({ currentRoute, pageLabel, headerAction, children }: PumaAppShellProps) {
  return (
    <main className="pu-shell" data-route={currentRoute}>
      <aside className="pu-sidebar">
        <div className="pu-sidebar-brand">
          <PumaBrandMark size={30} />
          <span><strong>Puma Utilities</strong><small>Water Intelligence</small></span>
        </div>
        <nav className="pu-desktop-nav" aria-label="Desktop navigation">
          {PRIMARY_NAV.map((item) => {
            const Icon = NAV_ICONS[item.id];
            return (
              <Link key={item.id} href={item.href} className={currentRoute === item.id ? 'active' : ''} aria-current={currentRoute === item.id ? 'page' : undefined}>
                <Icon size={18} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <Link className={`pu-desktop-settings ${currentRoute === 'settings' ? 'active' : ''}`} href={SETTINGS_ROUTE.href} aria-current={currentRoute === 'settings' ? 'page' : undefined}>
          <Settings size={18} /><span>{SETTINGS_ROUTE.label}</span>
        </Link>
      </aside>

      <div className="pu-main">
        <header className="pu-appbar">
          <div className="pu-appbar-brand">
            <PumaBrandMark size={28} />
            <span><strong>Puma Utilities</strong><small>{pageLabel}</small></span>
          </div>
          {headerAction && <div className="pu-appbar-action">{headerAction}</div>}
        </header>

        <section className="pu-content">{children}</section>

        <nav className="pu-mobile-nav" aria-label="Primary navigation">
          {PRIMARY_NAV.map((item) => {
            const Icon = NAV_ICONS[item.id];
            return (
              <Link key={item.id} href={item.href} className={currentRoute === item.id ? 'active' : ''} aria-current={currentRoute === item.id ? 'page' : undefined}>
                <Icon size={19} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <Link className={`pu-mobile-settings ${currentRoute === 'settings' ? 'active' : ''}`} href={SETTINGS_ROUTE.href} aria-label="Settings" aria-current={currentRoute === 'settings' ? 'page' : undefined}>
          <Settings size={20} /><span>Settings</span>
        </Link>
      </div>
    </main>
  );
}
