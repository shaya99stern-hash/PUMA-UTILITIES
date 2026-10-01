'use client';

import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Card, PageHeader, Skeleton, formatRelative, type BadgeTone } from '@/app/ui';

type Source = {
  id: string;
  label: string;
  description?: string;
  coverage?: string;
  url?: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown' | 'disabled';
  lastOkAt?: string | null;
  lastError?: string | null;
};

/** Shown until the engine exposes live health at /api/research/sources. */
const STATIC_SOURCES: Source[] = [
  { id: 'hud-multifamily', label: 'HUD Multifamily Assistance & Section 8 Contracts', coverage: 'Nationwide', description: 'Assisted multifamily properties, unit counts and owner/management agents.', status: 'unknown' },
  { id: 'nyc-hpd-registrations', label: 'NYC HPD Registrations + Contacts', coverage: 'New York City', description: 'Registered owners, head officers and managing agents for residential buildings.', status: 'unknown' },
  { id: 'nyc-pluto', label: 'NYC PLUTO', coverage: 'New York City', description: 'Tax-lot data: residential units, building area, year built.', status: 'unknown' },
  { id: 'nyc-ll84', label: 'NYC Energy & Water Benchmarking (LL84)', coverage: 'New York City', description: 'Reported annual water use for large buildings.', status: 'unknown' },
  { id: 'nys-tax-parcels', label: 'NYS Public Tax Parcels', coverage: 'New York State', description: 'Parcel ownership and property class outside NYC.', status: 'unknown' },
  { id: 'nj-mod4', label: 'NJ Parcels + MOD-IV', coverage: 'New Jersey', description: 'Statewide tax list: owners, mailing addresses and property class.', status: 'unknown' },
  { id: 'phila-opa', label: 'Philadelphia Office of Property Assessment', coverage: 'Philadelphia', description: 'Owners, units and assessed values for Philadelphia properties.', status: 'unknown' },
  { id: 'business-registries', label: 'NY / NJ / PA business entity records', coverage: 'NY, NJ, PA', description: 'Resolve LLC owners to parent companies and officers.', status: 'unknown' },
  { id: 'epa-water', label: 'EPA & state water service areas', coverage: 'Nationwide', description: 'Which utility serves a building, for tariff-based water cost estimates.', status: 'unknown' },
  { id: 'sec-edgar', label: 'SEC EDGAR', coverage: 'Nationwide', description: 'REIT and public company portfolios.', status: 'unknown' },
  { id: 'first-party-web', label: 'Company websites', coverage: 'Web', description: 'Portfolio pages, leadership and published contact details.', status: 'unknown' },
];

const STATUS: Record<Source['status'], { tone: BadgeTone; label: string }> = {
  ok: { tone: 'success', label: 'Healthy' },
  degraded: { tone: 'warning', label: 'Degraded' },
  down: { tone: 'danger', label: 'Failing' },
  disabled: { tone: 'neutral', label: 'Paused' },
  unknown: { tone: 'neutral', label: 'Not checked' },
};

function normalizeStatus(value: unknown, row: Record<string, unknown>): Source['status'] {
  const v = String(value ?? '').toLowerCase();
  if (['ok', 'healthy', 'up', 'active', 'green'].includes(v)) return 'ok';
  if (['degraded', 'slow', 'warning', 'yellow'].includes(v)) return 'degraded';
  if (['down', 'error', 'failing', 'failed', 'red'].includes(v)) return 'down';
  if (['disabled', 'paused', 'off'].includes(v)) return 'disabled';
  if (typeof row.consecutive_errors === 'number') return row.consecutive_errors > 2 ? 'down' : row.consecutive_errors > 0 ? 'degraded' : row.last_ok_at ? 'ok' : 'unknown';
  if (typeof row.ok === 'boolean') return row.ok ? 'ok' : 'down';
  return 'unknown';
}

function normalize(body: unknown): Source[] | null {
  const list = Array.isArray(body) ? body : Array.isArray((body as { sources?: unknown })?.sources) ? (body as { sources: unknown[] }).sources : null;
  if (!list) return null;
  return list.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const health = (r.health ?? {}) as Record<string, unknown>;
    const merged = { ...health, ...r };
    const geos = Array.isArray(r.geographies) ? (r.geographies as string[]).join(', ') : undefined;
    return {
      id: String(r.id ?? i),
      label: String(r.label ?? r.name ?? r.title ?? r.id ?? 'Source'),
      description: typeof r.description === 'string' ? r.description : Array.isArray(r.notes) ? undefined : undefined,
      coverage: typeof r.coverage === 'string' ? r.coverage : geos,
      url: typeof r.url === 'string' ? r.url : undefined,
      status: normalizeStatus(r.status ?? health.status, merged),
      lastOkAt: (merged.lastOkAt ?? merged.last_ok_at ?? null) as string | null,
      lastError: (merged.lastError ?? merged.last_error ?? null) as string | null,
    };
  });
}

export default function DataSourcesPage() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/research/sources', { cache: 'no-store' })
      .then(async (res) => (res.ok ? normalize(await res.json()) : null))
      .catch(() => null)
      .then((list) => {
        if (cancelled) return;
        setLive(!!list?.length);
        setSources(list?.length ? list : STATIC_SOURCES);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page page--narrow">
      <PageHeader title="Data sources" subtitle="Public records the lead engine combines to find and qualify multifamily owners." back={{ href: '/settings', label: 'Settings' }} />
      <div className="stack">
        <div className="settings-note">
          <ShieldCheck aria-hidden />
          <span>
            Puma only uses public records and first-party websites. Every fact on a record keeps its source and retrieval date as evidence.
            {!live && sources && ' Live health checks appear here once the engine has run.'}
          </span>
        </div>
        <Card flush>
          {!sources ? (
            <div style={{ padding: 16 }}>
              <Skeleton lines={5} height={16} />
            </div>
          ) : (
            <ul className="ui-list">
              {sources.map((s) => {
                const status = STATUS[s.status];
                return (
                  <li key={s.id} className="ui-list__item" style={{ alignItems: 'flex-start' }}>
                    <div className="ui-list__main">
                      <span className="ui-list__title" style={{ whiteSpace: 'normal' }}>
                        {s.label}
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="subtle" aria-label="Open source" style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: '-2px' }}>
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </span>
                      {s.description && (
                        <span className="ui-list__sub" style={{ whiteSpace: 'normal' }}>
                          {s.description}
                        </span>
                      )}
                      <span className="text-xs subtle">
                        {[s.coverage, s.lastOkAt ? `Last success ${formatRelative(s.lastOkAt)}` : null].filter(Boolean).join(' · ')}
                        {s.status === 'down' && s.lastError ? ` · ${s.lastError}` : ''}
                      </span>
                    </div>
                    <span className="ui-list__end">
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
