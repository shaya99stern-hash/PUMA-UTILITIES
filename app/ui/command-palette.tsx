'use client';

import { ArrowRight, Building2, CornerDownLeft, Search, User, Warehouse } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ScorePill, StageBadge } from './badge';
import { ALL_NAV } from './nav';
import { useIsClient, useOverlayBehavior, usePresence } from './overlay';
import { Spinner } from './spinner';
import { cx } from './util';

type Hit = {
  key: string;
  group: 'Companies' | 'Contacts' | 'Properties' | 'Go to';
  title: string;
  subtitle?: string;
  href: string;
  icon: ReactNode;
  trailing?: ReactNode;
};

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const join = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(' · ') || undefined;

function normalize(body: unknown): Hit[] {
  const data = (body ?? {}) as Record<string, unknown>;
  const hits: Hit[] = [];
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as Row[]) : []);
  for (const c of list('companies')) {
    hits.push({
      key: `co-${c.id}`,
      group: 'Companies',
      title: str(c.name) ?? 'Untitled company',
      subtitle: join(c.domain, [str(c.city), str(c.state)].filter(Boolean).join(', ')),
      href: `/companies/${c.id}`,
      icon: <Building2 aria-hidden />,
      trailing: (
        <>
          {str(c.stage) && <StageBadge stage={c.stage as string} />}
          {typeof c.score === 'number' && <ScorePill score={c.score} />}
        </>
      ),
    });
  }
  for (const p of list('contacts')) {
    hits.push({
      key: `ct-${p.id}`,
      group: 'Contacts',
      title: str(p.full_name) ?? str(p.email) ?? 'Unnamed contact',
      subtitle: join(p.title, p.company_name, p.email),
      href: `/contacts/${p.id}`,
      icon: <User aria-hidden />,
    });
  }
  for (const p of list('properties')) {
    hits.push({
      key: `pr-${p.id}`,
      group: 'Properties',
      title: str(p.name) ?? str(p.address) ?? 'Property',
      subtitle: join(str(p.name) ? p.address : undefined, [str(p.city), str(p.state)].filter(Boolean).join(', '), typeof p.units === 'number' ? `${p.units} units` : undefined, p.company_name),
      href: `/properties/${p.id}`,
      icon: <Warehouse aria-hidden />,
    });
  }
  return hits;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useIsClient();
  const router = useRouter();
  const { mounted, closing } = usePresence(open, 160);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [active, setActive] = useState(0);
  useOverlayBehavior(open && mounted, panelRef, onClose);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setActive(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' });
        if (res.status === 404) {
          setUnavailable(true);
          setHits([]);
        } else if (res.ok) {
          setUnavailable(false);
          setHits(normalize(await res.json()));
        } else {
          setHits([]);
        }
      } catch {
        /* aborted or offline */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [q]);

  const pages = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    return ALL_NAV.filter((n) => !query || n.label.toLowerCase().includes(query)).map((n) => {
      const Icon = n.icon;
      return { key: `nav-${n.href}`, group: 'Go to', title: n.label, href: n.href, icon: <Icon aria-hidden /> };
    });
  }, [q]);

  const all = useMemo(() => [...hits, ...(q.trim() ? pages.slice(0, 4) : pages)], [hits, pages, q]);

  useEffect(() => {
    setActive(0);
  }, [all.length, q]);

  useEffect(() => {
    panelRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    onClose();
    router.push(hit.href);
  };

  if (!client || !mounted) return null;

  let lastGroup = '';
  return createPortal(
    <div className="ui-overlay cmdk-overlay" data-state={closing ? 'closing' : 'open'}>
      <div className="ui-scrim" onClick={onClose} aria-hidden />
      <div ref={panelRef} className="cmdk" role="dialog" aria-modal="true" aria-label="Search" tabIndex={-1}>
        <div className="cmdk__bar">
          <Search className="cmdk__icon" aria-hidden />
          <input
            ref={inputRef}
            className="cmdk__input"
            placeholder="Search companies, contacts, properties…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={all[active] ? `cmdk-${all[active].key}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(all.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(all[active]);
              }
            }}
          />
          {loading && <Spinner size="sm" className="cmdk__spin" />}
          <button type="button" className="cmdk__cancel" onClick={onClose}>
            Cancel
          </button>
          <kbd className="ui-kbd cmdk__esc">Esc</kbd>
        </div>
        <div className="cmdk__list" id="cmdk-list" role="listbox">
          {q.trim() && !loading && hits.length === 0 && (
            <div className="cmdk__empty">
              {unavailable ? 'Record search is not available yet.' : <>No companies, contacts or properties match “{q.trim()}”.</>}
            </div>
          )}
          {all.map((hit, index) => {
            const header = hit.group !== lastGroup ? hit.group : null;
            lastGroup = hit.group;
            return (
              <div key={hit.key}>
                {header && <div className="cmdk__group">{header}</div>}
                <button
                  type="button"
                  id={`cmdk-${hit.key}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={cx('cmdk__item', index === active && 'cmdk__item--active')}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(hit)}
                >
                  <span className="cmdk__item-icon">{hit.icon}</span>
                  <span className="cmdk__item-main">
                    <span className="cmdk__item-title">{hit.title}</span>
                    {hit.subtitle && <span className="cmdk__item-sub">{hit.subtitle}</span>}
                  </span>
                  {hit.trailing && <span className="cmdk__item-trail">{hit.trailing}</span>}
                  {index === active ? <CornerDownLeft className="cmdk__item-enter" aria-hidden /> : hit.group === 'Go to' ? <ArrowRight className="cmdk__item-enter cmdk__item-enter--dim" aria-hidden /> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
