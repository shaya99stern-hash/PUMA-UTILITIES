'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { COMPANY_LIFECYCLES, companyLifecycle, type CompanyLifecycle } from '@/lib/company-lifecycle';
import {
  addBuilding,
  addCompany,
  addContact,
  editActivityNote,
  logCompanyCall,
  updateBuilding,
  updateCompanyRecord,
  updateContact,
} from '@/lib/crm-operations';
import { companyPath } from '@/lib/client-routing';
import { stripLegacyReleaseOneSeeds } from '@/lib/seed';
import type { Company, Person, Property, Workspace } from '@/lib/types';
import { loadWorkspace, saveWorkspace } from '@/lib/workspace';
import PumaAppShell from './puma-app-shell';
import PumaWorkspaceAppV4 from './puma-workspace-app-v4';

type ClientSubview = 'company' | 'buildings' | 'building';
type CompanyMode = 'all' | 'followups';
type SheetKind = 'company' | 'contact-add' | 'contact-edit' | 'building-add' | 'building-edit' | 'note-edit' | null;
type CompanyWithFollowUp = Company & { followUpAt?: string };

type Props = {
  companyId?: string;
  propertyId?: string;
  subview?: ClientSubview;
  companyMode?: CompanyMode;
};

function localDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function portfolioSummary(company: Company) {
  if (company.portfolioBuildings.status !== 'unknown' && typeof company.portfolioBuildings.value === 'number') {
    return `${company.portfolioBuildings.value.toLocaleString()} buildings`;
  }
  const metric = company.portfolio?.find((item) => ['buildings', 'properties', 'communities'].includes(item.label) && item.status !== 'unknown');
  if (metric) return metric.statement ?? `${metric.value.toLocaleString()} ${metric.label}`;
  return 'Portfolio not verified';
}

function persist(next: Workspace) {
  saveWorkspace(next);
  return next;
}

function CompaniesIndex({ companyMode = 'all' }: { companyMode?: CompanyMode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState<CompanyLifecycle>('Prospects');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [market, setMarket] = useState('');
  const [website, setWebsite] = useState('');
  const [nextAction, setNextAction] = useState('');

  useEffect(() => {
    const cleaned = stripLegacyReleaseOneSeeds(loadWorkspace());
    setWorkspace(cleaned);
    saveWorkspace(cleaned);
  }, []);

  const todayKey = localDayKey(new Date());
  const companies = workspace?.companies ?? [];
  const visibleCompanies = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return companies
      .filter((company) => companyMode === 'followups'
        ? companyLifecycle(company.stage) !== 'Not Interested' && Boolean((company as CompanyWithFollowUp).followUpAt?.slice(0, 10) && (company as CompanyWithFollowUp).followUpAt!.slice(0, 10) <= todayKey)
        : companyLifecycle(company.stage) === lifecycle)
      .filter((company) => {
        if (!lower) return true;
        const companyMatch = company.name.toLowerCase().includes(lower) || (company.market ?? '').toLowerCase().includes(lower);
        const contactMatch = company.people.some((person) => [person.name, person.role, person.email, person.phone].some((value) => value?.toLowerCase().includes(lower)));
        return companyMatch || contactMatch;
      });
  }, [companies, companyMode, lifecycle, query, todayKey]);

  const createCompany = () => {
    if (!workspace || !name.trim()) return;
    const next = addCompany(workspace, { name, market, website, nextAction });
    const created = next.companies.at(-1);
    setWorkspace(persist(next));
    setSheetOpen(false);
    if (created) window.location.assign(companyPath(created.id));
  };

  const resetForm = () => {
    setName(''); setMarket(''); setWebsite(''); setNextAction('');
  };

  const title = companyMode === 'followups' ? 'Follow-ups' : 'Companies';
  const subtitle = companyMode === 'followups' ? 'Due and overdue company follow-ups' : lifecycle;

  return (
    <PumaAppShell currentRoute="clients" pageLabel={title}>
      <div className="crm-page">
        <div className="crm-head">
          <div><h1>{title}</h1><p>{subtitle}</p></div>
          <div className="crm-head-actions">
            <Link className="crm-link-button" href="/engine">Find Leads</Link>
            <button className="crm-button primary" type="button" onClick={() => { resetForm(); setSheetOpen(true); }}>Add company</button>
          </div>
        </div>

        {companyMode === 'all' && <div className="crm-lifecycle" role="tablist" aria-label="Company lifecycle">
          {COMPANY_LIFECYCLES.map((item) => {
            const count = companies.filter((company) => companyLifecycle(company.stage) === item).length;
            return <button key={item} type="button" className={lifecycle === item ? 'active' : ''} onClick={() => setLifecycle(item)}>{item}<span>{count}</span></button>;
          })}
        </div>}

        <label className="crm-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies or contacts" aria-label="Search companies or contacts" />{query && <button type="button" className="crm-button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}</label>

        <div className="crm-list">
          {visibleCompanies.length === 0 && <div className="crm-empty">
            <strong>{companyMode === 'followups' ? 'No follow-ups due.' : 'No companies here yet.'}</strong>
            <p>{companyMode === 'followups' ? 'Companies with a due or overdue follow-up date will appear here.' : 'Add a company manually or use Find Leads to research and save a real prospect.'}</p>
            {companyMode === 'all' && <div className="crm-empty-actions"><button className="crm-button primary" type="button" onClick={() => { resetForm(); setSheetOpen(true); }}>Add company</button><Link className="crm-link-button" href="/engine">Find Leads</Link></div>}
          </div>}
          {visibleCompanies.map((company) => <Link className="crm-row" href={companyPath(company.id)} key={company.id}>
            <span className="crm-row-copy"><strong>{company.name}</strong><small>{company.market || 'Location not set'} · {portfolioSummary(company)}</small><em>{companyMode === 'followups' ? `Follow-up ${(company as CompanyWithFollowUp).followUpAt?.slice(0, 10) ?? 'not set'}` : company.nextAction || 'No next action set'}</em></span><ChevronRight size={17} />
          </Link>)}
        </div>
      </div>

      {sheetOpen && <div className="crm-sheet-scrim"><section className="crm-sheet" role="dialog" aria-modal="true" aria-label="Add company">
        <div className="crm-sheet-head"><div><strong>Add company</strong><p>Manual CRM data stays separate from verified public evidence.</p></div><button type="button" onClick={() => setSheetOpen(false)} aria-label="Close"><X size={18} /></button></div>
        <div className="crm-form">
          <label>Company name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
          <div className="crm-form-grid"><label>Market / state<input value={market} onChange={(event) => setMarket(event.target.value)} /></label><label>Website<input value={website} onChange={(event) => setWebsite(event.target.value)} inputMode="url" /></label></div>
          <label>Next action<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
          <div className="crm-form-note">Published company email and phone remain research-owned. Add manual contact details through Add contact so Puma keeps them labeled as user-entered.</div>
        </div>
        <div className="crm-sheet-actions"><button className="crm-button" type="button" onClick={() => setSheetOpen(false)}>Cancel</button><button className="crm-button primary" type="button" disabled={!name.trim()} onClick={createCompany}>Save company</button></div>
      </section></div>}
    </PumaAppShell>
  );
}

function CrmActionDock({ companyId, propertyId, subview = 'company' }: { companyId: string; propertyId?: string; subview?: ClientSubview }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [companyDraft, setCompanyDraft] = useState({ name:'', market:'', website:'', nextAction:'' });
  const [contactId, setContactId] = useState('');
  const [contactDraft, setContactDraft] = useState({ name:'', role:'', email:'', phone:'' });
  const [buildingDraft, setBuildingDraft] = useState({ name:'', address:'', state:'', units:'' });
  const [noteId, setNoteId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    const cleaned = stripLegacyReleaseOneSeeds(loadWorkspace());
    setWorkspace(cleaned);
  }, []);

  const company = workspace?.companies.find((item) => item.id === companyId);
  const property = workspace?.properties.find((item) => item.id === propertyId && item.companyId === companyId);

  const commit = (next: Workspace, message: string) => {
    persist(next);
    setWorkspace(next);
    setSheet(null);
    setToast(message);
    window.setTimeout(() => window.location.reload(), 180);
  };

  const openCompany = () => {
    if (!company) return;
    setCompanyDraft({ name:company.name, market:company.market ?? '', website:company.website ?? '', nextAction:company.nextAction ?? '' });
    setSheet('company');
  };

  const openAddContact = () => { setContactId(''); setContactDraft({ name:'', role:'', email:'', phone:'' }); setSheet('contact-add'); };
  const openEditContact = (person?: Person) => {
    const target = person ?? company?.people[0];
    if (!target) return;
    setContactId(target.id); setContactDraft({ name:target.name, role:target.role ?? '', email:target.email ?? '', phone:target.phone ?? '' }); setSheet('contact-edit');
  };
  const selectContact = (person: Person) => { setContactId(person.id); setContactDraft({ name:person.name, role:person.role ?? '', email:person.email ?? '', phone:person.phone ?? '' }); };

  const openAddBuilding = () => { setBuildingDraft({ name:'', address:'', state:company?.market ?? '', units:'' }); setSheet('building-add'); };
  const openEditBuilding = (target?: Property) => {
    const item = target ?? property;
    if (!item) return;
    setBuildingDraft({ name:item.name, address:item.address.value ?? '', state:item.state, units:item.units?.value?.toString() ?? '' }); setSheet('building-edit');
  };

  const openEditNote = (id?: string) => {
    const note = id ? company?.activityNotes?.find((item) => item.id === id) : company?.activityNotes?.at(-1);
    if (!note) return;
    setNoteId(note.id); setNoteDraft(note.text); setSheet('note-edit');
  };

  const saveCompany = () => {
    if (!workspace || !company) return;
    commit(updateCompanyRecord(workspace, company.id, { name:companyDraft.name, market:companyDraft.market, website:companyDraft.website, nextAction:companyDraft.nextAction }), 'Company updated');
  };
  const saveContact = () => {
    if (!workspace || !company || !contactDraft.name.trim()) return;
    const next = sheet === 'contact-add'
      ? addContact(workspace, company.id, contactDraft)
      : updateContact(workspace, company.id, contactId, contactDraft);
    commit(next, sheet === 'contact-add' ? 'Contact added' : 'Contact updated');
  };
  const saveBuilding = () => {
    if (!workspace || !company || !buildingDraft.name.trim() || !buildingDraft.state.trim()) return;
    const units = buildingDraft.units.trim() ? Number(buildingDraft.units) : undefined;
    const next = sheet === 'building-add'
      ? addBuilding(workspace, company.id, { name:buildingDraft.name, address:buildingDraft.address, state:buildingDraft.state, units:Number.isFinite(units) ? units : undefined })
      : property ? updateBuilding(workspace, company.id, property.id, { name:buildingDraft.name, address:buildingDraft.address, state:buildingDraft.state, units:Number.isFinite(units) ? units : null }) : workspace;
    commit(next, sheet === 'building-add' ? 'Building added' : 'Building updated');
  };
  const saveNote = () => {
    if (!workspace || !company || !noteId || !noteDraft.trim()) return;
    commit(editActivityNote(workspace, company.id, noteId, noteDraft), 'Activity updated');
  };
  const logCall = () => { if (workspace && company) commit(logCompanyCall(workspace, company.id), 'Call logged'); };

  if (!company) return null;

  return <>
    <div className="crm-action-dock" aria-label="CRM record actions">
      {subview === 'company' && <>
        <button type="button" className="primary" onClick={openCompany}>Edit company</button>
        <button type="button" onClick={openAddContact}>Add contact</button>
        {company.people.length > 0 && <button type="button" onClick={() => openEditContact()}>Edit contact</button>}
        <button type="button" onClick={openAddBuilding}>Add building</button>
        <button type="button" onClick={logCall}>Log call</button>
        {(company.activityNotes?.length ?? 0) > 0 && <button type="button" onClick={() => openEditNote()}>Edit note</button>}
      </>}
      {subview === 'buildings' && <button type="button" className="primary" onClick={openAddBuilding}>Add building</button>}
      {subview === 'building' && property && <button type="button" className="primary" onClick={() => openEditBuilding()}>Edit building</button>}
    </div>

    {toast && <div className="crm-toast">{toast}</div>}

    {sheet && <div className="crm-sheet-scrim"><section className="crm-sheet" role="dialog" aria-modal="true">
      <div className="crm-sheet-head"><div><strong>{sheet === 'company' ? 'Edit company' : sheet === 'contact-add' ? 'Add contact' : sheet === 'contact-edit' ? 'Edit contact' : sheet === 'building-add' ? 'Add building' : sheet === 'building-edit' ? 'Edit building' : 'Edit note'}</strong><p>Manual changes are labeled as user-entered CRM data.</p></div><button type="button" onClick={() => setSheet(null)} aria-label="Close"><X size={18} /></button></div>

      {sheet === 'company' && <div className="crm-form">
        <label>Company name<input value={companyDraft.name} onChange={(event) => setCompanyDraft((current) => ({...current,name:event.target.value}))} /></label>
        <div className="crm-form-grid"><label>Market / state<input value={companyDraft.market} onChange={(event) => setCompanyDraft((current) => ({...current,market:event.target.value}))} /></label><label>Website<input value={companyDraft.website} onChange={(event) => setCompanyDraft((current) => ({...current,website:event.target.value}))} /></label></div>
        <label>Next action<input value={companyDraft.nextAction} onChange={(event) => setCompanyDraft((current) => ({...current,nextAction:event.target.value}))} /></label>
        <div className="crm-form-note">Published company email and phone stay untouched here. Use Add contact for manual contact details.</div>
      </div>}

      {(sheet === 'contact-add' || sheet === 'contact-edit') && <>
        {sheet === 'contact-edit' && company.people.length > 1 && <div className="crm-record-picker">{company.people.map((person) => <button type="button" key={person.id} className={person.id === contactId ? 'active' : ''} onClick={() => selectContact(person)}>{person.name}{person.role ? ` · ${person.role}` : ''}</button>)}</div>}
        <div className="crm-form"><label>Name<input value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({...current,name:event.target.value}))} /></label><label>Role<input value={contactDraft.role} onChange={(event) => setContactDraft((current) => ({...current,role:event.target.value}))} /></label><div className="crm-form-grid"><label>Email<input value={contactDraft.email} onChange={(event) => setContactDraft((current) => ({...current,email:event.target.value}))} /></label><label>Phone<input value={contactDraft.phone} onChange={(event) => setContactDraft((current) => ({...current,phone:event.target.value}))} /></label></div></div>
      </>}

      {(sheet === 'building-add' || sheet === 'building-edit') && <div className="crm-form"><label>Building name<input value={buildingDraft.name} onChange={(event) => setBuildingDraft((current) => ({...current,name:event.target.value}))} /></label><label>Address<input value={buildingDraft.address} onChange={(event) => setBuildingDraft((current) => ({...current,address:event.target.value}))} /></label><div className="crm-form-grid"><label>State<input value={buildingDraft.state} onChange={(event) => setBuildingDraft((current) => ({...current,state:event.target.value}))} /></label><label>Residential units<input value={buildingDraft.units} onChange={(event) => setBuildingDraft((current) => ({...current,units:event.target.value}))} inputMode="numeric" /></label></div></div>}

      {sheet === 'note-edit' && <>{(company.activityNotes?.length ?? 0) > 1 && <div className="crm-record-picker">{company.activityNotes!.slice().reverse().map((note) => <button type="button" key={note.id} className={note.id === noteId ? 'active' : ''} onClick={() => {setNoteId(note.id);setNoteDraft(note.text);}}>{new Date(note.createdAt).toLocaleDateString()} · {note.text.slice(0,72)}</button>)}</div>}<div className="crm-form"><label>Activity note<textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} /></label></div></>}

      <div className="crm-sheet-actions"><button className="crm-button" type="button" onClick={() => setSheet(null)}>Cancel</button><button className="crm-button primary" type="button" onClick={sheet === 'company' ? saveCompany : sheet === 'contact-add' || sheet === 'contact-edit' ? saveContact : sheet === 'building-add' || sheet === 'building-edit' ? saveBuilding : saveNote}>Save</button></div>
    </section></div>}
  </>;
}

export default function PumaCrmWorkspace({ companyId, propertyId, subview = 'company', companyMode = 'all' }: Props) {
  if (!companyId) return <CompaniesIndex companyMode={companyMode} />;
  return <><PumaWorkspaceAppV4 view="clients" companyId={companyId} propertyId={propertyId} subview={subview} /><CrmActionDock companyId={companyId} propertyId={propertyId} subview={subview} /></>;
}
