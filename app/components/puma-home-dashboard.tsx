'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Bell, Building2, CalendarCheck, ChevronRight, Settings, SlidersHorizontal } from 'lucide-react';
import { buildMonitorAlerts } from '@/lib/monitor';
import { companyLifecycle } from '@/lib/company-lifecycle';
import { companyPath } from '@/lib/client-routing';
import { stripLegacyReleaseOneSeeds } from '@/lib/seed';
import type { Company, Workspace } from '@/lib/types';
import { loadWorkspace } from '@/lib/workspace';

type CompanyWithFollowUp = Company & { followUpAt?: string };

type HomeTask = {
  id: string;
  title: string;
  detail: string;
  href: string;
};

function localDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(value?: string) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
}

export default function PumaHomeDashboard() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [todayKey, setTodayKey] = useState('');

  useEffect(() => {
    const target = document.querySelector('.pm-home');
    if (!(target instanceof HTMLElement)) return;
    setHost(target);

    const refresh = () => {
      setWorkspace(stripLegacyReleaseOneSeeds(loadWorkspace()));
      setTodayKey(localDayKey(new Date()));
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const model = useMemo(() => {
    const companies = workspace?.companies ?? [];
    const alerts = workspace ? buildMonitorAlerts(workspace) : [];
    const prospects = companies.filter((company) => companyLifecycle(company.stage) === 'Prospects');
    const followUpsToday = companies.filter((company) => {
      const status = companyLifecycle(company.stage);
      return status !== 'Not Interested' && (company as CompanyWithFollowUp).followUpAt?.slice(0, 10) === todayKey;
    });
    const upcomingCompanies = [...companies]
      .filter((company) => companyLifecycle(company.stage) !== 'Not Interested' && Boolean((company as CompanyWithFollowUp).followUpAt))
      .sort((left, right) => ((left as CompanyWithFollowUp).followUpAt ?? '').localeCompare((right as CompanyWithFollowUp).followUpAt ?? ''))
      .slice(0, 3);
    const recentlyUpdatedCompanies = [...companies]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 3);

    const tasks: HomeTask[] = [];
    if (alerts.length > 0) {
      tasks.push({
        id: 'monitor-alerts',
        title: `Review ${alerts.length} monitor alert${alerts.length === 1 ? '' : 's'}`,
        detail: 'Client-authorized monitoring needs attention.',
        href: '/monitor',
      });
    }
    for (const company of upcomingCompanies) {
      tasks.push({
        id: `follow-up-${company.id}`,
        title: `Follow up with ${company.name}`,
        detail: `${formatShortDate((company as CompanyWithFollowUp).followUpAt)} · ${company.market || 'Market not verified'}`,
        href: companyPath(company.id),
      });
      if (tasks.length >= 3) break;
    }
    if (tasks.length < 3 && prospects.length > 0) {
      tasks.push({
        id: 'review-prospects',
        title: 'Review prospect pipeline',
        detail: `${prospects.length} prospect${prospects.length === 1 ? '' : 's'} ready for the next action.`,
        href: '/clients',
      });
    }
    if (tasks.length === 0) {
      tasks.push({
        id: 'find-leads',
        title: companies.length === 0 ? 'Find your first lead' : 'Keep the pipeline moving',
        detail: companies.length === 0 ? 'Start with evidence-backed company research.' : 'Discover another qualified company.',
        href: '/engine',
      });
    }

    return { companies, alerts, prospects, followUpsToday, recentlyUpdatedCompanies, tasks: tasks.slice(0, 3) };
  }, [workspace, todayKey]);

  if (!host || !workspace) return null;

  return createPortal(
    <section className="pm-home-dashboard" aria-label="Puma workspace overview">
      <section className="pm-home-today" aria-label="Today">
        <div className="pm-home-section-head"><div><span>Today</span><strong>At a glance</strong></div></div>
        <div className="pm-home-metrics">
          <Link href="/clients"><strong>{model.followUpsToday.length}</strong><span>Follow-ups</span></Link>
          <Link href="/clients"><strong>{model.prospects.length}</strong><span>Prospects</span></Link>
          <Link href="/monitor"><strong>{model.alerts.length}</strong><span>Alerts</span></Link>
        </div>
      </section>

      <section className="pm-home-tasks" aria-label="Tasks">
        <div className="pm-home-section-head"><div><span>Tasks</span><strong>Next actions</strong></div><Link href="/clients">View companies</Link></div>
        <div className="pm-home-task-list">
          {model.tasks.map((task) => (
            <Link key={task.id} href={task.href}>
              <span className="pm-home-task-check" aria-hidden="true"><CalendarCheck size={16} /></span>
              <span><strong>{task.title}</strong><small>{task.detail}</small></span>
              <ChevronRight size={16} />
            </Link>
          ))}
        </div>
      </section>

      <section className="pm-home-quick-actions" aria-label="Quick actions">
        <div className="pm-home-section-head"><div><span>Quick actions</span><strong>Jump back in</strong></div></div>
        <div className="pm-home-action-grid">
          <Link href="/engine"><SlidersHorizontal size={18} /><span>Find leads</span></Link>
          <Link href="/clients"><Building2 size={18} /><span>Companies</span></Link>
          <Link href="/monitor"><Activity size={18} /><span>Monitor</span></Link>
          <Link href="/settings"><Settings size={18} /><span>Settings</span></Link>
        </div>
      </section>

      <section className="pm-home-recent" aria-label="Recent activity">
        <div className="pm-home-section-head"><div><span>Recent activity</span><strong>Companies</strong></div><Link href="/clients">Open all</Link></div>
        <div className="pm-home-recent-list">
          {model.recentlyUpdatedCompanies.length === 0 ? (
            <Link href="/engine" className="pm-home-recent-empty"><span><strong>No company activity yet</strong><small>Research a company when you are ready.</small></span><ChevronRight size={16} /></Link>
          ) : model.recentlyUpdatedCompanies.map((company) => (
            <Link key={company.id} href={companyPath(company.id)}>
              <span><strong>{company.name}</strong><small>{company.market || 'Market not verified'} · {companyLifecycle(company.stage)}</small></span>
              <ChevronRight size={16} />
            </Link>
          ))}
        </div>
      </section>
    </section>,
    host,
  );
}
