'use client';

import { Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/app/ui';
import { apiPatch, invalidate } from '@/lib/client/api';
import { TIMEZONES, US_STATES, useSettings, type SettingsPayload } from '../settings-shared';

type Form = Omit<SettingsPayload['workspace'], 'id'>;

const PRIMARY_MARKETS = ['NJ', 'NY', 'PA', 'CT', 'DE', 'MD', 'MA', 'DC'];

export default function GeneralSettingsPage() {
  const { data, mutate } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAllStates, setShowAllStates] = useState(false);

  useEffect(() => {
    if (data) {
      const { id: _id, ...rest } = data.workspace;
      setForm(rest);
    }
  }, [data]);

  const dirty = useMemo(() => {
    if (!data || !form) return false;
    const { id: _id, ...orig } = data.workspace;
    return JSON.stringify(orig) !== JSON.stringify(form);
  }, [data, form]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const toggleMarket = (code: string) =>
    set('markets', form?.markets.includes(code) ? form.markets.filter((m) => m !== code) : [...(form?.markets ?? []), code]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const next = await apiPatch<SettingsPayload>('/api/settings', {
        workspaceName: form.name.trim() || 'Puma Utilities',
        companyName: form.companyName,
        companyAddress: form.companyAddress,
        timezone: form.timezone,
        markets: form.markets,
        website: form.website,
        phone: form.phone,
      });
      await mutate(next, { revalidate: false });
      void invalidate('/api/dashboard');
      void invalidate('/api/mail');
      toast.success('Workspace settings saved');
    } catch (e) {
      toast.error('Could not save settings', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const tzOptions = form && !TIMEZONES.some((t) => t.value === form.timezone) ? [...TIMEZONES, { value: form.timezone, label: form.timezone }] : TIMEZONES;
  const visibleStates = showAllStates ? US_STATES : US_STATES.filter(([code]) => PRIMARY_MARKETS.includes(code) || form?.markets.includes(code));

  return (
    <div className="page page--narrow">
      <PageHeader title="General" subtitle="Workspace details used across the CRM and in every email you send." back={{ href: '/settings', label: 'Settings' }} />
      {!form ? (
        <Card>
          <div className="stack">
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={92} />
          </div>
        </Card>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Card title="Workspace">
            <div className="settings-form">
              <Field label="Workspace name" required>
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
              </Field>
              <div className="settings-form__row">
                <Field label="Website">
                  <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="pumautilities.com" inputMode="url" autoCapitalize="off" />
                </Field>
                <Field label="Main phone">
                  <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(201) 555-0100" type="tel" inputMode="tel" />
                </Field>
              </div>
              <Field label="Time zone" hint="Used for due dates, “today” on the dashboard and campaign sending windows.">
                <Select value={form.timezone} onChange={(e) => set('timezone', e.target.value)} options={tzOptions} />
              </Field>
            </div>
          </Card>

          <Card title="Email footer" description="Required by CAN-SPAM on every marketing email.">
            <div className="settings-form">
              <Field label="Sender organization" hint="Defaults to the workspace name.">
                <Input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder={form.name || 'Puma Utilities LLC'} />
              </Field>
              <Field label="Physical mailing address" hint="A valid street address or registered P.O. box. Campaigns can't send without it.">
                <Textarea
                  value={form.companyAddress}
                  onChange={(e) => set('companyAddress', e.target.value)}
                  rows={3}
                  placeholder={'Puma Utilities LLC\n100 Harbor Blvd, Suite 400\nWeehawken, NJ 07086'}
                />
              </Field>
              {!form.companyAddress.trim() && (
                <div className="settings-note settings-note--accent">
                  <Info aria-hidden />
                  <span>Add a mailing address before launching campaigns.</span>
                </div>
              )}
            </div>
          </Card>

          <Card
            title="Markets"
            description={`${form.markets.length} state${form.markets.length === 1 ? '' : 's'} selected · the lead engine and filters default to these.`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowAllStates((v) => !v)}>
                {showAllStates ? 'Show fewer' : 'All states'}
              </Button>
            }
          >
            <div className="markets" role="group" aria-label="Markets">
              {visibleStates.map(([code, name]) => (
                <Chip key={code} selected={form.markets.includes(code)} onClick={() => toggleMarket(code)} title={name}>
                  {code}
                </Chip>
              ))}
            </div>
          </Card>

          <div className="settings-actions">
            <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
