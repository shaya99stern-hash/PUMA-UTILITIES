import Link from 'next/link';
import type { ReactNode } from 'react';
import { Activity, Building2, ChevronLeft, Settings, SlidersHorizontal } from 'lucide-react';

type PumaSettingsShellProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  children: ReactNode;
};

function BrandMark({ size = 28 }: { size?: number }) {
  return <span className="pm-brand-mark" style={{ width: size, height: size }} aria-hidden="true" />;
}

export default function PumaSettingsShell({ title, subtitle, backHref, children }: PumaSettingsShellProps) {
  return (
    <main className="pm-shell pm-settings-shell">
      <aside className="pm-desktop-sidebar">
        <div className="pm-desktop-brand"><BrandMark size={30} /><span><strong>Puma Utilities</strong><small>Water Intelligence</small></span></div>
        <nav className="pm-desktop-nav" aria-label="Desktop navigation">
          <Link href="/"><BrandMark size={20} /><span>Home</span></Link>
          <Link href="/clients"><Building2 size={19} /><span>Companies</span></Link>
          <Link href="/engine"><SlidersHorizontal size={19} /><span>Find Leads</span></Link>
          <Link href="/monitor"><Activity size={19} /><span>Monitor</span></Link>
          <Link href="/settings" className="active"><Settings size={19} /><span>Settings</span></Link>
        </nav>
      </aside>

      <div className="pm-main">
        <header className="pm-appbar pm-settings-appbar">
          <div className="pm-brand">
            <BrandMark size={28} />
            <span><strong>Puma Utilities</strong><small>{title}</small></span>
          </div>
        </header>

        <section className="pm-content">
          <div className="pm-page pm-settings-page">
            {backHref && <Link className="pm-back" href={backHref}><ChevronLeft size={17} /> Settings</Link>}
            <div className="pm-page-head">
              <div>
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
            </div>
            {children}
          </div>
        </section>

        <nav className="pm-bottom-nav pm-settings-bottom-nav" aria-label="Primary navigation">
          <Link href="/"><BrandMark size={22} /><span>Home</span></Link>
          <Link href="/clients"><Building2 size={19} /><span>Companies</span></Link>
          <Link href="/engine"><SlidersHorizontal size={19} /><span>Find Leads</span></Link>
          <Link href="/monitor"><Activity size={19} /><span>Monitor</span></Link>
        </nav>
      </div>
    </main>
  );
}
