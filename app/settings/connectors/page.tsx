'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import { apiDelete, apiPatch, apiPost, useApi } from '@/lib/client/api';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Sheet, Skeleton, Textarea, formatRelative, useToast } from '@/app/ui';

type Preset = { kind: string; role: string; name: string; needsSecret: boolean; description: string; signupUrl?: string; dailyLimit: number };
type Connector = { id: string; name: string; kind: string; role: string; enabled: boolean; config: Record<string, unknown>; daily_limit: number; usage: { date?: string; count?: number }; last_test: { ok: boolean; message: string; at: string } | null; hasSecret: boolean };

const ROLE_LABEL: Record<string, string> = { buildings: 'Finds buildings', people: 'Finds people & emails', company: 'Company records', search: 'Web search' };
const BUILDING_FIELDS = ['address', 'city', 'state', 'zip', 'units', 'owner', 'mailing_street', 'mailing_city', 'mailing_zip', 'manager', 'contact_name', 'contact_title', 'contact_email', 'contact_phone', 'lat', 'lon', 'year_built', 'id'];
const PEOPLE_FIELDS = ['name', 'title', 'email', 'phone', 'linkedin'];
const COMPANY_FIELDS = ['company', 'website', 'phone', 'email', 'address'];

export default function ConnectorsPage() {
  const toast = useToast();
  const { data, mutate, isLoading } = useApi<{ connectors: Connector[]; presets: Preset[] }>('/api/settings/connectors');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const test = async (c: Connector) => {
    setTesting(c.id);
    try {
      const r = await apiPost<{ ok: boolean; message: string; sample: unknown[] }>(`/api/settings/connectors/${c.id}/test`, {});
      if (r.ok) toast.success(`${c.name} works`, r.message);
      else toast.error(`${c.name} test failed`, r.message);
      await mutate();
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="page page--narrow">
      <PageHeader back={{ href: '/settings', label: 'Settings' }} title="Connectors" subtitle="Add any data source or API key. The lead engine picks it up automatically and cross-references it with every built-in source." />

      <Card title="Your connectors" divided flush>
        {isLoading && !data ? <div style={{ padding: 16 }}><Skeleton height={60} /></div> : !data?.connectors.length ? (
          <EmptyState icon={Plug} title="No connectors yet" description="Everything works free out of the box. Add a county open-data dataset, an ArcGIS parcel layer, or optional free-tier keys (Hunter, Brave, Google Search, OpenCorporates) to go further." compact />
        ) : data.connectors.map((c) => (
          <div key={c.id} className="ui-list__item" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div className="stack-sm grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <strong>{c.name}</strong>
                <Badge outline>{ROLE_LABEL[c.role] ?? c.role}</Badge>
                {!c.enabled && <Badge>Off</Badge>}
                {c.last_test && (c.last_test.ok ? <Badge tone="success" icon={CheckCircle2}>Working</Badge> : <Badge tone="danger" icon={XCircle}>Failing</Badge>)}
              </div>
              <span className="subtle text-sm">
                {c.kind} · {c.usage?.date === new Date().toISOString().slice(0, 10) ? c.usage.count ?? 0 : 0}/{c.daily_limit} requests today
                {c.last_test ? ` · tested ${formatRelative(c.last_test.at)}: ${c.last_test.message}` : ''}
              </span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" icon={FlaskConical} loading={testing === c.id} onClick={() => test(c)}>Test</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await apiPatch(`/api/settings/connectors/${c.id}`, { enabled: !c.enabled }); await mutate(); }}>{c.enabled ? 'Turn off' : 'Turn on'}</Button>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" onClick={async () => { if (confirm(`Remove ${c.name}?`)) { await apiDelete(`/api/settings/connectors/${c.id}`); await mutate(); } }} />
            </div>
          </div>
        ))}
      </Card>

      <section className="stack" style={{ marginTop: 24 }}>
        <h2 className="section-title">Add a connector</h2>
        <div className="stack-sm">
          {(data?.presets ?? []).map((p) => (
            <Card key={`${p.kind}-${p.role}`} className="ui-list__item" style={{ cursor: 'pointer' }} onClick={() => setPreset(p)}>
              <div className="row-between" style={{ gap: 12 }}>
                <div className="stack-sm" style={{ minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  <span className="subtle text-sm">{p.description}</span>
                </div>
                <Button size="sm" icon={Plus} onClick={(e) => { e.stopPropagation(); setPreset(p); }}>Add</Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <AddSheet preset={preset} onClose={() => setPreset(null)} onAdded={async () => { setPreset(null); await mutate(); toast.success('Connector added', 'It will be used on the next search.'); }} />
    </div>
  );
}

function AddSheet({ preset, onClose, onAdded }: { preset: Preset | null; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [where, setWhere] = useState('');
  const [rowsPath, setRowsPath] = useState('');
  const [state, setState] = useState('');
  const [states, setStates] = useState('');
  const [secret, setSecret] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [authParam, setAuthParam] = useState('');
  const [cx, setCx] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const fieldList = useMemo(() => (preset?.role === 'buildings' ? BUILDING_FIELDS : preset?.role === 'people' ? PEOPLE_FIELDS : preset?.role === 'company' ? COMPANY_FIELDS : []), [preset]);
  const needsUrl = preset && ['socrata', 'arcgis', 'json'].includes(preset.kind);

  const save = async () => {
    if (!preset) return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = {};
      if (url) config.url = url.trim();
      if (where) config.where = where.trim();
      if (rowsPath) config.rowsPath = rowsPath.trim();
      if (state) config.state = state.trim().toUpperCase();
      if (states) config.states = states.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => s.length === 2);
      if (authHeader) config.authHeader = authHeader.trim();
      if (authParam) config.authParam = authParam.trim();
      if (cx) config.cx = cx.trim();
      if (jurisdiction) config.jurisdiction = jurisdiction.trim();
      const mapped = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()));
      if (Object.keys(mapped).length) config.fields = mapped;
      await apiPost('/api/settings/connectors', { name: name.trim() || preset.name, kind: preset.kind, role: preset.role, secret: secret || undefined, config });
      setName(''); setUrl(''); setWhere(''); setSecret(''); setFields({});
      onAdded();
    } catch (e) {
      toast.error('Could not add connector', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={Boolean(preset)} onClose={onClose} size="lg" title={preset ? `Add ${preset.name}` : ''} description={preset?.description}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Add connector</Button></>}>
      {preset && (
        <div className="stack">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={preset.name} /></Field>
          {preset.needsSecret && (
            <Field label="API key" hint={preset.signupUrl ? <>Get a free key at <a className="link" href={preset.signupUrl} target="_blank" rel="noreferrer">{preset.signupUrl}</a>. Stored encrypted.</> : 'Stored encrypted.'}>
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
            </Field>
          )}
          {preset.kind === 'google_cse' && <Field label="Search engine ID (cx)"><Input value={cx} onChange={(e) => setCx(e.target.value)} /></Field>}
          {preset.kind === 'opencorporates' && <Field label="Jurisdiction (optional)" hint="e.g. us_nj, us_ny, us_pa"><Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} /></Field>}
          {needsUrl && (
            <>
              <Field label={preset.kind === 'socrata' ? 'Socrata resource URL' : preset.kind === 'arcgis' ? 'ArcGIS layer URL' : 'URL template'} hint={preset.kind === 'socrata' ? 'https://data.<city>.gov/resource/abcd-1234.json' : preset.kind === 'arcgis' ? '…/FeatureServer/0 or …/MapServer/2' : 'Use {name}, {domain}, {city}, {state}, {address} (people/company) or {state}, {min_units}, {offset}, {limit} (buildings).'}>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              </Field>
              {preset.role === 'buildings' && (
                <Field label="Filter (optional)" hint="Socrata $where / ArcGIS where. You can use {min_units} and {state}.">
                  <Textarea rows={2} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="units >= {min_units}" />
                </Field>
              )}
              {preset.kind === 'json' && <Field label="Rows path" hint="Where the list lives in the JSON response, e.g. data.items"><Input value={rowsPath} onChange={(e) => setRowsPath(e.target.value)} /></Field>}
              {preset.role === 'buildings' && (
                <div className="grid-2">
                  <Field label="Default state" hint="If rows have no state column"><Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} /></Field>
                  <Field label="Covers states" hint="Comma separated; used when a search includes them"><Input value={states} onChange={(e) => setStates(e.target.value)} placeholder="PA, NJ" /></Field>
                </div>
              )}
              {preset.kind === 'json' && (
                <div className="grid-2">
                  <Field label="Auth header (optional)" hint="Header that carries the key, e.g. Authorization"><Input value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} /></Field>
                  <Field label="Auth query parameter (optional)" hint="e.g. api_key"><Input value={authParam} onChange={(e) => setAuthParam(e.target.value)} /></Field>
                </div>
              )}
              {preset.kind === 'json' && (
                <Field label="API key (optional)"><Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></Field>
              )}
              <div className="stack-sm">
                <span className="section-title">Field mapping</span>
                <span className="subtle text-sm">Column name (or dot path) in the source for each field. Leave blank to skip.</span>
                <div className="grid-2">
                  {fieldList.map((f) => (
                    <Field key={f} label={f.replace(/_/g, ' ')}>
                      <Input value={fields[f] ?? ''} onChange={(e) => setFields((cur) => ({ ...cur, [f]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
