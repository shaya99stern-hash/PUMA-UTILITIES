'use client';

import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buildingDetailPath } from '@/lib/client-routing';
import { buildMonitorAlerts } from '@/lib/monitor';
import type { Workspace } from '@/lib/types';
import { loadWorkspace } from '@/lib/workspace';
import PumaAppShell from './puma-app-shell';

function formatReadingPeriod(value?: string) {
  if (!value) return 'Period not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Period not recorded';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

export default function PumaMonitorWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    setWorkspace(loadWorkspace());
  }, []);

  const alerts = workspace ? buildMonitorAlerts(workspace) : [];

  return (
    <PumaAppShell currentRoute="monitor" pageLabel="Monitor">
      <div className="pm-monitor-page">
        <div className="pm-monitor-head">
          <h1>Monitor</h1>
          <p>Client-authorized water alerts</p>
        </div>

        {!workspace && <div className="pm-monitor-empty">Loading authorized client readings…</div>}

        {workspace && alerts.length === 0 && (
          <div className="pm-monitor-empty">
            <Bell size={22} />
            <strong>No alerts right now.</strong>
            <span>Alerts appear only from authorized readings for active clients.</span>
          </div>
        )}

        {workspace && alerts.length > 0 && (
          <div className="pm-monitor-list">
            {alerts.map((alert) => {
              const property = workspace.properties.find((item) => item.id === alert.propertyId);
              return (
                <Link className="pm-monitor-alert" href={buildingDetailPath(alert.companyId, alert.propertyId)} key={alert.id}>
                  <Bell size={18} />
                  <span className="pm-monitor-copy">
                    <strong>{alert.title}</strong>
                    <small>{property?.name || 'Building'} · {alert.meterLabel} · {formatReadingPeriod(alert.periodEnd)}</small>
                    <span>{alert.detail}</span>
                  </span>
                  <ChevronRight size={17} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <style>{`
        .pm-monitor-page { width:min(100%,760px); margin:0 auto; padding:24px 16px 32px; }
        .pm-monitor-head { margin-bottom:18px; }
        .pm-monitor-head h1 { margin:0; font-size:26px; line-height:1.08; letter-spacing:-.035em; font-weight:650; }
        .pm-monitor-head p { margin:5px 0 0; color:var(--pm-muted); font-size:12px; }
        .pm-monitor-list { border-top:1px solid var(--pm-line); }
        .pm-monitor-alert { min-height:78px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:start; gap:11px; padding:14px 2px; border-bottom:1px solid var(--pm-line); color:inherit; text-decoration:none; }
        .pm-monitor-alert > svg:first-child { margin-top:2px; color:#c7e0e5; }
        .pm-monitor-alert > svg:last-child { align-self:center; color:#777c81; }
        .pm-monitor-copy { min-width:0; display:flex; flex-direction:column; gap:4px; }
        .pm-monitor-copy strong { font-size:12.5px; font-weight:590; }
        .pm-monitor-copy small,.pm-monitor-copy > span { color:var(--pm-muted); font-size:10.5px; line-height:1.4; }
        .pm-monitor-empty { min-height:170px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; text-align:center; color:#c9cbcc; border-top:1px solid var(--pm-line); }
        .pm-monitor-empty span { max-width:360px; color:var(--pm-muted); font-size:11px; line-height:1.45; }
        @media (min-width:900px) { .pm-monitor-page { max-width:900px; padding:36px 48px 64px; } }
      `}</style>
    </PumaAppShell>
  );
}
