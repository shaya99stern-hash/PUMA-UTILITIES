'use client';

import { Info, LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, Button, Card, Field, Input, PageHeader, Skeleton, useToast } from '@/app/ui';
import { apiPatch, invalidate } from '@/lib/client/api';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { useSettings } from '../settings-shared';

export default function ProfileSettingsPage() {
  const { data, mutate } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', title: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (data) setForm({ full_name: data.profile.full_name, title: data.profile.title, phone: data.profile.phone });
  }, [data]);

  const dirty = !!data && (form.full_name !== data.profile.full_name || form.title !== data.profile.title || form.phone !== data.profile.phone);

  const save = async () => {
    setSaving(true);
    try {
      await mutate(await apiPatch('/api/settings', { profile: form }), { revalidate: false });
      void invalidate('/api/dashboard');
      toast.success('Profile saved');
    } catch (e) {
      toast.error('Could not save profile', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabaseBrowser().auth.signOut();
    } finally {
      window.location.href = '/';
    }
  };

  return (
    <div className="page page--narrow">
      <PageHeader title="Profile" subtitle="How you appear on activity, tasks and outgoing email." back={{ href: '/settings', label: 'Settings' }} />
      <div className="stack">
        {data && !data.signedIn && (
          <div className="settings-note settings-note--accent">
            <Info aria-hidden />
            <span>
              You&apos;re using Puma without signing in, so this profile is saved to the shared workspace. Sign in to keep a personal profile.
            </span>
          </div>
        )}
        <Card>
          {!data ? (
            <div className="stack">
              <Skeleton height={44} width={44} radius={22} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          ) : (
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="row" style={{ gap: 14 }}>
                <Avatar name={form.full_name || data.profile.email || 'You'} size="lg" />
                <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="truncate">{form.full_name || 'Your name'}</strong>
                  <span className="text-sm subtle truncate">{data.profile.email || 'Not signed in'}</span>
                </div>
              </div>
              <Field label="Full name">
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Alex Rivera" autoComplete="name" />
              </Field>
              <div className="settings-form__row">
                <Field label="Title">
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Business Development" autoComplete="organization-title" />
                </Field>
                <Field label="Phone" hint="Used in email signatures and merge fields.">
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(201) 555-0142" type="tel" autoComplete="tel" inputMode="tel" />
                </Field>
              </div>
              {data.signedIn && (
                <Field label="Email" hint="Your sign-in email can't be changed here.">
                  <Input value={data.profile.email} disabled readOnly />
                </Field>
              )}
              <div className="settings-actions">
                <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
                  Save changes
                </Button>
              </div>
            </form>
          )}
        </Card>
        <Card title="Session" description={data?.signedIn ? 'You are signed in on this device.' : 'Sign-in is optional. Everyone can use the shared workspace.'}>
          {data?.signedIn ? (
            <Button variant="danger" icon={LogOut} loading={signingOut} onClick={() => void signOut()}>
              Sign out
            </Button>
          ) : (
            <Button icon={LogIn} href="/login">
              Sign in
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
