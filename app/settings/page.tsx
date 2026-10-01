'use client';

import { Building, ChevronRight, Database, Plug, FileDown, Mail, Settings2, UserRound, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Avatar, PageHeader } from '@/app/ui';
import { useSettings } from './settings-shared';

type Row = { href: string; title: string; description: string; icon: LucideIcon };

const GROUPS: { label: string; rows: Row[] }[] = [
  { label: 'Account', rows: [{ href: '/settings/profile', title: 'Profile', description: 'Your name, title and phone for emails and records', icon: UserRound }] },
  {
    label: 'Workspace',
    rows: [
      { href: '/settings/general', title: 'General', description: 'Workspace name, mailing address, time zone and markets', icon: Settings2 },
      { href: '/settings/team', title: 'Team', description: 'Members and invitations', icon: Users },
    ],
  },
  { label: 'Email', rows: [{ href: '/settings/email', title: 'Email accounts & sending', description: 'Connect mailboxes, signatures, limits and sending windows', icon: Mail }] },
  {
    label: 'Data',
    rows: [
      { href: '/settings/data-sources', title: 'Data sources', description: 'Public records the lead engine uses and their health', icon: Database },
      { href: '/settings/connectors', title: 'Connectors', description: 'Add your own data sources and API keys — the engine uses them automatically', icon: Plug },
      { href: '/settings/import-export', title: 'Import & export', description: 'Upload a CSV of companies or download your data', icon: FileDown },
    ],
  },
];

export default function SettingsPage() {
  const { data } = useSettings();
  const name = data?.profile.full_name || data?.profile.email || null;
  return (
    <div className="page page--narrow">
      <PageHeader title="Settings" subtitle="Manage your workspace, team, email and data." />
      <div className="settings-groups">
        <Link href="/settings/general" className="settings-list ui-list__item" style={{ minHeight: 72 }}>
          <Avatar name={data?.workspace.name ?? 'Puma Utilities'} square size="lg" />
          <div className="ui-list__main">
            <span className="ui-list__title" style={{ fontSize: 15 }}>
              {data?.workspace.name ?? 'Puma Utilities'}
            </span>
            <span className="ui-list__sub">
              {data ? (data.signedIn ? `Signed in${name ? ` as ${name}` : ''} · ${data.role}` : 'Shared workspace · sign-in optional') : ' '}
            </span>
          </div>
          <span className="ui-list__end">
            <Building size={16} aria-hidden />
            <ChevronRight aria-hidden />
          </span>
        </Link>
        {GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="section-title settings-group__label">{group.label}</h2>
            <div className="settings-list">
              {group.rows.map((row) => {
                const Icon = row.icon;
                return (
                  <Link key={row.href} href={row.href} className="ui-list__item">
                    <span className="settings-icon">
                      <Icon aria-hidden />
                    </span>
                    <span className="ui-list__main">
                      <span className="ui-list__title">{row.title}</span>
                      <span className="ui-list__sub" style={{ whiteSpace: 'normal' }}>
                        {row.description}
                      </span>
                    </span>
                    <span className="ui-list__end">
                      <ChevronRight aria-hidden />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
