import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type StatProps = {
  label: ReactNode;
  value: ReactNode;
  /** e.g. "+12%" — positive/negative tone is inferred from the sign unless `trend` is set. */
  delta?: string | number;
  trend?: 'up' | 'down' | 'flat';
  hint?: ReactNode;
  icon?: IconProp;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  href?: string;
  className?: string;
};

export function Stat({ label, value, delta, trend, hint, icon, tone = 'default', href, className }: StatProps) {
  const inferred = trend ?? (delta == null ? undefined : String(delta).trim().startsWith('-') ? 'down' : String(delta).trim() === '0' ? 'flat' : 'up');
  const body = (
    <>
      <div className="ui-stat__top">
        <span className="ui-stat__label truncate">{label}</span>
        {icon && <span className="ui-stat__icon">{renderIcon(icon, 16)}</span>}
      </div>
      <div className="ui-stat__value">{value}</div>
      {(delta != null || hint) && (
        <div className="ui-stat__foot">
          {delta != null && <span className={cx('ui-stat__delta', inferred === 'up' && 'ui-stat__delta--up', inferred === 'down' && 'ui-stat__delta--down')}>{delta}</span>}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </>
  );
  const classes = cx('ui-stat', tone !== 'default' && `ui-stat--${tone}`, className);
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
