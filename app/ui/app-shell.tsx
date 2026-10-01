'use client';

import { ChevronRight, LogIn, MoreHorizontal, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar } from './badge';
import { BrandMark } from './brand-mark';
import { CommandPalette } from './command-palette';
import { ALL_NAV, isActive, NAV_GROUPS, SETTINGS_ITEM, sectionTitle, TAB_HREFS, type NavItem } from './nav';
import { Sheet } from './sheet';
import { ShellContext } from './shell-context';
import { cx } from './util';

type Me = { signedIn: boolean; email: string | null; name: string | null; workspaceName: string | null };

/** Routes rendered without the app chrome. */
function isBare(pathname: string) {
  return pathname === '/login' || pathname.startsWith('/login/') || pathname.startsWith('/u/') || pathname.startsWith('/t/') || pathname === '/offline';
}

function useMe(enabled: boolean) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/settings/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setMe(data as Me);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return me;
}

function SideLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link href={item.href} className={cx('shell-nav__link', active && 'is-active')} aria-current={active ? 'page' : undefined}>
      <Icon aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const bare = isBare(pathname);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const me = useMe(!bare);

  const ctx = useMemo(() => ({ setPageTitle }), []);

  useEffect(() => {
    setMoreOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (bare) return;
    const onScroll = () => setScrolled(window.scrollY > 44);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [bare, pathname]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  useEffect(() => {
    if (bare) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bare]);

  if (bare) return <ShellContext.Provider value={ctx}>{children}</ShellContext.Provider>;

  const section = sectionTitle(pathname);
  const compactTitle = pageTitle ?? section;
  const tabItems = TAB_HREFS.map((href) => ALL_NAV.find((n) => n.href === href)!).filter(Boolean);
  const moreItems = ALL_NAV.filter((n) => !TAB_HREFS.includes(n.href));
  const moreActive = moreItems.some((n) => isActive(n, pathname));
  const displayName = me?.name || me?.email || null;

  return (
    <ShellContext.Provider value={ctx}>
      <a href="#main" className="shell-skip">
        Skip to content
      </a>
      <div className="shell">
        <aside className="shell-side" aria-label="Primary">
          <Link href="/" className="shell-side__brand" aria-label="Puma Utilities home">
            <BrandMark size={30} />
            <span className="shell-side__brand-text">
              <strong>Puma Utilities</strong>
              <span>{me?.workspaceName && me.workspaceName !== 'Puma Utilities' ? me.workspaceName : 'Water intelligence'}</span>
            </span>
          </Link>
          <nav className="shell-nav">
            {NAV_GROUPS.map((group, i) => (
              <div key={group.label ?? i} className="shell-nav__group">
                {group.label && <div className="shell-nav__label">{group.label}</div>}
                {group.items.map((item) => (
                  <SideLink key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            ))}
          </nav>
          <div className="shell-side__foot">
            <SideLink item={SETTINGS_ITEM} pathname={pathname} />
            {me?.signedIn ? (
              <Link href="/settings/profile" className="shell-account">
                <Avatar name={displayName} size="sm" />
                <span className="shell-account__text">
                  <strong className="truncate">{me.name || 'Your profile'}</strong>
                  <span className="truncate">{me.email}</span>
                </span>
              </Link>
            ) : (
              <Link href="/login" className="shell-account shell-account--guest">
                <span className="shell-account__icon">
                  <LogIn aria-hidden />
                </span>
                <span className="shell-account__text">
                  <strong>Sign in</strong>
                  <span>Optional · sync your profile</span>
                </span>
              </Link>
            )}
          </div>
        </aside>

        <div className="shell-main">
          <header className={cx('shell-top', scrolled && 'is-scrolled')}>
            <Link href="/" className="shell-top__mark" aria-label="Home">
              <BrandMark size={30} />
            </Link>
            <div className="shell-top__title" aria-hidden={!scrolled}>
              <span className="shell-top__section">{section}</span>
              {pageTitle && pageTitle !== section && (
                <>
                  <ChevronRight className="shell-top__sep" aria-hidden />
                  <span className="shell-top__page truncate">{pageTitle}</span>
                </>
              )}
              <span className="shell-top__compact truncate">{compactTitle}</span>
            </div>
            <button type="button" className="shell-search" onClick={openSearch} aria-label="Search (⌘K)">
              <Search aria-hidden />
              <span className="shell-search__label">Search companies, contacts, properties…</span>
              <kbd className="ui-kbd">⌘K</kbd>
            </button>
          </header>
          <main id="main" className="shell-content">
            {children}
          </main>
        </div>

        <nav className="shell-tabs" aria-label="Tabs">
          {tabItems.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={cx('shell-tab', active && 'is-active')} aria-current={active ? 'page' : undefined}>
                <Icon aria-hidden />
                <span>{item.href === '/leads' ? 'Leads' : item.label}</span>
              </Link>
            );
          })}
          <button type="button" className={cx('shell-tab', (moreActive || moreOpen) && 'is-active')} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
            <MoreHorizontal aria-hidden />
            <span>More</span>
          </button>
        </nav>
      </div>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More" size="sm">
        <div className="shell-more">
          {moreItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item, pathname);
            return (
              <Link key={item.href} href={item.href} className={cx('shell-more__item', active && 'is-active')} onClick={() => setMoreOpen(false)}>
                <span className="shell-more__icon">
                  <Icon aria-hidden />
                </span>
                <span className="grow">{item.label}</span>
                <ChevronRight className="shell-more__chev" aria-hidden />
              </Link>
            );
          })}
        </div>
        <div className="shell-more__account">
          {me?.signedIn ? (
            <Link href="/settings/profile" className="shell-more__item" onClick={() => setMoreOpen(false)}>
              <Avatar name={displayName} size="sm" />
              <span className="grow truncate">{displayName}</span>
              <ChevronRight className="shell-more__chev" aria-hidden />
            </Link>
          ) : (
            <Link href="/login" className="shell-more__item" onClick={() => setMoreOpen(false)}>
              <span className="shell-more__icon">
                <LogIn aria-hidden />
              </span>
              <span className="grow">
                Sign in <span className="subtle">· optional</span>
              </span>
              <ChevronRight className="shell-more__chev" aria-hidden />
            </Link>
          )}
        </div>
      </Sheet>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </ShellContext.Provider>
  );
}
