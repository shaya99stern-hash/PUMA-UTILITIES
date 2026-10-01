import Link from 'next/link';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './util';

export type CardProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons / menus shown on the right of the header. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Remove body padding (for lists and tables that go edge to edge). */
  flush?: boolean;
  /** Draw a divider under the header. */
  divided?: boolean;
  /** Make the whole card a link. */
  href?: string;
};

export function Card({ title, description, actions, footer, flush, divided, href, className, children, ...rest }: CardProps) {
  const hasHeader = title || description || actions;
  const inner = (
    <>
      {hasHeader && (
        <div className={cx('ui-card__header', (divided || flush) && 'ui-card__header--bordered')}>
          <div className="ui-card__titles">
            {title && <h3 className="ui-card__title">{title}</h3>}
            {description && <p className="ui-card__desc">{description}</p>}
          </div>
          {actions && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      {children !== undefined && children !== null && <div className="ui-card__body">{children}</div>}
      {footer && <div className="ui-card__footer">{footer}</div>}
    </>
  );
  const classes = cx('ui-card', flush && 'ui-card--flush', href && 'ui-card--interactive', className);
  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={classes} {...rest}>
      {inner}
    </div>
  );
}
