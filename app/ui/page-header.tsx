'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePageTitle } from './shell-context';
import { cx } from './util';

export type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Buttons on the right (stack under the title on phones). */
  actions?: ReactNode;
  /** Back link: `{ href, label }` or just an href string. */
  back?: string | { href: string; label?: string };
  /** Leading visual (e.g. an Avatar on record pages). */
  leading?: ReactNode;
  /** Extra content under the title row (badges, key facts, tabs). */
  children?: ReactNode;
  /** Plain-text title for the app top bar when `title` is not a string. */
  shellTitle?: string;
  className?: string;
};

export function PageHeader({ title, subtitle, actions, back, leading, children, shellTitle, className }: PageHeaderProps) {
  usePageTitle(shellTitle ?? (typeof title === 'string' ? title : null));
  const backLink = typeof back === 'string' ? { href: back, label: 'Back' } : back;
  return (
    <header className={cx('ui-pagehead', className)}>
      {backLink && (
        <Link href={backLink.href} className="ui-pagehead__back">
          <ChevronLeft aria-hidden />
          {backLink.label ?? 'Back'}
        </Link>
      )}
      <div className="ui-pagehead__row">
        <div className="ui-pagehead__main">
          {leading}
          <div className="ui-pagehead__titles">
            <h1 className="ui-pagehead__title">{title}</h1>
            {subtitle && <p className="ui-pagehead__subtitle">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="ui-pagehead__actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
