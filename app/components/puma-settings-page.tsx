import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

type PumaSettingsPageProps = {
  title: string;
  backHref?: string;
  children: ReactNode;
};

export default function PumaSettingsPage({ title, backHref, children }: PumaSettingsPageProps) {
  return (
    <div className="pu-settings-page">
      {backHref && <Link className="pu-settings-back" href={backHref}><ChevronLeft size={17} /> Settings</Link>}
      <div className="pu-settings-head"><h1>{title}</h1></div>
      {children}
    </div>
  );
}
