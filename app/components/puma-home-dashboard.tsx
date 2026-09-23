'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMonitorAlerts } from '@/lib/monitor';
import { companyLifecycle } from '@/lib/company-lifecycle';
import { stripLegacyReleaseOneSeeds } from '@/lib/seed';
import type { Company, Workspace } from '@/lib/types';
import { loadWorkspace } from '@/lib/workspace';

type CompanyWithFollowUp = Company & { followUpAt?: string };

function localDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function PumaHomeDashboard() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [todayKey, setTodayKey] = useState('');

  useEffect(() => {
    let observer: MutationObserver | null = null;

    const refresh = () => {
      setWorkspace(stripLegacyReleaseOneSeeds(loadWorkspace()));
      setTodayKey(localDayKey(new Date()));
    };

    const attach = () => {
      const target = document.querySelector('.pm-home');
      if (!(target instanceof HTMLElement)) return false;
      setHost(target);
      refresh();
      observer?.disconnect();
      observer = null;
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => { attach(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      observer?.disconnect();
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

    return { alerts, prospects, followUpsToday };
  }, [workspace, todayKey]);

  if (!host || !workspace) return null;

  return createPortal(
    <section className="pm-home-dashboard" aria-label="Puma workspace overview">
      <section className="pm-home-today" aria-label="Today at a glance">
        <div className="pm-home-section-head"><strong>Today at a glance</strong></div>
        <div className="pm-home-metrics">
          <Link href="/clients" aria-label={`${model.followUpsToday.length} follow-ups today`}><strong>{model.followUpsToday.length}</strong><span>Follow-ups</span></Link>
          <Link href="/clients" aria-label={`${model.prospects.length} prospects`}><strong>{model.prospects.length}</strong><span>Prospects</span></Link>
          <Link href="/monitor" aria-label={`${model.alerts.length} monitor alerts`}><strong>{model.alerts.length}</strong><span>Alerts</span></Link>
        </div>
      </section>
    </section>,
    host,
  );
}
