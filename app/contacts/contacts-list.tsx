'use client';

import { Download, Mail, Plus, Star, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Avatar, Button, Chip, DataTable, EmptyState, PageHeader, SearchInput, type DataTableColumn } from '@/app/ui';
import { useApi } from '@/lib/client/api';
import { relTime } from '@/lib/crm/format';
import type { ContactListRow } from '@/lib/crm/types';
import { EmailStatusBadge, errMsg, Pager } from '@/lib/crm/ui/common';
import { ContactSheet } from '@/lib/crm/ui/forms';

const LIMIT = 50;

export function ContactsList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = sp.get('q') ?? '';
  const dm = sp.get('decisionMaker') === '1';
  const hasEmail = sp.get('hasEmail') === '1';
  const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);
  const [adding, setAdding] = useState(false);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (dm) p.set('decisionMaker', '1');
    if (hasEmail) p.set('hasEmail', '1');
    return p.toString();
  }, [q, dm, hasEmail]);
  const { data, error, isLoading, mutate } = useApi<{ rows: ContactListRow[]; total: number }>(`/api/contacts?limit=${LIMIT}&offset=${page * LIMIT}${qs ? `&${qs}` : ''}`);

  const columns: DataTableColumn<ContactListRow>[] = [
    {
      key: 'name', header: 'Name', mobile: 'title',
      cell: (c) => (
        <div className="crm-namecell">
          <Avatar name={c.full_name} size="sm" />
          <div className="crm-namecell__text">
            <span className="crm-namecell__name">{c.full_name}{c.is_decision_maker && <Star size={12} className="crm-star crm-star--on" style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="Decision maker" />}</span>
            <span className="crm-namecell__sub">{c.title ?? 'No title'}</span>
          </div>
        </div>
      ),
    },
    { key: 'company', header: 'Company', cell: (c) => c.company_id ? <Link href={`/companies/${c.company_id}`} style={{ color: 'inherit' }}>{c.company_name}</Link> : <span className="subtle">—</span> },
    { key: 'email', header: 'Email', cell: (c) => c.email ? <span className="row" style={{ gap: 8 }}><span className="truncate">{c.email}</span><EmailStatusBadge status={c.email_status} /></span> : <span className="subtle">—</span> },
    { key: 'phone', header: 'Phone', muted: true, cell: (c) => <span style={{ whiteSpace: 'nowrap' }}>{c.mobile ?? c.phone ?? '—'}</span> },
    { key: 'last', header: 'Last contacted', muted: true, cell: (c) => relTime(c.last_contacted_at) },
  ];
  const mobileCard = (c: ContactListRow) => (
    <div className="crm-card">
      <div className="crm-card__top">
        <Avatar name={c.full_name} />
        <div className="grow">
          <div className="crm-namecell__name" style={{ whiteSpace: 'normal' }}>{c.full_name}{c.is_decision_maker && <Star size={13} className="crm-star crm-star--on" style={{ marginLeft: 6, verticalAlign: -1 }} />}</div>
          <div className="crm-namecell__sub">{[c.title, c.company_name].filter(Boolean).join(' · ') || 'No details yet'}</div>
        </div>
      </div>
      {c.email && <div className="row" style={{ gap: 8 }}><Mail size={13} className="subtle" /><span className="truncate text-sm">{c.email}</span><EmailStatusBadge status={c.email_status} /></div>}
    </div>
  );

  const total = data?.total ?? 0;
  const empty = !isLoading && !error && data && total === 0;
  const filtered = !!(q || dm || hasEmail);

  return (
    <div className="page">
      <PageHeader
        title="Contacts" subtitle={data ? `${total.toLocaleString()} ${total === 1 ? 'person' : 'people'}` : 'Decision makers and building staff'}
        actions={<><Button icon={Download} href={`/api/export/contacts.csv${qs ? `?${qs}` : ''}`} className="hide-mobile">Export</Button><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add contact</Button></>}
      />
      <div className="crm-toolbar">
        <SearchInput className="crm-toolbar__search" value={q} debounce={250} onChange={(v) => setParams({ q: v })} placeholder="Search name, email, title, company" />
        <div className="crm-filters crm-filters--scroll">
          <Chip selected={dm} icon={Star} onClick={() => setParams({ decisionMaker: dm ? null : '1' })}>Decision makers</Chip>
          <Chip selected={hasEmail} icon={Mail} onClick={() => setParams({ hasEmail: hasEmail ? null : '1' })}>Has email</Chip>
        </div>
      </div>
      {error && !data ? (
        <EmptyState bordered icon={Users} title="Couldn't load contacts" description={errMsg(error)} actions={<Button onClick={() => void mutate()}>Try again</Button>} />
      ) : empty ? (
        <EmptyState
          bordered icon={Users} title={filtered ? 'No contacts match' : 'No contacts yet'}
          description={filtered ? 'Try clearing a filter.' : 'Contacts are the people behind each company. Add one, or import companies with a contact column.'}
          actions={filtered ? <Button onClick={() => router.replace(pathname)}>Clear filters</Button> : <><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add contact</Button><Button href="/companies">Import from companies</Button></>}
        />
      ) : (
        <DataTable
          aria-label="Contacts" rows={data?.rows ?? []} columns={columns} getRowId={(c) => c.id} rowHref={(c) => `/contacts/${c.id}`} loading={isLoading && !data}
          mobileCard={mobileCard} footer={<Pager offset={page * LIMIT} limit={LIMIT} total={total} onChange={(o) => setParams({ page: String(o / LIMIT) })} />}
        />
      )}
      <ContactSheet open={adding} onClose={() => setAdding(false)} onSaved={(c) => router.push(`/contacts/${c.id}`)} />
    </div>
  );
}
