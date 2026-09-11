'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check, Mail, X } from 'lucide-react';
import { collectSelectedEmails } from '@/lib/bulk-outreach';
import type { Company } from '@/lib/types';
import { loadWorkspace } from '@/lib/workspace';

function publishedEmailCount(company: Company) {
  return new Set(company.people.map((person) => person.email?.trim()).filter(Boolean)).size;
}

export default function ClientBulkOutreach() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedEmails = useMemo(
    () => collectSelectedEmails(companies, selectedIds),
    [companies, selectedIds],
  );

  if (pathname !== '/clients') return null;

  const openSheet = () => {
    const workspace = loadWorkspace();
    setCompanies(
      workspace.companies
        .filter((company) => company.stage !== 'Archived')
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
    setSelectedIds(new Set());
    setOpen(true);
  };

  const toggleCompany = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const emailSelected = () => {
    if (selectedEmails.length === 0) return;
    const bcc = encodeURIComponent(selectedEmails.join(','));
    const subject = encodeURIComponent('Water utility monitoring');
    window.location.href = `mailto:?bcc=${bcc}&subject=${subject}`;
  };

  return (
    <>
      <button type="button" className="puma-bulk-trigger" onClick={openSheet}>
        <Mail size={16} />
        <span>Bulk outreach</span>
      </button>

      {open && (
        <div className="puma-bulk-scrim" role="presentation" onClick={() => setOpen(false)}>
          <section className="puma-bulk-sheet" role="dialog" aria-modal="true" aria-label="Bulk outreach" onClick={(event) => event.stopPropagation()}>
            <div className="puma-bulk-handle" />
            <div className="puma-bulk-head">
              <div>
                <strong>Bulk outreach</strong>
                <span>Select companies, then hand off published emails to your mail app.</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close bulk outreach"><X size={18} /></button>
            </div>

            <div className="puma-bulk-list">
              {companies.map((company) => {
                const checked = selectedIds.has(company.id);
                const emailCount = publishedEmailCount(company);
                return (
                  <button type="button" className={`puma-bulk-row ${checked ? 'selected' : ''}`} onClick={() => toggleCompany(company.id)} key={company.id}>
                    <span className="puma-bulk-check">{checked && <Check size={14} />}</span>
                    <span className="puma-bulk-copy">
                      <strong>{company.name}</strong>
                      <small>{emailCount > 0 ? `${emailCount} published email${emailCount === 1 ? '' : 's'}` : 'No published email'}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="puma-bulk-actions">
              <span>{selectedIds.size} selected · {selectedEmails.length} email{selectedEmails.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={emailSelected} disabled={selectedEmails.length === 0}><Mail size={16} />Email selected</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
