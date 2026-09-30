import type { ReactNode } from 'react';
import { cx, renderIcon, type IconProp } from './util';

export type EmptyStateProps = {
  icon?: IconProp;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons (CTAs). */
  actions?: ReactNode;
  compact?: boolean;
  /** Dashed border container. */
  bordered?: boolean;
  className?: string;
};

export function EmptyState({ icon, title, description, actions, compact, bordered, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', compact && 'ui-empty--compact', bordered && 'ui-empty--bordered', className)}>
      {icon && <div className="ui-empty__icon">{renderIcon(icon, 20)}</div>}
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__desc">{description}</p>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}
