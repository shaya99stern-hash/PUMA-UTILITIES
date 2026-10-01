'use client';

import { Check, Copy, Info, MoreHorizontal, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Input, Menu, PageHeader, Select, Sheet, Skeleton, formatDate, useToast } from '@/app/ui';
import { apiDelete, apiPost, useApi } from '@/lib/client/api';

type Team = {
  signedIn: boolean;
  currentUserId: string | null;
  canManage: boolean;
  members: { user_id: string; role: string; created_at: string; email: string | null; full_name: string | null; title: string | null }[];
  invitations: { id: string; email: string; role: string; token: string | null; expires_at: string; created_at: string; expired: boolean }[];
};

function inviteUrl(token: string) {
  return `${typeof window === 'undefined' ? '' : window.location.origin}/login?invite=${token}`;
}

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(token);
  return (
    <div className="invite-link">
      <span>{url}</span>
      <Button
        size="sm"
        variant={copied ? 'secondary' : 'primary'}
        icon={copied ? Check : Copy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          } catch {
            /* ignore */
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

const ROLE_TONE = { owner: 'accent', admin: 'info', member: 'neutral' } as const;

export default function TeamSettingsPage() {
  const { data, mutate, isLoading } = useApi<Team>('/api/settings/team');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ email: string; token: string } | null>(null);

  const reset = () => {
    setEmail('');
    setRole('member');
    setError(null);
    setCreated(null);
  };

  const invite = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiPost<{ invitation: { email: string; token: string } }>('/api/settings/team/invitations', { email, role });
      setCreated({ email: res.invitation.email, token: res.invitation.token });
      void mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the invitation.');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await apiDelete(`/api/settings/team/invitations/${id}`);
      toast.success('Invitation revoked');
      void mutate();
    } catch (e) {
      toast.error('Could not revoke invitation', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <div className="page page--narrow">
      <PageHeader
        title="Team"
        subtitle="Invite teammates to sign in with their own account."
        back={{ href: '/settings', label: 'Settings' }}
        actions={
          data?.canManage ? (
            <Button
              variant="primary"
              icon={UserPlus}
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              Invite teammate
            </Button>
          ) : undefined
        }
      />
      <div className="stack">
        {data && !data.signedIn && (
          <div className="settings-note">
            <Info aria-hidden />
            <span>Sign-in is optional — anyone with the app link can use the shared workspace. Invitations let teammates create a personal account with their own profile.</span>
          </div>
        )}

        <Card title="Members" description={data ? `${data.members.length} ${data.members.length === 1 ? 'person' : 'people'}` : undefined} flush>
          {isLoading && !data ? (
            <div style={{ padding: 16 }}>
              <Skeleton lines={3} height={16} />
            </div>
          ) : data?.members.length ? (
            <ul className="ui-list">
              {data.members.map((m) => (
                <li key={m.user_id} className="ui-list__item">
                  <Avatar name={m.full_name || m.email || '?'} />
                  <div className="ui-list__main">
                    <span className="ui-list__title">
                      {m.full_name || m.email || 'Member'}
                      {m.user_id === data.currentUserId && <span className="subtle"> · you</span>}
                    </span>
                    <span className="ui-list__sub">{[m.title, m.email].filter(Boolean).join(' · ') || `Joined ${formatDate(m.created_at)}`}</span>
                  </div>
                  <span className="ui-list__end">
                    <Badge tone={ROLE_TONE[m.role as keyof typeof ROLE_TONE] ?? 'neutral'}>{m.role.charAt(0).toUpperCase() + m.role.slice(1)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={UserPlus} title="No signed-in members yet" description="People who accept an invitation will appear here." />
          )}
        </Card>

        <Card title="Pending invitations" flush={!!data?.invitations.length}>
          {data?.invitations.length ? (
            <ul className="ui-list">
              {data.invitations.map((inv) => (
                <li key={inv.id} className="ui-list__item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 10 }}>
                  <div className="row" style={{ width: '100%', gap: 12 }}>
                    <Avatar name={inv.email} size="sm" />
                    <div className="ui-list__main">
                      <span className="ui-list__title">{inv.email}</span>
                      <span className="ui-list__sub">
                        {inv.role === 'admin' ? 'Admin' : 'Member'} · {inv.expired ? 'Expired' : `Expires ${formatDate(inv.expires_at)}`}
                      </span>
                    </div>
                    {inv.expired && <Badge tone="warning">Expired</Badge>}
                    {data.canManage && (
                      <Menu
                        trigger={<IconButton icon={MoreHorizontal} label="Invitation actions" size="sm" />}
                        items={[{ label: 'Revoke invitation', icon: Trash2, danger: true, onSelect: () => void revoke(inv.id) }]}
                      />
                    )}
                  </div>
                  {inv.token && !inv.expired && (
                    <div style={{ width: '100%', paddingLeft: 40 }}>
                      <CopyLink token={inv.token} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title="No pending invitations" description="Invite a teammate and share the link with them." />
          )}
        </Card>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={created ? 'Invitation ready' : 'Invite a teammate'}
        description={created ? `Send this link to ${created.email}. It expires in 30 days.` : 'They’ll create an account with this email address.'}
        size="sm"
        footer={
          created ? (
            <>
              <Button onClick={reset}>Invite another</Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={saving} disabled={!email.trim()} onClick={() => void invite()}>
                Create invite link
              </Button>
            </>
          )
        }
      >
        {created ? (
          <CopyLink token={created.token} />
        ) : (
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <Field label="Email" error={error}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" autoCapitalize="off" data-autofocus />
            </Field>
            <Field label="Role" hint="Admins can change workspace settings and invite others.">
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
                options={[
                  { value: 'member', label: 'Member' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />
            </Field>
          </form>
        )}
      </Sheet>
    </div>
  );
}
