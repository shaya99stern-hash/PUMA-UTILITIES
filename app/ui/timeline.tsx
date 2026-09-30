import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type TimelineItem = {
  id: string;
  icon?: IconProp;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  title: ReactNode;
  body?: ReactNode;
  /** Pre-formatted time string (e.g. "2h ago"). */
  time?: ReactNode;
  meta?: ReactNode;
  href?: string;
};

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cx('ui-tl', className)}>
      {items.map((item) => (
        <li key={item.id} className="ui-tl__item">
          <span className={cx('ui-tl__icon', item.tone && item.tone !== 'default' && `ui-tl__icon--${item.tone}`)} aria-hidden>
            {renderIcon(item.icon, 14) ?? <span style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />}
          </span>
          <div className="ui-tl__content">
            <div className="ui-tl__head">
              <span className="ui-tl__title">{item.href ? <Link href={item.href}>{item.title}</Link> : item.title}</span>
              {item.time && <span className="ui-tl__time">{item.time}</span>}
            </div>
            {item.body && <div className="ui-tl__body">{item.body}</div>}
            {item.meta && <div className="ui-tl__meta">{item.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
